// Stage 20 tests: the rewarding layer — level-up fanfare events,
// game-wide announcements, starter goals, the collection log, the
// skills hiscores, and the rare-pile flag plumbing.
//   (a) migration: a pre-Stage-20 profile (no starter / clog)
//       gains starter {done:{}} and an empty clog; the welcome
//       carries a 'starter' message (5 goals, none done) and a
//       'clog' message (found [], total 13).
//   (b) level_up: fletching across a boundary fires exactly one
//       level_up (level 2, unlock null); a non-crossing grant
//       fires none; crossing to 15 carries the Iron-arrows unlock
//       text; a same-area bystander gets the small
//       'player_level_up' version, not the personal level_up.
//   (c) level 99: a seeded 13034419-XP Attack account crosses to
//       99 on a training dummy — the player gets level_up 99 and
//       EVERY online player (another area included) gets the
//       {type:'announce'} broadcast with the exact 🏆 text.
//   (d) starter goals: bank deposit pays +25g once (second deposit
//       pays nothing), travel pays visit_area, a real gather pays
//       gather, a free-play duel won by forfeit pays win_duel, a
//       goblin kill pays kill_monster — all five end done.
//   (e) collection log: a Barrows brother kill records the
//       brother's clog entry (message + saved profile) and it
//       survives a server restart.
//   (f) hiscores: GET /api/hiscores returns rows sorted by total
//       XP with username / totalLevel / totalXp / combatLevel; a
//       fresh account shows total 23 / 1154 XP / combat 3.4. The
//       duel leaderboard endpoint still answers.
//   (g) piles: a normal dropped pile carries rare:false in the
//       piles message (the rare:true Barrows path is RNG-gated —
//       8% per full round — so it is covered by source assertions
//       below plus this flag plumbing, and flagged in the report).
// Same harness style as test/stage19.js / test/stage5.js.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18120;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage20.json');
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
async function apiGet(pathName) {
  const r = await fetch(BASE + pathName);
  const d = await r.json();
  if (!r.ok) throw new Error(pathName + ': ' + (d.error || r.status));
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
const PW = (n) => 's20-pass-' + n;
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

// --- Barrows driving (stage5 pattern) ---
const MOUNDS = {
  dharok: { x: 300, y: 220 }, guthan: { x: 660, y: 160 }, torag: { x: 1020, y: 160 },
  verac: { x: 1320, y: 220 }, ahrim: { x: 480, y: 440 }, karil: { x: 1120, y: 440 },
};
const BROTHER_TYPE = { dharok: 'melee', guthan: 'melee', torag: 'melee', verac: 'melee', ahrim: 'magic', karil: 'missiles' };
const ALL_BROTHERS = Object.keys(MOUNDS);
function ensurePrayer(c, want) {
  const p = c.profile();
  if (!p || p.activePrayer !== want) c.send({ type: 'prayer', prayer: want });
}
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
    ensurePrayer(c, BROTHER_TYPE[brotherId]);
    if (ticks % 20 === 0) c.send({ type: 'use', item: 'prayer_potion' });
    if (t.e.hpYou <= 40) c.send({ type: 'use', item: 'restore_potion' });
  }
  throw new Error(`barrows fight vs ${brotherId} did not end in time`);
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/const STARTER_GOALS = \[/.test(src) && /function completeStarterGoal/.test(src), 'source: starter goals table + completer');
  assert(/function recordClog/.test(src) && /function clogEntryIds/.test(src), 'source: collection log helpers');
  assert(/function announce\(/.test(src) && /type: 'announce'/.test(src), 'source: announce broadcast');
  assert(/function unlockTextFor/.test(src) && /function onLevelUp/.test(src) && /type: 'level_up'/.test(src), 'source: level-up fanfare + unlock derivation');
  assert(/\/api\/hiscores/.test(src), 'source: hiscores endpoint');
  assert(/loot\.rare/.test(src) && /rare: true/.test(src) && /just looted/.test(src), 'source: rare Barrows weapon -> rare pile + clog + announce wiring');
  assert(/just earned a Fire Cape/.test(src) && /just reached level 99/.test(src), 'source: fire-cape + level-99 announcement texts');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/function pGoals\(\)/.test(clientSrc) && /data-panel="goals"/.test(clientSrc), 'source: client goals panel + rail button');
  assert(/function spawnBurst/.test(clientSrc) && /function showBanner/.test(clientSrc), 'source: client fireworks + banner');
  assert(/rareBeams/.test(clientSrc) && /p\.rare/.test(clientSrc), 'source: client loot beam over rare piles');
  assert(/function pBoards\(\)/.test(clientSrc) && /\/api\/hiscores/.test(clientSrc) && /\/api\/leaderboard/.test(clientSrc), 'source: client boards tabs fetch both endpoints');
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs); // throws on a syntax error
  console.log('PASS source: client inline script parses');

  // ---------- (a) migration: a pre-Stage-20 profile ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  {
    const salt = crypto.randomBytes(16).toString('hex');
    const passHash = crypto.scryptSync(PW('S20Legacy'), salt, 32).toString('hex');
    const oldXp = { attack: 0, strength: 0, defence: 0, hitpoints: 1154, ranged: 0, magic: 0, prayer: 0, mining: 0, smithing: 0, woodcutting: 0, firemaking: 0, fishing: 0, cooking: 0 };
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: {
        s20legacy: { salt, passHash, profile: { username: 'S20Legacy', gold: 100, rating: 1000, wins: 0, losses: 0, style: 'accurate', createdAt: new Date().toISOString(), xp: oldXp } },
      },
    }));
  }
  await startServer();
  const clients = [];
  try {
    const legacy = await prof('S20Legacy');
    assert(legacy.starter && legacy.starter.done && Object.keys(legacy.starter.done).length === 0,
      `(a) migrated profile gains an empty starter done map (got ${JSON.stringify(legacy.starter)})`);
    assert(Array.isArray(legacy.clog) && legacy.clog.length === 0, '(a) migrated profile gains an empty collection log');
    const legacyC = await loginClient('S20Legacy'); clients.push(legacyC);
    const stMsg = await legacyC.waitFor((e) => e.type === 'starter', 10000, 'starter on welcome');
    assert(Array.isArray(stMsg.goals) && stMsg.goals.length === 5 && stMsg.goals.every((g) => g.done === false),
      `(a) welcome starter message: 5 goals, none done (got ${JSON.stringify(stMsg.goals)})`);
    assert(stMsg.goals.map((g) => g.id).sort().join(',') === 'gather,kill_monster,use_bank,visit_area,win_duel', '(a) the five goal ids are the designed five');
    const clogMsg0 = await legacyC.waitFor((e) => e.type === 'clog', 10000, 'clog on welcome');
    assert(Array.isArray(clogMsg0.found) && clogMsg0.found.length === 0 && clogMsg0.total === 56,
      `(a) welcome clog message: found [] of 56 (got ${JSON.stringify(clogMsg0)})`); // Stage 28: 13 -> 20 (brother armour); Stage 28b: -> 56 (36 tier pieces)
    legacyC.close();
    console.log('PASS (a) migration + welcome state');

    // ---------- register everyone, then seed ----------
    const names = ['S20FlA', 'S20FlB', 'S20Atk99', 'S20By', 'S20Start', 'S20Fall', 'S20Barrows', 'S20Fresh'];
    for (const n of names) { const c = await register(n); c.close(); }
    await stopServer();
    const G = (qty) => ({ item: 'gold', qty });
    seedDb((data) => {
      const set = (name, mut) => { const u = data.users[name.toLowerCase()]; if (!u) throw new Error('seed: no user ' + name); mut(u.profile); };
      // Fletching boundaries: level 2 = 83 XP (73 + one 10-XP set),
      // level 15 = 2411 XP (2401 + one set).
      set('S20FlA', (p) => { p.xp.fletching = 73; p.backpack = [G(100), { item: 'logs', qty: 10 }, { item: 'bronze_arrowhead', qty: 5 }]; });
      set('S20FlB', (p) => { p.xp.fletching = 2401; p.backpack = [G(100), { item: 'logs', qty: 10 }, { item: 'bronze_arrowhead', qty: 5 }]; });
      // One successful dummy hit (+12 XP) crosses exactly to 99.
      set('S20Atk99', (p) => { p.xp.attack = 13034431 - 12; });
      // The starter-goal hero: strong enough to one-shot a goblin.
      set('S20Start', (p) => { p.xp.attack = 13034431; p.xp.strength = 13034431; p.xp.hitpoints = 500000; p.worn.weapon = 'dragon_sword'; });
      // The Barrows runner (stage5 seed, plus maxed attack/strength).
      set('S20Barrows', (p) => {
        p.xp.hitpoints = 13034431; p.xp.attack = 13034431; p.xp.strength = 13034431;
        p.prayerPoints = 500; p.prayerMax = 500;
        p.worn = { weapon: 'dragon_sword', shield: 'dragon_shield', head: 'dragon_helm', body: 'dragon_platebody', legs: 'dragon_platelegs', cape: null, amulet: null, hands: null, feet: null, ring: null };
        p.backpack = [G(100), { item: 'prayer_potion', qty: 50 }, { item: 'restore_potion', qty: 50 }];
      });
    });
    await startServer();

    // ---------- (b) level_up via fletching ----------
    const FlA = await loginClient('S20FlA'); clients.push(FlA);
    const FlB = await loginClient('S20FlB'); clients.push(FlB);
    {
      const mB = FlB.mark();
      const mA = FlA.mark();
      FlA.send({ type: 'fletch', item: 'bronze_arrowhead' });
      const lu = (await FlA.waitSince(mA, (e) => e.type === 'level_up', 10000, 'level_up (FlA)')).e;
      assert(lu.skill === 'fletching' && lu.level === 2 && lu.unlock === null,
        `(b) crossing to Fletching 2 fires level_up with unlock null (got ${JSON.stringify(lu)})`);
      const other = (await FlB.waitSince(mB, (e) => e.type === 'player_level_up', 10000, 'player_level_up (FlB)')).e;
      assert(other.username === 'S20FlA' && other.skill === 'fletching' && other.level === 2,
        `(b) the same-area bystander gets the small player_level_up (got ${JSON.stringify(other)})`);
      assert(!FlB.events.slice(mB).some((e) => e.type === 'level_up'), '(b) the bystander does NOT get the personal level_up');
      // A non-crossing grant fires nothing new.
      const mA2 = FlA.mark();
      FlA.send({ type: 'fletch', item: 'bronze_arrowhead' });
      await FlA.waitSince(mA2, (e) => e.type === 'fletch_result', 10000, 'second fletch_result');
      await sleep(700);
      const luCount = FlA.events.filter((e) => e.type === 'level_up').length;
      assert(luCount === 1, `(b) exactly one level_up after a crossing + a non-crossing grant (got ${luCount})`);
      // The unlock-bearing crossing: Fletching 15 -> Iron arrows.
      FlB.send({ type: 'fletch', item: 'bronze_arrowhead' });
      const luB = (await FlB.waitSince(mB, (e) => e.type === 'level_up', 10000, 'level_up (FlB)')).e;
      assert(luB.skill === 'fletching' && luB.level === 15 && typeof luB.unlock === 'string' && luB.unlock.includes('Iron arrows'),
        `(b) crossing to Fletching 15 carries the unlock text (got ${JSON.stringify(luB)})`);
      console.log('PASS (b) level_up fanfare events + unlock text');
    }

    // ---------- (g) piles: a normal pile carries rare:false ----------
    {
      const mP = FlA.mark();
      FlA.send({ type: 'drop', item: 'bronze_arrow', qty: 1 });
      const pilesEv = (await FlA.waitSince(mP, (e) => e.type === 'piles' && e.area === 'plaza' && e.piles.some((p) => p.item === 'bronze_arrow'), 10000, 'piles after drop')).e;
      const pile = pilesEv.piles.find((p) => p.item === 'bronze_arrow');
      assert(pile.rare === false, `(g) a normal dropped pile is flagged rare:false (got ${JSON.stringify(pile)})`);
      console.log('PASS (g) pile rare-flag plumbing');
    }
    FlA.close(); FlB.close();
    await sleep(400);

    // ---------- (c) level 99 announcement ----------
    const Atk99 = await loginClient('S20Atk99'); clients.push(Atk99);
    const By = await loginClient('S20By'); clients.push(By);
    {
      Atk99.send({ type: 'travel', to: 'training' });
      await Atk99.waitFor((e) => e.type === 'area' && e.area === 'training', 10000, 'in the Training Cave');
      Atk99.send({ type: 'move', x: 280, y: 450 });
      await sleep(400);
      const mBy = By.mark();
      let lu99 = null;
      for (let i = 0; i < 25 && !lu99; i++) {
        Atk99.send({ type: 'gather', nodeId: 'attack_dummy' });
        await sleep(1500);
        lu99 = Atk99.events.find((e) => e.type === 'level_up' && e.skill === 'attack') || null;
      }
      assert(lu99 && lu99.level === 99, `(c) the dummy hit crossed Attack to 99 (got ${JSON.stringify(lu99)})`);
      const ann = (await By.waitSince(mBy, (e) => e.type === 'announce', 10000, 'announce (bystander)')).e;
      assert(ann.text === '🏆 S20Atk99 just reached level 99 Attack!', `(c) the bystander in another area got the exact announcement (got "${ann.text}")`);
      assert(Atk99.events.some((e) => e.type === 'announce' && e.text === ann.text), '(c) the 99 achiever also receives the announcement');
      assert(!By.events.slice(mBy).some((e) => e.type === 'level_up'), '(c) the bystander never gets the personal level_up');
      console.log('PASS (c) level-99 announcement broadcast');
    }
    Atk99.close(); By.close();
    await sleep(400);

    // ---------- (d) starter goals ----------
    const Start = await loginClient('S20Start'); clients.push(Start);
    const goldOf = async () => (await prof('S20Start')).gold;
    {
      const st0 = await Start.waitFor((e) => e.type === 'starter', 10000, 'starter on welcome');
      assert(st0.goals.length === 5 && st0.goals.every((g) => !g.done), '(d) a fresh hero starts with all five goals open');
      assert((await goldOf()) === 100, '(d) the hero starts at 100g');

      // Use the bank: +25 once, and only once.
      let m = Start.mark();
      Start.send({ type: 'bank_deposit', item: 'gold', qty: 1 });
      const sd1 = (await Start.waitSince(m, (e) => e.type === 'starter_done', 10000, 'starter_done use_bank')).e;
      assert(sd1.id === 'use_bank' && sd1.reward === 25 && sd1.label === 'Use the bank', `(d) the first deposit completes Use the bank (+25g) (got ${JSON.stringify(sd1)})`);
      assert((await goldOf()) === 125, '(d) gold 100 -> 125 after the bank goal');
      Start.send({ type: 'bank_deposit', item: 'gold', qty: 1 });
      await sleep(800);
      assert(Start.events.filter((e) => e.type === 'starter_done' && e.id === 'use_bank').length === 1, '(d) the second deposit pays nothing more');
      assert((await goldOf()) === 125, '(d) gold still 125 after the second deposit');

      // Visit another area.
      m = Start.mark();
      Start.send({ type: 'travel', to: 'gathering' });
      const sd2 = (await Start.waitSince(m, (e) => e.type === 'starter_done' && e.id === 'visit_area', 10000, 'starter_done visit_area')).e;
      assert(sd2.reward === 25 && (await goldOf()) === 150, '(d) travelling out of the plaza pays visit_area (gold 150)');

      // Gather a resource: the tree in the Gathering Cave (840,180).
      Start.send({ type: 'move', x: 840, y: 180 });
      await sleep(400);
      let gathered = false;
      for (let i = 0; i < 25 && !gathered; i++) {
        const mg = Start.mark();
        Start.send({ type: 'gather', nodeId: 'tree_g' });
        const gr = await Start.waitSince(mg, (e) => e.type === 'gather_result' && e.nodeId === 'tree_g', 10000, 'gather_result').catch(() => null);
        if (gr && gr.e.ok) gathered = true;
        else await sleep(1500);
      }
      assert(gathered, '(d) a tree gather eventually succeeds');
      await Start.waitFor((e) => e.type === 'starter_done' && e.id === 'gather', 10000, 'starter_done gather');
      assert((await goldOf()) === 175, '(d) gold 175 after the gather goal');

      // Win a duel: a free-play duel the opponent forfeits.
      const Fall = await loginClient('S20Fall'); clients.push(Fall);
      Start.send({ type: 'travel', to: 'plaza' });
      await Start.waitFor((e) => e.type === 'area' && e.area === 'plaza', 10000, 'back in the plaza');
      const mF = Fall.mark();
      Start.send({ type: 'challenge', target: 'S20Fall', stake: 0, items: [], rules: {}, freePlay: true });
      const inc = (await Fall.waitSince(mF, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (d)')).e;
      Fall.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Start.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Fall.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      await Start.waitFor((e) => e.type === 'duel_start', 15000, 'duel_start (d)');
      const mEnd = Start.mark();
      Fall.close();
      const end = (await Start.waitSince(mEnd, (e) => e.type === 'duel_end', 20000, 'duel_end (d)')).e;
      assert(end.winner === 'S20Start', `(d) the forfeit makes the hero the duel winner (got ${end.winner})`);
      await Start.waitSince(mEnd, (e) => e.type === 'starter_done' && e.id === 'win_duel', 10000, 'starter_done win_duel');
      assert((await goldOf()) === 200, '(d) gold 200 after the duel goal');

      // Kill a monster: a goblin at the camp.
      Start.send({ type: 'travel', to: 'goblins' });
      const ns = await Start.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins' && e.npcs.length > 0, 10000, 'goblin npc_state');
      const gob = ns.npcs[0];
      Start.send({ type: 'move', x: gob.x, y: gob.y });
      await sleep(400);
      const mK = Start.mark();
      Start.send({ type: 'attack_npc', id: gob.id });
      const fEnd = (await Start.waitSince(mK, (e) => e.type === 'npc_fight' && e.phase === 'end', 60000, 'goblin fight end')).e;
      assert(fEnd.reason === 'kill', `(d) the goblin dies (reason ${fEnd.reason})`);
      await Start.waitSince(mK, (e) => e.type === 'starter_done' && e.id === 'kill_monster', 10000, 'starter_done kill_monster');
      assert((await goldOf()) >= 225, '(d) the kill goal paid its 25g (goblin drops may add a little more)');

      const stFinal = [...Start.events].reverse().find((e) => e.type === 'starter');
      assert(stFinal && stFinal.goals.every((g) => g.done), `(d) all five starter goals end done (got ${JSON.stringify(stFinal && stFinal.goals)})`);
      console.log('PASS (d) starter goals: bank, visit, gather, duel, kill — 25g each, once each');
    }
    Start.close();
    await sleep(400);

    // ---------- (e) collection log: a Barrows brother kill ----------
    const Bar = await loginClient('S20Barrows'); clients.push(Bar);
    let killedBrother = null;
    {
      const clog0 = await Bar.waitFor((e) => e.type === 'clog', 10000, 'clog on welcome');
      // Stage 28 (flagged): the log grew from 13 to 20 entries —
      // the seven Barrows armour pieces joined the drop table.
      // Stage 28b: 56 now — the 36 Barrows tier pieces joined too.
      assert(clog0.found.length === 0 && clog0.total === 56, '(e) the runner starts with an empty log');
      Bar.send({ type: 'travel', to: 'barrows' });
      await Bar.waitFor((e) => e.type === 'barrows_state', 10000, 'barrows_state on entry');
      // Stage 28 (flagged flow change, same as stage5): entering a
      // mound lands in the crypt; the fight starts on SEARCH; the
      // tunnel crypt descends instead (climb out via the crypt).
      for (const b of ALL_BROTHERS) {
        const m0 = Bar.mark();
        Bar.send({ type: 'move', x: MOUNDS[b].x, y: MOUNDS[b].y });
        await sleep(400);
        Bar.send({ type: 'barrows_enter', brother: b });
        const st = (await Bar.waitSince(m0, (e) => e.type === 'barrows_state' && e.inCrypt === true, 10000, 'crypt entry state')).e;
        if (st.tunnel === b) {
          Bar.send({ type: 'barrows_leave_crypt' });
          await Bar.waitSince(Bar.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'climbed back out');
          continue;
        }
        Bar.send({ type: 'move', x: 800, y: 470 });
        await sleep(400);
        const mF = Bar.mark();
        Bar.send({ type: 'barrows_search' });
        await Bar.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start' && e.kind === 'barrows', 10000, 'crypt fight start');
        const end = await driveBarrowsKill(Bar, b, mF + 1);
        assert(end.reason === 'kill', `barrows: ${b} killed in his crypt`);
        killedBrother = b;
        Bar.send({ type: 'barrows_leave_crypt' });
        await Bar.waitSince(Bar.mark(), (e) => e.type === 'area' && e.area === 'barrows', 10000, 'climbed out of the crypt');
        break;
      }
      assert(killedBrother, '(e) a brother was killed');
      const clogEv = [...Bar.events].reverse().find((e) => e.type === 'clog' && e.found.includes(killedBrother));
      assert(!!clogEv, `(e) the kill pushed a clog message containing ${killedBrother}`);
      const profBar = await prof('S20Barrows');
      assert(Array.isArray(profBar.clog) && profBar.clog.includes(killedBrother),
        `(e) the saved profile's collection log holds ${killedBrother} (got ${JSON.stringify(profBar.clog)})`);
      console.log(`PASS (e) collection log records the ${killedBrother} kill`);
    }
    Bar.close();
    await sleep(400);

    // The log survives a restart.
    await stopServer();
    await startServer();
    const Bar2 = await loginClient('S20Barrows'); clients.push(Bar2);
    const clogRe = await Bar2.waitFor((e) => e.type === 'clog', 10000, 'clog after restart');
    assert(clogRe.found.includes(killedBrother), `(e) the ${killedBrother} entry survives a server restart`);
    Bar2.close();
    console.log('PASS (e) collection log persists across restart');

    // ---------- (f) hiscores ----------
    {
      const hs = await apiGet('/api/hiscores');
      assert(Array.isArray(hs.hiscores) && hs.hiscores.length >= 5, `(f) hiscores returns rows (got ${hs.hiscores && hs.hiscores.length})`);
      const rows = hs.hiscores;
      assert(rows.every((r) => typeof r.username === 'string' && typeof r.totalLevel === 'number' && typeof r.totalXp === 'number' && typeof r.combatLevel === 'number'),
        '(f) every row carries username / totalLevel / totalXp / combatLevel');
      assert(rows.every((r, i) => i === 0 || rows[i - 1].totalXp >= r.totalXp), '(f) rows are sorted by total XP, descending');
      const fresh = rows.find((r) => r.username === 'S20Fresh');
      assert(fresh && fresh.totalLevel === 23 && fresh.totalXp === 1154 && fresh.combatLevel === 3.4,
        `(f) the fresh account shows total 23 / 1154 XP / combat 3.4 (got ${JSON.stringify(fresh)})`);
      const lb = await apiGet('/api/leaderboard');
      assert(Array.isArray(lb.leaderboard) && lb.leaderboard.length >= 5, '(f) the duel leaderboard endpoint still answers');
      console.log('PASS (f) hiscores endpoint');
    }

    console.log('ALL STAGE 20 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
  }
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
