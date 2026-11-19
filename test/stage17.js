// Stage 17 tests: the Stake Board — Derek's sparkling sign in the
// south-west of the plaza. Tap it -> offer your gold bid -> anyone
// can accept -> both fighters are notified -> first Ready spawns in
// the Waiting Area -> second Ready starts the duel through the
// existing startDuel (escrow, countdown, winner takes the pot).
//   (a) A posts an offer; B sees it on the board (stake + pot).
//   (b) negative: A cannot accept their own offer.
//   (c) cancel flow: A posts, C accepts, A readies (lands in the
//       Waiting Area), C cancels -> A is returned to the plaza and
//       no gold moved.
//   (d) main flow: A posts, B accepts (both stake_matched), travel
//       to 'waiting' is refused, A readies first (Waiting Area),
//       B readies -> duel_start with pot = 2x stake, both profiles
//       escrowed by the stake, countdown ticks arrive; B leaving
//       mid-duel forfeits and A is paid the whole pot.
// Same harness style as test/stage16.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18117;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage17.json');
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
const PW = (n) => 's17-pass-' + n;
async function prof(name) { return (await api('/api/login', { username: name, password: PW(name) })).profile; }
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  return (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/waiting: \{ name: 'Waiting Area'/.test(src), 'source: server has the waiting area');
  assert(/const stakeOffers = new Map/.test(src) && /stake_offer_create/.test(src) && /stake_ready/.test(src), 'source: stake offer store + handlers exist');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/STAKE_SIGN_POS=\{x:180,y:780\}/.test(clientSrc), 'source: client sign sits at server (180,780)');
  assert(/stakeSparkles/.test(clientSrc) && /buildWaiting/.test(clientSrc) && /stakeboardmodal/.test(clientSrc), 'source: client has sparkles, waiting scene and stake board modal');
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs); // throws on a syntax error
  console.log('PASS source: client inline script parses');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    const A = await register('S17Ann', PW('S17Ann')); clients.push(A);
    const B = await register('S17Bob', PW('S17Bob')); clients.push(B);
    const C = await register('S17Cid', PW('S17Cid')); clients.push(C);

    // The Waiting Area is not travel-reachable.
    const errT = await expectError(B, { type: 'travel', to: 'waiting' }, 'travel to waiting (guard)');
    assert(/Waiting Area is only for stake matches/.test(errT.message), `(guard) travel to 'waiting' refused ("${errT.message}")`);

    // ---------- (a) post an offer; B sees it on the board ----------
    let mB = B.mark();
    A.send({ type: 'stake_offer_create', stake: 25 });
    const board = (await B.waitSince(mB, (e) => e.type === 'stake_board' && (e.offers || []).some((o) => o.username === 'S17Ann'), 10000, 'stake_board with Ann offer (a)')).e;
    const offer = board.offers.find((o) => o.username === 'S17Ann');
    assert(offer.stake === 25 && offer.pot === 50, `(a) board shows Ann's 25g offer, pot 50g (got stake=${offer.stake}, pot=${offer.pot})`);
    // The announcement chat line reaches B too.
    await B.waitFor((e) => e.type === 'chat' && e.from === 'Stake Board' && /offers a 25g fight/.test(e.text || ''), 10000, 'announcement chat (a)');
    console.log('PASS (a) offer posted, broadcast on the board + announced in chat');

    // ---------- (b) negative: cannot accept your own offer ----------
    const errOwn = await expectError(A, { type: 'stake_offer_accept', offerId: offer.id }, 'accept own offer (b)');
    assert(/can't accept your own offer/.test(errOwn.message), `(b) accepting your own offer refused ("${errOwn.message}")`);
    console.log('PASS (b) own-offer accept refused');

    // ---------- (c) cancel a matched match returns the waiter ----------
    A.send({ type: 'stake_offer_cancel', offerId: offer.id });
    await B.waitFor((e) => e.type === 'stake_board' && !(e.offers || []).some((o) => o.username === 'S17Ann'), 10000, 'board cleared after cancel (c)');
    mB = B.mark();
    A.send({ type: 'stake_offer_create', stake: 10 });
    const board2 = (await B.waitSince(mB, (e) => e.type === 'stake_board' && (e.offers || []).some((o) => o.username === 'S17Ann' && o.stake === 10), 10000, 'stake_board 10g (c)')).e;
    const offer2 = board2.offers.find((o) => o.username === 'S17Ann');
    const mA = A.mark(); const mC = C.mark();
    C.send({ type: 'stake_offer_accept', offerId: offer2.id });
    const matchedC = (await C.waitSince(mC, (e) => e.type === 'stake_matched', 10000, 'stake_matched C (c)')).e;
    const matchedA = (await A.waitSince(mA, (e) => e.type === 'stake_matched', 10000, 'stake_matched A (c)')).e;
    assert(matchedC.opponent === 'S17Ann' && matchedC.stake === 10 && matchedC.pot === 20, '(c) C matched vs Ann for 10g, pot 20g');
    assert(matchedA.opponent === 'S17Cid' && matchedA.matchId === matchedC.matchId, '(c) Ann matched vs Cid, same match id');
    // Ann readies first -> Waiting Area.
    const mA2 = A.mark(); const mC2 = C.mark();
    A.send({ type: 'stake_ready', matchId: matchedA.matchId });
    const waiting = (await A.waitSince(mA2, (e) => e.type === 'stake_waiting', 10000, 'stake_waiting (c)')).e;
    assert(waiting.opponent === 'S17Cid', '(c) Ann is told she waits for Cid');
    await A.waitSince(mA2, (e) => e.type === 'area' && e.area === 'waiting', 10000, 'Ann area=waiting (c)');
    const updC = (await C.waitSince(mC2, (e) => e.type === 'stake_match_update', 10000, 'C match update (c)')).e;
    assert(updC.readyOpponent === true && updC.readyMine === false, '(c) C sees Ann ready, himself not ready');
    // A matched player cannot travel away.
    const errTr = await expectError(A, { type: 'travel', to: 'goblins' }, 'travel while matched (c)');
    assert(/stake match waiting/.test(errTr.message), `(c) travel while matched refused ("${errTr.message}")`);
    // C cancels -> Ann returns to the plaza, nobody's gold moved.
    const mA3 = A.mark();
    C.send({ type: 'stake_match_cancel', matchId: matchedC.matchId });
    await A.waitSince(mA3, (e) => e.type === 'stake_match_cancelled', 10000, 'Ann match cancelled (c)');
    await A.waitSince(mA3, (e) => e.type === 'area' && e.area === 'plaza', 10000, 'Ann back in plaza (c)');
    assert((await prof('S17Ann')).gold === 100 && (await prof('S17Cid')).gold === 100, '(c) cancel moved no gold (both still 100g)');
    console.log('PASS (c) matched cancel returns the waiting player to the plaza, no gold moved');

    // ---------- (d) the full flow into a duel ----------
    mB = B.mark();
    A.send({ type: 'stake_offer_create', stake: 25 });
    const board3 = (await B.waitSince(mB, (e) => e.type === 'stake_board' && (e.offers || []).some((o) => o.username === 'S17Ann' && o.stake === 25), 10000, 'stake_board 25g (d)')).e;
    const offer3 = board3.offers.find((o) => o.username === 'S17Ann');
    const mA4 = A.mark(); const mB4 = B.mark();
    B.send({ type: 'stake_offer_accept', offerId: offer3.id });
    const matchedB = (await B.waitSince(mB4, (e) => e.type === 'stake_matched', 10000, 'stake_matched B (d)')).e;
    const matchedA2 = (await A.waitSince(mA4, (e) => e.type === 'stake_matched', 10000, 'stake_matched A (d)')).e;
    assert(matchedB.opponent === 'S17Ann' && matchedB.pot === 50 && matchedA2.matchId === matchedB.matchId, '(d) both notified of the 25g match (pot 50g)');
    // Ann readies first -> Waiting Area (west pad side).
    const mA5 = A.mark(); const mB5 = B.mark();
    A.send({ type: 'stake_ready', matchId: matchedA2.matchId });
    await A.waitSince(mA5, (e) => e.type === 'area' && e.area === 'waiting', 10000, 'Ann in waiting (d)');
    const updB = (await B.waitSince(mB5, (e) => e.type === 'stake_match_update' && e.readyOpponent === true, 10000, 'B sees Ann ready (d)')).e;
    assert(updB.readyMine === false, '(d) B not ready yet');
    assert((await prof('S17Ann')).gold === 100, '(d) no escrow before the second Ready (Ann still 100g)');
    // Bob readies -> the duel starts NOW, escrow taken by startDuel.
    const mA6 = A.mark(); const mB6 = B.mark();
    B.send({ type: 'stake_ready', matchId: matchedB.matchId });
    const startA = (await A.waitSince(mA6, (e) => e.type === 'duel_start', 10000, 'duel_start A (d)')).e;
    const startB = (await B.waitSince(mB6, (e) => e.type === 'duel_start', 10000, 'duel_start B (d)')).e;
    assert(startA.pot === 50 && startB.pot === 50, `(d) duel pot is 2x stake (got ${startA.pot}/${startB.pot})`);
    assert(startA.profile.gold === 75, `(d) Ann escrowed 25g at duel start (profile gold ${startA.profile.gold})`);
    assert(startB.profile.gold === 75, `(d) Bob escrowed 25g at duel start (profile gold ${startB.profile.gold})`);
    assert(typeof startA.countdownTicks === 'number' && startA.countdownTicks >= 1, '(d) duel_start carries the countdown');
    const tick = (await A.waitSince(mA6, (e) => e.type === 'duel_tick' && typeof e.countdownLeft === 'number' && e.countdownLeft >= 1, 10000, 'countdown tick (d)')).e;
    assert(tick.countdownLeft >= 1, `(d) countdown ticks arrive (countdownLeft=${tick.countdownLeft})`);
    console.log('PASS (d) second Ready -> duel_start, escrow taken, countdown running');
    // Force the finish: Bob leaves mid-duel -> forfeit, Ann takes the pot.
    const mA7 = A.mark();
    B.close();
    const endA = (await A.waitSince(mA7, (e) => e.type === 'duel_end', 20000, 'duel_end after Bob left (d)')).e;
    assert(endA.winner === 'S17Ann' && endA.pot === 50, `(d) Ann wins by forfeit and takes the 50g pot (winner=${endA.winner})`);
    await sleep(500);
    // Stage 20 (flagged fix): +25 more — Ann's first duel win also
    // banks the one-time "Win a duel" starter-goal reward.
    assert((await prof('S17Ann')).gold === 150, '(d) Ann profile: 100 - 25 escrow + 50 pot + 25 starter reward = 150g');
    assert((await prof('S17Bob')).gold === 75, '(d) Bob profile: 100 - 25 escrow = 75g');
    console.log('PASS (d) winner paid the full pot');

    console.log('ALL STAGE 17 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
