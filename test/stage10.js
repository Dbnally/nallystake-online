// Stage 10 tests: Derek's RuneScape-style combat rebalance, plus the
// inv_swap backpack-reorder message (client drag-to-move).
//   - A swing is an OSRS attack roll vs defence roll (hitChance in
//     server.js): two identical fighters land about half their swings.
//   - Styles are single small effects, one active at a time:
//     Accurate +3 effective Attack (hits more often), Aggressive +3
//     effective Strength (+1 max hit), Defensive 20% flat block,
//     Controlled +1/+1 with a 7% block. The Stage 5 procs (25% extra
//     hit / 25% power hit) are gone.
// Stage 27 supersedes the style EFFECTS (Derek's "Everything"
// decision — match the app version): the base boosts are now
// Accurate +3 Attack, Aggressive +3 Strength, Defensive +3 Defence
// LEVEL (it feeds the defence roll), Controlled +1/+1/+1, and the
// procs are BACK at 25% (Controlled 12%): Accurate bonus extra hit
// (a separate youBonus field — the main-damage measures below are
// untouched by it), Aggressive power hit (folds into the main
// damage), Defensive full block. The source asserts below pin the
// new table; the arms' thresholds were re-derived for the new
// math (see Arm 4). The proc rates themselves are proven exactly
// in test/stage27.js's VM harness.
//
// Method (honest measure): the duel_tick stream exposes DAMAGE, not
// the raw accuracy outcome. With NO armour worn, a connected swing
// always deals >= 1 (raw rolls are 1..max and armour reduction is 0),
// so damage > 0 is exactly "the swing connected" and damage == 0 is
// exactly "missed or style-blocked". All measurement duels are fought
// unarmoured with steel swords for that reason. Fighters sip restore
// potions mid-duel (the use handler heals the duel pool) so a single
// duel yields hundreds of swings; three pairs run concurrently.
// Stage 12 counts only SWING ticks per fighter (their hit field is
// a number) — see collectDuel for the denominator correction.
//
// Same harness style as test/stage8.js: HTTP /api/register + /api/login,
// WebSocket at /ws?token=..., gear seeded by editing the test DB file
// while the server is stopped (the stage4/stage5 pattern).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18094;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage10.json');
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

// One fighter's tallies from a duel_tick stream.
function newStats() { return { swings: 0, landed: 0, dmg: 0, max: 0 }; }
function addSwing(st, dmg) {
  st.swings++;
  if (dmg > 0) { st.landed++; st.dmg += dmg; if (dmg > st.max) st.max = dmg; }
}

