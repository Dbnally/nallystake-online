// Stage 31 tests: attack approach everywhere, camera-behind-facing,
// RuneScape-style tap movement, reconnect restore, mod-duel message.
//   * Part 1 (NPC): a MELEE player starting a wizard fight from
//     ~100 units (inside NPC_RANGE, beyond MELEE_REACH) used to get
//     a dead fight — fighting ticks carried no closing/moveTo when
//     only the player was out of reach, so the player never swung
//     and the wizard never unlocked. Now those ticks carry
//     closing+moveTo; the player walks in, lands a connected swing,
//     and the wizard unlocks and swings back.
//   * Part 1 (duels): pin the existing closing contract — engage
//     toe-to-toe, one fighter runs off, closing ticks flow and NO
//     damage lands while apart, walking back resumes real swings.
//   * Part 4: a player who can't cover a mod stake gets the exact
//     server refusal ("You need 100g for this stake (you have
//     50g).") instead of silence; a player who CAN cover it starts.
//   * Part 5: a hard socket drop at the Fishing Cove reconnects
//     back INTO the cove at the same spot (not the plaza); a duel
//     forfeited by a disconnect still lands in the plaza (no arena
//     restore); an ordinary plaza drop still lands in the plaza.
//   * Parts 2/3 + the chat-draft regression are client-side —
//     source/wiring pins below (no DOM in this harness).
// Same harness style as test/stage30.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18131;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage31.json');
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
  terminate() { try { this.ws.terminate(); } catch { /* ignore */ } }
}
const PW = (n) => 's31-pass-' + n;
async function register(name) {
  const d = await api('/api/register', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function reconnect(name) {
  const d = await api('/api/login', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  const w = await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome (reconnect)');
  return { c, welcome: w };
}
async function prof(name) { return (await api('/api/login', { username: name, password: PW(name) })).profile; }
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  return (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
}
function latestPos(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? { x: p.x, y: p.y } : null;
}
// Walk a client to a spot the way the real client does: stepped
// move messages (the server takes client-driven positions).
async function walkTo(c, x, y, steps = 10) {
  const from = latestPos(c, c.name) || { x: 800, y: 450 };
  for (let i = 1; i <= steps; i++) {
    c.send({ type: 'move', x: Math.round(from.x + (x - from.x) * (i / steps)), y: Math.round(from.y + (y - from.y) * (i / steps)) });
    await sleep(90);
  }
  await sleep(250);
}
// The Stage 14/26 challenge flow, driven to duel_start.
async function startDuel(A, B, opts) {
  const mA = A.mark(), mB = B.mark();
  A.send({ type: 'challenge', target: B.name, stake: 1, ...(opts || {}) });
  const inc = (await B.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming')).e;
  B.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  A.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  B.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  await A.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start (challenger)');
  await B.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'duel_start (acceptor)');
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/playerOut \? \{ closing: true, moveTo: approachPoint\(sess\.x, sess\.y, npc\.x, npc\.y\) \}/.test(src),
    'source (Part 1): NPC fighting ticks carry per-fighter closing+moveTo when only the player is out of reach');
  assert(/function rememberSpot/.test(src) && /const savedSpots = new Map/.test(src) && /RESTORE_TTL_MS/.test(src),
    'source (Part 5): reconnect spots are remembered with a TTL');
  assert(/back where you left off/.test(src), 'source (Part 5): the restore tells the player where they landed');
  assert(/You need \$\{def\.stake\}g for this stake \(you have \$\{goldTotal\(profile\)\}g\)\./.test(src),
    'source (Part 4): the server refusal names the stake and the player\'s gold');
  assert(/const CAM_BEHIND_RATE=2\.2/.test(clientSrc) && /localRot\+Math\.PI\)-camYaw/.test(clientSrc),
    'source (Part 2): camera eases toward behind-my-facing (localRot+PI) at CAM_BEHIND_RATE');
  assert((clientSrc.match(/lastCamInputAt/g) || []).length >= 4,
    'source (Part 2): manual camera input (drag + stick) stamps lastCamInputAt and pauses the ease');
  assert(/const TURN_RATE=9/.test(clientSrc)
    && /turnLocalRotTo\(Math\.atan2\(dx,dy\),dt\)/.test(clientSrc)
    && /turnLocalRotTo\(Math\.atan2\(vx,vz\),dt\)/.test(clientSrc),
    'source (Part 3): tap-walk and joystick facing both turn at the capped TURN_RATE');
  assert(/faceGoal=Math\.atan2\(dx,dy\)/.test(clientSrc) && !/function faceToward\(pt\)\{\n if\(!myPos\) return;\n const dx=pt\.x-myPos\.x, dy=pt\.y-myPos\.y; \/\/ server deltas scale 1:1 with world deltas\n if\(Math\.hypot\(dx,dy\)>1\) localRot=/.test(clientSrc),
    'source (Part 3): Face tap mode sets a turn goal instead of snapping localRot');
  assert(/npcFight\? npcAvatars\[npcFight\.npcId\]/.test(clientSrc) && /fcAvatars\[fcRun\.targetId\]/.test(clientSrc),
    'source (Part 1): my knight fight-faces his NPC/Barrows opponent and his Fight Caves target');
  assert((clientSrc.match(/for this stake duel — you have/g) || []).length >= 2,
    'source (Part 4): the mod sheet AND the stale-sheet guard both state the affordability message');
  assert(/queueChat\(\{type:'chat',text:v\}\)/.test(clientSrc) && /if\(send\(\{type:'chat',text:v\}\)\)\{ \$\('chat'\)\.value=''/.test(clientSrc),
    'source (Part 5 regression pin, updated by Stage 35): a failed chat send is queued for reconnect delivery and says so — it never silently vanishes');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh */ }
  await startServer();
  try {
    // ---------- Part 1: melee vs wizard — the dead-fight fix ----------
    {
      const wiz = await register('Wiz31A');
      const mT = wiz.mark();
      wiz.send({ type: 'travel', to: 'magic' });
      await wiz.waitSince(mT, (e) => e.type === 'area' && e.area === 'magic', 10000, 'travel to Wizard Grounds');
      const ns = await wiz.waitSince(mT, (e) => e.type === 'npc_state' && e.area === 'magic' && (e.npcs || []).length > 0, 10000, 'wizard roster');
      const w = ns.e.npcs.find((n) => n.kind === 'wizard') || ns.e.npcs[0];
      assert(!!w, 'wizard grounds roster arrived');
      // Stand ~100 units east of the wizard: inside NPC_RANGE (150),
      // beyond MELEE_REACH (42), unarmed = melee.
      const sx = Math.min(1580, w.x + 100), sy = w.y;
      await walkTo(wiz, sx, sy);
      const mF = wiz.mark();
      wiz.send({ type: 'attack_npc', id: w.id });
      const start = (await wiz.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start', 10000, 'wizard fight start')).e;
      assert(start.npcId === w.id, 'melee-vs-wizard fight started at ~100 units');
      // Phase 1: stand still — ticks must now carry closing+moveTo
      // (the fix), and no swing of mine can land from out here.
      let sawClosing = false, earlySwing = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 4000) {
        const ticks = wiz.events.slice(mF).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
        if (ticks.some((t) => t.closing === true && t.moveTo)) sawClosing = true;
        if (ticks.some((t) => typeof t.youHit === 'number')) earlySwing = true;
        if (sawClosing) break;
        await sleep(200);
      }
      assert(sawClosing, 'Part 1: fighting ticks carry closing+moveTo while only the player is out of reach (no more dead fight)');
      assert(!earlySwing, 'Part 1: no player swing lands from beyond melee reach');
      // Phase 2: walk in (the real client follows moveTo) — my swing
      // lands, and the connected hit unlocks the wizard's swings.
      await walkTo(wiz, w.x, w.y, 14);
      const landed = await wiz.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'tick' && typeof e.youHit === 'number', 45000, 'player swing lands after walking in');
      assert(!!landed.e, 'Part 1: player swing lands after closing to melee reach');
      const back = await wiz.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'tick' && typeof e.npcHit === 'number', 45000, 'wizard unlocks and swings back');
      assert(!!back.e, 'Part 1: the wizard unlocks on the connected hit and swings back');
      wiz.send({ type: 'flee' });
      await wiz.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'wizard fight fled');
      wiz.close();
    }

    // ---------- Part 4: mod-duel affordability ----------
    {
      const poor = await register('Poor31');
      await walkTo(poor, 680, 300); // Mod Ash's post
      const mBuy = poor.mark();
      poor.send({ type: 'shop_buy', item: 'bronze_sword', qty: 1 }); // 90g since the Stage 34 gear repricing — leaves exactly 10g
      await poor.waitSince(mBuy, (e) => e.type === 'shop', 10000, 'bronze sword bought');
      const p1 = await prof('Poor31');
      assert(p1.gold === 10, `Poor31 has exactly 10g after the sword (got ${p1.gold})`);
      const err = await expectError(poor, { type: 'mod_duel_start', id: 'mod1' }, 'unaffordable mod duel refusal');
      assert(err.message === 'You need 100g for this stake (you have 10g).',
        `Part 4: unaffordable mod duel returns the exact visible refusal (got "${err.message}")`);
      assert(!poor.events.some((e) => e.type === 'mod_duel' && e.phase === 'start'), 'Part 4: no mod duel started for the broke player');
      poor.close();

      const rich = await register('Rich31');
      await walkTo(rich, 680, 300);
      const mD = rich.mark();
      rich.send({ type: 'mod_duel_start', id: 'mod1' });
      const start = (await rich.waitSince(mD, (e) => e.type === 'mod_duel' && e.phase === 'start', 10000, 'affordable mod duel starts')).e;
      assert(start.stake === 100 && start.pot === 200, 'Part 4: a player who can cover the stake starts the duel (pot 200g)');
      rich.terminate(); // cleanup forfeits the fresh duel — throwaway account
      await sleep(600);
    }

    // ---------- Part 5: reconnect restore at the Fishing Cove ----------
    {
      const cove = await register('Cove31');
      const mT = cove.mark();
      cove.send({ type: 'travel', to: 'cove' });
      await cove.waitSince(mT, (e) => e.type === 'area' && e.area === 'cove', 10000, 'travel to Fishing Cove');
      await walkTo(cove, 300, 500);
      const before = latestPos(cove, 'Cove31');
      assert(before && Math.abs(before.x - 300) <= 20 && Math.abs(before.y - 500) <= 20, 'cove walker reached (300,500) before the drop');
      cove.terminate(); // hard drop — no close frame
      await sleep(1000); // cleanup runs, the spot is remembered
      const { c: cove2, welcome } = await reconnect('Cove31');
      assert(welcome.area === 'cove', `Part 5: reconnect lands back in the cove, not the plaza (got "${welcome.area}")`);
      const me = (welcome.players || []).find((p) => p.username === 'Cove31');
      assert(me && Math.abs(me.x - 300) <= 20 && Math.abs(me.y - 500) <= 20,
        `Part 5: restored at the pre-drop position (${me ? me.x + ',' + me.y : 'missing'})`);
      const note = await cove2.waitFor((e) => e.type === 'chat' && /back where you left off/.test(e.text || ''), 8000, 'restore chat line');
      assert(!!note, 'Part 5: the player is told they were restored');
      cove2.close();

      // An ordinary plaza drop still lands in the plaza.
      const pz = await register('Plaza31');
      pz.terminate();
      await sleep(1000);
      const { c: pz2, welcome: wPz } = await reconnect('Plaza31');
      assert(wPz.area === 'plaza', 'Part 5: a plaza disconnect still lands in the plaza');
      pz2.close();
    }

    // ---------- Part 1 (duel closing pin) + Part 5 (forfeit exclusion) ----------
    {
      const A = await register('DuelA31');
      const B = await register('DuelB31');
      await startDuel(A, B);
      A.send({ type: 'duel_attack' });
      B.send({ type: 'duel_attack' });
      const mSwing = A.mark();
      const sw = await A.waitSince(mSwing, (e) => e.type === 'duel_tick' && (typeof e.youHit === 'number' || typeof e.oppHit === 'number'), 25000, 'toe-to-toe swings');
      assert(!!sw.e, 'Part 1 (duel): engaged fighters toe-to-toe land real swings');
      // B runs to the far corner of the arena.
      await walkTo(B, 150, 150, 12);
      const mRun = A.mark();
      const closeTick = (await A.waitSince(mRun, (e) => e.type === 'duel_tick' && e.closing === true && !!e.moveTo, 15000, 'closing ticks while apart')).e;
      assert(!!closeTick, 'Part 1 (duel): closing ticks with moveTo flow while the fighters are apart');
      const hpAtClose = { you: closeTick.hpYou, opp: closeTick.hpOpponent };
      await sleep(2600); // ~4 more ticks apart
      const apartTicks = A.events.slice(mRun).filter((e) => e.type === 'duel_tick');
      assert(apartTicks.length >= 3, 'Part 1 (duel): ticks kept flowing while apart');
      assert(apartTicks.every((t) => t.hpYou === hpAtClose.you && t.hpOpponent === hpAtClose.opp),
        'Part 1 (duel): NO damage lands while the fighters are out of reach');
      assert(apartTicks.every((t) => t.youHit === null || t.closing === true), 'Part 1 (duel): no phantom swings while apart');
      // B walks back in — swings resume.
      const aPos = latestPos(B, 'DuelA31') || { x: 780, y: 450 };
      await walkTo(B, aPos.x + 25, aPos.y, 12);
      const mBack = A.mark();
      const resumed = await A.waitSince(mBack, (e) => e.type === 'duel_tick' && !e.closing && (typeof e.youHit === 'number' || typeof e.oppHit === 'number'), 25000, 'swings resume in reach');
      assert(!!resumed.e, 'Part 1 (duel): walking back into reach resumes real swings');
      // Part 5 exclusion: A drops mid-duel — the forfeit stands and
      // the reconnect lands in the PLAZA, never back in the arena.
      A.terminate();
      await sleep(1000);
      const endB = await B.waitFor((e) => e.type === 'duel_end', 10000, 'B sees the forfeit end');
      assert(!!endB, 'Part 5: the abandoned duel settles as a forfeit for the other fighter');
      const { c: A2, welcome: wA } = await reconnect('DuelA31');
      assert(wA.area === 'plaza', `Part 5: a duel forfeited by disconnect reconnects in the plaza, not the arena (got "${wA.area}")`);
      A2.close();
      B.close();
    }

    console.log('ALL STAGE 31 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
