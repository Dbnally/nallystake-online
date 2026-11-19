// Stage 30 tests: the Wilderness.
//   * walk-in entry through the plaza ditch gate + obelisk
//     teleport in; Wilderness level rises with depth (1 at the
//     ditch → 51 far north); teleport OUT refused above level 20
//     (and a gate exit only counts beside the ditch); gate exit
//     works; entering Pure Wild only via PK Noob.
//   * combat bracket: an attack order outside ±(wild level) of
//     combat levels is refused; inside it, accepted.
//   * face-and-chase (Derek, 2026-11-18): a distant attack order
//     produces closing ticks whose moveTo walks the attacker
//     toward the target (positions converge as the client walks),
//     and NO swing lands before the attacker is in reach.
//   * skulling: first strike skulls (snapshot 💀), fighting back
//     doesn't, shallow wild is single-way (no piling), the skull
//     persists in the wild and clears on leaving.
//   * Leave walks you out: wild_leave alone ends nothing; the
//     fight clears only when the ditch crossing fires.
//   * death drops: unskulled keeps exactly the 3 most valuable
//     stacks + all worn gear, the rest lands as piles the killer
//     can loot; skulled drops EVERYTHING (backpack + worn + gold).
//   * NPC PKers spawn, acquire an in-bracket player, attack, can
//     be fought back and killed for pile loot.
//   * Pure Wild: prayer + food hard-refused server-side; prayer
//     cleared on entry; normal-wild prayer works.
//   * disconnect mid-wild-fight = death with drops.
//   * guards: shops / bank / duel challenges refused in the wild.
// Same harness style as test/stage29.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18130;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage30.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

