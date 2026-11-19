// Stage 9 tests: signed notes — the certificate REQUEST flow.
// A player signs a Note from a Certificate (sign_note: cert -1,
// note +1, signed text stored on profile.notes), reads it back
// without consuming it (read_note), and gives it to an admin
// (give_note) who decides (note_reply): agree pays the signer 250g
// (even offline), decline returns the signed note. Also covered:
// the 'note' item guards (personal — no drop / trade / stake /
// sell), admin_notes listing, wrong-admin replies refused, the
// untouched 7A broadcast exchange_cert flow (creates NO note), and
// restart persistence of a held signed note.
//
// Same harness style as test/stage7.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., a fresh disposable DB so
// the literal owner name 'nally' can register.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18093;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage9.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

const NOTE_PERSONAL_MSG = "A note is personal — it can't be dropped, traded, or staked.";
const SIGNED_TEXT = "S9Player's request: exchange 1 certificate for 250g.\nSigned: S9Player";

function assert(cond, label) {
  if (!cond) throw new Error('ASSERT FAILED: ' + label);
  console.log('PASS ' + label);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
async function startServer() {
  serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('server did not start listening in time');
}
async function stopServer() {
  if (!serverProc) return;
  const p = serverProc; serverProc = null;
  await new Promise((resolve) => { p.once('exit', resolve); p.kill('SIGTERM'); setTimeout(resolve, 5000); });
  await sleep(300);
}

async function api(pathName, body) {
  const r = await fetch(BASE + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(pathName + ': ' + d.error);
  return d;
}

class Client {
  constructor(name) { this.name = name; this.events = []; this.ws = null; }
  connect(token) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
      this.ws.on('message', (data) => { try { this.events.push(JSON.parse(data.toString())); } catch { /* ignore */ } });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  mark() { return this.events.length; }
  waitSince(idx, pred, timeoutMs = 15000, label = 'event') {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        for (let i = idx; i < this.events.length; i++) {
          if (pred(this.events[i])) return resolve({ e: this.events[i], idx: i });
        }
        if (Date.now() > deadline) return reject(new Error(`${this.name}: timeout waiting for ${label}`));
        setTimeout(check, 100);
      };
      check();
    });
  }
  waitFor(pred, timeoutMs = 15000, label = 'event') { return this.waitSince(0, pred, timeoutMs, label).then((r) => r.e); }
  profile() {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].profile) return this.events[i].profile;
    return null;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
