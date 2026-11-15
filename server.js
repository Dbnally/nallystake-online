// nallystake-online — Phase 1 + Phase 2 multiplayer server (gold-only, no real money)
// Built-in Node HTTP for the test client + `ws` for real-time play.
// The SERVER is authoritative: it holds gold, holds stakes in escrow,
// rolls every hit on the 0.6s tick, and saves every profile. Clients
// can ask — they cannot decide outcomes. That is what stops cheating.
//
// Phase 2 adds (all server-side, all saved per player): backpack / worn /
// bank item state, an item catalog with 4 shops, tap-to-wear equipping,
// consumables, Dragon Slash specials, item staking, the Bank of Gielinor
// (items only — gold stays a profile number), a drifting Gold Exchange,
// and OSRS Protect prayers (toggle/drain/badge). NOTE: prayers do NOT
// block damage in PvP duels yet — every duel attack is melee-type, so a
// full Protect-from-Melee block would stalemate every fight. NPC
// full-block arrives with Phase 3 areas, per Derek's spec.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const TICK_MS = 600;
const START_GOLD = 100;
const BACKPACK_MAX_STACKS = 28;
const PRAYER_MAX = 25; // Phase 2 prayer pool (documented choice)
const SHOP_SELLBACK = 0.6; // shops buy back at 60% of buy price
const EXCHANGE_SELLBACK = 0.97; // Gold Exchange buys back at 97% (matches Muse game)
const SPECIAL_COST = 50;
const SPECIAL_CHARGE_PER_HIT = 10;

// ---------- saving (see store.js) ----------
// DATABASE_URL set -> Postgres (Neon free in production): profiles live
// outside this server, so host sleep/restarts/redeploys can't wipe them.
// No DATABASE_URL -> local JSON file, for testing on your own machine only.
const { createStore } = require('./store');
const store = createStore(DB_PATH);
let db = { users: {} };
let saveTimer = null;
function save(key) {
  if (process.env.DATABASE_URL) {
    if (key && db.users[key]) store.putUser(key, db.users[key]).catch((e) => console.error('save failed:', e.message));
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.flush().catch((e) => console.error('save failed:', e.message)), 50);
}
function hashPass(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// ---------- item catalog (server-side constants) ----------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ITEMS = {
  restore_potion: { name: 'Restore potion', kind: 'potion', heal: 30, buy: 20, shop: 'Potion' },
  prayer_potion: { name: 'Prayer potion', kind: 'potion', prayerRestore: 15, buy: 15, shop: 'Potion' },
  ration: { name: 'Cooked ration', kind: 'food', heal: 15, buy: 8, shop: 'Food & Supplies' },
};
// Weapons: 5 tiers of sword, worn in the weapon slot.
for (const [tier, buy, accBonus, maxBonus] of [
  ['bronze', 50, 0.02, 1], ['iron', 120, 0.04, 2], ['steel', 300, 0.06, 4],
  ['mithril', 800, 0.08, 6], ['dragon', 2500, 0.12, 10],
]) {
  ITEMS[`${tier}_sword`] = { name: `${cap(tier)} sword`, kind: 'weapon', slot: 'weapon', tier, buy, accBonus, maxBonus, shop: 'Weapon' };
}
// Armour: 3 tiers x 4 slots. Each piece cuts incoming damage by `reduction`;
// wearing all 4 armour slots adds a +5% set bonus. Total capped at 45%.
for (const [tier, reduction, prices] of [
  ['bronze', 0.03, { head: 60, body: 90, legs: 75, shield: 60 }],
  ['steel', 0.06, { head: 250, body: 375, legs: 300, shield: 250 }],
  ['dragon', 0.10, { head: 1500, body: 2250, legs: 1800, shield: 1500 }],
]) {
  const label = { head: 'helm', body: 'platebody', legs: 'platelegs', shield: 'shield' };
  for (const slot of ['head', 'body', 'legs', 'shield']) {
    ITEMS[`${tier}_${label[slot]}`] = { name: `${cap(tier)} ${label[slot]}`, kind: 'armour', slot, tier, buy: prices[slot], reduction, shop: 'Armour' };
  }
}
// Gold Exchange goods: backpack items, traded only on the Exchange.
const GOODS = [
  { id: 'bones', name: 'Dragon bones', base: 40, min: 20, max: 80 },
  { id: 'herbs', name: 'Ranarr herbs', base: 25, min: 10, max: 60 },
  { id: 'gems', name: 'Cut gems', base: 120, min: 60, max: 240 },
  { id: 'bars', name: 'Gold bars', base: 90, min: 45, max: 180 },
  { id: 'runes', name: 'Nature runes', base: 15, min: 5, max: 40 },
  { id: 'charms', name: 'Spirit charms', base: 60, min: 30, max: 120 },
];
for (const g of GOODS) ITEMS[g.id] = { name: g.name, kind: 'good' };
const SHOPS = ['Potion', 'Weapon', 'Armour', 'Food & Supplies'];
const exchangePrices = {};
for (const g of GOODS) exchangePrices[g.id] = g.base;

