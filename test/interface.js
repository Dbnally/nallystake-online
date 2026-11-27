// Interface Overhaul tests: Derek's "Everything" choice (2026-11-18)
// replaced the online game's scrolling button rail + slide-in drawer
// with the app version's one-screen RuneScape-style interface: a
// FIXED panel dock (#paneldock) holding a corner pair (#dockhead:
// the ☰ master toggle + ❓ Help, small in the top-right corner), a
// slim chips row (#railchips: Grab / Menu tap / Camera) at the top
// of the side panel, a TAB BAR (#docktabs) with every panel exactly
// once, and the panel box (#dockpanel > #dockbody) where the active
// tab renders in place. Side-panel layout (2026-11-24, Derek): the
// dock is a vertical panel on the right side, scrolling vertically.
// Backpack / worn / skills / prayers are dock tabs like the rest —
// no drawer elements remain for them (or for anything).
//
// Coverage, in the house style of stages 18/23/24/25: source/wiring
// asserts on public/index.html, a parse of the inline script, a vm
// run of the settings-loading block against seeded legacy
// localStorage (the migration check), and a live smoke check that
// the server serves the new page byte-identically and welcomes a
// client. There is no DOM in this harness; the asserts pin every
// wiring site so a refactor can't drop one.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const WebSocket = require('ws');

const PORT = 18141;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-interface.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