async function register(name, password) {
  const d = await api('/api/register', { username: name, password });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function login(name, password) {
  const d = await api('/api/login', { username: name, password });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome (login)');
  return c;
}
const qty = (profile, item) => {
  const s = (profile.backpack || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
async function expectError(c, obj, label) {
  const m = c.mark();
  c.send(obj);
  const r = await c.waitSince(m, (e) => e.type === 'error', 10000, label + ' (error)');
  return r.e;
}
async function waitProfile(c, mark, pred, label) {
  const r = await c.waitSince(mark, (e) => e.profile && pred(e.profile), 15000, label);
  return r.e.profile;
}
// Owner spawns an item straight into a player's backpack.
async function spawnTo(owner, targetClient, item, qtyWanted) {
  const m = targetClient.mark();
  owner.send({ type: 'spawn_item', item, qty: qtyWanted, target: targetClient.name });
  return waitProfile(targetClient, m, (p) => qty(p, item) >= qtyWanted, `spawn ${item} -> ${targetClient.name}`);
}
// Ask an admin for their pending signed notes.
async function adminNotes(c) {
  const m = c.mark();
  c.send({ type: 'admin_notes' });
  return (await c.waitSince(m, (e) => e.type === 'admin_notes', 10000, 'admin_notes')).e.notes;
}

async function main() {
  // Source-level checks: the note definition, the one wording home,
  // and the REMOVED cert_use flow (using a certificate on an admin is
  // a client-side trigger for the sign screen, not a server message).
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/ITEMS\.note = \{[^}]*kind: 'note'/.test(src), "source: note is defined with kind 'note'");
  assert(/ITEMS\.note = \{[^}]*sellOnly: 0/.test(src), 'source: note is unsellable (sellOnly 0, like the tokens)');
  assert(/ITEMS\.note = \{[^}]*icon: '📝'/.test(src), 'source: note carries the 📝 icon');
  assert(/function noteRequestText\(playerName\)/.test(src), 'source: noteRequestText(playerName) is the one wording home');
  assert(!src.includes('cert_use'), 'source: the cert_use message does not exist (removed by the design correction)');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Setup: owner, two admins, players, an offline admin ----------
    const nally = await register('nally', 'owner-pass-9');
    const admin = await register('S9Admin', 's9-admin-pass');
    const admin2 = await register('S9Admin2', 's9-admin2-pass');
    const player = await register('S9Player', 's9-player-pass');
    const buddy = await register('S9Buddy', 's9-buddy-pass');
    const broke = await register('S9Broke', 's9-broke-pass');
    const offAdmin = await register('S9OffAdmin', 's9-off-pass');
    clients.push(nally, admin, admin2, player, buddy, broke);
    for (const [adm, name] of [[admin, 'S9Admin'], [admin2, 'S9Admin2'], [offAdmin, 'S9OffAdmin']]) {
      const mA = adm.mark(); const mO = nally.mark();
      nally.send({ type: 'set_role', target: name, role: 'admin' });
      await nally.waitSince(mO, (e) => e.type === 'admin_note' && e.text.includes(`${name}'s role to admin`), 10000, `owner set ${name} admin`);
      const p = await waitProfile(adm, mA, (x) => x.role === 'admin', `${name} admin profile`);
      assert(p.role === 'admin', `setup: ${name} is an admin`);
    }
    offAdmin.close();
    await sleep(800); // the server drops the offline admin's session

    // ---------- The 7A broadcast exchange_cert flow is unchanged ----------
    await spawnTo(nally, buddy, 'certificate', 1);
    const buddyGold = buddy.profile().gold;
    const mAdmX = admin.mark(); const mAdm2X = admin2.mark(); const mBudX = buddy.mark();
    buddy.send({ type: 'exchange_cert' });
    const reqX = (await admin.waitSince(mAdmX, (e) => e.type === 'cert_request', 10000, 'broadcast cert_request (admin)')).e;
    const reqX2 = (await admin2.waitSince(mAdm2X, (e) => e.type === 'cert_request', 10000, 'broadcast cert_request (admin2)')).e;
    assert(reqX.from === 'S9Buddy' && reqX2.from === 'S9Buddy', 'exchange_cert: the broadcast request still reaches every online admin');
    admin.send({ type: 'cert_reply', from: 'S9Buddy', accept: true });
    const buddyAfter = await waitProfile(buddy, mBudX, (p) => qty(p, 'certificate') === 0, 'buddy profile after broadcast exchange');
    assert(buddyAfter.gold === buddyGold + 250 && qty(buddyAfter, 'note') === 0,
      'exchange_cert: +250g as in 7A and NO note is involved');

    // ---------- Signing ----------
    const errNoCert = await expectError(broke, { type: 'sign_note' }, 'sign without a certificate');
    assert(errNoCert.message === "You don't have a Certificate to sign.", `sign_note: no-certificate error (\"${errNoCert.message}\")`);
    const errReadNone = await expectError(broke, { type: 'read_note' }, 'read with no note');
    assert(errReadNone.message === 'You have no note to read.', `read_note: no-note error (\"${errReadNone.message}\")`);
    // A spawned note item with NO stored text hits the blank guard.
    await spawnTo(nally, broke, 'note', 1);
    const errBlank = await expectError(broke, { type: 'read_note' }, 'read a blank note');
    assert(errBlank.message === 'That note is blank.', `read_note: blank-note error (\"${errBlank.message}\")`);

    await spawnTo(nally, player, 'certificate', 2);
    const mSign = player.mark();
    player.send({ type: 'sign_note' });
    const signed = await waitProfile(player, mSign, (p) => qty(p, 'note') === 1, 'profile after signing');
    assert(qty(signed, 'certificate') === 1 && qty(signed, 'note') === 1,
      'sign_note: certificate -1 (2 -> 1), note +1');

    // ---------- Reading consumes NOTHING ----------
    const mRead = player.mark();
    player.send({ type: 'read_note' });
    const nt = (await player.waitSince(mRead, (e) => e.type === 'note_text', 10000, 'note_text')).e;
    assert(nt.text === SIGNED_TEXT, 'read_note: the signed text reads back exactly (noteRequestText)');
    assert(nt.from === 'S9Player' && typeof nt.at === 'number', 'read_note: note_text carries from (the signer) + at');
    player.send({ type: 'read_note' });
    const nt2 = (await player.waitSince(mRead, (e) => e.type === 'note_text' && e !== nt, 10000, 'note_text again')).e;
    assert(nt2.text === SIGNED_TEXT && qty(player.profile(), 'note') === 1 && qty(player.profile(), 'certificate') === 1,
      'read_note: reading again shows the same note — nothing was consumed');

    // ---------- give_note rejections ----------
    const errGiveNone = await expectError(buddy, { type: 'give_note', to: 'S9Admin' }, 'give with no note');
    assert(errGiveNone.message === 'You have no note to give.', `give_note: no-note error (\"${errGiveNone.message}\")`);
    const errGivePlayer = await expectError(player, { type: 'give_note', to: 'S9Buddy' }, 'give to a non-admin');
    assert(errGivePlayer.message === 'You can only give a note to an admin.', `give_note: non-admin error (\"${errGivePlayer.message}\")`);
    const errGiveOffline = await expectError(player, { type: 'give_note', to: 'S9OffAdmin' }, 'give to an offline admin');
    assert(errGiveOffline.message === 'That admin is not online right now.', `give_note: offline-admin error (\"${errGiveOffline.message}\")`);
    const errGiveSelf = await expectError(player, { type: 'give_note', to: 'S9Player' }, 'give to self');
    assert(errGiveSelf.message === "You can't give a note to yourself.", `give_note: self error (\"${errGiveSelf.message}\")`);
    assert(qty(player.profile(), 'note') === 1, 'give_note: every rejection kept the note with the signer');

    // ---------- Give: the admin receives and lists the request ----------
    const mAdm = admin.mark(); const mP = player.mark();
    player.send({ type: 'give_note', to: 'S9Admin' });
    const nreq = (await admin.waitSince(mAdm, (e) => e.type === 'note_request', 10000, 'note_request')).e;
    assert(typeof nreq.id === 'number' && nreq.from === 'S9Player' && nreq.text === SIGNED_TEXT,
      'give_note: the admin received note_request {id, from, text} with the signed text');
    const afterGive = await waitProfile(player, mP, (p) => qty(p, 'note') === 0, 'profile after giving');
    assert(qty(afterGive, 'note') === 0 && qty(afterGive, 'certificate') === 1,
      'give_note: the note item + entry left the signer (certificate untouched)');
    const listed = await adminNotes(admin);
    assert(listed.length === 1 && listed[0].id === nreq.id && listed[0].from === 'S9Player' && listed[0].text === SIGNED_TEXT
      && typeof listed[0].at === 'number', 'admin_notes: the holding admin lists the pending note {id, from, text, at}');
    assert((await adminNotes(admin2)).length === 0, 'admin_notes: the other admin has no pending notes');
    await expectError(player, { type: 'admin_notes' }, 'admin_notes as a player');
    console.log('PASS admin_notes: a plain player is rejected');

    // ---------- Only the holding admin may decide ----------
    const errWrong = await expectError(admin2, { type: 'note_reply', id: nreq.id, accept: true }, 'wrong admin note_reply');
    assert(errWrong.message === 'That note was given to another admin.', `note_reply: wrong-admin error (\"${errWrong.message}\")`);
    assert((await adminNotes(admin)).length === 1, 'note_reply: the refused reply left the note pending');
    const errGone = await expectError(admin, { type: 'note_reply', id: 99999, accept: true }, 'note_reply on a missing note');
    assert(errGone.message === 'That note is gone.', `note_reply: missing-note error (\"${errGone.message}\")`);

    // ---------- Decline: the signed note RETURNS, no gold moves ----------
    const goldBeforeDecline = player.profile().gold;
    const mPDec = player.mark();
    admin.send({ type: 'note_reply', id: nreq.id, accept: false });
    const returned = await waitProfile(player, mPDec, (p) => qty(p, 'note') === 1, 'profile after decline');
    assert(returned.gold === goldBeforeDecline && qty(returned, 'note') === 1,
      'note_reply decline: the signed note returned to the signer, gold unchanged');
    await player.waitSince(mPDec, (e) => e.type === 'chat' && (e.text || '').includes('declined your signed Note'), 10000, 'decline chat');
    console.log('PASS note_reply decline: the signer was told the note came back');
    assert((await adminNotes(admin)).length === 0, 'note_reply decline: the pending note is gone from the admin list');
    // The returned note still reads as the same signed request.
    const mRead2 = player.mark();
    player.send({ type: 'read_note' });
    const ntBack = (await player.waitSince(mRead2, (e) => e.type === 'note_text', 10000, 'note_text (returned note)')).e;
    assert(ntBack.text === SIGNED_TEXT, 'note_reply decline: the returned note kept its signed text');

    // ---------- Accept: the signer is paid 250g ----------
    const goldBeforeAccept = player.profile().gold;
    const mAdmA = admin.mark(); const mPA = player.mark();
    player.send({ type: 'give_note', to: 'S9Admin' });
    const nreq2 = (await admin.waitSince(mAdmA, (e) => e.type === 'note_request', 10000, 'note_request (accept run)')).e;
    assert(nreq2.id !== nreq.id, 'give_note: each given note gets its own pending id');
    admin.send({ type: 'note_reply', id: nreq2.id, accept: true });
    const paid = await waitProfile(player, mPA, (p) => p.gold === goldBeforeAccept + 250, 'profile after accept');
    assert(paid.gold === goldBeforeAccept + 250 && qty(paid, 'note') === 0,
      `note_reply accept: signer paid exactly 250g (${goldBeforeAccept} -> ${paid.gold}), note gone`);
    await player.waitSince(mPA, (e) => e.type === 'chat' && (e.text || '').includes('approved by S9Admin'), 10000, 'approval chat');
    console.log('PASS note_reply accept: the signer was told their note was approved and paid');
    assert((await adminNotes(admin)).length === 0, 'note_reply accept: admin_notes is empty afterwards');

    // ---------- Accept settles OFFLINE signers from the saved profile ----------
    const mSign2 = player.mark();
    player.send({ type: 'sign_note' }); // spends the last certificate
    const signed2 = await waitProfile(player, mSign2, (p) => qty(p, 'note') === 1 && qty(p, 'certificate') === 0, 'profile after second signing');
    assert(qty(signed2, 'certificate') === 0 && qty(signed2, 'note') === 1, 'sign_note: the second certificate signed a second note');
    const goldOffline = player.profile().gold;
    const mAdm2Off = admin2.mark();
    player.send({ type: 'give_note', to: 'S9Admin2' });
    const nreq3 = (await admin2.waitSince(mAdm2Off, (e) => e.type === 'note_request', 10000, 'note_request (offline settle)')).e;
    player.close();
    await sleep(800); // the signer is fully offline before the decision
    admin2.send({ type: 'note_reply', id: nreq3.id, accept: true });
    await sleep(500);
    const playerBack = await login('S9Player', 's9-player-pass');
    clients.push(playerBack);
    assert(playerBack.profile().gold === goldOffline + 250 && qty(playerBack.profile(), 'note') === 0,
      `note_reply accept: an offline signer was paid on their saved profile (${goldOffline} -> ${playerBack.profile().gold})`);

    // ---------- Note guards (drop / sell / stake / trade) ----------
    await spawnTo(nally, playerBack, 'certificate', 1);
    const mSign3 = playerBack.mark();
    playerBack.send({ type: 'sign_note' });
    await waitProfile(playerBack, mSign3, (p) => qty(p, 'note') === 1, 'profile with guard-test note');
    const errDrop = await expectError(playerBack, { type: 'drop', item: 'note', qty: 1 }, 'drop note');
    assert(errDrop.message === NOTE_PERSONAL_MSG, `drop: a note is refused (\"${errDrop.message}\")`);
    const errSell = await expectError(playerBack, { type: 'shop_sell', item: 'note', qty: 1 }, 'shop_sell note');
    assert(errSell.message === "That can't be sold.", `shop_sell: a note is refused (\"${errSell.message}\")`);
    const errExch = await expectError(playerBack, { type: 'exchange_sell', good: 'note', qty: 1 }, 'exchange_sell note');
    assert(errExch.message === "That can't be sold.", `exchange_sell: a note is refused (\"${errExch.message}\")`);
    const errStake = await expectError(playerBack, { type: 'challenge', target: 'S9Buddy', stake: 0, items: [{ item: 'note', qty: 1 }] }, 'stake note in a challenge');
    assert(errStake.message === NOTE_PERSONAL_MSG, `challenge: staking a note is refused (\"${errStake.message}\")`);
    const mPB = playerBack.mark(); const mBB = buddy.mark();
    playerBack.send({ type: 'trade_request', target: 'S9Buddy' });
    const inc = (await buddy.waitSince(mBB, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming')).e;
    buddy.send({ type: 'trade_response', tradeId: inc.tradeId, accept: true });
    const open = (await playerBack.waitSince(mPB, (e) => e.type === 'trade_open', 10000, 'trade_open')).e;
    const errOffer = await expectError(playerBack, { type: 'trade_offer', tradeId: open.tradeId, gold: 0, items: [{ item: 'note', qty: 1 }] }, 'offer note in trade');
    assert(errOffer.message === NOTE_PERSONAL_MSG, `trade_offer: offering a note is refused (\"${errOffer.message}\")`);
    playerBack.send({ type: 'trade_cancel', tradeId: open.tradeId });
    await sleep(300);
    assert(qty(playerBack.profile(), 'note') === 1, 'guards: after every refusal the signer still holds the note');

    // ---------- Restart persistence: the held signed note survives ----------
    for (const c of clients) c.close();
    await sleep(500);
    await stopServer();
    await startServer();
    const playerFinal = await login('S9Player', 's9-player-pass');
    clients.push(playerFinal);
    assert(qty(playerFinal.profile(), 'note') === 1, 'restart: the held signed Note item survived the restart');
    const mFin = playerFinal.mark();
    playerFinal.send({ type: 'read_note' });
    const ntFin = (await playerFinal.waitSince(mFin, (e) => e.type === 'note_text', 10000, 'note_text after restart')).e;
    assert(ntFin.text === SIGNED_TEXT && ntFin.from === 'S9Player',
      'restart: the signed text survived and reads back exactly');
    assert(qty(playerFinal.profile(), 'note') === 1, 'restart: reading after the restart still consumed nothing');

    for (const c of clients) c.close();
    console.log('ALL STAGE 9 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