function sellPrice(itemId) {
  const def = ITEMS[itemId];
  return def && def.buy ? Math.max(1, Math.floor(def.buy * SHOP_SELLBACK)) : 0;
}
function catalogList() {
  return Object.entries(ITEMS).filter(([, d]) => d.buy).map(([id, d]) => ({
    id, name: d.name, kind: d.kind, slot: d.slot || null, shop: d.shop, buy: d.buy, sell: sellPrice(id),
    heal: d.heal || 0, prayerRestore: d.prayerRestore || 0,
    accBonus: d.accBonus || 0, maxBonus: d.maxBonus || 0, reduction: d.reduction || 0,
  }));
}
function goodsList() {
  return GOODS.map((g) => ({ id: g.id, name: g.name, price: exchangePrices[g.id] }));
}

// ---------- player state v2 ----------
function newProfile(username) {
  return {
    username, gold: START_GOLD, rating: 1000, wins: 0, losses: 0,
    style: 'accurate', createdAt: new Date().toISOString(),
    backpack: [], // [{item, qty}] stacks, max BACKPACK_MAX_STACKS distinct
    worn: { weapon: null, shield: null, head: null, body: null, legs: null },
    bank: [], // [{item, qty}] stacks — items only, gold stays a number
    prayerPoints: PRAYER_MAX, prayerMax: PRAYER_MAX, activePrayer: null,
    specialEnergy: 0,
  };
}
// Migration: Phase 1 accounts gain the v2 fields with defaults. Existing
// gold / rating / record / style are never touched.
function ensureV2(p) {
  let changed = false;
  if (!Array.isArray(p.backpack)) { p.backpack = []; changed = true; }
  if (!p.worn || typeof p.worn !== 'object') { p.worn = { weapon: null, shield: null, head: null, body: null, legs: null }; changed = true; }
  for (const slot of ['weapon', 'shield', 'head', 'body', 'legs']) if (!(slot in p.worn)) { p.worn[slot] = null; changed = true; }
  if (!Array.isArray(p.bank)) { p.bank = []; changed = true; }
  if (typeof p.prayerMax !== 'number') { p.prayerMax = PRAYER_MAX; changed = true; }
  if (typeof p.prayerPoints !== 'number') { p.prayerPoints = p.prayerMax; changed = true; }
  if (!('activePrayer' in p)) { p.activePrayer = null; changed = true; }
  if (typeof p.specialEnergy !== 'number') { p.specialEnergy = 0; changed = true; }
  return changed;
}
function publicProfile(p) {
  ensureV2(p);
  return {
    username: p.username, gold: p.gold, rating: p.rating, wins: p.wins, losses: p.losses, style: p.style,
    backpack: p.backpack.map((s) => ({ item: s.item, qty: s.qty })),
    worn: { ...p.worn },
    bank: p.bank.map((s) => ({ item: s.item, qty: s.qty })),
    prayerPoints: Math.round(p.prayerPoints * 10) / 10, prayerMax: p.prayerMax,
    activePrayer: p.activePrayer, specialEnergy: p.specialEnergy,
  };
}
function leaderboardProfile(p) {
  return { username: p.username, gold: p.gold, rating: p.rating, wins: p.wins, losses: p.losses, style: p.style };
}

