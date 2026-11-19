// Stage 15 tests: FREE PLAY fights — a toggle on the Stage 14 duel
// challenge configuration screen. While Free Play is on, the terms
// are coerced server-side (gold stake 0, both item stakes empty),
// the duel runs the full normal fight, and NOTHING settles at the
// end: no escrow, no pot, no item transfer, no rating change and
// no win/loss record change for either player.
//   (a) free play flow: stake + items set first, then Free Play
//       flipped on — the pushed terms show stake 0 and both item
//       lists empty, and the flip resets a confirm already given.
//       Both confirm, the duel starts flagged freePlay with pot 0,
//       the fight runs to a real KO finish, and afterwards BOTH
//       players' gold, backpacks, rating, wins and losses are
//       exactly what they were before the challenge.
//   (b) free play + No Food combined: eating mid-duel is still
//       rejected with the 🚫 line and nothing is consumed.
// (A normal staked duel still moving gold + record is covered by
// test/stage14.js (a), which stays in the regression.)
// Same harness style as test/stage14.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18098;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage15.json');
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
// The money/record snapshot the free play assertions compare:
// gold, backpack, rating, wins, losses — and nothing else.
async function snap(name) {
  const p = (await api('/api/login', { username: name, password: PW(name) })).profile;
  return { gold: p.gold, wins: p.wins, losses: p.losses, rating: p.rating, backpack: JSON.parse(JSON.stringify(p.backpack)) };
}
function assertUnchanged(before, after, who) {
  assert(after.gold === before.gold, `${who}: gold unchanged (${before.gold} -> ${after.gold})`);
  assert(after.wins === before.wins && after.losses === before.losses, `${who}: record unchanged (${before.wins}W/${before.losses}L -> ${after.wins}W/${after.losses}L)`);
  assert(after.rating === before.rating, `${who}: rating unchanged (${before.rating} -> ${after.rating})`);
  assert(JSON.stringify(after.backpack) === JSON.stringify(before.backpack), `${who}: backpack unchanged (${JSON.stringify(before.backpack)} -> ${JSON.stringify(after.backpack)})`);
}
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  const e = (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
  return e;
}

