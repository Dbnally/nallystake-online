// Stage 25 tests: the environment + interface pass — (Part 1) a
// teleport sign beside the bank whose tap opens the existing
// Teleport panel; (Part 2) textured fences, dirt paths and houses
// dressing the plaza (plus a mine path and a gathering hut/path);
// (Part 3) the right-side button rail scrolls with a seamless LOOP
// (three copies of the set, silently recentred) reconciled with
// Grab-mode placement; (Part 4) the third-person camera gains
// drag-tilt pitch, clamped and persisted in the settings store.
// Client-only (server.js untouched), so — like stages 18/23/24's
// client parts — coverage is source/wiring asserts on
// public/index.html plus a parse of the inline script and a live
// smoke check that the server serves the new page byte-identically
// and welcomes a client. There is no DOM in this harness; the
// asserts pin every wiring site so a refactor can't drop one.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18125;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage25.json');
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

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  /* ---------- Part 1: the teleport sign by the bank ---------- */
  assert(/TELEPORT_SIGN_POS=\{x:880,y:470\}/.test(src), 'P1: the teleport sign sits at server (880,470), beside the bank');
  assert(/const tpAct=\{type:'teleportsign'\}/.test(src), 'P1: the sign prop is built with a teleportsign act (Stake Board pattern)');
  assert(/act\.type==='teleportsign'\)\{ openPanel\('teleport'\); return; \}/.test(src), 'P1: tapping the sign opens the EXISTING Teleport panel (no second travel UI)');
  assert(/🗺️ Teleports — tap to travel/.test(src), 'P1: the sign carries the "🗺️ Teleports" overhead label');
  assert(/g\.arc\(TELEPORT_SIGN_POS\.x,TELEPORT_SIGN_POS\.y,11,0,7\)/.test(src), 'P1: the minimap draws the teleport sign dot');

  /* ---------- Part 2: paths, textured fences, buildings ---------- */
  assert(/function dirtTexture\(/.test(src) && /function plasterTexture\(/.test(src) && /function roofTexture\(/.test(src), 'P2: procedural textures exist (dirt / plaster / roof shingles) — no external assets');
  assert(/function pathStrip\(parent,x1,z1,x2,z2,w\)/.test(src), 'P2: the path strip builder exists');
  assert((src.match(/pathStrip\(scene,/g) || []).length >= 15, 'P2: the plaza path network is laid (>=15 strips: gates, shops, dais, signs, mod row)');
  assert(/pathStrip\(scene,0,0,7\.5,1\.9,2\.2\)/.test(src), 'P2: a spur path leads to the teleport sign');
  assert(/pathStrip\(scene,-14,-16,14,-16,2\.6\)/.test(src), 'P2: a path runs along the mod NPC row');
  assert(/const fencePostMat=new THREE\.MeshLambertMaterial\(\{map:woodTexture\('#6b4e26'\)\}\)/.test(src) && /function fenceRailMat\(len\)/.test(src), 'P2: plaza fences are textured wood (shared post material, per-run rail material)');
  assert(/fenceRun\(-10,-36\.5,10,-36\.5\)/.test(src) && /fenceRun\(2\.5,-25\.5,10,-25\.5\)/.test(src), 'P2: a fence ring surrounds the dais with a front-centre entrance gap');
  assert(/function buildHouse\(parent,x,z,rotY,stone\)/.test(src), 'P2: the house builder exists (plaster / stone variants)');
  assert((src.match(/buildHouse\(scene,/g) || []).length === 5, 'P2: five houses stand around the plaza edges');
  assert(/pathStrip\(S,0,38,54,30,3\)/.test(src), 'P2: the mine has a path from its entrance to the furnace / anvil');
  assert(/pathStrip\(S,0,-40,0,12,3\)/.test(src) && /buildHouse\(S,-52,-32,Math\.PI\/2,1\)/.test(src), 'P2: the Gathering Cave has a gate path and a stone hut');

  /* ---------- Part 3: the looping button rail ---------- */
  const railCss = (src.match(/#railset\{[^}]*\}/) || [''])[0];
  assert(/overflow-y:auto/.test(railCss) && /scrollbar-width:none/.test(railCss), 'P3: #railset is a vertical scroller with the scrollbar hidden');
  assert(/#railset::-webkit-scrollbar\{display:none\}/.test(src), 'P3: the webkit scrollbar is hidden too');
  assert(/#railset\.locked\{overflow-y:hidden;touch-action:none\}/.test(src), 'P3: the .locked state kills rail scrolling (Grab mode)');
  assert(/#railset \.rbtn\{flex:none\}/.test(src), 'P3: rail buttons never squash inside the scroller');
  assert(/function buildRailLoop/.test(src) && /loopclone/.test(src), 'P3: the loop builder exists and marks its copies');
  assert(/c\.removeAttribute\('id'\)/.test(src), 'P3: loop copies drop the original element id (no duplicate #toolsbtn)');
  assert(/togglePanel\(c\.dataset\.panel\)/.test(src), 'P3: loop copies get the same tap behaviour as the originals');
  assert(/function railLoopCentre\(force\)/.test(src) && /rs\.scrollTop=st\+railSetH/.test(src) && /rs\.scrollTop=st-railSetH/.test(src), 'P3: scrolling recentres by one set height in both directions (the loop)');
  assert(/rs\.addEventListener\('scroll',\(\)=>railLoopCentre\(false\)\)/.test(src), 'P3: the scroll handler drives the recentring');
  assert(/requestAnimationFrame\(\(\)=>railLoopCentre\(true\)\)/.test(src), 'P3: opening the rail centres it on the middle copy');
  assert(/function syncRailCopies\(\)/.test(src) && (src.match(/syncRailCopies\(\)/g) || []).length >= 4, 'P3: syncRailCopies keeps placed/admin copies out of the flow (defined + called from visibility, positions and the loop build)');
  assert(/rsEl\.classList\.toggle\('locked',grabMode\)/.test(src), 'P3: turning Grab on locks rail scrolling');
  assert(/applyBtnPositions\(\); \/\/ Stage 25: the placed original takes the spot/.test(src), 'P3: finishing a Grab drag re-applies positions so the placed original takes the spot and copies leave the flow');
  // Stage 18/23 behaviour the loop must not break:
  assert(/closest\('#gearbtn,#railgrab'\)/.test(src), 'P3: the Stage 23 Grab click gate is untouched (gear + Grab chip only)');
  assert(/if\(!grabMode\|\|pid!==null\) return; \/\/ locked: the press is a normal tap/.test(src), 'P3: the Stage 18/23 rail-button drag handlers still key off grabMode (and now cover the copies)');
  assert(/id="railgrab"/.test(src) && /id="railmenutap"/.test(src) && /id="railcam"/.test(src), 'P3: the Grab / Menu tap / Camera chips still live above the set (they do not scroll)');

  /* ---------- Part 4: camera up/down tilt ---------- */
  assert(/const CAM_PITCH_MIN=0\.25, CAM_PITCH_MAX=1\.35/.test(src), 'P4: one shared pitch clamp exists (0.25..1.35 rad elevation)');
  assert(/camPitch:0\.92/.test(src) && /settings\.camPitch=clamp\(settings\.camPitch,CAM_PITCH_MIN,CAM_PITCH_MAX\)/.test(src), 'P4: pitch lives in the settings store (default 0.92, validated to the clamp)');
  assert(/let camPitch=clamp\(settings\.camPitch,CAM_PITCH_MIN,CAM_PITCH_MAX\)/.test(src), 'P4: the live pitch restores from settings on load');
  assert(/camPitch\+dy\*0\.005\*settings\.camSpeed/.test(src), 'P4: vertical drag movement maps to pitch (scaled by camera speed)');
  assert(/if\(dy&&settings\.camPov!=='first'\)/.test(src), 'P4: drag-tilt is third-person only — first person is unchanged');
  assert(/camVec\.y\*1\.6\*dt\*settings\.camSpeed,CAM_PITCH_MIN,CAM_PITCH_MAX\)/.test(src), 'P4: the camera stick uses the same shared clamp');
  assert(/function saveCamPitch\(\)/.test(src) && /settings\.camPitch=camPitch/.test(src), 'P4: pitch changes write back to the settings store (debounced save)');
  assert(/settings\.camPov==='first'&&a\)/.test(src) && /camera\.lookAt\(fx\+Math\.sin\(rot\)\*10,hy,fz\+Math\.cos\(rot\)\*10\)/.test(src), 'P4: the first-person camera branch is byte-for-byte the Stage 18 one');

  /* ---------- the inline script still parses ---------- */
  const clientJs = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs);
  assert(true, 'client inline script parses (new Function)');

  /* ---------- live smoke: server serves the new page + welcomes ---------- */
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  try {
    const page = await (await fetch(BASE + '/')).text();
    assert(page === src, 'live: the served page is byte-identical to the edited client');
    const reg = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'S25Ann', password: 's25-pass-ann' }) }).then((r) => r.json());
    assert(reg.token && reg.profile && reg.profile.username === 'S25Ann', 'live: registration returns a profile with the new client live');
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${reg.token}`);
    const welcomed = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('welcome timeout')), 10000);
      ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.type === 'welcome') { clearTimeout(to); resolve(true); } } catch { /* ignore */ } });
      ws.on('error', reject);
    });
    assert(welcomed, 'live: a client connects and is welcomed');
    ws.close();
  } finally {
    await stopServer();
  }
  console.log('ALL STAGE 25 TESTS PASSED');
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
