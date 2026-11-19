// Stage 7B tests: the rest of Derek's tap-player menu — Talk
// (whispers), Examine, Invite (parties) and Trade (two-sided,
// server-validated, atomic swap). Challenge and Follow need no
// server work and are not covered here.
//
// Same harness style as test/stage7.js: HTTP /api/register +
// /api/login for accounts, WebSocket at /ws?token=..., a fresh
// disposable DB file.
//
// Trade setup uses the shops with starter gold (phase2 style): the
// traded items are a Cooked ration (8g) and a Prayer potion (15g).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18089;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage7b.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

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
const qty = (profile, item) => {
  const s = (profile.backpack || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
// Send a message and require an {type:'error'} back; returns it.
async function expectError(c, obj, label) {
  const m = c.mark();
  c.send(obj);
  const r = await c.waitSince(m, (e) => e.type === 'error', 10000, label + ' (error)');
  return r.e;
}
// Wait (from a mark) for a profile satisfying pred; returns it.
async function waitProfile(c, mark, pred, label) {
  const r = await c.waitSince(mark, (e) => e.profile && pred(e.profile), 15000, label);
  return r.e.profile;
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

async function main() {
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    const nally = await register('nally', 'owner-pass-7b');
    const A = await register('S7BAlice', 's7b-a-pass');
    const B = await register('S7BBob', 's7b-b-pass');
    const C = await register('S7BCara', 's7b-c-pass');
    clients.push(nally, A, B, C);

    // ---------- Whisper (Talk) ----------
    let mA = A.mark(); let mB = B.mark();
    A.send({ type: 'whisper', to: 'S7BBob', text: '  hello there  ' });
    const gotW = (await B.waitSince(mB, (e) => e.type === 'whisper', 10000, 'whisper delivered')).e;
    assert(gotW.from === 'S7BAlice' && gotW.text === 'hello there',
      `whisper: delivered to the target, trimmed ("${gotW.text}")`);
    const echoW = (await A.waitSince(mA, (e) => e.type === 'whisper', 10000, 'whisper echo')).e;
    assert(echoW.from === 'S7BAlice' && echoW.to === 'S7BBob' && echoW.text === 'hello there',
      'whisper: echoed to the sender with the target named in `to`');

    // Case-insensitive addressing reaches the same player.
    mB = B.mark();
    A.send({ type: 'whisper', to: 's7bbob', text: 'lowercase works' });
    const gotW2 = (await B.waitSince(mB, (e) => e.type === 'whisper', 10000, 'whisper lowercase')).e;
    assert(gotW2.text === 'lowercase works', 'whisper: usernames resolve case-insensitively');

    const errW = await expectError(A, { type: 'whisper', to: 'GhostName', text: 'hi' }, 'whisper offline');
    assert(errW.message === 'GhostName is not online.', `whisper: offline target errors exactly ("${errW.message}")`);

    // 200-char cap.
    mB = B.mark();
    A.send({ type: 'whisper', to: 'S7BBob', text: 'x'.repeat(250) });
    const gotLong = (await B.waitSince(mB, (e) => e.type === 'whisper', 10000, 'whisper long')).e;
    assert(gotLong.text.length === 200, `whisper: text capped at 200 chars (got ${gotLong.text.length})`);

    // Empty whispers are ignored: the first whisper after the mark
    // must be the real one sent after the empty one.
    mB = B.mark();
    A.send({ type: 'whisper', to: 'S7BBob', text: '   ' });
    A.send({ type: 'whisper', to: 'S7BBob', text: 'real one' });
    const firstAfter = (await B.waitSince(mB, (e) => e.type === 'whisper', 10000, 'whisper after empty')).e;
    assert(firstAfter.text === 'real one', 'whisper: an empty whisper delivers nothing');

    // ---------- Examine ----------
    mA = A.mark();
    A.send({ type: 'examine', target: 'S7BBob' });
    const exam = (await A.waitSince(mA, (e) => e.type === 'examine', 10000, 'examine reply')).e;
    const p = exam.player;
    assert(p.username === 'S7BBob' && p.role === 'player' && p.area === 'plaza', 'examine: username, role and area');
    // Stage 19: total level now includes Fletching (14 skills) → fresh total is 23, not 22.
    assert(p.totalLevel === 23 && p.combatLevel === 3.4,
      `examine: fresh levels — total 23, combat 3.4 (got total ${p.totalLevel}, combat ${p.combatLevel})`);
    assert(p.wins === 0 && p.losses === 0 && p.rating === 1000 && p.style === 'accurate', 'examine: duel record, rating and style');
    assert(p.worn && p.worn.weapon === null && 'cape' in p.worn && p.inDuel === false, 'examine: worn object (10 slots) and inDuel flag');
    assert(!('gold' in p) && !('backpack' in p) && !('bank' in p), 'examine: gold, backpack and bank are NOT included');

    mA = A.mark();
    A.send({ type: 'examine', target: 'nally' });
    const examOwner = (await A.waitSince(mA, (e) => e.type === 'examine', 10000, 'examine owner')).e;
    assert(examOwner.player.role === 'owner', "examine: the account 'nally' shows effective role owner");

    const errExam = await expectError(A, { type: 'examine', target: 'GhostName' }, 'examine offline');
    assert(errExam.message === 'GhostName is not online.', `examine: offline target errors ("${errExam.message}")`);

    // ---------- Parties (Invite) ----------
    await expectError(A, { type: 'party_invite', target: 'S7BAlice' }, 'party invite self');
    console.log('PASS party: inviting yourself is rejected');
    await expectError(A, { type: 'party_invite', target: 'GhostName' }, 'party invite offline');
    console.log('PASS party: inviting an offline player is rejected');
    await expectError(C, { type: 'party_reply', accept: true }, 'party reply with no invite');
    console.log('PASS party: replying with no pending invite is rejected');

    // Decline path: the inviter is notified and their solo party dissolves.
    let mC = C.mark(); mA = A.mark();
    A.send({ type: 'party_invite', target: 'S7BCara' });
    const invC = (await C.waitSince(mC, (e) => e.type === 'party_invite', 10000, 'party_invite C')).e;
    assert(invC.from === 'S7BAlice', 'party: the target receives the invite naming the inviter');
    C.send({ type: 'party_reply', accept: false });
    await A.waitSince(mA, (e) => e.type === 'chat' && e.from === 'Game' && e.text === 'S7BCara declined your party invite.', 10000, 'party decline note');
    console.log('PASS party decline: the inviter was notified');
    const partyGone = (await A.waitSince(mA, (e) => e.type === 'party' && e.members.length === 0, 10000, 'party dissolved after decline')).e;
    assert(partyGone.members.length === 0, 'party decline: the pending solo party dissolved (members [])');

    // Accept path: both sides list both members, chat + snapshot agree.
    mA = A.mark(); mB = B.mark();
    A.send({ type: 'party_invite', target: 'S7BBob' });
    await B.waitSince(mB, (e) => e.type === 'party_invite' && e.from === 'S7BAlice', 10000, 'party_invite B');
    B.send({ type: 'party_reply', accept: true });
    const partyA = (await A.waitSince(mA, (e) => e.type === 'party' && e.members.length === 2, 10000, 'party update A')).e;
    const partyB = (await B.waitSince(mB, (e) => e.type === 'party' && e.members.length === 2, 10000, 'party update B')).e;
    assert(sameSet(partyA.members, ['S7BAlice', 'S7BBob']) && sameSet(partyB.members, ['S7BAlice', 'S7BBob']),
      'party accept: both clients\' party messages list both members');
    await A.waitSince(mA, (e) => e.type === 'chat' && e.from === 'Game' && e.text === 'S7BBob joined the party.', 10000, 'party joined chat');
    console.log('PASS party accept: members were told "S7BBob joined the party."');
    const snap = (await A.waitSince(mA, (e) => e.type === 'state'
      && e.players.some((x) => x.username === 'S7BAlice' && sameSet(x.party || [], ['S7BAlice', 'S7BBob']))
      && e.players.some((x) => x.username === 'S7BBob' && sameSet(x.party || [], ['S7BAlice', 'S7BBob'])),
      10000, 'state snapshot party')).e;
    assert(!!snap, 'party accept: the state snapshot shows the party on both player entries');

    await expectError(A, { type: 'party_invite', target: 'S7BBob' }, 'party invite existing member');
    console.log('PASS party: inviting an existing member is rejected');

    // Leave: a 2-person party dissolves, both sides end partyless.
    mA = A.mark(); mB = B.mark();
    B.send({ type: 'party_leave' });
    const leftB = (await B.waitSince(mB, (e) => e.type === 'party' && e.members.length === 0, 10000, 'party leave B')).e;
    const leftA = (await A.waitSince(mA, (e) => e.type === 'party' && e.members.length === 0, 10000, 'party leave A')).e;
    assert(leftB.members.length === 0 && leftA.members.length === 0, 'party leave: a 2-person party dissolves for both sides');
    await A.waitSince(mA, (e) => e.type === 'chat' && e.from === 'Game' && e.text === 'S7BBob left the party.', 10000, 'party left chat');
    console.log('PASS party leave: the remaining member was notified');

    // Disconnect removes a member the same way.
    mA = A.mark(); mB = B.mark();
    A.send({ type: 'party_invite', target: 'S7BBob' });
    await B.waitSince(mB, (e) => e.type === 'party_invite', 10000, 'party_invite B (re-form)');
    B.send({ type: 'party_reply', accept: true });
    await A.waitSince(mA, (e) => e.type === 'party' && e.members.length === 2, 10000, 'party re-formed');
    mA = A.mark();
    B.close();
    await A.waitSince(mA, (e) => e.type === 'party' && e.members.length === 0, 10000, 'party after disconnect');
    console.log('PASS party disconnect: the member was removed and the party dissolved');
    await sleep(500); // let the server fully drop B before trades re-use the name slot
    const B2 = await (async () => {
      const d = await api('/api/login', { username: 'S7BBob', password: 's7b-b-pass' });
      const c = new Client('S7BBob');
      await c.connect(d.token);
      await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome (B relogin)');
      return c;
    })();
    clients.push(B2);

    // ---------- Trade setup: buy the traded items from shops ----------
    let mBuy = A.mark();
    A.send({ type: 'shop_buy', item: 'ration', qty: 2 });
    let profA = await waitProfile(A, mBuy, (x) => qty(x, 'ration') === 2, 'A buys rations');
    assert(profA.gold === 84 && qty(profA, 'ration') === 2, `trade setup: A has 84g + 2 rations (gold ${profA.gold})`);
    mBuy = B2.mark();
    B2.send({ type: 'shop_buy', item: 'prayer_potion', qty: 1 });
    let profB = await waitProfile(B2, mBuy, (x) => qty(x, 'prayer_potion') === 1, 'B buys potion');
    B2.send({ type: 'shop_buy', item: 'ration', qty: 1 });
    profB = await waitProfile(B2, mBuy, (x) => qty(x, 'ration') === 1, 'B buys ration');
    assert(profB.gold === 77 && qty(profB, 'prayer_potion') === 1 && qty(profB, 'ration') === 1,
      `trade setup: B has 77g + 1 prayer potion + 1 ration (gold ${profB.gold})`);

    // ---------- Trade: request errors + decline ----------
    await expectError(A, { type: 'trade_request', target: 'S7BAlice' }, 'trade request self');
    console.log('PASS trade: requesting a trade with yourself is rejected');
    await expectError(A, { type: 'trade_request', target: 'GhostName' }, 'trade request offline');
    console.log('PASS trade: requesting a trade with an offline player is rejected');

    mA = A.mark(); mC = C.mark();
    A.send({ type: 'trade_request', target: 'S7BCara' });
    const incC = (await C.waitSince(mC, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming C')).e;
    assert(incC.from === 'S7BAlice' && !!incC.tradeId, 'trade: the target receives trade_incoming with a tradeId');
    C.send({ type: 'trade_response', tradeId: incC.tradeId, accept: false });
    await A.waitSince(mA, (e) => e.type === 'chat' && e.from === 'Game' && e.text === 'S7BCara declined your trade request.', 10000, 'trade decline note');
    console.log('PASS trade decline: the requester was notified');
    assert(!A.events.slice(mA).some((e) => e.type === 'trade_open'), 'trade decline: no trade opened');

    // ---------- Trade: the full swap ----------
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_request', target: 'S7BBob' });
    const incB = (await B2.waitSince(mB, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming B')).e;
    B2.send({ type: 'trade_response', tradeId: incB.tradeId, accept: true });
    const openA = (await A.waitSince(mA, (e) => e.type === 'trade_open', 10000, 'trade_open A')).e;
    const openB = (await B2.waitSince(mB, (e) => e.type === 'trade_open', 10000, 'trade_open B')).e;
    assert(openA.with === 'S7BBob' && openB.with === 'S7BAlice' && openA.tradeId === openB.tradeId,
      'trade accept: both sides got trade_open naming the other player');
    const tid = openA.tradeId;

    // Offer validation: more gold than held is rejected, never stored.
    const errOverGold = await expectError(A, { type: 'trade_offer', tradeId: tid, gold: 9999, items: [] }, 'offer over gold');
    assert(errOverGold.message === 'You don\'t have that much gold.', `trade offer: over-gold rejected ("${errOverGold.message}")`);
    const errOverItems = await expectError(A, { type: 'trade_offer', tradeId: tid, gold: 0, items: [{ item: 'ration', qty: 5 }] }, 'offer over items');
    assert(!!errOverItems.message, `trade offer: offering 5 rations while holding 2 is rejected ("${errOverItems.message}")`);

    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_offer', tradeId: tid, gold: 10, items: [{ item: 'ration', qty: 1 }] });
    const updA = (await A.waitSince(mA, (e) => e.type === 'trade_update', 10000, 'trade_update A (own offer)')).e;
    const updB = (await B2.waitSince(mB, (e) => e.type === 'trade_update', 10000, 'trade_update B (relayed offer)')).e;
    assert(updA.you.gold === 10 && updA.you.items.length === 1 && updA.you.items[0].item === 'ration' && updA.them.gold === 0,
      'trade offer: my view shows my offer as `you`');
    assert(updB.them.gold === 10 && updB.them.items.length === 1 && updB.them.items[0].item === 'ration' && updB.you.gold === 0,
      'trade offer: the partner\'s view shows the same offer as `them`');
    assert(![...A.events, ...B2.events].some((e) => e.type === 'trade_update' && (e.you.gold === 9999 || e.them.gold === 9999)),
      'trade offer: no stored offer ever exceeded holdings (9999 never appeared)');

    B2.send({ type: 'trade_offer', tradeId: tid, gold: 5, items: [{ item: 'prayer_potion', qty: 1 }] });
    const updB2 = (await B2.waitSince(mB, (e) => e.type === 'trade_update' && e.you.gold === 5, 10000, 'trade_update B (own offer)')).e;
    assert(updB2.you.items.length === 1 && updB2.you.items[0].item === 'prayer_potion' && updB2.them.gold === 10,
      'trade offer: B\'s offer (5g + prayer potion) is stored and relayed');

    // One-sided confirm does NOT swap.
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_confirm', tradeId: tid });
    const confA = (await A.waitSince(mA, (e) => e.type === 'trade_update' && e.youConfirmed === true, 10000, 'confirm update A')).e;
    const confB = (await B2.waitSince(mB, (e) => e.type === 'trade_update' && e.themConfirmed === true, 10000, 'confirm update B')).e;
    assert(confA.youConfirmed === true && confA.themConfirmed === false && confB.themConfirmed === true && confB.youConfirmed === false,
      'trade confirm: one side confirmed, the other not — flags relayed per-view');
    await sleep(700);
    assert(!A.events.slice(mA).some((e) => e.type === 'trade_done') && !B2.events.slice(mB).some((e) => e.type === 'trade_done'),
      'trade confirm: one-sided confirm did not execute a swap');
    assert(A.profile().gold === 84 && B2.profile().gold === 77, 'trade confirm: gold untouched before both confirm');

    // Changing an offer un-confirms BOTH sides (anti-scam).
    mA = A.mark(); mB = B2.mark();
    B2.send({ type: 'trade_offer', tradeId: tid, gold: 6, items: [{ item: 'prayer_potion', qty: 1 }] });
    const unconf = (await A.waitSince(mA, (e) => e.type === 'trade_update' && e.them.gold === 6, 10000, 'un-confirm update')).e;
    assert(unconf.youConfirmed === false && unconf.themConfirmed === false,
      'trade offer change: BOTH sides were un-confirmed when B changed the offer');

    // Restore B's intended offer, confirm both, swap is exact.
    B2.send({ type: 'trade_offer', tradeId: tid, gold: 5, items: [{ item: 'prayer_potion', qty: 1 }] });
    await B2.waitSince(mB, (e) => e.type === 'trade_update' && e.you.gold === 5 && e.youConfirmed === false, 10000, 'offer restored');
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_confirm', tradeId: tid });
    B2.send({ type: 'trade_confirm', tradeId: tid });
    const doneA = (await A.waitSince(mA, (e) => e.type === 'trade_done', 10000, 'trade_done A')).e;
    const doneB = (await B2.waitSince(mB, (e) => e.type === 'trade_done', 10000, 'trade_done B')).e;
    assert(doneA.ok === true && doneA.with === 'S7BBob' && doneB.ok === true && doneB.with === 'S7BAlice',
      'trade swap: both sides got trade_done ok:true naming the other');
    profA = A.profile(); profB = B2.profile();
    assert(profA.gold === 79 && qty(profA, 'ration') === 1 && qty(profA, 'prayer_potion') === 1,
      `trade swap: A paid 10g + 1 ration, received 5g + 1 prayer potion (gold ${profA.gold}, ration ${qty(profA, 'ration')}, potion ${qty(profA, 'prayer_potion')})`);
    assert(profB.gold === 82 && qty(profB, 'ration') === 2 && qty(profB, 'prayer_potion') === 0,
      `trade swap: B paid 5g + 1 prayer potion, received 10g + 1 ration (gold ${profB.gold}, ration ${qty(profB, 'ration')}, potion ${qty(profB, 'prayer_potion')})`);
    assert(profA.gold + profB.gold === 161 && qty(profA, 'ration') + qty(profB, 'ration') === 3
      && qty(profA, 'prayer_potion') + qty(profB, 'prayer_potion') === 1,
      'trade swap: gold and items are exactly conserved across both players');

    // ---------- Trade: insufficient at confirm falls through ----------
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_request', target: 'S7BBob' });
    const inc2 = (await B2.waitSince(mB, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming 2')).e;
    B2.send({ type: 'trade_response', tradeId: inc2.tradeId, accept: true });
    const open2 = (await A.waitSince(mA, (e) => e.type === 'trade_open', 10000, 'trade_open 2')).e;
    const tid2 = open2.tradeId;
    A.send({ type: 'trade_offer', tradeId: tid2, gold: 50, items: [] });
    await A.waitSince(mA, (e) => e.type === 'trade_update' && e.you.gold === 50, 10000, 'offer 50g stored');
    B2.send({ type: 'trade_confirm', tradeId: tid2 });
    await B2.waitSince(mB, (e) => e.type === 'trade_update' && e.youConfirmed === true, 10000, 'B confirms trade 2');
    // A spends the offered gold elsewhere (5 rations = 40g: 79 -> 39).
    const mSpend = A.mark();
    A.send({ type: 'shop_buy', item: 'ration', qty: 5 });
    profA = await waitProfile(A, mSpend, (x) => x.gold === 39, 'A spends offered gold');
    assert(profA.gold === 39 && qty(profA, 'ration') === 6, 'trade fall-through setup: A now holds 39g (offered 50) and 6 rations');
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_confirm', tradeId: tid2 });
    const fallA = (await A.waitSince(mA, (e) => e.type === 'trade_done', 10000, 'fall-through A')).e;
    const fallB = (await B2.waitSince(mB, (e) => e.type === 'trade_done', 10000, 'fall-through B')).e;
    assert(fallA.ok === false && fallB.ok === false
      && fallA.reason === 'The trade fell through — an item or the gold was no longer there.',
      `trade fall-through: both sides got ok:false with the exact reason ("${fallA.reason}")`);
    assert(A.profile().gold === 39 && B2.profile().gold === 82
      && qty(A.profile(), 'ration') === 6 && qty(B2.profile(), 'ration') === 2,
      'trade fall-through: nothing moved for either player');

    // ---------- Trade: cancel mid-trade notifies the other side ----------
    mA = A.mark(); mC = C.mark();
    A.send({ type: 'trade_request', target: 'S7BCara' });
    const inc3 = (await C.waitSince(mC, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming 3')).e;
    C.send({ type: 'trade_response', tradeId: inc3.tradeId, accept: true });
    const open3 = (await A.waitSince(mA, (e) => e.type === 'trade_open', 10000, 'trade_open 3')).e;
    A.send({ type: 'trade_offer', tradeId: open3.tradeId, gold: 1, items: [] });
    await A.waitSince(mA, (e) => e.type === 'trade_update' && e.you.gold === 1, 10000, 'offer before cancel');
    mA = A.mark();
    C.send({ type: 'trade_cancel', tradeId: open3.tradeId });
    const cancelA = (await A.waitSince(mA, (e) => e.type === 'trade_done', 10000, 'cancel notice A')).e;
    assert(cancelA.ok === false && cancelA.reason === 'Trade cancelled.',
      `trade cancel: the OTHER side was notified ("${cancelA.reason}")`);
    assert(A.profile().gold === 39, 'trade cancel: no gold moved');

    // ---------- Starting a duel cancels an open trade first ----------
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'trade_request', target: 'S7BBob' });
    const inc4 = (await B2.waitSince(mB, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming 4')).e;
    B2.send({ type: 'trade_response', tradeId: inc4.tradeId, accept: true });
    await A.waitSince(mA, (e) => e.type === 'trade_open', 10000, 'trade_open 4');
    mA = A.mark(); mB = B2.mark();
    A.send({ type: 'challenge', target: 'S7BBob', stake: 1 });
    const chInc = (await B2.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge during trade')).e;
    B2.send({ type: 'challenge_response', challengeId: chInc.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm,
    // and the duel start (which cancels the trade) happens then.
    A.send({ type: 'challenge_confirm', challengeId: chInc.challengeId });
    B2.send({ type: 'challenge_confirm', challengeId: chInc.challengeId });
    const duelStart = await A.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start after trade');
    const tradeDoneIdx = A.events.slice(mA).findIndex((e) => e.type === 'trade_done' && e.ok === false);
    assert(tradeDoneIdx !== -1 && mA + tradeDoneIdx < duelStart.idx,
      'duel start: the open trade was cancelled (trade_done) before the duel began');
    B2.close();
    const duelEnd = (await A.waitSince(mA, (e) => e.type === 'duel_end', 20000, 'duel_end forfeit')).e;
    assert(duelEnd.winner === 'S7BAlice', 'duel start: the duel itself then ran and settled by forfeit');

    for (const c of clients) c.close();
    console.log('ALL STAGE 7B TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
