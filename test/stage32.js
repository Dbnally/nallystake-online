// Stage 32 tests: bigger person-like players, visible worn gear,
// full walk cycles, death falls, livelier fight movement, and party
// hats as crowns. Mostly a CLIENT build — so this suite is heavy on
// source/wiring pins (the established pattern for client stages),
// plus two live protocol checks:
//   - the players snapshot carries every worn slot the renderer
//     consumes (all nine), for a seeded fully-geared player;
//   - the new server `player_fell` broadcast: a weak victim dies to
//     a wizard while a bystander watches the same area — BOTH must
//     receive player_fell {username, respawn:true}, and the victim
//     must receive it BEFORE the 'area' whisk-away to the plaza
//     (the ordering the client's respawn hold relies on).
// Same harness style as the other stage suites: HTTP register/login,
// WebSocket at /ws?token=..., seeding via the test DB file while the
// server is stopped.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18132;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage32.json');
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

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  // ---------- (1) scale + person proportions ----------
  assert(/const AVATAR_SCALE=1\.32/.test(clientSrc), 'source: AVATAR_SCALE is 1.32');
  assert(/g\.scale\.setScalar\(AVATAR_SCALE\)/.test(clientSrc), 'source: the knight group is scaled by AVATAR_SCALE');
  assert(/limbPart\(0\.115,0\.92/.test(clientSrc), 'source: legs lengthened (0.92) on the person rig');
  assert(/head\.position\.y=2\.17/.test(clientSrc), 'source: head sits at 2.17 (person proportions)');
  assert(/splatY:3\.55/.test(clientSrc), 'source: knight splat height follows the scale (3.55)');
  assert(/const FIGURE_TAP_SCALE=1\.5/.test(clientSrc) && /h\*FIGURE_TAP_SCALE/.test(clientSrc), 'source: the whole-figure tap ladder scales up with the bigger figure (Stage 26 base rungs kept)');
  assert(/projectTo\(a\.group\.position\.x,3\.9,/.test(clientSrc), 'source: knight name labels ride above the taller figure');

  // ---------- (2) worn gear per slot ----------
  assert(/function syncGear/.test(clientSrc) && /function buildWeaponInto/.test(clientSrc), 'source: the worn-gear renderer exists');
  for (const slot of ['head', 'body', 'legs', 'feet', 'weapon', 'shield', 'cape', 'hands', 'amulet']) {
    assert(new RegExp(`w\\.${slot}`).test(clientSrc), `source: syncGear dresses the ${slot} slot`);
  }

  // ---------- (3) walk cycle: both arms + both legs, stride-matched ----------
  assert(/a\.legL\.rotation\.x=s\*0\.6\*m/.test(clientSrc) && /a\.legR\.rotation\.x=-s\*0\.6\*m/.test(clientSrc), 'source: both legs swing in opposite phase');
  assert(/a\.armL\.rotation\.x=-s\*0\.42\*m/.test(clientSrc) && /a\.armR\.rotation\.x\+=\(s\*0\.42\*m/.test(clientSrc), 'source: both arms counter-swing (left set, right eased — the Stage 26-pinned ease)');
  assert(/a\.phase=\(a\.phase\|\|0\)\+dist\*2\.3/.test(clientSrc), 'source: walk phase is distance-driven at the stride-matched factor 2.3');

  // ---------- (4) death falls: client machinery + server broadcast ----------
  assert(/function startDeathFall/.test(clientSrc) && /function applyDeathFall/.test(clientSrc), 'source: the death-fall animation exists');
  assert(/function onPlayerFell/.test(clientSrc) && /m\.type==='player_fell'/.test(clientSrc), 'source: the client handles player_fell');
  assert(/function beginDeathHold/.test(clientSrc) && /function releaseHeldMsgs/.test(clientSrc), 'source: the respawn hold keeps the scene until the fall plays');
  assert(/corpse-keep/.test(clientSrc), 'source: syncAvatars keeps a falling body until the fall finishes');
  assert(/function broadcastArea\(area, obj\)/.test(src), 'source (server): area-scoped broadcast helper exists');
  assert((src.match(/player_fell/g) || []).length >= 3, 'source (server): player_fell is sent from the death paths (respawnPlayer + duel KO + mod-duel loss)');
  assert(/broadcastArea\(sess\.area, \{ type: 'player_fell', username: sess\.profile\.username, respawn: true \}\)/.test(src), 'source (server): respawnPlayer broadcasts the fall BEFORE the area change');
  assert(/respawn: false/.test(src), 'source (server): the mod-duel knockdown is respawn:false (no whisk-away follows)');

  // ---------- (5) livelier fight movement ----------
  assert(/function applyFightStance/.test(clientSrc), 'source: the combat stance/shuffle layer exists');
  assert(/function startGuardRaise/.test(clientSrc) && /if\(guard\) startGuardRaise\(victim\)/.test(clientSrc), 'source: blocked hits raise the guard (wired through startFlinch)');
  assert(/function startDodge/.test(clientSrc) && /if\(outcome==='miss'\) startDodge\(victim,attacker\)/.test(clientSrc), 'source: missed swings make the defender dodge (wired through flinchForOutcome)');
  assert(/applyFightStance\(a,now,dt,eng\)/.test(clientSrc) && /applyFightStance\(a,now,dt,peng\)/.test(clientSrc), 'source: the stance layer is applied in the avatar + PKer loops');
  assert(/function applyDodge/.test(clientSrc) && /function clearDodgeOff/.test(clientSrc), 'source: the dodge offset bookkeeping exists (apply/clear, lunge-style)');

  // ---------- (6) party hats are crowns ----------
  assert(/dragon_partyhat:'👑'/.test(clientSrc) && !/🥳/.test(clientSrc), 'source: party hat icons are crowns now (no 🥳 left)');
  const hatStart = clientSrc.indexOf('function syncPartyHat');
  const hatEnd = clientSrc.indexOf('/* ================= Stage 30: worn gear', hatStart);
  assert(hatStart > 0 && hatEnd > hatStart, 'source: syncPartyHat region located');
  const hatBody = clientSrc.slice(hatStart, hatEnd);
  assert(/spike/.test(hatBody) && /gem/.test(hatBody) && /band/.test(hatBody), 'source: the worn party hat is built as a crown (band + spikes + gem)');
  assert(!/ConeGeometry\(0\.30,0\.62/.test(hatBody) && !/pom/.test(hatBody), 'source: the old cone + pompom are gone from the worn renderer');

  // ---------- live: snapshot carries all nine worn slots ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    const geared = await register('S32Geared', 's32-geared-pass');
    clients.push(geared);
    geared.close();
    await sleep(400);
    await stopServer();
    seedDb((data) => {
      const u = data.users['s32geared'];
      u.profile.worn = { head: 'dragon_helm', body: 'dragon_platebody', legs: 'dragon_platelegs', feet: 'barrows_dragon_boots', weapon: 'dragon_sword', shield: 'dragon_shield', cape: 'fire_cape', hands: 'dragon_gloves', amulet: 'dragonstone_amulet' };
    });
    await startServer();
    const g2 = await login('S32Geared', 's32-geared-pass');
    clients.push(g2);
    const watcher = await register('S32Watch', 's32-watch-pass');
    clients.push(watcher);
    const st = await watcher.waitFor((e) => e.type === 'state' && (e.players || []).some((p) => p.username === 'S32Geared'), 10000, 'state with the geared player');
    const entry = st.players.find((p) => p.username === 'S32Geared');
    assert(!!entry.worn, 'protocol: the snapshot carries the worn set');
    for (const slot of ['head', 'body', 'legs', 'feet', 'weapon', 'shield', 'cape', 'hands', 'amulet']) {
      assert(entry.worn[slot] === g2.profile().worn[slot] || entry.worn[slot] != null, `protocol: snapshot worn.${slot} is present (${entry.worn[slot]})`);
    }
    assert(entry.wornHead === 'dragon_helm', 'protocol: wornHead still rides the snapshot');
    console.log('PASS live: snapshot carries all nine worn slots');

    // ---------- live: player_fell on a real death, bystander + victim ----------
    // The victim is a FRESH account: 10-HP fight pool, bare hands,
    // no food, no prayer. A wizard (20 HP, hits 2-4) wins that race
    // inside one fight — probed at ~12s. (Seeding a strong weapon
    // backfires here: every new NPC fight restarts the pool at
    // full, so a geared victim can out-kill the whole roster.)
    const v = await register('S32Victim', 's32-victim-pass');
    clients.push(v);
    const by = await login('S32Watch', 's32-watch-pass');
    clients.push(by);
    v.send({ type: 'travel', to: 'magic' });
    by.send({ type: 'travel', to: 'magic' });
    await v.waitFor((e) => e.type === 'area' && e.area === 'magic', 10000, 'victim in the Wizard Grounds');
    await by.waitFor((e) => e.type === 'area' && e.area === 'magic', 10000, 'bystander in the Wizard Grounds');
    await v.waitFor((e) => e.type === 'npc_state' && e.area === 'magic' && (e.npcs || []).length >= 3, 10000, 'wizard roster');
    const mV = v.mark(); const mB = by.mark();
    const latestWizards = () => {
      for (let i = v.events.length - 1; i >= 0; i--) {
        const e = v.events[i];
        if (e.type === 'npc_state' && e.area === 'magic') return (e.npcs || []).filter((n) => n.hp > 0);
      }
      return [];
    };
    let fellV = null;
    const deadline = Date.now() + 150000;
    while (!fellV && Date.now() < deadline) {
      const wizards = latestWizards();
      if (!wizards.length) { await sleep(3000); continue; } // all down — wait for respawns
      for (const wiz of wizards) {
        if (fellV || Date.now() > deadline) break;
        v.send({ type: 'move', x: wiz.x, y: wiz.y });
        await sleep(400);
        const mF = v.mark();
        v.send({ type: 'attack_npc', id: wiz.id });
        try {
          await v.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start', 6000, 'fight start');
        } catch { continue; }
        // Poll this fight: it ends with the wizard dead (try the
        // next) or with player_fell (done).
        const fDeadline = Date.now() + 45000;
        while (Date.now() < fDeadline) {
          const fell = v.events.slice(mV).find((e) => e.type === 'player_fell' && e.username === 'S32Victim');
          if (fell) { fellV = { e: fell }; break; }
          if (v.events.slice(mF).some((e) => e.type === 'npc_fight' && e.phase === 'end')) break;
          await sleep(250);
        }
      }
    }
    assert(!!fellV, 'death test: the victim died and received player_fell');
    assert(fellV.e.respawn === true, 'death test: the fall is marked respawn:true (a whisk-away follows)');
    const fellB = await by.waitSince(mB, (e) => e.type === 'player_fell' && e.username === 'S32Victim', 10000, 'player_fell (bystander)');
    assert(fellB.e.respawn === true, 'death test: the bystander in the same area also received player_fell');
    // Ordering: in the victim's own stream, player_fell precedes
    // the 'area' message that whisks them to the plaza.
    const idxFell = v.events.findIndex((e) => e.type === 'player_fell' && e.username === 'S32Victim');
    const idxArea = v.events.findIndex((e, i) => i > idxFell && e.type === 'area' && e.area === 'plaza');
    assert(idxFell >= 0 && idxArea > idxFell, 'death test: player_fell arrives BEFORE the plaza area switch in the victim stream');
    console.log('PASS live: player_fell broadcast (victim + bystander, ordered before the respawn)');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
  }
  console.log('ALL STAGE 32 TESTS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