// Drive one pair through duel(s), healing both fighters with restore
// potions so the fight lasts, until `target` swings have been counted
// for BOTH fighters (or the deadline passes). Stats are read from A's
// tick stream only: youHit = A's damage, oppHit = B's damage, and the
// hp fields cover both pools. Returns { a: stats, b: stats }.
async function collectDuel(a, b, target, deadlineMs) {
  const stats = { a: newStats(), b: newStats() };
  const deadline = Date.now() + deadlineMs;
  let challenges = 0;
  while (Date.now() < deadline && (stats.a.swings < target || stats.b.swings < target)) {
    challenges++;
    if (challenges > 6) break; // something is wrong; asserts will say so
    const mA = a.mark(), mB = b.mark();
    a.send({ type: 'challenge', target: b.name, stake: 1 });
    const incoming = await b.waitSince(mB, (e) => e.type === 'challenge_incoming', 15000, 'challenge_incoming');
    b.send({ type: 'challenge_response', challengeId: incoming.e.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    a.send({ type: 'challenge_confirm', challengeId: incoming.e.challengeId });
    b.send({ type: 'challenge_confirm', challengeId: incoming.e.challengeId });
    await a.waitSince(mA, (e) => e.type === 'duel_start', 15000, 'duel_start');
    // Stage 12: duel fighters start un-engaged — both tap to attack
    // at once, so every counted swing below is a real engaged swing.
    a.send({ type: 'duel_attack' });
    b.send({ type: 'duel_attack' });
    let idx = mA;
    let ended = false;
    while (Date.now() < deadline && !ended && (stats.a.swings < target || stats.b.swings < target)) {
      let progressed = false;
      for (; idx < a.events.length; idx++) {
        const e = a.events[idx];
        if (e.type === 'duel_end') { ended = true; break; }
        if (e.type !== 'duel_tick' || e.closing) continue;
        // The potion-use handler also broadcasts a duel_tick (youHit 0)
        // with a "used ... (+30 HP)" note — that is not a swing; real
        // combat ticks carry no note at all since Stage 10 (the roll
        // produces no proc notes).
        if (e.note && /used .+ \(\+\d+ HP\)/.test(e.note)) continue;
        // Stage 12 denominator correction: with OSRS swing timers,
        // most duel_ticks are NOT swings — a fighter's hit field is
        // null on every tick where their swing is not due (the 3-tick
        // opening, and 3 of every 4 ticks thereafter). A fighter is
        // counted only on ticks where THEIR OWN field is a number,
        // i.e. ticks where they actually swung. (Before Stage 12
        // every non-closing tick was a swing for both fighters, so
        // counting whole ticks was equivalent.)
        if (typeof e.youHit !== 'number' && typeof e.oppHit !== 'number') continue;
        progressed = true;
        if (typeof e.youHit === 'number') addSwing(stats.a, e.youHit);
        if (typeof e.oppHit === 'number') addSwing(stats.b, e.oppHit);
        if (e.hpYou <= 55) a.send({ type: 'use', item: 'restore_potion' });
        if (e.hpOpponent <= 55) b.send({ type: 'use', item: 'restore_potion' });
      }
      if (!progressed) await sleep(200);
    }
    // If the duel is still running we have our swings; end it by
    // disconnecting A (a mid-duel disconnect settles as a forfeit).
    // These clients are not used again after their pair finishes.
    if (!ended) {
      a.close();
      await b.waitSince(mB, (e) => e.type === 'duel_end', 15000, 'duel_end after forfeit').catch(() => {});
    }
    await sleep(300);
  }
  return stats;
}

async function main() {
  // Source-level checks: the Stage 10 shape is in the server.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/const ACC_BALANCE = 0\.97/.test(src), 'source: ACC_BALANCE tuning constant exists');
  assert(/accurate:\s*\{\s*atkBoost: 3, strBoost: 0, defBoost: 0\s*\}/.test(src), 'source: Accurate is +3 Attack, nothing else');
  assert(/aggressive:\s*\{\s*atkBoost: 0, strBoost: 3, defBoost: 0\s*\}/.test(src), 'source: Aggressive is +3 Strength, nothing else');
  assert(/defensive:\s*\{\s*atkBoost: 0, strBoost: 0, defBoost: 3\s*\}/.test(src), 'source: Defensive is +3 Defence level (Stage 27 — the flat block field is gone)');
  assert(/controlled:\s*\{\s*atkBoost: 1, strBoost: 1, defBoost: 1\s*\}/.test(src), 'source: Controlled is +1/+1/+1 (Stage 27)');
  assert(!/Power hit!/.test(src) && !/Style boost: extra hit!/.test(src), 'source: procs surface as damage fields, never as tick notes (the old Stage 5 note strings stay gone)');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Setup: six identical fighters (level 1, steel sword,
    // no armour, a stack of restore potions), styles set per pair. ----
    const NAMES = ['S10NeuA', 'S10NeuB', 'S10Acc', 'S10Agg', 'S10Atk', 'S10Def'];
    for (const n of NAMES) { const c = await register(n, 's10-pass-' + n); clients.push(c); c.close(); }
    await stopServer();
    seedDb((data) => {
      for (const n of NAMES) {
        const p = data.users[n.toLowerCase()].profile;
        p.worn = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
        // Stage 12 DUEL_LEVEL revision (flagged): the stack was 99.
        // At level-1 damage rates that covered a 500-swing
        // collection (~75 potions of healing per fighter); at
        // DUEL_LEVEL 40 the same collection deals ~55% more damage
        // per swing (~125+ potions per fighter), the fighters ran
        // dry at 480/500 swings and died. 999 makes endurance a
        // non-factor again — this suite measures rates, not
        // potion logistics. No assert depends on the stack size.
        // Stage 16 (flagged seed fix): the 100 starter coins stay
        // in the seeded backpack AS the gold stack — gold is an
        // item now, and the 1g challenge stakes below validate
        // against the stacks (goldTotal), not the pouch number.
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'restore_potion', qty: 999 }];
      }
    });
    await startServer();
    const by = {};
    for (const n of NAMES) { const c = await login(n, 's10-pass-' + n); by[n] = c; clients.push(c); }
    by.S10NeuA.send({ type: 'style', style: 'aggressive' });
    by.S10NeuB.send({ type: 'style', style: 'aggressive' });
    by.S10Acc.send({ type: 'style', style: 'accurate' });
    by.S10Agg.send({ type: 'style', style: 'aggressive' });
    by.S10Atk.send({ type: 'style', style: 'aggressive' });
    by.S10Def.send({ type: 'style', style: 'defensive' });
    await sleep(400);

    // ---------- inv_swap: backpack reorder (client drag-to-move) ---
    const swapC = await register('S10Swap', 's10-pass-swap');
    clients.push(swapC);
    swapC.send({ type: 'shop_buy', item: 'ration', qty: 1 });
    await swapC.waitFor((e) => e.type === 'profile' && (e.profile.backpack || []).some((s) => s.item === 'ration'), 10000, 'ration bought');
    swapC.send({ type: 'shop_buy', item: 'prayer_potion', qty: 1 });
    // Stage 16 (flagged): a fresh backpack now STARTS with the
    // 100-coin gold stack in slot 0, so the two bought stacks sit
    // at slots 1 and 2 and the swap targets those. The wait keys
    // on the prayer potion itself (length >= 2 would already be
    // true after the ration buy: gold + ration).
    const bought = await swapC.waitFor((e) => e.type === 'profile' && (e.profile.backpack || []).some((s) => s.item === 'prayer_potion'), 10000, 'prayer potion bought');
    assert(bought.profile.backpack[0].item === 'gold' && bought.profile.backpack[1].item === 'ration' && bought.profile.backpack[2].item === 'prayer_potion',
      `inv_swap setup: backpack order is [gold, ration, prayer_potion] (${bought.profile.backpack.map((s) => s.item).join(', ')})`);
    const mSwap = swapC.mark();
    swapC.send({ type: 'inv_swap', a: 1, b: 2 });
    const swapped = (await swapC.waitSince(mSwap, (e) => e.type === 'profile', 10000, 'profile after inv_swap')).e;
    assert(swapped.profile.backpack[1].item === 'prayer_potion' && swapped.profile.backpack[2].item === 'ration'
      && swapped.profile.backpack[1].qty === 1 && swapped.profile.backpack[2].qty === 1,
      'inv_swap: slots 1 and 2 swapped in the returned profile, quantities untouched');
    const mOob = swapC.mark();
    swapC.send({ type: 'inv_swap', a: 0, b: 9 });
    await swapC.waitSince(mOob, (e) => e.type === 'error', 10000, 'out-of-bounds inv_swap error');
    const relogin = await api('/api/login', { username: 'S10Swap', password: 's10-pass-swap' });
    assert(relogin.profile.backpack[1].item === 'prayer_potion' && relogin.profile.backpack[2].item === 'ration',
      'inv_swap: out-of-bounds swap rejected with state unchanged (order persists after re-login)');

    // ---------- The three measurement duels, concurrently ----------
    // Stage 12: the deadline rises 12 -> 30 minutes because OSRS
    // swing timers land one swing per fighter per 4 ticks — the
    // 400-500 swings per fighter this suite counts now take ~4x as
    // many ticks to accumulate. The swing targets and the hit-rate
    // band are unchanged.
    const DEADLINE = 30 * 60 * 1000;
    const [neu, accPair, defPair] = await Promise.all([
      collectDuel(by.S10NeuA, by.S10NeuB, 400, DEADLINE),
      collectDuel(by.S10Acc, by.S10Agg, 500, DEADLINE),
      collectDuel(by.S10Atk, by.S10Def, 400, DEADLINE),
    ]);

    // ----- Arm 1: the neutral mirror sits in the ~50/50 band --------
    const neuSwings = neu.a.swings + neu.b.swings;
    const neuLanded = neu.a.landed + neu.b.landed;
    const neuRate = neuLanded / neuSwings;
    assert(neu.a.swings >= 400 && neu.b.swings >= 400,
      `mirror volume: ${neuSwings} swings counted (need 400 per fighter)`);
    assert(neuRate >= 0.40 && neuRate <= 0.60,
      `mirror match (identical fighters, Aggressive — no accuracy contribution): hit rate ${(neuRate * 100).toFixed(1)}% in the 40-60% band around 50/50`);

    // ----- Arm 2: Accurate hits more often than neutral -------------
    // Stage 12 DUEL_LEVEL revision (flagged): this arm used to
    // assert accRate > neuRate + 0.04. That +4pt threshold encoded
    // LEVEL-1 math: at level 1, Accurate's +3 Attack is worth
    // ~+11.8pts of hit chance. Duels now roll at DUEL_LEVEL = 40
    // for both fighters, where the same +3 is worth only ~+2.7pts
    // by the hitChance formula — smaller than any WS sample this
    // suite can feasibly collect can tightly measure (telling
    // 55.6% from 52.9% needs ~3,000 swings per side). The strict
    // edge proof moved to test/stage12.js's VM harness, which
    // calls hitChance directly and checks the exact +2.7pt edge.
    // What remains here is the honest WS sanity: the Accurate
    // fighter lands in the sane band around the formula's 55.6%,
    // and is not measurably WORSE than the neutral mirror.
    const accRate = accPair.a.landed / accPair.a.swings;
    assert(accPair.a.swings >= 500, `accurate volume: ${accPair.a.swings} swings counted (need 500)`);
    assert(accRate >= 0.45 && accRate <= 0.65,
      `Accurate's hit rate in the expected band around 55.6%: ${(accRate * 100).toFixed(1)}% (neutral mirror ${(neuRate * 100).toFixed(1)}%)`);
    assert(accRate > neuRate - 0.05,
      `Accurate is not worse than neutral: ${(accRate * 100).toFixed(1)}% vs the neutral mirror's ${(neuRate * 100).toFixed(1)}% (the true +2.7pt edge is proven exactly in stage12's harness)`);

    // ----- Arm 3: Aggressive hits a little harder -------------------
    // Aggressive damage pool: both mirror fighters + pair A's Agg.
    const aggDmg = {
      landed: neu.a.landed + neu.b.landed + accPair.b.landed,
      dmg: neu.a.dmg + neu.b.dmg + accPair.b.dmg,
      max: Math.max(neu.a.max, neu.b.max, accPair.b.max),
    };
    const accDmg = { landed: accPair.a.landed, dmg: accPair.a.dmg, max: accPair.a.max };
    const aggPerLanded = aggDmg.dmg / aggDmg.landed;
    const accPerLanded = accDmg.dmg / accDmg.landed;
    assert(aggDmg.max > accDmg.max,
      `Aggressive's hardest hit beats Accurate's: max ${aggDmg.max} vs ${accDmg.max} (caps are 29 vs 28 at DUEL_LEVEL — the +3 Strength is worth +1 max hit)`);
    // Stage 12 DUEL_LEVEL revision (flagged): the threshold was
    // -0.1. The true per-landed gap is +0.5 (caps 29 vs 28), but
    // at DUEL_LEVEL the 1..29 damage spread gives the sampled
    // difference a sigma of ~0.6 at these volumes, so -0.1 sat
    // only ~1 sigma below the truth and flaked ~16% of runs (one
    // run measured 14.17 vs 15.33 while its own max-hit assert
    // showed the caps exactly right at 29 vs 28). The strict
    // proof of the +1 cap — and hence the +0.5 expectation — is
    // deterministic in stage12's VM harness; this WS check keeps
    // a ~3.3-sigma sanity bound.
    assert(aggPerLanded > accPerLanded - 1.5,
      `Aggressive hits harder per landed swing: ${aggPerLanded.toFixed(2)} avg vs Accurate's ${accPerLanded.toFixed(2)} (true gap +0.5 from the 29 vs 28 caps, proven exactly in stage12's harness)`);

    // ----- Arm 4: Defensive takes less damage -----------------------
    const defTakenPerSwing = defPair.a.dmg / defPair.a.swings; // Atk (aggressive) hitting Def
    const neuTakenPerSwing = (neu.a.dmg + neu.b.dmg) / neuSwings; // aggressive hitting aggressive
    assert(defPair.a.swings >= 400, `defensive volume: ${defPair.a.swings} attacker swings counted (need 400)`);
    // Stage 27: Defensive now sheds damage two ways — the 25%
    // full-block proc AND the +3 Defence level lowering the
    // attacker's connect rate (~55.6% → ~52.9% at DUEL_LEVEL) —
    // for ~29% less damage per swing overall. The 0.88 threshold
    // (12% less) still holds with a wide margin.
    assert(defTakenPerSwing <= neuTakenPerSwing * 0.88,
      `Defensive takes less damage: ${defTakenPerSwing.toFixed(2)} per swing vs ${neuTakenPerSwing.toFixed(2)} against a non-Defensive fighter (${(100 * (1 - defTakenPerSwing / neuTakenPerSwing)).toFixed(0)}% less, ~29% expected from the 25% block proc + the +3 Defence level)`);

    for (const c of clients) c.close();
    console.log('ALL STAGE 10 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
