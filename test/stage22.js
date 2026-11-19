// Stage 22 tests: the MOD NPC STAKE LADDER — three NPC moderators
// stand in the plaza (Mod Ash / Tier 1 / 100g, Mod Blair / Tier 2 /
// 200g, Mod Vega / Tier 3 / 400g) offering stake duels. Winning 3
// times in a tier unlocks the next. The fights are duel-rules
// fights (99 HP, countdown, DUEL_LEVEL-equalised rolls,
// tap-to-engage, no auto-retaliate) run by a dedicated engine
// against a synthetic mod profile — they pay a 2x pot on a win,
// take the stake on a loss/forfeit, and never touch rating or the
// win/loss record (but a win completes the "Win a duel" starter
// goal).
//   (a) welcome carries mod_npcs (3 mods, right names/tiers/stakes,
//       all free) + mod_ladder (0/0/0); a hand-stripped profile is
//       migrated back to the ladder defaults.
//   (b) Tier 2 and Tier 3 refuse a fresh account with the lock
//       reason; a 50g account is refused Tier 1 on gold. Nothing is
//       taken on a refusal.
//   (c) first Tier 1 win (bow kiting from 100 units — the melee mod
//       holds its post and can never answer, so the win is
//       deterministic): escrow -100 at start, pot +200 at the end,
//       the starter goal pays its +25 on top (100 -> 225 exactly),
//       wins.t1 = 1.
//   (d) busy lock + a real KO loss: a second challenger is refused
//       while a mod is fighting; a challenger who never taps attack
//       is beaten down by the mod — loss costs exactly the stake,
//       record and rating untouched.
//   (e) three Tier 1 wins: wins cap at 3, the third end reports
//       unlockedNext, gold grows by exactly +100 per win, the wins
//       persist in the saved DB file, and Tier 2 then STARTS (200g
//       escrowed) — walking away after the countdown forfeits it.
//   (f) disconnect mid-fight forfeits: the stake stays gone after
//       reconnect and the mod is free again.
// Same harness style as test/stage15.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18122;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage22.json');
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
async function snap(name) {
  return (await api('/api/login', { username: name, password: PW(name) })).profile;
}
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  const e = (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
  return e;
}
// Stand the client at (x, y) — moves are processed in socket order,
// so a start sent right after is judged from the new spot.
function standAt(c, x, y) { c.send({ type: 'move', x, y }); }
// Kite-fight Mod Ash from 100 units west: wield a bow (seeded), walk
// to (580,300), start, tap once to engage, and let the arrows finish
// a mod who can never close the distance. Returns the end event.
async function kiteWin(c, id, timeoutMs = 150000) {
  const defs = { mod1: [580, 300], mod2: [700, 280], mod3: [820, 300] };
  const [x, y] = defs[id];
  standAt(c, x, y);
  const m = c.mark();
  c.send({ type: 'mod_duel_start', id });
  const start = (await c.waitSince(m, (e) => e.type === 'mod_duel' && e.phase === 'start', 10000, 'mod_duel start')).e;
  c.send({ type: 'mod_duel_attack' });
  const end = (await c.waitSince(m, (e) => e.type === 'mod_duel' && e.phase === 'end', timeoutMs, 'mod_duel end (kite win)')).e;
  return { start, end };
}