// ---------- backpack / bank stack helpers ----------
function stackQty(stacks, item) {
  const s = stacks.find((x) => x.item === item);
  return s ? s.qty : 0;
}
// Adds qty to a stack array. Returns the qty that did NOT fit (0 = all fit).
function addStacks(stacks, item, qty, maxStacks = Infinity) {
  const s = stacks.find((x) => x.item === item);
  if (s) { s.qty += qty; return 0; }
  if (stacks.length >= maxStacks) return qty;
  stacks.push({ item, qty });
  return 0;
}
function removeStacks(stacks, item, qty) {
  const s = stacks.find((x) => x.item === item);
  if (!s || s.qty < qty) return false;
  s.qty -= qty;
  if (s.qty <= 0) stacks.splice(stacks.indexOf(s), 1);
  return true;
}
// Validate + normalise a client-supplied [{item, qty}] stake list.
function sanitizeItems(list) {
  if (!Array.isArray(list)) return [];
  const merged = new Map();
  for (const e of list.slice(0, 28)) {
    const item = String((e && e.item) || '');
    const qty = Math.floor(+(e && e.qty) || 0);
    if (!ITEMS[item] || qty < 1) continue;
    merged.set(item, (merged.get(item) || 0) + qty);
  }
  return [...merged.entries()].map(([item, qty]) => ({ item, qty }));
}
function hasItems(profile, items) {
  return items.every((s) => stackQty(profile.backpack, s.item) >= s.qty);
}

// ---------- HTTP: static client + account APIs ----------
const tokens = new Map(); // token -> username (in-memory sessions)
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const { username, password } = await readBody(req);
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_ ]{3,16}$/.test(name)) return json(res, 400, { error: 'Name: 3-16 letters/numbers.' });
    if (String(password || '').length < 6) return json(res, 400, { error: 'Password: 6+ characters.' });
    const key = name.toLowerCase();
    if (db.users[key]) return json(res, 409, { error: 'That name is taken.' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[key] = { salt, passHash: hashPass(password, salt), profile: newProfile(name) };
    save(key);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, key);
    return json(res, 200, { token, profile: publicProfile(db.users[key].profile) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { username, password } = await readBody(req);
    const key = String(username || '').trim().toLowerCase();
    const u = db.users[key];
    if (!u || u.passHash !== hashPass(String(password || ''), u.salt)) return json(res, 401, { error: 'Wrong name or password.' });
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, key);
    return json(res, 200, { token, profile: publicProfile(u.profile) });
  }
  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const rows = Object.values(db.users).map((u) => leaderboardProfile(u.profile))
      .sort((a, b) => b.rating - a.rating).slice(0, 20);
    return json(res, 200, { leaderboard: rows });
  }
  // static files
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) { res.writeHead(404); return res.end('not found'); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'text/plain' });
  fs.createReadStream(full).pipe(res);
});

// ---------- Real-time play ----------
const wss = new WebSocketServer({ server, path: '/ws' });
const online = new Map(); // usernameKey -> { ws, profile, x, y, duelId }
const challenges = new Map(); // id -> { from, to, stake, items, expires }
const duels = new Map(); // id -> duel

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, exceptKey) {
  for (const [k, p] of online) if (k !== exceptKey) send(p.ws, obj);
}
function playersSnapshot() {
  return [...online.values()].map((p) => ({
    username: p.profile.username, x: Math.round(p.x), y: Math.round(p.y),
    inDuel: !!p.duelId, activePrayer: p.profile.activePrayer || null,
  }));
}
function broadcastState() { broadcast({ type: 'state', players: playersSnapshot() }); }
function sendProfile(key) {
  const p = online.get(key);
  if (p) send(p.ws, { type: 'profile', profile: publicProfile(p.profile) });
}

