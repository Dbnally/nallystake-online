// Stage 28 tests: the Barrows alignment rebuild — the app
// (artifact) version's layout, fights and looks on the online game.
//   - Every mound enters a CRYPT (one room, sarcophagus at its
//     centre); searching the sarcophagus starts the fight there and
//     the brother spawns ADJACENT to the player (<= melee reach).
//   - The tunnel crypt offers NO crypt fight: its sarcophagus is
//     the way down. A slain brother's mound refuses entry, while
//     the tunnel mound still lets you in and down.
//   - Brothers MOVE: a melee brother chases the player across the
//     crypt and still lands swing opportunities (nobody gets stuck).
//   - The tunnels are a maze: prayer drains at ~2x the surface rate
//     down there; the puzzle door is the app's pattern puzzle and a
//     WRONG answer costs exactly 5 HP off the tunnel HP pool (the
//     same puzzle stays open); the tunnel brother AMBUSHES (at the
//     door or guaranteed at the chest room) spending that pool.
//   - Loot is the app's table: rolls = kills + 1, per-roll piece
//     chance 1/(450 - 58 x kills); the breakdown reports one line
//     per roll and the gold total equals the coin lines' sum; the
//     run resets and re-randomises.
//   - Death mid-run keeps kills, tunnel and the solved puzzle.
//   - The app's drains: Torag's landed hits set runDrainedUntil,
//     Ahrim's sap Strength, Karil's sap Attack (drains fields ride
//     the fight ticks).
//   - Stage 28b: the Barrows TIER armour line (a separate 1-in-20
//     roll on a 6/6 clear, at most one piece, the earned worn-set
//     ladder — exercised statistically over 60 seeded chests) and
//     the completed-runs counter (increments on every loot and
//     rides the loot message).
//
// Same harness style as test/stage5.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., strong players seeded by
// editing the test DB file while the server is stopped.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18128;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage28.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

const MOUNDS = {
  dharok: { x: 300, y: 220 }, guthan: { x: 660, y: 160 }, torag: { x: 1020, y: 160 },
  verac: { x: 1320, y: 220 }, ahrim: { x: 480, y: 440 }, karil: { x: 1120, y: 440 },
};
const BROTHER_TYPE = { dharok: 'melee', guthan: 'melee', torag: 'melee', verac: 'melee', ahrim: 'magic', karil: 'missiles' };
const ALL_BROTHERS = Object.keys(MOUNDS);
const MELEE_REACH = 42;

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
function ensurePrayer(c, want) {
  const p = c.profile();
  if (!p || p.activePrayer !== want) c.send({ type: 'prayer', prayer: want });
}

// Drive an instanced Barrows fight to its end (stage5 pattern):
// matching Deflect prayer up, prayer potion every 20 ticks, eat at
// <= 40 HP. Records whether the brother ever swung (npcHit numeric
// — his swing opportunity) and, when chaseTo is given, whether the
// brother's live position closed to within melee reach of it.
async function driveBarrowsKillEx(c, brotherId, fromIdx, chaseTo = null) {
  ensurePrayer(c, BROTHER_TYPE[brotherId]);
  let idx = fromIdx;
  let sawNpcSwing = false;
  let chaseOk = !chaseTo;
  const deadline = Date.now() + 240000;
  let ticks = 0;
  while (Date.now() < deadline) {
    const t = await c.waitSince(idx, (e) => e.type === 'npc_fight' && e.kind === 'barrows' && (e.phase === 'tick' || e.phase === 'end'), 30000, 'barrows tick/end').catch(() => null);
    if (!t) break;
    idx = t.idx + 1;
    if (t.e.phase === 'end') return { end: t.e, sawNpcSwing, chaseOk };
    ticks++;
    if (typeof t.e.npcHit === 'number') sawNpcSwing = true;
    if (chaseTo && typeof t.e.bx === 'number' && Math.hypot(t.e.bx - chaseTo.x, t.e.by - chaseTo.y) <= MELEE_REACH) chaseOk = true;
    // Walk back in on closing ticks (what a player does): a
    // magic/ranged brother who ambushed at the door does not chase,
    // so standing across the room would stall the fight forever.
    // Skipped in the chase check, whose whole point is standing
    // still at the far side while the brother comes to us.
    if (!chaseTo && t.e.closing && t.e.moveTo) c.send({ type: 'move', x: t.e.moveTo.x, y: t.e.moveTo.y });
    ensurePrayer(c, BROTHER_TYPE[brotherId]);
    if (ticks % 20 === 0) c.send({ type: 'use', item: 'prayer_potion' });
    if (t.e.hpYou <= 40) c.send({ type: 'use', item: 'restore_potion' });
  }
  throw new Error(`barrows fight vs ${brotherId} did not end in time`);
}

