// Stage 26 tests: duel feel — toe-to-toe No Movement spawns (server)
// plus the client fight-presentation wiring (source asserts, the
// stage18/23/25 pattern — the harness has no DOM):
//   (1) a noMovement duel starts the fighters ~26 units apart
//       (787,450) / (813,450) — the actual distance between the two
//       fighters in the arena state snapshot is < MELEE_REACH (42),
//       so the first engage connects with zero closing.
//   (2) a normal (movement) duel keeps the classic 40-unit gap
//       (780,450) / (820,450) exactly.
//   (3) client wiring: in a duel the opponent tap ONLY attacks (the
//       tap-player menu is suppressed on the plain tap, the
//       long-press, and the Menu-tap-mode route, for player duels
//       and mod duels alike); swings are forced in the local
//       player's own fights (range gate bypassed) on every outcome;
//       facing is eased via faceTarget (no snap) and persists while
//       a duel is on; landed/blocked hits trigger flinches, misses
//       don't. The opponent's WHOLE figure is the tap target
//       (figureTapDist in handleTap + detectWorldTap).
//   (4) the functional AUDIT sections (3)-(9) at the bottom: a
//       staked duel fought to a real KO with exact escrow/pot/
//       record/rating arithmetic, Free Play settlement, No Movement
//       first-engage with zero closing ticks, an approach/kite
//       audit, disconnect-mid-duel cleanup, and mod + Stake Board
//       duels through to payout. They also regression-pin the
//       client audit fix: a tick where only ONE fighter swings is
//       not a "closing" tick (the old test discarded the other
//       fighter's swing — invisible hits).
// Same harness style as test/stage18.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18126;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage26.json');
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
// Drives a challenge from send to duel_start with bare confirms
// (the stage14/15/18 flow). Returns { inc, startA, startB }.
async function startDuel(A, B, opts) {
  const mA = A.mark(), mB = B.mark();
  A.send({ type: 'challenge', target: B.name, stake: 1, ...(opts || {}) });
  const inc = (await B.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming')).e;
  B.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  A.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  B.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  const startA = (await A.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start (challenger)')).e;
  const startB = (await B.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'duel_start (target)')).e;
  return { inc, startA, startB };
}
// Reads both fighters' positions from the first arena state snapshot
// at/after idx (startDuel broadcasts one synchronously at the start).
async function arenaPositions(c, idx, nameA, nameB) {
  const snap = (await c.waitSince(idx, (e) => e.type === 'state' && e.area === 'arena'
    && e.players.some((p) => p.username === nameA) && e.players.some((p) => p.username === nameB),
    10000, 'arena state snapshot')).e;
  const pA = snap.players.find((p) => p.username === nameA);
  const pB = snap.players.find((p) => p.username === nameB);
  return { pA, pB, dist: Math.hypot(pA.x - pB.x, pA.y - pB.y) };
}

const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const BOW = { weapon: 'magic_shortbow', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const PW = (n) => 's26-pass-' + n;
const NAMES = ['S26Ann', 'S26Bob', 'S26Cid', 'S26Dee', 'S26Eli', 'S26Fay', 'S26Gil', 'S26Hal', 'S26Ivy', 'S26Jay', 'S26Kim', 'S26Lou', 'S26Mel', 'S26Ned', 'S26Ora', 'S26Paz', 'S26Quin', 'S26Rae'];
// One leaderboard row (gold mirror / wins / losses / rating) by name.
async function boardRow(name) {
  const d = await (await fetch(BASE + '/api/leaderboard')).json();
  const row = (d.leaderboard || []).find((r) => r.username === name);
  if (!row) throw new Error('leaderboard row missing for ' + name);
  return row;
}
async function waitCountdownOver(c, label) {
  await c.waitSince(0, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 20000, label);
}

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  /* ---------- server source: the toe-to-toe No Movement spawn ---------- */
  assert(/const nmSpawn = duelRules\.noMovement;/.test(src), 'source (P1): startDuel branches the spawn gap on rules.noMovement');
  assert(/sessA\.x = nmSpawn \? 787 : 780/.test(src) && /sessB\.x = nmSpawn \? 813 : 820/.test(src), 'source (P1): No Movement spawns 787/813, movement duels keep 780/820');

  /* ---------- client Part 2: in a duel, the opponent tap ONLY attacks ---------- */
  assert(/in a duel the opponent tap ONLY attacks/.test(clientSrc), 'source (P2): handleTap returns after the duel-opponent attack — no player menu');
  assert(/const duelTap=\(duel&&hit\.kind==='player'&&hit\.name===duel\.opponent\)\|\|\(modDuel&&hit\.kind==='modnpc'&&hit\.id===modDuel\.npcId\);/.test(clientSrc), 'source (P2): Menu-tap mode routes duel/mod-duel opponent taps to the attack branches, not the menu');
  assert(/!duelTap&&!\(armedSpell/.test(clientSrc), 'source (P2): the menu-tap long-press route is skipped for a duel opponent tap');
  assert(/a long-press on my duel opponent attacks/.test(clientSrc) && /if\(duel&&hit\.name===duel\.opponent\)\{\s*send\(\{type:'duel_attack'\}\);/.test(clientSrc), 'source (P2): handleLongPress on the duel opponent sends duel_attack instead of openPlayerMenu');
  assert(/if\(modDuel&&modDuel\.npcId===hit\.id\)\{ tapModNpc\(hit\.id\); return; \}/.test(clientSrc), 'source (P2): handleLongPress on my mod-duel opponent engages via tapModNpc — no context sheet');
  assert(/else openPlayerMenu\(best\);/.test(clientSrc), 'source (P2): outside a duel the player menu still opens as before');

  /* ---------- client Part 3: face the opponent, swing on every swing ---------- */
  assert(/function startSwingAt\(attacker,target,force\)/.test(clientSrc), 'source (P3): startSwingAt takes a force flag');
  assert(/if\(!force&&Math\.hypot\(dx,dz\)\*W2S>SWING_SHOW_RANGE\) return;/.test(clientSrc), 'source (P3): the 62-unit swing gate only applies to unforced swings');
  assert(/startSwingAt\(me\?avatars\[me\.username\]:null,avatars\[duel\.opponent\],true\)/.test(clientSrc)
    && /startSwingAt\(avatars\[duel\.opponent\],me\?avatars\[me\.username\]:null,true\)/.test(clientSrc), 'source (P3): both duel swings are forced (always animate on screen)');
  assert(/startSwingAt\(me\?avatars\[me\.username\]:null,ba,true\)/.test(clientSrc) && /startSwingAt\(me\?avatars\[me\.username\]:null,ma,true\)/.test(clientSrc), 'source (P3): NPC/Barrows and mod-duel swings are forced too');
  assert(/a\.faceTarget=ang;/.test(clientSrc) && !/a\.rot=ang; if\(a\.group\) a\.group\.rotation\.y=ang;/.test(clientSrc), 'source (P3): faceTarget records an eased facing target — the instant rotation snap is gone');
  assert(/else if\(a\.faceTarget!==undefined\) easeRot\(a,a\.faceTarget,dt\);/.test(clientSrc), 'source (P3): animate() eases standing avatars onto their faceTarget');
  assert(/if\(duel&&name===duel\.opponent&&me&&avatars\[me\.username\]\)/.test(clientSrc), 'source (P3): the duel opponent\'s facing refreshes toward me every frame while the duel is on');
  assert(/const foeAv=duel\? avatars\[duel\.opponent\] : \(modDuel\? modAvatars\[modDuel\.npcId\] : null\);/.test(clientSrc), 'source (P3): standing in a duel/mod duel, my knight eases to face his opponent');
  assert(/if\(modDuel&&modDuel\.npcId===mid&&me&&avatars\[me\.username\]\)/.test(clientSrc), 'source (P3): the mod I am fighting turns to face me');

  /* ---------- client Part 4: getting hit looks like getting hit ---------- */
  assert(/function startFlinch\(victim,attacker,guard\)/.test(clientSrc) && /function applyFlinch\(a,now\)/.test(clientSrc) && /function clearFlinchOff\(a\)/.test(clientSrc), 'source (P4): the flinch machinery exists (start/apply/clear, lunge-style offsets)');
  assert(/function flinchForOutcome\(victim,attacker,outcome,dmg\)/.test(clientSrc) && /if\(outcome==='miss'\) return;/.test(clientSrc), 'source (P4): one shared trigger rule — a miss is a whiff, no reaction');
  assert(/if\(outcome==='blocked'\)\{ startFlinch\(victim,attacker,true\); return; \}/.test(clientSrc), 'source (P4): a blocked hit is a guard flinch');
  assert(/if\(typeof dmg==='number'&&dmg>0\)\{ startFlinch\(victim,attacker,false\); return; \}/.test(clientSrc), 'source (P4): a landed hit with damage is a full flinch');
  assert(/flinchForOutcome\(oppAv,myAv,/.test(clientSrc) && /flinchForOutcome\(myAv,oppAv,/.test(clientSrc), 'source (P4): duel ticks flinch both fighters');
  assert(/flinchForOutcome\(ba,/.test(clientSrc) && /flinchForOutcome\(ma,/.test(clientSrc), 'source (P4): NPC/Barrows and mod-duel ticks flinch the creature/mod and me');
  assert(/startFlinch\(fcAvatars\[u\.id\],/.test(clientSrc) && /startFlinch\(me\?avatars\[me\.username\]:null,m\.targetId\?fcAvatars\[m\.targetId\]:null,true\)/.test(clientSrc), 'source (P4): Fight Caves HP drops flinch the monster, blocked cave hits guard-flinch me');
  assert((clientSrc.match(/applyFlinch\(a,now\)/g) || []).length >= 4, 'source (P4): applyFlinch runs in every avatar loop (players, NPCs, cave monsters, mods)');
  assert(/a\.armR\.rotation\.x\+=\(s\*0\.42\*m-a\.armR\.rotation\.x\)/.test(clientSrc), 'source (P4): the weapon arm eases back into the walk cycle after a swing (no snap)');

  /* ---------- client Part 2 follow-up: the WHOLE figure is the tap target ---------- */
  assert(/function figureTapDist\(a,cx,cy\)/.test(clientSrc) && /for\(const h of \[0\.25,0\.8,1\.35,1\.95\]\)/.test(clientSrc), 'source (P2b): figureTapDist walks a ladder of points up the whole body (boots/legs/torso/head)');
  assert(/const DUEL_FIGURE_TAP=58;/.test(clientSrc), 'source (P2b): the duel figure test carries a generous 58px margin');
  assert(/if\(duel&&avatars\[duel\.opponent\]&&figureTapDist\(avatars\[duel\.opponent\],cx,cy\)<DUEL_FIGURE_TAP\) best=duel\.opponent;/.test(clientSrc), 'source (P2b): handleTap — a tap anywhere on the duel opponent\'s figure makes them the target');
  assert(/if\(duel&&avatars\[duel\.opponent\]&&figureTapDist\(avatars\[duel\.opponent\],cx,cy\)<DUEL_FIGURE_TAP\) return \{kind:'player',name:duel\.opponent\};/.test(clientSrc), 'source (P2b): detectWorldTap — the whole figure resolves to the opponent for long-press / Menu-tap routing');
  assert(/figureTapDist\(modAvatars\[modDuel\.npcId\],cx,cy\)<DUEL_FIGURE_TAP\) mb=modDuel\.npcId;/.test(clientSrc), 'source (P2b): handleTap — a tap anywhere on my mod-duel opponent\'s figure targets the mod');
  assert(/figureTapDist\(modAvatars\[modDuel\.npcId\],cx,cy\)<DUEL_FIGURE_TAP\) return \{kind:'modnpc',id:modDuel\.npcId\};/.test(clientSrc), 'source (P2b): detectWorldTap — the mod\'s whole figure resolves to the mod mid-duel');

  /* ---------- client AUDIT FIX: one fighter's swing is not a closing tick ---------- */
  assert(!/closing=!!m\.closing\|\|typeof m\.youHit!=='number'/.test(clientSrc), 'source (AUDIT): the "my swing didn\'t happen = closing" test is GONE from both tick handlers — it discarded the other fighter\'s swings');
  assert((clientSrc.match(/const closing=!!m\.closing;/g) || []).length === 2, 'source (AUDIT): duelTickUI and modDuelUI both take closing from the server flag only, so every tick renders the swings it carries');

  /* ---------- the inline script still parses ---------- */
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs);
  assert(true, 'client inline script parses (new Function)');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    for (const n of NAMES) {
      const c = await register(n, PW(n));
      clients.push(c); c.close();
    }
    await stopServer();
    seedDb((data) => {
      for (const n of NAMES) {
        const p = data.users[n.toLowerCase()].profile;
        p.worn = { ...STEEL };
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }];
        p.specialEnergy = 100;
      }
      // Audit seeds: a lopsided KO pairing (dragon vs bronze), and a
      // bow kit for the mod-ladder kite win.
      data.users['s26eli'].profile.worn = { ...STEEL, weapon: 'dragon_sword' };
      data.users['s26fay'].profile.worn = { ...STEEL, weapon: 'bronze_sword' };
      const paz = data.users['s26paz'].profile;
      paz.worn = { ...BOW };
      paz.backpack = [{ item: 'gold', qty: 500 }, { item: 'rune_arrow', qty: 400 }];
    });
    await startServer();

    // ---------- (1) noMovement duel: toe-to-toe spawn ----------
    const Ann = await login('S26Ann', PW('S26Ann')); clients.push(Ann);
    const Bob = await login('S26Bob', PW('S26Bob')); clients.push(Bob);
    {
      const mA = Ann.mark();
      const { startA } = await startDuel(Ann, Bob, { rules: { noMovement: true } });
      assert(startA.rules && startA.rules.noMovement === true, '(1) duel_start carries noMovement');
      const { pA, pB, dist } = await arenaPositions(Ann, mA, 'S26Ann', 'S26Bob');
      assert(pA.x === 787 && pA.y === 450 && pB.x === 813 && pB.y === 450, `(1) No Movement spawns are (787,450)/(813,450) (got ${pA.x},${pA.y} / ${pB.x},${pB.y})`);
      assert(dist === 26, `(1) the fighters stand exactly 26 units apart (got ${dist})`);
      assert(dist < 42, '(1) the spawn distance is inside MELEE_REACH (42) — zero closing to the first engage');
      Bob.close();
      const endA = (await Ann.waitSince(0, (e) => e.type === 'duel_end', 20000, '(1) duel_end')).e;
      assert(endA.winner === 'S26Ann', '(1) the noMovement duel finishes (Ann wins by forfeit)');
      console.log('PASS (1) noMovement duel: toe-to-toe spawn, 26 apart, inside melee reach');
    }

    // ---------- (2) normal duel: the classic 40 gap is untouched ----------
    const Cid = await login('S26Cid', PW('S26Cid')); clients.push(Cid);
    const Dee = await login('S26Dee', PW('S26Dee')); clients.push(Dee);
    {
      const mC = Cid.mark();
      const { startA } = await startDuel(Cid, Dee, {});
      assert(!startA.rules || !startA.rules.noMovement, '(2) a plain duel has noMovement off');
      const { pA, pB, dist } = await arenaPositions(Cid, mC, 'S26Cid', 'S26Dee');
      assert(pA.x === 780 && pA.y === 450 && pB.x === 820 && pB.y === 450, `(2) normal spawns stay (780,450)/(820,450) (got ${pA.x},${pA.y} / ${pB.x},${pB.y})`);
      assert(dist === 40, `(2) the movement-duel gap is still exactly 40 (got ${dist})`);
      Dee.close();
      const endC = (await Cid.waitSince(0, (e) => e.type === 'duel_end', 20000, '(2) duel_end')).e;
      assert(endC.winner === 'S26Cid', '(2) the normal duel finishes (Cid wins by forfeit)');
      console.log('PASS (2) normal duel: 40-unit spawn gap unchanged');
    }

    // ================= FUNCTIONAL AUDIT (Derek: "dueling is messed up still") =================
    // Exact-money note for every section below: a fresh account's
    // FIRST duel win (any kind) also pays the Stage 20 "Win a duel"
    // starter goal, +25g, once. Winners below are all first-time
    // winners, so their expected gold includes that +25 — it is a
    // starter reward, not pot money, and each assert says so.

    // ---------- (3) staked duel fought to a real KO: escrow, pot, record, rating ----------
    const Eli = await login('S26Eli', PW('S26Eli')); clients.push(Eli);
    const Fay = await login('S26Fay', PW('S26Fay')); clients.push(Fay);
    {
      const eli0 = await boardRow('S26Eli'), fay0 = await boardRow('S26Fay');
      assert(eli0.gold === 100 && fay0.gold === 100 && eli0.wins === 0 && fay0.losses === 0, '(3) both fighters start at 100g, 0W/0L');
      const { startA } = await startDuel(Eli, Fay, { stake: 25 });
      assert(startA.stake === 25 && startA.pot === 50, '(3) duel_start: 25g stake, 50g pot');
      Eli.send({ type: 'style', style: 'aggressive' }); Fay.send({ type: 'style', style: 'aggressive' });
      Eli.send({ type: 'duel_attack' }); Fay.send({ type: 'duel_attack' });
      Eli.send({ type: 'special' }); Fay.send({ type: 'special' }); // seeded 100 energy — Dragon Slash rides the first swings
      await sleep(600);
      const eliMid = await boardRow('S26Eli'), fayMid = await boardRow('S26Fay');
      assert(eliMid.gold === 75 && fayMid.gold === 75, `(3) escrow: both purses are down exactly the 25g stake mid-duel (got ${eliMid.gold}/${fayMid.gold})`);
      const endA = (await Eli.waitSince(0, (e) => e.type === 'duel_end', 300000, '(3) duel_end (real KO)')).e;
      assert(endA.reason === 'KO', `(3) the duel ends by KO at 0 HP, not by forfeit/timeout (reason: ${endA.reason})`);
      assert(endA.pot === 50, '(3) duel_end carries the 50g pot');
      const eliTicks = Eli.events.filter((e) => e.type === 'duel_tick');
      assert(eliTicks.some((t) => t.hpOpponent < 99) && eliTicks.some((t) => t.hpYou < 99), '(3) HP dropped on BOTH sides during the fight');
      const wName = endA.winner, lName = wName === 'S26Eli' ? 'S26Fay' : 'S26Eli';
      const w0 = wName === 'S26Eli' ? eli0 : fay0, l0 = wName === 'S26Eli' ? fay0 : eli0;
      const w1 = await boardRow(wName), l1 = await boardRow(lName);
      assert(w1.gold === 150, `(3) winner gold: 100 − 25 escrow + 50 pot + 25 first-win starter = 150 (got ${w1.gold})`);
      assert(l1.gold === 75, `(3) loser gold: 100 − 25 escrow = 75, nothing back (got ${l1.gold})`);
      assert(w1.wins === w0.wins + 1 && w1.losses === w0.losses && l1.losses === l0.losses + 1 && l1.wins === l0.wins, '(3) the W/L record moves exactly one notch each way');
      assert(w1.rating === w0.rating + 11 && l1.rating === Math.max(0, l0.rating - 11), `(3) rating moves +11 / −11 (got ${w0.rating}→${w1.rating}, ${l0.rating}→${l1.rating})`);
      console.log('PASS (3) staked duel to a KO: escrow exact, pot pays exactly, record + rating move');
    }

    // ---------- (4) Free Play: combat happens, but no escrow and no record ----------
    const Gil = await login('S26Gil', PW('S26Gil')); clients.push(Gil);
    const Hal = await login('S26Hal', PW('S26Hal')); clients.push(Hal);
    {
      const gil0 = await boardRow('S26Gil'), hal0 = await boardRow('S26Hal');
      const { startA } = await startDuel(Gil, Hal, { stake: 10, freePlay: true });
      assert(startA.freePlay === true && startA.pot === 0 && startA.stake === 0, '(4) duel_start: free play coerces stake and pot to 0');
      Gil.send({ type: 'duel_attack' }); Hal.send({ type: 'duel_attack' });
      const landed = (await Gil.waitSince(0, (e) => e.type === 'duel_tick' && (e.hpYou < 99 || e.hpOpponent < 99), 60000, '(4) a landed swing in free play')).e;
      assert(landed.hpYou < 99 || landed.hpOpponent < 99, '(4) free play combat is real — HP drops');
      const gilMid = await boardRow('S26Gil'), halMid = await boardRow('S26Hal');
      assert(gilMid.gold === 100 && halMid.gold === 100, '(4) no escrow leaves either purse mid-fight');
      Hal.close();
      const endG = (await Gil.waitSince(0, (e) => e.type === 'duel_end', 20000, '(4) duel_end')).e;
      assert(endG.freePlay === true && endG.winner === 'S26Gil', '(4) the free play duel ends flagged freePlay');
      const gil1 = await boardRow('S26Gil'), hal1 = await boardRow('S26Hal');
      assert(gil1.gold === 125, `(4) winner gold moves ONLY by the +25 first-win starter — no pot (got ${gil1.gold})`);
      assert(hal1.gold === 100, `(4) loser gold is untouched (got ${hal1.gold})`);
      assert(gil1.wins === gil0.wins && gil1.losses === gil0.losses && hal1.wins === hal0.wins && hal1.losses === hal0.losses, '(4) neither W/L record moves');
      assert(gil1.rating === gil0.rating && hal1.rating === hal0.rating, '(4) neither rating moves');
      console.log('PASS (4) free play: real combat, zero escrow, zero record/rating change');
    }

    // ---------- (5) No Movement: the first engage connects with NO closing ticks ----------
    const Ivy = await login('S26Ivy', PW('S26Ivy')); clients.push(Ivy);
    const Jay = await login('S26Jay', PW('S26Jay')); clients.push(Jay);
    {
      const mI = Ivy.mark();
      await startDuel(Ivy, Jay, { rules: { noMovement: true } });
      Ivy.send({ type: 'duel_attack' }); Jay.send({ type: 'duel_attack' }); // engage during the countdown
      const deadline = Date.now() + 30000;
      let ticks = [];
      while (Date.now() < deadline) {
        ticks = Ivy.events.slice(mI).filter((e) => e.type === 'duel_tick');
        if (ticks.some((t) => typeof t.youHit === 'number' || typeof t.oppHit === 'number')) break;
        await sleep(250);
      }
      const firstSwingIdx = ticks.findIndex((t) => typeof t.youHit === 'number' || typeof t.oppHit === 'number');
      assert(firstSwingIdx >= 0, '(5) an engaged No Movement fighter swings shortly after the countdown');
      assert(ticks.slice(0, firstSwingIdx + 1).every((t) => t.closing !== true), '(5) NO closing tick appears before or on the first swing — toe-to-toe means zero closing');
      assert(ticks[firstSwingIdx].countdownLeft === 0, '(5) the first swing lands on a live tick, right as the countdown ends');
      Jay.close();
      const endI = (await Ivy.waitSince(0, (e) => e.type === 'duel_end', 20000, '(5) duel_end')).e;
      assert(endI.winner === 'S26Ivy', '(5) the No Movement duel finishes (Ivy wins by forfeit)');
      console.log('PASS (5) noMovement: first engage connects immediately, zero closing ticks');
    }

    // ---------- (6) approach audit: closing resolves, damage flows, no auto-retaliate ----------
    const Kim = await login('S26Kim', PW('S26Kim')); clients.push(Kim);
    const Lou = await login('S26Lou', PW('S26Lou')); clients.push(Lou);
    {
      await startDuel(Kim, Lou, { stake: 1 });
      await waitCountdownOver(Kim, '(6) countdown over (Kim)');
      await waitCountdownOver(Lou, '(6) countdown over (Lou)');
      Lou.send({ type: 'move', x: 1100, y: 450 }); // Lou retreats 320 east and stands there
      await sleep(500);
      Kim.send({ type: 'duel_attack' }); // Kim engages from far out of reach
      const latestArena = (c) => { for (let i = c.events.length - 1; i >= 0; i--) { const e = c.events[i]; if (e.type === 'state' && e.area === 'arena') return e; } return null; };
      let kiteSteps = 0, sawClosing = false, sawSwing = false, louMinHp = 99, kimHurt = false;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        for (const e of Kim.events) {
          if (e.type !== 'duel_tick') continue;
          if (e.closing) sawClosing = true;
          if (typeof e.youHit === 'number') sawSwing = true;
          if (typeof e.hpOpponent === 'number' && e.hpOpponent < louMinHp) louMinHp = e.hpOpponent;
          if (typeof e.hpYou === 'number' && e.hpYou < 99) kimHurt = true;
        }
        if (sawSwing && louMinHp < 99) break;
        const st = latestArena(Kim);
        if (st) {
          const kp = st.players.find((p) => p.username === 'S26Kim');
          const lp = st.players.find((p) => p.username === 'S26Lou');
          if (kp && lp) {
            const d = Math.hypot(lp.x - kp.x, lp.y - kp.y);
            if (d < 75 && kiteSteps < 2 && lp.x <= 1330) { Lou.send({ type: 'move', x: lp.x + 90, y: 450 }); kiteSteps++; }
            else if (d > 40) { const s = 55 / d; Kim.send({ type: 'move', x: Math.round(kp.x + (lp.x - kp.x) * s), y: Math.round(kp.y + (lp.y - kp.y) * s) }); }
          }
        }
        await sleep(300);
      }
      assert(sawClosing, '(6) out of reach, the engaged attacker gets closing ticks with somewhere to walk');
      assert(kiteSteps === 2, `(6) the kiting phase really happened — Lou stepped away twice as Kim closed (got ${kiteSteps})`);
      assert(sawSwing, '(6) once Kim walks into reach, her due swing fires — no permanent whiffing after a kite');
      assert(louMinHp < 99, `(6) damage lands on the stationary opponent once Kim is adjacent (Lou HP min ${louMinHp})`);
      assert(!kimHurt, '(6) Lou never engaged, so Kim takes NO damage — being hit never auto-retaliates');
      Lou.close();
      const endK = (await Kim.waitSince(0, (e) => e.type === 'duel_end', 20000, '(6) duel_end')).e;
      assert(endK.winner === 'S26Kim', '(6) the approach duel finishes (Kim wins by forfeit)');
      console.log('PASS (6) approach: closing ticks -> walk in -> swings land; kiting never wedges the fight');
    }

    // ---------- (7) disconnect mid-duel: forfeit settles, nobody is left stuck ----------
    const Mel = await login('S26Mel', PW('S26Mel')); clients.push(Mel);
    const Ned = await login('S26Ned', PW('S26Ned')); clients.push(Ned);
    const Ora = await login('S26Ora', PW('S26Ora')); clients.push(Ora);
    {
      const mel0 = await boardRow('S26Mel'), ned0 = await boardRow('S26Ned');
      await startDuel(Mel, Ned, { stake: 25 });
      Mel.send({ type: 'duel_attack' }); Ned.send({ type: 'duel_attack' });
      await Mel.waitSince(0, (e) => e.type === 'duel_tick' && (typeof e.youHit === 'number' || typeof e.oppHit === 'number'), 30000, '(7) the fight is live');
      Ned.close(); // mid-duel disconnect
      const endM = (await Mel.waitSince(0, (e) => e.type === 'duel_end', 20000, '(7) duel_end')).e;
      assert(endM.winner === 'S26Mel' && /forfeit/.test(endM.reason), `(7) disconnect mid-duel forfeits to the fighter who stayed (reason: ${endM.reason})`);
      const mel1 = await boardRow('S26Mel');
      assert(mel1.gold === 150 && mel1.wins === mel0.wins + 1 && mel1.rating === mel0.rating + 11, `(7) the forfeit pays out like a win: pot + record + rating (gold ${mel1.gold})`);
      // Re-login can race the server processing the disconnect
      // ("already signed in") — retry until the old session clears.
      let Ned2 = null;
      for (let i = 0; i < 12 && !Ned2; i++) { try { Ned2 = await login('S26Ned', PW('S26Ned')); } catch { await sleep(700); } }
      assert(!!Ned2, '(7) Ned can sign back in once the disconnect settles');
      clients.push(Ned2);
      const nedState = await Ned2.waitFor((e) => e.type === 'state' && e.players.some((p) => p.username === 'S26Ned'), 10000, '(7) Ned state after re-login');
      const nedSelf = nedState.players.find((p) => p.username === 'S26Ned');
      assert(nedState.area === 'plaza' && nedSelf.inDuel === false, '(7) the disconnected fighter re-logs into the plaza, NOT stuck in a duel');
      const ned1 = await boardRow('S26Ned');
      assert(ned1.gold === 75 && ned1.losses === ned0.losses + 1 && ned1.rating === Math.max(0, ned0.rating - 11), `(7) the forfeit loss is on Ned's record (gold ${ned1.gold})`);
      const rematch = await startDuel(Mel, Ora, { stake: 1 });
      assert(!!rematch.startA, '(7) the winner can immediately duel someone else — no stuck duel state');
      Ora.close();
      await Mel.waitSince(0, (e) => e.type === 'duel_end', 20000, '(7) rematch duel_end');
      console.log('PASS (7) disconnect mid-duel: forfeit settles exactly, both sides free afterwards');
    }

    // ---------- (8) mod-NPC duel through to payout (kite win vs Mod Ash) ----------
    const Paz = await login('S26Paz', PW('S26Paz')); clients.push(Paz);
    {
      const paz0 = await boardRow('S26Paz');
      Paz.send({ type: 'move', x: 580, y: 300 }); // 100 units west of Mod Ash (680,300) — bow range, out of his reach
      await sleep(400);
      const mP = Paz.mark();
      Paz.send({ type: 'mod_duel_start', id: 'mod1' });
      const start = (await Paz.waitSince(mP, (e) => e.type === 'mod_duel' && e.phase === 'start', 10000, '(8) mod_duel start')).e;
      assert(start.stake === 100 && start.pot === 200, '(8) Tier 1: 100g stake, 200g pot');
      Paz.send({ type: 'mod_duel_attack' });
      const end = (await Paz.waitSince(mP, (e) => e.type === 'mod_duel' && e.phase === 'end', 300000, '(8) mod_duel end')).e;
      assert(end.result === 'win' && end.payout === 200, `(8) the kite win pays the full 200g pot (result: ${end.result})`);
      const paz1 = await boardRow('S26Paz');
      assert(paz1.gold === 625, `(8) gold: 500 − 100 stake + 200 pot + 25 first-win starter = 625 (got ${paz1.gold})`);
      assert(paz1.wins === paz0.wins && paz1.losses === paz0.losses && paz1.rating === paz0.rating, '(8) a mod win touches NEITHER the duel record NOR the rating');
      const ladder = (await Paz.waitSince(mP, (e) => e.type === 'mod_ladder' && e.wins && e.wins.t1 === 1, 10000, '(8) mod_ladder push')).e;
      assert(ladder.wins.t1 === 1, '(8) the Tier 1 win is banked on the ladder (1/3)');
      console.log('PASS (8) mod duel: stake escrowed, pot paid, ladder banked, record/rating untouched');
    }

    // ---------- (9) Stake Board duel through to payout ----------
    const Quin = await login('S26Quin', PW('S26Quin')); clients.push(Quin);
    const Rae = await login('S26Rae', PW('S26Rae')); clients.push(Rae);
    {
      const quin0 = await boardRow('S26Quin'), rae0 = await boardRow('S26Rae');
      const mQ = Quin.mark(), mR = Rae.mark();
      Quin.send({ type: 'stake_offer_create', stake: 25 });
      const board = (await Rae.waitSince(mR, (e) => e.type === 'stake_board' && (e.offers || []).some((o) => o.username === 'S26Quin' && o.stake === 25), 10000, '(9) stake_board offer')).e;
      const offer = board.offers.find((o) => o.username === 'S26Quin' && o.stake === 25);
      Rae.send({ type: 'stake_offer_accept', offerId: offer.id });
      const matchedQ = (await Quin.waitSince(mQ, (e) => e.type === 'stake_matched', 10000, '(9) stake_matched (poster)')).e;
      const matchedR = (await Rae.waitSince(mR, (e) => e.type === 'stake_matched', 10000, '(9) stake_matched (acceptor)')).e;
      assert(matchedQ.matchId === matchedR.matchId && matchedQ.pot === 50, '(9) both sides matched on one 25g fight, pot 50g');
      Quin.send({ type: 'stake_ready', matchId: matchedQ.matchId });
      Rae.send({ type: 'stake_ready', matchId: matchedR.matchId });
      const startQ = (await Quin.waitSince(mQ, (e) => e.type === 'duel_start', 10000, '(9) duel_start (poster)')).e;
      assert(startQ.stake === 25 && startQ.pot === 50, '(9) the board duel starts through the normal duel engine, 25g / 50g pot');
      Quin.send({ type: 'duel_attack' }); Rae.send({ type: 'duel_attack' });
      await Quin.waitSince(mQ, (e) => e.type === 'duel_tick' && (typeof e.youHit === 'number' || typeof e.oppHit === 'number'), 30000, '(9) the board fight is live');
      Rae.close();
      const endQ = (await Quin.waitSince(mQ, (e) => e.type === 'duel_end', 20000, '(9) duel_end')).e;
      assert(endQ.winner === 'S26Quin' && endQ.pot === 50, '(9) the board duel pays the 50g pot to the winner');
      const quin1 = await boardRow('S26Quin'), rae1 = await boardRow('S26Rae');
      assert(quin1.gold === 150 && quin1.wins === quin0.wins + 1, `(9) winner: 100 − 25 + 50 pot + 25 starter = 150 (got ${quin1.gold})`);
      assert(rae1.gold === 75 && rae1.losses === rae0.losses + 1, `(9) loser: 100 − 25 = 75 with the loss recorded (got ${rae1.gold})`);
      console.log('PASS (9) stake board: offer -> match -> ready -> duel -> pot pays exactly');
    }

    console.log('ALL STAGE 26 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
