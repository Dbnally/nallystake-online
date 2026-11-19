// Stage 5 tests: worn expansion (10 slots, wearable fire cape),
// Barrows (crypt kills saved on the profile, the tunnel crypt, the
// puzzle door, the chest loot round-trip), the four duel arenas,
// drop piles, and combat styles in the Fight Caves (the Defensive
// block note; a negative check that the Stage 5 proc notes — extra
// hit / Power hit — never surface: Stage 10 removed the procs,
// Stage 27 brought them back as damage fields, and tick notes
// still never claim them).
//
// Stage 28 updates (flagged): the Barrows flow was rebuilt around
// the app version — entering a mound lands in a crypt and the
// fight starts on SEARCH; the tunnel crypt's sarcophagus is the
// way down (Descend); the puzzle is the app's pattern puzzle and a
// wrong answer costs 5 HP instead of erroring; the chest GUARD
// fight became the tunnel brother's AMBUSH; and the loot asserts
// the app's table (rolls = kills + 1, gold = the coin lines' sum)
// instead of the old 300-900 formula + >= 2 item rolls. The full
// Stage 28 behaviour has its own suite (test/stage28.js); this
// suite keeps its original intent — a full round-trip still works.
//
// Same harness style as test/stage4.js: HTTP /api/register + /api/login
// for accounts, WebSocket at /ws?token=..., and strong players seeded
// by editing the test DB file while the server is stopped.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18086;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage5.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

const MOUNDS = { // Stage 13: mound spots doubled with the world (server BARROWS_BROTHERS x2)
  dharok: { x: 300, y: 220 }, guthan: { x: 660, y: 160 }, torag: { x: 1020, y: 160 },
  verac: { x: 1320, y: 220 }, ahrim: { x: 480, y: 440 }, karil: { x: 1120, y: 440 },
};
const BROTHER_TYPE = { dharok: 'melee', guthan: 'melee', torag: 'melee', verac: 'melee', ahrim: 'magic', karil: 'missiles' };
const ALL_BROTHERS = Object.keys(MOUNDS);
const ARENA_NAMES = ['Sand Arena', 'Ember Arena', 'Azure Arena', 'Violet Arena'];

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
const qty = (profile, item) => {
  const s = (profile.backpack || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
// The prayer message TOGGLES: sending the active prayer turns it off.
// Only send when the client's latest profile disagrees with the goal.
function ensurePrayer(c, want) {
  const p = c.profile();
  if (!p || p.activePrayer !== want) c.send({ type: 'prayer', prayer: want });
}

// Drive an instanced Barrows fight to its end: keep the matching
// Deflect prayer up, sip prayer potions periodically, eat when hurt.
// fromIdx = event index just after the fight's start event.
async function driveBarrowsKill(c, brotherId, fromIdx) {
  ensurePrayer(c, BROTHER_TYPE[brotherId]);
  let idx = fromIdx;
  let ticks = 0;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const t = await c.waitSince(idx, (e) => e.type === 'npc_fight' && e.kind === 'barrows' && (e.phase === 'tick' || e.phase === 'end'), 30000, 'barrows tick/end').catch(() => null);
    if (!t) break;
    idx = t.idx + 1;
    if (t.e.phase === 'end') return t.e;
    ticks++;
    // Stage 28: walk back in on closing ticks — a magic/ranged
    // brother who ambushed at the puzzle door does not chase.
    if (t.e.closing && t.e.moveTo) c.send({ type: 'move', x: t.e.moveTo.x, y: t.e.moveTo.y });
    ensurePrayer(c, BROTHER_TYPE[brotherId]); // re-up if it drained dry
    if (ticks % 20 === 0) c.send({ type: 'use', item: 'prayer_potion' }); // harmless error if already full
    if (t.e.hpYou <= 40) c.send({ type: 'use', item: 'restore_potion' });
  }
  throw new Error(`barrows fight vs ${brotherId} did not end in time`);
}

// Watch Fight Caves ticks until a tick note contains `want`: keeps the
// player standing on the current target (positions tracked from
// fc_state rosters, kept on the client across calls) and eats to stay
// alive meanwhile. Scanning starts at fromIdx so the fc_state that
// arrives with fc_start is not missed.
async function watchFcNote(c, want, deadlineMs, fromIdx) {
  let idx = fromIdx !== undefined ? fromIdx : c.mark();
  if (!c.fcPositions) c.fcPositions = new Map();
  const positions = c.fcPositions;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const t = await c.waitSince(idx, (e) => e.type === 'fc_state' || e.type === 'fc_tick', Math.min(30000, Math.max(1000, deadline - Date.now())), 'fc event').catch(() => null);
    if (!t) break;
    idx = t.idx + 1;
    if (t.e.type === 'fc_state') {
      for (const m of t.e.monsters) positions.set(m.id, { x: m.x, y: m.y });
      continue;
    }
    if (t.e.hpYou > 0 && t.e.hpYou < 35) c.send({ type: 'use', item: 'restore_potion' });
    if (t.e.targetId && positions.has(t.e.targetId)) {
      const p = positions.get(t.e.targetId);
      c.send({ type: 'move', x: p.x, y: p.y });
      c.send({ type: 'fc_attack', id: t.e.targetId });
    }
    if (t.e.note && t.e.note.includes(want)) return t.e;
  }
  throw new Error(`Fight Caves note containing "${want}" never appeared`);
}

