// Stage 19 tests: MAGIC and RANGED combat, the Wizard Grounds and
// Ranger Camp, and the supply loops (runes from wizards, arrows /
// arrowheads from rangers, fletching from logs + arrowheads).
//   (a) migration: a pre-Stage-19 profile (no fletching XP, no
//       spell field) gains fletching lvl 1 / 0 XP and spell
//       'air_strike'; a fresh profile's total level counts all 14
//       skills (23) and combat level is the OSRS formula (3.4
//       fresh; 50.85 for a pure 99-Ranged build).
//   (b) spellbook data: the catalog message carries 12 spells and
//       the new items with their style / strBonus fields.
//   (c) wizard kill drops runes (one element, 3-10) + gold.
//   (d) ranger kill drops arrows and/or arrowheads + gold.
//   (e) magic vs wizard: casts consume runes, Magic XP rises,
//       Deflect from Magic blocks every wizard hit; set_spell
//       honours the level gate and stores the selection.
//   (f) ranged vs wizard from 100 away (beyond melee reach): no
//       closing ticks, the wizard never moves, arrows consumed
//       exactly one per shot.
//   (g) refusals: bow with no arrows -> "You're out of arrows!";
//       staff with no runes -> "You don't have the runes for Air
//       Strike." — and no swing ever lands in either fight.
//   (h) fletching: log + bronze head -> 10 bronze arrows + 10 XP;
//       the mithril gate (45) refuses at level 1 and works seeded
//       past it.
//   (i) duel with noRanged: the bow-wielder's duel_attack is
//       refused with the ban message and they never swing, while
//       the sword fighter swings normally.
//   (j) duel with a mage: after the countdown the mage steps back
//       to 120 and casts from range (runes consumed, hits land)
//       while the melee fighter, out of reach, never swings.
// Same harness style as test/stage17.js / test/stage16.js.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18119;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage19.json');
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
const PW = (n) => 's19-pass-' + n;
async function register(name) {
  const d = await api('/api/register', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function loginClient(name) {
  const d = await api('/api/login', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function prof(name) { return (await api('/api/login', { username: name, password: PW(name) })).profile; }
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  return (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
}
const stackQty = (profile, item) => {
  const s = (profile.backpack || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
// Fight one shared NPC to the end; returns { start, ticks, end }.
async function fightNpc(client, npcId, label, timeoutMs = 90000) {
  const m = client.mark();
  client.send({ type: 'attack_npc', id: npcId });
  const start = (await client.waitSince(m, (e) => e.type === 'npc_fight' && e.phase === 'start', 10000, label + ' fight start')).e;
  const end = (await client.waitSince(m, (e) => e.type === 'npc_fight' && e.phase === 'end', timeoutMs, label + ' fight end')).e;
  const ticks = client.events.slice(m).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
  return { start, ticks, end };
}
// Run a challenge-screen duel (Stage 14 flow) into duel_start.
async function startDuelViaChallenge(challenger, target, rules, label) {
  const mC = challenger.mark(); const mT = target.mark();
  challenger.send({ type: 'challenge', target: target.name, stake: 0, items: [], rules, freePlay: true });
  const inc = (await target.waitSince(mT, (e) => e.type === 'challenge_incoming', 10000, label + ' incoming')).e;
  target.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  challenger.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  target.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  const startC = (await challenger.waitSince(mC, (e) => e.type === 'duel_start', 15000, label + ' duel_start (challenger)')).e;
  const startT = (await target.waitSince(mT, (e) => e.type === 'duel_start', 15000, label + ' duel_start (target)')).e;
  return { startC, startT };
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/const SPELLS = \[/.test(src) && /SPELL_CAST_XP/.test(src), 'source: server has the spell table + cast XP');
  assert(/WIZARD_DEF/.test(src) && /RANGER_DEF/.test(src) && /NPC_AREAS = \['goblins', 'magic', 'range'\]/.test(src), 'source: wizard/ranger defs + NPC areas');
  assert(/function rollStyleAttack/.test(src) && /function attackStyleOf/.test(src) && /'noMelee', 'noRanged', 'noMagic'/.test(src), 'source: style dispatcher + the three style duel rules');
  assert(/m\.type === 'fletch'/.test(src) && /m\.type === 'set_spell'/.test(src), 'source: fletch + set_spell handlers exist');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/buildWizardGrounds/.test(clientSrc) && /buildRangerCamp/.test(clientSrc), 'source: client builds both new areas');
  assert(/pSpellbook/.test(clientSrc) && /data-panel="spellbook"/.test(clientSrc), 'source: client spellbook panel + rail button');
  assert(/\['noRanged','No Ranged'\]/.test(clientSrc) && /\['noMagic','No Magic'\]/.test(clientSrc) && /\['noMelee','No Melee'\]/.test(clientSrc), 'source: challenge sheet has the three style toggles');
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs); // throws on a syntax error
  console.log('PASS source: client inline script parses');

  // ---------- (a) migration: a pre-Stage-19 profile ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  {
    const salt = crypto.randomBytes(16).toString('hex');
    const passHash = crypto.scryptSync(PW('S19Legacy'), salt, 32).toString('hex');
    // The old 13-skill XP map (ranged/magic existed; fletching did
    // not) and NO spell field — the shape a Stage 18 profile has.
    const oldXp = { attack: 0, strength: 0, defence: 0, hitpoints: 1154, ranged: 0, magic: 0, prayer: 0, mining: 0, smithing: 0, woodcutting: 0, firemaking: 0, fishing: 0, cooking: 0 };
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: {
        s19legacy: { salt, passHash, profile: { username: 'S19Legacy', gold: 100, rating: 1000, wins: 0, losses: 0, style: 'accurate', createdAt: new Date().toISOString(), xp: oldXp } },
      },
    }));
  }
  await startServer();
  const clients = [];
  try {
    const legacy = await prof('S19Legacy');
    assert(legacy.levels.fletching === 1 && legacy.xp.fletching === 0, `(a) migrated profile gains fletching lvl 1 / 0 XP (got lvl ${legacy.levels.fletching}, xp ${legacy.xp.fletching})`);
    assert(legacy.spell === 'air_strike', `(a) migrated profile gains spell 'air_strike' (got ${legacy.spell})`);
    assert(legacy.totalLevel === 23, `(a) migrated total level counts all 14 skills (got ${legacy.totalLevel})`);
    assert(legacy.combatLevel === 3.4, `(a) fresh-build combat level is the OSRS formula's 3.4 (got ${legacy.combatLevel})`);
    console.log('PASS (a) migration + combat level formula');

    // ---------- register everyone, then seed gear/XP ----------
    const names = ['S19Fresh', 'S19Killer', 'S19Mage', 'S19Ranger', 'S19Fletch', 'S19FletchPro', 'S19NoAmmo', 'S19NoRunes', 'S19Bow', 'S19Sword', 'S19MageD', 'S19Sword2', 'S19RangePro'];
    for (const n of names) { const c = await register(n); clients.push(c); c.close(); }
    const fresh = await prof('S19Fresh');
    assert(fresh.spell === 'air_strike' && fresh.levels.fletching === 1 && fresh.totalLevel === 23, '(a) a fresh profile is born with spell + fletching + total 23');
    await stopServer();
    const G = (qty) => ({ item: 'gold', qty });
    seedDb((data) => {
      const set = (name, mut) => { const u = data.users[name.toLowerCase()]; if (!u) throw new Error('seed: no user ' + name); mut(u.profile); };
      set('S19Killer', (p) => { p.xp.attack = 13034431; p.xp.strength = 13034431; p.xp.hitpoints = 13034431; p.worn.weapon = 'dragon_sword'; });
      set('S19Mage', (p) => { p.xp.magic = 20000; p.xp.hitpoints = 13034431; p.prayerPoints = 500; p.prayerMax = 500; p.worn.weapon = 'staff'; p.backpack = [G(100), { item: 'air_rune', qty: 50 }, { item: 'water_rune', qty: 10 }]; });
      set('S19Ranger', (p) => { p.xp.ranged = 1000000; p.xp.hitpoints = 13034431; p.worn.weapon = 'shortbow'; p.backpack = [G(100), { item: 'bronze_arrow', qty: 30 }]; });
      set('S19Fletch', (p) => { p.backpack = [G(100), { item: 'logs', qty: 5 }, { item: 'bronze_arrowhead', qty: 3 }, { item: 'mithril_arrowhead', qty: 2 }]; });
      set('S19FletchPro', (p) => { p.xp.fletching = 2000000; p.backpack = [G(100), { item: 'logs', qty: 3 }, { item: 'mithril_arrowhead', qty: 2 }]; });
      set('S19NoAmmo', (p) => { p.xp.ranged = 1000000; p.xp.hitpoints = 13034431; p.worn.weapon = 'shortbow'; });
      set('S19NoRunes', (p) => { p.xp.magic = 20000; p.xp.hitpoints = 13034431; p.worn.weapon = 'staff'; });
      set('S19Bow', (p) => { p.xp.ranged = 1000000; p.worn.weapon = 'shortbow'; p.backpack = [G(100), { item: 'bronze_arrow', qty: 30 }]; });
      set('S19Sword', (p) => { p.worn.weapon = 'bronze_sword'; });
      set('S19MageD', (p) => { p.xp.magic = 20000; p.worn.weapon = 'staff'; p.backpack = [G(100), { item: 'air_rune', qty: 60 }]; });
      set('S19Sword2', (p) => { p.worn.weapon = 'bronze_sword'; });
      set('S19RangePro', (p) => { p.xp.ranged = 13034431; });
    });
    await startServer();
    const rangePro = await prof('S19RangePro');
    assert(rangePro.combatLevel === 50.85 && rangePro.totalLevel === 121, `(a) pure 99-Ranged build: combat 50.85 / total 121 (got ${rangePro.combatLevel} / ${rangePro.totalLevel})`);

    const Killer = await loginClient('S19Killer'); clients.push(Killer);
    const Mage = await loginClient('S19Mage'); clients.push(Mage);
    const Ranger = await loginClient('S19Ranger'); clients.push(Ranger);

    // ---------- (b) spellbook data on the catalog message ----------
    const cat = await Killer.waitFor((e) => e.type === 'catalog', 10000, 'catalog');
    assert(Array.isArray(cat.spells) && cat.spells.length === 13, `(b) catalog carries the spell table (12 elemental + Freeze since Stage 24) (got ${cat.spells && cat.spells.length})`);
    const fireBlast = cat.spells.find((s) => s.id === 'fire_blast');
    assert(fireBlast && fireBlast.level === 59 && fireBlast.runes === 3 && fireBlast.max === 17 && fireBlast.element === 'fire', '(b) Fire Blast row: lvl 59, 3 fire runes, max 17');
    const byId = {}; for (const it of cat.items) byId[it.id] = it;
    assert(byId.shortbow && byId.shortbow.style === 'ranged' && byId.mystic_staff && byId.mystic_staff.style === 'magic' && byId.bronze_sword && byId.bronze_sword.style === 'melee', '(b) catalog items carry weapon styles (bow ranged / staff magic / sword melee)');
    assert(byId.bronze_arrow && byId.bronze_arrow.strBonus === 2 && byId.rune_arrow && byId.rune_arrow.strBonus === 16, '(b) arrows carry their ranged strength bonus');
    assert(byId.air_rune && byId.air_rune.kind === 'rune' && !byId.air_rune.shop, '(b) runes are in the catalog but sold in no shop');
    console.log('PASS (b) spellbook + catalog data');

    // ---------- (c) wizard kill drops runes ----------
    Killer.send({ type: 'travel', to: 'magic' });
    const nsW = await Killer.waitFor((e) => e.type === 'npc_state' && e.area === 'magic' && (e.npcs || []).length >= 5, 10000, 'wizard npc_state (c)');
    assert(nsW.npcs.every((n) => n.kind === 'wizard'), '(c) the Wizard Grounds roster is wizards');
    Killer.send({ type: 'move', x: 400, y: 300 }); // wizard1's spawn
    const wiz = await fightNpc(Killer, 'wizard1', '(c) wizard fight');
    assert(wiz.start.kind === 'wizard' && wiz.start.name === 'Wizard', '(c) fight starts against a Wizard');
    assert(wiz.end.reason === 'kill', `(c) wizard killed (reason=${wiz.end.reason})`);
    const runeDrop = (wiz.end.drops.items || []).find((s) => /_rune$/.test(s.item));
    assert(runeDrop && runeDrop.qty >= 3 && runeDrop.qty <= 10, `(c) wizard dropped 3-10 of one rune (got ${JSON.stringify(wiz.end.drops.items)})`);
    assert(wiz.end.drops.gold >= 3 && wiz.end.drops.gold <= 8, `(c) wizard dropped 3-8 gold (got ${wiz.end.drops.gold})`);
    await sleep(300);
    assert(stackQty(await prof('S19Killer'), runeDrop.item) >= runeDrop.qty, '(c) the dropped runes are in the killer\'s backpack');
    console.log('PASS (c) wizard drops runes + gold');

    // ---------- (d) ranger kill drops arrows / arrowheads ----------
    Killer.send({ type: 'travel', to: 'range' });
    await Killer.waitFor((e) => e.type === 'npc_state' && e.area === 'range' && (e.npcs || []).length >= 5, 10000, 'ranger npc_state (d)');
    Killer.send({ type: 'move', x: 360, y: 320 }); // ranger1's spawn
    const ran = await fightNpc(Killer, 'ranger1', '(d) ranger fight');
    assert(ran.start.kind === 'ranger', '(d) fight starts against a Ranger');
    assert(ran.end.reason === 'kill', `(d) ranger killed (reason=${ran.end.reason})`);
    const loot = (ran.end.drops.items || []).filter((s) => /_(arrow|arrowhead)$/.test(s.item));
    assert(loot.length >= 1, `(d) ranger dropped arrows and/or arrowheads (got ${JSON.stringify(ran.end.drops.items)})`);
    for (const s of loot) {
      if (s.item.endsWith('_arrow')) assert(s.qty >= 5 && s.qty <= 15, `(d) arrow drop is 5-15 (got ${s.qty})`);
      else assert(s.qty >= 1 && s.qty <= 3, `(d) arrowhead drop is 1-3 (got ${s.qty})`);
    }
    assert(ran.end.drops.gold >= 3 && ran.end.drops.gold <= 8, `(d) ranger dropped 3-8 gold (got ${ran.end.drops.gold})`);
    console.log('PASS (d) ranger drops arrows/arrowheads + gold');

    // ---------- (e) magic vs wizard, under Deflect from Magic (Stage 27) ----------
    const mageBefore = await prof('S19Mage');
    Mage.send({ type: 'travel', to: 'magic' });
    await Mage.waitFor((e) => e.type === 'npc_state' && e.area === 'magic', 10000, 'mage npc_state (e)');
    Mage.send({ type: 'prayer', prayer: 'magic' });
    await Mage.waitFor((e) => e.type === 'profile' && e.profile.activePrayer === 'magic', 10000, 'Deflect from Magic on (e)');
    Mage.send({ type: 'move', x: 1060, y: 300 }); // 60 from wizard3 (1000,300): inside cast range, beyond melee reach
    const mag = await fightNpc(Mage, 'wizard3', '(e) mage vs wizard');
    assert(mag.end.reason === 'kill', `(e) the mage killed the wizard by casting (reason=${mag.end.reason})`);
    const casts = mag.ticks.filter((t) => typeof t.youHit === 'number').length;
    assert(casts >= 2, `(e) the fight took several casts (got ${casts})`);
    assert(mag.ticks.every((t) => !t.closing), '(e) no closing ticks — casting works from beyond melee reach');
    const wizHits = mag.ticks.filter((t) => typeof t.npcHit === 'number');
    assert(wizHits.length >= 1 && wizHits.every((t) => t.npcHit === 0), `(e) Deflect from Magic blocked every wizard hit (${wizHits.length} swings, all 0)`);
    await sleep(300);
    const mageAfter = await prof('S19Mage');
    // The kill drop lands in the same backpack: if the wizard dropped air runes they stack
    // back on, so the exact expectation is 50 - casts + (air drop qty, if the drop was air).
    const airDrop = (mag.end.drops.items || []).find((s) => s.item === 'air_rune');
    const airExpected = 50 - casts + (airDrop ? airDrop.qty : 0);
    assert(stackQty(mageAfter, 'air_rune') === airExpected, `(e) one air rune spent per cast (${casts} casts: 50 -> ${stackQty(mageAfter, 'air_rune')}, expected ${airExpected} after the kill drop)`);
    assert(mageAfter.xp.magic > mageBefore.xp.magic, `(e) Magic XP rose (${mageBefore.xp.magic} -> ${mageAfter.xp.magic})`);
    console.log('PASS (e) magic: runes consumed per cast, XP rises, prayer blocks');

    // set_spell: the level gate, then a legal selection sticks.
    const errSpell = await expectError(Mage, { type: 'set_spell', spell: 'fire_blast' }, 'set_spell gate (e)');
    assert(/Magic level 59/.test(errSpell.message), `(e) Fire Blast refused at Magic ${mageAfter.levels.magic} ("${errSpell.message}")`);
    const mSet = Mage.mark();
    Mage.send({ type: 'set_spell', spell: 'water_bolt' });
    const profMsg = (await Mage.waitSince(mSet, (x) => x.type === 'profile' && x.profile.spell === 'water_bolt', 10000, 'spell stored (e)')).e;
    assert(profMsg.profile.spell === 'water_bolt', '(e) Water Bolt selected and stored on the profile');
    console.log('PASS (e) spellbook selection + level gate');

    // ---------- (f) ranged vs wizard from 100 away ----------
    Ranger.send({ type: 'travel', to: 'magic' });
    await Ranger.waitFor((e) => e.type === 'npc_state' && e.area === 'magic', 10000, 'ranger npc_state (f)');
    Ranger.send({ type: 'move', x: 800, y: 520 }); // 100 from wizard2 (700,520)
    const rng = await fightNpc(Ranger, 'wizard2', '(f) ranger vs wizard');
    assert(rng.end.reason === 'kill', `(f) the ranger killed the wizard from range (reason=${rng.end.reason})`);
    const shots = rng.ticks.filter((t) => typeof t.youHit === 'number').length;
    assert(shots >= 1, `(f) shots were fired (got ${shots})`);
    assert(rng.ticks.every((t) => !t.closing), '(f) no closing ticks at 100 units — beyond melee reach the whole fight');
    const lastNs = [...Ranger.events].reverse().find((e) => e.type === 'npc_state' && e.area === 'magic');
    assert(lastNs && !lastNs.npcs.some((n) => n.id === 'wizard2'), '(f) wizard2 is dead in the final npc_state');
    await sleep(300);
    assert(stackQty(await prof('S19Ranger'), 'bronze_arrow') === 30 - shots, `(f) exactly one arrow spent per shot (${shots} shots)`);
    console.log('PASS (f) ranged: hits from beyond melee reach, 1 arrow per shot');

    // ---------- (g) refusals ----------
    const NoAmmo = await loginClient('S19NoAmmo'); clients.push(NoAmmo);
    NoAmmo.send({ type: 'travel', to: 'goblins' });
    await NoAmmo.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins', 10000, 'noammo npc_state (g)');
    NoAmmo.send({ type: 'move', x: 640, y: 320 }); // goblin2's spawn
    const mNA = NoAmmo.mark();
    NoAmmo.send({ type: 'attack_npc', id: 'goblin2' });
    await NoAmmo.waitSince(mNA, (e) => e.type === 'npc_fight' && e.phase === 'start', 10000, 'noammo fight start (g)');
    await sleep(8000);
    const naTicks = NoAmmo.events.slice(mNA).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
    assert(naTicks.length >= 6, `(g) the no-ammo fight ticked (${naTicks.length} ticks)`);
    assert(naTicks.every((t) => typeof t.youHit !== 'number'), '(g) no arrows: the bow never swings');
    assert(naTicks.some((t) => typeof t.note === 'string' && t.note.includes("You're out of arrows!")), '(g) refusal says "You\'re out of arrows!"');
    NoAmmo.send({ type: 'flee' });
    await NoAmmo.waitSince(mNA, (e) => e.type === 'npc_fight' && e.phase === 'end' && e.reason === 'fled', 10000, 'noammo flee (g)');
    console.log('PASS (g) out-of-arrows refusal');

    const NoRunes = await loginClient('S19NoRunes'); clients.push(NoRunes);
    NoRunes.send({ type: 'travel', to: 'goblins' });
    await NoRunes.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins', 10000, 'norunes npc_state (g)');
    NoRunes.send({ type: 'move', x: 840, y: 520 }); // goblin3's spawn
    const mNR = NoRunes.mark();
    NoRunes.send({ type: 'attack_npc', id: 'goblin3' });
    await NoRunes.waitSince(mNR, (e) => e.type === 'npc_fight' && e.phase === 'start', 10000, 'norunes fight start (g)');
    await sleep(8000);
    const nrTicks = NoRunes.events.slice(mNR).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
    assert(nrTicks.length >= 6, `(g) the no-runes fight ticked (${nrTicks.length} ticks)`);
    assert(nrTicks.every((t) => typeof t.youHit !== 'number'), '(g) no runes: the staff never casts');
    assert(nrTicks.some((t) => typeof t.note === 'string' && t.note.includes("You don't have the runes for Air Strike.")), '(g) refusal says "You don\'t have the runes for Air Strike."');
    NoRunes.send({ type: 'flee' });
    await NoRunes.waitSince(mNR, (e) => e.type === 'npc_fight' && e.phase === 'end' && e.reason === 'fled', 10000, 'norunes flee (g)');
    console.log('PASS (g) insufficient-runes refusal');

    // ---------- (h) fletching ----------
    const Fletch = await loginClient('S19Fletch'); clients.push(Fletch);
    const mF = Fletch.mark();
    Fletch.send({ type: 'fletch', item: 'bronze_arrowhead' });
    const fr = (await Fletch.waitSince(mF, (e) => e.type === 'fletch_result', 10000, 'fletch_result (h)')).e;
    assert(fr.item === 'bronze_arrow' && fr.qty === 10, `(h) fletching a bronze head makes 10 bronze arrows (got ${fr.item} x${fr.qty})`);
    await sleep(300);
    const fPro = await prof('S19Fletch');
    assert(stackQty(fPro, 'bronze_arrow') === 10 && stackQty(fPro, 'logs') === 4 && stackQty(fPro, 'bronze_arrowhead') === 2, '(h) 1 log + 1 head consumed, 10 arrows in the pack');
    assert(fPro.xp.fletching === 10, `(h) 10 Fletching XP for the set (got ${fPro.xp.fletching})`);
    const errGate = await expectError(Fletch, { type: 'fletch', item: 'mithril_arrowhead' }, 'fletch gate (h)');
    assert(/Fletching level 45/.test(errGate.message), `(h) mithril heads refused at Fletching 1 ("${errGate.message}")`);
    const FletchPro = await loginClient('S19FletchPro'); clients.push(FletchPro);
    const mFP = FletchPro.mark();
    FletchPro.send({ type: 'fletch', item: 'mithril_arrowhead' });
    const fr2 = (await FletchPro.waitSince(mFP, (e) => e.type === 'fletch_result', 10000, 'fletch_result pro (h)')).e;
    assert(fr2.item === 'mithril_arrow' && fr2.qty === 10, '(h) past the gate, mithril heads fletch into 10 mithril arrows');
    console.log('PASS (h) fletching + level gates');

    // ---------- (i) duel with noRanged ----------
    const Bow = await loginClient('S19Bow'); clients.push(Bow);
    const Sword = await loginClient('S19Sword'); clients.push(Sword);
    const duel1 = await startDuelViaChallenge(Bow, Sword, { noRanged: true }, '(i)');
    assert(duel1.startC.rules && duel1.startC.rules.noRanged === true && duel1.startT.rules.noRanged === true, '(i) duel_start carries the agreed noRanged rule to both fighters');
    await Bow.waitFor((e) => e.type === 'chat' && /No Ranged in this duel/.test(e.text || ''), 10000, 'up-front ban notice (i)');
    console.log('PASS (i) the bow-wielder is told up front: No Ranged');
    const errBan = await expectError(Bow, { type: 'duel_attack' }, 'duel_attack ban (i)');
    assert(errBan.message === '🚫 No Ranged in this duel.', `(i) duel_attack refused with the ban message ("${errBan.message}")`);
    Sword.send({ type: 'duel_attack' });
    const mBow = Bow.mark(); const mSw = Sword.mark();
    await sleep(14000);
    const bowTicks = Bow.events.slice(mBow).filter((e) => e.type === 'duel_tick');
    const swTicks = Sword.events.slice(mSw).filter((e) => e.type === 'duel_tick');
    assert(swTicks.some((t) => typeof t.youHit === 'number'), '(i) the sword fighter swings normally');
    assert(bowTicks.length >= 8 && bowTicks.every((t) => typeof t.youHit !== 'number'), `(i) the bow-wielder never swings under noRanged (${bowTicks.length} ticks watched)`);
    const mBowEnd = Bow.mark();
    Bow.close();
    await Sword.waitSince(mSw, (e) => e.type === 'duel_end', 20000, 'duel_end after Bow left (i)');
    console.log('PASS (i) noRanged duel: sword swings, bow cannot');

    // ---------- (j) duel with a mage casting at range ----------
    const MageD = await loginClient('S19MageD'); clients.push(MageD);
    const Sword2 = await loginClient('S19Sword2'); clients.push(Sword2);
    await startDuelViaChallenge(MageD, Sword2, {}, '(j)');
    MageD.send({ type: 'duel_attack' });
    Sword2.send({ type: 'duel_attack' });
    const mMD = MageD.mark(); const mS2 = Sword2.mark();
    // Wait out the countdown, then step back to 120 from the sword.
    await MageD.waitSince(mMD, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 15000, 'countdown over (j)');
    MageD.send({ type: 'move', x: 700, y: 450 }); // Sword2 stands at (820,450): 120 away
    // The fighters spawn toe-to-toe (40 apart, inside melee reach),
    // so the sword may land its already-due opener swing on the
    // countdown's last tick before the mage's step back lands. The
    // range assertions therefore watch the window AFTER the move:
    // 3s for it to take effect, then 11s of clean observation.
    await sleep(3000);
    const mMD2 = MageD.mark(); const mS22 = Sword2.mark();
    await sleep(11000);
    const mdTicks = MageD.events.slice(mMD).filter((e) => e.type === 'duel_tick');
    const s2LateTicks = Sword2.events.slice(mS22).filter((e) => e.type === 'duel_tick');
    const mdCasts = mdTicks.filter((t) => typeof t.youHit === 'number').length;
    const mdLateCasts = MageD.events.slice(mMD2).filter((e) => e.type === 'duel_tick' && typeof e.youHit === 'number').length;
    assert(mdCasts >= 1 && mdLateCasts >= 1, `(j) the mage cast at range in the duel (${mdCasts} casts seen, ${mdLateCasts} after stepping back)`);
    assert(s2LateTicks.length >= 8 && s2LateTicks.every((t) => typeof t.youHit !== 'number'), `(j) the melee fighter, stuck out of reach, never swung after the step-back (${s2LateTicks.length} ticks watched)`);
    await sleep(300);
    const mdPro = await prof('S19MageD');
    assert(stackQty(mdPro, 'air_rune') === 60 - mdCasts, `(j) one air rune per duel cast (${mdCasts} casts: 60 -> ${stackQty(mdPro, 'air_rune')})`);
    MageD.close();
    await Sword2.waitSince(mS2, (e) => e.type === 'duel_end', 20000, 'duel_end after MageD left (j)');
    console.log('PASS (j) mage duel: casts land from 120 away, runes spent');

    console.log('ALL STAGE 19 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
