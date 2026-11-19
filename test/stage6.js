// Stage 6 tests: Tree Guardians — awaken_tree turns the nearest tree
// into a session-only NPC ally that follows its owner between areas
// and fights beside them in NPC combat (never in PvP duels).
//
// Same harness style as test/stage5.js: HTTP /api/register + /api/login
// for accounts, WebSocket at /ws?token=..., and a strong player seeded
// by editing the test DB file while the server is stopped.
//
// NOT covered here: guardian DEATH. A guardian has 50 HP and only
// takes 35% of connecting hits (goblin hits are <= 2), so driving one
// to death honestly takes dozens of fights — impractical and flaky in
// a suite. The killAlly path is code-reviewed instead (see the Stage 6
// report); everything else below is driven end-to-end.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18087;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage6.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

// Fishing Cove trees (server defNode positions).
const COVE_TREE = { id: 'tree_c2', x: 240, y: 460 }; // Stage 13: node spot x2
// Goblin Camp spawns (server GOBLIN_SPAWNS order; Stage 13: x2).
const GOBLINS = [
  { id: 'goblin1', x: 400, y: 450 }, { id: 'goblin2', x: 640, y: 320 },
  { id: 'goblin3', x: 840, y: 520 }, { id: 'goblin4', x: 1040, y: 360 },
  { id: 'goblin5', x: 760, y: 680 }, { id: 'goblin6', x: 1200, y: 600 },
];

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

// Fight one goblin to the end; returns every tick note seen.
async function fightGoblin(c, g) {
  const m0 = c.mark();
  c.send({ type: 'move', x: g.x, y: g.y });
  await sleep(300);
  c.send({ type: 'attack_npc', id: g.id });
  const notes = [];
  let idx = m0;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const t = await c.waitSince(idx, (e) => e.type === 'npc_fight' || e.type === 'error', 10000, 'goblin fight event').catch(() => null);
    if (!t) break;
    idx = t.idx + 1;
    if (t.e.type === 'error') return notes; // not fightable right now (dead / busy) — caller tries the next
    if (t.e.phase === 'tick' && t.e.note) notes.push(t.e.note);
    if (t.e.phase === 'end') return notes;
  }
  return notes;
}