// Top prayer points up to (near) full with prayer potions.
async function topUpPrayer(c) {
  for (let i = 0; i < 6; i++) {
    const p = c.profile();
    if (p && p.prayerPoints >= 24.9) return;
    const m = c.mark();
    c.send({ type: 'use', item: 'prayer_potion' });
    await c.waitSince(m, (e) => e.type === 'profile' || e.type === 'error', 8000, 'potion profile').catch(() => null);
    await sleep(200);
  }
}
// Measure the prayer drain over 6 seconds: prayer on, wait, toggle
// off and read the settled points from the profile the toggle sends.
async function measureDrain(c) {
  await topUpPrayer(c);
  ensurePrayer(c, 'melee');
  await sleep(300);
  const p0 = c.profile().prayerPoints;
  await sleep(6000);
  const m = c.mark();
  c.send({ type: 'prayer', prayer: 'melee' }); // toggle off -> profile settles
  const settled = (await c.waitSince(m, (e) => e.type === 'profile' && e.profile.activePrayer === null, 8000, 'prayer-off profile')).e;
  return p0 - settled.profile.prayerPoints;
}

async function main() {
  // Source-level checks for the Stage 28b wiring (the 1-in-20 tier
  // roll itself is statistical — it is exercised in the batch test
  // at the end of this suite).
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/killCount === 6 && Math\.random\(\) < 1 \/ 20/.test(src), 'source: the tier prize rolls 1-in-20, only on a 6/6 clear');
  assert(/function barrowsTierGrant/.test(src) && /function wearingBarrowsTierSet/.test(src), 'source: the earned tier ladder (worn-set gate) is wired');
  assert(/barrowsRuns/.test(src) && /BARROWS_TIER_PIECES/.test(src), 'source: tier pieces + the runs counter exist');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Seed the strong runner (stage5 seed) ----------
    const reg = await register('S28Runner', 's28-runner-pass');
    clients.push(reg);
    reg.close();
    await sleep(400);
    await stopServer();
    seedDb((data) => {
      const u = data.users['s28runner'];
      u.profile.xp.hitpoints = 500000; // level 66 HP pool
      u.profile.worn = {
        weapon: 'dragon_sword', shield: 'dragon_shield', head: 'dragon_helm',
        body: 'dragon_platebody', legs: 'dragon_platelegs', cape: null, amulet: null,
        hands: null, feet: null, ring: null,
      };
      u.profile.backpack = [
        { item: 'gold', qty: 100 },
        { item: 'prayer_potion', qty: 50 },
        { item: 'restore_potion', qty: 50 },
      ];
    });
    await startServer();
    const h = await login('S28Runner', 's28-runner-pass');
    clients.push(h);

    h.send({ type: 'travel', to: 'barrows' });
    const bs0 = await h.waitFor((e) => e.type === 'barrows_state', 10000, 'barrows_state on entry');
    assert(bs0.kills.length === 0 && bs0.tunnel === null && bs0.inCrypt === false && bs0.puzzleSolved === false,
      'barrows: entering the field reports the empty run (no tunnel yet, puzzle unsolved)');

    // ---------- The five crypt fights ----------
    let tunnel = null;
    let chaseChecked = false;
    const killed = [];
    for (const b of ALL_BROTHERS) {
      const m0 = h.mark();
      h.send({ type: 'move', x: MOUNDS[b].x, y: MOUNDS[b].y });
      await sleep(300);
      h.send({ type: 'barrows_enter', brother: b });
      const st = (await h.waitSince(m0, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, `crypt entry state for ${b}`)).e;
      assert(st.crypt === b, `crypts: entering ${b}'s mound puts you in HIS crypt`);
      if (st.tunnel) tunnel = st.tunnel;
      if (b === tunnel) {
        // The tunnel crypt offers the way down, NOT a fight.
        const mS = h.mark();
        h.send({ type: 'barrows_search' });
        await h.waitSince(mS, (e) => e.type === 'error' && /way DOWN/.test(e.message || ''), 10000, 'tunnel crypt search refused');
        assert(!h.events.slice(mS).some((e) => e.type === 'npc_fight'), 'crypts: searching the tunnel sarcophagus starts NO fight');
        console.log(`PASS crypts: the tunnel crypt (${b}) refuses a crypt fight — its sarcophagus is the way down`);
        h.send({ type: 'barrows_leave_crypt' });
        await h.waitSince(h.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'climbed out of the tunnel crypt');
        continue;
      }
      // Walk up to the sarcophagus and search it.
      h.send({ type: 'move', x: 800, y: 470 });
      await sleep(300);
      const mF = h.mark();
      h.send({ type: 'barrows_search' });
      const start = (await h.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, `crypt fight vs ${b}`)).e;
      assert(start.npcId === b, `crypts: searching the sarcophagus starts the fight vs ${start.name}`);
      const spawnDist = Math.hypot(start.bx - 800, start.by - 470);
      assert(typeof start.bx === 'number' && spawnDist <= MELEE_REACH,
        `crypts: ${b} spawns adjacent to the player (distance ${spawnDist.toFixed(1)} <= ${MELEE_REACH})`);
      let chaseTo = null;
      if (!chaseChecked && BROTHER_TYPE[b] === 'melee') {
        // Run across the crypt: the brother must chase and arrive.
        chaseTo = { x: 800, y: 590 };
        h.send({ type: 'move', x: chaseTo.x, y: chaseTo.y });
        chaseChecked = true;
      }
      const { end, sawNpcSwing, chaseOk } = await driveBarrowsKillEx(h, b, mF + 1, chaseTo);
      assert(end.reason === 'kill', `crypts: ${b} killed in his crypt`);
      assert(sawNpcSwing, `crypts: ${b} landed at least one swing opportunity (he reached the player — nobody got stuck)`);
      if (chaseTo) assert(chaseOk, 'crypts: the melee brother CHASED the player across the crypt back into melee reach');
      assert(end.profile.barrows.kills.includes(b), `crypts: the ${b} kill is banked on the run`);
      killed.push(b);
      h.send({ type: 'barrows_leave_crypt' });
      await h.waitSince(h.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'climbed out of the crypt');
      if (killed.length === 1) {
        // A slain brother's mound refuses further crypt actions.
        const mR = h.mark();
        h.send({ type: 'move', x: MOUNDS[b].x, y: MOUNDS[b].y });
        await sleep(300);
        h.send({ type: 'barrows_enter', brother: b });
        await h.waitSince(mR, (e) => e.type === 'error' && /already defeated/.test(e.message || ''), 10000, 'slain mound refusal');
        console.log(`PASS crypts: ${b}'s mound refuses entry now he is slain`);
      }
    }
    assert(killed.length === 5 && tunnel && !killed.includes(tunnel),
      `crypts: five brothers killed in their crypts; the tunnel brother (${tunnel}) was never one of them`);

    // ---------- Prayer drain: surface rate ----------
    const drainSurface = await measureDrain(h);
    assert(drainSurface > 1.2 && drainSurface < 2.8, `prayer drain: surface rate over 6s is ~2 points (measured ${drainSurface.toFixed(2)})`);

    // ---------- Down into the tunnels ----------
    const mTun = h.mark();
    h.send({ type: 'move', x: MOUNDS[tunnel].x, y: MOUNDS[tunnel].y });
    await sleep(300);
    h.send({ type: 'barrows_enter', brother: tunnel });
    const stT = (await h.waitSince(mTun, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'tunnel crypt entry')).e;
    assert(stT.crypt === tunnel, 'tunnels: the tunnel mound still lets you in after the other five are slain');
    h.send({ type: 'barrows_descend' });
    await h.waitSince(mTun, (e) => e.type === 'area' && e.area === 'barrows_tunnels', 10000, 'descended into the tunnels');
    console.log('PASS tunnels: descended through the tunnel crypt');

    // ---------- Prayer drain: double rate underground ----------
    const drainTunnel = await measureDrain(h); // standing in the entry room — no movement, no ambush
    assert(drainTunnel > 3.0 && drainTunnel < 5.6, `prayer drain: tunnel rate over 6s is ~4 points (measured ${drainTunnel.toFixed(2)})`);
    assert(drainTunnel > drainSurface * 1.5, `prayer drain: the tunnel rate (${drainTunnel.toFixed(2)}) is ~2x the surface rate (${drainSurface.toFixed(2)})`);

    // ---------- The puzzle door (the app's pattern puzzle) ----------
    h.send({ type: 'barrows_puzzle' });
    const pz = await h.waitFor((e) => e.type === 'barrows_puzzle', 10000, 'the pattern puzzle');
    assert(Array.isArray(pz.shown) && (pz.shown.length === 5 || pz.shown.length === 7) && pz.shown[pz.shown.length - 1] === '❓',
      `puzzle: the door shows a pattern with its last shape missing (${pz.shown.join(' ')})`);
    assert(Array.isArray(pz.options) && pz.options.length === 3, 'puzzle: three options are offered');
    // Every app pattern family ends with its first shape — the
    // answer is shown[0]; any other option is a guaranteed miss.
    const answerIdx = pz.options.indexOf(pz.shown[0]);
    assert(answerIdx >= 0, 'puzzle: the completing shape is among the options');
    const wrongIdx = pz.options.findIndex((o, i) => i !== answerIdx);
    const mW1 = h.mark();
    h.send({ type: 'barrows_puzzle_answer', index: wrongIdx });
    const w1 = (await h.waitSince(mW1, (e) => e.type === 'barrows_puzzle_result', 10000, 'first wrong answer')).e;
    assert(w1.ok === false && w1.hpYou === w1.maxHpYou - 5,
      `puzzle: a wrong answer costs exactly 5 HP (${w1.hpYou}/${w1.maxHpYou} in the tunnel pool)`);
    const maxHp = w1.maxHpYou;
    const mW2 = h.mark();
    h.send({ type: 'barrows_puzzle_answer', index: wrongIdx });
    const w2 = (await h.waitSince(mW2, (e) => e.type === 'barrows_puzzle_result', 10000, 'second wrong answer')).e;
    assert(w2.ok === false && w2.hpYou === maxHp - 10, 'puzzle: the SAME puzzle stays open — a second wrong answer bites 5 more');
    const mOk = h.mark();
    h.send({ type: 'barrows_puzzle_answer', index: answerIdx });
    const okR = (await h.waitSince(mOk, (e) => e.type === 'barrows_puzzle_result', 10000, 'correct answer')).e;
    assert(okR.ok === true, 'puzzle: the completing shape opens the door');
    const mAgain = h.mark();
    h.send({ type: 'barrows_puzzle' });
    const again = (await h.waitSince(mAgain, (e) => e.type === 'barrows_puzzle_result', 10000, 'puzzle after solving')).e;
    assert(again.ok === true && again.alreadySolved === true, 'puzzle: solved stays solved for the run');

    // ---------- The ambush at the chest ----------
    const mAmb = h.mark();
    h.send({ type: 'move', x: 800, y: 300 }); // through the (solved) door — may spring the door ambush
    await sleep(800);
    h.send({ type: 'move', x: 800, y: 130 }); // into the chest room — guarantees it
    await sleep(800);
    let amb = h.events.slice(mAmb).find((e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows');
    if (!amb) {
      h.send({ type: 'barrows_loot' }); // the backstop: reaching for the chest springs him
      amb = (await h.waitSince(mAmb, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, 'ambush at the chest')).e;
    }
    assert(amb.npcId === tunnel, `ambush: the tunnel brother (${tunnel}) springs in the tunnels — there is no chest guard any more`);
    assert(amb.hpYou === maxHp - 10, `ambush: the fight spends the tunnel HP pool (${amb.hpYou} = ${maxHp} - 10 puzzle damage)`);
    const ambEnd = await driveBarrowsKillEx(h, tunnel, mAmb + 1);
    assert(ambEnd.end.reason === 'kill' && ambEnd.end.profile.barrows.kills.length === 6,
      'ambush: the tunnel brother is killed — the round stands at 6/6');

    // ---------- Loot: the app's table ----------
    h.send({ type: 'move', x: 800, y: 130 });
    await sleep(300);
    const goldBefore = h.profile().gold;
    const mLoot = h.mark();
    h.send({ type: 'barrows_loot' });
    const loot = (await h.waitSince(mLoot, (e) => e.type === 'barrows_loot', 15000, 'chest loot')).e;
    assert(loot.kills === 6 && loot.rolls === 7, `loot: rolls = kills + 1 (${loot.rolls} rolls for 6 kills)`);
    // Stage 28b: the tier prize (1-in-20 at 6/6) adds at most ONE
    // extra line on top of the 7 roll lines.
    const tierLines = loot.lines.filter((l) => l.kind === 'tierpiece' || l.kind === 'tiercoins');
    assert(Array.isArray(loot.lines) && loot.lines.length === 7 + tierLines.length && tierLines.length <= 1,
      'loot: the breakdown shows one line per roll (plus at most one tier-prize line)');
    const coinSum = loot.lines.filter((l) => l.kind === 'coins' || l.kind === 'tiercoins').reduce((s, l) => s + l.gold, 0);
    assert(loot.gold === coinSum, `loot: the gold total (${loot.gold}) equals the coin lines' sum (${coinSum})`);
    assert(loot.profile.gold === goldBefore + loot.gold, 'loot: the gold landed on the profile');
    const pieceLines = loot.lines.filter((l) => l.kind === 'piece' || l.kind === 'tierpiece');
    assert(JSON.stringify(pieceLines.map((l) => l.item).sort()) === JSON.stringify([...(loot.rares || [])].sort()),
      'loot: piece lines and the rares list agree');
    assert(loot.runs === 1 && loot.profile.barrowsRuns === 1,
      'runs counter: the first chest loot counts as completed run #1 (and rides the loot message)');
    assert(loot.profile.barrows.kills.length === 0 && loot.profile.barrows.tunnel === null && loot.profile.barrows.puzzleSolved === false,
      'loot: the run resets (kills, tunnel, puzzle) for a fresh round');
    await h.waitSince(mLoot, (e) => e.type === 'area' && e.area === 'barrows', 10000, 'back on the field after looting');
    const mFresh = h.mark();
    h.send({ type: 'move', x: MOUNDS.dharok.x, y: MOUNDS.dharok.y });
    await sleep(300);
    h.send({ type: 'barrows_enter', brother: 'dharok' });
    const fresh = (await h.waitSince(mFresh, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'fresh run crypt entry')).e;
    assert(fresh.tunnel && ALL_BROTHERS.includes(fresh.tunnel), `loot: the fresh run re-randomised its tunnel crypt (${fresh.tunnel})`);
    h.close();
    await sleep(400);

    // ---------- Death mid-run keeps the run ----------
    const ghost = await register('S28Ghost', 's28-ghost-pass');
    clients.push(ghost);
    ghost.close();
    await sleep(400);
    await stopServer();
    seedDb((data) => {
      const u = data.users['s28ghost'];
      u.profile.barrows = { kills: ['guthan'], tunnel: 'dharok', looted: false, puzzleSolved: true };
      u.profile.worn.weapon = 'dragon_sword'; // connects reliably, so the brother unlocks — but HP 10 and no armour means he wins
    });
    await startServer();
    const g = await login('S28Ghost', 's28-ghost-pass');
    clients.push(g);
    assert(g.profile().barrows.kills.length === 1 && g.profile().barrows.puzzleSolved === true, 'death test: the seeded run is in place');
    g.send({ type: 'travel', to: 'barrows' });
    await g.waitFor((e) => e.type === 'area' && e.area === 'barrows', 10000, 'ghost in the field');
    const mG = g.mark();
    g.send({ type: 'move', x: MOUNDS.dharok.x, y: MOUNDS.dharok.y });
    await sleep(300);
    g.send({ type: 'barrows_enter', brother: 'dharok' });
    await g.waitSince(mG, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'ghost in the tunnel crypt');
    g.send({ type: 'barrows_descend' });
    const gState = (await g.waitSince(mG, (e) => e.type === 'barrows_state' && e.inTunnels === true, 10000, 'ghost in the tunnels')).e;
    assert(gState.kills.length === 1 && gState.tunnel === 'dharok' && gState.puzzleSolved === true,
      'death test: kills, tunnel and the solved puzzle all show underground');
    g.send({ type: 'barrows_leave_tunnel' });
    await g.waitSince(g.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'ghost climbed out');
    const mD = g.mark();
    g.send({ type: 'move', x: MOUNDS.ahrim.x, y: MOUNDS.ahrim.y });
    await sleep(300);
    g.send({ type: 'barrows_enter', brother: 'ahrim' });
    await g.waitSince(mD, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'ghost in Ahrim\'s crypt');
    g.send({ type: 'move', x: 800, y: 470 });
    await sleep(300);
    g.send({ type: 'barrows_search' });
    await g.waitSince(mD, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, 'ghost fighting Ahrim');
    // Stand still: no prayer, no food. Ahrim unlocks on the first
    // connected swing and a 10-HP pool does not last long.
    await g.waitSince(mD, (e) => e.type === 'area' && e.area === 'plaza', 150000, 'ghost wakes in the plaza');
    console.log('PASS death test: the weak runner died in the crypt and woke in the plaza');
    g.close();
    await sleep(400);
    const g2 = await login('S28Ghost', 's28-ghost-pass');
    clients.push(g2);
    const gb = g2.profile().barrows;
    assert(gb.kills.length === 1 && gb.kills[0] === 'guthan' && gb.tunnel === 'dharok' && gb.puzzleSolved === true,
      'death test: after dying AND relogging, kills, tunnel and the solved puzzle all persist');
    g2.close();
    await sleep(400);

    // ---------- The drains ----------
    const dr = await register('S28Drain', 's28-drain-pass');
    clients.push(dr);
    dr.close();
    await sleep(400);
    await stopServer();
    seedDb((data) => {
      const u = data.users['s28drain'];
      u.profile.xp.hitpoints = 500000; // level 66 pool — survives unprayed brothers
      u.profile.worn.weapon = 'bronze_sword'; // no armour: brother hits land for full raw damage
      u.profile.backpack = [
        { item: 'gold', qty: 100 },
        { item: 'prayer_potion', qty: 50 },
        { item: 'restore_potion', qty: 50 },
      ];
      u.profile.barrows = { kills: [], tunnel: 'dharok', looted: false, puzzleSolved: false }; // torag/ahrim/karil are all live crypts
    });
    await startServer();
    const d = await login('S28Drain', 's28-drain-pass');
    clients.push(d);
    d.send({ type: 'travel', to: 'barrows' });
    await d.waitFor((e) => e.type === 'area' && e.area === 'barrows', 10000, 'drain runner in the field');

    async function drainFight(brotherId, field, label, deadlineMs) {
      const m0 = d.mark();
      d.send({ type: 'move', x: MOUNDS[brotherId].x, y: MOUNDS[brotherId].y });
      await sleep(300);
      d.send({ type: 'barrows_enter', brother: brotherId });
      await d.waitSince(m0, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, `in ${brotherId}'s crypt`);
      d.send({ type: 'move', x: 800, y: 470 });
      await sleep(300);
      const mF = d.mark();
      d.send({ type: 'barrows_search' });
      await d.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, `fight vs ${brotherId}`);
      // No prayer, no armour: landed hits are guaranteed to be
      // "through" hits, which is exactly what the drains key off.
      let idx = mF;
      const deadline = Date.now() + deadlineMs;
      let found = false;
      while (Date.now() < deadline && !found) {
        const t = await d.waitSince(idx, (e) => e.type === 'npc_fight' && e.kind === 'barrows' && (e.phase === 'tick' || e.phase === 'end'), 30000, 'drain tick').catch(() => null);
        if (!t) break;
        idx = t.idx + 1;
        if (t.e.phase === 'end') break;
        if (field === 'run' && t.e.drains && t.e.drains.runDrainedUntil > Date.now()) found = true;
        if (field === 'str' && t.e.drains && t.e.drains.strDrain >= 1) found = true;
        if (field === 'acc' && t.e.drains && t.e.drains.accDrain >= 1) found = true;
        if (t.e.hpYou <= 40) d.send({ type: 'use', item: 'restore_potion' });
      }
      assert(found, label);
      const mE = d.mark();
      d.send({ type: 'flee' });
      await d.waitSince(mE, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'fled the drain fight').catch(() => null);
      d.send({ type: 'barrows_leave_crypt' });
      await d.waitSince(d.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'out of the crypt').catch(() => null);
    }
    await drainFight('torag', 'run', 'drains: Torag\'s landed hammers drain the player\'s run (runDrainedUntil set)', 90000);
    await drainFight('ahrim', 'str', 'drains: Ahrim\'s landed hits sap Strength (strDrain >= 1)', 240000);
    await drainFight('karil', 'acc', 'drains: Karil\'s landed hits sap Attack (accDrain >= 1)', 240000);
    d.close();

    // ---------- The Barrows tier line (Stage 28b, statistical batch) ----------
    // The grant is a 1-in-20 roll, so it is exercised across 60
    // seeded 6/6 runs in one server session. Every runner wears
    // nothing, so eligibility is the entry tier: any tier piece
    // granted MUST be a Barrows Bronze piece (the wear-gate's base
    // case), at most one per chest, landing as a rare pile + a
    // collection-log entry — and every loot counts a completed run.
    // P(no grant at all in 60 loots) = 0.95^60 ~= 4.6%.
    const batchNames = [];
    for (let i = 0; i < 60; i++) {
      const nm = `S28T${i}`;
      batchNames.push(nm);
      const rc = await register(nm, 's28-tier-pass');
      clients.push(rc);
      rc.close();
      await sleep(60);
    }
    await sleep(400);
    await stopServer();
    seedDb((data) => {
      for (const nm of batchNames) {
        const u = data.users[nm.toLowerCase()];
        u.profile.barrows = { kills: [...ALL_BROTHERS], tunnel: 'dharok', looted: false, puzzleSolved: true };
      }
    });
    await startServer();
    let tierGrants = 0;
    for (const nm of batchNames) {
      const c = await login(nm, 's28-tier-pass');
      clients.push(c);
      c.send({ type: 'travel', to: 'barrows' });
      await c.waitFor((e) => e.type === 'area' && e.area === 'barrows', 10000, 'batch runner in the field');
      const m0 = c.mark();
      c.send({ type: 'move', x: MOUNDS.dharok.x, y: MOUNDS.dharok.y });
      await sleep(200);
      c.send({ type: 'barrows_enter', brother: 'dharok' });
      await c.waitSince(m0, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'batch crypt entry');
      c.send({ type: 'barrows_descend' });
      await c.waitSince(m0, (e) => e.type === 'area' && e.area === 'barrows_tunnels', 10000, 'batch descended');
      c.send({ type: 'move', x: 800, y: 130 });
      await sleep(200);
      const mL = c.mark();
      c.send({ type: 'barrows_loot' });
      const lt = (await c.waitSince(mL, (e) => e.type === 'barrows_loot', 10000, 'batch loot')).e;
      const tl = lt.lines.filter((l) => l.kind === 'tierpiece' || l.kind === 'tiercoins');
      if (tl.length > 1) throw new Error(`tier line: ${nm} got ${tl.length} tier lines from one chest (max is 1)`);
      if (tl.length === 1 && tl[0].kind === 'tierpiece') {
        tierGrants++;
        if (!tl[0].item.startsWith('barrows_bronze_')) throw new Error(`tier line: an unworn runner was granted ${tl[0].item} — only Barrows Bronze is eligible with no set worn`);
        if (!(lt.rares || []).includes(tl[0].item)) throw new Error('tier line: the granted piece is missing from the rares (loot-beam pile) list');
        const clogEv = [...c.events].reverse().find((e) => e.type === 'clog' && e.found.includes(tl[0].item));
        if (!clogEv) throw new Error('tier line: the granted piece never reached the collection log');
      }
      if (lt.runs !== 1) throw new Error(`runs counter: ${nm}'s first loot reported runs=${lt.runs}`);
      c.close();
      await sleep(120);
    }
    assert(tierGrants >= 1, `tier line: at least one Barrows Bronze piece granted across 60 seeded 6/6 chests (got ${tierGrants})`);
    console.log(`PASS tier line: ${tierGrants} tier piece(s) granted in 60 chests — all Bronze (no set worn), at most one per chest, all in the collection log; every loot counted a run`);

    console.log('ALL STAGE 28 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
