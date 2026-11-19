// Stage 2 proof: three new areas (Training Cave, Gathering Cave,
// Fishing Cove) arrive with their node state; gathering works with
// level gates, the shared 1.4s action cooldown, success rolls, items
// and XP; training stations grant XP only; the cove loop runs end to
// end (chop logs -> light a fire -> fish -> cook on the fire); shops
// buy gathered resources at their fixed sell-only price; and XP +
// resources persist across a server restart. File mode, temp DB.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18083;
const DB = path.join(os.tmpdir(), `nallystake-stage2-${Date.now()}.json`);
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
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
// Wait for the first of several named event shapes since an index.
function waitAny(client, startIdx, preds, timeout = 15000, label = 'event') {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (let i = startIdx; i < client.events.length; i++) {
        const e = client.events[i];
        for (const [name, pred] of Object.entries(preds)) if (pred(e)) { clearInterval(iv); return res({ name, e }); }
      }
      if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('timeout waiting ' + label)); }
    }, 25);
  });
}
function latestNodes(client, area) {
  for (let i = client.events.length - 1; i >= 0; i--) {
    if (client.events[i].type === 'nodes' && client.events[i].area === area) return client.events[i];
  }
  return null;
}
// Keep test actions >=1.55s apart so the server's 1.4s action cooldown
// is never the reason an expected success fails.
let lastActAt = 0;
async function pace() {
  const wait = 1550 - (Date.now() - lastActAt);
  if (wait > 0) await sleep(wait);
  lastActAt = Date.now();
}
// Walk onto a node and gather until one attempt succeeds (bounded).
async function gatherUntil(client, node, tries = 30) {
  for (let i = 0; i < tries; i++) {
    await pace();
    const mark = client.events.length;
    client.send({ type: 'move', x: node.x, y: node.y });
    client.send({ type: 'gather', nodeId: node.id });
    const r = await waitAny(client, mark, {
      result: (e) => e.type === 'gather_result' && e.nodeId === node.id,
      error: (e) => e.type === 'error',
    }, 10000, 'gather ' + node.id);
    if (r.name === 'result' && r.e.ok) { await sleep(250); return r.e; }
    if (r.name === 'error' && !/Too fast/.test(r.e.message || '')) throw new Error(`gather ${node.id} errored: ${r.e.message}`);
  }
  throw new Error(`gather ${node.id}: no success in ${tries} tries`);
}