function assert(cond, label) {
  if (!cond) throw new Error('ASSERT FAILED: ' + label);
  console.log('PASS ' + label);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The server's XP table + wild level mapping, replicated so seeds
// and expectations are computed, not guessed.
const XP_TABLE = [0, 0];
{ let points = 0; for (let lvl = 2; lvl <= 99; lvl++) { const x = lvl - 1; points += Math.floor(x + 300 * Math.pow(2, x / 7)); XP_TABLE[lvl] = Math.floor(points / 4); } }
const xpFor = (l) => XP_TABLE[Math.max(1, Math.min(99, l))] || 0;
const wildLevelAt = (y) => 1 + Math.floor(Math.max(0, Math.min(1, (880 - y) / 880)) * 50);

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
  terminate() { try { this.ws.terminate(); } catch { /* ignore */ } }
}
const PW = (n) => 's30-pass-' + n;
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
const stacksOf = (profile, item) => (profile.backpack || []).filter((x) => x.item === item);
const stackQty = (profile, item) => stacksOf(profile, item).reduce((n, s) => n + s.qty, 0);
function latestPos(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? { x: p.x, y: p.y } : null;
}
function latestSkulled(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? !!p.skulled : null;
}
// Walk a client to a spot the way the real client does: stepped
// move messages (the server takes client-driven positions).
async function walkTo(c, x, y, steps = 10) {
  const from = latestPos(c, c.name) || { x: 800, y: 845 };
  for (let i = 1; i <= steps; i++) {
    c.send({ type: 'move', x: Math.round(from.x + (x - from.x) * (i / steps)), y: Math.round(from.y + (y - from.y) * (i / steps)) });
    await sleep(90);
  }
  await sleep(250);
}
async function enterWild(c, label) {
  const m = c.mark();
  c.send({ type: 'travel', to: 'wilderness', via: 'teleport' });
  await c.waitSince(m, (e) => e.type === 'area' && e.area === 'wilderness', 10000, label + ' area');
  const ws = await c.waitSince(m, (e) => e.type === 'wild_state' && e.area === 'wilderness', 10000, label + ' wild_state');
  return ws.e;
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/const WILD_AREAS = \['wilderness', 'purewild'\]/.test(src) && /function wildLevelAt/.test(src), 'source: wild areas + level mapping');
  assert(/function wildDeath/.test(src) && /function stackValueOf/.test(src) && /most valuable stack/.test(src), 'source: wild death + 3-kept-stacks valuation');
  assert(/TELEBLOCK_MS = 12000/.test(src) && /teleblock/.test(src) && /Hex Hanna/.test(src), 'source: Hex Hanna teleblock, 12s');
  assert(/no teleporting out above Wilderness level 20/.test(src) && /WILD_EXIT_MIN_Y = 840/.test(src), 'source: teleport-out level rule + ditch-side gate rule');
  assert(/Pure Wild — no prayer/.test(src) && /Pure Wild — no food, no potions/.test(src), 'source: Pure Wild hard blocks (prayer + food/potions)');
  assert(/'Rusher Rex'/.test(src) && /'Wild Wanda'/.test(src) && /'Hex Hanna'/.test(src) && /'Bolt Bram'/.test(src) && /'Sir Stabsalot'/.test(src) && /'Queen Venom'/.test(src), 'source: the app PKer roster (6 PKers)');
  assert(/while in a wild fight is a DEATH in the wild/.test(src) && /wildDeath\(key, null, \{ disconnect: true \}\)/.test(src), 'source: disconnect in a wild fight = death with drops');
  assert(/guardians never follow into the Wilderness/.test(src), 'source: Tree Guardians wait outside the wild');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/function buildWilderness/.test(clientSrc) && /areaGroups\.purewild/.test(clientSrc), 'client: wilderness + purewild scenery builders wired');
  assert(/id="wildchip"/.test(clientSrc) && /function renderWildChip/.test(clientSrc) && /Wilderness.*level:/.test(clientSrc) && /SKULLED/.test(clientSrc), 'client: HUD chip shows Wilderness level + 💀 skulled + teleblock');
  assert(/id="pknoobmodal"/.test(clientSrc) && /window\.openPkNoob/.test(clientSrc) && /pk_noob_hop/.test(clientSrc), 'client: PK Noob modal + hop');
  assert(/pmWildAttack/.test(clientSrc) && /💀 Attack/.test(clientSrc), 'client: the wild player menu leads with Attack');
  assert(/via:'gate'/.test(clientSrc) && /via:'teleport'/.test(clientSrc), 'client: gate crossings and teleports are labelled (the exit rule reads them)');
  assert(/function wildLeave/.test(clientSrc) && /type:'wild_leave'/.test(clientSrc) && /Leave \(walk out\)/.test(clientSrc), 'client: the fight strip Leave chip walks you out');
  assert(/function wildFightUI/.test(clientSrc) && /applyClosing\(m\)/.test(clientSrc) && /💀 \$\{curArea==='purewild'\?'Pure Wild':'Wilderness'\}/.test(clientSrc), 'client: wild fights share the fight strip (context chip + closing chase)');
  assert(/pkerAvatars/.test(clientSrc) && /function syncPkers/.test(clientSrc) && /skbadge/.test(clientSrc) && /p\.skulled/.test(clientSrc), 'client: PKer avatars + 💀 skull badge from the snapshot');
  assert(/m\.context==='wild'/.test(clientSrc) && /armedCastAt\('wild'/.test(clientSrc), 'client: button casts route to wild targets');
  assert(/startSwingAt\(myAv,oa,true\)/.test(clientSrc) && /wildOppAvatar\(\)/.test(clientSrc), 'client: wild swings face the opponent (Stage 26 swing/facing machinery)');
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs); // throws on a syntax error
  console.log('PASS source: client inline script parses');

  // ---------- register everyone, then seed ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  const track = (c) => { clients.push(c); return c; };
  try {
    const names = ['S30Walker', 'S30Atk', 'S30Def', 'S30Third', 'S30Leaver', 'S30Hunter', 'S30Killer', 'S30Victim', 'S30Skull', 'S30Bait', 'S30Reaper', 'S30Prey', 'S30PkHunter', 'S30Pure', 'S30Ghost', 'S30Witness'];
    for (const n of names) { const c = await register(n); c.close(); }
    await stopServer();
    const G = (qty) => ({ item: 'gold', qty });
    // Combat ~24.7 (atk 22, str 10, def 12, hp 45): matched pairs
    // for the PvP choreography — and deliberately OUT of every
    // PKer's bracket even at the north edge of their wander
    // range (tightest is Rusher Rex: |45 - 24.7| = 20.3 > his
    // wander-max level 20), so no PKer can wander into these
    // scripted fights.
    const matched47 = (p) => { p.xp.attack = xpFor(22); p.xp.strength = xpFor(10); p.xp.defence = xpFor(12); p.xp.hitpoints = xpFor(45); };
    seedDb((data) => {
      const set = (name, mut) => { const u = data.users[name.toLowerCase()]; if (!u) throw new Error('seed: no user ' + name); mut(u.profile); };
      set('S30Walker', (p) => { p.backpack = [G(100), { item: 'ration', qty: 1 }]; });
      set('S30Atk', (p) => { matched47(p); p.worn.weapon = 'bronze_sword'; p.backpack = [G(100), { item: 'ration', qty: 3 }]; });
      set('S30Def', (p) => { matched47(p); p.worn.weapon = 'bronze_sword'; p.backpack = [G(100), { item: 'ration', qty: 3 }]; });
      set('S30Third', (p) => { matched47(p); p.worn.weapon = 'bronze_sword'; p.backpack = [G(100)]; });
      set('S30Leaver', (p) => { matched47(p); p.worn.weapon = 'bronze_sword'; p.backpack = [G(100)]; });
      set('S30Hunter', (p) => { matched47(p); p.worn.weapon = 'bronze_sword'; p.backpack = [G(100)]; });
      // Killer: combat 53.25 (atk/str 50, def 10, hp 73) — diff
      // 49.85 vs a fresh account, inside the ±50 bracket at the
      // far north (the reachable level tops out at 50: y clamps
      // at 10). He WILL draw a deep-wild PKer pile-on while he
      // works — the kill is fast (victim HP 10) and his 73 HP
      // absorbs the few hits that land in that window.
      set('S30Killer', (p) => { p.xp.attack = xpFor(50); p.xp.strength = xpFor(50); p.xp.defence = xpFor(10); p.xp.hitpoints = xpFor(73); p.worn.weapon = 'dragon_sword'; p.backpack = [G(100)]; });
      // Victim: fresh combat 3.4 / HP 10. Kept-stack order is unambiguous:
      // dragon partyhat (32M buy) > rune partyhat (16M) > gold 5000 > steel sword > logs.
      set('S30Victim', (p) => {
        p.backpack = [G(5000), { item: 'dragon_partyhat', qty: 1 }, { item: 'rune_partyhat', qty: 1 }, { item: 'steel_sword', qty: 1 }, { item: 'logs', qty: 10 }];
        p.worn.weapon = 'mithril_sword'; p.worn.head = 'steel_helm';
      });
      // Skull: combat 20.9 (matched27 with hp 30) — the Reaper
      // (67.25) brackets him at level 47+ (y <= ~60), and 30 HP
      // dies in 1-2 Reaper hits, before the deep-wild pile-on
      // that gathers around a combat-67 fighter can kill the
      // Reaper first.
      set('S30Skull', (p) => { p.xp.attack = xpFor(22); p.xp.strength = xpFor(10); p.xp.defence = xpFor(12); p.xp.hitpoints = xpFor(30); p.worn.weapon = 'bronze_sword'; p.worn.head = 'iron_helm'; p.backpack = [G(777), { item: 'steel_sword', qty: 1 }, { item: 'logs', qty: 3 }]; });
      set('S30Bait', (p) => { p.xp.attack = xpFor(22); p.xp.strength = xpFor(10); p.xp.defence = xpFor(12); p.backpack = [G(100)]; });
      // Reaper: combat 67.25 (atk/str 50, def 40, hp 99).
      set('S30Reaper', (p) => { p.xp.attack = xpFor(50); p.xp.strength = xpFor(50); p.xp.defence = xpFor(40); p.xp.hitpoints = xpFor(99); p.worn.weapon = 'dragon_sword'; p.backpack = [G(100)]; });
      // Prey: combat 48 (atk/str 45, def 30, hp 45).
      set('S30Prey', (p) => { p.xp.attack = xpFor(45); p.xp.strength = xpFor(45); p.xp.defence = xpFor(30); p.xp.hitpoints = xpFor(45); p.worn.weapon = 'steel_sword'; p.backpack = [G(100), { item: 'ration', qty: 2 }]; });
      // PkHunter: combat 55.75 (atk/str 50, def 10, hp 83). His
      // target is Rusher Rex (cbt 45, diff 10.75): a combat-72
      // hunter at Wanda's home ground drew the WHOLE roster
      // (Stabs + Venom included) and died to the pile before
      // finishing her — measured in a repro. And the diff must
      // fit Rex's bracket at the SOUTH edge of his wander range
      // too (level 11 at y~711), or he sometimes never engages.
      // At 55.75 Venom can never bracket him, and 83 HP +
      // rations absorb the Wanda/Hanna/Bram attention.
      set('S30PkHunter', (p) => { p.xp.attack = xpFor(50); p.xp.strength = xpFor(50); p.xp.defence = xpFor(10); p.xp.hitpoints = xpFor(83); p.worn.weapon = 'dragon_sword'; p.backpack = [G(100), { item: 'ration', qty: 10 }]; });
      set('S30Pure', (p) => { p.backpack = [G(100), { item: 'ration', qty: 2 }]; p.activePrayer = 'melee'; p.prayerPoints = 25; });
      set('S30Ghost', (p) => { matched47(p); p.worn.head = 'iron_helm'; p.backpack = [G(777), { item: 'steel_sword', qty: 1 }]; });
      set('S30Witness', (p) => { matched47(p); p.worn.weapon = 'bronze_sword'; p.backpack = [G(100)]; });
    });
    await startServer();

    // ---------- (1) entry, levels, teleport rules, guards ----------
    const walker = track(await loginClient('S30Walker'));
    // Walk-in through the ditch gate: stand on the plaza's north
    // edge (east stretch) and cross via a gate travel.
    walker.send({ type: 'move', x: 1290, y: 5 });
    await sleep(300);
    {
      const m = walker.mark();
      walker.send({ type: 'travel', to: 'wilderness', via: 'gate' });
      await walker.waitSince(m, (e) => e.type === 'area' && e.area === 'wilderness', 10000, 'gate entry area');
      const st = (await walker.waitSince(m, (e) => e.type === 'wild_state' && e.area === 'wilderness', 10000, 'gate entry wild_state')).e;
      assert(st.you && st.you.level === wildLevelAt(845), 'walk-in: ditch gate entry lands at the wild spawn, level ' + wildLevelAt(845));
      assert(Array.isArray(st.pkers) && st.pkers.length === 6, 'wild_state: all 6 PKers are standing in the Wilderness');
      assert(st.you.skulled === false && st.you.hp === 10, 'wild entry: fresh skull state + HP pool = Hitpoints level (10)');
    }
    // Guards in the wild.
    {
      const e1 = await expectError(walker, { type: 'shop_buy', item: 'bronze_sword', qty: 1 }, 'shop guard');
      assert(/no shops in the Wilderness/.test(e1.message), 'guard: shop_buy refused in the wild');
      const e2 = await expectError(walker, { type: 'bank_deposit', item: 'gold', qty: 1 }, 'bank guard');
      assert(/no bank in the Wilderness/.test(e2.message), 'guard: bank refused in the wild');
    }
    // Prayer works in the NORMAL wild.
    {
      const m = walker.mark();
      walker.send({ type: 'prayer', prayer: 'melee' });
      const pe = (await walker.waitSince(m, (e) => e.type === 'profile' && e.profile.activePrayer === 'melee', 10000, 'wild prayer on')).e;
      assert(pe.profile.activePrayer === 'melee', 'normal wild: prayer activates fine');
      walker.send({ type: 'prayer', prayer: null });
      await sleep(300);
    }
    // Level rises with depth; teleport out refused deep — by
    // teleport AND by a "gate" travel that isn't beside the ditch.
    await walkTo(walker, 800, 300);
    {
      const st = await walker.waitFor((e) => e.type === 'wild_state' && e.you && e.you.level === wildLevelAt(300), 10000, 'level at y=300');
      assert(st.you.level === 33 && st.you.level > wildLevelAt(845), 'levels rise with depth: spawn ' + wildLevelAt(845) + ' → y=300 is ' + st.you.level);
      const e1 = await expectError(walker, { type: 'travel', to: 'plaza', via: 'teleport' }, 'teleport-out refusal');
      assert(/no teleporting out above Wilderness level 20/.test(e1.message), 'teleport out refused above level 20');
      const e2 = await expectError(walker, { type: 'travel', to: 'plaza', via: 'gate' }, 'gate-from-deep refusal');
      assert(/no teleporting out above Wilderness level 20/.test(e2.message), 'a gate exit only counts beside the ditch (deep "gate" travel is treated as a teleport)');
    }
    // Back beside the ditch, teleporting out is allowed again.
    await walkTo(walker, 800, 860);
    {
      const m = walker.mark();
      walker.send({ type: 'travel', to: 'plaza', via: 'teleport' });
      await walker.waitSince(m, (e) => e.type === 'area' && e.area === 'plaza', 10000, 'teleport out at low level');
      assert(true, 'teleport out allowed at/below level 20');
    }
    // Pure Wild is NOT travel-reachable.
    {
      const e = await expectError(walker, { type: 'travel', to: 'purewild', via: 'teleport' }, 'pure travel refusal');
      assert(/PK Noob/.test(e.message), 'Pure Wild entry is PK Noob only');
    }

    // ---------- (2) bracket refusal ----------
    const def = track(await loginClient('S30Def'));
    await enterWild(def, 'def');
    await enterWild(walker, 'walker re-entry');
    {
      const e3 = await expectError(walker, { type: 'challenge', target: 'S30Def', stake: 0, items: [], freePlay: true }, 'challenge guard');
      assert(/No duels in the Wilderness/.test(e3.message), 'guard: duel challenge refused in the wild (either side in the wild)');
      const e = await expectError(walker, { type: 'wild_attack', target: 'S30Def' }, 'bracket refusal');
      assert(/bracket/.test(e.message), 'bracket: combat 3 vs 26 refused at ditch level (±' + wildLevelAt(845) + ')');
    }

    // ---------- (3) face-and-chase + skulling + single-way ----------
    const atk = track(await loginClient('S30Atk'));
    await enterWild(atk, 'atk');
    await walkTo(def, 800, 330);
    await walkTo(atk, 800, 560);
    {
      const mA = atk.mark(); const mD = def.mark();
      atk.send({ type: 'wild_attack', target: 'S30Def' });
      const startA = (await atk.waitSince(mA, (e) => e.type === 'wild_fight' && e.phase === 'start' && e.oppName === 'S30Def', 10000, 'chase start (attacker)')).e;
      const startD = (await def.waitSince(mD, (e) => e.type === 'wild_fight' && e.phase === 'start', 10000, 'chase start (defender)')).e;
      assert(startA.oppName === 'S30Def' && startD.theyStarted === true, 'wild fight starts for both; the defender sees they were attacked');
      // Skull: the first striker is skulled in the snapshot; the
      // defender is not.
      await def.waitFor((e) => e.type === 'state' && Array.isArray(e.players) && e.players.some((p) => p.username === 'S30Atk' && p.skulled === true), 10000, 'attacker skulled in snapshot');
      assert(latestSkulled(def, 'S30Def') === false, 'skull: the defender is NOT skulled');
      // Distant order: closing ticks, moveTo tracking the target,
      // and NO swing lands while far away (~2.5s of ticks).
      const t0 = Date.now();
      let closingTicks = 0; let earlySwing = false; let moveToOk = true;
      while (Date.now() - t0 < 2500) {
        const idx = atk.mark();
        const tk = (await atk.waitSince(idx, (e) => e.type === 'wild_fight' && e.phase === 'tick', 4000, 'closing tick')).e;
        if (tk.closing) {
          closingTicks++;
          if (typeof tk.youHit === 'number' || typeof tk.oppHit === 'number') earlySwing = true;
          const dp = latestPos(atk, 'S30Def'); const ap = latestPos(atk, 'S30Atk');
          if (dp && ap && tk.moveTo) {
            const before = Math.hypot(ap.x - dp.x, ap.y - dp.y);
            const after = Math.hypot(tk.moveTo.x - dp.x, tk.moveTo.y - dp.y);
            if (!(after < before)) moveToOk = false;
          }
        }
      }
      assert(closingTicks >= 2 && !earlySwing, 'face-and-chase: distant attack order → closing ticks, no swing lands out of reach');
      assert(moveToOk, 'face-and-chase: every closing moveTo steps the attacker TOWARD the target (the facing/chase vector)');
      // Now the client walks in (run-or-walk is client movement):
      // positions converge, and the first landed swing only
      // happens once the fighters are close.
      let firstHitDist = null; let lastDist = 230;
      const chaseDeadline = Date.now() + 30000;
      while (Date.now() < chaseDeadline && firstHitDist === null) {
        const dp = latestPos(atk, 'S30Def'); const ap = latestPos(atk, 'S30Atk');
        if (dp && ap) {
          lastDist = Math.hypot(ap.x - dp.x, ap.y - dp.y);
          if (lastDist > 30) atk.send({ type: 'move', x: Math.round(ap.x + (dp.x - ap.x) * 0.35), y: Math.round(ap.y + (dp.y - ap.y) * 0.35) });
        }
        const idx = atk.mark();
        try {
          const tk = (await atk.waitSince(idx, (e) => e.type === 'wild_fight' && e.phase === 'tick', 1500, 'chase tick')).e;
          if (typeof tk.youHit === 'number') {
            const dp2 = latestPos(atk, 'S30Def'); const ap2 = latestPos(atk, 'S30Atk');
            firstHitDist = dp2 && ap2 ? Math.hypot(ap2.x - dp2.x, ap2.y - dp2.y) : 0;
          }
        } catch { /* keep chasing */ }
      }
      assert(firstHitDist !== null, 'face-and-chase: the attacker closes and a swing lands after arriving');
      assert(firstHitDist <= 80, 'face-and-chase: the first landed swing happens in reach (dist ' + Math.round(firstHitDist) + ' ≤ 80 incl. snapshot lag), never from statue range');
      // Fighting back does NOT skull the defender.
      def.send({ type: 'wild_attack', target: 'S30Atk' });
      def.send({ type: 'use', item: 'ration' }); // eating mid-wild-fight is allowed — and tops him up for the walk-out
      await sleep(1500);
      assert(latestSkulled(atk, 'S30Def') === false, 'skull: fighting back against your attacker never skulls you');
      assert(latestSkulled(atk, 'S30Atk') === true, 'skull: the first striker stays skulled while in the wild (no countdown)');
      // Single-way: a third player cannot pile onto the defender.
      const third = track(await loginClient('S30Third'));
      await enterWild(third, 'third');
      // Stand beside the ATTACKER (level 19 ground): the pair's
      // shallower level is < 20, so single-way rules apply.
      await walkTo(third, 810, 555);
      const e3 = await expectError(third, { type: 'wild_attack', target: 'S30Def' }, 'single-way refusal');
      assert(/already in a fight/.test(e3.message), 'single-way: shallow wild refuses a third fighter piling on');
      third.close();
      // Defender leaves across the ditch: fight ends both sides.
      await walkTo(def, 800, 860);
      const mA2 = atk.mark(); const mD2 = def.mark();
      def.send({ type: 'travel', to: 'plaza', via: 'gate' });
      const endD = (await def.waitSince(mD2, (e) => e.type === 'wild_fight' && e.phase === 'end', 10000, 'defender exit end')).e;
      const endA = (await atk.waitSince(mA2, (e) => e.type === 'wild_fight' && e.phase === 'end', 10000, 'attacker exit end')).e;
      assert(endD.reason === 'left' && endA.reason === 'escaped', 'crossing the ditch ends the fight (leaver: left, opponent: escaped)');
      // The attacker's skull clears once HE leaves too.
      await walkTo(atk, 800, 860);
      const mA3 = atk.mark();
      atk.send({ type: 'travel', to: 'plaza', via: 'teleport' });
      await atk.waitSince(mA3, (e) => e.type === 'area' && e.area === 'plaza', 10000, 'attacker leaves');
      await enterWild(atk, 'atk re-entry');
      const stA = await atk.waitFor((e) => e.type === 'wild_state' && e.you, 10000, 'atk re-entry state');
      assert(stA.you.skulled === false, 'skull: cleared by leaving the Wilderness');
      atk.close(); def.close();
    }

    // ---------- (4) Leave WALKS you out ----------
    const leaver = track(await loginClient('S30Leaver'));
    const hunter = track(await loginClient('S30Hunter'));
    await enterWild(leaver, 'leaver');
    await enterWild(hunter, 'hunter');
    await walkTo(leaver, 400, 700);
    await walkTo(hunter, 425, 700);
    {
      hunter.send({ type: 'wild_attack', target: 'S30Leaver' });
      await hunter.waitFor((e) => e.type === 'wild_fight' && e.phase === 'start', 10000, 'leave-test start');
      leaver.send({ type: 'wild_attack', target: 'S30Hunter' });
      // Pressing Leave alone ends NOTHING — ticks keep coming.
      const mL = leaver.mark();
      leaver.send({ type: 'wild_leave' });
      const tk = (await leaver.waitSince(mL, (e) => e.type === 'wild_fight' && e.phase === 'tick', 6000, 'tick after Leave pressed')).e;
      assert(tk.phase === 'tick', 'Leave: pressing it does not pop you out — the fight is still live while you walk');
      const noEnd = leaver.events.slice(mL).some((e) => e.type === 'wild_fight' && e.phase === 'end');
      assert(!noEnd, 'Leave: no fight end arrives until the crossing');
      // Walk south and cross: only NOW does the fight clear.
      await walkTo(leaver, 800, 865, 14);
      const mL2 = leaver.mark(); const mH2 = hunter.mark();
      leaver.send({ type: 'travel', to: 'plaza', via: 'gate' });
      const endL = (await leaver.waitSince(mL2, (e) => e.type === 'wild_fight' && e.phase === 'end', 10000, 'leave crossing end (leaver)')).e;
      const endH = (await hunter.waitSince(mH2, (e) => e.type === 'wild_fight' && e.phase === 'end', 10000, 'leave crossing end (hunter)')).e;
      assert(endL.reason === 'left' && endH.reason === 'escaped', 'Leave: the fight clears on the ditch crossing, not before');
      leaver.close(); hunter.close();
    }

    // ---------- (5) unskulled death: keep 3 stacks + worn ----------
    const killer = track(await loginClient('S30Killer'));
    const victim = track(await loginClient('S30Victim'));
    await enterWild(killer, 'killer');
    await enterWild(victim, 'victim');
    await walkTo(killer, 800, 15, 8);
    await walkTo(victim, 822, 15, 8);
    {
      const mK = killer.mark(); const mV = victim.mark();
      killer.send({ type: 'wild_attack', target: 'S30Victim' });
      await killer.waitSince(mK, (e) => e.type === 'wild_fight' && e.phase === 'start', 10000, 'kill start');
      const endK = (await killer.waitSince(mK, (e) => e.type === 'wild_fight' && e.phase === 'end', 60000, 'kill end (killer)')).e;
      const endV = (await victim.waitSince(mV, (e) => e.type === 'wild_fight' && e.phase === 'end', 10000, 'kill end (victim)')).e;
      assert(endK.reason === 'kill' && endV.reason === 'death', 'unskulled kill: fight ends kill/death (killer: ' + JSON.stringify(endK) + ' victim: ' + JSON.stringify(endV) + ')');
      // The victim kept exactly the 3 most valuable stacks + worn.
      const vp = await prof('S30Victim');
      const keptIds = (vp.backpack || []).map((s) => s.item).sort();
      assert(JSON.stringify(keptIds) === JSON.stringify(['dragon_partyhat', 'gold', 'rune_partyhat']), 'unskulled death: kept exactly the 3 most valuable stacks (dragon hat, rune hat, 5000g) — got ' + keptIds.join(','));
      // (The stack reads 5025 in practice: entering the wild
      // completed a starter goal on the way in, +25g through
      // addGold — legitimate pre-death gold, kept whole.)
      assert(stackQty(vp, 'gold') >= 5000, 'unskulled death: the gold stack was among the kept (seeded 5000 intact) — backpack: ' + JSON.stringify(vp.backpack));
      assert(vp.worn && vp.worn.weapon === 'mithril_sword' && vp.worn.head === 'steel_helm', 'unskulled death: worn gear is SAFE (sword + helm still worn)');
      // The rest is on the ground as piles, and the killer loots one.
      const pilesEv = await killer.waitFor((e) => e.type === 'piles' && e.area === 'wilderness' && (e.piles || []).some((p) => p.item === 'steel_sword' && p.owner === 'S30Victim'), 10000, 'victim drop piles');
      const swordPile = pilesEv.piles.find((p) => p.item === 'steel_sword');
      assert((pilesEv.piles || []).some((p) => p.item === 'logs' && p.qty === 10), 'unskulled death: the non-kept stacks dropped as piles (steel sword + logs x10)');
      const mK2 = killer.mark();
      killer.send({ type: 'pickup', pileId: swordPile.id });
      await killer.waitSince(mK2, (e) => e.type === 'profile' && (e.profile.backpack || []).some((s) => s.item === 'steel_sword'), 10000, 'killer loots the sword pile');
      assert(true, 'loot: the killer picks up a dropped pile');
      killer.close(); victim.close();
    }

    // ---------- (6) skulled death: EVERYTHING drops ----------
    const skull = track(await loginClient('S30Skull'));
    const bait = track(await loginClient('S30Bait'));
    const reaper = track(await loginClient('S30Reaper'));
    await enterWild(skull, 'skull');
    await enterWild(bait, 'bait');
    await enterWild(reaper, 'reaper');
    await walkTo(skull, 800, 60, 12);
    await walkTo(bait, 824, 60, 12);
    await walkTo(reaper, 776, 60, 12);
    {
      // Skull strikes first (→ skulled), then the Reaper kills him.
      skull.send({ type: 'wild_attack', target: 'S30Bait' });
      await skull.waitFor((e) => e.type === 'wild_fight' && e.phase === 'start', 10000, 'skull start');
      await reaper.waitFor((e) => e.type === 'state' && Array.isArray(e.players) && e.players.some((p) => p.username === 'S30Skull' && p.skulled === true), 10000, 'skull visible to others');
      const mR = reaper.mark(); const mS = skull.mark();
      reaper.send({ type: 'wild_attack', target: 'S30Skull' });
      await reaper.waitSince(mR, (e) => e.type === 'wild_fight' && e.phase === 'start' && e.oppName === 'S30Skull', 10000, 'reaper start');
      skull.send({ type: 'wild_attack', target: 'S30Reaper' }); // he fights back — and still dies (Reaper: 99 HP, def 40)
      const endS = (await skull.waitSince(mS, (e) => e.type === 'wild_fight' && e.phase === 'end' && e.oppName === 'S30Reaper', 90000, 'skulled death end')).e;
      assert(endS.reason === 'death', 'skulled death: the skulled fighter dies to the Reaper — got ' + JSON.stringify(endS));
      const sp = await prof('S30Skull');
      assert((sp.backpack || []).length === 0, 'skulled death: the WHOLE backpack dropped (nothing kept)');
      assert(sp.worn && Object.values(sp.worn).every((v) => v === null), 'skulled death: worn gear dropped too (every slot empty)');
      const pilesEv = await reaper.waitFor((e) => e.type === 'piles' && e.area === 'wilderness' && (e.piles || []).some((p) => p.item === 'gold' && p.qty >= 777 && p.owner === 'S30Skull'), 10000, 'skulled drop piles');
      const items = (pilesEv.piles || []).filter((p) => p.owner === 'S30Skull').map((p) => p.item);
      assert(items.includes('steel_sword') && items.includes('logs') && items.includes('iron_helm') && items.includes('bronze_sword'), 'skulled death: gold + backpack + worn pieces all on the ground as piles (' + items.join(',') + ')');
      skull.close(); bait.close(); reaper.close();
    }

    // ---------- (7) PKer acquires, attacks, is fought back ----------
    const prey = track(await loginClient('S30Prey'));
    await enterWild(prey, 'prey');
    await walkTo(prey, 565, 621, 12); // Rusher Rex's home ground
    {
      const start = await prey.waitFor((e) => e.type === 'wild_fight' && e.phase === 'start' && e.oppKind === 'pker', 30000, 'pker acquires the prey');
      assert(start.theyStarted === true, 'PKer: a PKer picks an in-bracket player and attacks first (' + start.oppName + ')');
      const tickHit = await prey.waitFor((e) => e.type === 'wild_fight' && e.phase === 'tick' && typeof e.oppHit === 'number', 30000, 'pker swings land');
      assert(typeof tickHit.oppHit === 'number', 'PKer: its swings land on the player (oppHit ' + tickHit.oppHit + ')');
      prey.send({ type: 'wild_attack', pker: start.oppId });
      const back = await prey.waitFor((e) => e.type === 'wild_fight' && e.phase === 'tick' && (typeof e.youHit === 'number' || e.closing), 20000, 'prey fights back');
      assert(back.phase === 'tick', 'PKer: the player fights back through the same wild-fight engine');
      prey.close();
    }

    // ---------- (8) PKer kill drops loot piles ----------
    const pkHunter = track(await loginClient('S30PkHunter'));
    await enterWild(pkHunter, 'pkhunter');
    await walkTo(pkHunter, 565, 621, 12); // Rusher Rex's home ground
    {
      const start = await pkHunter.waitFor((e) => e.type === 'wild_fight' && e.phase === 'start' && e.oppKind === 'pker' && e.oppName === 'Rusher Rex', 30000, 'rex engages');
      pkHunter.send({ type: 'wild_attack', pker: start.oppId });
      // Chase him: a PKer out of food flees south at low HP, and
      // a kill only counts if the hunter stays on him (the
      // face-and-chase rule cuts both ways).
      const mH = pkHunter.mark();
      let end = null;
      let lastEat = 0;
      const killDeadline = Date.now() + 90000;
      while (Date.now() < killDeadline && !end) {
        try { end = (await pkHunter.waitSince(mH, (e) => e.type === 'wild_fight' && e.phase === 'end' && e.oppName === 'Rusher Rex', 900, 'rex end (poll)')).e; } catch { /* not yet */ }
        if (!end) {
          // Eat when hurt: Rex flicks Deflect Melee, so a quarter
          // of his own landed damage comes back at him, on top of
          // whatever pile-on wanders in — the rations are what a
          // real player would lean on here.
          const lastTick = [...pkHunter.events].reverse().find((e) => e.type === 'wild_fight' && e.phase === 'tick');
          if (lastTick && typeof lastTick.hpYou === 'number' && lastTick.hpYou < 80 && Date.now() - lastEat > 3500) { pkHunter.send({ type: 'use', item: 'ration' }); lastEat = Date.now(); }
          const wsEv = [...pkHunter.events].reverse().find((e) => e.type === 'wild_state' && Array.isArray(e.pkers));
          const wp = wsEv && wsEv.pkers.find((p) => p.name === 'Rusher Rex');
          const hp = latestPos(pkHunter, 'S30PkHunter');
          // Stay glued to him (protocol moves, like walkTo): Rex
          // flees due south at PKer speed when his food is gone,
          // and the kill only lands if the hunter is in reach
          // when his swings come due.
          if (wp && hp && Math.hypot(hp.x - wp.x, hp.y - wp.y) > 25) pkHunter.send({ type: 'move', x: wp.x, y: wp.y });
        }
      }
      assert(end && end.reason === 'kill', 'PKer kill: the hunter kills Rusher Rex — got ' + JSON.stringify(end));
      const pilesEv = await pkHunter.waitFor((e) => e.type === 'piles' && e.area === 'wilderness' && (e.piles || []).some((p) => p.item === 'gold' && p.owner === 'Rusher Rex'), 10000, 'rex loot piles');
      const goldPile = pilesEv.piles.find((p) => p.item === 'gold' && p.owner === 'Rusher Rex');
      assert(goldPile.qty >= 90 && goldPile.qty <= 270, 'PKer loot: coin pile is cbt x2..x6 (got ' + goldPile.qty + ' for cbt 45)');
      pkHunter.close();
    }

    // ---------- (9) Pure Wild ----------
    const pure = track(await loginClient('S30Pure'));
    {
      const m = pure.mark();
      pure.send({ type: 'pk_noob_hop', pure: true });
      await pure.waitSince(m, (e) => e.type === 'area' && e.area === 'purewild', 10000, 'hop to pure');
      const st = (await pure.waitSince(m, (e) => e.type === 'wild_state' && e.area === 'purewild', 10000, 'pure wild_state')).e;
      assert(st.you && st.you.pure === true, 'Pure Wild: PK Noob hop lands in purewild');
      const stPl = (await pure.waitSince(m, (e) => e.type === 'state' && Array.isArray(e.players) && e.players.some((p) => p.username === 'S30Pure'), 10000, 'pure state snapshot')).e;
      const mePl = stPl.players.find((p) => p.username === 'S30Pure');
      assert(mePl.activePrayer === null || mePl.activePrayer === undefined, 'Pure Wild: entering clears any active prayer');
      const e1 = await expectError(pure, { type: 'prayer', prayer: 'melee' }, 'pure prayer refusal');
      assert(/Pure Wild — no prayer/.test(e1.message), 'Pure Wild: prayer activation hard-refused server-side');
      const e2 = await expectError(pure, { type: 'use', item: 'ration' }, 'pure food refusal');
      assert(/Pure Wild — no food, no potions/.test(e2.message), 'Pure Wild: food hard-refused server-side');
      // Hop back to the normal wild (standing by the ditch spawn).
      const m2 = pure.mark();
      pure.send({ type: 'pk_noob_hop', pure: false });
      await pure.waitSince(m2, (e) => e.type === 'area' && e.area === 'wilderness', 10000, 'hop back to normal wild');
      assert(true, 'Pure Wild: PK Noob hops back to the normal Wilderness');
      pure.close();
    }

    // ---------- (10) disconnect mid-fight = death with drops ----------
    const ghost = track(await loginClient('S30Ghost'));
    const witness = track(await loginClient('S30Witness'));
    await enterWild(ghost, 'ghost');
    await enterWild(witness, 'witness');
    await walkTo(ghost, 800, 300, 12);
    await walkTo(witness, 824, 300, 12);
    {
      ghost.send({ type: 'wild_attack', target: 'S30Witness' });
      await ghost.waitFor((e) => e.type === 'wild_fight' && e.phase === 'start', 10000, 'ghost fight start');
      await witness.waitFor((e) => e.type === 'state' && Array.isArray(e.players) && e.players.some((p) => p.username === 'S30Ghost' && p.skulled === true), 10000, 'ghost skulled');
      const mW = witness.mark();
      ghost.terminate(); // abrupt disconnect, mid-fight, skulled
      const endW = (await witness.waitSince(mW, (e) => e.type === 'wild_fight' && e.phase === 'end' && e.oppName === 'S30Ghost', 20000, 'witness sees the disconnect death')).e;
      assert(endW.reason === 'kill', 'disconnect: leaving mid-wild-fight counts as a death (opponent gets the kill)');
      const pilesEv = await witness.waitFor((e) => e.type === 'piles' && e.area === 'wilderness' && (e.piles || []).some((p) => p.item === 'gold' && p.qty >= 777 && p.owner === 'S30Ghost'), 15000, 'ghost drop piles');
      const items = (pilesEv.piles || []).filter((p) => p.owner === 'S30Ghost').map((p) => p.item);
      assert(items.includes('steel_sword') && items.includes('iron_helm'), 'disconnect: the skulled ghost dropped backpack + worn as piles');
      const gp = await prof('S30Ghost');
      assert(stackQty(gp, 'gold') === 0 && (!gp.worn || gp.worn.head === null), 'disconnect: the ghost kept nothing (skulled rules)');
      witness.close();
    }

    console.log('\nSTAGE 30: ALL PASSED');
  } finally {
    for (const c of clients) { try { c.close(); } catch { /* ignore */ } }
    await stopServer();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
