// Stage 1 proof: skills foundation (OSRS XP curve / levels / combat
// level), areas framework (travel + per-area snapshots), Goblin Camp NPC
// combat (XP per hit, drops, Deflect-from-Melee full block (Stage 27: the hit also bounces a quarter back), flee / travel
// / walking-away end combat), XP migration for old accounts, and XP
// persistence across a server restart. File mode, temp DB.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18082;
const DB = path.join(os.tmpdir(), `nallystake-stage1-${Date.now()}.json`);
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
    client.waitProfile = (label = 'profile') => client.waitSince(client.events.length, (e) => e.type === 'profile', 15000, label).then(() => client.profile());
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qty = (profile, item) => { const s = (profile.backpack || []).find((x) => x.item === item); return s ? s.qty : 0; };
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
function latestNpcState(client) {
  for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].type === 'npc_state') return client.events[i];
  return null;
}
// Walk onto a live goblin and attack it. Returns { end, ticks, startIdx }.
async function fightGoblin(client, goblinId, label) {
  const ns = latestNpcState(client);
  const g = ns && ns.npcs.find((n) => n.id === goblinId);
  assert(g, `${label}: goblin ${goblinId} is alive in npc_state`);
  client.send({ type: 'move', x: g.x, y: g.y });
  const startIdx = client.events.length;
  client.send({ type: 'attack_npc', id: goblinId });
  const end = await client.waitSince(startIdx, (e) => e.type === 'npc_fight' && e.phase === 'end', 60000, label + ' npc_fight end');
  const ticks = client.events.slice(startIdx).filter((e) => e.type === 'npc_fight' && e.phase === 'tick');
  return { end, ticks, startIdx };
}