const STYLES = {
  accurate:   { acc: 0.85, max: 11 }, // +accuracy
  aggressive: { acc: 0.70, max: 15 }, // +power
  defensive:  { acc: 0.75, max: 11, block: 0.35 }, // chance to fully block
  controlled: { acc: 0.78, max: 13 }, // a bit of all three
};
function weaponBonus(p) {
  const def = p.worn && p.worn.weapon ? ITEMS[p.worn.weapon] : null;
  return def && def.kind === 'weapon' ? def : null;
}
function armourReduction(p) {
  let r = 0, filled = 0;
  for (const slot of ['head', 'body', 'legs', 'shield']) {
    const def = p.worn && p.worn[slot] ? ITEMS[p.worn[slot]] : null;
    if (def && def.kind === 'armour') { r += def.reduction; filled += 1; }
  }
  if (filled === 4) r += 0.05; // full-set bonus
  return Math.min(r, 0.45);
}
// Returns damage dealt (0 = miss / blocked / fully absorbed by armour).
function rollHit(attackerProfile, defenderProfile, useSpecial = false) {
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  const d = STYLES[defenderProfile.style] || STYLES.accurate;
  if (d.block && Math.random() < d.block) return 0;
  const w = weaponBonus(attackerProfile);
  let acc = s.acc + (w ? w.accBonus : 0);
  let max = s.max + (w ? w.maxBonus : 0);
  if (useSpecial) { acc += 0.05; max = Math.floor(max * 1.5); } // Dragon Slash
  if (Math.random() > Math.min(acc, 0.98)) return 0;
  const raw = 1 + Math.floor(Math.random() * max);
  return Math.floor(raw * (1 - armourReduction(defenderProfile)));
}