const BOW = { weapon: 'magic_shortbow', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const PW = (n) => 's22-pass-' + n;
const NAMES = ['S22Win', 'S22Goal', 'S22Afk', 'S22Poor', 'S22Quit', 'S22Mig'];

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/MOD_NPCS/.test(src) && /mod_duel_start/.test(src), 'source: mod ladder exists in server.js');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/openModSheet/.test(clientSrc) && /modDuelUI/.test(clientSrc), 'source: client has the mod sheet + mod duel UI');

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
      const P = (n) => data.users[n.toLowerCase()].profile;
      // The ladder climber + the starter-goal prover: best bow, rune
      // arrows, gold as a coin stack (Stage 16: mirror kept in sync).
      const win = P('S22Win');
      win.worn = { ...BOW };
      win.backpack = [{ item: 'gold', qty: 1000 }, { item: 'rune_arrow', qty: 400 }];
      win.gold = 1000;
      // (flagged seed): the climber has already banked the "Win a
      // duel" starter reward, so the +25 cannot pollute the exact
      // ladder gold math below — the payout itself is proven in (c).
      win.starter = { done: { win_duel: true } };
      const goal = P('S22Goal');
      goal.worn = { ...BOW };
      goal.backpack = [{ item: 'gold', qty: 100 }, { item: 'rune_arrow', qty: 200 }];
      goal.gold = 100;
      P('S22Afk').backpack = [{ item: 'gold', qty: 500 }];
      P('S22Afk').gold = 500;
      P('S22Poor').backpack = [{ item: 'gold', qty: 50 }];
      P('S22Poor').gold = 50;
      P('S22Quit').backpack = [{ item: 'gold', qty: 500 }];
      P('S22Quit').gold = 500;
      // Migration prover: a profile with NO ladder field at all.
      delete P('S22Mig').modLadder;
    });
    await startServer();

    const Win = await login('S22Win', PW('S22Win')); clients.push(Win);

    // ---------- (a) presence, ladder state, migration ----------
    {
      const board = await Win.waitFor((e) => e.type === 'mod_npcs', 10000, 'mod_npcs');
      assert(board.npcs.length === 3, `(a) three moderators stand in the plaza (got ${board.npcs.length})`);
      const byId = Object.fromEntries(board.npcs.map((n) => [n.id, n]));
      assert(byId.mod1 && byId.mod1.name === 'Mod Ash' && byId.mod1.tier === 1 && byId.mod1.stake === 100, '(a) mod1 = Mod Ash, Tier 1, 100g');
      assert(byId.mod2 && byId.mod2.name === 'Mod Blair' && byId.mod2.tier === 2 && byId.mod2.stake === 200, '(a) mod2 = Mod Blair, Tier 2, 200g');
      assert(byId.mod3 && byId.mod3.name === 'Mod Vega' && byId.mod3.tier === 3 && byId.mod3.stake === 400, '(a) mod3 = Mod Vega, Tier 3, 400g');
      assert(board.npcs.every((n) => n.busy === false), '(a) all three mods start free');
      const lad = await Win.waitFor((e) => e.type === 'mod_ladder', 10000, 'mod_ladder');
      assert(lad.wins.t1 === 0 && lad.wins.t2 === 0 && lad.wins.t3 === 0, '(a) a fresh ladder reads 0/0/0');
      const Mig = await login('S22Mig', PW('S22Mig')); clients.push(Mig);
      const migWelcome = Mig.events.find((e) => e.type === 'welcome');
      assert(migWelcome.profile.modLadder && migWelcome.profile.modLadder.wins.t1 === 0 && migWelcome.profile.modLadder.wins.t3 === 0, '(a) a profile with no ladder field is migrated to 0/0/0');
      console.log('PASS (a) presence + ladder state + migration');
    }

    // ---------- (b) locked tiers + insufficient gold refuse cleanly ----------
    {
      standAt(Win, 700, 280); // 100 units from Mod Blair
      const err2 = await expectError(Win, { type: 'mod_duel_start', id: 'mod2' }, 'tier 2 lock');
      assert(/locked/.test(err2.message) && /Tier 1/.test(err2.message), `(b) Tier 2 refuses a fresh account with the lock reason ("${err2.message}")`);
      standAt(Win, 820, 300); // 100 units from Mod Vega
      const err3 = await expectError(Win, { type: 'mod_duel_start', id: 'mod3' }, 'tier 3 lock');
      assert(/locked/.test(err3.message) && /Tier 2/.test(err3.message), `(b) Tier 3 refuses with the lock reason ("${err3.message}")`);
      assert((await snap('S22Win')).gold === 1000, '(b) locked refusals took no gold');
      const Poor = await login('S22Poor', PW('S22Poor')); clients.push(Poor);
      standAt(Poor, 600, 300); // 80 units from Mod Ash
      const errP = await expectError(Poor, { type: 'mod_duel_start', id: 'mod1' }, 'insufficient gold');
      assert(/100g/.test(errP.message), `(b) a 50g account is refused the 100g stake ("${errP.message}")`);
      const poorSnap = await snap('S22Poor');
      assert(poorSnap.gold === 50 && poorSnap.backpack.length === 1 && poorSnap.backpack[0].qty === 50, '(b) the refused account kept every coin');
      console.log('PASS (b) locked tiers + insufficient gold');
    }

    // ---------- (c) first win: escrow, pot, starter-goal payout ----------
    const Goal = await login('S22Goal', PW('S22Goal')); clients.push(Goal);
    {
      const { start, end } = await kiteWin(Goal, 'mod1');
      assert(start.stake === 100 && start.pot === 200, `(c) the fight is 100g in, 200g pot (stake=${start.stake}, pot=${start.pot})`);
      assert(start.profile.gold === 0, `(c) the 100g stake was escrowed at the start (gold ${start.profile.gold})`);
      assert(end.result === 'win' && end.payout === 200 && end.wins === 1, `(c) the win pays the 200g pot and records win 1 (result=${end.result}, payout=${end.payout}, wins=${end.wins})`);
      const sd = Goal.events.find((e) => e.type === 'starter_done' && e.id === 'win_duel');
      assert(!!sd, '(c) the win completed the "Win a duel" starter goal');
      const after = await snap('S22Goal');
      assert(after.gold === 225, `(c) gold is exactly 100 - 100 escrow + 200 pot + 25 starter = 225 (got ${after.gold})`);
      assert(after.modLadder.wins.t1 === 1 && after.wins === 0 && after.losses === 0 && after.rating === 1000, '(c) ladder win saved; duel record + rating untouched');
      console.log('PASS (c) first win: escrow, pot, starter goal');
    }

    // ---------- (d) busy lock + KO loss for a challenger who never engages ----------
    const Afk = await login('S22Afk', PW('S22Afk')); clients.push(Afk);
    {
      standAt(Afk, 660, 300); // toe-to-toe with Mod Ash (680,300)
      const mA = Afk.mark();
      Afk.send({ type: 'mod_duel_start', id: 'mod1' });
      const startA = (await Afk.waitSince(mA, (e) => e.type === 'mod_duel' && e.phase === 'start', 10000, 'afk fight start')).e;
      assert(startA.profile.gold === 400, `(d) the AFK challenger's stake was escrowed (gold ${startA.profile.gold})`);
      // While Ash is busy, the climber (standing in range) is refused.
      standAt(Win, 580, 300);
      const errB = await expectError(Win, { type: 'mod_duel_start', id: 'mod1' }, 'busy refusal');
      assert(/in a fight right now/.test(errB.message), `(d) a busy mod refuses a second challenger ("${errB.message}")`);
      assert((await snap('S22Win')).gold === 1000, '(d) the busy refusal took no gold');
      // Afk never taps attack: the mod beats them down unaided.
      const endA = (await Afk.waitSince(mA, (e) => e.type === 'mod_duel' && e.phase === 'end', 240000, 'afk fight end — mod wins by KO')).e;
      assert(endA.result === 'loss' && endA.payout === 0, `(d) never engaging loses the fight (result=${endA.result})`);
      const after = await snap('S22Afk');
      assert(after.gold === 400, `(d) the loss cost exactly the 100g stake (gold ${after.gold})`);
      assert(after.modLadder.wins.t1 === 0 && after.wins === 0 && after.losses === 0 && after.rating === 1000, '(d) no ladder win, no record, no rating change on a loss');
      console.log('PASS (d) busy lock + KO loss');
    }

    // ---------- (e) three wins unlock Tier 2; walking away forfeits it ----------
    {
      let expected = 1000;
      for (let i = 1; i <= 3; i++) {
        const { start, end } = await kiteWin(Win, 'mod1');
        assert(start.profile.gold === expected - 100, `(e) win ${i}: stake escrowed at start (gold ${start.profile.gold})`);
        assert(end.result === 'win' && end.payout === 200 && end.wins === i, `(e) win ${i} recorded (wins=${end.wins})`);
        assert(end.unlockedNext === (i === 3), `(e) win ${i}: unlockedNext=${end.unlockedNext} (only the third unlocks Tier 2)`);
        expected += 100;
        const p = await snap('S22Win');
        assert(p.gold === expected && p.modLadder.wins.t1 === i, `(e) after win ${i}: gold ${p.gold}, saved t1 wins ${p.modLadder.wins.t1}`);
        if (i === 1) {
          const ticks = Win.events.filter((e) => e.type === 'mod_duel' && e.phase === 'tick');
          assert(ticks.some((t) => t.countdownLeft > 0), '(e) the fight opened with a countdown');
          assert(ticks.some((t) => typeof t.youHit === 'number'), '(e) my swings landed as numeric hits on the ticks');
          assert(ticks.every((t) => typeof t.npcHit !== 'number'), '(e) the kited mod never landed a swing');
        }
      }
      // The ladder survives in the saved file itself.
      const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      assert(saved.users.s22win.profile.modLadder.wins.t1 === 3, '(e) t1 = 3 persisted in the saved DB');
      // Tier 2 now starts — and walking away after the countdown forfeits.
      standAt(Win, 700, 280); // kite spot for Mod Blair (800,280)
      const m2 = Win.mark();
      Win.send({ type: 'mod_duel_start', id: 'mod2' });
      const start2 = (await Win.waitSince(m2, (e) => e.type === 'mod_duel' && e.phase === 'start', 10000, 'tier 2 start')).e;
      assert(start2.stake === 200 && start2.profile.gold === expected - 200, `(e) Tier 2 starts with 200g escrowed (gold ${start2.profile.gold})`);
      await Win.waitSince(m2, (e) => e.type === 'mod_duel' && e.phase === 'tick' && e.countdownLeft === 0, 15000, 'tier 2 countdown over');
      standAt(Win, 700, 700); // far beyond NPC_RANGE from Blair
      const end2 = (await Win.waitSince(m2, (e) => e.type === 'mod_duel' && e.phase === 'end', 20000, 'tier 2 forfeit end')).e;
      assert(end2.result === 'forfeit' && end2.payout === 0, `(e) walking away forfeits (result=${end2.result})`);
      const p2 = await snap('S22Win');
      assert(p2.gold === expected - 200 && p2.modLadder.wins.t2 === 0, `(e) the forfeit kept the 200g stake (gold ${p2.gold}) and recorded no win`);
      console.log('PASS (e) three wins, unlock, persistence, forfeit');
    }

    // ---------- (f) disconnect forfeits; the mod is free again ----------
    const Quit = await login('S22Quit', PW('S22Quit')); clients.push(Quit);
    {
      standAt(Quit, 600, 300);
      const mQ = Quit.mark();
      Quit.send({ type: 'mod_duel_start', id: 'mod1' });
      const startQ = (await Quit.waitSince(mQ, (e) => e.type === 'mod_duel' && e.phase === 'start', 10000, 'quit fight start')).e;
      assert(startQ.profile.gold === 400, `(f) stake escrowed before the disconnect (gold ${startQ.profile.gold})`);
      Quit.close();
      clients.splice(clients.indexOf(Quit), 1);
      await sleep(2500);
      const after = await snap('S22Quit');
      assert(after.gold === 400 && after.modLadder.wins.t1 === 0, `(f) after reconnect the stake is still gone and no win was recorded (gold ${after.gold})`);
      const Quit2 = await login('S22Quit', PW('S22Quit')); clients.push(Quit2);
      const board = await Quit2.waitFor((e) => e.type === 'mod_npcs', 10000, 'mod_npcs after forfeit');
      assert(board.npcs.find((n) => n.id === 'mod1').busy === false, '(f) Mod Ash is free again after the forfeit');
      console.log('PASS (f) disconnect forfeit');
    }

    console.log('ALL STAGE 22 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
