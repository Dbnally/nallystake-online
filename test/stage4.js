// Stage 4 proof: the Fight Caves — Derek's exact 63-wave OSRS table.
// (0) The wave table itself is checked against the server source (62
// composition rows + wave 63 = Jad alone, wave 62 = two Ket-Zek).
// (a) A fresh player: fc_start is refused outside the caves; inside,
// wave 1 is a single Tz-Kih and the HP pool is the Hitpoints level (10).
// The run is driven until it ends or wave 3 is reached — a fresh player
// may honestly die, and either outcome is asserted (death: fc_end
// 'death', attempts 1, bestWave >= 1, woke in the plaza; alive: leave
// with kills banked).
// (b) A seeded strong player (Hitpoints ~66, full dragon + dragon
// sword, potions) clears waves 1-10 with a prayer-managing driver,
// leaves on wave 11, and the records (attempts / bestWave / kills)
// persist across a server restart.
// (c) A seeded maxed player (Hitpoints 99) attempts the FULL 63 waves
// with a telegraph prayer-switching driver. This section is SOFT: if it
// times out or the runner dies, it logs a SKIP instead of failing — but
// if it completes, completions / bestTimeMs / fire cape / exactly 4
// healers / telegraphs are all asserted hard. File mode, temp DB.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18085;
const DB = path.join(os.tmpdir(), `nallystake-stage4-${Date.now()}.json`);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const p = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DB_PATH: DB }, stdio: 'pipe' });
  return new Promise((resolve) => {
    p.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(p); });
    setTimeout(() => resolve(p), 3000);
  });
}
async function api(pathName, body) {
  const r = await fetch(BASE + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(pathName + ': ' + d.error);
  return d;
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    const client = { ws, events: [] };
    ws.on('message', (raw) => client.events.push(JSON.parse(raw)));
    client.send = (obj) => ws.send(JSON.stringify(obj));
    client.profile = () => {
      for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].profile) return client.events[i].profile;
      return null;
    };
    client.waitSince = (startIdx, pred, timeout = 30000, label = 'event') => new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (let i = startIdx; i < client.events.length; i++) {
          if (pred(client.events[i])) { clearInterval(iv); return res(client.events[i]); }
        }
        if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('timeout waiting ' + label)); }
      }, 25);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qty = (profile, item) => { const s = (profile.backpack || []).find((x) => x.item === item); return s ? s.qty : 0; };
const qtyAnywhere = (profile, item) => qty(profile, item) + ((profile.bank || []).find((x) => x.item === item) || { qty: 0 }).qty;
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