function endDuel(duel, winnerKey, reason) {
  if (duel.done) return;
  duel.done = true;
  clearInterval(duel.timer);
  duels.delete(duel.id);
  const winner = db.users[winnerKey].profile;
  const loserKey = duel.a === winnerKey ? duel.b : duel.a;
  const loser = db.users[loserKey].profile;
  winner.gold += duel.pot; // escrow pays out — server held both stakes
  // Item escrow: winner takes every staked item. Anything that cannot fit
  // the winner's backpack overflows into their bank so nothing is lost.
  const itemsWon = [];
  for (const s of duel.escrowItems) {
    const leftover = addStacks(winner.backpack, s.item, s.qty, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(winner.bank, s.item, leftover);
    itemsWon.push({ item: s.item, qty: s.qty });
  }
  winner.wins += 1; loser.losses += 1;
  winner.rating += 11; loser.rating = Math.max(0, loser.rating - 11);
  save(winnerKey); save(loserKey);
  for (const k of [duel.a, duel.b]) {
    const p = online.get(k);
    if (p) { p.duelId = null; send(p.ws, { type: 'duel_end', winner: winner.username, reason, pot: duel.pot, itemsWon, profile: publicProfile(db.users[k].profile) }); }
  }
  broadcast({ type: 'chat', from: 'Duel Master', text: `${winner.username} beat ${loser.username} for ${duel.pot}g (${reason}).` });
  broadcastState();
}

function startDuel(aKey, bKey, stake, itemsA = [], itemsB = []) {
  const a = db.users[aKey].profile, b = db.users[bKey].profile;
  // Escrow: both gold stakes AND both item stakes leave purses/backpacks
  // before the first tick. A decline never reaches here, so takes nothing.
  a.gold -= stake; b.gold -= stake;
  const escrowItems = [];
  for (const s of itemsA) { removeStacks(a.backpack, s.item, s.qty); addStacks(escrowItems, s.item, s.qty); }
  for (const s of itemsB) { removeStacks(b.backpack, s.item, s.qty); addStacks(escrowItems, s.item, s.qty); }
  save(aKey); save(bKey);
  const id = crypto.randomBytes(6).toString('hex');
  const duel = {
    id, a: aKey, b: bKey, stake, pot: stake * 2, escrowItems,
    hp: { [aKey]: 99, [bKey]: 99 }, specialQueued: { [aKey]: false, [bKey]: false },
    done: false, timer: null,
  };
  duels.set(id, duel);
  online.get(aKey).duelId = id; online.get(bKey).duelId = id;
  for (const k of [aKey, bKey]) {
    const p = online.get(k);
    send(p.ws, { type: 'duel_start', duelId: id, stake, pot: duel.pot, escrowItems, you: db.users[k].profile.username, opponent: db.users[k === aKey ? bKey : aKey].profile.username, profile: publicProfile(db.users[k].profile) });
  }
  broadcastState();
  duel.timer = setInterval(() => {
    // Both attacks due this tick resolve, then deaths are checked (OSRS tick rule).
    const aSpecial = duel.specialQueued[aKey], bSpecial = duel.specialQueued[bKey];
    duel.specialQueued[aKey] = false; duel.specialQueued[bKey] = false;
    if (aSpecial) a.specialEnergy = Math.max(0, a.specialEnergy - SPECIAL_COST);
    if (bSpecial) b.specialEnergy = Math.max(0, b.specialEnergy - SPECIAL_COST);
    const dmgToB = rollHit(a, b, aSpecial);
    const dmgToA = rollHit(b, a, bSpecial);
    duel.hp[bKey] = Math.max(0, duel.hp[bKey] - dmgToB);
    duel.hp[aKey] = Math.max(0, duel.hp[aKey] - dmgToA);
    // Special energy charges on landed (damaging) hits.
    if (dmgToB > 0) a.specialEnergy = Math.min(100, a.specialEnergy + SPECIAL_CHARGE_PER_HIT);
    if (dmgToA > 0) b.specialEnergy = Math.min(100, b.specialEnergy + SPECIAL_CHARGE_PER_HIT);
    for (const k of [aKey, bKey]) {
      const p = online.get(k);
      if (p) send(p.ws, {
        type: 'duel_tick', hpYou: duel.hp[k], hpOpponent: duel.hp[k === aKey ? bKey : aKey],
        youHit: k === aKey ? dmgToB : dmgToA, oppHit: k === aKey ? dmgToA : dmgToB,
        youSpecial: k === aKey ? aSpecial : bSpecial, oppSpecial: k === aKey ? bSpecial : aSpecial,
        energyYou: db.users[k].profile.specialEnergy,
      });
    }
    if (duel.hp[aKey] <= 0 && duel.hp[bKey] <= 0) endDuel(duel, Math.random() < 0.5 ? aKey : bKey, 'double KO — coin flip');
    else if (duel.hp[bKey] <= 0) endDuel(duel, aKey, 'KO');
    else if (duel.hp[aKey] <= 0) endDuel(duel, bKey, 'KO');
  }, TICK_MS);
}

// Gold Exchange prices drift on a random walk inside each good's band.
setInterval(() => {
  for (const g of GOODS) {
    const cur = exchangePrices[g.id];
    let delta = Math.round(cur * (Math.random() - 0.5) * 0.08);
    if (delta === 0 && Math.random() < 0.5) delta = Math.random() < 0.5 ? -1 : 1;
    exchangePrices[g.id] = Math.max(g.min, Math.min(g.max, cur + delta));
  }
  broadcast({ type: 'exchange_prices', goods: goodsList() });
}, 6000);

// Prayer drain: 1 point per 3 seconds while a Protect prayer is active
// (1/3 point per 1s tick). At 0 the prayer switches itself off.
setInterval(() => {
  let anyOff = false;
  for (const [k, p] of online) {
    const prof = p.profile;
    if (!prof.activePrayer) continue;
    prof.prayerPoints = Math.max(0, prof.prayerPoints - 1 / 3);
    if (prof.prayerPoints <= 0.01) {
      prof.prayerPoints = 0;
      prof.activePrayer = null;
      anyOff = true;
      save(k);
      send(p.ws, { type: 'chat', from: 'Game', text: 'Your prayer points have run out — prayer off.' });
      sendProfile(k);
    }
  }
  if (anyOff) broadcastState();
}, 1000);

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const key = tokens.get(token);
  if (!key) { ws.close(4001, 'bad token'); return; }
  if (online.has(key)) { send(ws, { type: 'error', message: 'Already signed in somewhere else.' }); ws.close(); return; }
  const profile = db.users[key].profile;
  ensureV2(profile);
  online.set(key, { ws, profile, x: 100 + Math.random() * 500, y: 100 + Math.random() * 250, duelId: null });
  send(ws, { type: 'welcome', profile: publicProfile(profile), players: playersSnapshot() });
  send(ws, { type: 'catalog', items: catalogList(), shops: SHOPS });
  send(ws, { type: 'exchange_prices', goods: goodsList() });
  broadcast({ type: 'chat', from: 'Game', text: `${profile.username} entered the plaza.` }, key);
  broadcastState();

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = online.get(key); if (!me) return;
    if (m.type === 'move') {
      me.x = Math.max(0, Math.min(800, +m.x || 0));
      me.y = Math.max(0, Math.min(450, +m.y || 0));
      broadcastState();
    }
    if (m.type === 'chat') {
      const text = String(m.text || '').slice(0, 140).trim();
      if (text) broadcast({ type: 'chat', from: profile.username, text });
    }
    if (m.type === 'style') {
      if (STYLES[m.style]) { profile.style = m.style; save(key); send(ws, { type: 'profile', profile: publicProfile(profile) }); }
    }

    // ----- Shops (one catalog; the shop name is display metadata only) -----
    if (m.type === 'shop_buy') {
      const item = String(m.item || '');
      const def = ITEMS[item];
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!def || !def.buy) return send(ws, { type: 'error', message: 'That is not sold in the shops.' });
      const cost = def.buy * qty;
      if (profile.gold < cost) return send(ws, { type: 'error', message: `Not enough gold — ${def.name} x${qty} costs ${cost}g.` });
      if (addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
      profile.gold -= cost;
      save(key);
      send(ws, { type: 'shop', action: 'buy', shop: def.shop, item, qty, total: cost });
      return sendProfile(key);
    }
    if (m.type === 'shop_sell') {
      const item = String(m.item || '');
      const def = ITEMS[item];
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
      if (!def.buy) return send(ws, { type: 'error', message: 'The shops don\'t buy that — try the Gold Exchange.' });
      if (!removeStacks(profile.backpack, item, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${def.name}.` });
      const total = sellPrice(item) * qty;
      profile.gold += total;
      save(key);
      send(ws, { type: 'shop', action: 'sell', shop: def.shop, item, qty, total });
      return sendProfile(key);
    }

    // ----- Equip / unequip (tap-to-wear: wearing swaps with the slot) -----
    if (m.type === 'equip') {
      const item = String(m.item || '');
      const def = ITEMS[item];
      if (!def || !def.slot) return send(ws, { type: 'error', message: 'That can\'t be worn.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${def.name} in your backpack.` });
      const old = profile.worn[def.slot];
      // Swapping puts the old piece back in the backpack. That needs a new
      // stack only if the old piece isn't already stacked there; removing
      // the newly equipped item first may free its own stack slot.
      const stacksAfterRemove = profile.backpack.length - (stackQty(profile.backpack, item) === 1 ? 1 : 0);
      if (old && old !== item && stackQty(profile.backpack, old) === 0 && stacksAfterRemove >= BACKPACK_MAX_STACKS) {
        return send(ws, { type: 'error', message: 'Backpack full — no room to swap.' });
      }
      removeStacks(profile.backpack, item, 1);
      if (old) addStacks(profile.backpack, old, 1, BACKPACK_MAX_STACKS);
      profile.worn[def.slot] = item;
      save(key);
      return sendProfile(key);
    }
    if (m.type === 'unequip') {
      const slot = String(m.slot || '');
      if (!(slot in profile.worn)) return send(ws, { type: 'error', message: 'Unknown slot.' });
      const item = profile.worn[slot];
      if (!item) return send(ws, { type: 'error', message: 'Nothing worn there.' });
      if (addStacks(profile.backpack, item, 1, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
      profile.worn[slot] = null;
      save(key);
      return sendProfile(key);
    }

    // ----- Use a consumable -----
    if (m.type === 'use') {
      const item = String(m.item || '');
      const def = ITEMS[item];
      if (!def || (def.kind !== 'food' && def.kind !== 'potion')) return send(ws, { type: 'error', message: 'That can\'t be used.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${def.name} in your backpack.` });
      if (def.prayerRestore) {
        if (profile.prayerPoints >= profile.prayerMax) return send(ws, { type: 'error', message: 'Prayer points already full.' });
        removeStacks(profile.backpack, item, 1);
        profile.prayerPoints = Math.min(profile.prayerMax, profile.prayerPoints + def.prayerRestore);
        save(key);
        return sendProfile(key);
      }
      // Healing only matters mid-duel; refuse (without consuming) outside one.
      const duel = me.duelId ? duels.get(me.duelId) : null;
      if (!duel) return send(ws, { type: 'error', message: 'Healing only works during a duel.' });
      if (duel.hp[key] >= 99) return send(ws, { type: 'error', message: 'Already at full health.' });
      removeStacks(profile.backpack, item, 1);
      duel.hp[key] = Math.min(99, duel.hp[key] + def.heal);
      save(key);
      for (const k of [duel.a, duel.b]) {
        const p = online.get(k);
        if (p) send(p.ws, {
          type: 'duel_tick', hpYou: duel.hp[k], hpOpponent: duel.hp[k === duel.a ? duel.b : duel.a],
          youHit: 0, oppHit: 0, youSpecial: false, oppSpecial: false,
          energyYou: db.users[k].profile.specialEnergy,
          note: `${profile.username} used ${def.name} (+${def.heal} HP)`,
        });
      }
      return sendProfile(key);
    }

    // ----- Bank of Gielinor (items only; gold stays a profile number) -----
    if (m.type === 'bank_deposit' || m.type === 'bank_withdraw') {
      const item = String(m.item || '');
      const def = ITEMS[item];
      const qty = Math.max(1, Math.min(9999, Math.floor(+m.qty || 1)));
      if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
      if (m.type === 'bank_deposit') {
        if (!removeStacks(profile.backpack, item, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${def.name}.` });
        addStacks(profile.bank, item, qty);
      } else {
        if (stackQty(profile.bank, item) < qty) return send(ws, { type: 'error', message: `The bank doesn't hold ${qty} x ${def.name}.` });
        if (addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
        removeStacks(profile.bank, item, qty);
      }
      save(key);
      return sendProfile(key);
    }

    // ----- Gold Exchange -----
    if (m.type === 'exchange_buy' || m.type === 'exchange_sell') {
      const good = GOODS.find((g) => g.id === String(m.good || ''));
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!good) return send(ws, { type: 'error', message: 'Unknown exchange good.' });
      const price = exchangePrices[good.id];
      if (m.type === 'exchange_buy') {
        const cost = price * qty;
        if (profile.gold < cost) return send(ws, { type: 'error', message: `Not enough gold — ${good.name} x${qty} costs ${cost}g.` });
        if (addStacks(profile.backpack, good.id, qty, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
        profile.gold -= cost;
        save(key);
        send(ws, { type: 'exchange', action: 'buy', good: good.id, qty, price, total: cost });
      } else {
        if (!removeStacks(profile.backpack, good.id, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${good.name}.` });
        const total = Math.floor(price * qty * EXCHANGE_SELLBACK);
        profile.gold += total;
        save(key);
        send(ws, { type: 'exchange', action: 'sell', good: good.id, qty, price, total });
      }
      return sendProfile(key);
    }

    // ----- Prayers (OSRS Protect: one at a time, tap toggles) -----
    if (m.type === 'prayer') {
      const want = m.prayer === null ? null : String(m.prayer || '');
      if (want !== null && !['melee', 'missiles', 'magic'].includes(want)) {
        return send(ws, { type: 'error', message: 'Unknown prayer.' });
      }
      // Tapping the active prayer turns it off; a different one replaces it
      // (the previous switches off automatically — only one is ever active).
      profile.activePrayer = (want === null || want === profile.activePrayer) ? null : want;
      if (profile.activePrayer && profile.prayerPoints <= 0) {
        profile.activePrayer = null;
        return send(ws, { type: 'error', message: 'Out of prayer points — drink a prayer potion.' });
      }
      save(key);
      broadcastState();
      return sendProfile(key);
    }

    // ----- Special attack (Dragon Slash) -----
    if (m.type === 'special') {
      const duel = me.duelId ? duels.get(me.duelId) : null;
      if (!duel) return send(ws, { type: 'error', message: 'You are not in a duel.' });
      if (profile.specialEnergy < SPECIAL_COST) return send(ws, { type: 'error', message: `Dragon Slash needs ${SPECIAL_COST} special energy (you have ${Math.floor(profile.specialEnergy)}).` });
      if (duel.specialQueued[key]) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
      duel.specialQueued[key] = true;
      return send(ws, { type: 'chat', from: 'Game', text: 'Dragon Slash queued — it fires on the next tick.' });
    }

    // ----- Challenges & duels -----
    if (m.type === 'challenge') {
      const targetKey = String(m.target || '').toLowerCase();
      const stake = Math.floor(+m.stake || 0);
      const items = sanitizeItems(m.items);
      const target = online.get(targetKey);
      if (!target || targetKey === key) return send(ws, { type: 'error', message: 'Pick another online player.' });
      if (me.duelId || target.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (items.length === 0 && stake < 1) return send(ws, { type: 'error', message: 'Stake at least 1g, or stake items.' });
      if (stake < 0 || stake > profile.gold || stake > target.profile.gold) return send(ws, { type: 'error', message: 'Gold stake must be up to what you both have.' });
      if (!hasItems(profile, items)) return send(ws, { type: 'error', message: 'You don\'t have all the items you tried to stake.' });
      const id = crypto.randomBytes(6).toString('hex');
      challenges.set(id, { from: key, to: targetKey, stake, items, expires: Date.now() + 30000 });
      send(target.ws, { type: 'challenge_incoming', challengeId: id, from: profile.username, stake, items, seconds: 30 });
      send(ws, { type: 'chat', from: 'Game', text: `Challenge sent to ${target.profile.username} for ${stake}g${items.length ? ' + items' : ''}.` });
    }
    if (m.type === 'challenge_response') {
      const ch = challenges.get(m.challengeId);
      if (!ch || ch.to !== key || ch.expires < Date.now()) { challenges.delete(m.challengeId); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      challenges.delete(m.challengeId);
      const fromP = online.get(ch.from);
      if (!fromP) return;
      if (!m.accept) { send(fromP.ws, { type: 'chat', from: 'Game', text: `${profile.username} declined. No gold or items were taken.` }); return; }
      const myItems = sanitizeItems(m.items);
      // Re-check purses AND backpacks at accept time — escrow only happens now.
      if (db.users[ch.from].profile.gold < ch.stake || profile.gold < ch.stake) return send(ws, { type: 'error', message: 'Someone no longer has the gold.' });
      if (!hasItems(db.users[ch.from].profile, ch.items)) return send(ws, { type: 'error', message: 'The challenger no longer has the staked items.' });
      if (!hasItems(profile, myItems)) return send(ws, { type: 'error', message: 'You don\'t have all the items you tried to stake.' });
      startDuel(ch.from, key, ch.stake, ch.items, myItems);
    }
  });

  ws.on('close', () => {
    const me = online.get(key);
    if (me && me.duelId) {
      const duel = duels.get(me.duelId);
      if (duel) endDuel(duel, duel.a === key ? duel.b : duel.a, 'forfeit — left mid-duel');
    }
    online.delete(key);
    broadcast({ type: 'chat', from: 'Game', text: `${profile.username} left the plaza.` });
    broadcastState();
  });
});

store.init().then((users) => {
  db.users = users;
  // Phase 2 migration: existing accounts gain the new fields on load.
  for (const [k, u] of Object.entries(db.users)) {
    if (u && u.profile && ensureV2(u.profile)) save(k);
  }
  const mode = process.env.DATABASE_URL ? 'Postgres database' : 'local file (test mode)';
  server.listen(PORT, () => console.log(`nallystake-online listening on :${PORT} (gold-only, saving: ${mode})`));
}).catch((e) => { console.error('Could not open the saving database:', e.message); process.exit(1); });