function assert(cond, label) {
  if (!cond) throw new Error('ASSERT FAILED: ' + label);
  console.log('PASS ' + label);
}

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
    try { const r = await fetch(BASE + '/api/leaderboard'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not come up');
}
async function stopServer() {
  if (serverProc) { try { serverProc.kill('SIGKILL'); } catch { /* already gone */ } serverProc = null; }
  await new Promise((r) => setTimeout(r, 150));
}

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  /* ---------- the dock exists, as one fixed unit ---------- */
  const dockCss = (src.match(/#paneldock\{[^}]*\}/) || [''])[0];
  assert(/position:fixed/.test(dockCss) && /right:0/.test(dockCss) && /top:calc\(190px \+ env\(safe-area-inset-top,0px\)\)/.test(dockCss) && /bottom:calc\(100px \+ env\(safe-area-inset-bottom,0px\)\)/.test(dockCss) && /width:min\(250px,72vw\)/.test(dockCss), 'dock: #paneldock is the Menu SIDE panel — fixed to the right edge, starting below the minimap block and stopping above the bottom strip slot, phone-capped width, scrolling vertically (Side-panel layout 2026-11-24; narrowed 2026-11-27 per Derek so more of the gameplay shows)');
  assert(src.indexOf('id="paneldock"') >= 0 && src.indexOf('id="paneldock"') < src.indexOf('id="dockhead"') && src.indexOf('id="dockhead"') < src.indexOf('id="docktabs"') && src.indexOf('id="docktabs"') < src.indexOf('id="dockpanel"'), 'dock: one unit — #paneldock wraps #dockhead, then #docktabs, then #dockpanel');
  assert(/<div id="dockpanel"><h3><span id="docktitle">/.test(src) && /id="dockx"/.test(src) && /<div id="dockbody"><\/div>/.test(src), 'dock: the panel box carries its title, close button and body');
  assert(/#dockpanel\.open\{display:flex\}/.test(src) && /#dockbody\{[^}]*overflow-y:auto/.test(src), 'dock: the panel box shows in place (.open, a flex column since the 2026-11-23 panel-cap pass) and its body scrolls internally');

  /* ---------- the four always-on panels are dock tabs, not drawers ---------- */
  const tabsSeg = src.slice(src.indexOf('id="docktabs"'), src.indexOf('id="dockpanel"'));
  const PANELS = ['backpack', 'worn', 'shop', 'bank', 'exchange', 'prayers', 'spellbook', 'players', 'friends', 'admin', 'tools', 'skills', 'goals', 'smithy', 'teleport', 'settings']; // 'friends' added by the Friends list build (2026-11-23)
  for (const p of PANELS) {
    assert((tabsSeg.match(new RegExp(`data-panel="${p}"`, 'g')) || []).length === 1, `tabs: exactly one dock tab for "${p}"`);
  }
  for (const p of ['backpack', 'worn', 'skills', 'prayers']) {
    assert(new RegExp(`if\\(dockPanel==='${p}'\\)`).test(src), `tabs: renderDock dispatches "${p}" in the dock (no drawer involved)`);
  }
  for (const fn of ['pBackpack', 'pWorn', 'pSkills', 'pPrayers']) {
    assert(new RegExp(`function ${fn}\\(`).test(src), `tabs: renderer ${fn}() exists`);
  }

  /* ---------- no drawer / rail elements remain ---------- */
  assert(!/id="drawer"/.test(src) && !/id="drawerbody"/.test(src) && !/id="drawertitle"/.test(src) && !/id="drawerx"/.test(src), 'gone: no drawer elements (drawer/drawerbody/drawertitle/drawerx)');
  assert(!/\$\('drawer'\)/.test(src) && !/#drawer\{/.test(src) && !/#drawerbody/.test(src), 'gone: no drawer lookups or drawer CSS');
  assert(!/id="railset"/.test(src) && !/#railset/.test(src) && !/id="rail"/.test(src) && !/#rail\{/.test(src), 'gone: no rail / railset elements or CSS');
  assert(!/loopclone/.test(src) && !/buildRailLoop/.test(src) && !/railLoopCentre/.test(src) && !/syncRailCopies/.test(src), 'gone: the loop-scroll machinery (copies, recentring, copy sync) is removed');
  assert((src.match(/class="rbtn"/g) || []).length === 16, 'gone: exactly 16 tab buttons exist in the whole page — one set, no copies (Friends list, 2026-11-23, added the Friends tab)');

  /* ---------- re-homed features are present and wired ---------- */
  // Grab mode: chip, toggle, persisted positions applied to the dock tabs.
  assert(/id="railgrab"/.test(src) && /\$\('railgrab'\)\.onclick=\(\)=>setGrabMode\(!grabMode\)/.test(src), 'grab: the ✋ Grab chip still toggles Grab mode');
  assert(/const BTN_POS_KEY='nallystake_btn_pos'/.test(src) && /querySelectorAll\('#docktabs \.rbtn'\)/.test(src), 'grab: saved positions (nallystake_btn_pos) apply to the dock tabs');
  assert(/document\.addEventListener\('click',e=>\{\n if\(!grabMode\) return;/.test(src) && /closest\('#gearbtn,#railgrab'\)/.test(src), 'grab: the modal click gate is intact (gear + Grab chip only)');
  // Placed spell buttons.
  assert(/id="spellbtns"/.test(src) && /const SPELL_BTN_KEY='nallystake_spell_btns'/.test(src) && /function renderSpellBtns/.test(src) && /function wireSpellPlace/.test(src), 'spells: the placed-spell-button layer, its storage key and wiring survive');
  assert(/overSpellDropTarget/.test(src) && /\[data-panel="spellbook"\]/.test(src), 'spells: dragging a button back onto the spellbook tab still removes it');
  // Admin panel incl. City Ideas + Online-now Go to, and the Tools panel.
  assert(/function pAdmin\(\)/.test(src) && /type:'city_idea_post'/.test(src) && /type:'city_idea_cancel'/.test(src) && /cityideatext/.test(src) && /cityideaarea/.test(src), 'admin: the Admin panel keeps City Ideas (post + cancel)');
  assert(/window\.adminGoto=function\(name\)\{ send\(\{type:'admin_goto',to:name\}\)/.test(src), 'admin: the Online-now 🧭 Go to still sends admin_goto');
  /* ---------- Polish build (Derek, 2026-11-22): Help + camera + sign ----------
     The ❓ Help button beside the 🎛️ Menu toggle, the Help panel
     with its task walkthroughs, the three camera views (default
     zoomed out, camera-stays-put, wider first person, new
     over-the-shoulder), the wielded-weapon ready grip, and the
     Derek Nally sign + its read panel. */
  assert(/id="helpbtn"/.test(src) && src.includes('<span class="gbic">❓</span><span class="gblbl">Help</span>'), 'polish: the ❓ Help button carries glyph + word label like the Menu toggle (it is stored in the Menu Field buttons section since the 2026-11-24 field-buttons layout)');
  assert(src.includes("$('helpbtn').onclick=()=>togglePanel('help')"), 'polish: the Help button opens the Help panel in the dock');
  assert(/#helpbtn\{[^}]*min-width:38px/.test(src) && /#helpbtn\{[^}]*height:38px/.test(src), 'polish: the Help button is a compact 38px target, matching the Menu toggle (its stored form in #fieldrow widens to fit its word label)');
  const arvBody = src.slice(src.indexOf('function applyRailVisibility(){'), src.indexOf('function applyRailVisibility(){') + 700);
  assert(!arvBody.includes('helpbtn'), 'polish: applyRailVisibility never touches the Help button directly — Help lives in the Field buttons section, which follows the rail as a section');
  assert(/help:'❓ Help'/.test(src) && /dockPanel==='help'\) b\.innerHTML=pHelp\(\)/.test(src) && /function pHelp\(\)/.test(src), 'polish: the Help panel is a dock panel with the standard header (title + ‹ Tabs + ✕)');
  assert(/const HELP_TASKS=\[/.test(src) && /window\.helpTask=function/.test(src) && /window\.helpGo=function\(to\)\{ doTravel\(to\); \}/.test(src), 'polish: Help tasks expand in place, and "Take me there" rides the existing doTravel flow');
  for (const t of ['Win your first duel', 'Make your first gold', 'Beat a mod', 'Enter the Fight Caves', 'Run Barrows', 'Stay alive in the Wilderness', 'Get a tour from Muse']) assert(src.includes(t), `polish: the Help panel teaches "${t}"`);
  assert(/let camYaw=0\.7, camDist=42;/.test(src) && /camDist=clamp\(camDist\*pinchD\/d,10,64\)/.test(src) && /camDist=clamp\(camDist\+e\.deltaY\*0\.02,10,64\)/.test(src), 'polish + feel pass: the default third-person distance is 42 (was 30; 21 before the polish build) and pinch/wheel zoom out to 64 (was 42)');
  assert(!/CAM_BEHIND_RATE/.test(src) && !/localRot\+Math\.PI\)-camYaw/.test(src), 'polish: the camera-behind-facing ease is REMOVED — the camera stays where the player put it (Derek 2026-11-22)');
  assert(/const FOV_THIRD=55, FOV_SHOULDER=62, FOV_FIRST=78;/.test(src), 'polish: FOV per view — third 55, over-the-shoulder 62, first person widened to 78 (was the shared 55)');
  assert(/settings\.camPov!=='first'&&settings\.camPov!=='shoulder'\) settings\.camPov='third'/.test(src) && /\(v==='first'\|\|v==='shoulder'\)\? v : 'third'/.test(src), 'polish: shoulder is a saved POV value everywhere third/first are — old saves (first/third only) stay valid');
  assert(/settings\.camPov==='third'\?'shoulder':settings\.camPov==='shoulder'\?'first':'third'/.test(src), 'polish: the 🎥 chip cycles third → shoulder → first → third');
  assert(/'🎥 Shoulder'/.test(src) && /🎯 Over shoulder/.test(src) && /function povName\(p\)/.test(src), 'polish: the chip, the Settings seg and the camera-set rows all name the shoulder view');
  assert(/settings\.camPov==='shoulder'&&a\)\{/.test(src) && /const OTS_SIDE=1\.9;/.test(src) && /let otsDist=8;/.test(src), 'polish: the over-the-shoulder branch exists — close behind (8), offset 1.9 to the sword-arm side, my knight visible');
  assert(/const WEAPON_READY=-0\.62;/.test(src) && /a\.hasWeapon=!!\(w&&w\.weapon\)/.test(src), 'polish: a wielded weapon is held in a ready grip (poseWalk eases the weapon arm to WEAPON_READY when hasWeapon)');
  assert(/1\.35\*1\.18 : 1\.35/.test(src), 'polish: wielded weapons are built 1.35x bigger (on top of the two-handed 1.18) so a held sword reads at the wider default zoom');
  assert(/const NALLY_SIGN_POS=\{x:855,y:510\};/.test(src) && /function signFaceTexture\(\)/.test(src) && /fillText\('Derek',cx,300\)/.test(src) && /fillText\('Nally',cx,462\)/.test(src), 'polish: the Derek Nally sign stands by the spawn, its name painted into the canvas face texture');
  assert(/const signAct=\{type:'sign'\};/.test(src) && /act\.type==='sign'\)\{ openSignPanel\(\); return; \}/.test(src), 'polish: tapping the sign opens its read panel');
  assert(/function openSignPanel\(\)\{\s*send\(\{type:'sign_read'\}\);/.test(src) && /id="signmodal"/.test(src) && /id="signsheet"/.test(src), 'polish: opening the read panel sends sign_read and shows the sign modal');
  assert(/function castleWall\(/.test(src) && /function bannerTexture\(\)/.test(src), 'polish: castle walls with crenellations and crossed-swords banners dress the plaza edges');
  assert(/0x8fc3ea/.test(src) && /AmbientLight\(0xfff1d6,0\.62\)/.test(src), 'polish: the daylight rig is bright — sky-blue background, warmer/brighter ambient');
  // OSRS-basis duel presentation (Derek, 2026-11-22 — look only,
  // fighting unchanged): top-of-screen HP bar pair for duels and
  // mod fights, fed by the same tick numbers as the overhead bars.
  assert(/id="dueltop"/.test(src) && /id="dtmyfill"/.test(src) && /id="dtoppfill"/.test(src), 'osrs: the top duel HP bar pair exists (both fighters, name + bar + number)');
  assert(/function duelTopShow\(/.test(src) && /function duelTopUpdate\(/.test(src) && /function duelTopHide\(\)/.test(src), 'osrs: duelTop show/update/hide helpers exist');
  assert(/duelTopShow\(m\.opponent\)/.test(src) && /duelTopUpdate\(m\.hpYou,m\.hpOpponent\)/.test(src), 'osrs: player duels show + feed the top bars from duel ticks');
  assert(/duelTopShow\(m\.name\|\|'Mod'\)/.test(src) && /duelTopUpdate\(m\.hpYou,m\.hpNpc\)/.test(src), 'osrs: mod ladder fights show + feed the top bars too');
  assert((src.match(/duelTopHide\(\)/g) || []).length >= 3, 'osrs: the top bars hide when a duel / mod fight ends');
  // the crowd: low-poly spectators + barrier rails at the dais and
  // in the arenas (static dressing, from Derek's duel video)
  assert(/function spectatorFigure\(/.test(src) && /function barrierRun\(/.test(src) && /function crowdRow\(/.test(src), 'osrs: spectator / barrier / crowd-row builders exist');
  assert(/crowdRow\(scene,-9\.5,-38\.6/.test(src), 'osrs: a crowd row watches the tournament dais from behind its fence');
  assert(/barrierRun\(S,-46,-38\.5,46,-38\.5\)/.test(src) && /crowdRow\(S,-44,-41\.4,44,-41\.4/.test(src), 'osrs: every duel arena has a barrier rail + crowd along the north wall');
  assert(/CylinderGeometry\(0\.315,0\.50,1\.30,6,1,true/.test(src), 'osrs: the cape shell is faceted low-poly (6 segments), not smoothed');
  assert(/id="toolsbtn"/.test(src) && /function pTools\(\)/.test(src) && /function refreshToolsBtn/.test(src) && /type:'ref_lists'/.test(src), 'tools: the 🛠️ Tools tab, its admin gating and reference lists survive');
  // Settings incl. camera sets, tap modes, ground tap, fight-feel toggles.
  assert(/function pSettings\(\)/.test(src) && /window\.saveCamSet=function/.test(src) && /window\.useCamSet=function/.test(src) && /settings\.camSets/.test(src), 'settings: Camera sets survive in the Settings panel');
  assert(/window\.setTapMode=function/.test(src) && /window\.setGroundTap=function/.test(src) && /window\.setSoundOn=function/.test(src) && /window\.setShakeOn=function/.test(src), 'settings: tap mode, ground tap, fight sounds and camera shake setters survive');
  assert(/id="railmenutap"/.test(src) && /id="railcam"/.test(src) && /window\.toggleCamPov=function/.test(src), 'settings: the Menu tap and 🎥 POV chips live in #railchips at the top of the side panel and stay wired');
  // The 🎛️ master toggle: hides tabs + chips, persists, never hides itself.
  assert(/id="gearbtn"/.test(src) && /\$\('gearbtn'\)\.onclick=\(\)=>toggleRail\(\)/.test(src) && /localStorage\.setItem\('nallystake_rail_open'/.test(src), 'master toggle: 🎛️ still show/hides the dock chrome and persists the choice');
  assert(/const rs=\$\('docktabs'\); if\(rs\) rs\.classList\.toggle\('open',railOpen\)/.test(src), 'master toggle: the toggle drives the tab bar (an open panel box is untouched by it)');
  // Chat: minimized by default, log + outbox.
  assert(/<div id="chatbox" class="closed">/.test(src) && /id="log"/.test(src) && /let chatOutbox=\[\]/.test(src) && /function flushChatOutbox/.test(src), 'chat: minimized by default, with the log and the Stage 35 outbox intact');
  // World controls: minimap tap-to-walk, sticks, run orb, quick sets.
  assert(/id="minimap"/.test(src) && src.includes("$('minimap').addEventListener('pointerdown'"), 'world: the tap-to-walk minimap survives');
  assert(/id="joy"/.test(src) && /id="camstick"/.test(src) && /id="orbrun"/.test(src) && /id="quick1"/.test(src) && /id="quick2"/.test(src), 'world: joystick, camera stick, run orb and item quick sets survive');
  assert(src.includes("$('orbpr').onclick=()=>togglePanel('prayers')"), 'world: the prayer orb still opens the Prayers tab in the dock');
  // Goals / boards / collection log.
  assert(/function pGoals\(\)/.test(src) && /Collection Log/.test(src) && /function pPlayers\(\)/.test(src) && /function fetchBoards\(\)/.test(src), 'panels: goals + collection log and the players/boards panel survive');

  /* ---------- clear-screen combat: the fight strip is untouched ---------- */
  assert((src.match(/id="duelbar"/g) || []).length === 1 && (src.match(/id="fcbar"/g) || []).length === 1, 'fight: exactly one duel strip and one Fight Caves strip');
  const duelCss = (src.match(/#duelbar\{[^}]*\}/) || [''])[0];
  assert(/position:fixed/.test(duelCss) && /bottom:calc\(38px \+ env\(safe-area-inset-bottom,0px\)\)/.test(duelCss) && /flex-wrap:nowrap/.test(duelCss) && /overflow-x:auto/.test(duelCss), 'fight: the duel strip is still the single slim full-width strip pinned above the chat bar');
  assert(/id="atkchip"/.test(src) && /id="fcatkchip"/.test(src), 'fight: the duel / caves Attack chips survive');

  /* ---------- Placed-button fix: placed tabs outlive the 🎛️ hide ----------
     Derek (2026-11-21): a tab dragged out of the dock and placed
     on screen must STAY in its spot when the rest of the buttons
     are hidden, and dragging it back onto the reopened dock must
     remove it. Mechanism: a placed tab is reparented out of
     #docktabs into the top-level #placedtabs layer (the Stage 24
     spell-button pattern), so the tab bar's display:none can never
     reach it; a Grab drop on the open dock deletes its saved spot
     and applyBtnPositions carries it home to its canonical slot. */
  assert(/<div id="placedtabs"><\/div>/.test(src), 'placed: the #placedtabs layer exists in the page');
  const placedCss = (src.match(/#placedtabs\{[^}]*\}/) || [''])[0];
  assert(/position:fixed/.test(placedCss) && /inset:0/.test(placedCss) && /pointer-events:none/.test(placedCss), 'placed: the layer is a fixed full-screen shell that never eats taps itself');
  assert(/#placedtabs \.rbtn\{pointer-events:auto;touch-action:none\}/.test(src), 'placed: tabs living in the layer take their own taps and drags');
  assert(/body\.grabbing #docktabs \.rbtn,body\.grabbing #placedtabs \.rbtn/.test(src), 'placed: Grab mode outlines placed tabs exactly like dock tabs');
  const applyPosBody = src.slice(src.indexOf('function applyBtnPositions(){'), src.indexOf('// grabMode is declared'));
  assert(applyPosBody.includes('layer.appendChild(b)') && applyPosBody.includes("b.classList.add('placed')"), 'placed: applyBtnPositions moves a tab with a saved spot OUT of the tab bar into the layer');
  assert(applyPosBody.includes('dockTabHome(b)') && applyPosBody.includes("b.style.position=''"), 'placed: applyBtnPositions returns an un-placed tab to the bar with its fixed positioning cleared');
  assert(/const DOCK_TAB_ORDER=\[\.\.\.document\.querySelectorAll\('#docktabs \.rbtn'\)\]/.test(src) && /function dockTabHome\(b\)/.test(src), 'placed: the canonical dock order is captured before any placement, so returns land in the authored slot');
  assert(/querySelectorAll\('#docktabs \.rbtn, #placedtabs \.rbtn'\)/.test(src), 'placed: the position pass and the Settings hidden-tab pass cover tabs in both homes');
  assert(!/\$\('placedtabs'\)\.style/.test(src), 'placed: nothing ever sets inline style on the layer itself — it cannot be hidden or moved');
  assert(/document\.querySelectorAll\('\.rbtn'\)\.forEach\(b=>b\.onclick/.test(src), 'placed: tab clicks bind globally (.rbtn), so a placed tab still opens its panel while the dock is hidden');
  assert(/function overDock\(x,y\)/.test(src) && /railOpen&&overDock\(e\.clientX,e\.clientY\)/.test(src), 'placed: a return drop only counts on the OPEN dock (reopen, then drag back — Derek\'s flow)');
  assert(/delete pos\[b\.dataset\.panel\]/.test(src), 'placed: dropping on the dock deletes the saved spot itself, not just the styling');
  assert(/e\.type==='pointerup'&&typeof e\.clientX==='number'/.test(src), 'placed: only a real pointer-up drop returns a tab — a cancelled drag just moves it');
  assert(/setDockDropHighlight\(true\)/.test(src) && /setDockDropHighlight\(false\)/.test(src), 'placed: the tab bar glows as a drop target during a Grab drag and clears afterwards');
  assert(/pos\[b\.dataset\.panel\]=\{l:Math\.round\(r\.left\),t:Math\.round\(r\.top\)\}/.test(src), 'placed: a move still saves the same {l,t} entry shape under nallystake_btn_pos (old saves keep working)');

  /* ---------- Field buttons stored in the Menu (Derek, 2026-11-24) ----------
     "The green buttons need to be stored in the red one so I can
     customize it — when it opens they all are movable; when closing
     the menu it locks all the buttons outside of the menu in place."
     Help + the quick buttons (quick sets, AWAKEN, JUMP) live in the
     Menu's #fieldbtns section by default, so the field is clean and
     the corner keeps only the small ☰ Menu button. While the Menu
     is open they drag out onto the field (spots persist in the same
     BTN_POS_KEY store under 'fb:' keys); when the Menu closes, a
     placed button locks in place — tappable for its job, never
     draggable. */
  const fbSeg = src.slice(src.indexOf('id="fieldbtns"'), src.indexOf('id="docktabs"'));
  assert(fbSeg.includes('id="helpbtn"') && fbSeg.includes('id="quick1"') && fbSeg.includes('id="quick2"') && fbSeg.includes('id="awakenbtn"') && fbSeg.includes('id="jumpbtn"'), 'fieldbtns: Help and all four quick buttons are authored inside the Menu section, not on the field');
  const headSeg = src.slice(src.indexOf('id="dockhead"'), src.indexOf('id="railchips"'));
  assert(headSeg.includes('id="gearbtn"') && !headSeg.includes('helpbtn') && !headSeg.includes('quick'), 'fieldbtns: the corner #dockhead holds ONLY the small Menu button');
  assert(/const FIELD_BTNS=\['helpbtn','quick1','quick2','awakenbtn','jumpbtn'\]/.test(src), 'fieldbtns: the field-button registry names exactly Help + the four quick buttons');
  assert(/fbs\.classList\.toggle\('open',railOpen\)/.test(src) && /#fieldbtns\.open\{display:flex\}/.test(src), 'fieldbtns: the stored section follows the rail — it shows only while the Menu is open');
  const afbBody = src.slice(src.indexOf('function applyFieldBtnPositions(){'), src.indexOf('function applyFieldBtnPositions(){') + 700);
  assert(/function applyFieldBtnPositions\(\)/.test(src) && afbBody.includes("pos['fb:'+id]") && afbBody.includes('layer.appendChild(b)'), 'fieldbtns: a saved fb: spot moves the button into the #placedtabs layer, in the shared BTN_POS_KEY store');
  const fbBlock = src.slice(src.indexOf('const FIELD_BTNS='), src.indexOf('const FIELD_BTNS=') + 6000);
  assert(fbBlock.includes('if(!railOpen||pid!==null) return;'), 'fieldbtns: LOCKED when the Menu is closed — the drag press is ignored, so a tap still fires the job and a drag cannot start');
  assert(fbBlock.includes("pos['fb:'+id]={l:Math.round(r.left),t:Math.round(r.top)}"), 'fieldbtns: dragging out while the Menu is open persists the spot under fb:<id>');
  assert(fbBlock.includes("delete pos['fb:'+id]") && fbBlock.includes('fieldBtnHome'), 'fieldbtns: dropping back on the open Menu stores the button again (fb: spot deleted, element carried home)');
  assert(/#placedtabs \.fbtn\{pointer-events:auto;touch-action:none\}/.test(src), 'fieldbtns: a placed field button still takes its own taps on the field');

  /* ---------- Always-on bottom bar (Derek, 2026-11-21) ----------
     "I want the backpack and attack styles to stay in the bottom
     corner and the melee magic and ranger deflect to be at the
     bottom too so plays always has access." Mechanism: a NEW slim
     strip #bottombar pinned in the fight-strip slot (bottom:
     calc(38px + safe-area), the exact #duelbar/#fcbar slot) holding
     🎒 + the 4 styles + the 3 Deflects. It is NOT a dock tab (no
     .rbtn, lives outside #paneldock), so the 🎛️ hide, Grab mode
     and the placed-tab logic can never touch it. The ONE-STRIP
     merge: when a fight strip opens in the same slot, it carries
     its own copies of these controls (backpack + styles added to
     both strips by this build; the Deflect chips were already
     there) and #bottombar hides — syncBottomBar() shows it only
     when logged in AND no fight strip is open, and a
     MutationObserver on both strips' class keeps that true for
     every fight open/close path without editing them all. State
     is the server's alone: lit style = me.style, lit Deflect =
     me.activePrayer, buttons send the exact {type:'style'} /
     {type:'prayer'} messages the challenge screen / Prayers panel
     send — no client-only state to fake a refused prayer with. */
  assert(/<div id="bottombar">/.test(src), 'bottombar: the always-on bottom bar exists');
  const dockBlock = src.slice(src.indexOf('id="paneldock"'), src.indexOf('id="placedtabs"'));
  assert(!dockBlock.includes('bottombar') && !dockBlock.includes('bbpray') && !dockBlock.includes('bbpack'), 'bottombar: the bar lives OUTSIDE #paneldock/#docktabs — the 🎛️ toggle and placed-tab logic cannot reach it');
  const bbCss = (src.match(/#bottombar\{[^}]*\}/) || [''])[0];
  assert(/position:fixed/.test(bbCss) && /bottom:calc\(38px \+ env\(safe-area-inset-bottom,0px\)\)/.test(bbCss) && /display:none/.test(bbCss) && /overflow-x:auto/.test(bbCss), 'bottombar: fixed in the fight-strip slot (bottom: calc(38px + safe-area)), hidden until synced open, sideways-scrollable like the fight strips');
  assert(/#bottombar\.open\{display:flex\}/.test(src) && /#bottombar>\*\{flex:none\}/.test(src), 'bottombar: .open shows it as a flex row of non-shrinking chips (the fight-strip pattern)');
  assert(/id="bbstyles"/.test(src) && /#bbstyles,#duelstyles,#fcstyles\{display:contents\}/.test(src), 'bottombar: the style groups flatten into the strip row (display:contents, one row only) — Picture look (2026-11-26): the bottom bar keeps the styles only; its Deflect group moved to the Prayers card');
  assert(!src.includes('id="bbpack"') && src.includes('class="fchip pack" id="duelpack"') && src.includes('class="fchip pack" id="fcpack"') && src.includes('id="clpack"'), 'bottombar: the 🎒 Backpack chip lives in both fight strips and in the round action cluster (Picture look 2026-11-26) — the styles-only bottom bar no longer carries one');
  for (const s of ['accurate', 'aggressive', 'defensive', 'controlled']) {
    assert((src.match(new RegExp(`class="fchip sty" data-style="${s}"`, 'g')) || []).length === 3, `bottombar: the ${s} style chip exists in all three strips (bottom bar, duel bar, Fight Caves bar)`);
  }
  for (const pr of ['melee', 'missiles', 'magic']) {
    assert(src.includes(`class="ppbtn" id="ppray-${pr}"`), `picture: the ${pr} Deflect button exists in the bottom-left Prayers card (Picture look 2026-11-26)`);
  }
  assert(/function anyFightStripOpen\(\)\{ return \$\('duelbar'\)\.classList\.contains\('open'\)\|\|\$\('fcbar'\)\.classList\.contains\('open'\); \}/.test(src), 'bottombar: one-strip rule — fight-strip openness is read from #duelbar/#fcbar themselves');
  assert(/bb\.classList\.toggle\('open',!!me&&!anyFightStripOpen\(\)\)/.test(src), 'bottombar: the bar shows only when logged in AND no fight strip holds the slot');
  assert(/new MutationObserver\(syncBottomBar\)\.observe\(el,\{attributes:true,attributeFilter:\['class'\]\}\)/.test(src), 'bottombar: a MutationObserver on both fight strips re-syncs the bar on every fight open/close, whichever handler caused it');
  assert(/function renderAll\(\)\{[^}]*syncBottomBar\(\); \}/.test(src), 'bottombar: renderAll (the profile/state re-render hub) re-syncs the bar, so server state changes land on it');
  assert((src.match(/syncCombatControls\(\); \/\/ bottom-bar build/g) || []).length === 3, 'bottombar: renderDuelBar, renderWildBar and renderFcBar each re-sync the shared combat controls');
  assert(/document\.querySelectorAll\('\.fchip\.sty'\)\.forEach\(b=>b\.classList\.toggle\('on',!!me&&me\.style===b\.dataset\.style\)\)/.test(src), 'bottombar: the lit style is me.style (server state) across every strip at once');
  assert(/document\.querySelectorAll\('\.fchip\.sty'\)\.forEach\(b=>b\.onclick=\(\)=>\{ if\(me&&me\.style!==b\.dataset\.style\) send\(\{type:'style',style:b\.dataset\.style\}\); \}\)/.test(src), 'bottombar: style chips send the exact {type:style} message the challenge-screen select sends, only on a real change');
  assert(/const b=\$\('ppray-'\+pr\); if\(b\) b\.onclick=\(\)=>send\(\{type:'prayer',prayer:pr\}\)/.test(src), 'picture: the Prayers card Deflect buttons send the exact {type:prayer} message the Prayers panel and fight chips send');
  assert(/for\(const pr of \['melee','missiles','magic'\]\)\{ const b=\$\('ppray-'\+pr\); if\(b\) b\.classList\.toggle\('on',!!me&&me\.activePrayer===pr\); \}/.test(src), 'picture: the lit Prayers-card Deflect is me.activePrayer (server state) — a refused prayer never lights up');
  assert(/document\.querySelectorAll\('\.fchip\.pack'\)\.forEach\(b=>b\.onclick=\(\)=>togglePanel\('backpack'\)\)/.test(src), 'bottombar: every 🎒 chip opens/closes the backpack through togglePanel — the same dock mechanism as the Backpack tab, working while the dock is hidden');
  assert(!src.slice(src.indexOf('<div id="bottombar">'), src.indexOf('id="barrowsbar"')).includes('rbtn'), 'bottombar: no bar button is a dock .rbtn — Grab mode cannot drag it and the rail toggle cannot hide it');

  /* ---------- Stage 36: grabMode declared before its first frame use ---------- */
  const i36 = src.indexOf('Stage 36 fix');
  const iDecl = src.indexOf('let grabMode=false;');
  const iInit = src.indexOf('initThree();');
  assert(i36 >= 0 && iDecl > i36 && iInit > iDecl, 'stage36: comment < grabMode declaration < initThree() — the TDZ freeze cannot come back');

  /* ---------- Stage 41: the first frame is scheduled, never synchronous ----------
     The live game was black-screened by a Stage 36-class TDZ bug:
     initThree() called animate() synchronously during script load,
     and animate() (via Stage 37b's fightOppAvatar) read `duel`,
     `npcFight` and `fcRun` — all declared AFTER the initThree()
     call site. Both halves of the fix are pinned here. */
  const initThreeBody = src.slice(src.indexOf('function initThree(){'), src.indexOf('initThree();'));
  assert(initThreeBody.includes('requestAnimationFrame(animate);'), 'stage41: initThree schedules the first frame with requestAnimationFrame');
  assert(!/^\s*animate\(\);/m.test(initThreeBody), 'stage41: initThree never calls animate() synchronously during script load');
  for (const v of ['grabMode', 'duel', 'npcFight', 'fcRun']) {
    const d = src.indexOf(`let ${v}=`);
    assert(d >= 0 && d < iInit, `stage41: "let ${v}" is declared before the initThree() call site`);
    assert((src.match(new RegExp(`let ${v}=`, 'g')) || []).length === 1, `stage41: "let ${v}" is declared exactly once`);
  }

  /* ---------- saved setups migrate: legacy localStorage still loads ---------- */
  assert(/const SETTINGS_KEY='nallystake_settings_v1'/.test(src) && /const HIGHLIGHT_KEY='nallystake_highlights_v1'/.test(src) && /'nallystake_session'/.test(src), 'storage: the settings / highlights / session keys are unchanged');
  const block = src.slice(src.indexOf("const SETTINGS_KEY='nallystake_settings_v1';"), src.indexOf('function applyRailVisibility(){'));
  assert(block.includes('let grabMode=false;') && block.includes("localStorage.getItem('nallystake_rail_open')"), 'storage: the extracted load block covers settings, the rail-open choice and grabMode');
  const store = {
    nallystake_settings_v1: JSON.stringify({ camSpeed: 2.5, tapMode: 'walk', camPov: 'first', run: false, soundOn: false, hidden: { shop: true }, camSets: [{ pov: 'first', pitch: 1.1, speed: 2 }, null, null] }),
    nallystake_rail_open: '0',
  };
  const sandbox = {
    console,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  };
  vm.createContext(sandbox);
  // `let` bindings don't land on the vm global, so the probe line
  // runs inside the same script and copies them out.
  vm.runInContext('var __out=null;\n' + block + '\n__out={settings,railOpen,grabMode};', sandbox);
  const loaded = sandbox.__out;
  assert(loaded && loaded.settings, 'migration: the settings load block executes against seeded storage');
  assert(loaded.settings.camSpeed === 2.5 && loaded.settings.camPov === 'first' && loaded.settings.run === false && loaded.settings.soundOn === false, 'migration: saved camera/run/sound choices survive the load');
  assert(loaded.settings.groundTap === 'walk' && loaded.settings.tapMode === 'normal', 'migration: the Stage 18 legacy tapMode ("walk") still migrates to groundTap, not lost');
  assert(loaded.settings.hidden.shop === true && loaded.settings.camSets[0].pitch === 1.1, 'migration: hidden-tab choices and Camera sets survive');
  assert(loaded.railOpen === false, 'migration: a saved "tabs hidden" choice (nallystake_rail_open=0) still loads');
  assert(loaded.grabMode === false, 'migration: grabMode initialises in the same block (Stage 36 ordering, executed)');

  /* ---------- Navigation pass (Derek, 2026-11-22) ----------
     "Make the interface so that it is easier to navigate." What
     the audit found: tabs were icon-only 46×46 (names only in
     hover titles, invisible on touch); the 🎛️ toggle was a bare
     glyph; panels had a title + ✕ but no way back to the tab
     grid (and a panel opened while the dock was hidden — placed
     tab, bottom-bar 🎒, prayer orb — had no grid on screen at
     all); the dock already defaulted OPEN for a fresh browser
     but nothing ever told a new player it existed; fight-strip
     chips were ~28px tall. The pass: a text label under every
     tab icon, a "Menu" word on the 🎛️ toggle, a "‹ Tabs" back
     button in every panel header, ~40px tap targets, a one-time
     first-login chat hint, and the selected spell's row lit. */
  const NAV_LABELS = { backpack: 'Backpack', worn: 'Worn', shop: 'Shops', bank: 'Bank', exchange: 'Exchange', prayers: 'Prayers', spellbook: 'Spells', players: 'Players', friends: 'Friends', admin: 'Admin', tools: 'Tools', skills: 'Skills', goals: 'Goals', smithy: 'Smithy', teleport: 'Teleport', settings: 'Settings' }; // friends label added by the Friends list build (2026-11-23)
  for (const p of PANELS) {
    assert(tabsSeg.includes(`data-panel="${p}"`) && tabsSeg.includes(`<span class="tlbl">${NAV_LABELS[p]}</span>`), `nav: the "${p}" tab carries its visible text label ("${NAV_LABELS[p]}")`);
  }
  assert((src.match(/class="tic"/g) || []).length === 16 && (src.match(/class="tlbl"/g) || []).length === 16, 'nav: every one of the 16 tabs is icon span + label span — the label lives INSIDE the button, so a placed tab keeps its label when Grab drags it out of the dock (16 since the Friends tab, 2026-11-23)');
  const rbtnCss = (src.match(/\.rbtn\{[^}]*\}/) || [''])[0];
  assert(/width:48px/.test(rbtnCss) && /height:46px/.test(rbtnCss) && /flex-direction:column/.test(rbtnCss), 'nav: tabs are 48×46 icon-over-label buttons (shrunk 2026-11-27 per Derek — smaller overlap tabs, more gameplay visible; still ≥40px targets)');
  assert(/#docktabs \.rbtn\{width:auto;height:48px\}/.test(src) && /#docktabs \.rbtn \.tlbl\{font-size:10px\}/.test(src) && /\.dockgroup\{display:grid;grid-template-columns:repeat\(2,1fr\)/.test(src), 'mobile: in the side panel the tabs are full-width tiles in a grid — 48px tall, 10px labels, 2 per row at the panel width (Side-panel layout 2026-11-24; tiles shrunk 2026-11-27)');
  assert(/\.rbtn \.tlbl\{[^}]*font-size:9px/.test(src) && /\.rbtn \.tlbl\{[^}]*white-space:nowrap/.test(src), 'nav: tab labels are 9px, single-line — no truncation or wrapping at dock width');
  assert(src.includes('<span class="gbic">☰</span><span class="gblbl">Menu</span>'), 'nav: the master toggle is the ☰ Menu button — labelled "Menu" in words beside its glyph');
  assert(/gb\.querySelector\('\.gbic'\)/.test(src) && !/gb\.textContent=railOpen/.test(src), 'nav: applyRailVisibility swaps only the .gbic glyph (🎛️/✕) — the "Menu" label is never wiped');
  assert(/id="dockback"/.test(src) && src.includes('‹ Menu'), 'nav: every panel header carries the "‹ Menu" back button beside the ✕ (Mobile layout: the grid it returns to is the Menu)');
  assert(/window\.backToTabs=function\(\)\{ closeDock\(\); if\(!railOpen\)\{ railOpen=true;/.test(src) && /\$\('dockback'\)\.onclick=\(\)=>backToTabs\(\)/.test(src), 'nav: backToTabs closes the panel and, if the panel was opened while the dock was hidden, reopens the tab bar (persisted like the 🎛️ toggle) — no panel is a dead end');
  assert(/#dockpanel h3 #dockback\{margin-left:auto/.test(src), 'nav: the back button clusters with the ✕ at the header\'s right edge');
  const fchipCss = (src.match(/\.fchip\{[^}]*\}/) || [''])[0];
  assert(/min-height:40px/.test(fchipCss), 'nav: fight-strip / bottom-bar chips are ≥40px tall (up from ~28px)');
  const fcprayCss = (src.match(/\.fcpray\{[^}]*\}/) || [''])[0];
  assert(/min-height:40px/.test(fcprayCss), 'nav: Fight Caves prayer chips are ≥40px tall (up from ~30px)');
  assert(/\.railchip\{[^}]*min-height:32px/.test(src), 'nav: the side-panel chips (Grab / Menu tap / Camera) are a slim 32px row at the top of the panel (Side-panel layout 2026-11-24)');
  assert(/#dockpanel h3 \.x\{[^}]*min-height:38px/.test(src) && /#dockpanel h3 \.x\{[^}]*min-width:38px/.test(src), 'nav: the panel header buttons (‹ Menu / ✕) have a real hit area (38px, up from ~22px)');
  assert(/let railFirstRun=false, navHintDone=false;/.test(src) && /railFirstRun=localStorage\.getItem\('nallystake_rail_open'\)===null/.test(src), 'nav: first-run detection rides the existing rail_open key — never written means this device has never seen the dock');
  assert(/if\(railFirstRun&&!navHintDone\)\{ navHintDone=true; railFirstRun=false;/.test(src) && /logLine\('👋 New here\? Everything lives in the dock/.test(src), 'nav: the first welcome on a fresh device logs the one-line dock hint, exactly once (navHintDone guard covers reconnects)');
  assert(/\.rowline\.sel\{border-color:#c9a227;background:#3a2c1c\}/.test(src) && /rowline\$\{sel\?' sel':''\}/.test(src), 'nav: the selected spell\'s spellbook row is lit gold like a selected backpack cell');
  // First-run behaviour, executed: the load block against an
  // EMPTY store (a brand-new device) must flag railFirstRun, and
  // against a store that already holds the key it must not.
  const freshSandbox = { console, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  vm.createContext(freshSandbox);
  vm.runInContext('var __nav=null;\n' + block + '\n__nav={railOpen,railFirstRun};', freshSandbox);
  assert(freshSandbox.__nav.railOpen === true && freshSandbox.__nav.railFirstRun === true, 'nav: on a fresh device the dock starts OPEN and the first-run hint is armed');
  const seenSandbox = { console, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), localStorage: { getItem: (k) => (k === 'nallystake_rail_open' ? '1' : null), setItem: () => {}, removeItem: () => {} } };
  vm.createContext(seenSandbox);
  vm.runInContext('var __nav=null;\n' + block + '\n__nav={railOpen,railFirstRun};', seenSandbox);
  assert(seenSandbox.__nav.railFirstRun === false, 'nav: once the rail_open key exists, the hint never arms again');

  /* ---------- Interface simplification (Derek, 2026-11-23) ----------
     "Re organize the interface to be simple." Same features, same
     places — the 15 dock tabs now sit in four labelled groups
     (Play / World / People / System) instead of one flat scatter,
     the dock head row is one even 46px row, and ONE context prompt
     chip appears above the bottom bar only when the next action is
     obvious (at the bank chest / a shop stall) — never in a fight.
     No control moved screen edges, none was removed, no new
     localStorage keys, groups never collapse. */
  const GROUP_ORDER = ['play', 'world', 'people', 'system'];
  const GROUP_HEADS = { play: 'Play', world: 'World', people: 'People', system: 'System' };
  const GROUP_TABS = { play: ['backpack', 'worn', 'skills', 'prayers', 'spellbook'], world: ['shop', 'bank', 'exchange', 'smithy', 'teleport'], people: ['players', 'friends', 'goals'], system: ['admin', 'tools', 'settings'] }; // 'friends' in People (Friends list, 2026-11-23)
  assert((src.match(/class="dockgroup"/g) || []).length === 4, 'simple: exactly four tab groups wrap the dock tabs');
  let lastGroupIdx = -1;
  for (const g of GROUP_ORDER) {
    const gi = src.indexOf(`<div class="dockgroup" data-group="${g}">`);
    assert(gi > lastGroupIdx, `simple: the "${g}" group exists, in Play/World/People/System order`);
    lastGroupIdx = gi;
    assert(src.includes(`<div class="ghead">${GROUP_HEADS[g]}</div>`), `simple: the "${g}" group carries its quiet word header ("${GROUP_HEADS[g]}")`);
  }
  assert(!(src.match(/<button class="ghead"/g) || []).length, 'simple: group headers are plain text divs, never buttons — nothing about them is tappable or collapsible');
  assert(!/collapsedGroups|toggleGroup|groupOpen/.test(src), 'simple: groups are always expanded — no collapse state exists anywhere');
  // Membership: each group's slice of the tab bar holds exactly its tabs.
  for (let i = 0; i < GROUP_ORDER.length; i++) {
    const g = GROUP_ORDER[i];
    const start = tabsSeg.indexOf(`data-group="${g}"`);
    const end = i + 1 < GROUP_ORDER.length ? tabsSeg.indexOf(`data-group="${GROUP_ORDER[i + 1]}"`) : tabsSeg.length;
    const gSeg = tabsSeg.slice(start, end);
    const found = [...gSeg.matchAll(/data-panel="([a-z]+)"/g)].map((m) => m[1]);
    assert(JSON.stringify(found) === JSON.stringify(GROUP_TABS[g]), `simple: the "${g}" group holds exactly ${GROUP_TABS[g].join('/')} in order`);
  }
  // The canonical order IS the grouped order (what DOCK_TAB_ORDER captures).
  const tabOrderInPage = [...tabsSeg.matchAll(/data-panel="([a-z]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(tabOrderInPage) === JSON.stringify(GROUP_ORDER.flatMap((g) => GROUP_TABS[g])), 'simple: the authored tab order is the grouped order, so DOCK_TAB_ORDER (and every return home) follows the groups');
  assert(/const DOCK_GROUPS=\{play:\['backpack','worn','skills','prayers','spellbook'\],world:\['shop','bank','exchange','smithy','teleport'\],people:\['players','friends','goals'\],system:\['admin','tools','settings'\]\};/.test(src), 'simple: the DOCK_GROUPS map in the script matches the authored groups exactly (people gained friends, 2026-11-23)');
  const homeBody = src.slice(src.indexOf('function dockTabHome(b){'), src.indexOf('function applyBtnPositions(){'));
  assert(homeBody.includes(`.dockgroup[data-group="`) && homeBody.includes('grp.insertBefore(b,sib)') && homeBody.includes('grp.appendChild(b)'), 'simple: dockTabHome returns a placed tab into its OWN group, at its canonical spot among that group\'s tabs');
  assert(/function syncDockGroupHeads\(\)/.test(src) && /refreshToolsBtn\(\);\n syncDockGroupHeads\(\);/.test(src) && /tb\.style\.display=\(isAdminOrOwner\(\)&&!settings\.hidden\.tools\)\?'':'none';\n syncDockGroupHeads\(\);/.test(src), 'simple: group headers re-sync wherever tab visibility is decided (rail visibility + the Tools gate) — a header never floats over an empty group');
  assert(/#dockhead\{display:flex;flex-direction:column;gap:6px/.test(src) && /\.railchip\{[^}]*height:32px/.test(src), 'simple: the corner holds the one small Menu button beside the minimap, and the chips are a slim 32px row at the top of the side panel');
  // The context prompt chip: element, look, and full show/hide logic.
  assert((src.match(/id="promptchip"/g) || []).length === 1 && /<div id="promptchip"><\/div>/.test(src), 'simple: exactly one prompt chip element exists');
  const pcCss = (src.match(/#promptchip\{[^}]*\}/) || [''])[0];
  assert(/position:fixed/.test(pcCss) && /bottom:calc\(100px \+ env\(safe-area-inset-bottom,0px\)\)/.test(pcCss) && /pointer-events:none/.test(pcCss) && /display:none/.test(pcCss), 'simple: the chip floats centred just above the bottom bar, hidden by default, and can never be tapped (it is a hint, not a button)');
  assert(/#promptchip\.open\{display:block\}/.test(src), 'simple: the chip shows only via its .open class');
  assert(!/\$\('promptchip'\)\.onclick/.test(src) && !/promptchip'\)\.addEventListener/.test(src), 'simple: nothing binds a tap on the prompt chip — the chest/stall tap does the action');
  assert(/const PROMPT_RANGE=80;/.test(src) && /function updatePromptChip\(\)/.test(src) && /stepMovement\(dt\);\n stepFlyFx\(now\);[^\n]*\n updatePromptChip\(\);/.test(src), 'simple: updatePromptChip runs on the frame loop right after movement (the Rat Cave spell-bolt step sits between them — pin relaxed 2026-11-24 for that insertion, order still asserted), with an 80-unit prompt range');
  const pcBody = src.slice(src.indexOf('function updatePromptChip(){'), src.indexOf('/* ================= chat ================= */'));
  assert(pcBody.includes("curArea==='plaza'&&!grabMode&&!railOpen&&!dockPanel&&!(duel||modDuel||npcFight||fcRun||wildFight)"), 'simple: the chip is plaza-only, suppressed while arranging (Grab) or while the Menu sheet / any panel is open (Mobile layout 2026-11-24 — the chip never renders over the sheet), and NEVER shows during any fight — duel, mod duel, NPC fight, Fight Caves or Wilderness (clear-screen combat rule)');
  assert(pcBody.includes("dockPanel!=='bank'&&Math.hypot(myPos.x-BANK_POS.x,myPos.y-BANK_POS.y)<=PROMPT_RANGE") && pcBody.includes("want='🧰 Tap the chest to bank'"), 'simple: standing at the bank chest (with the bank not already open) prompts "🧰 Tap the chest to bank"');
  assert(pcBody.includes("dockPanel!=='shop'") && pcBody.includes('for(const s of SHOP_SPOTS)') && pcBody.includes("want='🛒 Tap the stall to shop'"), 'simple: standing at any of the four shop stalls (with the shop not already open) prompts "🛒 Tap the stall to shop"');
  assert(pcBody.includes('if(want===promptChipText) return;') && pcBody.includes("el.classList.toggle('open',!!want)"), 'simple: the chip touches the DOM only when the hint changes — walking away clears it the same frame');
  assert(!pcBody.includes('localStorage') && !homeBody.includes('localStorage') && !src.slice(src.indexOf('function syncDockGroupHeads(){'), src.indexOf('function applyRailVisibility(){')).includes('localStorage'), 'simple: the whole pass adds NO new localStorage keys (groups, headers and the chip are pure presentation)');
  // Prompt-chip behaviour, executed: the real function against
  // stubbed state — at the chest, walked away, at a stall, in a
  // duel, in the caves, with the shop already open, outside the
  // plaza. Only the DOM edge (a fake #promptchip) is stubbed.
  const pcStart = src.indexOf('const PROMPT_RANGE=80;');
  const pcFnStart = src.indexOf('function updatePromptChip(){');
  const pcCode = src.slice(pcStart, src.indexOf('\n}\n', pcFnStart) + 3);
  const pcSandbox = { console };
  vm.createContext(pcSandbox);
  vm.runInContext(
    'var __pc=null;\n' +
    'var el={textContent:"",_open:false,classList:{toggle:function(c,on){ if(c==="open") el._open=!!on; }}};\n' +
    'var $=function(id){ return id==="promptchip"? el : null; };\n' +
    'var me={username:"PcProbe"}, myPos={x:800,y:450}, curArea="plaza", grabMode=false;\n' +
    'var duel=null, modDuel=null, npcFight=null, fcRun=null, wildFight=null, dockPanel=null, railOpen=false;\n' +
    'var BANK_POS={x:800,y:450};\n' +
    'var SHOP_SPOTS=[{shop:"Potion",x:340,y:220},{shop:"Weapon",x:1260,y:220},{shop:"Armour",x:1260,y:680},{shop:"Food & Supplies",x:340,y:680}];\n' +
    pcCode + '\n' +
    'var out={};\n' +
    'updatePromptChip(); out.atBank={t:el.textContent,open:el._open};\n' +
    'myPos={x:800,y:200}; updatePromptChip(); out.away={t:el.textContent,open:el._open};\n' +
    'myPos={x:340,y:220}; updatePromptChip(); out.atShop={t:el.textContent,open:el._open};\n' +
    'duel={opponent:"X"}; updatePromptChip(); out.inDuel={t:el.textContent,open:el._open};\n' +
    'duel=null; fcRun={wave:1}; updatePromptChip(); out.inCaves={t:el.textContent,open:el._open};\n' +
    'fcRun=null; dockPanel="shop"; updatePromptChip(); out.shopOpen={t:el.textContent,open:el._open};\n' +
    'dockPanel=null; railOpen=true; myPos={x:800,y:450}; updatePromptChip(); out.sheetOpen={t:el.textContent,open:el._open}; railOpen=false;\n' +
    'dockPanel=null; curArea="training"; myPos={x:800,y:450}; updatePromptChip(); out.notPlaza={t:el.textContent,open:el._open};\n' +
    '__pc=out;', pcSandbox);
  const pc = pcSandbox.__pc;
  assert(pc && pc.atBank.t === '🧰 Tap the chest to bank' && pc.atBank.open === true, 'simple (executed): standing at the bank chest shows the bank prompt');
  assert(pc.away.t === '' && pc.away.open === false, 'simple (executed): walking away from the chest hides the prompt');
  assert(pc.atShop.t === '🛒 Tap the stall to shop' && pc.atShop.open === true, 'simple (executed): standing at a shop stall shows the shop prompt');
  assert(pc.inDuel.t === '' && pc.inDuel.open === false, 'simple (executed): a duel suppresses the prompt even at a stall');
  assert(pc.inCaves.t === '' && pc.inCaves.open === false, 'simple (executed): a Fight Caves run suppresses the prompt');
  assert(pc.shopOpen.t === '' && pc.shopOpen.open === false, 'simple (executed): with the shop panel already open there is no prompt (that action is done, not next)');
  assert(pc.sheetOpen.t === '' && pc.sheetOpen.open === false, 'simple (executed): with the Menu sheet open there is no prompt over the tiles (Mobile layout 2026-11-24)');
  assert(pc.notPlaza.t === '' && pc.notPlaza.open === false, 'simple (executed): outside the plaza there is never a prompt');

  /* ---------- Mobile layout (2026-11-24): the A/B trial is retired — one layout ---------- */
  // The legacy iface key stays in the settings defaults, unread, so
  // saved settings load exactly as before; the switcher itself —
  // the Settings row, the setter, the body-class applier and its
  // boot call — is gone.
  assert(/soundOn:true,shakeOn:true,iface:'B'/.test(src), 'mobile: the settings defaults still carry the legacy iface key (harmless, unread) so saved settings keep their shape');
  assert(!src.includes('setIfaceMode') && !src.includes('applyIfaceMode') && !src.includes('ifaceB'), 'mobile: the trial switcher is fully retired — no setter, no applier, no trial body class anywhere');
  assert(!src.includes('🧭 Interface: A / B'), 'mobile: the Settings panel no longer offers an interface switch — there is one layout to learn');
  assert(/applySettings\(\);\nrenderQuickButtons\(\);/.test(src), 'mobile: boot applies settings with no interface-mode step beside it');
  // Group labels are simply always on now — the presentation the
  // trial called B is the only presentation.
  assert(/\.blab\{display:inline-flex/.test(src) && /\.bwrap\{display:contents\}/.test(src), 'mobile: group labels are always shown and quick-chip wrappers are display:contents — no trial class gates them');
  assert(!src.includes('id="sidecluster"') && !src.includes('sc-pray') && !src.includes('scpack'), 'mobile: the side cluster is gone — no markup, no wiring; Pack lives in the round action cluster and Protect in the Prayers card (Picture look 2026-11-26)');
  assert(/#promptline\{display:none/.test(src) && /#promptline\.open\{display:block\}/.test(src), 'trialb: the smart-prompt line is hidden unless a prompt opens it');
  {
    const bbSeg = src.slice(src.indexOf('<div id="bottombar">'), src.indexOf('<div id="barrowsbar">'));
    assert(bbSeg.includes('id="bbstyles"') && !bbSeg.includes('id="bbpack"') && !bbSeg.includes('bbprayers') && bbSeg.includes('id="ppray-melee"') && bbSeg.includes('id="clpack"'), 'picture: the bottom bar markup holds the styles alone; the Deflects sit in the Prayers card and the Backpack in the round cluster right after it (Picture look 2026-11-26)');
  }
  // B groups: labels + order, in the bottom bar and both strips.
  assert(src.includes('<span class="blab" data-grp="fight">Fight</span>\n <div id="bbstyles">'), 'trialb: the bottom bar carries its Fight group label before the styles');
  assert(src.includes('<span class="blab" data-grp="fight">Fight</span>\n <div id="duelstyles">') && src.includes('<span class="blab" data-grp="actions">Actions</span>\n <button class="fchip atk" id="atkchip"'), 'trialb: the duel strip carries Fight and Actions group labels');
  assert(src.includes('<span class="blab" data-grp="fight">Fight</span>\n <div id="fcstyles">') && src.includes('<span class="blab" data-grp="actions">Actions</span>\n <button class="fchip atk" id="fcatkchip"'), 'trialb: the Fight Caves strip carries Fight and Actions group labels');
  assert((src.match(/class="bwrap" data-grp="actions"/g) || []).length === 5 && (src.match(/class="bwrap" data-grp="supplies"/g) || []).length === 5 && (src.match(/class="blab" data-grp="supplies"/g) || []).length === 5, 'trialb: all five fight-strip quick renders (duel, mod, NPC, Wilderness, Fight Caves) wrap Dragon Slash in Actions and the food/potions in a labelled Supplies group');
  assert(/#duelstyles,#fcstyles,#bbstyles\{order:11\}/.test(src) && /\.blab\[data-grp="supplies"\]\{order:30\}/.test(src) && /\.blab\[data-grp="actions"\]\{order:40\}/.test(src), 'mobile: the groups present in the spec order — Fight, then Supplies, then Actions — in every strip, unconditionally');
  assert(src.includes('id="duelpack"') && src.includes('id="fcpack"') && src.includes('id="clpack"') && !/#duelprayers[^{]*\{[^}]*display:none/.test(src) && !/#fcprayers[^{]*\{[^}]*display:none/.test(src), 'picture: the fight strips KEEP their Backpack + Deflect buttons — no rule hides them; out of fights Pack lives in the round cluster and Protect in the Prayers card (Picture look 2026-11-26)');
  assert((src.match(/class="blab" data-grp="protect"/g) || []).length === 2, 'picture: the duel and Fight Caves strips carry the Protect group label before their Deflect chips; the bottom bar Protect group moved to the Prayers card (Picture look 2026-11-26)');
  // Deflect prompts now pulse the strip's own Deflect button.
  assert(/function deflectBtnEl\(style\)\{/.test(src) && src.includes("$('fcpray-'+style)") && src.includes("$('duelpray-'+style)") && src.includes("$('ppray-'+style)"), 'picture: deflectBtnEl resolves the Deflect button in front of the player — Fight Caves strip, duel strip (any fight), or the Prayers card out of fights (Picture look 2026-11-26)');
  assert(/document\.querySelectorAll\('\.fchip\.pack'\)\.forEach\(b=>b\.onclick=\(\)=>togglePanel\('backpack'\)\)/.test(src), 'mobile: the strip Pack buttons toggle the backpack panel in one tap');

  /* ---------- Picture look (2026-11-26): the reference picture's HUD ---------- */
  assert(src.includes('id="playercard"') && src.includes('id="pcname"') && src.includes('id="pchpfill"') && src.includes('id="pchpnum"') && src.includes('id="pcsub"'), 'picture: the player card exists — role icon, name, green HP bar with cur / max, combat + role line');
  assert(src.includes('id="areacard"') && src.includes('id="pcarea"') && src.includes('id="pcstatus"') && /function hudAreaStatus\(\)/.test(src), 'picture: the area card exists — area name + a one-line status from existing client state');
  assert(/<canvas id="minimap" width="128" height="128">/.test(src) && /#minimap\{width:128px;height:128px;border-radius:50%/.test(src), 'picture: the minimap is ROUND — a square canvas (the draw code reads c.width/c.height) clipped by a 50% radius with a gold ring; the engine is untouched');
  assert(src.includes('id="orbgold"') && src.includes('id="orbgoldv"') && src.includes('id="orbcb"') && src.includes('id="orbcbv"') && /#orbs\{flex-direction:column/.test(src), 'picture: the orbs form a column under the round map, gaining a gold orb (backpack total) and a combat orb');
  assert(src.includes('id="praypanel"') && src.includes('id="pppoints"') && src.includes('id="ppactive"') && /#praypanel\{position:fixed;left:8px/.test(src), 'picture: the Prayers card sits bottom-left with points as cur / max and an active-prayer footer');
  assert(src.includes('id="hudcluster"') && src.includes('id="clfood"') && src.includes('id="clpotion"') && src.includes('id="clspec"') && src.includes('id="clatk"') && src.includes('id="clpack"') && src.includes('id="cltele"'), 'picture: the round action cluster exists — food, potion, special, attack, backpack, teleport');
  assert(src.includes("$('clfood').onclick=()=>{ const f=bestFoodStack(); if(f) send({type:'use',item:f.item});") && src.includes("$('cltele').onclick=()=>togglePanel('teleport')") && src.includes("$('clpack').onclick=()=>togglePanel('backpack')"), 'picture: the cluster rides existing paths — the {type:use} send and togglePanel, no new messages');
  assert(/syncHudPicture\(\); \/\/ Picture look/.test(src) && /function syncHudPicture\(\)/.test(src), 'picture: the HUD sync rides renderOrbs, so every state push refreshes the cards, orbs and cluster together');
  assert(/#chatbox\{left:8px;right:auto;top:calc\(168px \+ env\(safe-area-inset-top,0px\)\)/.test(src), 'picture: the chat row lives under the area card, restyled dark/pill — same #chatbox, log and outbox');
  // Smart prompts: advise only, rule-aware, one at a time.
  const spStart = src.indexOf('let promptFightKey');
  const spSeg = src.slice(src.indexOf('/* ================= Smart prompts'), src.indexOf("$('fcleavebtn')"));
  assert(spStart > -1 && /function updateSmartPrompt\(\)/.test(src) && src.includes('updateSmartPrompt(); // smart prompts ride the same tick'), 'trialb: the smart prompt engine exists and rides the frame tick beside the hint chip');
  assert(!spSeg.includes('send({'), 'trialb: the prompt engine NEVER sends a game message — prompts advise, they never auto-use');
  assert(/if\(!me\)\{ if\(promptCur\)/.test(spSeg) && !spSeg.includes('settings.iface'), 'mobile: the prompt engine runs in the one layout — it idles only when there is no player yet; the retired trial key no longer gates it');
  assert(spSeg.includes("myHpFrac()<0.30") && spSeg.includes("You're badly hurt — eat now"), 'trialb: HP under ~30% prompts the best food — "You\'re badly hurt — eat now"');
  assert(spSeg.includes('me.prayerPoints<=0') && spSeg.includes('Prayer is empty — drink a prayer potion'), 'trialb: empty prayer prompts the prayer potion');
  assert(spSeg.includes("classList.contains('ready')") && spSeg.includes('Dragon Slash is ready'), 'trialb: a ready special prompts Dragon Slash');
  assert(spSeg.includes("npcFight.kind==='wizard'") && spSeg.includes('Melee fighter — Deflect Melee stops him cold') && spSeg.includes('He casts magic — Deflect Magic!'), 'trialb: fight start prompts the matching Deflect for the opponent\'s style');
  assert(spSeg.includes('jadWarnStyle') && spSeg.includes('Jad casts — Deflect Magic!'), 'trialb: a Jad telegraph prompts the matching Deflect button itself');
  assert(/\/dharok\/i/.test(spSeg) && spSeg.includes("prayer up, eat early"), 'trialb: Dharok under 25% HP prompts prayer + food together');
  assert(spSeg.includes("curArea==='purewild'") && spSeg.includes('R.noPrayer') && spSeg.includes('R.noPotions') && spSeg.includes('R.noFood') && spSeg.includes('R.noSpecial'), 'trialb: promptBanned knows Pure Wild and every duel rule (No Prayer / No Potions / No Food / No Special)');
  assert(spSeg.includes("promptBanned('prayer')") && spSeg.includes("promptBanned('food')") && spSeg.includes("promptBanned('potion')") && spSeg.includes("promptBanned('special')"), 'trialb: every trigger checks its ban before firing — a banned button is never suggested');
  assert(src.includes("document.addEventListener('pointerdown',()=>{ if(promptCur) dismissSmartPrompt(); },true);") && /function dismissSmartPrompt\(\)\{ if\(!promptCur\) return; promptSeen\.add\(promptCur\.key\);/.test(src), 'trialb: any tap dismisses the showing prompt and retires that trigger for the fight — no nagging');
  assert(/\.promptpulse\{animation:promptPulse/.test(src) && spSeg.includes("cand.els.forEach(el=>el.classList.add('promptpulse'))"), 'trialb: the prompt pulses the REAL button and shows its one-line reason');
  // Smart prompts, executed: the real engine against fake buttons.
  {
    const spFnStart = src.indexOf('function updateSmartPrompt(){');
    const spCode = src.slice(spStart, src.indexOf('\n}\n', spFnStart) + 3);
    const sb2 = { console };
    vm.createContext(sb2);
    vm.runInContext(
      'function mkEl(){ const el={_cls:new Set(),textContent:"",_attrs:{},classList:{add:function(c){el._cls.add(c)},remove:function(c){el._cls.delete(c)},contains:function(c){return el._cls.has(c)},toggle:function(c,on){ if(on) el._cls.add(c); else el._cls.delete(c); }},getAttribute:function(n){ return el._attrs[n]||null; },querySelectorAll:function(){ return el._kids||[]; }}; return el; }\n' +
      'var __now=1000; var performance={now:function(){ return __now; }};\n' +
      'var line=mkEl(); var specBtn=mkEl();\n' +
      'var foodChip=mkEl(); foodChip._attrs.onclick="send({type:\'use\',item:\'cooked_chicken\'})";\n' +
      'var potChip=mkEl(); potChip._attrs.onclick="send({type:\'use\',item:\'prayer_potion\'})";\n' +
      'var dq=mkEl(); dq._kids=[foodChip,potChip]; var fcq=mkEl(); fcq._kids=[];\n' +
      'var prayBtns={melee:mkEl(),missiles:mkEl(),magic:mkEl()};\n' +
      'var allEls=[line,specBtn,foodChip,potChip,prayBtns.melee,prayBtns.missiles,prayBtns.magic];\n' +
      'var $=function(id){ const pm=/^(?:ppray|duelpray|fcpray)-(\\w+)$/.exec(id); if(pm) return prayBtns[pm[1]]; return id==="promptline"? line : id==="specbtn"? specBtn : id==="fcspecbtn"? mkEl() : id==="duelquick"? dq : id==="fcquick"? fcq : null; };\n' +
      'var document={querySelector:function(){ return null; },querySelectorAll:function(){ return allEls.filter(function(e){ return e._cls.has("promptpulse"); }); }};\n' +
      'var settings={iface:"B"}; var curArea="goblins"; var jadWarnStyle=null;\n' +
      'var me={username:"BProbe",prayerPoints:10}; var duel=null, modDuel=null, npcFight=null, fcRun=null, wildFight=null;\n' +
      'var catalog={cooked_chicken:{kind:"food",heal:8},prayer_potion:{kind:"potion"}};\n' +
      spCode + '\n' +
      'var out={};\n' +
      'npcFight={npcId:"g1",kind:"goblin",name:"Goblin",hpYou:99,maxHpYou:99,hpNpc:10,maxHpNpc:10,energyYou:0}; updateSmartPrompt(); out.start={line:line.textContent,open:line._cls.has("open"),pulsed:prayBtns.melee._cls.has("promptpulse")};\n' +
      'npcFight.hpYou=20; updateSmartPrompt(); out.lowHp={line:line.textContent,pulsed:foodChip._cls.has("promptpulse")};\n' +
      'dismissSmartPrompt(); updateSmartPrompt(); out.afterDismiss={line:line.textContent,foodPulsed:foodChip._cls.has("promptpulse")};\n' +
      'dismissSmartPrompt(); updateSmartPrompt(); out.allDismissed={line:line.textContent,open:line._cls.has("open")};\n' +
      'npcFight={npcId:"g2",kind:"goblin",name:"Goblin",hpYou:99,maxHpYou:99,hpNpc:10,maxHpNpc:10,energyYou:0}; me.prayerPoints=0; __now+=7000; updateSmartPrompt(); out.prayer={line:line.textContent,pulsed:potChip._cls.has("promptpulse")};\n' +
      'duel={opponent:"Y",hpYou:99,rules:{}}; npcFight=null; me.prayerPoints=10; specBtn._cls.add("ready"); updateSmartPrompt(); out.spec={line:line.textContent,pulsed:specBtn._cls.has("promptpulse")};\n' +
      'duel={opponent:"Z",hpYou:10,rules:{noFood:true,noPotions:true}}; me.prayerPoints=0; specBtn._cls.delete("ready"); updateSmartPrompt(); out.banned={line:line.textContent,open:line._cls.has("open")};\n' +
      'settings.iface="A"; duel={opponent:"W",hpYou:5,rules:{}}; updateSmartPrompt(); out.legacy={line:line.textContent,open:line._cls.has("open"),pulsed:foodChip._cls.has("promptpulse")};\n' +
      '__sp=out;', sb2);
    const sp = sb2.__sp;
    assert(sp && sp.start.line === 'Melee fighter — Deflect Melee stops him cold' && sp.start.open && sp.start.pulsed, 'trialb (executed): a melee NPC fight start pulses Deflect Melee on the duel strip with its reason (Picture look 2026-11-26: NPC fights resolve to the duel strip, not the old bottom-bar chip)');
    assert(sp.lowHp.line === "You're badly hurt — eat now" && sp.lowHp.pulsed, 'trialb (executed): dropping under 30% HP switches the prompt to the best food chip');
    assert(sp.afterDismiss.line === 'Melee fighter — Deflect Melee stops him cold' && sp.afterDismiss.foodPulsed === false, 'trialb (executed): dismissing the food prompt retires it — the next prompt in line may follow, the dismissed one does not re-fire');
    assert(sp.allDismissed.open === false && sp.allDismissed.line === '', 'trialb (executed): with every fired trigger dismissed, the line closes and stays closed for that fight');
    assert(sp.prayer.line === 'Prayer is empty — drink a prayer potion' && sp.prayer.pulsed, 'trialb (executed): empty prayer prompts the prayer potion chip');
    assert(sp.spec.line === 'Dragon Slash is ready' && sp.spec.pulsed, 'trialb (executed): a ready special prompts the Dragon Slash button');
    assert(sp.banned.open === false && sp.banned.line === '', 'trialb (executed): in a No Food / No Potions duel the food and potion prompts never fire');
    assert(sp.legacy.open === true && sp.legacy.line === "You're badly hurt — eat now" && sp.legacy.pulsed, 'mobile (executed): a stale saved iface:"A" is inert — the prompt engine still fires in the one layout');
  }

  /* ---------- Bank + Worn panels: items at the top, slot-square worn, panels stop above the strip ---------- */
  {
    const pbSeg = src.slice(src.indexOf('function pBank(){'), src.indexOf('/* ---- Gold Exchange ---- */'));
    assert(pbSeg.includes('class="bankpanel"') && pbSeg.indexOf('Your backpack — tap to deposit') < pbSeg.indexOf('Quantity:'), 'panels: the Bank panel leads with the player\'s own backpack, above the quantity controls');
    assert(pbSeg.indexOf('Your backpack — tap to deposit') < pbSeg.indexOf('Bank — tap to withdraw') && pbSeg.indexOf("bank_deposit") < pbSeg.indexOf("bank_withdraw"), 'panels: in the Bank panel the backpack (deposit) section precedes the bank storage (withdraw) section');
    assert(pbSeg.includes("setBankQty('") && pbSeg.includes('setBankTab') && pbSeg.includes('bankSearchInput'), 'panels: the Bank panel keeps every control — quantities 1/5/10/X/All, category tabs and search');
    const pwSeg = src.slice(src.indexOf('function pWorn(){'), src.indexOf('/* ---- Shops ---- */'));
    assert(pwSeg.includes('class="wornpanel"') && pwSeg.includes('id="worngrid"') && pwSeg.includes('class="cell worn"') && pwSeg.includes('class="cell empty worn"'), 'panels: the Worn panel presents every piece in the backpack\'s own slot squares (.grid + .cell), empties included');
    assert(pwSeg.includes('<span class="cap">${label}</span>') && pwSeg.includes("send({type:'unequip',slot:'${slot}'})"), 'panels: worn squares keep their slot captions (Weapon, Head, Body…) and the one-tap unequip send');
    assert(pwSeg.indexOf('id="worngrid"') < pwSeg.indexOf('Backpack — tap to wear / use'), 'panels: the Worn panel leads with the worn items, then the backpack — the player\'s items are the first thing seen');
    assert(/window\.wornPackTap=function\(i\)/.test(pwSeg) && pwSeg.includes("send({type:'equip',item:s.item,slot:i})") && pwSeg.includes("send({type:'use',item:s.item})"), 'panels: the Worn panel\'s backpack taps equip from the exact backpack spot (swap semantics) or use food/potions, mirroring the Quick slots');
    assert(/\.bankpanel \.cell,\.wornpanel \.cell\{min-height:52px\}/.test(src) && /\.bankpanel \.seg button,\.bankpanel \.tabs button\{min-height:36px\}/.test(src), 'panels: Bank + Worn are compacted (52px cells) while tap targets stay usable (≥36px controls)');
    assert(/#dockpanel\.open\{display:flex\}/.test(src) && /#dockbody\{[^}]*overflow-y:auto/.test(src) && /#dockbody\{[^}]*min-height:0/.test(src), 'panels: an open panel fills the side panel, which stops above the bottom strip — the bottom bar and chat stay visible, and the panel body scrolls internally (vertically) instead');
    assert(/#paneldock\.panelopen #docktabs\{display:none\}/.test(src) && src.includes("$('paneldock').classList.add('panelopen')") && src.includes("$('paneldock').classList.remove('panelopen')"), 'panels: while a panel is open it takes the sheet space and the tile grid steps aside entirely; the ‹ Menu header button brings the grid back');
  }

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
    const reg = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'IfaceAnn', password: 'iface-pass-ann' }) }).then((r) => r.json());
    assert(reg.token && reg.profile && reg.profile.username === 'IfaceAnn', 'live: registration returns a profile with the new client live');
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
  console.log('ALL INTERFACE OVERHAUL TESTS PASSED');
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