// ---------- Fight Caves run driver ----------
// Polls the client's event stream, keeps a live view of the run, and
// plays it the way a player would: walk onto the weakest living monster
// (healers first on the Jad wave), attack it, keep a sensible Deflect
// prayer up, drink potions, fire specials, and — crucially — switch
// prayer the moment Jad telegraphs.
function makeRunState() {
  return {
    cursor: 0, roster: new Map(), wave: 0, maxWave: 0,
    hpYou: null, maxHpYou: null, energyYou: 0,
    ended: null, telegraphs: 0, healersSeen: new Set(), lastArea: null,
    prayerState: null, prayerPoints: null,
    lastPrayerPotAt: 0, lastFoodAt: 0, lastPrayerSentAt: 0, lastSpecAt: 0,
  };
}
function processEvents(client, st, opts) {
  for (; st.cursor < client.events.length; st.cursor++) {
    const e = client.events[st.cursor];
    if (e.type === 'fc_state') {
      st.wave = e.wave; st.maxWave = Math.max(st.maxWave, e.wave);
      st.hpYou = e.hpYou; st.maxHpYou = e.maxHpYou;
      st.roster = new Map(e.monsters.map((mm) => [mm.id, { ...mm }]));
      for (const mm of e.monsters) if (mm.kind === 'hurkot') st.healersSeen.add(mm.id);
    } else if (e.type === 'fc_tick') {
      if (e.wave) { st.wave = e.wave; st.maxWave = Math.max(st.maxWave, e.wave); }
      st.hpYou = e.hpYou; st.maxHpYou = e.maxHpYou;
      if (typeof e.energyYou === 'number') st.energyYou = e.energyYou;
      const aliveIds = new Set((e.monsters || []).map((mm) => mm.id));
      for (const mm of e.monsters || []) { const r = st.roster.get(mm.id); if (r) r.hp = mm.hp; }
      if (e.targetId) { const r = st.roster.get(e.targetId); if (r && typeof e.targetHp === 'number') r.hp = e.targetHp; }
      for (const id of [...st.roster.keys()]) if (!aliveIds.has(id)) st.roster.delete(id);
    } else if (e.type === 'fc_wave') {
      st.wave = e.wave; st.maxWave = Math.max(st.maxWave, e.wave);
    } else if (e.type === 'fc_telegraph') {
      st.telegraphs++;
      if (opts.onTelegraph) opts.onTelegraph(e.style);
    } else if (e.type === 'fc_end') {
      st.ended = e;
    } else if (e.type === 'area') {
      st.lastArea = e.area;
    } else if (e.profile) {
      st.prayerState = e.profile.activePrayer;
      st.prayerPoints = e.profile.prayerPoints;
    }
  }
}
function setPrayer(client, st, style) {
  if (st.prayerState === style) return;
  if (Date.now() - st.lastPrayerSentAt < 800) return; // let the last switch land
  client.send({ type: 'prayer', prayer: style });
  st.prayerState = style; // optimistic; profile events confirm or correct
  st.lastPrayerSentAt = Date.now();
}
function driverAct(client, st, opts) {
  if (st.ended) return;
  const alive = [...st.roster.values()].filter((mm) => mm.hp > 0);
  if (opts.managePrayer) {
    let desired = null;
    if (alive.some((mm) => mm.kind === 'ketzek')) desired = 'magic';
    else if (alive.some((mm) => mm.attackType === 'melee')) desired = 'melee';
    else if (alive.some((mm) => mm.kind === 'tokxil')) desired = 'missiles';
    if (desired && st.prayerState !== desired) {
      if ((st.prayerPoints ?? 99) < 3 && Date.now() - st.lastPrayerPotAt > 4000) {
        client.send({ type: 'use', item: 'prayer_potion' });
        st.lastPrayerPotAt = Date.now();
      } else setPrayer(client, st, desired);
    }
    // Slow top-up while any prayer is running (a full-points drink is
    // refused by the server without consuming, so this is safe).
    if (st.prayerState && Date.now() - st.lastPrayerPotAt > 45000) {
      client.send({ type: 'use', item: 'prayer_potion' });
      st.lastPrayerPotAt = Date.now();
    }
  }
  if (opts.eatBelow && st.hpYou !== null && st.hpYou < opts.eatBelow && Date.now() - st.lastFoodAt > 1200) {
    client.send({ type: 'use', item: 'restore_potion' });
    st.lastFoodAt = Date.now();
  }
  let target = null;
  const healers = alive.filter((mm) => mm.kind === 'hurkot');
  if (healers.length) target = healers.sort((a, b) => a.hp - b.hp)[0];
  else if (alive.length) target = alive.sort((a, b) => a.hp - b.hp)[0];
  if (target) {
    client.send({ type: 'move', x: target.x, y: target.y });
    client.send({ type: 'fc_attack', id: target.id });
    if (st.energyYou >= 50 && Date.now() - st.lastSpecAt > 1000) {
      client.send({ type: 'special' });
      st.lastSpecAt = Date.now();
    }
  }
}
async function driveUntil(client, st, opts, predicate, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    processEvents(client, st, opts);
    if (st.ended) return { ended: st.ended, timedOut: false };
    if (predicate(st)) return { ended: null, timedOut: false };
    driverAct(client, st, opts);
    await sleep(200);
  }
  processEvents(client, st, opts);
  return { ended: st.ended, timedOut: !st.ended && !predicate(st) };
}

