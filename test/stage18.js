// Stage 18 tests: the No Movement duel rule (Part C's server half).
// Parts A (login activity picker), B (menu-tap mode), D (Grab mode)
// and E (camera POV) are client-only — they are covered here by
// source/wiring asserts on public/index.html, the same way stage15
// source-asserts its client toggle.
//   (1) a noMovement duel: both fighters' move messages after the
//       countdown leave them at the duel-start spots (787,450) /
//       (813,450) — Stage 26 moved No Movement spawns toe-to-toe,
//       ~26 apart — swings still land (HP drops), and the duel can
//       finish (forfeit by disconnect, as in stage12 (a)).
//   (2) a normal duel: after the countdown a move DOES take effect.
//   (3) terms round-trip: noMovement set via challenge_update shows
//       in the pushed challenge_terms for both sides and lands in
//       duel_start.rules once both confirm.
// Same harness style as test/stage15.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18118;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage18.json');
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
  await sleep(400);
  await new Promise((resolve) => { p.once('exit', resolve); p.kill('SIGTERM'); setTimeout(resolve, 5000); });
  await sleep(300);
}
function seedDb(mutator) {
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  mutator(data);
  fs.writeFileSync(DB_FILE, JSON.stringify(data));
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
// Drives a challenge from send to duel_start with bare confirms
// (the stage14/15 flow). Returns { inc, startA, startB }.
async function startDuel(A, B, opts) {
  const mA = A.mark(), mB = B.mark();
  A.send({ type: 'challenge', target: B.name, stake: 1, ...(opts || {}) });
  const inc = (await B.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming')).e;
  B.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  A.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  B.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  const startA = (await A.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start (challenger)')).e;
  const startB = (await B.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'duel_start (target)')).e;
  return { inc, startA, startB };
}
async function waitCountdownOver(c, label) {
  await c.waitSince(0, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 20000, label);
}
// Sends a move and asserts the mover's position in the state
// snapshot the server broadcasts in reply (the stage12 pattern).
async function assertPosAfterMove(c, name, x, y, wantX, wantY, label) {
  const m = c.mark();
  c.send({ type: 'move', x, y });
  const snap = (await c.waitSince(m, (e) => e.type === 'state' && e.players.some((p) => p.username === name), 10000, 'state after move')).e;
  const pos = snap.players.find((p) => p.username === name);
  assert(pos.x === wantX && pos.y === wantY, `${label} (got ${pos.x},${pos.y}, wanted ${wantX},${wantY})`);
}

const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const PW = (n) => 's18-pass-' + n;
const NAMES = ['S18Ann', 'S18Bob', 'S18Cid', 'S18Dee', 'S18Eli', 'S18Fay'];

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/'noMovement'\]/.test(src) || /noMovement/.test(src), 'source: noMovement exists in server.js');
  assert(/duelNow\.rules && duelNow\.rules\.noMovement/.test(src), 'source: the move handler checks rules.noMovement');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  // Part A wiring: the login activity picker.
  assert(/maybeShowActivityPicker/.test(clientSrc) && /pickActivity/.test(clientSrc) && /activitymodal/.test(clientSrc), 'source (A): client has the login activity picker');
  assert(/STAKE_SIGN_POS\.x\+50/.test(clientSrc), 'source (A): Dueling stands the player next to the Stake Board sign');
  // Part B wiring: menu-tap mode in the world tap + backpack tap.
  assert(/settings\.tapMode==='menu'/.test(clientSrc) && /railmenutap/.test(clientSrc), 'source (B): client has the menu-tap toggle (chip + setting)');
  assert(/handleLongPress\(cx,cy\)/.test(clientSrc), 'source (B): menu-mode taps route to the long-press menus');
  // Part C wiring: the remodelled sheet + the new rule row.
  assert(/Dueling with:/.test(clientSrc) && /chalGearHTML/.test(clientSrc), 'source (C): client has the "Dueling with:" sheet with the gear figure');
  assert(/\['noMovement','No Movement'\]/.test(clientSrc), 'source (C): the sheet has the No Movement rule row');
  assert(/duelnomove/.test(clientSrc), 'source (C): the fight strip has the No Movement chip');
  // Part D wiring: Grab replaced Clear/hold-drag.
  assert(/railgrab/.test(clientSrc) && /grabMode/.test(clientSrc), 'source (D): client has the Grab toggle');
  assert(!/railclear/.test(clientSrc) && !/wireHoldDrag/.test(clientSrc), 'source (D): the Clear chip and hold-drag are gone');
  // Part E wiring: the camera POV.
  assert(/camPov/.test(clientSrc) && /railcam/.test(clientSrc), 'source (E): client has the camera POV toggle');
  assert(/settings\.camPov==='first'/.test(clientSrc), 'source (E): the render loop branches on first person');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    for (const n of NAMES) {
      const c = await register(n, PW(n));
      clients.push(c); c.close();
    }
    await stopServer();
    seedDb((data) => {
      for (const n of NAMES) {
        const p = data.users[n.toLowerCase()].profile;
        p.worn = { ...STEEL };
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }];
        p.specialEnergy = 100;
      }
    });
    await startServer();

    // ---------- (1) noMovement duel: frozen spots, swings land, duel finishes ----------
    const Ann = await login('S18Ann', PW('S18Ann')); clients.push(Ann);
    const Bob = await login('S18Bob', PW('S18Bob')); clients.push(Bob);
    {
      const { inc, startA, startB } = await startDuel(Ann, Bob, { rules: { noMovement: true } });
      assert(inc.rules && inc.rules.noMovement === true, '(1) challenge_incoming carries noMovement');
      assert(startA.rules && startA.rules.noMovement === true && startB.rules && startB.rules.noMovement === true, '(1) duel_start rules include noMovement for both fighters');
      Ann.send({ type: 'duel_attack' }); Bob.send({ type: 'duel_attack' });
      await waitCountdownOver(Ann, '(1) countdown over');
      // Both try to run off in opposite directions — neither may move.
      await assertPosAfterMove(Ann, 'S18Ann', 200, 450, 787, 450, '(1) Ann\'s move is ignored: still at the duel-start spot (787,450)');
      await assertPosAfterMove(Bob, 'S18Bob', 1400, 450, 813, 450, '(1) Bob\'s move is ignored: still at the duel-start spot (813,450)');
      // Toe-to-toe, the standing fight works: swings land and HP drops.
      const dmg = (await Ann.waitSince(0, (e) => e.type === 'duel_tick' && (e.hpYou < 99 || e.hpOpponent < 99), 60000, '(1) a landed swing')).e;
      assert(dmg.hpYou < 99 || dmg.hpOpponent < 99, `(1) swings still land under No Movement (hpYou=${dmg.hpYou}, hpOpponent=${dmg.hpOpponent})`);
      // And the duel can finish.
      Bob.close();
      const endA = (await Ann.waitSince(0, (e) => e.type === 'duel_end', 20000, '(1) duel_end')).e;
      assert(endA.winner === 'S18Ann', '(1) the noMovement duel finishes (Ann wins by forfeit)');
      console.log('PASS (1) noMovement duel: frozen at the start spots, swings land, duel finishes');
    }

    // ---------- (2) normal duel: movement still free after the countdown ----------
    const Cid = await login('S18Cid', PW('S18Cid')); clients.push(Cid);
    const Dee = await login('S18Dee', PW('S18Dee')); clients.push(Dee);
    {
      const { startA } = await startDuel(Cid, Dee, {});
      assert(!startA.rules || !startA.rules.noMovement, '(2) a plain duel has noMovement off');
      Cid.send({ type: 'duel_attack' }); Dee.send({ type: 'duel_attack' });
      await waitCountdownOver(Cid, '(2) countdown over');
      await assertPosAfterMove(Cid, 'S18Cid', 400, 450, 400, 450, '(2) Cid\'s move takes effect after the countdown: now at (400,450)');
      Cid.close();
      const endD = (await Dee.waitSince(0, (e) => e.type === 'duel_end', 20000, '(2) duel_end')).e;
      assert(endD.winner === 'S18Dee', '(2) the normal duel finishes (Dee wins by forfeit)');
      console.log('PASS (2) normal duel: movement free after the countdown');
    }

    // ---------- (3) noMovement round-trips through challenge_update ----------
    const Eli = await login('S18Eli', PW('S18Eli')); clients.push(Eli);
    const Fay = await login('S18Fay', PW('S18Fay')); clients.push(Fay);
    {
      const mE = Eli.mark(), mF = Fay.mark();
      Eli.send({ type: 'challenge', target: 'S18Fay', stake: 5 });
      const inc = (await Fay.waitSince(mF, (e) => e.type === 'challenge_incoming', 10000, '(3) challenge_incoming')).e;
      assert(!inc.rules || !inc.rules.noMovement, '(3) the challenge opens with noMovement off');
      Fay.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Eli.send({ type: 'challenge_update', challengeId: inc.challengeId, rules: { noMovement: true } });
      const termsF = (await Fay.waitSince(mF, (e) => e.type === 'challenge_terms' && e.rules && e.rules.noMovement === true, 10000, '(3) terms push to the target')).e;
      assert(termsF.rules.noMovement === true, '(3) challenge_terms carries noMovement to the other side after the update');
      const termsE = (await Eli.waitSince(mE, (e) => e.type === 'challenge_terms' && e.rules && e.rules.noMovement === true, 10000, '(3) terms push to the editor')).e;
      assert(termsE.confirm.from === false && termsE.confirm.to === false, '(3) the update left both confirms unset');
      Eli.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Fay.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startE = (await Eli.waitSince(mE, (e) => e.type === 'duel_start', 10000, '(3) duel_start')).e;
      assert(startE.rules && startE.rules.noMovement === true, '(3) duel_start rules include the updated noMovement');
      Fay.close();
      const endE = (await Eli.waitSince(mE, (e) => e.type === 'duel_end', 20000, '(3) duel_end')).e;
      assert(endE.winner === 'S18Eli', '(3) the round-tripped duel finishes (Eli wins by forfeit)');
      console.log('PASS (3) noMovement round-trips: update -> terms -> duel_start');
    }

    console.log('ALL STAGE 18 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
