// Stage 24 tests: PLACEABLE SPELL BUTTONS + TAP-TO-CAST + the
// FREEZE spell. Derek's ask: drag a spell out of the 📖 spellbook
// onto the screen to place a cast button; tap it to arm (gold),
// then tap an opponent to cast at them; combat spells are the four
// elements, plus Freeze — "your opponent is stopping in the spot
// they are standing for 5 seconds."
//   (a) spell data: the catalog now carries 13 spells; Freeze is
//       level 25, costs 3 water runes, max hit 0, element water.
//       set_spell refuses Freeze (button-cast only).
//   (b) duel button-cast: NO staff wielded, the caster steps back
//       to 120 (beyond melee reach, inside magic range) and casts
//       Air Strike via cast_at until a hit lands — the opponent's
//       HP drops, exactly 1 air rune per cast is consumed, Magic
//       XP rises, and the victim receives an incoming cast_result.
//   (c) refusals: insufficient runes and below-level casts are
//       refused with the Stage 19 messages, consume nothing, start
//       no fight, and set no cooldown (an immediate retry gets the
//       same refusal, not the cooldown error).
//   (d) a duel with No Magic refuses the cast with the ban line.
//   (e) Freeze vs a goblin: a level-99 mage casts Freeze until it
//       connects; the goblin's position (from npc_state) does not
//       change while frozen even though it is mid-approach, and it
//       moves again after ~5s. Water runes: exactly 3 per attempt.
//   (f) Freeze in a duel: after a connect, the frozen player's
//       move messages leave their position unchanged (state
//       snapshots) for the duration and work again after; the
//       frozen player CAN still swing when in reach.
// Client parts (drag-out placement, armed highlight, persistence
// key, Grab-drag + modal gate coverage, long-press remove) are
// verified by source wiring asserts + the inline-script parse,
// like the earlier client stages.
// Same harness style as test/stage19.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18124;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage24.json');
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
const PW = (n) => 's24-pass-' + n;
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
// Cast once via cast_at and return the cast_result event.
async function castOnce(client, spell, targetKind, targetId, label) {
  const m = client.mark();
  client.send({ type: 'cast_at', spell, targetKind, targetId });
  return (await client.waitSince(m, (e) => e.type === 'cast_result', 10000, label)).e;
}
// The latest server position of a player, from state snapshots.
function latestPos(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? { x: p.x, y: p.y } : null;
}
// The latest npc_state position of a creature in an area.
function latestNpcPos(client, area, npcId) {
  const st = [...client.events].reverse().find((e) => e.type === 'npc_state' && e.area === area);
  if (!st) return null;
  const n = (st.npcs || []).find((x) => x.id === npcId);
  return n ? { x: n.x, y: n.y } : null;
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/id: 'freeze', name: 'Freeze', element: 'water', tier: 'freeze', level: 25, runes: 3, max: 0/.test(src), 'source: Freeze row in SPELLS (lvl 25, 3 water runes, max 0)');
  assert(/FREEZE_MS = 5000/.test(src) && /BUTTON_CAST_COOLDOWN_MS = 5 \* TICK_MS/.test(src), 'source: 5s freeze + 5-tick button-cast cooldown constants');
  assert(/function rollMagicCast/.test(src) && /rollMagicCast\(attackerProfile, defenderProfile, spellOf\(attackerProfile\)/.test(src), 'source: staff casts resolve through the shared rollMagicCast');
  assert(/m\.type === 'cast_at'/.test(src) && /castReadyAt/.test(src), 'source: cast_at handler + per-player cast cooldown');
  assert(/frozenUntil: \(p\.frozenUntil/.test(src) && /n\.frozenUntil/.test(src) && /m\.frozenUntil/.test(src), 'source: frozenUntil rides the player snapshot, npc_state and the FC roster');
  assert(/selfFrozen/.test(src) && /me\.frozenUntil/.test(src), 'source: the move handler ignores a frozen player\'s moves');
  assert(/sp\.id === 'freeze'/.test(src) && /placed spell button/.test(src), 'source: set_spell refuses Freeze (button-cast only)');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/nallystake_spell_btns/.test(clientSrc) && /function renderSpellBtns/.test(clientSrc) && /function loadSpellBtns/.test(clientSrc), 'client: placed spell buttons persist under their own localStorage key');
  assert(/class="act spellplace"/.test(clientSrc) && /function startSpellDrag/.test(clientSrc) && /function wireSpellPlace/.test(clientSrc), 'client: spellbook rows drag out via 📌 (pointer ghost, drop outside the drawer places)');
  assert(/function wireSpellBtn/.test(clientSrc) && /armedSpell===b\.spell/.test(clientSrc) && /' armed'/.test(clientSrc), 'client: placed button tap arms/disarms with the gold armed class');
  assert(/function armedCastAt/.test(clientSrc) && /type:'cast_at'/.test(clientSrc), 'client: an armed tap on a target sends cast_at');
  assert(/if\(grabMode\)\{\s*\/\/ Grab drags placed spell buttons/.test(clientSrc) || /Grab drags placed spell buttons/.test(clientSrc), 'client: Grab mode drags placed spell buttons (and the click handler refuses to arm while Grab is on)');
  assert(/function openSpellPop/.test(clientSrc) && /Remove button/.test(clientSrc), 'client: long-press opens the remove popup');
  assert(/meFrozenNow\(\)/.test(clientSrc) && /function onCastResult/.test(clientSrc) && /function setFrozenShell/.test(clientSrc) && /fbadge/.test(clientSrc), 'client: frozen movement gate, cast_result handler, ice shell + ❄️ badge');
  assert(/Button only/.test(clientSrc) && /Stops your opponent/.test(clientSrc) === false, 'client: spellbook marks Freeze button-only (its description text comes from the server spell row)');
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs); // throws on a syntax error
  console.log('PASS source: client inline script parses');

  // ---------- register everyone, then seed gear/XP ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    const names = ['S24Caster', 'S24Target', 'S24Poor', 'S24Novice', 'S24Mage2', 'S24Target4', 'S24Frost', 'S24Ice', 'S24Victim'];
    for (const n of names) { const c = await register(n); clients.push(c); c.close(); }
    await stopServer();
    const G = (qty) => ({ item: 'gold', qty });
    seedDb((data) => {
      const set = (name, mut) => { const u = data.users[name.toLowerCase()]; if (!u) throw new Error('seed: no user ' + name); mut(u.profile); };
      set('S24Caster', (p) => { p.xp.magic = 20000; p.xp.hitpoints = 13034431; p.backpack = [G(100), { item: 'air_rune', qty: 60 }]; }); // NO weapon — button casts need no staff
      set('S24Target', (p) => { p.worn.weapon = 'bronze_sword'; });
      set('S24Poor', (p) => { p.xp.magic = 20000; p.xp.hitpoints = 13034431; p.backpack = [G(100)]; }); // level is fine, runes are not
      set('S24Novice', (p) => { p.backpack = [G(100), { item: 'fire_rune', qty: 60 }]; }); // runes are fine, Magic level 1 is not
      set('S24Mage2', (p) => { p.xp.magic = 20000; p.backpack = [G(100), { item: 'air_rune', qty: 60 }]; });
      set('S24Target4', (p) => { p.worn.weapon = 'bronze_sword'; });
      set('S24Frost', (p) => { p.xp.magic = 13034431; p.xp.hitpoints = 13034431; p.backpack = [G(100), { item: 'water_rune', qty: 60 }]; });
      set('S24Ice', (p) => { p.xp.magic = 13034431; p.xp.hitpoints = 13034431; p.worn.weapon = 'bronze_sword'; p.backpack = [G(100), { item: 'water_rune', qty: 90 }]; });
      set('S24Victim', (p) => { p.worn.weapon = 'bronze_sword'; });
    });
    await startServer();

    const Caster = await loginClient('S24Caster'); clients.push(Caster);
    const Target = await loginClient('S24Target'); clients.push(Target);

    // ---------- (a) spell data ----------
    const cat = await Caster.waitFor((e) => e.type === 'catalog', 10000, 'catalog');
    assert(Array.isArray(cat.spells) && cat.spells.length === 13, `(a) catalog carries 13 spells now (got ${cat.spells && cat.spells.length})`);
    const freeze = cat.spells.find((s) => s.id === 'freeze');
    assert(freeze && freeze.name === 'Freeze' && freeze.level === 25 && freeze.runes === 3 && freeze.max === 0 && freeze.element === 'water', '(a) Freeze row: lvl 25, 3 water runes, max hit 0');
    assert(freeze.desc === 'Stops your opponent in the spot they are standing for 5 seconds.', '(a) Freeze carries Derek\'s description');
    const errSetSpell = await expectError(Caster, { type: 'set_spell', spell: 'freeze' }, 'set_spell freeze (a)');
    assert(/placed spell button/.test(errSetSpell.message), `(a) Freeze cannot be staff-selected ("${errSetSpell.message}")`);
    console.log('PASS (a) Freeze spell data + button-only selection');

    // ---------- (b) duel button-cast, no staff, from 120 away ----------
    const casterBefore = await prof('S24Caster');
    assert(!casterBefore.worn.weapon, '(b) the caster wields NO staff (no weapon at all)');
    await startDuelViaChallenge(Caster, Target, {}, '(b)');
    const mCb = Caster.mark();
    await Caster.waitSince(mCb, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 15000, 'countdown over (b)');
    Caster.send({ type: 'move', x: 700, y: 450 }); // Target stands at (820,450): 120 away — beyond melee reach (42), inside magic range (150)
    await sleep(400);
    let attempts = 0; let hitRes = null;
    while (attempts < 8 && !hitRes) {
      attempts++;
      const res = await castOnce(Caster, 'air_strike', 'duel', 'S24Target', `(b) cast ${attempts}`);
      assert(res.spell === 'air_strike' && res.context === 'duel', '(b) cast_result answers the button cast');
      if (res.dmg > 0) hitRes = res;
      else await sleep(3200); // respect the 5-tick (3s) cast cooldown between attempts
    }
    assert(hitRes, `(b) an Air Strike button-cast hit the opponent from 120 away (${attempts} attempts)`);
    assert(hitRes.hpTarget < 99, `(b) the opponent's duel HP dropped (${hitRes.hpTarget}/99)`);
    const incoming = Target.events.filter((e) => e.type === 'cast_result' && e.incoming === true);
    assert(incoming.length >= 1, '(b) the victim received the incoming cast_result copy');
    await sleep(300);
    const casterAfter = await prof('S24Caster');
    assert(stackQty(casterAfter, 'air_rune') === 60 - attempts, `(b) exactly 1 air rune per cast (${attempts} casts: 60 -> ${stackQty(casterAfter, 'air_rune')})`);
    assert(casterAfter.xp.magic > casterBefore.xp.magic, `(b) Magic XP rose (${casterBefore.xp.magic} -> ${casterAfter.xp.magic})`);
    const mTb = Target.mark();
    Caster.close();
    await Target.waitSince(mTb, (e) => e.type === 'duel_end', 20000, 'duel_end after Caster left (b)');
    console.log('PASS (b) duel button-cast: no staff, hits from range, runes + XP exact');

    // ---------- (c) refusals consume nothing ----------
    const Poor = await loginClient('S24Poor'); clients.push(Poor);
    Poor.send({ type: 'travel', to: 'goblins' });
    await Poor.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins', 10000, 'poor npc_state (c)');
    Poor.send({ type: 'move', x: 640, y: 420 }); // 100 from goblin2 (640,320)
    await sleep(300);
    const mPoor = Poor.mark();
    const errRunes = await expectError(Poor, { type: 'cast_at', spell: 'air_strike', targetKind: 'npc', targetId: 'goblin2' }, 'no-runes cast (c)');
    assert(errRunes.message === "You don't have the runes for Air Strike.", `(c) insufficient runes refused ("${errRunes.message}")`);
    const errRunes2 = await expectError(Poor, { type: 'cast_at', spell: 'air_strike', targetKind: 'npc', targetId: 'goblin2' }, 'no-runes retry (c)');
    assert(errRunes2.message === "You don't have the runes for Air Strike.", '(c) an immediate retry gets the same refusal — a refused cast sets no cooldown');
    assert(!Poor.events.slice(mPoor).some((e) => e.type === 'cast_result'), '(c) no cast_result for a refused cast');
    assert(!Poor.events.slice(mPoor).some((e) => e.type === 'npc_fight'), '(c) a refused cast does not start a fight');
    const Novice = await loginClient('S24Novice'); clients.push(Novice);
    Novice.send({ type: 'travel', to: 'goblins' });
    await Novice.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins', 10000, 'novice npc_state (c)');
    Novice.send({ type: 'move', x: 840, y: 420 }); // 100 from goblin3 (840,520)
    await sleep(300);
    const errLevel = await expectError(Novice, { type: 'cast_at', spell: 'fire_blast', targetKind: 'npc', targetId: 'goblin3' }, 'below-level cast (c)');
    assert(errLevel.message === 'You need Magic level 59 to cast Fire Blast.', `(c) below-level cast refused ("${errLevel.message}")`);
    await sleep(300);
    assert(stackQty(await prof('S24Novice'), 'fire_rune') === 60, '(c) the below-level refusal consumed no runes');
    console.log('PASS (c) refusals: nothing consumed, no fight, no cooldown');

    // ---------- (d) No Magic duel refuses the cast ----------
    const Mage2 = await loginClient('S24Mage2'); clients.push(Mage2);
    const Target4 = await loginClient('S24Target4'); clients.push(Target4);
    await startDuelViaChallenge(Mage2, Target4, { noMagic: true }, '(d)');
    const mM2 = Mage2.mark();
    await Mage2.waitSince(mM2, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 15000, 'countdown over (d)');
    const errBan = await expectError(Mage2, { type: 'cast_at', spell: 'air_strike', targetKind: 'duel', targetId: 'S24Target4' }, 'noMagic cast (d)');
    assert(errBan.message === '🚫 No Magic in this duel.', `(d) No Magic duel refuses the cast ("${errBan.message}")`);
    assert(!Mage2.events.slice(mM2).some((e) => e.type === 'cast_result'), '(d) no cast_result under No Magic');
    await sleep(300);
    assert(stackQty(await prof('S24Mage2'), 'air_rune') === 60, '(d) the banned cast consumed no runes');
    const mT4 = Target4.mark();
    Mage2.close();
    await Target4.waitSince(mT4, (e) => e.type === 'duel_end', 20000, 'duel_end after Mage2 left (d)');
    console.log('PASS (d) No Magic duel: cast refused with the ban line');

    // ---------- (e) Freeze vs a goblin ----------
    const Frost = await loginClient('S24Frost'); clients.push(Frost);
    Frost.send({ type: 'travel', to: 'goblins' });
    await Frost.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins', 10000, 'frost npc_state (e)');
    let fAttempts = 0; let frozeRes = null;
    while (fAttempts < 6 && !frozeRes) {
      fAttempts++;
      // Kite to exactly 150 from the goblin before each attempt, so
      // it is always mid-approach (it WANTS to close in) when the
      // cast lands — the cast itself opens the fight on attempt 1.
      const gp = latestNpcPos(Frost, 'goblins', 'goblin2') || { x: 640, y: 320 };
      const py = gp.y + 150 <= 900 ? gp.y + 150 : gp.y - 150;
      Frost.send({ type: 'move', x: gp.x, y: py });
      await sleep(250);
      const res = await castOnce(Frost, 'freeze', 'npc', 'goblin2', `(e) freeze attempt ${fAttempts}`);
      if (res.froze) frozeRes = res;
      else await sleep(2900);
    }
    assert(frozeRes, `(e) Freeze connected on the goblin (${fAttempts} attempts)`);
    assert(frozeRes.frozenUntil > Date.now() && frozeRes.frozenUntil <= Date.now() + 5000, '(e) frozenUntil is ~5 seconds out');
    await sleep(300);
    const posF = latestNpcPos(Frost, 'goblins', 'goblin2');
    assert(posF, '(e) the frozen goblin is in npc_state');
    const myPosF = latestPos(Frost, 'S24Frost');
    assert(Math.hypot(posF.x - myPosF.x, posF.y - myPosF.y) > 42, `(e) the goblin froze mid-approach, out of melee reach (at ${posF.x},${posF.y})`);
    await sleep(2200); // still inside the 5s root
    const posStill = latestNpcPos(Frost, 'goblins', 'goblin2');
    assert(posStill && posStill.x === posF.x && posStill.y === posF.y, `(e) the frozen goblin did not move (${posF.x},${posF.y} -> ${posStill && posStill.x},${posStill && posStill.y})`);
    // After the root expires the goblin resumes its approach.
    let moved = null;
    const moveDeadline = Date.now() + 9000;
    while (Date.now() < moveDeadline && !moved) {
      await sleep(500);
      const p = latestNpcPos(Frost, 'goblins', 'goblin2');
      if (p && (p.x !== posF.x || p.y !== posF.y)) moved = p;
    }
    assert(moved, '(e) the goblin moves again after the freeze expires');
    await sleep(300);
    assert(stackQty(await prof('S24Frost'), 'water_rune') === 60 - 3 * fAttempts, `(e) exactly 3 water runes per Freeze attempt (${fAttempts} attempts)`);
    const mFr = Frost.mark();
    Frost.send({ type: 'flee' });
    await Frost.waitSince(mFr, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'frost flee (e)');
    console.log('PASS (e) Freeze vs goblin: rooted mid-approach for 5s, then moves again');

    // ---------- (f) Freeze in a duel ----------
    const Ice = await loginClient('S24Ice'); clients.push(Ice);
    const Victim = await loginClient('S24Victim'); clients.push(Victim);
    await startDuelViaChallenge(Ice, Victim, {}, '(f)');
    const mIce = Ice.mark();
    await Ice.waitSince(mIce, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 15000, 'countdown over (f)');
    // Toe-to-toe at the duel spawns: Ice (780,450), Victim (820,450).
    let vAttempts = 0; let vFroze = null;
    while (vAttempts < 10 && !vFroze) {
      vAttempts++;
      const res = await castOnce(Ice, 'freeze', 'duel', 'S24Victim', `(f) freeze attempt ${vAttempts}`);
      if (res.froze) vFroze = res;
      else await sleep(3200);
    }
    assert(vFroze, `(f) Freeze connected in the duel (${vAttempts} attempts)`);
    const frozenUntil = vFroze.frozenUntil;
    // The frozen player's moves are ignored for the duration.
    Victim.send({ type: 'move', x: 1000, y: 600 });
    await sleep(600);
    Victim.send({ type: 'move', x: 1100, y: 650 });
    await sleep(600);
    const vPos = latestPos(Ice, 'S24Victim');
    assert(vPos && vPos.x === 820 && vPos.y === 450, `(f) the frozen player's position is unchanged by move messages (at ${vPos && vPos.x},${vPos && vPos.y})`);
    // …but they CAN still swing while in reach.
    const mVic = Victim.mark();
    Victim.send({ type: 'duel_attack' });
    const swingTick = (await Victim.waitSince(mVic, (e) => e.type === 'duel_tick' && typeof e.youHit === 'number', 6000, 'frozen victim swing (f)')).e;
    assert(Date.now() < frozenUntil, '(f) the frozen player swung while still frozen');
    assert(typeof swingTick.youHit === 'number', '(f) the frozen player CAN still swing when in reach');
    // After expiry, movement works again.
    const waitMs = frozenUntil - Date.now() + 700;
    if (waitMs > 0) await sleep(waitMs);
    Victim.send({ type: 'move', x: 1000, y: 600 });
    await sleep(500);
    const vPos2 = latestPos(Ice, 'S24Victim');
    assert(vPos2 && (vPos2.x !== 820 || vPos2.y !== 450), `(f) the player moves again after the freeze expires (at ${vPos2 && vPos2.x},${vPos2 && vPos2.y})`);
    await sleep(300);
    assert(stackQty(await prof('S24Ice'), 'water_rune') === 90 - 3 * vAttempts, `(f) exactly 3 water runes per Freeze attempt (${vAttempts} attempts)`);
    const mVf = Victim.mark();
    Ice.close();
    await Victim.waitSince(mVf, (e) => e.type === 'duel_end', 20000, 'duel_end after Ice left (f)');
    console.log('PASS (f) Freeze in a duel: rooted 5s, can still swing, moves after');

    console.log('ALL STAGE 24 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
