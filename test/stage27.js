// Stage 27 tests: combat-rules alignment — Derek's explicit
// "Everything" decision (the trade-offs were shown; he chose it):
// the online game's combat rules now match the app (Muse-artifact)
// version of nallystake.
//   - DEFLECT prayers replace Protect. Against MONSTERS a matching
//     prayer stops the hit entirely and bounces
//     max(1, ceil(rolled x 0.25)) back onto the attacker — the
//     bounce can kill and awards no XP. Against PLAYERS (duels,
//     mod duels, button casts) the app's PvP rule applies: 40% of
//     the rolled hit is prayed off (round(raw x 0.4)) and a quarter
//     of the blocked part (max(1, round(blocked x 0.25))) bounces
//     back onto the attacker; the rest gets through.
//   - Style PROCS replace the Stage 10 retune: the base boosts
//     (Accurate +3 Attack, Aggressive +3 Strength, Defensive +3
//     Defence LEVEL — it now feeds the defence roll, Controlled
//     +1/+1/+1) PLUS procs rolled per swing at 25% (Controlled
//     rolls all three at 12%): Accurate = a bonus extra hit of
//     randi(1, ceil(maxHit/2)) landing in full as bonusDmg;
//     Aggressive = a power hit, +randi(2, round(maxHit x 0.75))
//     stacked onto the swing; Defensive = a full block of an
//     incoming hit (after prayer). Casts do not proc.
//   - Jad: a prayer-matched telegraphed hit resolves through the
//     same monsterDeflect (Jad takes the bounce). NOT exercised
//     live here — the seeded Fight Caves runner cannot reach wave
//     63, the Stage 4 SKIP precedent; the path is covered by the
//     monsterDeflect unit asserts below plus shared code. Said
//     plainly, per the house rule.
//
// Sections: (VM) exact deflect formula asserts + proc statistics
// over 20k rolled swings (the stage12 harness pattern); (WS)
// prayer switching, Deflect vs goblin / wizard / ranger, a
// wrong-prayer control, and a two-client duel proving the PvP
// rule by exact per-tick HP accounting.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18127;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage27.json');
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
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    const client = { ws, events: [] };
    ws.on('message', (raw) => client.events.push(JSON.parse(raw)));
    client.send = (obj) => ws.send(JSON.stringify(obj));
    client.profile = () => {
      for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].profile) return client.events[i].profile;
      return null;
    };
    client.waitSince = (startIdx, pred, timeout = 30000, label = 'event') => new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (let i = startIdx; i < client.events.length; i++) {
          if (pred(client.events[i])) { clearInterval(iv); return res(client.events[i]); }
        }
        if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('timeout waiting ' + label)); }
      }, 25);
    });
    client.waitProfile = (label = 'profile') => client.waitSince(client.events.length, (e) => e.type === 'profile', 15000, label).then(() => client.profile());
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
function latestNpcState(client) {
  for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].type === 'npc_state') return client.events[i];
  return null;
}
// Travel to `area`, raise `prayer`, walk onto the first live NPC
// and fight it, collecting npc_fight ticks until stopWhen(ticks)
// or the fight ends; flees out if asked to stop early. Returns the
// collected ticks.
async function collectNpcFight(client, area, prayer, label, stopWhen, timeoutMs = 70000) {
  client.send({ type: 'travel', to: area });
  await client.waitSince(0, (e) => e.type === 'area' && e.area === area, 10000, label + ' area');
  await client.waitSince(0, (e) => e.type === 'npc_state', 10000, label + ' npc_state');
  if (prayer) {
    // Only send when it isn't already up — sending the active
    // prayer again would toggle it OFF.
    const cur = client.profile();
    if (!cur || cur.activePrayer !== prayer) {
      client.send({ type: 'prayer', prayer });
      const prof = await client.waitProfile(label + ' prayer profile');
      assert(prof.activePrayer === prayer, `${label}: prayer '${prayer}' is active`);
    }
  }
  const ns = latestNpcState(client);
  const npc = ns && ns.npcs.find((n) => n.hp > 0);
  assert(npc, `${label}: a live npc exists in ${area}`);
  client.send({ type: 'move', x: npc.x, y: npc.y });
  const startIdx = client.events.length;
  client.send({ type: 'attack_npc', id: npc.id });
  const t0 = Date.now();
  let ticks = [];
  let ended = false;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(250);
    ticks = client.events.slice(startIdx).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
    if (client.events.slice(startIdx).some((e) => e.type === 'npc_fight' && e.phase === 'end')) { ended = true; break; }
    if (stopWhen(ticks)) {
      client.send({ type: 'flee' });
      await client.waitSince(startIdx, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, label + ' flee end');
      ended = true;
      break;
    }
  }
  ticks = client.events.slice(startIdx).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
  assert(ended, `${label}: the fight ended (or was fled) — ${ticks.length} ticks collected`);
  return ticks;
}
const creatureSwings = (ticks) => ticks.filter((t) => t.npcHit !== null && t.npcHit !== undefined).length;
const deflectTicks = (ticks) => ticks.filter((t) => (t.npcDeflected || 0) > 0);