// Stage 10 adjustment: collect up to `wantTicks` Fight Caves ticks
// (same driving pattern as watchFcNote) so a test can assert on the
// ABSENCE of a note — the removed Stage 5 procs can only be checked
// negatively. Returns whatever was collected if the run ends first.
async function collectFcTicks(c, wantTicks, deadlineMs, fromIdx) {
  let idx = fromIdx !== undefined ? fromIdx : c.mark();
  if (!c.fcPositions) c.fcPositions = new Map();
  const positions = c.fcPositions;
  const ticks = [];
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline && ticks.length < wantTicks) {
    const t = await c.waitSince(idx, (e) => e.type === 'fc_state' || e.type === 'fc_tick' || e.type === 'fc_end', Math.min(30000, Math.max(1000, deadline - Date.now())), 'fc event').catch(() => null);
    if (!t) break;
    idx = t.idx + 1;
    if (t.e.type === 'fc_end') break;
    if (t.e.type === 'fc_state') {
      for (const m of t.e.monsters) positions.set(m.id, { x: m.x, y: m.y });
      continue;
    }
    ticks.push(t.e);
    if (t.e.hpYou > 0 && t.e.hpYou < 35) c.send({ type: 'use', item: 'restore_potion' });
    if (t.e.targetId && positions.has(t.e.targetId)) {
      const p = positions.get(t.e.targetId);
      c.send({ type: 'move', x: p.x, y: p.y });
      c.send({ type: 'fc_attack', id: t.e.targetId });
    }
  }
  return ticks;
}