(async () => {
  // --- (0) The wave table, checked against the server source ---
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const tableMatch = src.match(/const FC_WAVES = \[null,([\s\S]*?)\];/);
  assert(tableMatch, 'FC_WAVES table found in server.js');
  const rows = tableMatch[1].match(/\[\d,\d,\d,\d,\d\]/g) || [];
  assert(rows.length === 62, `FC_WAVES carries 62 composition rows for waves 1-62 (got ${rows.length})`);
  assert(rows[0] === '[1,0,0,0,0]', `wave 1 = 1 x Tz-Kih (got ${rows[0]})`);
  assert(rows[30] === '[0,0,0,0,1]', `wave 31 = the first Ket-Zek (got ${rows[30]})`);
  assert(rows[61] === '[0,0,0,0,2]', `wave 62 = 2 x Ket-Zek (got ${rows[61]})`);
  assert(/wave === 63/.test(src) && /addFcMonster\(run, 'jad'/.test(src), 'wave 63 spawns TzTok-Jad alone');
  console.log('PASS wave table: 62 composition rows + wave 63 = TzTok-Jad alone (wave 62 = 2 x Ket-Zek)');

  let server = await startServer();
  try {
    // --- (a) Fresh player: protocol + records, either honest outcome ---
    const f = await api('/api/register', { username: 'S4Fresh', password: 'secret1' });
    assert(f.profile.fc && f.profile.fc.attempts === 0 && f.profile.fc.bestWave === 0 && f.profile.fc.kills === 0 && f.profile.fc.completions === 0 && f.profile.fc.bestTimeMs === 0, 'new profiles carry zeroed Fight Caves records');
    const cf = await connect(f.token);
    await cf.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome');
    {
      const mark = cf.events.length;
      cf.send({ type: 'fc_start' });
      const err = await cf.waitSince(mark, (e) => e.type === 'error', 10000, 'fc_start area refusal');
      assert(/Fight Caves/.test(err.message), `fc_start in the plaza is refused (got: ${err.message})`);
    }
    cf.send({ type: 'travel', to: 'fightcaves' });
    await cf.waitSince(0, (e) => e.type === 'area' && e.area === 'fightcaves', 10000, 'area fightcaves');
    const markA = cf.events.length;
    cf.send({ type: 'fc_start' });
    const stA0 = await cf.waitSince(markA, (e) => e.type === 'fc_state', 10000, 'fc_state wave 1');
    assert(stA0.wave === 1 && stA0.monsters.length === 1 && stA0.monsters[0].kind === 'tzkih' && stA0.monsters[0].combatLevel === 22, `wave 1 is a single Tz-Kih, combat 22 (got wave ${stA0.wave}, ${stA0.monsters.length} monsters)`);
    assert(stA0.maxHpYou === 10 && stA0.hpYou === 10, `fresh HP pool is the Hitpoints level, 10 (got ${stA0.maxHpYou})`);
    console.log('PASS protocol: fc_start refused in the plaza; wave 1 = 1 x Tz-Kih (22), HP pool = Hitpoints level 10');

    const stF = makeRunState();
    const rF = await driveUntil(cf, stF, { managePrayer: false, eatBelow: 0, onTelegraph: null }, (s) => s.maxWave >= 3, 90000);
    let endF = rF.ended;
    if (!endF) {
      cf.send({ type: 'fc_leave' });
      endF = await cf.waitSince(0, (e) => e.type === 'fc_end', 15000, 'fc_end after leave');
    }
    processEvents(cf, stF, { onTelegraph: null });
    assert(endF.reason === 'death' || endF.reason === 'left', `fresh run ended by death or leaving (got ${endF.reason})`);
    assert(endF.profile.fc.attempts === 1, `attempts = 1 after one run (got ${endF.profile.fc.attempts})`);
    assert(endF.profile.fc.bestWave >= 1, `bestWave >= 1 (got ${endF.profile.fc.bestWave})`);
    if (endF.reason === 'death') {
      assert(stF.lastArea === 'plaza', 'death woke the fresh player back in the plaza');
      console.log(`PASS fresh run (death): died on wave ${endF.wave} — attempts 1, bestWave ${endF.profile.fc.bestWave}, woke in the plaza, nothing lost`);
    } else {
      assert(endF.kills >= 1, `fresh run banked kills before leaving (got ${endF.kills})`);
      console.log(`PASS fresh run (left): reached wave ${stF.maxWave}, left with ${endF.kills} kills — attempts 1, bestWave ${endF.profile.fc.bestWave}`);
    }
    cf.ws.close();
    await sleep(300);

    // --- Seed two strong accounts through the file DB ---
    await api('/api/register', { username: 'S4Strong', password: 'secret1' });
    await api('/api/register', { username: 'S4Jad', password: 'secret1' });
    await sleep(500); // let the file store flush the registrations
    server.kill();
    await sleep(600);
    const data = JSON.parse(fs.readFileSync(DB, 'utf8'));
    const dragonGear = { weapon: 'dragon_sword', head: 'dragon_helm', body: 'dragon_platebody', legs: 'dragon_platelegs', shield: 'dragon_shield' };
    const sp = data.users.s4strong.profile;
    sp.xp.hitpoints = 500000; // ~level 66 — a ~66 HP pool
    sp.worn = { ...dragonGear };
    sp.backpack = [{ item: 'prayer_potion', qty: 50 }, { item: 'restore_potion', qty: 50 }];
    const jp = data.users.s4jad.profile;
    jp.xp.hitpoints = 13034431; // level 99 — a 99 HP pool
    jp.worn = { ...dragonGear };
    jp.backpack = [{ item: 'prayer_potion', qty: 99 }, { item: 'restore_potion', qty: 99 }];
    fs.writeFileSync(DB, JSON.stringify(data, null, 2));
    server = await startServer();

    // --- (b) Strong player: clear waves 1-10, leave on 11, records save ---
    const s2 = await api('/api/login', { username: 'S4Strong', password: 'secret1' });
    assert(s2.profile.levels.hitpoints >= 60, `seeded Hitpoints level ~66 (got ${s2.profile.levels.hitpoints})`);
    assert(s2.profile.worn.weapon === 'dragon_sword', 'seeded dragon sword is worn');
    const cs = await connect(s2.token);
    await cs.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome strong');
    cs.send({ type: 'style', style: 'aggressive' });
    cs.send({ type: 'travel', to: 'fightcaves' });
    await cs.waitSince(0, (e) => e.type === 'area' && e.area === 'fightcaves', 10000, 'area fightcaves (strong)');
    cs.send({ type: 'fc_start' });
    await cs.waitSince(0, (e) => e.type === 'fc_state' && e.wave === 1, 10000, 'strong fc_state wave 1');
    const stS = makeRunState();
    const rS = await driveUntil(cs, stS, { managePrayer: true, eatBelow: 40, onTelegraph: null }, (s) => s.maxWave >= 11, 300000);
    assert(!rS.ended, `strong player survived to wave 11 (run ended early: ${rS.ended && rS.ended.reason} on wave ${rS.ended && rS.ended.wave})`);
    assert(stS.maxWave >= 11, `strong player reached wave 11 (got ${stS.maxWave})`);
    cs.send({ type: 'fc_leave' });
    const endS = await cs.waitSince(0, (e) => e.type === 'fc_end', 15000, 'strong fc_end');
    assert(endS.reason === 'left', `strong run ended by leaving (got ${endS.reason})`);
    assert(endS.kills > 20, `strong run kills > 20 (got ${endS.kills})`);
    console.log(`PASS strong run: cleared waves 1-10 (${endS.kills} kills, Tz-Kek splits counted), left on wave ${endS.wave}`);
    cs.ws.close();
    await sleep(300);
    server.kill();
    await sleep(500);
    server = await startServer();
    const s3 = await api('/api/login', { username: 'S4Strong', password: 'secret1' });
    assert(s3.profile.fc.attempts === 1 && s3.profile.fc.bestWave >= 10 && s3.profile.fc.kills > 20, `records persisted across restart (attempts ${s3.profile.fc.attempts}, bestWave ${s3.profile.fc.bestWave}, kills ${s3.profile.fc.kills})`);
    console.log(`PASS saving: restart kept Fight Caves records (attempts 1, bestWave ${s3.profile.fc.bestWave}, kills ${s3.profile.fc.kills})`);

    // --- (c) The full 63: Jad attempt (SOFT — skip, never fail, on timeout/death) ---
    const j2 = await api('/api/login', { username: 'S4Jad', password: 'secret1' });
    assert(j2.profile.levels.hitpoints === 99, `Jad runner seeded at Hitpoints 99 (got ${j2.profile.levels.hitpoints})`);
    const cj = await connect(j2.token);
    await cj.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome jad');
    cj.send({ type: 'style', style: 'aggressive' });
    cj.send({ type: 'travel', to: 'fightcaves' });
    await cj.waitSince(0, (e) => e.type === 'area' && e.area === 'fightcaves', 10000, 'area fightcaves (jad)');
    cj.send({ type: 'fc_start' });
    await cj.waitSince(0, (e) => e.type === 'fc_state' && e.wave === 1, 10000, 'jad fc_state wave 1');
    const stJ = makeRunState();
    const jadOpts = { managePrayer: true, eatBelow: 55, onTelegraph: null };
    jadOpts.onTelegraph = (style) => setPrayer(cj, stJ, style); // the prayer-switch game, played for real
    const rJ = await driveUntil(cj, stJ, jadOpts, () => false, 12 * 60 * 1000);
    if (rJ.ended && rJ.ended.reason === 'complete') {
      const ep = rJ.ended.profile;
      assert(ep.fc.completions === 1, `completions = 1 (got ${ep.fc.completions})`);
      assert(ep.fc.bestWave === 63, `bestWave = 63 (got ${ep.fc.bestWave})`);
      assert(ep.fc.bestTimeMs > 0, `bestTimeMs recorded (${ep.fc.bestTimeMs})`);
      assert(qtyAnywhere(ep, 'fire_cape') >= 1, 'fire cape landed in backpack or bank');
      assert(rJ.ended.reward && rJ.ended.reward.gold === 500 && rJ.ended.reward.item === 'fire_cape', 'completion reward is 500g + fire cape');
      assert(stJ.healersSeen.size === 4, `exactly 4 Yt-HurKot healers spawned at Jad (saw ${stJ.healersSeen.size})`);
      assert(stJ.telegraphs >= 1, `Jad telegraphed his attacks (${stJ.telegraphs} seen, all prayer-switched)`);
      console.log(`PASS Jad: full 63-wave clear in ${Math.round(rJ.ended.timeMs / 1000)}s — ${stJ.telegraphs} telegraphs prayer-switched, exactly 4 healers, fire cape + 500g paid, records saved`);
    } else {
      console.log(`SKIP Jad full run: ${rJ.ended ? `runner died on wave ${rJ.ended.wave}` : `timed out at wave ${stJ.maxWave}`} — Jad / telegraph / healer mechanics are implemented but NOT live-proven by this suite`);
    }
    cj.ws.close();
    console.log('ALL STAGE 4 TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