(async () => {
  // ================= (VM) exact rules + proc statistics =================
  {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const sandbox = {
      console, Buffer, URL,
      setTimeout, clearTimeout,
      setInterval: () => 0, clearInterval: () => {},
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
    const pvpDeflect = F('pvpDeflect'), monsterDeflect = F('monsterDeflect');
    const boostChance = F('boostChance'), STYLES = F('STYLES');
    const hitChance = F('hitChance'), rollPlayerAttack = F('rollPlayerAttack');
    const XP40 = 37224; // OSRS level 40
    const mk = (style, prayer, points = 25) => ({
      style, activePrayer: prayer || null, prayerPoints: points,
      xp: { attack: XP40, strength: XP40, defence: XP40, hitpoints: XP40 },
      worn: { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null },
      specialEnergy: 100,
    });

    // --- the PvP deflect formula, exactly (the app's prayerDeflect pvp branch) ---
    const dMelee = mk('accurate', 'melee');
    let r = pvpDeflect(dMelee, 'melee', 10);
    assert(r.through === 6 && r.deflected === 1, `pvpDeflect raw 10 → through 6, deflected 1 (got ${r.through}/${r.deflected})`);
    r = pvpDeflect(dMelee, 'melee', 20);
    assert(r.through === 12 && r.deflected === 2, `pvpDeflect raw 20 → through 12, deflected 2 (got ${r.through}/${r.deflected})`);
    r = pvpDeflect(dMelee, 'melee', 1);
    assert(r.through === 1 && r.deflected === 0, `pvpDeflect raw 1 → nothing blocked, no bounce (got ${r.through}/${r.deflected})`);
    r = pvpDeflect(dMelee, 'melee', 2);
    assert(r.through === 1 && r.deflected === 1, `pvpDeflect raw 2 → through 1, deflected 1 (got ${r.through}/${r.deflected})`);
    r = pvpDeflect(mk('accurate', 'magic'), 'melee', 10);
    assert(r.through === 10 && r.deflected === 0, 'pvpDeflect: the wrong prayer does nothing');
    r = pvpDeflect(mk('accurate', 'melee', 0), 'melee', 10);
    assert(r.through === 10 && r.deflected === 0, 'pvpDeflect: an empty prayer pool does nothing');
    r = pvpDeflect(mk('accurate', 'missiles'), 'ranged', 10);
    assert(r.through === 6 && r.deflected === 1, "pvpDeflect: a 'ranged' attack is answered by the 'missiles' prayer");
    console.log('PASS VM: PvP deflect formula exact (40% prayed off, quarter of the blocked part back)');

    // --- the monster deflect formula, exactly ---
    assert(monsterDeflect(dMelee, 'melee', 10) === 3, 'monsterDeflect raw 10 → 3 (ceil quarter)');
    assert(monsterDeflect(dMelee, 'melee', 2) === 1, 'monsterDeflect raw 2 → 1 (the max(1, …) floor)');
    assert(monsterDeflect(dMelee, 'melee', 30) === 8, 'monsterDeflect raw 30 → 8 (a full Jad hit bounces 8)');
    assert(monsterDeflect(dMelee, 'melee', 1) === 1, 'monsterDeflect raw 1 → 1');
    assert(monsterDeflect(dMelee, 'magic', 10) === 0, 'monsterDeflect: wrong attack type → 0');
    assert(monsterDeflect(mk('accurate', null), 'melee', 10) === 0, 'monsterDeflect: no prayer → 0');
    console.log('PASS VM: monster deflect formula exact (whole hit stopped, ceil quarter back, floor 1)');

    // --- style table: base boosts + proc chances ---
    assert(STYLES.defensive.defBoost === 3 && STYLES.controlled.defBoost === 1 && STYLES.accurate.defBoost === 0 && STYLES.aggressive.defBoost === 0,
      'STYLES: Defensive +3 / Controlled +1 Defence LEVEL, others 0');
    assert(!('block' in STYLES.defensive) && !('block' in STYLES.controlled), 'STYLES: the Stage 10 flat block field is gone');
    assert(boostChance('accurate', 'accurate') === 0.25 && boostChance('aggressive', 'aggressive') === 0.25 && boostChance('defensive', 'defensive') === 0.25,
      'boostChance: fighting in a style rolls its boost at 25%');
    assert(boostChance('controlled', 'accurate') === 0.12 && boostChance('controlled', 'aggressive') === 0.12 && boostChance('controlled', 'defensive') === 0.12,
      'boostChance: Controlled rolls every boost at 12%');
    assert(boostChance('aggressive', 'defensive') === 0 && boostChance('defensive', 'accurate') === 0, 'boostChance: mismatched pairings are 0');
    const mirror = hitChance(mk('accurate'), mk('accurate'), false, 40);
    assert(mirror > 0.45 && mirror < 0.58, `hitChance: the DUEL_LEVEL mirror still centres ~50% (got ${mirror.toFixed(3)})`);
    assert(hitChance(mk('accurate'), mk('defensive'), false, 40) < mirror, "hitChance: a Defensive defender's +3 Defence level measurably lowers the attacker's chance");
    console.log('PASS VM: style table + boost chances + defence-roll boost');

    // --- proc statistics over 20k rolled swings (DUEL_LEVEL, steel swords) ---
    const N = 20000;
    const sample = (att, def, deflectPvp = false) => {
      let connected = 0, bonus = 0, power = 0, blocked = 0, defl = 0, maxDmg = 0, maxBonus = 0;
      for (let i = 0; i < N; i++) {
        const res = rollPlayerAttack(att, def, false, 40, deflectPvp);
        if (!res.connected) continue;
        connected++;
        if (res.bonusDmg > 0) { bonus++; if (res.bonusDmg > maxBonus) maxBonus = res.bonusDmg; }
        if (res.power) power++;
        if (res.outcome === 'blocked') blocked++;
        if (res.deflected > 0) defl++;
        if (res.dmg > maxDmg) maxDmg = res.dmg;
      }
      return { connected, bonus, power, blocked, defl, maxDmg, maxBonus };
    };
    const sAcc = sample(mk('accurate'), mk('accurate'));
    const accRate = sAcc.bonus / sAcc.connected;
    assert(accRate > 0.20 && accRate < 0.30, `procs: Accurate bonus hit on ${(accRate * 100).toFixed(1)}% of connected swings (25% ± band)`);
    assert(sAcc.maxBonus >= 10 && sAcc.maxBonus <= 14, `procs: Accurate bonus tops out at ${sAcc.maxBonus} (cap ceil(28/2) = 14)`);
    assert(sAcc.maxDmg <= 28, `procs: Accurate's main damage still caps at 28 (got ${sAcc.maxDmg}) — the bonus is a separate field`);
    const sAgg = sample(mk('aggressive'), mk('accurate'));
    const powRate = sAgg.power / sAgg.connected;
    assert(powRate > 0.20 && powRate < 0.30, `procs: Aggressive power hit on ${(powRate * 100).toFixed(1)}% of connected swings`);
    assert(sAgg.maxDmg > 35, `procs: Aggressive power hits push damage past the 29 cap (sample max ${sAgg.maxDmg})`);
    const sDef = sample(mk('accurate'), mk('defensive'));
    const blkRate = sDef.blocked / sDef.connected;
    assert(blkRate > 0.20 && blkRate < 0.30, `procs: Defensive fully blocks ${(blkRate * 100).toFixed(1)}% of connected swings`);
    const sCtlA = sample(mk('controlled'), mk('accurate'));
    const ctlBonus = sCtlA.bonus / sCtlA.connected;
    assert(ctlBonus > 0.07 && ctlBonus < 0.17, `procs: Controlled bonus hit at ${(ctlBonus * 100).toFixed(1)}% (12% ± band)`);
    const sCtlD = sample(mk('accurate'), mk('controlled'));
    const ctlBlock = sCtlD.blocked / sCtlD.connected;
    assert(ctlBlock > 0.07 && ctlBlock < 0.17, `procs: Controlled block at ${(ctlBlock * 100).toFixed(1)}% (12% ± band)`);
    console.log('PASS VM: proc statistics — Accurate bonus / Aggressive power / Defensive block at 25%, Controlled at 12%');

    // --- deflect inside the shared roll (the duel path) ---
    const sDfl = sample(mk('aggressive'), mk('accurate', 'melee'), true);
    const dflRate = sDfl.defl / sDfl.connected;
    assert(dflRate > 0.85, `rolls: with Deflect up, ${(dflRate * 100).toFixed(1)}% of connected duel swings bounce damage back (only a raw 1 cannot)`);
    const sNo = sample(mk('aggressive'), mk('accurate', 'melee'), false);
    assert(sNo.defl === 0, 'rolls: without the duel flag the same prayer deflects nothing (monster engines use their own path)');
    console.log('PASS VM: PvP deflect rides rollPlayerAttack only on the duel flag');

    // --- client source: the rename + proc descriptions landed ---
    const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert(clientSrc.includes('Deflect from Melee') && clientSrc.includes('Deflect from Missiles') && clientSrc.includes('Deflect from Magic'),
      'client: prayers renamed to Deflect from Melee / Missiles / Magic');
    assert(!clientSrc.includes('Protect from'), "client: no 'Protect from' text remains");
    assert(clientSrc.includes('STYLE_PROC_TEXT') && clientSrc.includes('bonus extra hit') && clientSrc.includes('power hit'),
      'client: the style picker carries the proc descriptions');
    assert(clientSrc.includes('spawnDeflectSplatOn') && clientSrc.includes('spawnBonusSplatOn'),
      'client: deflect + bonus splat helpers exist');
    console.log('PASS client source: Deflect naming, proc descriptions, splat helpers');
  }

  // ================= (WS) end-to-end =================
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh */ }
  await startServer();
  const names = ['S27Gob', 'S27Wiz', 'S27Ran', 'S27Wrong', 'S27Atk', 'S27Def'];
  for (const n of names) await api('/api/register', { username: n, password: 'secret27' });
  await stopServer();
  seedDb((data) => {
    const P = (n) => data.users[n.toLowerCase()].profile;
    const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
    const BOW = { weapon: 'shortbow', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
    // The NPC deflect testers carry a shortbow + bronze arrows
    // (ranged max hit 8 at level 1): an unarmed tester kills a
    // 12-HP goblin in two hits — before the creature has swung
    // enough times to prove anything — while arrows stretch each
    // fight across many creature swings.
    P('S27Gob').worn = { ...BOW };
    P('S27Gob').backpack = [{ item: 'gold', qty: 100 }, { item: 'prayer_potion', qty: 3 }, { item: 'bronze_arrow', qty: 60 }]; // prayer top-ups between pooled fights
    P('S27Wiz').worn = { ...BOW };
    P('S27Wiz').backpack = [{ item: 'gold', qty: 100 }, { item: 'bronze_arrow', qty: 60 }];
    P('S27Ran').worn = { ...BOW };
    P('S27Ran').backpack = [{ item: 'gold', qty: 100 }, { item: 'bronze_arrow', qty: 60 }];
    P('S27Wrong').worn = { ...BOW };
    P('S27Wrong').backpack = [{ item: 'gold', qty: 100 }, { item: 'bronze_arrow', qty: 60 }];
    P('S27Wrong').xp.hitpoints = 13363; // level 30 HP pool — runway for the wrong-prayer control
    P('S27Atk').style = 'aggressive';
    P('S27Atk').worn = { ...STEEL };
    P('S27Def').style = 'aggressive';
    P('S27Def').worn = { ...STEEL };
    P('S27Def').backpack = [{ item: 'gold', qty: 100 }, { item: 'restore_potion', qty: 30 }];
  });
  await startServer();
  const clients = [];
  const login = async (n) => {
    const d = await api('/api/login', { username: n, password: 'secret27' });
    const c = await connect(d.token);
    clients.push(c);
    await c.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome ' + n);
    return c;
  };
  try {
    // --- one prayer at a time, tap toggles (unchanged contract) ---
    const gob = await login('S27Gob');
    gob.send({ type: 'prayer', prayer: 'melee' });
    assert((await gob.waitProfile('prayer melee')).activePrayer === 'melee', 'prayer: Deflect from Melee on');
    gob.send({ type: 'prayer', prayer: 'magic' });
    assert((await gob.waitProfile('prayer magic')).activePrayer === 'magic', 'prayer: switching replaces — only Deflect from Magic is on');
    gob.send({ type: 'prayer', prayer: 'magic' });
    assert((await gob.waitProfile('prayer off')).activePrayer === null, 'prayer: tapping the active one turns it off');
    console.log('PASS WS prayer switching: one at a time, tap toggles off');

    // --- Deflect vs goblin: no damage through, the bounce lands ---
    // Aggregate over up to 3 goblin fights: the no-damage invariant
    // is deterministic; the bounce's existence is statistical (a
    // 12-HP goblin dies fast), so the fights pool their swings.
    let allTicks = [];
    for (let f = 0; f < 3; f++) {
      if (f > 0) { // top the prayer pool back up between pooled fights
        const prof = gob.profile();
        if (prof && prof.prayerPoints < 12) { gob.send({ type: 'use', item: 'prayer_potion' }); await gob.waitProfile('prayer potion'); }
      }
      const ticks = await collectNpcFight(gob, 'goblins', 'melee', 'goblin fight ' + (f + 1),
        (t) => deflectTicks(t).length >= 1 && creatureSwings(t) >= 3, 45000);
      allTicks = allTicks.concat(ticks);
      if (deflectTicks(allTicks).length >= 1 && creatureSwings(allTicks) >= 3) break;
      await sleep(600);
    }
    assert(allTicks.every((t) => t.npcHit === 0 || t.npcHit === null), 'goblin deflect: every goblin hit was stopped (npcHit 0/null on all ticks)');
    assert(allTicks.every((t) => t.hpYou === t.maxHpYou), 'goblin deflect: the player HP pool never dropped');
    assert(creatureSwings(allTicks) >= 3, `goblin deflect: the goblins actually swung (${creatureSwings(allTicks)} swings pooled)`);
    const gDefl = deflectTicks(allTicks);
    assert(gDefl.length >= 1 && gDefl.every((t) => t.npcDeflected === 1), `goblin deflect: bounce ticks carry exactly 1 (goblin raw is 1-2 → max(1, ceil(raw x 0.25)) = 1; saw ${gDefl.map((t) => t.npcDeflected).join(',')})`);
    console.log(`PASS WS goblin: Deflect from Melee stopped everything and bounced ${gDefl.length} hit(s) back at exactly 1`);

    // --- Deflect vs wizard (magic) and ranger (missiles) ---
    const wiz = await login('S27Wiz');
    const wTicks = await collectNpcFight(wiz, 'magic', 'magic', 'wizard fight',
      (t) => deflectTicks(t).length >= 1 && creatureSwings(t) >= 3);
    assert(wTicks.every((t) => t.npcHit === 0 || t.npcHit === null) && wTicks.every((t) => t.hpYou === t.maxHpYou), 'wizard deflect: no spell ever got through');
    const wDefl = deflectTicks(wTicks);
    assert(wDefl.length >= 1 && wDefl.every((t) => t.npcDeflected === 1), `wizard deflect: bounces are exactly 1 (wizard raw 1-4; saw ${wDefl.map((t) => t.npcDeflected).join(',')})`);
    console.log(`PASS WS wizard: Deflect from Magic stopped everything, ${wDefl.length} bounce(s) at exactly 1`);

    const ran = await login('S27Ran');
    const rTicks = await collectNpcFight(ran, 'range', 'missiles', 'ranger fight',
      (t) => deflectTicks(t).length >= 1 && creatureSwings(t) >= 3);
    assert(rTicks.every((t) => t.npcHit === 0 || t.npcHit === null) && rTicks.every((t) => t.hpYou === t.maxHpYou), 'ranger deflect: no arrow ever got through');
    const rDefl = deflectTicks(rTicks);
    assert(rDefl.length >= 1 && rDefl.every((t) => t.npcDeflected === 1), `ranger deflect: bounces are exactly 1 (ranger raw 1-4; saw ${rDefl.map((t) => t.npcDeflected).join(',')})`);
    console.log(`PASS WS ranger: Deflect from Missiles stopped everything, ${rDefl.length} bounce(s) at exactly 1`);

    // --- wrong prayer does nothing (pooled over up to 3 fights:
    // a single 12-HP goblin can die before its few swings land) ---
    const wrong = await login('S27Wrong');
    let xTicks = [];
    for (let f = 0; f < 3; f++) {
      const ticks = await collectNpcFight(wrong, 'goblins', 'magic', 'wrong-prayer fight ' + (f + 1),
        (t) => t.some((x) => (x.npcHit || 0) > 0), 45000);
      xTicks = xTicks.concat(ticks);
      if (xTicks.some((t) => (t.npcHit || 0) > 0)) break;
      await sleep(600);
    }
    assert(xTicks.some((t) => (t.npcHit || 0) > 0), 'wrong prayer: goblin hits DID get through Deflect from Magic');
    assert(xTicks.every((t) => !(t.npcDeflected > 0)), 'wrong prayer: nothing was ever deflected');
    console.log('PASS WS wrong prayer: Deflect from Magic does nothing against a goblin');

    // --- the PvP rule in a real duel, by exact HP accounting ---
    const A = await login('S27Atk');
    const B = await login('S27Def');
    {
      const mA = A.events.length, mB = B.events.length;
      A.send({ type: 'challenge', target: 'S27Def', stake: 0, items: [], rules: { noMovement: true }, freePlay: true });
      const inc = await B.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'duel challenge_incoming');
      B.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      A.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      B.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      await A.waitSince(mA, (e) => e.type === 'duel_start', 15000, 'duel_start A');
      await B.waitSince(mB, (e) => e.type === 'duel_start', 15000, 'duel_start B');
      B.send({ type: 'prayer', prayer: 'melee' }); // B prays and never swings
      A.send({ type: 'duel_attack' }); // A engages
      // B sips a restore potion whenever its pool runs low (the
      // use-tick arrives on BOTH streams with a "used … (+30 HP)"
      // note — the accounting below keys off that note).
      let potions = 30;
      const healer = setInterval(() => {
        for (let i = B.events.length - 1; i >= 0; i--) {
          const e = B.events[i];
          if (e.type === 'duel_tick') { if (e.hpYou <= 45 && potions > 0) { potions--; B.send({ type: 'use', item: 'restore_potion' }); } break; }
          if (e.type === 'duel_end') break;
        }
      }, 700);
      const t0 = Date.now();
      let idx = mA, prevOpp = 99, prevYou = 99, swings = 0, deflTicks = 0, healTicks = 0, ended = false;
      try {
        while (Date.now() - t0 < 150000) {
          await sleep(200);
          for (; idx < A.events.length; idx++) {
            const e = A.events[idx];
            if (e.type === 'duel_end') { ended = true; break; }
            if (e.type !== 'duel_tick') continue;
            if (e.note && /used .*\(\+\d+ HP\)/.test(e.note)) { healTicks++; prevOpp = e.hpOpponent; prevYou = e.hpYou; continue; }
            if (typeof e.youHit === 'number') {
              swings++;
              const defl = e.youDeflected || 0;
              if (defl > 0) deflTicks++;
              // B's pool drops by my swing's damage (hit + bonus);
              // the bounce does NOT come off B — it comes off ME.
              assert(e.hpOpponent === prevOpp - (e.youHit + (e.youBonus || 0)),
                `duel accounting tick ${swings}: B's pool dropped by exactly my hit + bonus (hpOpponent ${prevOpp} → ${e.hpOpponent}, youHit ${e.youHit}, youBonus ${e.youBonus || 0})`);
              assert(e.hpYou === prevYou - defl,
                `duel accounting tick ${swings}: A's pool dropped by exactly the bounce and nothing else (hpYou ${prevYou} → ${e.hpYou}, youDeflected ${defl})`);
              prevOpp = e.hpOpponent; prevYou = e.hpYou;
            } else { prevOpp = e.hpOpponent; prevYou = e.hpYou; }
          }
          if (ended || swings >= 40) break;
        }
      } finally { clearInterval(healer); }
      assert(swings >= 15, `duel: A actually swung (${swings} swings processed)`);
      assert(deflTicks >= 1, `duel: the PvP deflect fired (${deflTicks} of ${swings} swings bounced damage back onto A)`);
      console.log(`PASS WS duel: PvP Deflect accounting exact over ${swings} swings (${deflTicks} bounces, ${healTicks} potion ticks skipped)`);
    }
  } finally {
    for (const c of clients) { try { c.ws.close(); } catch { /* already closed */ } }
    await stopServer();
  }
  console.log('\nStage 27: ALL PASS');
})().catch(async (err) => {
  console.error('\nStage 27: FAIL — ' + err.message);
  await stopServer();
  process.exit(1);
});
