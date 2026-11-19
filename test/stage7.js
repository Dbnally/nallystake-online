// Stage 7A tests: roles & permissions (owner 'nally', admin, mod,
// player), admin role/style management, the NC / Certificate token
// items, mod certification (+1 NC), mod-run official fights (1 NC,
// winner earns a Certificate) and the certificate exchange (250g).
//
// Same harness style as test/stage6.js: HTTP /api/register +
// /api/login for accounts, WebSocket at /ws?token=..., a fresh
// disposable DB file so the literal owner name 'nally' can register.
//
// The official duel is ended by forfeit (one fighter disconnects —
// the server's close handler settles it), the fastest honest way to
// reach endDuel; the winner is then the fighter who stayed online.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18088;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage7.json');
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

async function main() {
  // Source-level checks (stage5 style): the token definitions and the
  // owner rule live in the catalog / role helper, not in any message.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/ITEMS\.nc = \{[^}]*kind: 'token'/.test(src), "source: nc is defined with kind 'token'");
  assert(/ITEMS\.certificate = \{[^}]*kind: 'token'/.test(src), "source: certificate is defined with kind 'token'");
  assert(/ITEMS\.nc = \{[^}]*sellOnly: 0/.test(src) && /ITEMS\.certificate = \{[^}]*sellOnly: 0/.test(src),
    'source: both tokens are unsellable (sellOnly 0, like fire_cape)');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Roles: defaults + the owner ----------
    const nally = await register('nally', 'owner-pass-7');
    clients.push(nally);
    assert(nally.profile().role === 'owner', `roles: account 'nally' has effective role 'owner' (got ${nally.profile().role})`);
    assert(nally.profile().certified === false, 'roles: nally starts uncertified (flag present, false)');

    const play = await register('S7Play', 's7-play-pass');
    clients.push(play);
    assert(play.profile().role === 'player' && play.profile().certified === false,
      'roles: a fresh profile defaults to role player, certified false');

    const admin = await register('S7Admin', 's7-admin-pass');
    const admin2 = await register('S7Admin2', 's7-admin2-pass');
    const mod = await register('S7Mod', 's7-mod-pass');
    const fightA = await register('S7FightA', 's7-fa-pass');
    const fightB = await register('S7FightB', 's7-fb-pass');
    clients.push(admin, admin2, mod, fightA, fightB);
    for (const c of [admin, admin2, mod, fightA, fightB]) {
      assert(c.profile().role === 'player', `roles: ${c.name} also starts as a plain player`);
    }

    // Leaderboard carries the effective role.
    const lbRes = await fetch(BASE + '/api/leaderboard');
    const lb = (await lbRes.json()).leaderboard;
    assert(lb.find((r) => r.username === 'nally').role === 'owner', 'leaderboard: nally listed with role owner');
    assert(lb.find((r) => r.username === 'S7Play').role === 'player', 'leaderboard: S7Play listed with role player');

    // State snapshots carry the effective role.
    await sleep(500);
    const lastState = [...nally.events].reverse().find((e) => e.type === 'state');
    assert(lastState && lastState.players.find((p) => p.username === 'nally').role === 'owner',
      'state snapshot: nally carries role owner');
    assert(lastState.players.find((p) => p.username === 'S7Mod').role === 'player',
      'state snapshot: S7Mod carries role player (before promotion)');

    // ---------- set_role: permission matrix ----------
    const errPlay = await expectError(play, { type: 'set_role', target: 'S7Mod', role: 'mod' }, 'player set_role');
    assert(!!errPlay.message, `set_role: a player sender is rejected ("${errPlay.message}")`);

    // Owner promotes the mod.
    let mOwner = nally.mark(); let mMod = mod.mark();
    nally.send({ type: 'set_role', target: 'S7Mod', role: 'mod' });
    await nally.waitSince(mOwner, (e) => e.type === 'admin_note' && e.text.includes("S7Mod's role to mod"), 10000, 'owner set_role note');
    const modProf = await waitProfile(mod, mMod, (p) => p.role === 'mod', 'mod role profile');
    assert(modProf.role === 'mod', 'set_role: owner set S7Mod to mod (target profile pushed)');

    const errMod = await expectError(mod, { type: 'set_role', target: 'S7Play', role: 'mod' }, 'mod set_role');
    assert(!!errMod.message, `set_role: a mod sender is rejected ("${errMod.message}")`);

    // Owner creates two admins.
    for (const [adm, name] of [[admin, 'S7Admin'], [admin2, 'S7Admin2']]) {
      const mA = adm.mark(); const mO = nally.mark();
      nally.send({ type: 'set_role', target: name, role: 'admin' });
      await nally.waitSince(mO, (e) => e.type === 'admin_note' && e.text.includes(`${name}'s role to admin`), 10000, `owner set ${name} admin`);
      const p = await waitProfile(adm, mA, (x) => x.role === 'admin', `${name} admin profile`);
      assert(p.role === 'admin', `set_role: owner can set admin (${name} is admin)`);
    }

    // Admin can set mod and player.
    let mPlay = play.mark();
    admin.send({ type: 'set_role', target: 'S7Play', role: 'mod' });
    assert((await waitProfile(play, mPlay, (p) => p.role === 'mod', 'admin sets mod')).role === 'mod',
      'set_role: admin can set a player to mod');
    mPlay = play.mark();
    admin.send({ type: 'set_role', target: 'S7Play', role: 'player' });
    assert((await waitProfile(play, mPlay, (p) => p.role === 'player', 'admin sets player')).role === 'player',
      'set_role: admin can set a mod back to player');

    // Admin can NOT create admins, touch admins, or touch the owner.
    const errMkAdmin = await expectError(admin, { type: 'set_role', target: 'S7Play', role: 'admin' }, 'admin creates admin');
    assert(!!errMkAdmin.message, `set_role: admin cannot create an admin ("${errMkAdmin.message}")`);
    const errTouchAdmin = await expectError(admin, { type: 'set_role', target: 'S7Admin2', role: 'player' }, 'admin touches admin');
    assert(!!errTouchAdmin.message, `set_role: admin cannot change another admin ("${errTouchAdmin.message}")`);
    const errTouchOwner = await expectError(admin, { type: 'set_role', target: 'nally', role: 'player' }, 'admin touches owner');
    assert(!!errTouchOwner.message, `set_role: admin cannot change the owner ("${errTouchOwner.message}")`);
    assert(admin2.profile().role === 'admin' && play.profile().role === 'player',
      'set_role: the rejected admin attempts changed nothing');

    // ---------- set_role + spawn_item on an OFFLINE account ----------
    const off = await register('S7Off', 's7-off-pass');
    off.close();
    await sleep(600); // let the server drop the session
    mOwner = nally.mark();
    nally.send({ type: 'set_role', target: 'S7Off', role: 'mod' });
    await nally.waitSince(mOwner, (e) => e.type === 'admin_note' && e.text.includes("S7Off's role to mod"), 10000, 'owner set_role offline');
    console.log('PASS set_role: works on an offline account');

    // ---------- admin_list / online_list ----------
    const mAdm = admin.mark();
    admin.send({ type: 'admin_list' });
    const adminList = (await admin.waitSince(mAdm, (e) => e.type === 'admin_list', 10000, 'admin_list')).e;
    const rowNally = adminList.players.find((p) => p.username === 'nally');
    const rowOff = adminList.players.find((p) => p.username === 'S7Off');
    const rowMod = adminList.players.find((p) => p.username === 'S7Mod');
    assert(rowNally.role === 'owner' && rowNally.online === true, 'admin_list: nally is owner, online');
    assert(rowOff.role === 'mod' && rowOff.online === false, 'admin_list: offline S7Off is mod, online=false (all accounts covered)');
    assert(rowMod.role === 'mod' && rowMod.certified === false, 'admin_list: S7Mod is an uncertified mod');
    await expectError(play, { type: 'admin_list' }, 'player admin_list');
    console.log('PASS admin_list: a player sender is rejected');

    const mModList = mod.mark();
    mod.send({ type: 'online_list' });
    const onlineList = (await mod.waitSince(mModList, (e) => e.type === 'online_list', 10000, 'online_list')).e;
    assert(onlineList.players.some((p) => p.username === 'S7FightA' && p.area === 'plaza' && p.role === 'player'),
      'online_list: a mod can list online players with area + role');
    assert(!onlineList.players.some((p) => p.username === 'S7Off'), 'online_list: offline accounts are not listed');
    await expectError(play, { type: 'online_list' }, 'player online_list');
    console.log('PASS online_list: a player sender is rejected');

    // ---------- set_style_admin ----------
    const errStyle = await expectError(mod, { type: 'set_style_admin', target: 'S7FightA', style: 'aggressive' }, 'mod set_style_admin');
    assert(!!errStyle.message, `set_style_admin: a mod sender is rejected ("${errStyle.message}")`);
    const mFightA = fightA.mark();
    admin.send({ type: 'set_style_admin', target: 'S7FightA', style: 'aggressive' });
    const styled = await waitProfile(fightA, mFightA, (p) => p.style === 'aggressive', 'admin-set style profile');
    assert(styled.style === 'aggressive', 'set_style_admin: admin set S7FightA to aggressive (target profile pushed)');

    // ---------- spawn_item ----------
    const errSpawn = await expectError(fightA, { type: 'spawn_item', item: 'ration', qty: 1 }, 'player spawn_item');
    assert(!!errSpawn.message, `spawn_item: a player sender is rejected ("${errSpawn.message}")`);
    let mAdminSpawn = admin.mark();
    admin.send({ type: 'spawn_item', item: 'ration', qty: 2 });
    const spawnedSelf = await waitProfile(admin, mAdminSpawn, (p) => qty(p, 'ration') === 2, 'admin spawn to self');
    assert(qty(spawnedSelf, 'ration') === 2, 'spawn_item: admin spawned 2 rations for themselves');
    mAdminSpawn = admin.mark();
    admin.send({ type: 'spawn_item', item: 'logs', qty: 3, target: 'S7Off' });
    await admin.waitSince(mAdminSpawn, (e) => e.type === 'admin_note' && e.text.includes('Spawned 3 x Logs for S7Off'), 10000, 'admin spawn offline note');
    console.log('PASS spawn_item: admin spawned items for an offline target');
    const off2 = await login('S7Off', 's7-off-pass');
    clients.push(off2);
    assert(off2.profile().role === 'mod', 'set_role offline: S7Off logs in as a mod');
    assert(qty(off2.profile(), 'logs') === 3, 'spawn_item offline: S7Off logs in holding the 3 spawned Logs');

    // ---------- run_fight: uncertified mod is rejected ----------
    const mFA0 = fightA.mark(); const mFB0 = fightB.mark();
    const errRun = await expectError(mod, { type: 'run_fight', a: 'S7FightA', b: 'S7FightB' }, 'uncertified run_fight');
    assert(!!errRun.message, `run_fight: an uncertified mod is rejected ("${errRun.message}")`);
    await sleep(400);
    assert(!fightA.events.slice(mFA0).some((e) => e.type === 'fight_offer') && !fightB.events.slice(mFB0).some((e) => e.type === 'fight_offer'),
      'run_fight: the rejected run sent no fight offers');

    // ---------- certify ----------
    const errCertTarget = await expectError(admin, { type: 'certify', target: 'S7Play' }, 'certify non-mod');
    assert(!!errCertTarget.message, `certify: a non-mod target is rejected ("${errCertTarget.message}")`);
    const errCertSender = await expectError(mod, { type: 'certify', target: 'S7Off' }, 'certify by mod');
    assert(!!errCertSender.message, `certify: a mod sender is rejected ("${errCertSender.message}")`);

    const mCertMod = mod.mark(); const mCertAdm = admin.mark();
    admin.send({ type: 'certify', target: 'S7Mod' });
    const certProf = await waitProfile(mod, mCertMod, (p) => p.certified === true, 'certified profile');
    assert(certProf.certified === true && qty(certProf, 'nc') === 1,
      `certify: S7Mod is certified with exactly +1 NC (nc=${qty(certProf, 'nc')})`);
    await admin.waitSince(mCertAdm, (e) => e.type === 'chat' && e.from === 'Game'
      && e.text === '⭐ S7Mod was certified by S7Admin (+1 NC).', 10000, 'certify broadcast');
    console.log('PASS certify: the Game broadcast announced the certification');

    // ---------- Tokens can never be sold ----------
    const errShopSell = await expectError(mod, { type: 'shop_sell', item: 'nc', qty: 1 }, 'shop_sell nc');
    assert(errShopSell.message === "That can't be sold.", `tokens: shop_sell nc -> "${errShopSell.message}"`);
    const errExSell = await expectError(mod, { type: 'exchange_sell', good: 'nc', qty: 1 }, 'exchange_sell nc');
    assert(errExSell.message === "That can't be sold.", `tokens: exchange_sell nc -> "${errExSell.message}"`);
    const errShopBuy = await expectError(mod, { type: 'shop_buy', item: 'nc', qty: 1 }, 'shop_buy nc');
    assert(!!errShopBuy.message && qty(mod.profile(), 'nc') === 1, 'tokens: nc is not buyable in shops (balance unchanged)');

    // ---------- run_fight: decline path spends nothing ----------
    let mRun = mod.mark(); let mA = fightA.mark(); let mB = fightB.mark();
    mod.send({ type: 'run_fight', a: 'S7FightA', b: 'S7FightB' });
    const offerA = (await fightA.waitSince(mA, (e) => e.type === 'fight_offer', 10000, 'fight_offer A')).e;
    const offerB = (await fightB.waitSince(mB, (e) => e.type === 'fight_offer', 10000, 'fight_offer B')).e;
    assert(offerA.from === 'S7Mod' && offerA.opponent === 'S7FightB', 'run_fight: fighter A was offered a fight vs B, run by S7Mod');
    assert(offerB.from === 'S7Mod' && offerB.opponent === 'S7FightA', 'run_fight: fighter B was offered a fight vs A, run by S7Mod');
    fightB.send({ type: 'fight_reply', accept: false });
    await mod.waitSince(mRun, (e) => (e.type === 'chat' || e.type === 'admin_note') && (e.text || '').includes('declined the official fight'), 10000, 'runner decline note');
    await fightA.waitSince(mA, (e) => e.type === 'chat' && (e.text || '').includes('declined the official fight'), 10000, 'other fighter decline note');
    console.log('PASS run_fight decline: runner and the other fighter were notified');
    assert(!fightA.events.slice(mA).some((e) => e.type === 'duel_start') && !fightB.events.slice(mB).some((e) => e.type === 'duel_start'),
      'run_fight decline: no duel started');
    const mModRefresh = mod.mark();
    mod.send({ type: 'style', style: 'accurate' }); // any profile reply shows the balance
    const modAfterDecline = await waitProfile(mod, mModRefresh, () => true, 'mod profile after decline');
    assert(qty(modAfterDecline, 'nc') === 1, 'run_fight decline: the runner still holds exactly 1 NC (nothing spent)');

    // ---------- run_fight: accept path runs an official duel ----------
    mRun = mod.mark(); mA = fightA.mark(); mB = fightB.mark();
    mod.send({ type: 'run_fight', a: 'S7FightA', b: 'S7FightB' });
    await fightA.waitSince(mA, (e) => e.type === 'fight_offer', 10000, 'fight_offer A (accept run)');
    await fightB.waitSince(mB, (e) => e.type === 'fight_offer', 10000, 'fight_offer B (accept run)');
    fightA.send({ type: 'fight_reply', accept: true });
    fightB.send({ type: 'fight_reply', accept: true });
    const startA = (await fightA.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'official duel_start A')).e;
    const startB = (await fightB.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'official duel_start B')).e;
    assert(startA.stake === 0 && startA.pot === 0 && startB.stake === 0, 'run_fight accept: the duel is zero-stake');
    assert(startA.official && startA.official.runner === 'S7Mod', 'run_fight accept: the duel is flagged official, run by S7Mod');
    const modAfterSpend = await waitProfile(mod, mRun, (p) => qty(p, 'nc') === 0, 'runner NC deducted');
    assert(qty(modAfterSpend, 'nc') === 0, 'run_fight accept: exactly 1 NC was deducted from the runner');

    // End it by forfeit: fighter A disconnects, fighter B wins.
    const goldBBefore = fightB.profile().gold;
    fightA.close();
    const endB = (await fightB.waitSince(mB, (e) => e.type === 'duel_end', 20000, 'official duel_end')).e;
    assert(endB.winner === 'S7FightB', `run_fight accept: the forfeit settled on the remaining fighter (winner ${endB.winner})`);
    assert(qty(endB.profile, 'certificate') === 1, 'official duel: the winner gained exactly 1 Certificate');
    // Stage 20 (flagged fix): the duel itself is still zero-stake,
    // but the winner's first-ever duel win also banks the one-time
    // +25g "Win a duel" starter-goal reward.
    assert(endB.profile.gold === goldBBefore + 25, `official duel: zero-stake — the winner's gold moved only by the +25g starter reward (${endB.profile.gold}g)`);
    await mod.waitSince(mRun, (e) => e.type === 'chat' && e.from === 'Game'
      && e.text === '🏆 S7FightB won the official fight run by S7Mod and earned a Certificate!', 10000, 'official win broadcast');
    console.log('PASS official duel: the win broadcast named the winner and the runner');

    // ---------- exchange_cert: no admin online ----------
    nally.close(); admin.close(); admin2.close();
    await sleep(800); // sessions drop server-side
    const errNoAdmin = await expectError(fightB, { type: 'exchange_cert' }, 'exchange with no admin online');
    assert(errNoAdmin.message === 'No admin is online right now.', `exchange_cert: no-admin error is exact ("${errNoAdmin.message}")`);
    assert(qty(fightB.profile(), 'certificate') === 1, 'exchange_cert: the failed exchange kept the Certificate');

    // ---------- exchange_cert: admin accepts -> -1 cert, +250g ----------
    const adminBack = await login('S7Admin', 's7-admin-pass');
    clients.push(adminBack);
    const goldBeforeEx = fightB.profile().gold;
    const mFB = fightB.mark(); const mAdm2 = adminBack.mark(); const mMod2 = mod.mark();
    fightB.send({ type: 'exchange_cert' });
    const certReq = (await adminBack.waitSince(mAdm2, (e) => e.type === 'cert_request', 10000, 'cert_request')).e;
    assert(certReq.from === 'S7FightB', 'exchange_cert: the online admin received the cert_request');
    adminBack.send({ type: 'cert_reply', from: 'S7FightB', accept: true });
    const afterEx = await waitProfile(fightB, mFB, (p) => qty(p, 'certificate') === 0, 'profile after exchange');
    assert(qty(afterEx, 'certificate') === 0, 'exchange_cert: exactly 1 Certificate was removed');
    assert(afterEx.gold === goldBeforeEx + 250, `exchange_cert: gold rose by exactly 250 (${goldBeforeEx} -> ${afterEx.gold})`);
    await mod.waitSince(mMod2, (e) => e.type === 'chat' && e.from === 'Game'
      && e.text === '📜 S7FightB exchanged a Certificate with S7Admin for 250g.', 10000, 'exchange broadcast');
    console.log('PASS exchange_cert: the Game broadcast announced the exchange');
    const errDouble = await expectError(adminBack, { type: 'cert_reply', from: 'S7FightB', accept: true }, 'second cert_reply');
    assert(!!errDouble.message && fightB.profile().gold === goldBeforeEx + 250,
      'exchange_cert: a second admin reply cannot pay out twice');

    // ---------- Demoting a certified mod clears certification ----------
    const nallyBack = await login('nally', 'owner-pass-7');
    clients.push(nallyBack);
    const mDemote = mod.mark();
    nallyBack.send({ type: 'set_role', target: 'S7Mod', role: 'player' });
    const demoted = await waitProfile(mod, mDemote, (p) => p.role === 'player', 'demoted profile');
    assert(demoted.role === 'player' && demoted.certified === false,
      'set_role: moving a certified mod to player clears certified');

    for (const c of clients) c.close();
    console.log('ALL STAGE 7A TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
