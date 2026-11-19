// Stage 12 tests: OSRS fight pacing — Derek: "when a fight starts
// make it more realistic to how OSRS mechanics was."
//   - Duels: a 5-tick countdown (3.0s) with movement frozen and no
//     swings; both fighters start UN-engaged and swing only after
//     tapping to attack ({type:'duel_attack'}) — first swing on
//     the next tick after the countdown, then once per MELEE_SPEED
//     (4 ticks = 2.4s, the OSRS sword speed). There is NO
//     auto-retaliate in duels (Derek: "players have to tap attack
//     to retaliate"): a fighter who is hit but never taps lands
//     zero swings, however often they are hit. Duel rolls are
//     equalised at DUEL_LEVEL = 40 for both fighters. Dragon Slash
//     rides the fighter's next DUE swing — never a non-swing tick.
//     Every swing carries an outcome: 'hit' (damage > 0),
//     'blocked' (connected but fully stopped), 'miss' (accuracy
//     failed).
//   - Goblin fights: the player engages by tapping the goblin and
//     swings one weapon-speed after engagement; the GOBLIN's swings
//     stay locked until the player's first connected swing lands on
//     it, then it unlocks, first swing one weapon-speed later.
// Hit fields are the honest signal: null means "no swing this
// tick" (the Stage 8 convention), a number means a swing happened
// (0 = it missed / was blocked). Potion use mid-duel broadcasts an
// extra duel_tick with a "used ... (+N HP)" note — those are not
// timer ticks and are excluded from every count below.
//
// Same harness style as test/stage10.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., gear seeded by editing
// the test DB file while the server is stopped.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18096;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage12.json');
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
  await sleep(400); // let the file store's debounced flush land first
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

const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const isPotionTick = (e) => !!(e.note && /used .+ \(\+\d+ HP\)/.test(e.note));

function latestNpcState(c) {
  for (let i = c.events.length - 1; i >= 0; i--) if (c.events[i].type === 'npc_state') return c.events[i];
  return null;
}
// Run one full goblin fight for G against a fresh goblin; returns
// { end, ticks } (ticks = the npc_fight tick messages, in order).
async function goblinFight(G) {
  const ns = latestNpcState(G);
  assert(ns && ns.npcs.some((n) => n.hp === n.maxHp), 'goblin fight setup: a fresh goblin is alive in the latest npc_state');
  const g = ns.npcs.find((n) => n.hp === n.maxHp);
  const mG = G.mark();
  G.send({ type: 'move', x: g.x, y: g.y }); // stand on the goblin: in reach from the first tick
  G.send({ type: 'attack_npc', id: g.id });
  const end = (await G.waitSince(mG, (e) => e.type === 'npc_fight' && e.phase === 'end', 90000, 'goblin fight end')).e;
  const ticks = G.events.slice(mG).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
  return { end, ticks };
}

