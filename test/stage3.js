// Stage 3 proof: the Emberfall Mine & Smithy — the mine area arrives
// with its nine rocks (Runite gated at Mining 85); Pickaxe Pete sells
// pickaxes (catalog carries buy/speed/shop); the furnace smelts bars
// with Smithing level gates and exact recipes; the anvil runs the RS3
// heat loop (start -> hammer, reheating when cold -> finished piece);
// a finished piece upgrades +1 with another bar; smithed gear equips;
// and bars + the smithed sword + Smithing XP persist across a server
// restart. File mode, temp DB.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18084;
const DB = path.join(os.tmpdir(), `nallystake-stage3-${Date.now()}.json`);
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
// Keep test actions >=1.55s apart so the server's 1.4s action cooldown
// is never the reason an expected success fails.
let lastActAt = 0;
async function pace() {
  const wait = 1550 - (Date.now() - lastActAt);
  if (wait > 0) await sleep(wait);
  lastActAt = Date.now();
}
// Walk onto a node and gather until one attempt succeeds (bounded).
async function gatherUntil(client, node, tries = 40) {
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
    const a = await api('/api/register', { username: 'S3Alpha', password: 'secret1' });
    const ca = await connect(a.token);
    await ca.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome');

    // --- Catalog contract: pickaxes (buy/speed/shop), bars, smithed gear ---
    const cat = await ca.waitSince(0, (e) => e.type === 'catalog', 10000, 'catalog');
    const catById = Object.fromEntries(cat.items.map((i) => [i.id, i]));
    assert(cat.shops.includes('Pickaxe Pete'), 'catalog shops include Pickaxe Pete');
    assert(catById.bronze_pickaxe && catById.bronze_pickaxe.buy === 60 && catById.bronze_pickaxe.speed === 1 && catById.bronze_pickaxe.shop === 'Pickaxe Pete', 'bronze pickaxe in catalog: 60g, speed 1, Pete\'s shop');
    assert(catById.dragon_pickaxe && catById.dragon_pickaxe.speed === 2.5, 'dragon pickaxe speed 2.5 in catalog');
    assert(catById.rune_bar && catById.rune_bar.sell === 500 && catById.rune_bar.buy === 0, 'rune bar is sell-only at 500g');
    assert(catById.smith_rune_sword_u4 && catById.smith_rune_sword_u4.accBonus === 0.16 && catById.smith_rune_sword_u4.maxBonus === 14, 'rune sword +4 stats: +0.16 acc, +14 max');
    assert(catById.smith_rune_platebody_u4 && catById.smith_rune_platebody_u4.reduction === 0.14, 'rune platebody +4 reduction: 0.14');
    console.log('PASS catalog: Pickaxe Pete + pickaxe speeds, sell-only bars, smithed gear stats (incl. +4 variants)');

    // --- Travel to the mine: nine rocks arrive, Runite gated at 85 ---
    ca.send({ type: 'travel', to: 'mine' });
    await ca.waitSince(0, (e) => e.type === 'area' && e.area === 'mine', 10000, 'area mine');
    const mineNodes = await ca.waitSince(0, (e) => e.type === 'nodes' && e.area === 'mine', 10000, 'mine nodes');
    assert(mineNodes.nodes.length === 9, `Emberfall Mine sent 9 rocks (got ${mineNodes.nodes.length})`);
    const byId = Object.fromEntries(mineNodes.nodes.map((n) => [n.id, n]));
    assert(byId.runite_rock && byId.runite_rock.levelReq === 85 && byId.runite_rock.skill === 'mining' && byId.runite_rock.item === 'runite_ore', 'runite_rock def: mining 85 -> runite_ore');
    assert(byId.iron_rock_m.levelReq === 10, 'mine iron rock is Mining 10 (Derek\'s mine spec)');
    assert(byId.silver_rock.levelReq === 20 && byId.gold_rock.levelReq === 40 && byId.mithril_rock.levelReq === 55 && byId.adamantite_rock.levelReq === 70, 'silver/gold/mithril/adamantite gates 20/40/55/70');
    console.log('PASS nodes on entry: Emberfall Mine sent 9 rocks with level gates up to Runite 85');

    // --- Level gate: Mining 1 cannot work the Runite rock ---
    {
      const mark = ca.events.length;
      ca.send({ type: 'move', x: byId.runite_rock.x, y: byId.runite_rock.y });
      ca.send({ type: 'gather', nodeId: 'runite_rock' });
      const err = await ca.waitSince(mark, (e) => e.type === 'error', 10000, 'runite level-gate error');
      assert(/Mining level 85/.test(err.message), `runite refusal names the level needed (got: ${err.message})`);
    }
    console.log('PASS level gate: Mining 1 cannot work the Runite rock — the error names level 85');

    // --- Buy a bronze pickaxe from Pickaxe Pete ---
    {
      const mark = ca.events.length;
      ca.send({ type: 'shop_buy', item: 'bronze_pickaxe', qty: 1 });
      const bought = await ca.waitSince(mark, (e) => e.type === 'shop' && e.action === 'buy', 10000, 'pickaxe buy');
      assert(bought.item === 'bronze_pickaxe' && bought.shop === 'Pickaxe Pete' && bought.total === 60, `pickaxe bought from Pete for 60g (got shop=${bought.shop}, total=${bought.total})`);
      await sleep(250);
      // Stage 20 (flagged fix): the trip to the mine banked the
      // one-time +25g visit_area starter reward first, so the buy
      // lands at 125 - 60 = 65, not 40.
      assert(ca.profile().gold === 65, `gold dropped by 60 to 65 (100 + 25 starter reward - 60) (got ${ca.profile().gold})`);
      assert(qty(ca.profile(), 'bronze_pickaxe') === 1, 'bronze pickaxe in the backpack');
    }
    console.log('PASS pickaxe: Bronze pickaxe bought from Pickaxe Pete for 60g, in the backpack');

    // --- Mine 3 copper + 3 tin at the mine rocks ---
    while (qty(ca.profile(), 'copper_ore') < 3) await gatherUntil(ca, byId.copper_rock_m);
    while (qty(ca.profile(), 'tin_ore') < 3) await gatherUntil(ca, byId.tin_rock_m);
    assert(qty(ca.profile(), 'copper_ore') >= 3 && qty(ca.profile(), 'tin_ore') >= 3, 'mined 3 copper + 3 tin');
    console.log(`PASS mine rocks: 3 x Copper ore + 3 x Tin ore gathered (Mining XP ${ca.profile().xp.mining})`);

    // --- Smelt 3 bronze bars in one batch: 6 XP each ---
    await pace();
    {
      const mark = ca.events.length;
      ca.send({ type: 'smelt', bar: 'bronze_bar', qty: 3 });
      const r = await waitAny(ca, mark, {
        result: (e) => e.type === 'smelt_result',
        error: (e) => e.type === 'error',
      }, 10000, 'smelt bronze x3');
      assert(r.name === 'result', `smelt answered${r.name === 'error' ? ': ' + r.e.message : ''}`);
      assert(r.e.bar === 'bronze_bar' && r.e.qty === 3 && r.e.xp === 18, `smelt_result: 3 bars, 18 XP (got qty=${r.e.qty}, xp=${r.e.xp})`);
      await sleep(250);
      assert(qty(ca.profile(), 'bronze_bar') === 3, '3 bronze bars in the backpack');
      assert(qty(ca.profile(), 'copper_ore') === 0 && qty(ca.profile(), 'tin_ore') === 0, 'smelting consumed all 3 copper + 3 tin ore');
      assert(ca.profile().xp.smithing === 18, `Smithing XP is 18 (got ${ca.profile().xp.smithing})`);
    }
    console.log('PASS smelt: 3 x Bronze bar smelted (1 copper + 1 tin each), Smithing XP 18');

    // --- Smelt steel without the level: error names Smithing 30 ---
    await pace();
    {
      const mark = ca.events.length;
      ca.send({ type: 'smelt', bar: 'steel_bar', qty: 1 });
      const err = await ca.waitSince(mark, (e) => e.type === 'error', 10000, 'steel smelt gate');
      assert(/Smithing level 30/.test(err.message), `steel smelt refusal names level 30 (got: ${err.message})`);
    }
    console.log('PASS smelt gate: Steel bar at Smithing 1 refused — the error names level 30');

    // --- Anvil: start a bronze sword, hammer it hot until done ---
    {
      const mark = ca.events.length;
      ca.send({ type: 'smith_start', item: 'smith_bronze_sword' });
      let sm = await ca.waitSince(mark, (e) => e.type === 'smith_state', 10000, 'smith start state');
      assert(sm.item === 'smith_bronze_sword' && sm.progress === 0 && sm.heat === 100, `piece started at 0 progress / 100 heat (got ${sm.progress}/${sm.heat})`);
      await sleep(250);
      assert(qty(ca.profile(), 'bronze_bar') === 2, 'starting consumed 1 bronze bar (2 left)');
      let lastReheatAt = 0;
      let hits = 0;
      while (!sm.done && hits < 80) {
        if (sm.heat < 33) { // cold metal barely moves — reheat first
          const waitR = 1100 - (Date.now() - lastReheatAt);
          if (waitR > 0) await sleep(waitR);
          const m2 = ca.events.length;
          ca.send({ type: 'smith_reheat' });
          sm = await ca.waitSince(m2, (e) => e.type === 'smith_state', 10000, 'reheat state');
          lastReheatAt = Date.now();
          assert(sm.heat === 100, `reheat restored heat to 100 (got ${sm.heat})`);
          continue;
        }
        await sleep(330); // server floor between swings is 300ms
        const m2 = ca.events.length;
        ca.send({ type: 'smith_hit' });
        sm = await ca.waitSince(m2, (e) => e.type === 'smith_state', 10000, 'hit state');
        hits++;
      }
      assert(sm.done === true, `sword finished after ${hits} hits (bounded loop)`);
      assert(sm.item === 'smith_bronze_sword' && sm.xp === 50, `finish paid 50 Smithing XP (got ${sm.xp})`);
      await sleep(250);
      assert(qty(ca.profile(), 'smith_bronze_sword') === 1, 'finished Bronze sword (smithed) in the backpack');
      assert(ca.profile().xp.smithing === 68, `Smithing XP is 68 = 18 smelt + 50 sword (got ${ca.profile().xp.smithing})`);
      console.log(`PASS smith: Bronze sword (smithed) hammered out in ${hits} hits with reheats, +50 Smithing XP`);
    }

    // --- Upgrade the sword with another bar: +1 always lands ---
    {
      const mark = ca.events.length;
      ca.send({ type: 'smith_upgrade', item: 'smith_bronze_sword' });
      const r = await waitAny(ca, mark, {
        result: (e) => e.type === 'upgrade_result',
        error: (e) => e.type === 'error',
      }, 10000, 'upgrade sword');
      assert(r.name === 'result', `upgrade answered${r.name === 'error' ? ': ' + r.e.message : ''}`);
      assert(typeof r.e.ok === 'boolean' && typeof r.e.item === 'string', 'upgrade_result shape: { ok, item, xp }');
      assert(r.e.ok === true && r.e.item === 'smith_bronze_sword_u1', `+1 upgrade landed (100% step): item is now ${r.e.item}`);
      assert(r.e.xp === 15, `upgrade paid 15 Smithing XP (got ${r.e.xp})`);
      await sleep(250);
      const prof = ca.profile();
      assert(qty(prof, 'smith_bronze_sword_u1') === 1 && qty(prof, 'smith_bronze_sword') === 0, 'sword swapped for its +1 variant');
      assert(qty(prof, 'bronze_bar') === 1, `upgrade consumed the second bar (1 left, got ${qty(prof, 'bronze_bar')})`);
    }
    console.log('PASS upgrade: Bronze sword (smithed) -> +1 variant, bar consumed, +15 Smithing XP');

    // --- Equip the smithed sword: worn.weapon is set ---
    {
      const mark = ca.events.length;
      ca.send({ type: 'equip', item: 'smith_bronze_sword_u1' });
      const ev = await ca.waitSince(mark, (e) => e.profile && e.profile.worn && e.profile.worn.weapon === 'smith_bronze_sword_u1', 10000, 'equip profile');
      assert(ev.profile.worn.weapon === 'smith_bronze_sword_u1', 'smithed sword worn in the weapon slot');
    }
    console.log('PASS equip: smithed +1 sword worn (worn.weapon = smith_bronze_sword_u1)');

    // --- Restart persistence: bar + worn sword + Smithing XP survive ---
    const lastProf = ca.profile();
    assert(qty(lastProf, 'bronze_bar') === 1 && lastProf.xp.smithing === 83, `pre-restart state: 1 bar, Smithing XP 83 (got ${lastProf.xp.smithing})`);
    ca.ws.close();
    await sleep(300);
    server.kill(); await sleep(500);
    server = await startServer();
    const a2 = await api('/api/login', { username: 'S3Alpha', password: 'secret1' });
    assert(a2.profile.xp.smithing === 83, `Smithing XP persisted across restart (${a2.profile.xp.smithing})`);
    assert(a2.profile.xp.mining === lastProf.xp.mining && a2.profile.xp.mining > 0, `Mining XP persisted (${a2.profile.xp.mining})`);
    assert(qty(a2.profile, 'bronze_bar') === 1, 'the spare Bronze bar persisted');
    assert(qty(a2.profile, 'bronze_pickaxe') === 1, 'the Bronze pickaxe persisted');
    assert(a2.profile.worn.weapon === 'smith_bronze_sword_u1', 'the smithed +1 sword persisted, still worn');
    console.log(`PASS saving: restart kept Smithing XP (83), Mining XP (${a2.profile.xp.mining}), 1 Bronze bar, pickaxe and the worn +1 smithed sword`);
    console.log('ALL STAGE 3 TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
