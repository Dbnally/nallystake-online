// Stage 7D tests: admin/owner-only world editing — the custom item
// editor (clone a base weapon/armour, set name/icon/stats, get a new
// item with a permanent item number), reference lists (item # / npc #
// / object #), and placeable decorative objects. Custom definitions
// live on the creator's profile and placed objects on the placer's;
// both must survive restarts via the boot registry aggregation, and
// custom ids must survive banking, trading, dropping and equipping.
//
// Same harness style as test/stage7.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., a fresh disposable DB file
// so the literal owner name 'nally' can register.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18091;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage7d.json');
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
  await sleep(400); // let the file store's debounced flush land first
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
  profile() {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].profile) return this.events[i].profile;
    return null;
  }
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
const qty = (profile, item) => {
  const s = (profile.backpack || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
const bankQty = (profile, item) => {
  const s = (profile.bank || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
// The most recent catalog this client received.
function lastCatalog(c) {
  for (let i = c.events.length - 1; i >= 0; i--) if (c.events[i].type === 'catalog') return c.events[i].items;
  return null;
}
// Send a message and require an {type:'error'} back; returns it.
async function expectError(c, obj, label) {
  const m = c.mark();
  c.send(obj);
  const r = await c.waitSince(m, (e) => e.type === 'error', 10000, label + ' (error)');
  return r.e;
}
// Wait (from a mark) for a profile satisfying pred; returns it.
async function waitProfile(c, mark, pred, label) {
  const r = await c.waitSince(mark, (e) => e.profile && pred(e.profile), 15000, label);
  return r.e.profile;
}

async function main() {
  // Source-level checks: the registry + itemDef indirection exist and
  // the boot aggregation runs before listening.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/function itemDef\(id\)/.test(src), 'source: itemDef(id) indirection exists');
  assert(/buildStage7DRegistry\(\);/.test(src), 'source: the boot registry aggregation is called');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- Cast ----------
    const nally = await register('nally', 'owner-pass-7d');
    const mod = await register('S7DMod', 's7d-mod-pass');
    const play = await register('S7DPlayer', 's7d-play-pass');
    clients.push(nally, mod, play);
    let mN = nally.mark(); let mM = mod.mark();
    nally.send({ type: 'set_role', target: 'S7DMod', role: 'mod' });
    await nally.waitSince(mN, (e) => e.type === 'admin_note' && e.text.includes("S7DMod's role to mod"), 10000, 'promote mod');
    await waitProfile(mod, mM, (p) => p.role === 'mod', 'mod role profile');
    console.log('PASS setup: nally (owner) promoted S7DMod to mod');

    // Base item count (no customs yet) — the floor for custom numbers.
    mN = nally.mark();
    nally.send({ type: 'ref_lists' });
    const ref0 = (await nally.waitSince(mN, (e) => e.type === 'ref_lists', 10000, 'ref_lists (base)')).e;
    const baseCount = ref0.items.length;
    assert(baseCount > 50 && ref0.items.every((it) => !it.custom), `ref_lists: ${baseCount} base items, none custom yet`);
    assert(ref0.items[0].num === 1 && ref0.items[baseCount - 1].num === baseCount, 'ref_lists: base items are numbered 1..N in order');

    // ---------- Permissions: players AND mods are rejected ----------
    for (const [c, who] of [[play, 'player'], [mod, 'mod']]) {
      const e1 = await expectError(c, { type: 'create_custom', base: 'steel_sword', name: 'Nope', accBonus: 0.1, maxBonus: 5 }, `${who} create_custom`);
      assert(!!e1.message, `permissions: a ${who} cannot create_custom ("${e1.message}")`);
      const e2 = await expectError(c, { type: 'ref_lists' }, `${who} ref_lists`);
      assert(!!e2.message, `permissions: a ${who} cannot ref_lists ("${e2.message}")`);
      const e3 = await expectError(c, { type: 'place_object', kind: 'tree', x: 100, y: 100 }, `${who} place_object`);
      assert(!!e3.message, `permissions: a ${who} cannot place_object ("${e3.message}")`);
    }
    const eEdit = await expectError(play, { type: 'edit_custom', id: 'custom_1', name: 'Nope' }, 'player edit_custom');
    assert(!!eEdit.message, 'permissions: a player cannot edit_custom');
    const eRemove = await expectError(play, { type: 'remove_object', id: 'obj_1' }, 'player remove_object');
    assert(!!eRemove.message, 'permissions: a player cannot remove_object');

    // ---------- create_custom: a weapon cloned from a base sword ----------
    mN = nally.mark(); mM = mod.mark();
    nally.send({ type: 'create_custom', base: 'steel_sword', name: 'Dragonbane', icon: '🔥', accBonus: 0.3, maxBonus: 25 });
    const created = (await nally.waitSince(mN, (e) => e.type === 'custom_created', 10000, 'custom_created')).e.item;
    assert(created.custom === true && created.base === 'steel_sword' && created.by === 'nally',
      'create_custom: the def records custom/base/creator');
    assert(created.num === baseCount + 1, `create_custom: first custom number is baseCount+1 (${created.num} = ${baseCount}+1)`);
    assert(created.id === `custom_${created.num}`, `create_custom: id is custom_<num> (${created.id})`);
    assert(created.name === 'Dragonbane' && created.icon === '🔥' && created.kind === 'weapon' && created.slot === 'weapon',
      'create_custom: name/icon/kind/slot are as set (kind+slot cloned from the base sword)');
    assert(created.accBonus === 0.3 && created.maxBonus === 25 && created.reduction === 0,
      `create_custom: stats are as set (acc ${created.accBonus}, max ${created.maxBonus}, reduction zeroed for a weapon)`);
    const customId = created.id;
    const nallyProf = await waitProfile(nally, mN, (p) => qty(p, customId) === 1, 'creator receives the custom');
    assert(qty(nallyProf, customId) === 1, 'create_custom: the creator received exactly 1 of the new item');
    // An already-online client hears the new catalog by broadcast.
    const modCat = (await mod.waitSince(mM, (e) => e.type === 'catalog'
      && e.items.some((i) => i.id === customId), 10000, 'catalog broadcast to online clients')).e;
    assert(modCat.items.find((i) => i.id === customId).name === 'Dragonbane',
      'create_custom: the catalog was re-broadcast to all online clients');

    // ---------- create_custom: armour clamps + zeroed weapon stats ----------
    mN = nally.mark();
    nally.send({ type: 'create_custom', base: 'steel_platebody', name: 'Aegis Plate', reduction: 0.9, accBonus: 0.4, maxBonus: 20 });
    const createdArm = (await nally.waitSince(mN, (e) => e.type === 'custom_created', 10000, 'custom_created (armour)')).e.item;
    assert(createdArm.num === baseCount + 2 && createdArm.kind === 'armour' && createdArm.slot === 'body',
      'create_custom (armour): cloned kind/slot from the platebody, next number in sequence');
    assert(createdArm.reduction === 0.45, `create_custom (armour): reduction clamped to 0.45 (got ${createdArm.reduction})`);
    assert(createdArm.accBonus === 0 && createdArm.maxBonus === 0, 'create_custom (armour): weapon stats are zeroed');
    const armourId = createdArm.id;

    // ---------- A second client's fresh login catalog carries the def ----------
    const trader = await register('S7DTrader', 's7d-trade-pass');
    clients.push(trader);
    const traderCat = lastCatalog(trader);
    const catEntry = traderCat.find((i) => i.id === customId);
    assert(!!catEntry, 'catalog: a fresh login catalog includes the custom item');
    assert(catEntry.num === created.num && catEntry.name === 'Dragonbane' && catEntry.accBonus === 0.3 && catEntry.maxBonus === 25
      && catEntry.custom === true && catEntry.base === 'steel_sword' && catEntry.by === 'nally',
      'catalog: the custom entry carries num/name/stats/custom/base/by');

    // ---------- spawn_item hands the custom to another player ----------
    const mP = play.mark();
    nally.send({ type: 'spawn_item', item: customId, qty: 1, target: 'S7DPlayer' });
    const playProf = await waitProfile(play, mP, (p) => qty(p, customId) === 1, 'spawned custom profile');
    assert(qty(playProf, customId) === 1, 'spawn_item: the custom item landed in another player\'s backpack');

    // ---------- A trade moves the custom; the receiver keeps the id ----------
    let mT = trader.mark(); let mPl = play.mark();
    play.send({ type: 'trade_request', target: 'S7DTrader' });
    const incoming = (await trader.waitSince(mT, (e) => e.type === 'trade_incoming', 10000, 'trade_incoming')).e;
    trader.send({ type: 'trade_response', tradeId: incoming.tradeId, accept: true });
    await play.waitSince(mPl, (e) => e.type === 'trade_open', 10000, 'trade_open (player)');
    await trader.waitSince(mT, (e) => e.type === 'trade_open', 10000, 'trade_open (trader)');
    play.send({ type: 'trade_offer', tradeId: incoming.tradeId, gold: 0, items: [{ item: customId, qty: 1 }] });
    const upd = (await trader.waitSince(mT, (e) => e.type === 'trade_update'
      && e.them.items.some((s) => s.item === customId && s.qty === 1), 10000, 'trade_update shows the custom')).e;
    assert(!!upd, 'trade: the partner sees the custom item in the offer');
    trader.send({ type: 'trade_offer', tradeId: incoming.tradeId, gold: 0, items: [] });
    play.send({ type: 'trade_confirm', tradeId: incoming.tradeId });
    trader.send({ type: 'trade_confirm', tradeId: incoming.tradeId });
    const doneT = (await trader.waitSince(mT, (e) => e.type === 'trade_done', 15000, 'trade_done (trader)')).e;
    assert(doneT.ok === true, 'trade: the custom trade completed');
    const traderProf = await waitProfile(trader, mT, (p) => qty(p, customId) === 1, 'trader profile with custom');
    assert(qty(traderProf, customId) === 1, 'trade: the receiver\'s profile holds the custom id');
    const playAfter = await waitProfile(play, mPl, (p) => qty(p, customId) === 0, 'player profile after trade');
    assert(qty(playAfter, customId) === 0, 'trade: the giver no longer holds the custom');

    // ---------- The custom equips, banks, drops — and never sells ----------
    mT = trader.mark();
    trader.send({ type: 'equip', item: customId });
    const wornProf = await waitProfile(trader, mT, (p) => p.worn.weapon === customId, 'custom worn');
    assert(wornProf.worn.weapon === customId, 'equip: the custom weapon can be worn');
    const eSell = await expectError(trader, { type: 'shop_sell', item: customId, qty: 1 }, 'shop_sell custom');
    assert(eSell.message === "That can't be sold.", `shops: a custom item cannot be sold ("${eSell.message}")`);
    trader.send({ type: 'unequip', slot: 'weapon' });
    await waitProfile(trader, mT, (p) => p.worn.weapon === null && qty(p, customId) === 1, 'custom unequipped');
    trader.send({ type: 'bank_deposit', item: customId, qty: 1 });
    const banked = await waitProfile(trader, mT, (p) => bankQty(p, customId) === 1 && qty(p, customId) === 0, 'custom banked');
    assert(bankQty(banked, customId) === 1, 'bank: the custom item deposits');
    trader.send({ type: 'bank_withdraw', item: customId, qty: 1 });
    await waitProfile(trader, mT, (p) => qty(p, customId) === 1 && bankQty(p, customId) === 0, 'custom withdrawn');
    console.log('PASS bank: the custom item withdraws back to the backpack');
    trader.send({ type: 'drop', item: customId, qty: 1 });
    const pileEvt = (await trader.waitSince(mT, (e) => e.type === 'piles'
      && e.piles.some((pl) => pl.item === customId), 10000, 'custom drop pile')).e;
    const pile = pileEvt.piles.find((pl) => pl.item === customId);
    await waitProfile(trader, mT, (p) => qty(p, customId) === 0, 'custom dropped');
    trader.send({ type: 'pickup', pileId: pile.id });
    await waitProfile(trader, mT, (p) => qty(p, customId) === 1, 'custom picked back up');
    console.log('PASS drop/pickup: the custom item survives a ground pile round-trip');

    // ---------- ref_lists: customs, NPCs, objects ----------
    mN = nally.mark();
    nally.send({ type: 'ref_lists' });
    const refs = (await nally.waitSince(mN, (e) => e.type === 'ref_lists', 10000, 'ref_lists (full)')).e;
    const refCustom = refs.items.find((i) => i.id === customId);
    assert(!!refCustom && refCustom.num === created.num && refCustom.custom === true,
      'ref_lists: the custom item is listed with its number');
    assert(refs.items.length === baseCount + 2, `ref_lists: ${refs.items.length} items = ${baseCount} base + 2 customs`);
    assert(refs.npcs.some((n) => n.name === 'TzTok-Jad' && n.area === 'fightcaves'), 'ref_lists: TzTok-Jad is listed (fightcaves)');
    assert(refs.npcs.some((n) => n.name === 'Goblin' && n.area === 'goblins'), 'ref_lists: Goblin is listed (goblins)');
    assert(refs.npcs.filter((n) => n.area === 'barrows').length === 6, 'ref_lists: all six Barrows brothers are listed');
    assert(refs.npcs.some((n) => n.name === 'Tree Guardian' && n.area === 'anywhere'), 'ref_lists: the Tree Guardian ally is listed');
    assert(refs.objects.length === 5
      && ['tree', 'rock', 'flowers', 'light', 'chest'].every((k, i) => refs.objects[i].kind === k && refs.objects[i].num === i + 1),
      'ref_lists: the 5 prop kinds are listed in order (tree/rock/flowers/light/chest)');

    // ---------- Placed objects: broadcast, removal ----------
    const mPlObj = play.mark();
    nally.send({ type: 'place_object', kind: 'tree', x: 500, y: 200 });
    const objEvt = (await play.waitSince(mPlObj, (e) => e.type === 'objects' && e.area === 'plaza'
      && e.objects.some((o) => o.kind === 'tree' && o.x === 500 && o.y === 200), 10000, 'objects broadcast (tree placed)')).e;
    const treeObj = objEvt.objects.find((o) => o.kind === 'tree');
    assert(treeObj.by === 'nally', 'place_object: another client in the area received the placed tree (with placer name)');
    // A second object stays behind for the restart check.
    nally.send({ type: 'place_object', kind: 'rock', x: 300, y: 150 });
    const rockEvt = (await play.waitSince(mPlObj, (e) => e.type === 'objects'
      && e.objects.some((o) => o.kind === 'rock' && o.x === 300 && o.y === 150), 10000, 'objects broadcast (rock placed)')).e;
    const rockObj = rockEvt.objects.find((o) => o.kind === 'rock');
    assert(rockObj.id !== treeObj.id, 'place_object: each placed object gets its own id');
    const mPlObj2 = play.mark();
    nally.send({ type: 'remove_object', id: treeObj.id });
    await play.waitSince(mPlObj2, (e) => e.type === 'objects'
      && !e.objects.some((o) => o.id === treeObj.id) && e.objects.some((o) => o.id === rockObj.id),
      10000, 'objects broadcast (tree removed)');
    console.log('PASS remove_object: the area list no longer holds the tree (the rock stays)');

    // ---------- edit_custom renames for everyone ----------
    const mT2 = trader.mark(); const mN2 = nally.mark();
    nally.send({ type: 'edit_custom', id: customId, name: 'Dragonbane Mk II' });
    const edited = (await nally.waitSince(mN2, (e) => e.type === 'custom_edited', 10000, 'custom_edited')).e.item;
    assert(edited.id === customId && edited.name === 'Dragonbane Mk II' && edited.accBonus === 0.3,
      'edit_custom: the rename landed and untouched stats were kept');
    await trader.waitSince(mT2, (e) => e.type === 'catalog'
      && e.items.some((i) => i.id === customId && i.name === 'Dragonbane Mk II'), 10000, 'catalog broadcast (rename)');
    console.log('PASS edit_custom: online clients received the renamed catalog');

    for (const c of clients) c.close();
    clients.length = 0;
    await stopServer();

    // ---------- RESTART: defs, holdings and objects all persist ----------
    await startServer();
    const nally2 = await login('nally', 'owner-pass-7d');
    const trader2 = await login('S7DTrader', 's7d-trade-pass');
    clients.push(nally2, trader2);
    const cat2 = lastCatalog(trader2).find((i) => i.id === customId);
    assert(!!cat2 && cat2.name === 'Dragonbane Mk II' && cat2.num === created.num && cat2.accBonus === 0.3,
      'restart: a fresh login catalog still carries the (renamed) custom def');
    assert(qty(trader2.profile(), customId) === 1,
      'restart: the holder\'s backpack still contains the custom item (not sanitised away)');
    const armEntry = lastCatalog(trader2).find((i) => i.id === armourId);
    assert(!!armEntry && armEntry.reduction === 0.45, 'restart: the custom armour def persisted too');
    const objLogin = await trader2.waitFor((e) => e.type === 'objects' && e.area === 'plaza', 10000, 'objects on login (restart)');
    assert(objLogin.objects.some((o) => o.id === rockObj.id && o.kind === 'rock'),
      'restart: the placed rock is still broadcast on area entry');
    assert(!objLogin.objects.some((o) => o.id === treeObj.id),
      'restart: the removed tree stayed removed');
    // Counters were seeded at boot: new creations never reuse numbers/ids.
    const mN3 = nally2.mark();
    nally2.send({ type: 'create_custom', base: 'bronze_sword', name: 'Postrestart', maxBonus: 3 });
    const created3 = (await nally2.waitSince(mN3, (e) => e.type === 'custom_created', 10000, 'custom_created (post-restart)')).e.item;
    assert(created3.num === createdArm.num + 1, `restart: the item-number sequence continued (${created3.num} after ${createdArm.num})`);
    const mT3 = trader2.mark();
    nally2.send({ type: 'place_object', kind: 'flowers', x: 100, y: 100 });
    const objEvt3 = (await trader2.waitSince(mT3, (e) => e.type === 'objects'
      && e.objects.some((o) => o.kind === 'flowers'), 10000, 'objects broadcast (post-restart place)')).e;
    const flowerObj = objEvt3.objects.find((o) => o.kind === 'flowers');
    assert(flowerObj.id !== rockObj.id && objEvt3.objects.some((o) => o.id === rockObj.id),
      'restart: new object ids continue the sequence (no collision with the persisted rock)');

    for (const c of clients) c.close();
    console.log('ALL STAGE 7D TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
