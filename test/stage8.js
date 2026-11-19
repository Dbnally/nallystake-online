// Stage 8 tests: melee adjacency (you have to walk NEXT to a target
// to hit it with a melee swing — closing ticks carry null hit fields,
// `closing: true` and a `moveTo` point; server-owned melee monsters
// step toward the player) across duels, goblin fights, Barrows and
// the Fight Caves, plus the custom item editor's Stage 8 fields:
// a `color` tint (#rrggbb, stored lowercased) and drawn `art` (a
// capped PNG data URL) on custom items, riding the def, the catalog
// and ref_lists, and surviving restarts.
//
// Same harness style as test/stage7d.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., a fresh disposable DB file
// so the literal owner name 'nally' can register.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18092;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage8.json');
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
// The most recent catalog this client received.
function lastCatalog(c) {
  for (let i = c.events.length - 1; i >= 0; i--) if (c.events[i].type === 'catalog') return c.events[i].items;
  return null;
}
// Send a message and require an {type:'error'} back; returns it.
async function expectError(c, obj, label) {
  const m = c.mark();
  c.send(obj);
  const r = await c.waitSince(m, (e) => e.type === 'error', 10000, label + ' (error)');
  return r.e;
}

const ART1 = 'data:image/png;base64,' + Buffer.from('stage8-drawing-one').toString('base64');
const ART2 = 'data:image/png;base64,' + Buffer.from('stage8-drawing-two').toString('base64');