async function main() {
  // Source-level checks: the Stage 12 constants exist.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/const OPENING_TICKS = 3/.test(src), 'source: OPENING_TICKS = 3 exists');
  assert(/const COUNTDOWN_TICKS = 5/.test(src), 'source: COUNTDOWN_TICKS = 5 exists');
  assert(/const MELEE_SPEED = 4/.test(src), 'source: MELEE_SPEED = 4 exists');
  assert(/const DUEL_LEVEL = 40/.test(src), 'source: DUEL_LEVEL = 40 exists');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Setup: duel pairs + equality pair + goblin -------
    for (const n of ['S12Alpha', 'S12Beta', 'S12IdleA', 'S12IdleB', 'S12CountA', 'S12CountB', 'S12EqL1', 'S12EqL50', 'S12Gob']) {
      const c = await register(n, 's12-pass-' + n);
      clients.push(c); c.close();
    }
    await stopServer();
    seedDb((data) => {
      for (const n of ['S12Alpha', 'S12Beta', 'S12IdleA', 'S12IdleB', 'S12CountA', 'S12CountB', 'S12EqL1', 'S12EqL50']) {
        const p = data.users[n.toLowerCase()].profile;
        p.worn = { ...STEEL };
        // Stage 16 (flagged seed fix): the 100 starter coins stay
        // in the seeded backpack AS the gold stack — gold is an
        // item now, and the 1g challenge stakes below validate
        // against the stacks (goldTotal), not the pouch number.
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'restore_potion', qty: 99 }];
      }
      // Equality pair: S12EqL50 really is level 50 in Attack,
      // Strength and Defence (101,333 XP is the OSRS level-50
      // mark); S12EqL1 keeps the fresh-account zeros (level 1).
      const e50 = data.users['s12eql50'].profile;
      e50.xp.attack = 101333; e50.xp.strength = 101333; e50.xp.defence = 101333;
      const g = data.users['s12gob'].profile;
      g.xp.hitpoints = 500000; // ~level 66 HP pool: the goblin cannot win
      // S12Gob deliberately fights UNARMED: max hit 11 < a goblin's
      // 12 HP, so the goblin always survives the player's first
      // connected hit and the retaliate window is always observable.
    });
    await startServer();
    const A = await login('S12Alpha', 's12-pass-S12Alpha'); clients.push(A);
    const B = await login('S12Beta', 's12-pass-S12Beta'); clients.push(B);

    // ---------- (a) Duel pacing, both fighters engaged ------------
    const mA = A.mark(), mB = B.mark();
    A.send({ type: 'challenge', target: 'S12Beta', stake: 1 });
    const inc = await B.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming');
    B.send({ type: 'challenge_response', challengeId: inc.e.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    A.send({ type: 'challenge_confirm', challengeId: inc.e.challengeId });
    B.send({ type: 'challenge_confirm', challengeId: inc.e.challengeId });
    const startA = (await A.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start')).e;
    assert(startA.countdownTicks === 5, `duel_start carries the countdown length (countdownTicks=${startA.countdownTicks})`);
    // Both fighters tap to attack at once (Stage 12 engagement —
    // taps are accepted during the countdown): their first swings
    // are due on the next tick after the countdown.
    A.send({ type: 'duel_attack' });
    B.send({ type: 'duel_attack' });
    // The fighters spawn toe-to-toe (780 vs 820) and neither ever
    // moves, so no tick is a closing tick: every duel_tick in A's
    // stream is a timer tick, apart from potion broadcasts.
    let idx = mA;
    const ticks = []; // timer ticks only, in arrival order
    let aSwings = 0, bSwings = 0, firstSwingAt = 0;
    let specialQueued = false, specialOnSwing = false, specialOffSwing = false;
    let outcomeErrors = 0, missesSeen = 0, countdownErrors = 0;
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline && aSwings < 60) {
      let progressed = false;
      for (; idx < A.events.length; idx++) {
        const e = A.events[idx];
        if (e.type !== 'duel_tick' || isPotionTick(e)) continue;
        progressed = true;
        ticks.push(e);
        const n = ticks.length;
        // Countdown reporting: tick n carries 5,4,3,2,1 then 0.
        if (e.countdownLeft !== Math.max(0, 5 - (n - 1))) countdownErrors++;
        // Outcome reporting (Stage 12 clarity): a swing tick
        // carries an outcome that agrees with its damage; a
        // non-swing tick carries null outcomes, like its hit fields.
        for (const [hit, outcome] of [[e.youHit, e.youOutcome], [e.oppHit, e.oppOutcome]]) {
          if (typeof hit === 'number') {
            if (!['hit', 'blocked', 'miss'].includes(outcome)) outcomeErrors++;
            else if ((hit > 0) !== (outcome === 'hit')) outcomeErrors++;
            if (outcome === 'miss') missesSeen++;
          } else if (outcome !== null) outcomeErrors++;
        }
        if (typeof e.youHit === 'number') { aSwings++; if (!firstSwingAt) firstSwingAt = n; }
        if (typeof e.oppHit === 'number') { bSwings++; if (!firstSwingAt) firstSwingAt = n; }
        if (e.youSpecial) { if (typeof e.youHit === 'number') specialOnSwing = true; else specialOffSwing = true; }
        if (!specialQueued && e.energyYou >= 50) { A.send({ type: 'special' }); specialQueued = true; }
        if (e.hpYou <= 55) A.send({ type: 'use', item: 'restore_potion' });
        if (e.hpOpponent <= 55) B.send({ type: 'use', item: 'restore_potion' });
      }
      if (!progressed) await sleep(150);
    }
    assert(aSwings >= 60, `duel volume: A swung ${aSwings} times (need 60) over ${ticks.length} ticks`);
    // ADAPTED for the countdown revision (was: first 3 ticks / tick
    // 4, from the engagement build's 3-tick opening): the duel now
    // opens with the 5-tick countdown, so with both fighters
    // tapping at duel start the no-swing window is exactly the
    // countdown and the first swing lands on the tick right after.
    const opening = ticks.slice(0, 5);
    assert(opening.length === 5 && opening.every((t) => t.youHit === null && t.oppHit === null),
      'duel countdown: no swings at all in the 5 countdown ticks (hit fields null, not 0)');
    assert(opening.every((t) => t.hpYou === 99 && t.hpOpponent === 99),
      'duel countdown: zero damage in the 5 countdown ticks (both HP pools still 99)');
    assert(firstSwingAt === 6,
      `duel pacing: the first swing lands exactly on tick 6 (the tick after the 5-tick countdown, for fighters who tap at once); got tick ${firstSwingAt}`);
    assert(countdownErrors === 0, 'duel countdown: every duel_tick reported countdownLeft counting 5,4,3,2,1 then 0');
    assert(outcomeErrors === 0, 'swing outcomes: every swing tick carries an outcome, damage > 0 exactly when the outcome is \'hit\', non-swing ticks carry null');
    assert(missesSeen >= 1, `swing outcomes: at least one 'miss' observed across the duel (${missesSeen} seen)`);
    const expected = ticks.length / 4;
    assert(Math.abs(aSwings - expected) <= 8,
      `duel pacing: A swung ${aSwings} times in ${ticks.length} ticks (ticks/4 = ${expected.toFixed(1)}, tolerance ±8)`);
    assert(Math.abs(bSwings - expected) <= 8,
      `duel pacing: B swung ${bSwings} times in ${ticks.length} ticks (ticks/4 = ${expected.toFixed(1)}, tolerance ±8)`);
    assert(specialQueued && specialOnSwing && !specialOffSwing,
      'duel pacing: Dragon Slash fired riding a real swing tick, and never on a non-swing tick');
    // The duel still settles normally afterwards (forfeit by leaving).
    const mEnd = B.mark();
    A.close();
    const endB = (await B.waitSince(mEnd, (e) => e.type === 'duel_end', 20000, 'duel_end after A left')).e;
    assert(endB.winner === 'S12Beta', 'duel pacing: the paced duel still settles (B wins by forfeit)');

    // ---------- (a3) Countdown: frozen movement, then fighting ---
    const CA = await login('S12CountA', 's12-pass-S12CountA'); clients.push(CA);
    const CB = await login('S12CountB', 's12-pass-S12CountB'); clients.push(CB);
    const cA = CA.mark(), cB = CB.mark();
    CA.send({ type: 'challenge', target: 'S12CountB', stake: 1 });
    const incC = await CB.waitSince(cB, (e) => e.type === 'challenge_incoming', 10000, 'countdown challenge_incoming');
    CB.send({ type: 'challenge_response', challengeId: incC.e.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    CA.send({ type: 'challenge_confirm', challengeId: incC.e.challengeId });
    CB.send({ type: 'challenge_confirm', challengeId: incC.e.challengeId });
    const startC = (await CA.waitSince(cA, (e) => e.type === 'duel_start', 10000, 'countdown duel_start')).e;
    assert(startC.countdownTicks === 5, 'countdown: duel_start announces countdownTicks: 5');
    CA.send({ type: 'duel_attack' });
    CB.send({ type: 'duel_attack' });
    // During the countdown A tries to run to (200, 450). The move
    // must be IGNORED: A's server position stays at the duel-start
    // spot (780, 450) in the state snapshot broadcast in reply.
    // (Stage 13: duel-start spot and the run target are the doubled
    // values; the 40-unit toe-to-toe gap did not scale.)
    const mMove = CA.mark();
    CA.send({ type: 'move', x: 200, y: 450 });
    const snap = (await CA.waitSince(mMove, (e) => e.type === 'state' && e.players.some((p) => p.username === 'S12CountA'), 10000, 'state after countdown move attempt')).e;
    const posCA = snap.players.find((p) => p.username === 'S12CountA');
    assert(posCA.x === 780 && posCA.y === 450,
      `countdown freeze: A's position stayed at the duel-start spot (780,450) despite the move attempt (got ${posCA.x},${posCA.y})`);
    // The first ticks: 5 countdown ticks of silence, then fighting
    // from tick 6 (both fighters engaged and adjacent).
    const cticks = [];
    {
      let cIdx = cA;
      const dl = Date.now() + 60000;
      while (Date.now() < dl && cticks.length < 20) {
        let progressed = false;
        for (; cIdx < CA.events.length; cIdx++) {
          const e = CA.events[cIdx];
          if (e.type !== 'duel_tick' || isPotionTick(e)) continue;
          progressed = true;
          cticks.push(e);
        }
        if (!progressed) await sleep(120);
      }
    }
    assert(cticks.length >= 20, `countdown: collected ${cticks.length} ticks (need 20)`);
    const cd = cticks.slice(0, 5);
    assert(cd.map((t) => t.countdownLeft).join(',') === '5,4,3,2,1',
      `countdown: countdownLeft runs 5,4,3,2,1 (got ${cd.map((t) => t.countdownLeft).join(',')})`);
    assert(cd.every((t) => t.youHit === null && t.oppHit === null && t.hpYou === 99 && t.hpOpponent === 99),
      'countdown: zero damage during the countdown even with both fighters engaged and adjacent');
    assert(cticks[5].countdownLeft === 0 && typeof cticks[5].youHit === 'number' && typeof cticks[5].oppHit === 'number',
      'countdown: fighting starts on tick 6 — countdownLeft 0 and both engaged fighters swing');
    assert(cticks.slice(5).some((t) => t.hpYou < 99 || t.hpOpponent < 99),
      'countdown: damage flows after the countdown ends');
    const mEndC = CB.mark();
    CA.close();
    const endCB = (await CB.waitSince(mEndC, (e) => e.type === 'duel_end', 20000, 'countdown duel_end after CA left')).e;
    assert(endCB.winner === 'S12CountB', 'countdown: the countdown duel still settles (B wins by forfeit)');

    // ---------- (a2) No auto-retaliate: tap to fight back --------
    // REVERSED expectation (Derek's clarification): the previous
    // build auto-engaged a hit defender, whose first swing came
    // exactly 4 ticks after the first connected hit. Now a duelist
    // engages ONLY with their own duel_attack: a defender who is
    // hit repeatedly but never taps lands ZERO swings across the
    // whole window; once they do tap, their swings begin.
    const IA = await login('S12IdleA', 's12-pass-S12IdleA'); clients.push(IA);
    const IB = await login('S12IdleB', 's12-pass-S12IdleB'); clients.push(IB);
    const iA = IA.mark(), iB = IB.mark();
    IA.send({ type: 'challenge', target: 'S12IdleB', stake: 1 });
    const incI = await IB.waitSince(iB, (e) => e.type === 'challenge_incoming', 10000, 'idle challenge_incoming');
    IB.send({ type: 'challenge_response', challengeId: incI.e.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    IA.send({ type: 'challenge_confirm', challengeId: incI.e.challengeId });
    IB.send({ type: 'challenge_confirm', challengeId: incI.e.challengeId });
    await IA.waitSince(iA, (e) => e.type === 'duel_start', 10000, 'idle duel_start');
    // NEITHER fighter sends duel_attack: collect 30 timer ticks.
    const idleTicks = [];
    {
      let iIdx = iA;
      const dl = Date.now() + 60000;
      while (Date.now() < dl && idleTicks.length < 30) {
        let progressed = false;
        for (; iIdx < IA.events.length; iIdx++) {
          const e = IA.events[iIdx];
          if (e.type !== 'duel_tick' || isPotionTick(e)) continue;
          progressed = true;
          idleTicks.push(e);
        }
        if (!progressed) await sleep(120);
      }
    }
    assert(idleTicks.length >= 30, `idle duel: collected ${idleTicks.length} ticks with nobody engaged (need 30)`);
    assert(idleTicks.every((t) => t.youHit === null && t.oppHit === null && t.hpYou === 99 && t.hpOpponent === 99),
      'idle duel: zero damage and no swings at all for 30 ticks while neither fighter taps to attack');
    // IA taps; IB never does (yet). Collect until IA has landed
    // THREE damaging hits on IB. Under the old rule IB would have
    // engaged on the first of them; now IB must stay completely
    // silent — no swings, no damage dealt — the whole time. IB
    // sips potions to survive the beating.
    IA.send({ type: 'duel_attack' });
    const rt = []; // every timer tick of the duel, absolute order
    let rtIdx = iA; // stateful scan position across both phases
    const collectUntil = async (done, timeoutMs) => {
      const dl = Date.now() + timeoutMs;
      while (Date.now() < dl && !done()) {
        let progressed = false;
        for (; rtIdx < IA.events.length; rtIdx++) {
          const e = IA.events[rtIdx];
          if (e.type !== 'duel_tick' || isPotionTick(e)) continue;
          progressed = true;
          rt.push(e);
          if (e.hpOpponent < 60) IB.send({ type: 'use', item: 'restore_potion' });
        }
        if (!progressed) await sleep(120);
      }
    };
    await collectUntil(() => rt.filter((t) => typeof t.youHit === 'number' && t.youHit > 0).length >= 3, 180000);
    const hitsOnB = rt.filter((t) => typeof t.youHit === 'number' && t.youHit > 0).length;
    const aFirstIdx = rt.findIndex((t) => typeof t.youHit === 'number'); // 0-based
    assert(aFirstIdx >= 30, `no-retaliate: the tapping fighter's first swing comes after the tap (tick ${aFirstIdx + 1})`);
    assert(hitsOnB >= 3, `no-retaliate: the tapper landed repeated hits on the idle defender (${hitsOnB} damaging hits)`);
    assert(rt.every((t) => t.oppHit === null),
      'no-retaliate: the defender landed ZERO swings across the whole window despite being hit repeatedly (no duel_attack sent)');
    assert(rt.every((t) => t.hpYou === 99),
      'no-retaliate: the tapper took zero damage while the defender stayed un-engaged');
    // NOW IB taps: their swings must begin on the next tick.
    const tapAt = rt.length; // ticks already observed when IB taps
    IB.send({ type: 'duel_attack' });
    await collectUntil(() => rt.some((t) => typeof t.oppHit === 'number'), 60000);
    const bFirstIdx = rt.findIndex((t) => typeof t.oppHit === 'number'); // 0-based
    assert(bFirstIdx >= tapAt && bFirstIdx <= tapAt + 2,
      `no-retaliate: after the defender's own tap, their first swing begins at once (tap after tick ${tapAt}, first swing tick ${bFirstIdx + 1})`);
    assert(rt.slice(0, bFirstIdx).every((t) => t.hpYou === 99),
      'no-retaliate: the tapper was still untouched on every tick before the defender\'s first swing');
    const mEndI = IB.mark();
    IA.close();
    const endIB = (await IB.waitSince(mEndI, (e) => e.type === 'duel_end', 20000, 'idle duel_end after IA left')).e;
    assert(endIB.winner === 'S12IdleB', 'no-retaliate: the idle duel still settles (B wins by forfeit)');

    // ---------- (b) Goblin pacing + retaliate unlock --------------
    const G = await login('S12Gob', 's12-pass-S12Gob'); clients.push(G);
    G.send({ type: 'travel', to: 'goblins' });
    await G.waitFor((e) => e.type === 'area' && e.area === 'goblins', 10000, 'in the goblin camp');
    await G.waitFor((e) => e.type === 'npc_state', 10000, 'npc_state on entry');
    const f1 = await goblinFight(G);
    const gticks = f1.ticks;
    assert(gticks.length >= 4, `goblin pacing: the fight produced ${gticks.length} ticks`);
    const first3 = gticks.slice(0, 3);
    assert(first3.every((t) => t.youHit === null && t.npcHit === null),
      'goblin pacing: no swings in the first 3 ticks after engagement (hit fields null)');
    assert(first3.every((t) => t.hpNpc === t.maxHpNpc && t.hpYou === t.maxHpYou),
      'goblin pacing: no damage dealt or taken in the first 3 ticks after engagement');
    const firstSwingIdx = gticks.findIndex((t) => typeof t.youHit === 'number' || typeof t.npcHit === 'number') + 1;
    assert(firstSwingIdx >= 4,
      `goblin pacing: the first swing comes at tick ${firstSwingIdx} (>= 4 — one weapon-speed after engagement)`);
    assert(f1.end.reason === 'kill', `goblin pacing: the player still wins the fight (reason=${f1.end.reason})`);
    // Retaliate unlock: against the NPC defender a swing connects
    // exactly when it deals damage (youHit > 0; 0 is a miss, null
    // is no swing). The goblin must not swing before — or even on —
    // that tick, and its first swing must land exactly one
    // weapon-speed (4 ticks) after it.
    const gConnectIdx = gticks.findIndex((t) => typeof t.youHit === 'number' && t.youHit > 0);
    assert(gConnectIdx >= 0, 'goblin unlock: the player landed a connected swing');
    assert(gticks.slice(0, gConnectIdx + 1).every((t) => t.npcHit === null),
      'goblin unlock: the goblin never swung before (or on) the tick of the player\'s first connected hit');
    const gFirstNpcIdx = gticks.findIndex((t) => typeof t.npcHit === 'number');
    assert(gFirstNpcIdx === gConnectIdx + 4,
      `goblin unlock: the goblin's first swing comes exactly one weapon-speed after the unlock (hit tick ${gConnectIdx + 1}, first swing tick ${gFirstNpcIdx + 1})`);
    // And the unlocked goblin actually deals damage, sooner or
    // later (its swings connect 55% of the time; if this fight's
    // goblin whiffed every swing, watch up to two more fights).
    let sawMonsterDamage = gticks.some((t) => typeof t.npcHit === 'number' && t.npcHit > 0);
    for (let extra = 0; extra < 2 && !sawMonsterDamage; extra++) {
      const fx = await goblinFight(G);
      sawMonsterDamage = fx.ticks.some((t) => typeof t.npcHit === 'number' && t.npcHit > 0);
    }
    assert(sawMonsterDamage, 'goblin unlock: once unlocked, the goblin lands real damage on the player');

    // ---------- (c) DUEL_LEVEL equality: harness + live duel ------
    // The duel path is driven two ways. (1) A VM harness loads the
    // REAL server.js with ws/store stubbed (store.init never
    // resolves, so nothing listens) and calls its roll functions
    // directly — the style the Stage 10 suite pioneered. (2) A live
    // WS duel between a level-1 and a level-50 fighter sanity-
    // checks that the duel tick really rolls under the cap.
    {
      const vm = require('vm');
      const sandbox = {
        console, Buffer, URL,
        setTimeout, clearTimeout,
        setInterval: () => 0, clearInterval: () => {}, // no background timers in the harness
        process: { env: {}, exit: () => {} },
        __dirname: ROOT, __filename: path.join(ROOT, 'server.js'),
        require: (name) => {
          if (name === 'ws') return { WebSocketServer: class { constructor() {} on() {} } };
          if (name === './store') return { createStore: () => ({ init: () => new Promise(() => {}), putUser: async () => {}, flush: async () => {} }) };
          return require(name);
        },
      };
      vm.createContext(sandbox);
      vm.runInContext(src, sandbox, { filename: 'server.js' });
      const F = (expr) => vm.runInContext(expr, sandbox);
      const hitChance = F('hitChance'), maxHit = F('maxHit'), rollHitDetail = F('rollHitDetail'), rollPlayerAttack = F('rollPlayerAttack'), levelsOf = F('levelsOf');
      assert(F('DUEL_LEVEL') === 40, 'equality: DUEL_LEVEL is 40');
      const mkFighter = (xp) => ({ style: 'accurate', xp: { attack: xp, strength: xp, defence: xp, hitpoints: 1154 }, worn: { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null }, specialEnergy: 100 });
      const L1 = mkFighter(0);        // level 1 in Attack/Strength/Defence
      const L50 = mkFighter(101333);  // level 50 (101,333 XP is the OSRS mark)
      assert(levelsOf(L1).attack === 1 && levelsOf(L50).attack === 50 && levelsOf(L50).strength === 50 && levelsOf(L50).defence === 50,
        'equality: the harness fighters really are level 1 and level 50');
      // Max hit: identical under the duel override (steel sword,
      // accurate): 11 + floor((40-1)/3) + 4 = 28 for BOTH.
      assert(maxHit(L1, false, 40) === 28 && maxHit(L50, false, 40) === 28,
        `equality: duel max hit is 28 for the level-1 and the level-50 fighter alike (got ${maxHit(L1, false, 40)} / ${maxHit(L50, false, 40)})`);
      // ...while the non-duel computation still separates them.
      assert(maxHit(L1, false) === 15 && maxHit(L50, false) === 31,
        `equality: without the override the max hits still differ by level (15 vs 31; got ${maxHit(L1, false)} / ${maxHit(L50, false)})`);
      // Hit chance: exactly equal both directions under the
      // override (identical effective levels in, identical number
      // out), and wildly different without it.
      const eqAB = hitChance(L1, L50, false, 40), eqBA = hitChance(L50, L1, false, 40);
      assert(eqAB === eqBA && eqAB > 0.5 && eqAB < 0.62,
        `equality: duel hit chance is the same both ways (${eqAB.toFixed(4)} vs ${eqBA.toFixed(4)})`);
      assert(hitChance(L50, L1, false) > 0.85 && hitChance(L1, L50, false) < 0.2,
        `equality: without the override the hit chances still differ by level (${hitChance(L50, L1, false).toFixed(3)} vs ${hitChance(L1, L50, false).toFixed(3)})`);
      // The Accurate style edge under equalisation, exactly: an
      // Accurate attacker connects ~+2.7pts more often than an
      // Aggressive one against the same defender at DUEL_LEVEL
      // (the +3 Attack boost is worth less, relatively, at level
      // 40 than the ~+11.8pts it was worth at level 1 — which is
      // why stage10's WS-measured +4pt threshold could not survive
      // DUEL_LEVEL and its strict edge proof lives here now).
      const accF = { ...L1, style: 'accurate' }, aggF = { ...L1, style: 'aggressive' };
      const accEdge = hitChance(accF, L50, false, 40) - hitChance(aggF, L50, false, 40);
      assert(accEdge > 0.02 && accEdge < 0.04,
        `equality: Accurate's hit-chance edge at DUEL_LEVEL is +${(accEdge * 100).toFixed(1)}pts (formula: ~+2.7)`);
      // The Aggressive max-hit edge, exactly: +3 Strength crosses
      // one more /3 step, so the caps are 29 vs 28 — the +0.5
      // expected damage per landed swing that stage10's WS arm 3
      // samples noisily (at DUEL_LEVEL the 1..29 spread makes the
      // sampled gap's sigma ~0.6, so its old -0.1 threshold flaked
      // ~16% of runs; the strict proof lives here).
      assert(maxHit(aggF, false, 40) === 29 && maxHit(accF, false, 40) === 28,
        `equality: Aggressive's duel cap beats Accurate's by exactly 1 (29 vs 28; got ${maxHit(aggF, false, 40)} / ${maxHit(accF, false, 40)})`);
      // Statistical: 20k rolled swings each way under the override
      // connect at the same rate; rolled damage never passes the
      // equalised cap, while the un-overridden level-50 roll does.
      let cAB = 0, cBA = 0, maxEq = 0, maxReal = 0;
      for (let i = 0; i < 20000; i++) {
        if (rollHitDetail(L1, L50, false, 40).connected) cAB++;
        if (rollHitDetail(L50, L1, false, 40).connected) cBA++;
        const dEq = rollPlayerAttack(L50, L1, false, 40).dmg;
        if (dEq > maxEq) maxEq = dEq;
        const dReal = rollPlayerAttack(L50, L1, false).dmg;
        if (dReal > maxReal) maxReal = dReal;
      }
      assert(Math.abs(cAB / 20000 - cBA / 20000) < 0.03,
        `equality: rolled connect rates match under the override (${(cAB / 20000).toFixed(3)} vs ${(cBA / 20000).toFixed(3)})`);
      assert(maxEq <= 28 && maxEq >= 26, `equality: 20k overridden swings topped out at ${maxEq} (cap 28)`);
      assert(maxReal >= 30, `equality: 20k un-overridden level-50 swings topped out at ${maxReal} (real cap 31 — the override is what holds duels to 28)`);
    }
    // Live WS sanity: level-1 vs level-50, both steel swords. If
    // the duel tick forgot the override, the level-50 fighter
    // would hit up to 31 and the level-1 fighter could never pass
    // 15; under DUEL_LEVEL both are capped at 28 and the level-1
    // fighter regularly hits 17+.
    const E1 = await login('S12EqL1', 's12-pass-S12EqL1'); clients.push(E1);
    const E50 = await login('S12EqL50', 's12-pass-S12EqL50'); clients.push(E50);
    const eA = E1.mark(), eB = E50.mark();
    E1.send({ type: 'challenge', target: 'S12EqL50', stake: 1 });
    const incE = await E50.waitSince(eB, (e) => e.type === 'challenge_incoming', 10000, 'equality challenge_incoming');
    E50.send({ type: 'challenge_response', challengeId: incE.e.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    E1.send({ type: 'challenge_confirm', challengeId: incE.e.challengeId });
    E50.send({ type: 'challenge_confirm', challengeId: incE.e.challengeId });
    await E1.waitSince(eA, (e) => e.type === 'duel_start', 10000, 'equality duel_start');
    E1.send({ type: 'duel_attack' });
    E50.send({ type: 'duel_attack' });
    {
      let eIdx = eA;
      let youDmg = 0, oppDmg = 0, youSwings = 0, oppSwings = 0, maxYou = 0, maxOpp = 0;
      const dl = Date.now() + 600000;
      while (Date.now() < dl && (youDmg < 40 || oppDmg < 40)) {
        let progressed = false;
        for (; eIdx < E1.events.length; eIdx++) {
          const e = E1.events[eIdx];
          if (e.type !== 'duel_tick' || isPotionTick(e)) continue;
          progressed = true;
          if (typeof e.youHit === 'number') { youSwings++; if (e.youHit > 0) { youDmg++; if (e.youHit > maxYou) maxYou = e.youHit; } }
          if (typeof e.oppHit === 'number') { oppSwings++; if (e.oppHit > 0) { oppDmg++; if (e.oppHit > maxOpp) maxOpp = e.oppHit; } }
          if (e.hpYou < 55) E1.send({ type: 'use', item: 'restore_potion' });
          if (e.hpOpponent < 55) E50.send({ type: 'use', item: 'restore_potion' });
        }
        if (!progressed) await sleep(120);
      }
      assert(youDmg >= 40 && oppDmg >= 40, `equality duel: collected enough damaging swings (${youDmg} by the level-1, ${oppDmg} by the level-50)`);
      assert(maxYou <= 28 && maxOpp <= 28, `equality duel: neither fighter ever beat the equalised cap of 28 (max ${maxYou} / ${maxOpp})`);
      assert(maxYou >= 17, `equality duel: the level-1 fighter hit ${maxYou} — impossible at their real cap of 15, so the duel really rolled at DUEL_LEVEL`);
      const rateYou = youDmg / Math.max(1, youSwings), rateOpp = oppDmg / Math.max(1, oppSwings);
      assert(Math.abs(rateYou - rateOpp) <= 0.2, `equality duel: connect rates are in the same band (${rateYou.toFixed(2)} vs ${rateOpp.toFixed(2)})`);
    }
    const mEndE = E50.mark();
    E1.close();
    const endE50 = (await E50.waitSince(mEndE, (e) => e.type === 'duel_end', 20000, 'equality duel_end after E1 left')).e;
    assert(endE50.winner === 'S12EqL50', 'equality duel: the equality duel still settles (L50 wins by forfeit)');

    for (const c of clients) c.close();
    console.log('ALL STAGE 12 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
