// Stage 33 tests: HEAD-TO-HEAD duel scoreboard — "when u fight a
// repeat opponent it tells total wins and losses" (Derek, 2026-11-18).
// profile.h2h = { oppName: { w, l } } from the owner's perspective,
// updated exactly once per settled player duel in endDuel — staked,
// disconnect-forfeit AND Free Play duels all count (a bragging
// record; Free Play still bypasses overall W/L and rating).
//   (a) main pair, three staked duels with alternating winners:
//       payloads (challenge_incoming / challenge_terms per receiver,
//       duel_start, duel_end) and the on-disk profiles agree after
//       every fight; the record survives a server restart and is
//       served back on a fresh challenge; Examine carries it too.
//   (b) Free Play: h2h updates, overall W/L + rating + gold do not.
//   (c) disconnect forfeit: recorded exactly once on both profiles.
// Same harness style as test/stage15.js. Winners are scripted by
// engagement: duels have NO auto-retaliate (Stage 12), so the side
// that never taps duel_attack deals no damage and always loses.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18133;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage33.json');
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
function dbH2h(name, opp) {
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const p = data.users[name.toLowerCase()].profile;
  return (p.h2h || {})[opp] || null;
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
async function snap(name) {
  const p = (await api('/api/login', { username: name, password: PW(name) })).profile;
  return { gold: p.gold, wins: p.wins, losses: p.losses, rating: p.rating };
}
function assertH2h(rec, w, l, label) {
  assert(rec && rec.w === w && rec.l === l, `${label} — expected ${w}W/${l}L, got ${rec ? rec.w + 'W/' + rec.l + 'L' : 'null'}`);
}

// Runs one full challenge -> confirm -> duel flow. `engage` is the
// client NAME of the only fighter who taps attack (the scripted
// winner); the other never swings (no auto-retaliate) and loses.
async function runDuel(A, B, { engage, freePlay = false, stake = 10 }) {
  const mA = A.mark(), mB = B.mark();
  A.send({ type: 'challenge', target: B.name, stake, items: [], freePlay });
  const inc = (await B.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming')).e;
  const termsA = (await A.waitSince(mA, (e) => e.type === 'challenge_terms', 10000, 'challenge_terms (challenger)')).e;
  const termsB = (await B.waitSince(mB, (e) => e.type === 'challenge_terms', 10000, 'challenge_terms (target)')).e;
  B.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  A.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  B.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  const startA = (await A.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start (challenger)')).e;
  const startB = (await B.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'duel_start (target)')).e;
  (engage === A.name ? A : B).send({ type: 'duel_attack' });
  const endA = (await A.waitSince(mA, (e) => e.type === 'duel_end', 300000, 'duel_end (challenger)')).e;
  const endB = (await B.waitSince(mB, (e) => e.type === 'duel_end', 300000, 'duel_end (target)')).e;
  return { inc, termsA, termsB, startA, startB, endA, endB };
}

const DRAGON = { weapon: 'dragon_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const PW = (n) => 's33-pass-' + n;
const NAMES = ['S33Ann', 'S33Bob', 'S33Cid', 'S33Dee', 'S33Eli', 'S33Fay'];

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/recordH2H\(winner, loser\)/.test(src), 'source: endDuel records the head-to-head');
  assert(/h2hVs\(/.test(src), 'source: h2hVs lookup exists in server.js');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/First fight vs/.test(clientSrc), 'source: challenge sheet has the first-fight line');
  assert(/your record: /.test(clientSrc), 'source: duel start prints the record chat line');
  assert(/Your record vs/.test(clientSrc), 'source: duel end screen shows the updated record');
  assert(/Your record vs them/.test(clientSrc), 'source: examine sheet has the record row');

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
        p.worn = { ...DRAGON };
        p.style = 'aggressive';
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }];
        p.specialEnergy = 100;
        // The one-time +25g "Win a duel" starter reward must not
        // land mid-suite and disturb the free-play gold snapshot.
        p.starter = { done: { win_duel: true } };
      }
    });
    await startServer();

    // ---------- (a) main pair: three staked duels, alternating winners ----------
    let Ann = await login('S33Ann', PW('S33Ann')); clients.push(Ann);
    let Bob = await login('S33Bob', PW('S33Bob')); clients.push(Bob);
    {
      // Duel 1 — Ann engages, Bob passive: Ann wins.
      const d1 = await runDuel(Ann, Bob, { engage: 'S33Ann' });
      assert(d1.inc.h2h === null, '(a1) challenge_incoming: no record before the first fight (null)');
      assert(d1.termsA.h2h === null && d1.termsB.h2h === null, '(a1) challenge_terms: both sides see null before the first fight');
      assert(d1.startA.h2h === null && d1.startB.h2h === null, '(a1) duel_start: no record for either fighter');
      assert(d1.endA.winner === 'S33Ann', '(a1) the engaging fighter won');
      assert(d1.endA.opponent === 'S33Bob' && d1.endB.opponent === 'S33Ann', '(a1) duel_end names each fighter their opponent');
      assertH2h(d1.endA.h2h, 1, 0, '(a1) duel_end: Ann sees 1-0');
      assertH2h(d1.endB.h2h, 0, 1, '(a1) duel_end: Bob sees 0-1 (his own perspective)');
      await sleep(600);
      assertH2h(dbH2h('S33Ann', 'S33Bob'), 1, 0, '(a1) profile on disk: Ann 1-0 vs Bob');
      assertH2h(dbH2h('S33Bob', 'S33Ann'), 0, 1, '(a1) profile on disk: Bob 0-1 vs Ann (mirrored)');
      const sA1 = await snap('S33Ann'), sB1 = await snap('S33Bob');
      assert(sA1.wins === 1 && sA1.losses === 0 && sB1.wins === 0 && sB1.losses === 1, '(a1) overall W/L moved as usual alongside h2h');

      // Duel 2 — Bob engages, Ann passive: Bob wins. Records level at 1-1.
      const d2 = await runDuel(Ann, Bob, { engage: 'S33Bob' });
      assertH2h(d2.inc.h2h, 0, 1, '(a2) challenge_incoming carries Bob his own record vs Ann (0-1)');
      assertH2h(d2.termsA.h2h, 1, 0, '(a2) challenge_terms: Ann sees her perspective (1-0)');
      assertH2h(d2.termsB.h2h, 0, 1, '(a2) challenge_terms: Bob sees his perspective (0-1)');
      assertH2h(d2.startA.h2h, 1, 0, '(a2) duel_start: Ann record before the fight (1-0)');
      assertH2h(d2.startB.h2h, 0, 1, '(a2) duel_start: Bob record before the fight (0-1)');
      assert(d2.endA.winner === 'S33Bob', '(a2) Bob won the return fight');
      assertH2h(d2.endA.h2h, 1, 1, '(a2) duel_end: Ann now 1-1');
      assertH2h(d2.endB.h2h, 1, 1, '(a2) duel_end: Bob now 1-1');
      await sleep(600);
      assertH2h(dbH2h('S33Ann', 'S33Bob'), 1, 1, '(a2) profile on disk: Ann 1-1');
      assertH2h(dbH2h('S33Bob', 'S33Ann'), 1, 1, '(a2) profile on disk: Bob 1-1');

      // Duel 3 — Ann engages: Ann wins again. Records split 2-1 / 1-2.
      const d3 = await runDuel(Ann, Bob, { engage: 'S33Ann' });
      assert(d3.endA.winner === 'S33Ann', '(a3) Ann won the decider');
      assertH2h(d3.endA.h2h, 2, 1, '(a3) duel_end: Ann now 2-1');
      assertH2h(d3.endB.h2h, 1, 2, '(a3) duel_end: Bob now 1-2');
      console.log('PASS (a) three duels: h2h tracked per fight, mirrored, on payloads and profiles');
    }

    // Persistence: bounce the server — the record must survive on
    // the stored profiles and be served back on a fresh challenge.
    Ann.close(); Bob.close();
    await stopServer();
    assertH2h(dbH2h('S33Ann', 'S33Bob'), 2, 1, '(persist) on disk after shutdown: Ann 2-1');
    assertH2h(dbH2h('S33Bob', 'S33Ann'), 1, 2, '(persist) on disk after shutdown: Bob 1-2');
    await startServer();
    Ann = await login('S33Ann', PW('S33Ann')); clients.push(Ann);
    Bob = await login('S33Bob', PW('S33Bob')); clients.push(Bob);
    {
      const mA = Ann.mark(), mB = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S33Bob', stake: 10, items: [] });
      const inc = (await Bob.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (persist)')).e;
      assertH2h(inc.h2h, 1, 2, '(persist) after restart, challenge_incoming gives Bob his 1-2');
      const termsA = (await Ann.waitSince(mA, (e) => e.type === 'challenge_terms', 10000, 'challenge_terms (persist, Ann)')).e;
      const termsB = (await Bob.waitSince(mB, (e) => e.type === 'challenge_terms', 10000, 'challenge_terms (persist, Bob)')).e;
      assertH2h(termsA.h2h, 2, 1, '(persist) Ann sees her own 2-1 on the setup screen');
      assertH2h(termsB.h2h, 1, 2, '(persist) Bob sees his own 1-2 on the setup screen');
      Ann.send({ type: 'challenge_cancel', challengeId: inc.challengeId });
      // Examine carries the viewer's record vs the examined player.
      const mE = Ann.mark();
      Ann.send({ type: 'examine', target: 'S33Bob' });
      const exA = (await Ann.waitSince(mE, (e) => e.type === 'examine', 10000, 'examine (Ann on Bob)')).e;
      assertH2h(exA.h2h, 2, 1, '(persist) examine: Ann sees her 2-1 vs Bob');
      const mE2 = Bob.mark();
      Bob.send({ type: 'examine', target: 'S33Ann' });
      const exB = (await Bob.waitSince(mE2, (e) => e.type === 'examine', 10000, 'examine (Bob on Ann)')).e;
      assertH2h(exB.h2h, 1, 2, '(persist) examine: Bob sees his 1-2 vs Ann');
      console.log('PASS (persist) record survives restart; setup screen + examine serve it per viewer');
    }

    // ---------- (b) Free Play counts for h2h but not W/L or rating ----------
    const Cid = await login('S33Cid', PW('S33Cid')); clients.push(Cid);
    const Dee = await login('S33Dee', PW('S33Dee')); clients.push(Dee);
    {
      const beforeC = await snap('S33Cid');
      const beforeD = await snap('S33Dee');
      const fp = await runDuel(Cid, Dee, { engage: 'S33Cid', freePlay: true });
      assert(fp.endA.freePlay === true && fp.endA.winner === 'S33Cid', '(b) the free play fight ran and Cid won');
      assertH2h(fp.endA.h2h, 1, 0, '(b) duel_end: Cid h2h 1-0 even in Free Play');
      assertH2h(fp.endB.h2h, 0, 1, '(b) duel_end: Dee h2h 0-1 even in Free Play');
      await sleep(600);
      assertH2h(dbH2h('S33Cid', 'S33Dee'), 1, 0, '(b) profile on disk: Cid h2h 1-0');
      assertH2h(dbH2h('S33Dee', 'S33Cid'), 0, 1, '(b) profile on disk: Dee h2h 0-1');
      const afterC = await snap('S33Cid'), afterD = await snap('S33Dee');
      assert(afterC.wins === beforeC.wins && afterC.losses === beforeC.losses && afterC.rating === beforeC.rating && afterC.gold === beforeC.gold, '(b) Cid: overall W/L, rating and gold untouched by Free Play');
      assert(afterD.wins === beforeD.wins && afterD.losses === beforeD.losses && afterD.rating === beforeD.rating && afterD.gold === beforeD.gold, '(b) Dee: overall W/L, rating and gold untouched by Free Play');
      console.log('PASS (b) Free Play updates h2h only — the Stage 15 bypass is intact');
    }

    // ---------- (c) disconnect forfeit records exactly once ----------
    const Eli = await login('S33Eli', PW('S33Eli')); clients.push(Eli);
    const Fay = await login('S33Fay', PW('S33Fay')); clients.push(Fay);
    {
      const mE = Eli.mark(), mF = Fay.mark();
      Eli.send({ type: 'challenge', target: 'S33Fay', stake: 10, items: [] });
      const inc = (await Fay.waitSince(mF, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (c)')).e;
      Fay.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Eli.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Fay.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      await Eli.waitSince(mE, (e) => e.type === 'duel_start', 10000, 'duel_start (c)');
      Fay.close(); // walk away mid-duel: forfeit
      const endE = (await Eli.waitSince(mE, (e) => e.type === 'duel_end', 20000, 'duel_end (c)')).e;
      assert(endE.winner === 'S33Eli', '(c) the forfeit made Eli the winner');
      assertH2h(endE.h2h, 1, 0, '(c) duel_end: Eli h2h 1-0 from the forfeit');
      await sleep(600);
      assertH2h(dbH2h('S33Eli', 'S33Fay'), 1, 0, '(c) profile on disk: Eli exactly 1-0 (recorded once)');
      assertH2h(dbH2h('S33Fay', 'S33Eli'), 0, 1, '(c) profile on disk: Fay exactly 0-1 (recorded once, while offline)');
      console.log('PASS (c) disconnect forfeit recorded exactly once on both profiles');
    }

    console.log('ALL STAGE 33 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
