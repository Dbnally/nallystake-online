// Stage 23 tests: (Part 1) every combat action surface becomes ONE
// slim chip row — Derek's rule: "If the player is attacked during any
// type of combat then they should always have a clear screen." — and
// (Part 2) Grab mode becomes modal: while it's on, only dragging the
// movable buttons, the master 🎛️ toggle and the Grab chip itself work.
// Both parts are client-only (server.js untouched), so — like stage18's
// client parts — they are covered by source/wiring asserts on
// public/index.html plus a parse of the inline script and a live smoke
// check that the server serves the new page and welcomes a client.
// The pointer-level behaviour itself (taps/movement inert while Grab
// is on, live again when it's off) has no DOM in this harness; the
// asserts below pin every gate site so a refactor can't drop one.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18123;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage23.json');
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

  /* ---------- Part 1: the slim fight row ---------- */
  // Both bars: full-width single row, sideways scroll, NO wrap, no box.
  const duelCss = (src.match(/#duelbar\{[^}]*\}/) || [''])[0];
  const fcCss = (src.match(/#fcbar\{[^}]*\}/) || [''])[0];
  assert(/overflow-x:auto/.test(duelCss) && /flex-wrap:nowrap/.test(duelCss) && !/border:2px/.test(duelCss), 'P1: #duelbar is one non-wrapping scrolling row with no panel border');
  assert(/overflow-x:auto/.test(fcCss) && /flex-wrap:nowrap/.test(fcCss) && !/border:2px/.test(fcCss), 'P1: #fcbar is one non-wrapping scrolling row with no panel border');
  assert(/#duelbar\.open\{display:flex\}/.test(src) && /#fcbar\.open\{display:flex\}/.test(src), 'P1: both bars still open as flex rows only during their combat');
  // Chip vocabulary + flattened containers (display:contents keeps one row).
  assert(/\.fchip\{/.test(src) && /\.fchip\.ctx\{/.test(src) && /\.fchip\.spec\{/.test(src), 'P1: the .fchip chip styles exist (base / context / special)');
  assert(/#duelquick\{display:contents\}/.test(src) && /#duelprayers\{display:contents\}/.test(src) && /#fcquick\{display:contents\}/.test(src) && /#fcprayers\{display:contents\}/.test(src), 'P1: quick/prayer containers are display:contents — their chips join the single row');
  // Context chips: wave (existing #fctitle) + a duel-row context chip.
  assert(/id="fctitle"/.test(src), 'P1: Fight Caves keeps its wave context chip (#fctitle)');
  assert(/id="duelctx"/.test(src), 'P1: the duel row has a context chip (#duelctx)');
  assert(/\$\('duelctx'\)\.textContent=`⚔️ \$\{duel\.opponent\}`/.test(src), 'P1: player duels put the opponent name on the context chip');
  assert(/\$\('duelctx'\)\.textContent=`⭐ \$\{modDuel\.name\} · Tier \$\{modDuel\.tier\}`/.test(src), 'P1: mod duels put the mod name + tier on the context chip');
  assert(/kindIcon/.test(src) && /\$\('duelctx'\)\.textContent=`\$\{kindIcon\} \$\{npcFight\.name\}`/.test(src), 'P1: NPC / Barrows fights put the creature name on the context chip');
  // Prayer chips in the duel row (FC keeps its own), wired + synced.
  assert(/id="duelpray-melee"/.test(src) && /id="duelpray-missiles"/.test(src) && /id="duelpray-magic"/.test(src), 'P1: the duel row carries the three protection-prayer chips');
  assert(/\$\('duelpray-'\+pr\)/.test(src) && /type:'prayer',prayer:pr/.test(src), 'P1: duel-row prayer chips send the same prayer message as the drawer / FC chips');
  assert(/function syncBarPrayers\(noPray\)/.test(src) && (src.match(/syncBarPrayers\(/g) || []).length >= 4, 'P1: syncBarPrayers is defined and called by all three duel-row renders (duel / NPC / mod)');
  assert(/syncBarPrayers\(!!R\.noPrayer\)/.test(src), 'P1: a No Prayer duel greys the row prayer chips (ruledis), like the drawer');
  // Special + consumables as compact chips in all four renders.
  assert((src.match(/fchip spec/g) || []).length >= 4, 'P1: all four fight renders (duel / NPC / mod / FC) emit the special as a chip');
  assert(/iconOf\(s\.item\)\} ×\$\{s\.qty\}/.test(src), 'P1: consumables render as icon + ×qty chips');
  assert(!/class="act" id="specbtn"/.test(src) && !/class="act" id="fcspecbtn"/.test(src), 'P1: the old full-width special buttons are gone from the fight bars');
  assert(!/id="duelquick"><\/div>\s*<div id="duelflee"[^>]*><button class="ghost"/.test(src) && /<button class="fchip" id="fleebtn">🏃 Flee<\/button>/.test(src), 'P1: Flee is a chip in the duel row');
  assert(/<button class="fchip" id="fcleavebtn" title="Leave the caves">🏃 Leave<\/button>/.test(src), 'P1: Fight Caves Leave is a chip in the row');
  // The hidden .fightinfo write targets survive (existing writers don't throw).
  for (const id of ['dueltitle', 'duelofficial', 'duellast', 'hpyou', 'hpopp', 'fctitle', 'fclast', 'fchpyou', 'fchptarget']) {
    assert(new RegExp(`id="${id}"`).test(src), `P1: hidden/existing write target #${id} is still in the page`);
  }
  assert(/\.fightinfo\{display:none!important\}/.test(src), 'P1: .fightinfo elements stay hidden — HP remains overhead only');
  // Barrows tracker hides mid-fight (clear screen), returns after.
  assert(/barrowsBarHidden\|\|npcFight/.test(src), 'P1: the Barrows tracker bar hides while a brother fight is running');

  /* ---------- Part 2: Grab mode is modal ---------- */
  // The standing hint.
  assert(/id="grabhint"/.test(src) && /Everything else is paused/.test(src), 'P2: a standing Grab hint exists and says input is paused');
  assert(/body\.grabbing #grabhint\{display:block\}/.test(src), 'P2: the hint shows exactly while Grab is on (body.grabbing)');
  // setGrabMode freezes pending input the moment it turns on.
  assert(/tapTarget=null; pendingAttack=null; pendingFcAttack=null; pendingMound=null; pendingPile=null; pendingChest=false/.test(src), 'P2: turning Grab on clears the tap target and every pending walk-to action');
  assert(/joyVec=\{x:0,y:0\}; camVec=\{x:0,y:0\}/.test(src), 'P2: turning Grab on zeroes both sticks');
  // The central click gate + its two allowed controls.
  assert(/document\.addEventListener\('click',e=>\{\n if\(!grabMode\) return;/.test(src), 'P2: a capture-phase click gate on the grab flag exists');
  assert(/closest\('#gearbtn,#railgrab'\)/.test(src), 'P2: the click gate lets only the master toggle (#gearbtn) and the Grab chip (#railgrab) through');
  assert(/e\.preventDefault\(\); e\.stopPropagation\(\);/.test(src), 'P2: gated clicks are swallowed before reaching their handlers');
  // Pointer-path gates at every action surface.
  assert(/function handleTap\(cx,cy\)\{\n if\(grabMode\) return;/.test(src), 'P2: world taps (walk / attack / interact / menu-tap) are gated in handleTap');
  assert(/function handleLongPress\(cx,cy\)\{\n if\(!me\) return;\n if\(grabMode\) return;/.test(src), 'P2: context menus are gated in handleLongPress');
  assert(/if\(grabMode\|\|duelCountdownLeft>0/.test(src), 'P2: movement stepping refuses to move while Grab is on');
  assert(/joy\.addEventListener\('pointerdown',e=>\{ if\(grabMode\) return;/.test(src), 'P2: the movement joystick ignores presses while Grab is on');
  assert(/el\.addEventListener\('pointerdown',e=>\{ if\(grabMode\) return;/.test(src), 'P2: the 3D view ignores presses (no taps, holds, drags, pinches) while Grab is on');
  assert(/\$\('minimap'\)\.addEventListener\('pointerdown',e=>\{\n if\(!me\|\|!myPos\) return;\n if\(grabMode\) return;/.test(src), 'P2: minimap tap-to-walk is gated while Grab is on');
  assert(/Grab is modal — backpack taps and drags do nothing/.test(src), 'P2: backpack cells are gated while Grab is on');
  assert(/Grab is modal — bank drags do nothing/.test(src), 'P2: bank drag cells are gated while Grab is on');
  // The arranging path itself still works: the rbtn drag handlers key
  // off grabMode (they were Stage 18) and the toggle restores input.
  assert(/if\(!grabMode\|\|pid!==null\) return; \/\/ locked: the press is a normal tap/.test(src), 'P2: rail-button dragging still runs off the grab flag');
  assert(/document\.body\.classList\.toggle\('grabbing',grabMode\)/.test(src) && /\$\('railgrab'\)\.onclick=\(\)=>setGrabMode\(!grabMode\)/.test(src), 'P2: the Grab chip still toggles the mode (off restores all input — every gate keys off the same flag)');

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
    const reg = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'S23Ann', password: 's23-pass-ann' }) }).then((r) => r.json());
    assert(reg.token && reg.profile && reg.profile.username === 'S23Ann', 'live: registration returns a profile with the new client live');
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
  console.log('ALL STAGE 23 TESTS PASSED');
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