const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const PW = (n) => 's15-pass-' + n;

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/freePlay/.test(src), 'source: freePlay exists in server.js');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/chalFlipFreePlay/.test(clientSrc), 'source: client has the Free Play toggle');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    for (const n of ['S15Ann', 'S15Bob', 'S15Cid', 'S15Dee']) {
      const c = await register(n, PW(n));
      clients.push(c); c.close();
    }
    await stopServer();
    seedDb((data) => {
      const P = (n) => data.users[n.toLowerCase()].profile;
      // Stage 16 (flagged seed fix): seeded backpacks keep each
      // player's 100 starter coins AS their gold stack — gold is
      // an item now, and challenge validation reads the stacks
      // (goldTotal), not the old pouch number.
      for (const n of ['S15Ann', 'S15Bob']) {
        const p = P(n);
        p.worn = { ...STEEL };
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }];
        p.specialEnergy = 100;
      }
      for (const n of ['S15Cid', 'S15Dee']) {
        const p = P(n);
        p.worn = { ...STEEL };
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 3 }];
        p.specialEnergy = 100;
      }
      // Stage 20 (flagged seed fix): all four accounts have already
      // completed the "Win a duel" starter goal, so its one-time
      // +25g reward cannot land mid-suite and break the "free play
      // settles nothing" snapshots below. (Stage 20's own suite
      // covers the reward payout itself.)
      for (const n of ['S15Ann', 'S15Bob', 'S15Cid', 'S15Dee']) {
        P(n).starter = { done: { win_duel: true } };
      }
    });
    await startServer();

    // ---------- (a) free play flow: coercion, real fight, no settlement ----------
    const Ann = await login('S15Ann', PW('S15Ann')); clients.push(Ann);
    const Bob = await login('S15Bob', PW('S15Bob')); clients.push(Bob);
    {
      const beforeA = await snap('S15Ann');
      const beforeB = await snap('S15Bob');
      const mB = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S15Bob', stake: 10, items: [{ item: 'ration', qty: 1 }] });
      const inc = (await Bob.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (a)')).e;
      assert(inc.freePlay === false, '(a) a plain challenge is not free play');
      const terms0 = (await Bob.waitSince(mB, (e) => e.type === 'challenge_terms', 10000, 'challenge_terms (a)')).e;
      assert(terms0.stake === 10 && terms0.items.length === 1 && terms0.freePlay === false, '(a) terms open with the stake and items on the table');
      Bob.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      // The target stakes an item too, so the flip has something to clear on BOTH sides.
      Bob.send({ type: 'challenge_update', challengeId: inc.challengeId, items: [{ item: 'ration', qty: 1 }] });
      const terms1 = (await Ann.waitSince(0, (e) => e.type === 'challenge_terms' && e.itemsTo.length === 1, 10000, 'terms: target item staked')).e;
      assert(terms1.itemsTo[0].item === 'ration', '(a) target item stake recorded before the flip');
      // Challenger confirms — the flip must reset this confirm.
      Ann.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      await Bob.waitSince(mB, (e) => e.type === 'challenge_terms' && e.confirm.from === true, 10000, 'terms: challenger confirmed (a)');
      // Flip Free Play ON.
      Bob.send({ type: 'challenge_update', challengeId: inc.challengeId, freePlay: true });
      const termsF = (await Ann.waitSince(0, (e) => e.type === 'challenge_terms' && e.freePlay === true, 10000, 'terms: free play on')).e;
      assert(termsF.stake === 0, `(a) free play coerced the gold stake to 0 (got ${termsF.stake})`);
      assert(termsF.items.length === 0 && termsF.itemsTo.length === 0, '(a) free play cleared BOTH item stakes');
      assert(termsF.confirm.from === false && termsF.confirm.to === false, '(a) flipping free play reset both confirms');
      // Both confirm on the free play terms — the duel starts.
      Ann.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Bob.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startA = (await Ann.waitSince(0, (e) => e.type === 'duel_start', 10000, 'duel_start (a)')).e;
      const startB = (await Bob.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'duel_start (a) target')).e;
      assert(startA.freePlay === true && startB.freePlay === true, '(a) duel_start carries freePlay to both fighters');
      assert(startA.stake === 0 && startA.pot === 0, `(a) no stake, no pot (stake=${startA.stake}, pot=${startA.pot})`);
      assert(!startA.escrowItems || startA.escrowItems.length === 0, '(a) nothing sits in escrow');
      assert(startA.profile.gold === beforeA.gold && startB.profile.gold === beforeB.gold, '(a) no escrow was taken at the start');
      // A real fight, to a real finish: both tap to attack and trade.
      Ann.send({ type: 'duel_attack' }); Bob.send({ type: 'duel_attack' });
      const endA = (await Ann.waitSince(0, (e) => e.type === 'duel_end', 240000, 'duel_end (a) — real KO finish')).e;
      assert(endA.freePlay === true, '(a) duel_end is flagged free play');
      assert(endA.pot === 0 && (!endA.itemsWon || endA.itemsWon.length === 0), '(a) the winner took no pot and no items');
      const shout = Ann.events.find((e) => e.type === 'chat' && e.from === 'Duel Master' && /wins the free play fight/.test(e.text || ''));
      assert(!!shout, '(a) the Duel Master announced a free play win');
      assertUnchanged(beforeA, await snap('S15Ann'), '(a) Ann');
      assertUnchanged(beforeB, await snap('S15Bob'), '(a) Bob');
      console.log('PASS (a) free play: coerced terms, full fight, zero settlement');
    }

    // ---------- (b) free play + No Food: rules still enforced ----------
    const Cid = await login('S15Cid', PW('S15Cid')); clients.push(Cid);
    const Dee = await login('S15Dee', PW('S15Dee')); clients.push(Dee);
    {
      const beforeC = await snap('S15Cid');
      const beforeD = await snap('S15Dee');
      const mD = Dee.mark();
      // Free Play from the very first message — the creation path coerces too.
      Cid.send({ type: 'challenge', target: 'S15Dee', stake: 10, items: [{ item: 'ration', qty: 1 }], rules: { noFood: true }, freePlay: true });
      const inc = (await Dee.waitSince(mD, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (b)')).e;
      assert(inc.freePlay === true && inc.stake === 0 && (!inc.items || inc.items.length === 0), '(b) challenge_incoming is already coerced: free play, 0g, no items');
      assert(inc.rules && inc.rules.noFood === true, '(b) the No Food rule rides along with free play');
      Dee.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Cid.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Dee.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startC = (await Cid.waitSince(0, (e) => e.type === 'duel_start', 10000, 'duel_start (b)')).e;
      assert(startC.freePlay === true && startC.rules && startC.rules.noFood === true, '(b) duel_start: free play + No Food together');
      const err = await expectError(Cid, { type: 'use', item: 'ration' }, 'food rejection (b)');
      assert(err.message === '🚫 No Food in this duel.', `(b) eating in a free play + No Food duel is rejected ("${err.message}")`);
      // End it by forfeit (Dee leaves mid-duel): still no settlement.
      Dee.close();
      const endC = (await Cid.waitSince(0, (e) => e.type === 'duel_end', 20000, 'duel_end (b)')).e;
      assert(endC.freePlay === true && endC.winner === 'S15Cid', '(b) forfeiting a free play duel ends it as a free play win');
      assertUnchanged(beforeC, await snap('S15Cid'), '(b) Cid');
      assertUnchanged(beforeD, await snap('S15Dee'), '(b) Dee');
      console.log('PASS (b) free play + No Food: rule enforced, forfeit settles nothing');
    }

    console.log('ALL STAGE 15 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