async function main() {
  // Source-level check (stage4 style): the fire cape's catalog entry
  // makes it a cape — it never appears in the shop catalog list itself
  // (buy 0 / sell 0 are filtered out), so read the definition.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/ITEMS\.fire_cape = \{[^}]*slot: 'cape'/.test(src), 'source: fire_cape is defined with slot cape');
  assert(/ITEMS\.fire_cape = \{[^}]*sellOnly: 0/.test(src), 'source: fire_cape stays unsellable (sellOnly 0)');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Part 1: worn expansion ----------
    const hero = await register('S5Hero', 's5-hero-pass');
    clients.push(hero);
    const wp = hero.profile();
    const slotNames = Object.keys(wp.worn).sort();
    assert(JSON.stringify(slotNames) === JSON.stringify(['amulet', 'body', 'cape', 'feet', 'hands', 'head', 'legs', 'ring', 'shield', 'weapon']),
      `worn expansion: fresh profile has all 10 worn slots (${slotNames.join(',')})`);
    assert(Object.values(wp.worn).every((v) => v === null), 'worn expansion: all 10 slots start empty');
    assert(wp.barrows && Array.isArray(wp.barrows.kills) && wp.barrows.tunnel === null, 'barrows: fresh profile carries the empty run state');

    const cat = await hero.waitFor((e) => e.type === 'catalog', 10000, 'catalog');
    const byId = Object.fromEntries(cat.items.map((i) => [i.id, i]));
    for (const w of ['dharoks_greataxe', 'guthans_warspear', 'torags_hammers', 'veracs_flail', 'ahrims_staff', 'karils_crossbow']) {
      assert(byId[w] && byId[w].slot === 'weapon' && byId[w].buy === 0 && byId[w].sell === 800,
        `catalog: ${w} is a loot-only weapon (buy 0, sell floor 800)`);
    }
    hero.close();
    await sleep(400);

    // Seed a fire cape into the hero's backpack (server stopped).
    await stopServer();
    seedDb((data) => { data.users['s5hero'].profile.backpack.push({ item: 'fire_cape', qty: 1 }); });
    await startServer();
    const hero2 = await login('S5Hero', 's5-hero-pass');
    clients.push(hero2);
    hero2.send({ type: 'equip', item: 'fire_cape' });
    const eq = await hero2.waitFor((e) => e.type === 'profile' && e.profile.worn.cape === 'fire_cape', 10000, 'fire cape equipped');
    assert(eq.profile.worn.cape === 'fire_cape' && qty(eq.profile, 'fire_cape') === 0, 'equip: fire cape worn in the new cape slot');
    hero2.send({ type: 'unequip', slot: 'cape' });
    const un = await hero2.waitFor((e) => e.type === 'profile' && e.profile.worn.cape === null && qty(e.profile, 'fire_cape') === 1, 10000, 'fire cape unequipped');
    assert(un.profile.worn.cape === null, 'unequip: cape slot empties, cape back in the backpack');
    hero2.close();
    await sleep(400);

    // ---------- Part 2: Barrows ----------
    // Seed the strong runner (stage4 pattern): big Hitpoints pool,
    // full dragon + dragon sword, potions, the fire cape kept.
    await stopServer();
    seedDb((data) => {
      const u = data.users['s5hero'];
      u.profile.xp.hitpoints = 500000; // ~level 66 HP pool
      u.profile.worn = {
        weapon: 'dragon_sword', shield: 'dragon_shield', head: 'dragon_helm',
        body: 'dragon_platebody', legs: 'dragon_platelegs', cape: null, amulet: null,
        hands: null, feet: null, ring: null,
      };
      // Stage 16 (flagged seed fix): the replacement backpack keeps
      // the hero's 100 starter coins AS their gold stack — gold is
      // an item now, so a seed that wipes the stack while leaving
      // the profile.gold number would create money the stacks deny.
      u.profile.backpack = [
        { item: 'gold', qty: 100 },
        { item: 'prayer_potion', qty: 50 },
        { item: 'restore_potion', qty: 50 },
        { item: 'fire_cape', qty: 1 },
      ];
    });
    await startServer();
    const h = await login('S5Hero', 's5-hero-pass');
    clients.push(h);

    h.send({ type: 'travel', to: 'barrows' });
    const bs0 = await h.waitFor((e) => e.type === 'barrows_state', 10000, 'barrows_state on entry');
    assert(bs0.kills.length === 0 && bs0.tunnel === null && bs0.inTunnels === false, 'barrows: entering the field reports the empty run');

    // Stage 28 (flagged flow change): entering a mound now puts you
    // IN its crypt — the fight starts when you search the
    // sarcophagus there. The tunnel crypt offers no fight: check
    // its sarcophagus refuses, climb back out, try the next mound.
    let firstKill = null;
    for (const b of ALL_BROTHERS) {
      const m0 = h.mark();
      h.send({ type: 'move', x: MOUNDS[b].x, y: MOUNDS[b].y });
      await sleep(400);
      h.send({ type: 'barrows_enter', brother: b });
      const st = (await h.waitSince(m0, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'crypt entry state')).e;
      assert(st.crypt === b, `barrows: entering ${b}'s mound puts you in his crypt`);
      if (st.tunnel === b) {
        const mS = h.mark();
        h.send({ type: 'barrows_search' });
        await h.waitSince(mS, (e) => e.type === 'error' && /way DOWN/.test(e.message || ''), 10000, 'tunnel crypt search refused');
        console.log(`PASS barrows: the tunnel crypt (${b}) offers the way down instead of a fight`);
        h.send({ type: 'barrows_leave_crypt' });
        await h.waitSince(h.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'climbed back out');
        continue;
      }
      h.send({ type: 'move', x: 800, y: 470 }); // up to the sarcophagus
      await sleep(400);
      const mF = h.mark();
      h.send({ type: 'barrows_search' });
      const r = (await h.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, 'crypt fight start')).e;
      assert(r.npcId === b && r.name && r.combatLevel >= 98, `barrows: crypt fight started vs ${r.name} (level ${r.combatLevel})`);
      const end = await driveBarrowsKill(h, b, mF + 1);
      assert(end.reason === 'kill', `barrows: ${b} killed in his crypt`);
      firstKill = { brother: b, kills: end.profile.barrows.kills, tunnel: end.profile.barrows.tunnel };
      h.send({ type: 'barrows_leave_crypt' });
      await h.waitSince(h.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'climbed out of the crypt');
      break;
    }
    assert(firstKill && firstKill.kills.length === 1 && firstKill.kills[0] === firstKill.brother,
      `barrows: the kill is banked on the profile (kills: ${firstKill ? firstKill.kills.join(',') : 'none'})`);
    assert(firstKill.tunnel && ALL_BROTHERS.includes(firstKill.tunnel), `barrows: a tunnel crypt was assigned (${firstKill.tunnel})`);

    // Leaving and coming back keeps the kills (Derek's rule).
    h.send({ type: 'travel', to: 'plaza' });
    await h.waitFor((e) => e.type === 'area' && e.area === 'plaza', 10000, 'back to plaza');
    const mBack = h.mark();
    h.send({ type: 'travel', to: 'barrows' });
    const bs1 = (await h.waitSince(mBack, (e) => e.type === 'barrows_state', 10000, 'barrows_state on re-entry')).e;
    assert(bs1.kills.length === 1 && bs1.tunnel === firstKill.tunnel, 'barrows: kills and tunnel kept after leaving and returning');
    h.close();
    await sleep(400);

    // Restart persistence of the run state.
    await stopServer();
    await startServer();
    const h2 = await login('S5Hero', 's5-hero-pass');
    clients.push(h2);
    const profAfterRestart = h2.profile();
    assert(profAfterRestart.barrows.kills.length === 1 && profAfterRestart.barrows.tunnel === firstKill.tunnel,
      'barrows saving: kills + tunnel survive a server restart');
    const tunnel = profAfterRestart.barrows.tunnel;
    h2.close();
    await sleep(400);

    // Seed the run to 5 kills (everyone but the tunnel brother).
    await stopServer();
    seedDb((data) => {
      const u = data.users['s5hero'];
      u.profile.barrows.kills = ALL_BROTHERS.filter((b) => b !== u.profile.barrows.tunnel);
    });
    await startServer();
    const h3 = await login('S5Hero', 's5-hero-pass');
    clients.push(h3);
    assert(h3.profile().barrows.kills.length === 5, 'barrows: seeded run stands at 5 kills');

    // Down the tunnel crypt. Stage 28 (flagged flow change):
    // entering the mound lands in the crypt; Descend goes down.
    h3.send({ type: 'travel', to: 'barrows' });
    await h3.waitFor((e) => e.type === 'area' && e.area === 'barrows', 10000, 'in the barrows field');
    const mTun = h3.mark();
    h3.send({ type: 'move', x: MOUNDS[tunnel].x, y: MOUNDS[tunnel].y });
    await sleep(400);
    h3.send({ type: 'barrows_enter', brother: tunnel });
    await h3.waitSince(mTun, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'in the tunnel crypt');
    h3.send({ type: 'barrows_descend' });
    await h3.waitSince(mTun, (e) => e.type === 'area' && e.area === 'barrows_tunnels', 10000, 'descended into the tunnels');
    const bsT = await h3.waitFor((e) => e.type === 'barrows_state' && e.inTunnels === true, 10000, 'barrows_state in tunnels');
    assert(bsT.kills.length === 5, 'barrows: tunnels state still shows the 5 kills');

    // The puzzle door — Stage 28 (flagged change): the app's
    // pattern puzzle replaces the 3-symbol combination. A wrong
    // answer no longer errors or re-deals: it costs exactly 5 HP
    // off the tunnel pool and the same puzzle stays open. Every
    // app pattern family ends with its first shape, so the answer
    // is shown[0]; any other option is a guaranteed miss.
    h3.send({ type: 'barrows_puzzle' });
    const pz1 = await h3.waitFor((e) => e.type === 'barrows_puzzle', 10000, 'first puzzle');
    assert(Array.isArray(pz1.shown) && pz1.shown[pz1.shown.length - 1] === '❓' && Array.isArray(pz1.options) && pz1.options.length === 3,
      'puzzle: server deals a shape pattern (last shape hidden) with 3 options');
    const answerIdx = pz1.options.indexOf(pz1.shown[0]);
    const wrongIdx = pz1.options.findIndex((o, i) => i !== answerIdx);
    const mWrong = h3.mark();
    h3.send({ type: 'barrows_puzzle_answer', index: wrongIdx });
    const wRes = (await h3.waitSince(mWrong, (e) => e.type === 'barrows_puzzle_result', 10000, 'wrong answer result')).e;
    assert(wRes.ok === false && wRes.hpYou === wRes.maxHpYou - 5, `puzzle: a wrong answer bites for exactly 5 HP (${wRes.hpYou}/${wRes.maxHpYou})`);
    h3.send({ type: 'barrows_puzzle_answer', index: answerIdx });
    const pzOk = await h3.waitFor((e) => e.type === 'barrows_puzzle_result' && e.ok === true, 10000, 'puzzle solved');
    assert(pzOk.ok === true, 'puzzle: the completing shape opens the door');

    // The chest — Stage 28 (flagged change): the chest GUARD fight
    // is gone; the tunnel brother AMBUSHES instead (a coin flip at
    // the puzzle door, guaranteed in the chest room, and reaching
    // for the chest itself is the backstop trigger).
    const mAmb = h3.mark();
    h3.send({ type: 'move', x: 800, y: 300 });
    await sleep(700);
    h3.send({ type: 'move', x: 800, y: 130 });
    await sleep(700);
    let ambStart = h3.events.slice(mAmb).find((e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows');
    if (!ambStart) {
      h3.send({ type: 'barrows_loot' });
      ambStart = (await h3.waitSince(mAmb, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, 'ambush at the chest')).e;
    }
    assert(ambStart.npcId === tunnel, `barrows: the tunnel brother (${tunnel}) ambushes in the tunnels`);
    const ambEnd = await driveBarrowsKill(h3, tunnel, mAmb + 1);
    assert(ambEnd.reason === 'kill' && ambEnd.profile.barrows.kills.length === 6,
      'barrows: tunnel brother killed in the ambush — the round stands at 6/6');

    // Now the chest pays out and the round resets. Stage 28
    // (flagged change): the loot is the app's table — rolls =
    // kills + 1 with a per-roll breakdown; the gold total is the
    // coin lines' sum (no more fixed 300-900 formula or the old
    // >= 2 item-rolls guarantee).
    h3.send({ type: 'move', x: 800, y: 130 });
    await sleep(300);
    const goldBefore = h3.profile().gold;
    const mLoot2 = h3.mark();
    h3.send({ type: 'barrows_loot' });
    const loot = (await h3.waitSince(mLoot2, (e) => e.type === 'barrows_loot', 15000, 'chest loot')).e;
    // Stage 28b: a 6/6 chest can also carry ONE tier line (the
    // 1-in-20 Barrows tier prize) on top of the 7 roll lines.
    const tierLines5 = loot.lines.filter((l) => l.kind === 'tierpiece' || l.kind === 'tiercoins');
    assert(loot.kills === 6 && loot.rolls === 7 && Array.isArray(loot.lines) && loot.lines.length === 7 + tierLines5.length && tierLines5.length <= 1,
      `barrows loot: 7 rolls for the full round (${loot.lines.map((l) => l.kind).join(', ')})`);
    const coinSum = loot.lines.filter((l) => l.kind === 'coins' || l.kind === 'tiercoins').reduce((s, l) => s + l.gold, 0);
    assert(loot.gold === coinSum, `barrows loot: gold total (${loot.gold}) is the coin rolls' sum`);
    assert(loot.profile.gold === goldBefore + loot.gold, 'barrows loot: gold landed on the profile');
    assert(loot.profile.barrows.kills.length === 0 && loot.profile.barrows.tunnel === null,
      'barrows loot: the round is finished — run state reset for the next round');
    await h3.waitSince(mLoot2, (e) => e.type === 'area' && e.area === 'barrows', 10000, 'back on the field after looting');
    console.log('PASS barrows: full round — crypt kill, kept kills, tunnels, puzzle, ambush, chest loot, reset');

    // ---------- Part 3: the four duel arenas ----------
    const foe = await register('S5Foe', 's5-foe-pass');
    clients.push(foe);
    const heroGoldBefore = h3.profile().gold;
    h3.send({ type: 'travel', to: 'plaza' });
    await h3.waitFor((e) => e.type === 'area' && e.area === 'plaza', 10000, 'hero back in plaza');
    h3.send({ type: 'challenge', target: 'S5Foe', stake: 10 });
    const offer = await foe.waitFor((e) => e.type === 'challenge_incoming' && e.from === 'S5Hero', 10000, 'challenge offer');
    assert(offer.stake === 10 && offer.challengeId, 'arena duel: challenge offered for 10g');
    const mDuelH = h3.mark(), mDuelF = foe.mark();
    foe.send({ type: 'challenge_response', challengeId: offer.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    h3.send({ type: 'challenge_confirm', challengeId: offer.challengeId });
    foe.send({ type: 'challenge_confirm', challengeId: offer.challengeId });
    const startH = (await h3.waitSince(mDuelH, (e) => e.type === 'duel_start', 10000, 'hero duel_start')).e;
    const startF = (await foe.waitSince(mDuelF, (e) => e.type === 'duel_start', 10000, 'foe duel_start')).e;
    // Stage 12: duel fighters start un-engaged — both tap to attack.
    h3.send({ type: 'duel_attack' }); foe.send({ type: 'duel_attack' });
    assert(startH.arena && startF.arena && startH.arena.id === startF.arena.id && ARENA_NAMES.includes(startH.arena.name),
      `arenas: both fighters were sent to the same arena (${startH.arena.name})`);
    const snap = (await h3.waitSince(mDuelH, (e) => e.type === 'state' && e.players.some((p) => p.username === 'S5Foe' && p.area === 'arena'), 10000, 'arena snapshot')).e;
    assert(snap.players.find((p) => p.username === 'S5Hero').area === 'arena', 'arenas: snapshots place both fighters in the arena area');
    const mDrop = h3.mark();
    h3.send({ type: 'drop', item: 'ration', qty: 1 });
    await h3.waitSince(mDrop, (e) => e.type === 'error', 10000, 'drop refused mid-duel');
    console.log('PASS arenas: dropping is refused during a duel');
    const mEndH = h3.mark(), mEndF = foe.mark();
    const endH = (await h3.waitSince(mEndH, (e) => e.type === 'duel_end', 240000, 'hero duel_end')).e;
    const endF = (await foe.waitSince(mEndF, (e) => e.type === 'duel_end', 240000, 'foe duel_end')).e;
    assert(endH.winner === 'S5Hero' && endF.winner === 'S5Hero', `arenas: the seeded hero won the duel (${endH.reason})`);
    // Stage 20 (flagged fix): +25 more on the hero — the one-time
    // "Win a duel" starter-goal reward on his first duel win.
    assert(endH.profile.gold === heroGoldBefore + 10 + 25 && endF.profile.gold === 90,
      `arenas: escrow settled (hero ${endH.profile.gold}g, foe ${endF.profile.gold}g)`);
    await h3.waitSince(mEndH, (e) => e.type === 'area' && e.area === 'plaza', 10000, 'hero returned to plaza');
    await foe.waitSince(mEndF, (e) => e.type === 'area' && e.area === 'plaza', 10000, 'foe returned to plaza');
    console.log('PASS arenas: both fighters returned to the plaza when the duel ended');

    // ---------- Part 4: drop piles ----------
    // Stage 28 (flagged): counts are RELATIVE now — the app's
    // Barrows loot table pays rations as filler, so the hero may
    // already hold some from the chest in Part 2 (the old table
    // never did, which is why this used to count from zero).
    h3.send({ type: 'shop_buy', item: 'ration', qty: 3 });
    await h3.waitFor((e) => e.type === 'profile' && qty(e.profile, 'ration') >= 3, 10000, 'rations bought');
    const rationsBefore = qty(h3.profile(), 'ration');
    const mPile = h3.mark();
    h3.send({ type: 'drop', item: 'ration', qty: 2 });
    const pilesEv = (await h3.waitSince(mPile, (e) => e.type === 'piles' && e.area === 'plaza' && e.piles.some((p) => p.item === 'ration'), 10000, 'pile broadcast')).e;
    const pile = pilesEv.piles.find((p) => p.item === 'ration');
    assert(pile.qty === 2 && pile.owner === 'S5Hero', `piles: dropped pile on the ground (${pile.qty}x ration, owner ${pile.owner})`);
    assert(qty(h3.profile(), 'ration') === rationsBefore - 2, `piles: the drop left the backpack (${rationsBefore} - 2 = ${rationsBefore - 2} rations)`);
    foe.send({ type: 'move', x: pile.x, y: pile.y });
    await sleep(500);
    const mPick = foe.mark();
    foe.send({ type: 'pickup', pileId: pile.id });
    await foe.waitSince(mPick, (e) => e.type === 'profile' && qty(e.profile, 'ration') >= 2, 10000, 'foe picked the pile up');
    assert(qty(foe.profile(), 'ration') === 2 && qty(h3.profile(), 'ration') === rationsBefore - 2,
      'piles: pickup conserved the items (hero keeps the rest, foe holds the 2 from the pile)');
    await foe.waitSince(mPick, (e) => e.type === 'piles' && !e.piles.some((p) => p.id === pile.id), 10000, 'pile removed after pickup');
    console.log('PASS piles: the emptied pile was broadcast away');

    // ---------- Part 5: combat styles (via Fight Caves tick notes) ----------
    // Stage 10 adjustment: the Stage 5 proc this part used to watch
    // for (Accurate's 25% "extra hit") was removed by Derek's
    // rebalance, so the Accurate half became a NEGATIVE check — over
    // a real sample of ticks, no note may claim the procs.
    // Stage 27: the procs are back (Derek's "Everything" decision),
    // but as damage fields (youBonus), never as notes — so the
    // negative check stands exactly as written. The Defensive half
    // is unchanged in shape: its full block still surfaces as a
    // tick note (the chance is the 25% proc since Stage 27; it was
    // a flat 20% under Stage 10). Note the Stage 27 order: the
    // block note now fires only on CONNECTING hits (accuracy rolls
    // first) — with prayer off here (ensurePrayer null above) and
    // cave monsters swinging for minutes, it still lands quickly.
    ensurePrayer(h3, null); // blocks must come from the style, not a prayer
    h3.send({ type: 'travel', to: 'fightcaves' });
    await h3.waitFor((e) => e.type === 'area' && e.area === 'fightcaves', 10000, 'in the fight caves');
    h3.send({ type: 'style', style: 'accurate' });
    await sleep(300);
    const mFc = h3.mark();
    h3.send({ type: 'fc_start' });
    const accTicks = await collectFcTicks(h3, 25, 90000, mFc);
    assert(accTicks.length >= 15, `style boosts: observed ${accTicks.length} Fight Caves ticks in Accurate (need >= 15 for the negative check)`);
    assert(!accTicks.some((t) => t.note && (t.note.includes('extra hit') || t.note.includes('Power hit'))),
      'style boosts: no proc notes (extra hit / Power hit) surface — Stage 27 procs are damage fields, not notes');
    h3.send({ type: 'style', style: 'defensive' });
    const blockTick = await watchFcNote(h3, 'Blocked by your', 200000);
    assert(blockTick.note.includes('Blocked by your Defensive style'), `style boosts: Defensive fully blocked a hit ("${blockTick.note}")`);
    h3.send({ type: 'fc_leave' });
    await h3.waitFor((e) => e.type === 'fc_end', 10000, 'fc run left cleanly');
    console.log('PASS style boosts: no proc notes in Accurate (Stage 27 procs are fields, not notes), full block (Defensive) surfaced in tick notes');

    for (const c of clients) c.close();
    console.log('ALL STAGE 5 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