async function main() {
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // Register, then seed a big Hitpoints pool (stage5 pattern) so the
    // goblin fights below are in no danger of ending by player death.
    const reg = await register('S6Hero', 's6-hero-pass');
    clients.push(reg);
    reg.close();
    await sleep(400);
    await stopServer();
    seedDb((data) => { data.users['s6hero'].profile.xp.hitpoints = 500000; });
    await startServer();
    const hero = await login('S6Hero', 's6-hero-pass');
    clients.push(hero);

    // ---------- Errors first: no tree in the plaza ----------
    const mPlaza = hero.mark();
    hero.send({ type: 'awaken_tree' });
    const errPlaza = (await hero.waitSince(mPlaza, (e) => e.type === 'error', 10000, 'plaza awaken error')).e;
    assert(errPlaza.message === 'No tree nearby to awaken.', `awaken errors: the plaza has no tree ("${errPlaza.message}")`);

    // ---------- Awaken in the cove ----------
    hero.send({ type: 'travel', to: 'cove' });
    await hero.waitFor((e) => e.type === 'area' && e.area === 'cove', 10000, 'in the cove');
    hero.send({ type: 'move', x: COVE_TREE.x, y: COVE_TREE.y });
    await sleep(300);
    const mAw = hero.mark();
    hero.send({ type: 'awaken_tree' });
    const alliesEv = (await hero.waitSince(mAw, (e) => e.type === 'allies' && e.area === 'cove' && e.allies.length === 1, 10000, 'allies broadcast')).e;
    const g = alliesEv.allies[0];
    assert(g.owner === 'S6Hero' && g.name === 'Tree Guardian' && g.oak === false && g.hp === 50 && g.maxHp === 50,
      `awaken: a Tree Guardian rose for S6Hero (hp ${g.hp}/${g.maxHp})`);
    assert(g.x === COVE_TREE.x && g.y === COVE_TREE.y, 'awaken: the guardian stands where the tree stood');
    const nodesEv = (await hero.waitSince(mAw, (e) => e.type === 'nodes' && e.area === 'cove'
      && e.nodes.some((n) => n.id === COVE_TREE.id && n.depleted === true), 10000, 'tree depleted broadcast')).e;
    assert(nodesEv.nodes.find((n) => n.id === COVE_TREE.id).depleted === true, 'awaken: the awakened tree node is depleted');

    // ---------- One guardian at a time ----------
    const mAgain = hero.mark();
    hero.send({ type: 'awaken_tree' });
    const errAgain = (await hero.waitSince(mAgain, (e) => e.type === 'error', 10000, 'second awaken error')).e;
    assert(errAgain.message === 'Your Tree Guardian still stands.', `awaken errors: a living guardian blocks a second ("${errAgain.message}")`);

    // ---------- Follow: it trails the owner across the area ----------
    // Stage 13: the walk target is (1200,450) — deep into the doubled
    // cove (the old (700,225) scaled x2 would be (1400,450); 1200
    // keeps the guardian's ~1000-unit trail inside the 40s wait).
    hero.send({ type: 'move', x: 1200, y: 450 });
    const followEv = await hero.waitFor((e) => e.type === 'allies' && e.area === 'cove' && e.allies.length === 1
      && Math.hypot(e.allies[0].x - 1200, e.allies[0].y - 450) <= 130, 40000, 'guardian closing on the owner');
    const fg = followEv.allies[0];
    assert(Math.hypot(fg.x - 1200, fg.y - 450) <= 130, `follow: the guardian trailed its owner across the cove (now at ${fg.x},${fg.y})`);

    // ---------- Follow: it hops areas with the owner ----------
    hero.send({ type: 'travel', to: 'goblins' });
    await hero.waitFor((e) => e.type === 'area' && e.area === 'goblins', 10000, 'in the goblin camp');
    const hopEv = await hero.waitFor((e) => e.type === 'allies' && e.area === 'goblins'
      && e.allies.some((a) => a.owner === 'S6Hero'), 10000, 'guardian in the goblin camp');
    assert(hopEv.allies.some((a) => a.owner === 'S6Hero' && a.name === 'Tree Guardian'),
      'follow: the guardian appears in the Goblin Camp allies list after its owner travels');

    // ---------- Goblin assist: its swings / redirects show in ticks ----------
    let guardianNote = null;
    for (const gob of GOBLINS) {
      const notes = await fightGoblin(hero, gob);
      guardianNote = notes.find((n) => n.includes('Tree Guardian')) || guardianNote;
      if (guardianNote) break;
    }
    assert(guardianNote !== null, `goblin assist: a tick note credits the guardian ("${guardianNote}")`);

    // ---------- Duel exclusion: no guardian in the arena, ever ----------
    const foe = await register('S6Foe', 's6-foe-pass');
    clients.push(foe);
    hero.send({ type: 'travel', to: 'plaza' });
    await hero.waitFor((e) => e.type === 'area' && e.area === 'plaza', 10000, 'hero back in plaza');
    await hero.waitFor((e) => e.type === 'allies' && e.area === 'plaza'
      && e.allies.some((a) => a.owner === 'S6Hero'), 10000, 'guardian followed home to the plaza');
    console.log('PASS follow: the guardian followed its owner home to the plaza');

    hero.send({ type: 'challenge', target: 'S6Foe', stake: 10 });
    const offer = await foe.waitFor((e) => e.type === 'challenge_incoming' && e.from === 'S6Hero', 10000, 'challenge offer');
    const mDuelH = hero.mark(), mDuelF = foe.mark();
    foe.send({ type: 'challenge_response', challengeId: offer.challengeId, accept: true });
    // Stage 14: acceptance joins the configuration — both confirm.
    hero.send({ type: 'challenge_confirm', challengeId: offer.challengeId });
    foe.send({ type: 'challenge_confirm', challengeId: offer.challengeId });
    await hero.waitSince(mDuelH, (e) => e.type === 'duel_start', 10000, 'hero duel_start');
    // Stage 12: duel fighters start un-engaged — both tap to attack.
    hero.send({ type: 'duel_attack' }); foe.send({ type: 'duel_attack' });
    const endH = (await hero.waitSince(mDuelH, (e) => e.type === 'duel_end', 240000, 'hero duel_end')).e;
    assert(!!endH.winner, 'duel exclusion: the duel ran to a finish');
    const heroTicks = hero.events.slice(mDuelH).filter((e) => e.type === 'duel_tick');
    const foeTicks = foe.events.slice(mDuelF).filter((e) => e.type === 'duel_tick');
    assert(heroTicks.length >= 5, `duel exclusion: the duel actually ticked (${heroTicks.length} ticks seen)`);
    assert(![...heroTicks, ...foeTicks].some((e) => e.note && e.note.includes('Tree Guardian')),
      'duel exclusion: no duel tick note mentions the Tree Guardian');
    const arenaAllies = [...hero.events.slice(mDuelH), ...foe.events.slice(mDuelF)]
      .filter((e) => e.type === 'allies' && e.area === 'arena');
    assert(!arenaAllies.some((e) => e.allies.some((a) => a.owner === 'S6Hero')),
      'duel exclusion: the guardian never appears in the arena allies list');
    await hero.waitSince(mDuelH, (e) => e.type === 'allies' && e.area === 'plaza'
      && e.allies.some((a) => a.owner === 'S6Hero'), 10000, 'guardian waiting in the plaza after the duel');
    console.log('PASS duel exclusion: the guardian waited in the plaza and is listed there again after the duel');

    for (const c of clients) c.close();
    console.log('ALL STAGE 6 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