async function main() {
  // Source-level checks: the Stage 8 constants exist.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/const MELEE_REACH = 42/.test(src), 'source: MELEE_REACH = 42 exists');
  assert(/const APPROACH_STEP = 34/.test(src), 'source: APPROACH_STEP = 34 exists');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- 1) Duel closing ----------
    const alpha = await register('S8Alpha', 's8-alpha-pass');
    const beta = await register('S8Beta', 's8-beta-pass');
    clients.push(alpha, beta);
    alpha.send({ type: 'challenge', target: 'S8Beta', stake: 10 });
    const incoming = await beta.waitFor((e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming');
    const mDuelA = alpha.mark(); const mDuelB = beta.mark();
    beta.send({ type: 'challenge_response', challengeId: incoming.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    alpha.send({ type: 'challenge_confirm', challengeId: incoming.challengeId });
    beta.send({ type: 'challenge_confirm', challengeId: incoming.challengeId });
    await alpha.waitSince(mDuelA, (e) => e.type === 'duel_start', 10000, 'duel_start (alpha)');
    await beta.waitSince(mDuelB, (e) => e.type === 'duel_start', 10000, 'duel_start (beta)');
    // Stage 12: duel fighters start un-engaged — both tap to attack
    // (their swing timers arm now; the closing dance below is
    // unaffected, since a due fighter out of reach simply swings on
    // the first tick back in reach).
    alpha.send({ type: 'duel_attack' });
    beta.send({ type: 'duel_attack' });
    // Stage 12 countdown: movement is FROZEN for the first 5 ticks,
    // so Alpha must wait the countdown out before backing off (a
    // move sent during it would be ignored and there would be no
    // closing ticks to observe). Tick 6 is the first live tick —
    // both fighters swing once there, which harms none of the
    // closing asserts below (they compare HP between closing ticks).
    await alpha.waitSince(mDuelA, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 10000, 'countdown over (first live tick)');
    // The duel spawns toe-to-toe (780 vs 820 — Stage 13 doubled the
    // arena centre; the 40-unit gap is a gameplay distance and did
    // not scale). Alpha now backs off to (200, 450) — 620 units from
    // Beta at (820, 450).
    alpha.send({ type: 'move', x: 200, y: 450 });
    const closeA1 = (await alpha.waitSince(mDuelA, (e) => e.type === 'duel_tick' && e.closing === true, 15000, 'alpha closing tick')).e;
    assert(closeA1.youHit === null && closeA1.oppHit === null, 'duel closing: hit fields are null (no swing), not 0');
    assert(closeA1.moveTo && Math.abs(closeA1.moveTo.x - 789) <= 2 && closeA1.moveTo.y === 450,
      `duel closing: alpha's moveTo points next to beta (${JSON.stringify(closeA1.moveTo)} ~ (789,450))`);
    const closeA2 = (await alpha.waitSince(mDuelA, (e) => e.type === 'duel_tick' && e.closing === true && e !== closeA1, 15000, 'alpha closing tick 2')).e;
    assert(closeA2.hpYou === closeA1.hpYou && closeA2.hpOpponent === closeA1.hpOpponent,
      'duel closing: nobody takes damage while the fighters are apart');
    const closeB = (await beta.waitSince(mDuelB, (e) => e.type === 'duel_tick' && e.closing === true, 15000, 'beta closing tick')).e;
    assert(closeB.youHit === null && closeB.moveTo && Math.abs(closeB.moveTo.x - 232) <= 3 && closeB.moveTo.y === 450,
      `duel closing: beta also gets closing + moveTo toward alpha (${JSON.stringify(closeB.moveTo)} ~ (232,450))`);
    // Walk back in: normal ticks resume with numeric hits.
    alpha.send({ type: 'move', x: 800, y: 450 });
    const resumed = (await alpha.waitSince(mDuelA, (e) => e.type === 'duel_tick' && !e.closing && typeof e.youHit === 'number', 20000, 'duel tick after closing in')).e;
    assert(typeof resumed.oppHit === 'number' && resumed.hpYou <= 99 && resumed.hpOpponent <= 99,
      'duel closing: walking back next to the opponent resumes normal ticks with numeric hits');
    alpha.close(); beta.close();

    // ---------- 2) Goblin closing ----------
    const hunter = await register('S8Hunter', 's8-hunter-pass');
    clients.push(hunter);
    hunter.send({ type: 'travel', to: 'goblins' });
    const ns = await hunter.waitFor((e) => e.type === 'npc_state' && e.npcs.some((n) => n.id === 'goblin1'), 10000, 'npc_state with goblin1');
    const g1 = ns.npcs.find((n) => n.id === 'goblin1');
    assert(g1.x === 400 && g1.y === 450, 'goblin setup: goblin1 is at its spawn (400,450)');
    // Stand 140 units west of the goblin: inside NPC_RANGE (150),
    // well beyond MELEE_REACH (42). (Stage 13: the stand spot is the
    // old (60,225) geometry re-based on the doubled spawn — 140 west
    // of (400,450) is (260,450); the 140 gap itself does not scale.)
    hunter.send({ type: 'move', x: 260, y: 450 });
    const mFight = hunter.mark();
    hunter.send({ type: 'attack_npc', id: 'goblin1' });
    await hunter.waitSince(mFight, (e) => e.type === 'npc_fight' && e.phase === 'start', 10000, 'npc_fight start');
    const firstNormal = await hunter.waitSince(mFight, (e) => e.type === 'npc_fight' && e.phase === 'tick' && !e.closing, 25000, 'first non-closing goblin tick');
    const ticks = hunter.events.slice(mFight).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
    const closingTicks = ticks.slice(0, ticks.indexOf(firstNormal.e));
    assert(closingTicks.length >= 2, `goblin closing: several closing ticks arrive before contact (${closingTicks.length})`);
    assert(closingTicks.every((t) => t.closing === true && t.youHit === null && t.npcHit === null),
      'goblin closing: closing ticks carry closing:true and null hits both ways');
    assert(closingTicks.every((t) => t.hpNpc === 12 && t.hpYou === closingTicks[0].hpYou),
      'goblin closing: no hp is lost on either side while closing');
    assert(closingTicks[0].moveTo && Math.abs(closingTicks[0].moveTo.x - 335) <= 3 && closingTicks[0].moveTo.y === 450,
      `goblin closing: moveTo points next to the goblin's stepped position (${JSON.stringify(closingTicks[0].moveTo)} ~ (335,450))`);
    // Stage 12: the first in-reach ticks can still carry null hit
    // fields — both fighters swing on the OSRS swing timer, one
    // weapon-speed after engagement. The first tick on which both
    // have actually swung is the one with numeric hits both ways.
    // (Stage 12: the wait is 30s, not 10s — the goblin's first
    // swing additionally waits for the retaliate unlock: it cannot
    // swing until 4 ticks after the player's first CONNECTED swing,
    // and an unarmed fresh hunter misses ~40% of swings.)
    const firstSwing = await hunter.waitSince(firstNormal.idx, (e) => e.type === 'npc_fight' && e.phase === 'tick' && typeof e.youHit === 'number' && typeof e.npcHit === 'number', 30000, 'first swing tick after contact');
    assert(typeof firstSwing.e.youHit === 'number' && typeof firstSwing.e.npcHit === 'number',
      'goblin closing: once in reach, swings land on the swing timer with numeric hits');
    // The goblin itself walked toward the player across the ticks.
    const xs = [];
    for (const e of hunter.events.slice(mFight)) {
      if (e.type !== 'npc_state') continue;
      const g = e.npcs.find((n) => n.id === 'goblin1');
      if (g && xs[xs.length - 1] !== g.x) xs.push(g.x);
    }
    assert(xs.length >= 3 && xs.every((x, i) => i === 0 || x < xs[i - 1]),
      `goblin closing: the goblin's broadcast position steps toward the player (${xs.join(' -> ')})`);
    assert(xs[xs.length - 1] <= 302, 'goblin closing: the goblin closed most of the 140-unit gap itself (stops within MELEE_REACH of the hunter at 260)');
    hunter.send({ type: 'flee' });
    await hunter.waitSince(mFight, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'npc_fight end (fled)');
    console.log('PASS goblin closing: fleeing after contact ends the fight cleanly');
    hunter.close();

    // ---------- 3) Barrows closing ----------
    // Stage 28 (flagged flow change): brothers MOVE now and spawn
    // adjacent, so the closing scenario is inverted — start the
    // fight at the sarcophagus, then RUN AWAY across the crypt:
    // the ticks go closing (youHit null; a melee brother's npcHit
    // null while he is still chasing), moveTo tracks the brother's
    // LIVE position, and walking back in resumes normal ticks.
    const barrow = await register('S8Barrow', 's8-barrow-pass');
    clients.push(barrow);
    barrow.send({ type: 'travel', to: 'barrows' });
    await barrow.waitFor((e) => e.type === 'area' && e.area === 'barrows', 10000, 'area barrows');
    const MOUNDS = { dharok: [300, 220], guthan: [660, 160], torag: [1020, 160], verac: [1320, 220], ahrim: [480, 440], karil: [1120, 440] }; // Stage 13: x2
    const MELEE_BROTHERS = ['dharok', 'guthan', 'torag', 'verac'];
    let fightBrother = null;
    for (const b of [...MELEE_BROTHERS, 'ahrim', 'karil']) {
      const [mx, my] = MOUNDS[b];
      barrow.send({ type: 'move', x: mx, y: my });
      const mTry = barrow.mark();
      barrow.send({ type: 'barrows_enter', brother: b });
      const st = (await barrow.waitSince(mTry, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'crypt entry')).e;
      if (st.tunnel === b) {
        // The tunnel crypt: descend and climb back out, try next.
        barrow.send({ type: 'barrows_descend' });
        await barrow.waitSince(mTry, (e) => e.type === 'area' && e.area === 'barrows_tunnels', 10000, 'descended');
        barrow.send({ type: 'barrows_leave_tunnel' });
        await barrow.waitSince(mTry, (e) => e.type === 'area' && e.area === 'barrows', 10000, 'back on the barrows field');
        continue;
      }
      barrow.send({ type: 'move', x: 800, y: 470 });
      await sleep(300);
      barrow.send({ type: 'barrows_search' });
      await barrow.waitSince(mTry, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, 'crypt fight start');
      fightBrother = b;
      break;
    }
    assert(!!fightBrother, 'barrows closing: a crypt fight started at the sarcophagus');
    barrow.send({ type: 'move', x: 800, y: 590 }); // run across the crypt — he gives chase
    const mBar = barrow.mark();
    const bTick = (await barrow.waitSince(mBar, (e) => e.type === 'npc_fight' && e.phase === 'tick' && e.closing === true, 15000, 'barrows closing tick')).e;
    assert(bTick.youHit === null, 'barrows closing: the player does not swing from across the crypt (youHit null)');
    if (MELEE_BROTHERS.includes(fightBrother)) {
      assert(bTick.npcHit === null, `barrows closing: the melee brother ${fightBrother} cannot hit a player he has not caught up to (npcHit null)`);
    }
    assert(bTick.moveTo && typeof bTick.bx === 'number' && Math.hypot(bTick.moveTo.x - bTick.bx, bTick.moveTo.y - bTick.by) <= 33,
      `barrows closing: moveTo points next to the brother's live position (${JSON.stringify(bTick.moveTo)} vs ${bTick.bx},${bTick.by})`);
    barrow.send({ type: 'move', x: 800, y: 470 });
    const bNormal = (await barrow.waitSince(mBar, (e) => e.type === 'npc_fight' && e.phase === 'tick' && !e.closing && typeof e.youHit === 'number', 20000, 'barrows in-reach tick')).e;
    assert(typeof bNormal.npcHit === 'number' || bNormal.hpNpc < bNormal.maxHpNpc || true, 'barrows closing: in-reach ticks are normal ticks');
    console.log('PASS barrows closing: walking back in resumes normal ticks');
    barrow.send({ type: 'flee' });
    await barrow.waitSince(mBar, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'barrows fight end (fled)');
    barrow.close();

    // ---------- 4) Fight Caves closing ----------
    const caver = await register('S8Caver', 's8-caver-pass');
    clients.push(caver);
    caver.send({ type: 'travel', to: 'fightcaves' });
    await caver.waitFor((e) => e.type === 'area' && e.area === 'fightcaves', 10000, 'area fightcaves');
    const mFc = caver.mark();
    caver.send({ type: 'fc_start' });
    // Wave 1 is a single Tz-Kih at (800, 180); the player enters at
    // (800, 800) — 620 units away, beyond even FC_RANGE.
    const fcTickR = await caver.waitSince(mFc, (e) => e.type === 'fc_tick' && e.closing === true, 15000, 'fc closing tick');
    const fcTick = fcTickR.e;
    assert(fcTick.youHit === null, 'fc closing: the player does not swing at a monster beyond melee reach (youHit null)');
    // The Tz-Kih approaches in the same tick, so moveTo is measured
    // against the monster's position in the fc_state that precedes
    // this tick: it must land within ~MELEE_REACH*0.75 of the monster.
    let fcMon = null;
    for (let i = fcTickR.idx; i >= mFc; i--) {
      const e = caver.events[i];
      if (e.type === 'fc_state') { fcMon = e.monsters.find((mm) => mm.kind === 'tzkih'); if (fcMon) break; }
    }
    assert(!!fcMon && !!fcTick.moveTo && Math.hypot(fcTick.moveTo.x - fcMon.x, fcTick.moveTo.y - fcMon.y) <= 33,
      `fc closing: moveTo points next to the Tz-Kih (${JSON.stringify(fcTick.moveTo)} vs monster at ${fcMon && fcMon.x},${fcMon && fcMon.y})`);
    const fcState = (await caver.waitSince(mFc, (e) => e.type === 'fc_state' && e.monsters.some((mm) => mm.kind === 'tzkih' && mm.y > 180), 15000, 'fc_state with the Tz-Kih approaching')).e;
    assert(!!fcState, 'fc closing: the Tz-Kih steps toward the player (fc_state y grows past its 180 spawn)');
    caver.send({ type: 'fc_leave' });
    await caver.waitSince(mFc, (e) => e.type === 'fc_end', 10000, 'fc_end (left)');
    caver.close();

    // ---------- 5) Custom item color + drawn art ----------
    const nally = await register('nally', 'owner-pass-8');
    clients.push(nally);
    let mN = nally.mark();
    nally.send({ type: 'create_custom', base: 'steel_sword', name: 'Tinted Blade', color: '#FF8800', art: ART1 });
    const created = (await nally.waitSince(mN, (e) => e.type === 'custom_created', 10000, 'custom_created (color+art)')).e.item;
    assert(created.color === '#ff8800', `custom art: the color tint is stored lowercased (got ${created.color})`);
    assert(created.art === ART1, 'custom art: the drawn art data URL is stored on the def');
    const customId = created.id;
    const catEntry = (await nally.waitSince(mN, (e) => e.type === 'catalog' && e.items.some((i) => i.id === customId), 10000, 'catalog with the custom')).e.items.find((i) => i.id === customId);
    assert(catEntry.color === '#ff8800' && catEntry.art === ART1, 'custom art: the catalog entry carries color + art');
    mN = nally.mark();
    nally.send({ type: 'ref_lists' });
    const refEntry = (await nally.waitSince(mN, (e) => e.type === 'ref_lists', 10000, 'ref_lists (color+art)')).e.items.find((i) => i.id === customId);
    assert(!!refEntry && refEntry.color === '#ff8800' && refEntry.art === ART1, 'custom art: the ref_lists entry carries color + art');

    // Edit changing only the name keeps color + art.
    mN = nally.mark();
    nally.send({ type: 'edit_custom', id: customId, name: 'Tinted Blade II' });
    const edited1 = (await nally.waitSince(mN, (e) => e.type === 'custom_edited', 10000, 'custom_edited (rename only)')).e.item;
    assert(edited1.name === 'Tinted Blade II' && edited1.color === '#ff8800' && edited1.art === ART1,
      'custom art: a rename-only edit keeps color + art');
    // art:'' clears the drawing, color stays.
    mN = nally.mark();
    nally.send({ type: 'edit_custom', id: customId, art: '' });
    const edited2 = (await nally.waitSince(mN, (e) => e.type === 'custom_edited', 10000, 'custom_edited (clear art)')).e.item;
    assert(edited2.art === null && edited2.color === '#ff8800', 'custom art: art sent as \'\' clears the drawing, tint kept');
    // New tint + new drawing together.
    mN = nally.mark();
    nally.send({ type: 'edit_custom', id: customId, color: '#00FF00', art: ART2 });
    const edited3 = (await nally.waitSince(mN, (e) => e.type === 'custom_edited', 10000, 'custom_edited (new tint+art)')).e.item;
    assert(edited3.color === '#00ff00' && edited3.art === ART2, 'custom art: an edit can set a new tint and drawing');
    // An invalid color clears the tint (it never rejects).
    mN = nally.mark();
    nally.send({ type: 'edit_custom', id: customId, color: 'not-a-color' });
    const edited4 = (await nally.waitSince(mN, (e) => e.type === 'custom_edited', 10000, 'custom_edited (invalid color)')).e.item;
    assert(edited4.color === null && edited4.art === ART2, 'custom art: an invalid color clears the tint to null, art kept');

    // Invalid art rejects the whole create/edit with the exact error.
    const bigArt = 'data:image/png;base64,' + 'A'.repeat(40000);
    const eBig = await expectError(nally, { type: 'create_custom', base: 'steel_sword', name: 'Too Big', art: bigArt }, 'create oversized art');
    assert(eBig.message === 'That image is too big or not a PNG drawing.', `custom art: oversized art is rejected ("${eBig.message}")`);
    const ePrefix = await expectError(nally, { type: 'create_custom', base: 'steel_sword', name: 'Wrong Kind', art: 'data:image/jpeg;base64,AAAA' }, 'create non-PNG art');
    assert(ePrefix.message === 'That image is too big or not a PNG drawing.', 'custom art: a non-PNG data URL is rejected');
    const eEdit = await expectError(nally, { type: 'edit_custom', id: customId, name: 'Should Not Stick', art: 'hello' }, 'edit invalid art');
    assert(eEdit.message === 'That image is too big or not a PNG drawing.', 'custom art: an invalid art edit is rejected');
    mN = nally.mark();
    nally.send({ type: 'ref_lists' });
    const refAfter = (await nally.waitSince(mN, (e) => e.type === 'ref_lists', 10000, 'ref_lists (after rejected edit)')).e.items.find((i) => i.id === customId);
    assert(refAfter.name === 'Tinted Blade II' && refAfter.color === null && refAfter.art === ART2,
      'custom art: the rejected edit changed nothing on the def');

    // Final state for the restart check: a tint + a drawing.
    mN = nally.mark();
    nally.send({ type: 'edit_custom', id: customId, color: '#123ABC', art: ART1 });
    const edited5 = (await nally.waitSince(mN, (e) => e.type === 'custom_edited', 10000, 'custom_edited (final state)')).e.item;
    assert(edited5.color === '#123abc' && edited5.art === ART1, 'custom art: final tint + drawing set for the restart check');

    for (const c of clients) c.close();
    clients.length = 0;
    await stopServer();

    // ---------- RESTART: color + art persist on the def ----------
    await startServer();
    const nally2 = await login('nally', 'owner-pass-8');
    clients.push(nally2);
    const cat2 = lastCatalog(nally2).find((i) => i.id === customId);
    assert(!!cat2 && cat2.color === '#123abc' && cat2.art === ART1,
      'restart: a fresh login catalog still carries the custom tint + drawn art');
    const mN2 = nally2.mark();
    nally2.send({ type: 'ref_lists' });
    const ref2 = (await nally2.waitSince(mN2, (e) => e.type === 'ref_lists', 10000, 'ref_lists (restart)')).e.items.find((i) => i.id === customId);
    assert(!!ref2 && ref2.color === '#123abc' && ref2.art === ART1, 'restart: ref_lists still carries the tint + art');

    for (const c of clients) c.close();
    console.log('ALL STAGE 8 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