(async () => {
  // Seed a pre-Stage-1 (Phase 1-shaped) account directly in the DB file:
  // no xp map, no backpack — the migration must fill skills, keep gold.
  const salt = crypto.randomBytes(16).toString('hex');
  const passHash = crypto.scryptSync('secret9', salt, 32).toString('hex');
  fs.writeFileSync(DB, JSON.stringify({ users: { s1legacy: { salt, passHash, profile: { username: 'S1Legacy', gold: 777, rating: 1000, wins: 0, losses: 0, style: 'accurate', createdAt: new Date().toISOString() } } } }));

  let server = await startServer();
  try {
    // --- Migration: old account gains skills, keeps everything else ---
    const legacy = await api('/api/login', { username: 'S1Legacy', password: 'secret9' });
    assert(legacy.profile.gold === 777, `legacy gold untouched (got ${legacy.profile.gold})`);
    assert(legacy.profile.xp && legacy.profile.xp.hitpoints === 1154 && legacy.profile.xp.attack === 0, 'legacy account gained the default xp map');
    assert(legacy.profile.levels.hitpoints === 10 && legacy.profile.levels.attack === 1, 'legacy levels computed from migrated xp');
    assert(Array.isArray(legacy.profile.backpack) && Array.isArray(legacy.profile.bank), 'legacy account also has the v2 fields');
    console.log('PASS migration: pre-Stage-1 account gained skills defaults, gold/rating/record untouched');

    const a = await api('/api/register', { username: 'S1Alpha', password: 'secret1' });
    const b = await api('/api/register', { username: 'S1Beta', password: 'secret2' });

    // --- Skills defaults on a fresh account ---
    const p0 = a.profile;
    assert(p0.xp.hitpoints === 1154 && p0.xp.attack === 0 && p0.xp.prayer === 0, 'fresh xp: hitpoints 1154, others 0');
    assert(p0.levels.hitpoints === 10 && p0.levels.attack === 1 && p0.levels.cooking === 1, 'fresh levels: hitpoints 10, others 1');
    assert(p0.totalLevel === 23, `total level 23 = 10 + 13x1 (got ${p0.totalLevel})`); // Stage 19: fletching is the 14th skill
    assert(Math.abs(p0.combatLevel - 3.4) < 0.051 && Math.floor(p0.combatLevel) === 3, `combat level ~3.4, floor 3 (got ${p0.combatLevel})`);
    console.log(`PASS skills defaults: hitpoints lvl 10 (1154 xp), total level 23, combat level ${p0.combatLevel} (floor 3)`);

    const ca = await connect(a.token);
    const cb = await connect(b.token);
    await ca.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome A');
    await cb.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome B');

    // --- Travel + per-area snapshots ---
    let markA = ca.events.length, markB = cb.events.length;
    ca.send({ type: 'travel', to: 'goblins' });
    const areaMsg = await ca.waitSince(markA, (e) => e.type === 'area' && e.area === 'goblins', 10000, 'area message');
    assert(areaMsg.area === 'goblins', 'travel replied with the new area');
    const ns = await ca.waitSince(0, (e) => e.type === 'npc_state', 10000, 'npc_state on entry');
    assert(ns.npcs.length === 6 && ns.npcs.every((n) => n.kind === 'goblin' && n.hp === 12 && n.maxHp === 12), `npc_state lists 6 live goblins at full HP (got ${ns.npcs.length})`);
    const stA = await ca.waitSince(markA, (e) => e.type === 'state', 10000, 'state A after travel');
    assert(stA.area === 'goblins' && stA.players.length === 1 && stA.players[0].username === 'S1Alpha' && stA.players[0].area === 'goblins', 'Alpha snapshot: only Alpha, in goblins');
    const stB = await cb.waitSince(markB, (e) => e.type === 'state', 10000, 'state B after travel');
    assert(stB.area === 'plaza' && stB.players.length === 1 && stB.players[0].username === 'S1Beta', 'Beta snapshot: only Beta, still in plaza (areas are separate)');
    console.log('PASS travel + areas: Alpha moved to Goblin Camp (6 goblins), snapshots are per-area');

    // --- Goblin kill: per-hit XP, drops, gold conserved ---
    const kill1 = await fightGoblin(ca, latestNpcState(ca).npcs[0].id, 'kill 1');
    assert(kill1.end.reason === 'kill', `first goblin died (reason=${kill1.end.reason})`);
    assert(kill1.ticks.length >= 1, 'fight produced ticks');
    assert(kill1.end.drops && kill1.end.drops.gold >= 2 && kill1.end.drops.gold <= 8, `kill drop gold in 2-8 (got ${kill1.end.drops && kill1.end.drops.gold})`);
    const profAfterKill = kill1.end.profile;
    assert(profAfterKill.xp.attack > 0, `attack XP granted per hit (got ${profAfterKill.xp.attack})`);
    assert(profAfterKill.xp.hitpoints > 1154, `hitpoints XP granted per hit (got ${profAfterKill.xp.hitpoints})`);
    // Stage 20 (flagged fix): +50 more — the one-time starter-goal
    // rewards for the trip out of the plaza (visit_area) and the
    // first monster kill (kill_monster), 25g each.
    assert(profAfterKill.gold === 100 + kill1.end.drops.gold + 50, `gold = 100 + drop + 50 starter rewards (got ${profAfterKill.gold})`);
    const xpNotices = ca.events.slice(kill1.startIdx).filter((e) => e.type === 'xp');
    assert(xpNotices.length >= 2 && xpNotices.some((e) => e.skill === 'attack') && xpNotices.some((e) => e.skill === 'hitpoints'), 'xp notice messages arrived for attack + hitpoints');
    const dropItems = kill1.end.drops.items || [];
    console.log(`PASS goblin kill: attack xp ${profAfterKill.xp.attack}, hitpoints xp ${profAfterKill.xp.hitpoints}, drop ${kill1.end.drops.gold}g${dropItems.length ? ' + ' + dropItems.map((s) => `${s.item} x${s.qty}`).join(', ') : ' (no item this time)'}`);

    // --- Drops across up to 3 kills: item drops land in the backpack ---
    let itemSeen = dropItems.length > 0;
    for (let k = 2; k <= 3 && !itemSeen; k++) {
      const nsNow = latestNpcState(ca);
      const kk = await fightGoblin(ca, nsNow.npcs[0].id, 'kill ' + k);
      assert(kk.end.reason === 'kill', `kill ${k} finished`);
      if (kk.end.drops.items && kk.end.drops.items.length) {
        itemSeen = true;
        const it = kk.end.drops.items[0].item;
        assert(qty(kk.end.profile, it) >= 1 || (kk.end.profile.bank || []).some((s) => s.item === it), `dropped ${it} is in the backpack/bank`);
        console.log(`PASS goblin drops: ${it} dropped on kill ${k} and landed in the backpack`);
      }
    }
    if (!itemSeen) console.log('NOTE drops: no item in 3 kills (40% item chance per kill — possible); gold drops verified on every kill');

    // --- Walking away mid-fight breaks combat (range) ---
    {
      const nsNow = latestNpcState(ca);
      const g = nsNow.npcs[0];
      ca.send({ type: 'move', x: g.x, y: g.y });
      const idx = ca.events.length;
      ca.send({ type: 'attack_npc', id: g.id });
      await ca.waitSince(idx, (e) => e.type === 'npc_fight' && e.phase === 'tick', 10000, 'range fight first tick');
      ca.send({ type: 'move', x: 20, y: 20 }); // far corner — every goblin spawn is >150 away
      const endR = await ca.waitSince(idx, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'range fight end');
      assert(endR.reason === 'range', `walking away ended the fight (reason=${endR.reason})`);
      console.log('PASS range break: walking >15 tiles from the goblin ends the fight');
    }

    // --- Deflect from Melee FULLY blocks goblin hits (Stage 27: and bounces a quarter back — stage27.js proves the bounce)
    cb.send({ type: 'travel', to: 'goblins' });
    await cb.waitSince(0, (e) => e.type === 'area' && e.area === 'goblins', 10000, 'Beta area');
    await cb.waitSince(0, (e) => e.type === 'npc_state', 10000, 'Beta npc_state');
    cb.send({ type: 'prayer', prayer: 'melee' });
    const profPray = await cb.waitProfile('Beta prayer on');
    assert(profPray.activePrayer === 'melee', 'Beta Deflect from Melee is on');
    const prayFight = await fightGoblin(cb, latestNpcState(cb).npcs[0].id, 'prayer fight');
    assert(prayFight.end.reason === 'kill', 'Beta won the prayer fight');
    assert(prayFight.ticks.length >= 1, 'prayer fight produced ticks');
    // Stage 12: between swings the goblin's hit field is null (it
    // never swung — the OSRS swing timer), so "blocked" reads as
    // 0-or-null here; the hpYou assert below still proves no damage
    // ever got through on any tick.
    assert(prayFight.ticks.every((t) => t.npcHit === 0 || t.npcHit === null), `every goblin hit blocked (npcHit values: ${prayFight.ticks.map((t) => t.npcHit).join(',')})`);
    assert(prayFight.ticks.every((t) => t.hpYou === t.maxHpYou), 'Beta HP never dropped with Deflect from Melee on');
    console.log(`PASS prayer block: ${prayFight.ticks.length} ticks, goblin damage taken 0 with Deflect from Melee`);

    // --- Flee ends combat ---
    {
      const nsNow = latestNpcState(cb);
      const g = nsNow.npcs[0];
      cb.send({ type: 'move', x: g.x, y: g.y });
      const idx = cb.events.length;
      cb.send({ type: 'attack_npc', id: g.id });
      await cb.waitSince(idx, (e) => e.type === 'npc_fight' && e.phase === 'tick', 10000, 'flee fight first tick');
      cb.send({ type: 'flee' });
      const endF = await cb.waitSince(idx, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'flee end');
      assert(endF.reason === 'fled', `flee ended the fight (reason=${endF.reason})`);
      console.log('PASS flee: running from a fight ends it cleanly');
    }

    // --- Travelling mid-fight ends combat ---
    {
      const nsNow = latestNpcState(cb);
      const g = nsNow.npcs[0];
      cb.send({ type: 'move', x: g.x, y: g.y });
      const idx = cb.events.length;
      cb.send({ type: 'attack_npc', id: g.id });
      await cb.waitSince(idx, (e) => e.type === 'npc_fight' && e.phase === 'tick', 10000, 'travel fight first tick');
      cb.send({ type: 'travel', to: 'plaza' });
      const endT = await cb.waitSince(idx, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'travel fight end');
      assert(endT.reason === 'travel', `travelling ended the fight (reason=${endT.reason})`);
      await cb.waitSince(idx, (e) => e.type === 'area' && e.area === 'plaza', 10000, 'Beta back in plaza');
      console.log('PASS travel mid-fight: fight ended, Beta arrived in the plaza');
    }

    // --- Restart persistence of XP ---
    ca.send({ type: 'style', style: 'accurate' }); // force a fresh profile
    const lastA = await ca.waitProfile('final Alpha profile');
    assert(lastA.xp.attack > 0 && lastA.xp.hitpoints > 1154, 'Alpha has earned XP to persist');
    ca.ws.close(); cb.ws.close();
    await sleep(300);
    server.kill(); await sleep(500);
    server = await startServer();
    const a2 = await api('/api/login', { username: 'S1Alpha', password: 'secret1' });
    assert(a2.profile.xp.attack === lastA.xp.attack && a2.profile.xp.hitpoints === lastA.xp.hitpoints, `XP persisted across restart (attack ${a2.profile.xp.attack}, hitpoints ${a2.profile.xp.hitpoints})`);
    assert(a2.profile.gold === lastA.gold, `gold persisted across restart (${a2.profile.gold}g)`);
    assert(a2.profile.levels.hitpoints === levelOf(a2.profile.xp.hitpoints), 'levels still computed from saved XP after restart');
    console.log(`PASS saving: restart kept XP (attack ${a2.profile.xp.attack}, hitpoints ${a2.profile.xp.hitpoints}) and gold (${a2.profile.gold}g)`);
    console.log('ALL STAGE 1 TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });

// Local copy of the level curve check (level 10 = 1154 XP) for assertions.
function levelOf(xp) { return xp >= 1154 ? 10 : 1; }