(async () => {
  let server = await startServer();
  try {
    const a = await api('/api/register', { username: 'S2Alpha', password: 'secret1' });
    const ca = await connect(a.token);
    await ca.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome');

    // --- Travel to the Gathering Cave: node state arrives on entry ---
    ca.send({ type: 'travel', to: 'gathering' });
    await ca.waitSince(0, (e) => e.type === 'area' && e.area === 'gathering', 10000, 'area gathering');
    const gathNodes = await ca.waitSince(0, (e) => e.type === 'nodes' && e.area === 'gathering', 10000, 'gathering nodes');
    assert(gathNodes.nodes.length === 9, `Gathering Cave sent 9 nodes (got ${gathNodes.nodes.length})`);
    const byId = Object.fromEntries(gathNodes.nodes.map((n) => [n.id, n]));
    assert(byId.copper_rock && byId.copper_rock.item === 'copper_ore' && byId.copper_rock.levelReq === 1 && byId.copper_rock.skill === 'mining', 'copper_rock def: mining 1 -> copper_ore');
    assert(byId.iron_rock.levelReq === 15 && byId.coal_rock.levelReq === 30 && byId.gem_rock.levelReq === 40, 'rock level gates 15/30/40 present');
    assert(byId.trout_spot_g.levelReq === 20 && byId.oak_g.levelReq === 15, 'cave trout spot is fishing 20, oak is woodcutting 15');
    assert(gathNodes.nodes.every((n) => n.depleted === false), 'all nodes start undepleted');
    console.log('PASS nodes on entry: Gathering Cave sent 9 nodes (5 rocks, 2 fishing spots, 2 trees) with level gates');

    // --- Level gate: Mining 1 cannot work the Iron rock ---
    await pace();
    {
      const mark = ca.events.length;
      ca.send({ type: 'move', x: byId.iron_rock.x, y: byId.iron_rock.y });
      ca.send({ type: 'gather', nodeId: 'iron_rock' });
      const err = await ca.waitSince(mark, (e) => e.type === 'error', 10000, 'iron level-gate error');
      assert(/Mining level 15/.test(err.message), `iron_rock refusal names the level needed (got: ${err.message})`);
    }
    console.log('PASS level gate: Mining 1 cannot work the Iron rock — the error names level 15');

    // --- Cooldown: two gathers back-to-back, the second is refused ---
    {
      const mark = ca.events.length;
      ca.send({ type: 'move', x: byId.copper_rock.x, y: byId.copper_rock.y });
      ca.send({ type: 'gather', nodeId: 'copper_rock' });
      ca.send({ type: 'gather', nodeId: 'copper_rock' });
      const deadline = Date.now() + 10000;
      let sawResult = false, sawTooFast = false;
      while (Date.now() < deadline && !(sawResult && sawTooFast)) {
        for (let i = mark; i < ca.events.length; i++) {
          const e = ca.events[i];
          if (e.type === 'gather_result' && e.nodeId === 'copper_rock') sawResult = true;
          if (e.type === 'error' && /Too fast/.test(e.message || '')) sawTooFast = true;
        }
        if (!(sawResult && sawTooFast)) await sleep(50);
      }
      assert(sawResult, 'first of the pair got a gather_result');
      assert(sawTooFast, 'second gather inside 1.4s was refused as Too fast');
      lastActAt = Date.now(); // the first of the pair stamped the server cooldown
    }
    console.log('PASS cooldown: a second gather inside 1.4s is refused (\'Too fast\')');

    // --- Gather copper until 2 ores: item lands, Mining XP accrues ---
    while (qty(ca.profile(), 'copper_ore') < 2) await gatherUntil(ca, byId.copper_rock);
    const profCopper = ca.profile();
    assert(qty(profCopper, 'copper_ore') >= 2, `copper ore in the backpack (got ${qty(profCopper, 'copper_ore')})`);
    assert(profCopper.xp.mining >= 36, `mining XP from 2+ ores (got ${profCopper.xp.mining})`);
    console.log(`PASS gather copper: ${qty(profCopper, 'copper_ore')} x Copper ore in backpack, Mining XP ${profCopper.xp.mining}`);

    // --- Shops buy resources at the fixed sell-only price (5g) ---
    {
      const goldBefore = ca.profile().gold;
      const mark = ca.events.length;
      ca.send({ type: 'shop_sell', item: 'copper_ore', qty: 1 });
      const sold = await ca.waitSince(mark, (e) => e.type === 'shop' && e.action === 'sell', 10000, 'copper sell');
      assert(sold.item === 'copper_ore' && sold.total === 5, `copper ore sold for exactly 5g (got ${sold.total}g)`);
      await sleep(250);
      assert(ca.profile().gold === goldBefore + 5, `gold rose by 5 (got ${ca.profile().gold - goldBefore})`);
      assert(qty(ca.profile(), 'copper_ore') === qty(profCopper, 'copper_ore') - 1, 'one ore left the backpack');
    }
    console.log('PASS shop sell: shops buy Copper ore at the fixed 5g sell-only price');

    // --- Training Cave: stations grant XP only, never items ---
    ca.send({ type: 'travel', to: 'training' });
    await ca.waitSince(0, (e) => e.type === 'area' && e.area === 'training', 10000, 'area training');
    const trainNodes = await ca.waitSince(0, (e) => e.type === 'nodes' && e.area === 'training', 10000, 'training nodes');
    assert(trainNodes.nodes.length === 6 && trainNodes.nodes.every((n) => n.kind === 'station' && n.item === null), `Training Cave sent 6 XP-only stations (got ${trainNodes.nodes.length})`);
    const packBefore = JSON.stringify(ca.profile().backpack);
    const attackBefore = ca.profile().xp.attack;
    const dummy = trainNodes.nodes.find((n) => n.id === 'attack_dummy');
    const trainRes = await gatherUntil(ca, dummy);
    assert(trainRes.item === null && trainRes.xp === 12, 'attack dummy result: no item, 12 XP');
    assert(ca.profile().xp.attack === attackBefore + 12, `attack XP rose by exactly 12 (got ${ca.profile().xp.attack - attackBefore})`);
    assert(JSON.stringify(ca.profile().backpack) === packBefore, 'backpack unchanged by training (XP only)');
    console.log(`PASS training station: Attack dummy granted 12 Attack XP (total ${ca.profile().xp.attack}), no items`);

    // --- Fishing Cove loop: chop -> light fire -> fish -> cook ---
    ca.send({ type: 'travel', to: 'cove' });
    await ca.waitSince(0, (e) => e.type === 'area' && e.area === 'cove', 10000, 'area cove');
    const coveNodes = await ca.waitSince(0, (e) => e.type === 'nodes' && e.area === 'cove', 10000, 'cove nodes');
    assert(coveNodes.nodes.length === 6, `Fishing Cove sent 6 nodes (got ${coveNodes.nodes.length})`);
    const coveById = Object.fromEntries(coveNodes.nodes.map((n) => [n.id, n]));
    assert(coveById.trout_spot_c1.levelReq === 1, 'cove trout spots are the Fishing 1 starter spots');

    await gatherUntil(ca, coveById.tree_c2);
    assert(qty(ca.profile(), 'logs') >= 1, 'chopped Logs in the cove');
    console.log(`PASS cove chop: Logs gathered (Woodcutting XP ${ca.profile().xp.woodcutting})`);

    // Light the fire where we stand (by the tree).
    const logsBefore = qty(ca.profile(), 'logs');
    await pace();
    {
      const mark = ca.events.length;
      ca.send({ type: 'light_fire' });
      const firesMsgEv = await ca.waitSince(mark, (e) => e.type === 'fires' && e.area === 'cove' && e.fires.length >= 1, 10000, 'fires after lighting');
      assert(firesMsgEv.fires[0].secondsLeft >= 55 && firesMsgEv.fires[0].secondsLeft <= 60, `fire burning with ~60s left (got ${firesMsgEv.fires[0].secondsLeft}s)`);
      await sleep(250);
      assert(qty(ca.profile(), 'logs') === logsBefore - 1, 'lighting consumed exactly 1 Logs');
      assert(ca.profile().xp.firemaking === 40, `Firemaking XP is 40 (got ${ca.profile().xp.firemaking})`);
      var fireSpot = { x: firesMsgEv.fires[0].x, y: firesMsgEv.fires[0].y };
    }
    console.log('PASS light fire: 1 Logs consumed, fire burning in the cove, Firemaking XP 40');

    // Fish a trout, then cook on the fire (retry burns, max 6 attempts).
    let cooked = 0, burnt = 0;
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (qty(ca.profile(), 'raw_trout') < 1) await gatherUntil(ca, coveById.trout_spot_c2);
      assert(qty(ca.profile(), 'raw_trout') >= 1, 'holding a raw trout to cook');
      ca.send({ type: 'move', x: fireSpot.x, y: fireSpot.y });
      await pace();
      const mark = ca.events.length;
      ca.send({ type: 'cook', item: 'raw_trout' });
      const r = await waitAny(ca, mark, {
        result: (e) => e.type === 'cook_result',
        error: (e) => e.type === 'error',
      }, 10000, 'cook attempt ' + attempt);
      assert(r.name === 'result', `cook attempt ${attempt} answered${r.name === 'error' ? ': ' + r.e.message : ''}`);
      if (r.e.ok) { cooked++; assert(r.e.item === 'cooked_trout' && r.e.xp === 70, 'successful cook: cooked_trout + 70 XP'); }
      else { burnt++; assert(r.e.item === 'burnt_fish' && r.e.xp === 0, 'burnt cook: burnt_fish + 0 XP'); }
      await sleep(250);
      if (cooked > 0) break;
    }
    assert(cooked + burnt >= 1, 'at least one cook attempt resolved');
    const profCook = ca.profile();
    assert(qty(profCook, 'cooked_trout') + qty(profCook, 'burnt_fish') === cooked + burnt, 'every cook produced exactly one product item');
    assert(profCook.xp.fishing >= 30, `Fishing XP from the cove trout (got ${profCook.xp.fishing})`);
    if (cooked > 0) {
      assert(qty(profCook, 'cooked_trout') >= 1 && profCook.xp.cooking >= 70, `cooked trout held, Cooking XP ${profCook.xp.cooking}`);
      console.log(`PASS cook: trout cooked on the fire (${cooked} cooked, ${burnt} burnt), Cooking XP ${profCook.xp.cooking}`);
    } else {
      console.log(`NOTE cook: all 6 attempts burnt at level-1 burn rates (possible); products verified, Cooking XP still 0`);
      console.log(`PASS cook: fire cooking resolves to cooked/burnt products (${burnt} burnt of 6)`);
    }

    // --- Restart persistence: XP and a resource item survive ---
    const lastProf = ca.profile();
    assert(lastProf.xp.mining > 0 && qty(lastProf, 'copper_ore') >= 1, 'Alpha has Mining XP and copper to persist');
    ca.ws.close();
    await sleep(300);
    server.kill(); await sleep(500);
    server = await startServer();
    const a2 = await api('/api/login', { username: 'S2Alpha', password: 'secret1' });
    assert(a2.profile.xp.mining === lastProf.xp.mining, `Mining XP persisted across restart (${a2.profile.xp.mining})`);
    assert(a2.profile.xp.firemaking === 40 && a2.profile.xp.woodcutting === lastProf.xp.woodcutting, 'Firemaking/Woodcutting XP persisted');
    assert(qty(a2.profile, 'copper_ore') === qty(lastProf, 'copper_ore'), `Copper ore persisted across restart (x${qty(a2.profile, 'copper_ore')})`);
    console.log(`PASS saving: restart kept Mining XP (${a2.profile.xp.mining}), Firemaking XP (40) and Copper ore (x${qty(a2.profile, 'copper_ore')})`);
    console.log('ALL STAGE 2 TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
