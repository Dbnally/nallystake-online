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
// and OSRS Protect prayers (toggle/drain/badge).
//
// Stage 1 (catch-up) adds: the skills foundation (13 skills on the real
// OSRS XP curve, total level + OSRS combat level, saved per player), the
// areas framework (plaza + Goblin Camp, per-area player snapshots), and
// server-run NPC combat vs goblins (drops: gold, ranarr herbs, prayer
// potions). Prayer rule per Derek's spec: Protect prayers FULLY block
// matching NPC hits; they still do NOT block in PvP duels — every duel
// attack is melee-type, so a full block would stalemate every fight.
//
// Stage 2 (catch-up) adds: three more areas (Training Cave, Gathering
// Cave, Fishing Cove), a gathering system (resource nodes with level
// gates, charges and respawns; training stations that grant XP only),
// lightable fires (60s, Firemaking XP) and cooking on them (burn chance
// falls with Cooking level). Gathered resources are sell-only stock:
// shops buy them at a fixed price but never sell them.
//
// Stage 3 (catch-up) adds: the Emberfall Mine & Smithy (north-east) —
// nine mine rocks up to Runite (Mining 85), pickaxes from Pickaxe Pete
// (a carried pickaxe shortens the Mining action cooldown and improves
// the odds), furnace smelting of all eight bars, and RS3-style anvil
// smithing: start a piece from a bar, hammer it while it is hot (heat
// fades over time and with every hit, slowing progress), reheat at the
// furnace, and upgrade finished pieces +1 to +4 with more bars. The
// unfinished piece on the anvil is SESSION-ONLY state — it is lost if
// you log out. Note: smelting gold ore yields `bars`, the existing
// Gold bars Exchange good — one gold-bar item, traded on the Exchange.
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
// Stage 2 gathered resources + cooked food. No `buy` price (shops never
// sell them); `sellOnly` is the fixed price shops pay for them.
for (const [id, name, sellOnly, extra] of [
  ['copper_ore', 'Copper ore', 5, {}],
  ['tin_ore', 'Tin ore', 5, {}],
  ['iron_ore', 'Iron ore', 12, {}],
  ['coal', 'Coal', 25, {}],
  ['uncut_gem', 'Uncut gem', 60, {}],
  ['logs', 'Logs', 4, {}],
  ['oak_logs', 'Oak logs', 10, {}],
  ['raw_shrimps', 'Raw shrimps', 3, {}],
  ['raw_trout', 'Raw trout', 8, {}],
  ['burnt_fish', 'Burnt fish', 1, {}],
  ['cooked_trout', 'Cooked trout', 10, { kind: 'food', heal: 15 }],
  ['cooked_shrimps', 'Cooked shrimps', 5, { kind: 'food', heal: 4 }],
]) {
  ITEMS[id] = { name, kind: 'resource', sellOnly, ...extra };
}
// Stage 3: Emberfall ores + smelted bars. Sell-only resources, like
// Stage 2's. (The eighth bar, gold, is the `bars` Exchange good above.)
for (const [id, name, sellOnly] of [
  ['silver_ore', 'Silver ore', 15],
  ['gold_ore', 'Gold ore', 30],
  ['mithril_ore', 'Mithril ore', 60],
  ['adamantite_ore', 'Adamantite ore', 120],
  ['runite_ore', 'Runite ore', 300],
  ['bronze_bar', 'Bronze bar', 12],
  ['iron_bar', 'Iron bar', 25],
  ['silver_bar', 'Silver bar', 30],
  ['steel_bar', 'Steel bar', 45],
  ['mithril_bar', 'Mithril bar', 110],
  ['adamant_bar', 'Adamant bar', 220],
  ['rune_bar', 'Rune bar', 500],
]) {
  ITEMS[id] = { name, kind: 'resource', sellOnly };
}
// Stage 3: pickaxes, sold by Pickaxe Pete. A pickaxe works just by
// being carried: the best one in the backpack speeds up Mining gathers
// (see the gather handler). `speed` is the multiplier (1.0 = no help).
for (const [tier, buy, speed] of [
  ['bronze', 60, 1.0], ['iron', 250, 1.15], ['steel', 900, 1.3],
  ['mithril', 3200, 1.5], ['adamant', 9000, 1.75], ['rune', 24000, 2.0], ['dragon', 60000, 2.5],
]) {
  ITEMS[`${tier}_pickaxe`] = { name: `${cap(tier)} pickaxe`, kind: 'tool', buy, speed, shop: 'Pickaxe Pete' };
}
// Stage 3: smithed gear — a sword and a platebody per metal, each in a
// base version plus +1..+4 upgrades (60 items, generated). Names read
// "Rune sword +2 (smithed)" / "Bronze platebody (smithed)". Never sold
// by shops (no `buy`); shops buy them back at `sellOnly` (the shop
// tier's floor, +25% per upgrade). Each upgrade adds +0.01 accuracy
// and +1 max hit (sword) or +0.01 damage reduction (platebody).
const SMITH_METALS = {
  bronze:  { level: 1,  bar: 'bronze_bar',  sword: { acc: 0.02, max: 1,  xp: 50,  sell: 30 },   body: { red: 0.03, xp: 75,  sell: 54 } },
  iron:    { level: 15, bar: 'iron_bar',    sword: { acc: 0.04, max: 2,  xp: 80,  sell: 72 },   body: { red: 0.04, xp: 120, sell: 110 } },
  steel:   { level: 30, bar: 'steel_bar',   sword: { acc: 0.06, max: 4,  xp: 120, sell: 180 },  body: { red: 0.06, xp: 180, sell: 225 } },
  mithril: { level: 55, bar: 'mithril_bar', sword: { acc: 0.08, max: 6,  xp: 200, sell: 480 },  body: { red: 0.08, xp: 300, sell: 600 } },
  adamant: { level: 70, bar: 'adamant_bar', sword: { acc: 0.10, max: 8,  xp: 300, sell: 900 },  body: { red: 0.09, xp: 450, sell: 1100 } },
  rune:    { level: 85, bar: 'rune_bar',    sword: { acc: 0.12, max: 10, xp: 450, sell: 1500 }, body: { red: 0.10, xp: 675, sell: 1800 } },
}; // body XP is the sword XP x 1.5, per Derek's smithy spec
const SMITH_RECIPES = {}; // base item id -> { metal, kind, level, bar, xp }
for (const [metal, md] of Object.entries(SMITH_METALS)) {
  for (const kindName of ['sword', 'platebody']) {
    const baseId = `smith_${metal}_${kindName}`;
    const st = kindName === 'sword' ? md.sword : md.body;
    SMITH_RECIPES[baseId] = { metal, kind: kindName, level: md.level, bar: md.bar, xp: st.xp };
    for (let u = 0; u <= 4; u++) {
      const id = u === 0 ? baseId : `${baseId}_u${u}`;
      const name = `${cap(metal)} ${kindName}${u ? ' +' + u : ''} (smithed)`;
      const sellOnly = Math.round(st.sell * (1 + 0.25 * u));
      if (kindName === 'sword') {
        ITEMS[id] = { name, kind: 'weapon', slot: 'weapon', sellOnly, accBonus: Math.round((st.acc + 0.01 * u) * 100) / 100, maxBonus: st.max + u, smithMetal: metal, smithUpgrade: u, smithBase: baseId };
      } else {
        ITEMS[id] = { name, kind: 'armour', slot: 'body', sellOnly, reduction: Math.round((st.red + 0.01 * u) * 100) / 100, smithMetal: metal, smithUpgrade: u, smithBase: baseId };
      }
    }
  }
}
const SHOPS = ['Potion', 'Weapon', 'Armour', 'Food & Supplies', 'Pickaxe Pete'];
const exchangePrices = {};
for (const g of GOODS) exchangePrices[g.id] = g.base;

function sellPrice(itemId) {
  const def = ITEMS[itemId];
  if (!def) return 0;
  if (def.buy) return Math.max(1, Math.floor(def.buy * SHOP_SELLBACK));
  if (def.sellOnly) return def.sellOnly; // Stage 2 resources: fixed buy-back
  return 0;
}
function catalogList() {
  // Buyable stock plus sell-only resources (buy: 0, shop: null — the
  // client filters buy lists by shop name, so resources never show as
  // buyable, but sell mode and name lookups can see them).
  return Object.entries(ITEMS).filter(([, d]) => d.buy || d.sellOnly).map(([id, d]) => ({
    id, name: d.name, kind: d.kind, slot: d.slot || null, shop: d.shop || null, buy: d.buy || 0, sell: sellPrice(id),
    heal: d.heal || 0, prayerRestore: d.prayerRestore || 0,
    accBonus: d.accBonus || 0, maxBonus: d.maxBonus || 0, reduction: d.reduction || 0,
    speed: d.speed || 0, // Stage 3: pickaxe speed multiplier (0 for non-tools)
  }));
}
function goodsList() {
  return GOODS.map((g) => ({ id: g.id, name: g.name, price: exchangePrices[g.id] }));
}

// ---------- Skills (Stage 1): real OSRS XP curve ----------
// XP_TABLE[L] = total XP needed for level L, generated with the standard
// OSRS formula: floor( sum_{x=1}^{L-1} floor(x + 300 * 2^(x/7)) / 4 ).
// (Level 2 = 83, level 10 = 1154, level 99 = 13,034,431.)
const SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
  'mining', 'smithing', 'woodcutting', 'firemaking', 'fishing', 'cooking'];
const XP_TABLE = [0, 0]; // index by level 1..99
{
  let points = 0;
  for (let lvl = 2; lvl <= 99; lvl++) {
    const x = lvl - 1;
    points += Math.floor(x + 300 * Math.pow(2, x / 7));
    XP_TABLE[lvl] = Math.floor(points / 4);
  }
}
function levelForXp(xp) {
  let lvl = 1;
  for (let l = 2; l <= 99; l++) { if (xp >= XP_TABLE[l]) lvl = l; else break; }
  return lvl;
}
// New players: Hitpoints starts at level 10 (1154 XP, the OSRS default);
// every other skill starts at level 1 (0 XP).
function defaultXp() {
  const xp = {};
  for (const s of SKILLS) xp[s] = 0;
  xp.hitpoints = 1154;
  return xp;
}
function levelsOf(p) {
  const lv = {};
  for (const s of SKILLS) lv[s] = levelForXp((p.xp && p.xp[s]) || 0);
  return lv;
}
// OSRS combat level (float; clients floor it for display):
// base = 0.25*(Defence + Hitpoints + floor(Prayer/2)); combat = base +
// max(0.325*(Attack+Strength), 0.325*floor(Ranged*1.5), 0.325*floor(Magic*1.5)).
function combatLevelOf(levels) {
  const base = 0.25 * (levels.defence + levels.hitpoints + Math.floor(levels.prayer / 2));
  const melee = 0.325 * (levels.attack + levels.strength);
  const ranged = 0.325 * Math.floor(levels.ranged * 1.5);
  const magic = 0.325 * Math.floor(levels.magic * 1.5);
  return base + Math.max(melee, ranged, magic);
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
    xp: defaultXp(), // Stage 1 skills — see SKILLS / XP_TABLE above
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
  // Stage 1 migration: existing accounts gain the skills map with the
  // standard defaults (Hitpoints 1154, everything else 0). Nothing else
  // about the profile is touched.
  if (!p.xp || typeof p.xp !== 'object') { p.xp = defaultXp(); changed = true; }
  else {
    const d = defaultXp();
    for (const s of SKILLS) if (typeof p.xp[s] !== 'number' || p.xp[s] < 0) { p.xp[s] = d[s]; changed = true; }
  }
  return changed;
}
function publicProfile(p) {
  ensureV2(p);
  const levels = levelsOf(p);
  return {
    username: p.username, gold: p.gold, rating: p.rating, wins: p.wins, losses: p.losses, style: p.style,
    backpack: p.backpack.map((s) => ({ item: s.item, qty: s.qty })),
    worn: { ...p.worn },
    bank: p.bank.map((s) => ({ item: s.item, qty: s.qty })),
    prayerPoints: Math.round(p.prayerPoints * 10) / 10, prayerMax: p.prayerMax,
    activePrayer: p.activePrayer, specialEnergy: p.specialEnergy,
    // Stage 1 skills: raw XP per skill, computed levels, total, combat.
    xp: { ...p.xp },
    levels,
    totalLevel: SKILLS.reduce((t, s) => t + levels[s], 0),
    combatLevel: Math.round(combatLevelOf(levels) * 100) / 100,
  };
}
function leaderboardProfile(p) {
  return { username: p.username, gold: p.gold, rating: p.rating, wins: p.wins, losses: p.losses, style: p.style };
}
// Grant XP in one or more skills: applies the gains, sends one
// {type:'xp'} notice per skill (the client turns these into XP drops),
// and saves once. `online`/`send` are defined in the real-time section —
// this only runs while a player is connected and playing.
function addXp(key, gains) {
  const u = db.users[key];
  if (!u) return;
  const p = u.profile;
  ensureV2(p);
  let changed = false;
  for (const [skill, amt] of Object.entries(gains)) {
    if (!amt || !(skill in p.xp)) continue;
    p.xp[skill] += amt;
    changed = true;
    const sess = online.get(key);
    if (sess) send(sess.ws, { type: 'xp', skill, xp: p.xp[skill], level: levelForXp(p.xp[skill]) });
  }
  if (changed) save(key);
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
const online = new Map(); // usernameKey -> { ws, profile, x, y, area, duelId, npcFightId }
const challenges = new Map(); // id -> { from, to, stake, items, expires }
const duels = new Map(); // id -> duel

// ---------- Areas (Stage 1) ----------
// Each area has its own 0..800 x 0..450 coordinate space. A player's area
// is SESSION-ONLY state (not saved): everyone logs back into the plaza.
// Movement, snapshots and NPCs are per-area; chat stays global.
const AREAS = {
  plaza: { name: 'Plaza', spawn: { x: 400, y: 225 } },
  goblins: { name: 'Goblin Camp', spawn: { x: 100, y: 225 } },
  training: { name: 'Training Cave', spawn: { x: 400, y: 360 } },
  gathering: { name: 'Gathering Cave', spawn: { x: 400, y: 225 } },
  cove: { name: 'Fishing Cove', spawn: { x: 90, y: 225 } },
  mine: { name: 'Emberfall Mine & Smithy', spawn: { x: 400, y: 380 } },
};
const NPC_RANGE = 150; // server units — attack / stay-in-combat range (15 tiles at 10 units/tile)

// ---------- NPCs (Stage 1): Goblin Camp ----------
// Goblins are stationary at their spawn points this stage (no wandering).
const GOBLIN_DEF = { kind: 'goblin', name: 'Goblin', combatLevel: 5, maxHp: 12, maxHit: 2, acc: 0.55, attackType: 'melee', respawnMs: 10000 };
const GOBLIN_SPAWNS = [[200, 225], [320, 160], [420, 260], [520, 180], [380, 340], [600, 300]];
const npcs = new Map(); // id -> live NPC instance (all in the goblins area)
GOBLIN_SPAWNS.forEach(([x, y], i) => {
  const id = 'goblin' + (i + 1);
  npcs.set(id, { id, ...GOBLIN_DEF, area: 'goblins', x, y, spawnX: x, spawnY: y, hp: GOBLIN_DEF.maxHp, alive: true, respawnAt: 0, fightId: null });
});
const npcFights = new Map(); // id -> { id, playerKey, npcId, hpYou, maxHpYou, specialQueued, done, timer }
// Pseudo-profile so goblins can be the defender in the duel rollHit():
// no style block, no worn gear, no armour reduction.
const NPC_DEFENDER = { style: 'accurate', worn: { weapon: null, shield: null, head: null, body: null, legs: null } };

function npcStateMsg() {
  return {
    type: 'npc_state', area: 'goblins',
    npcs: [...npcs.values()].filter((n) => n.alive).map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp })),
  };
}
function broadcastNpcState() {
  const msg = npcStateMsg();
  for (const p of online.values()) if (p.area === 'goblins') send(p.ws, msg);
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, exceptKey) {
  for (const [k, p] of online) if (k !== exceptKey) send(p.ws, obj);
}
function playersSnapshot(area) {
  return [...online.values()].filter((p) => !area || p.area === area).map((p) => ({
    username: p.profile.username, x: Math.round(p.x), y: Math.round(p.y), area: p.area,
    inDuel: !!p.duelId, activePrayer: p.profile.activePrayer || null,
  }));
}
// State is per-area: players only see (and are seen by) their own area.
function broadcastState() {
  const areasPresent = new Set([...online.values()].map((p) => p.area));
  for (const area of areasPresent) {
    const msg = { type: 'state', area, players: playersSnapshot(area) };
    for (const p of online.values()) if (p.area === area) send(p.ws, msg);
  }
}
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

// ---------- NPC combat (Stage 1) ----------
// Combat XP for one damaging hit of `dmg`, OSRS-style: dmg*4 to the
// style's skill (controlled splits it across Attack/Strength/Defence —
// each floor(total/3), remainder to Defence) plus dmg*1.33 to Hitpoints.
function combatXpGains(style, dmg) {
  const total = dmg * 4;
  const gains = { hitpoints: Math.round(dmg * 1.33) };
  if (style === 'aggressive') gains.strength = total;
  else if (style === 'defensive') gains.defence = total;
  else if (style === 'controlled') {
    const each = Math.floor(total / 3);
    gains.attack = each; gains.strength = each; gains.defence = total - each * 2;
  } else gains.attack = total; // accurate (and any fallback)
  return gains;
}
// Goblin drop table: 2-8 gold coins always; plus one item roll —
// 15% prayer potion, 25% ranarr herbs, 60% no item.
function rollNpcDrops(profile) {
  const gold = 2 + Math.floor(Math.random() * 7);
  profile.gold += gold;
  const items = [];
  const r = Math.random();
  const item = r < 0.15 ? 'prayer_potion' : r < 0.40 ? 'herbs' : null;
  if (item) {
    const leftover = addStacks(profile.backpack, item, 1, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(profile.bank, item, leftover); // full pack: bank it, never lose a drop
    items.push({ item, qty: 1 });
  }
  return { gold, items };
}
function finishNpcFight(fight, reason, drops) {
  if (fight.done) return;
  fight.done = true;
  clearInterval(fight.timer);
  npcFights.delete(fight.id);
  const npc = npcs.get(fight.npcId);
  if (npc && npc.fightId === fight.id) npc.fightId = null;
  const sess = online.get(fight.playerKey);
  if (sess) {
    if (sess.npcFightId === fight.id) sess.npcFightId = null;
    send(sess.ws, { type: 'npc_fight', phase: 'end', npcId: fight.npcId, kind: npc ? npc.kind : 'goblin', reason, drops: drops || null, profile: publicProfile(sess.profile) });
  }
}
// Friendly death rule: dying to an NPC costs NOTHING — the player wakes
// in the plaza (next fight starts at full HP, as fight HP is per-fight).
function respawnPlayer(key, note) {
  const sess = online.get(key);
  if (!sess) return;
  sess.area = 'plaza';
  sess.x = AREAS.plaza.spawn.x; sess.y = AREAS.plaza.spawn.y;
  send(sess.ws, { type: 'area', area: 'plaza' });
  send(sess.ws, { type: 'chat', from: 'Game', text: note });
  broadcastState();
}
function startNpcFight(key, npc) {
  const sess = online.get(key);
  const profile = sess.profile;
  const id = crypto.randomBytes(6).toString('hex');
  // Fight HP pool = the player's Hitpoints level (duels keep their 99 pool).
  const maxHpYou = Math.max(1, levelForXp(profile.xp.hitpoints));
  const fight = { id, playerKey: key, npcId: npc.id, hpYou: maxHpYou, maxHpYou, specialQueued: false, done: false, timer: null };
  npcFights.set(id, fight);
  sess.npcFightId = id;
  npc.fightId = id;
  send(sess.ws, {
    type: 'npc_fight', phase: 'start', npcId: npc.id, kind: npc.kind, name: npc.name, combatLevel: npc.combatLevel,
    hpYou: fight.hpYou, maxHpYou, hpNpc: npc.hp, maxHpNpc: npc.maxHp, energyYou: profile.specialEnergy,
  });
  fight.timer = setInterval(() => npcTick(fight), TICK_MS);
}
function npcTick(fight) {
  const sess = online.get(fight.playerKey);
  const npc = npcs.get(fight.npcId);
  if (!sess || !npc) { finishNpcFight(fight, 'gone'); return; }
  const profile = sess.profile;
  // Walking too far from the goblin breaks off the fight.
  if (sess.area !== npc.area || Math.hypot(sess.x - npc.x, sess.y - npc.y) > NPC_RANGE) { finishNpcFight(fight, 'range'); return; }
  const useSpec = fight.specialQueued; fight.specialQueued = false;
  if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
  // Player swing: the exact duel roll (style + worn weapon vs no armour).
  const youHit = rollHit(profile, NPC_DEFENDER, useSpec);
  // Goblin swing: Protect from Melee FULLY blocks it (Derek's OSRS spec);
  // otherwise the duel rules apply — Defensive style block chance, then
  // the goblin's accuracy, then the player's worn armour reduction.
  let npcHit = 0;
  if (profile.activePrayer === npc.attackType) npcHit = 0;
  else if (STYLES[profile.style] && STYLES[profile.style].block && Math.random() < STYLES[profile.style].block) npcHit = 0;
  else if (Math.random() <= npc.acc) {
    const raw = 1 + Math.floor(Math.random() * npc.maxHit);
    npcHit = Math.floor(raw * (1 - armourReduction(profile)));
  }
  npc.hp -= youHit;
  fight.hpYou -= npcHit;
  if (youHit > 0) {
    profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
    addXp(fight.playerKey, combatXpGains(profile.style, youHit));
  }
  send(sess.ws, {
    type: 'npc_fight', phase: 'tick', npcId: npc.id,
    hpYou: Math.max(0, fight.hpYou), maxHpYou: fight.maxHpYou,
    hpNpc: Math.max(0, npc.hp), maxHpNpc: npc.maxHp,
    youHit, npcHit, youSpecial: useSpec, energyYou: profile.specialEnergy,
  });
  broadcastNpcState();
  if (npc.hp <= 0) {
    // Kill: drops land, the goblin respawns in 10s. If the goblin's last
    // swing also dropped the player, the kill still counts (duel-style
    // both-resolve tick) and the player still wakes in the plaza.
    npc.alive = false; npc.hp = 0; npc.respawnAt = Date.now() + npc.respawnMs;
    const drops = rollNpcDrops(profile);
    save(fight.playerKey);
    const playerDead = fight.hpYou <= 0;
    finishNpcFight(fight, 'kill', drops);
    broadcastNpcState();
    if (playerDead) respawnPlayer(fight.playerKey, 'You took the goblin down with you — you wake up in the plaza. Nothing lost.');
    return;
  }
  if (fight.hpYou <= 0) {
    npc.hp = npc.maxHp; // the goblin resets when it wins
    finishNpcFight(fight, 'death', null);
    broadcastNpcState();
    respawnPlayer(fight.playerKey, 'The goblin got you! You wake up in the plaza at full health. Nothing lost.');
  }
}

// Goblin respawns: 10s after death, back at full HP on its spawn point.
setInterval(() => {
  let any = false;
  for (const npc of npcs.values()) {
    if (!npc.alive && Date.now() >= npc.respawnAt) { npc.alive = true; npc.hp = npc.maxHp; any = true; }
  }
  if (any) broadcastNpcState();
}, 1000);

// ---------- Gathering (Stage 2): resource nodes, fires, cooking ----------
// Node charges / depletion are session-only world state (like goblin HP);
// profiles keep the items and XP. Training stations have infinite charges
// and grant XP only (item: null) — the Training Cave is safe, no combat.
const GATHER_RANGE = 150; // server units, same as NPC attack range
const ACTION_COOLDOWN_MS = 1400; // one gather / cook / light-fire per player per 1.4s
const NODES = new Map(); // id -> node def + { chargesLeft, depletedUntil }
function defNode(id, area, kind, name, skill, levelReq, item, xp, charges, respawnMs, x, y) {
  NODES.set(id, { id, area, kind, name, skill, levelReq, item, xp, charges, respawnMs, x, y, chargesLeft: charges, depletedUntil: 0 });
}
// Gathering Cave — rocks on the west side, fishing spots at the east pool,
// trees scattered through the middle.
defNode('copper_rock', 'gathering', 'rock', 'Copper rock', 'mining', 1, 'copper_ore', 18, 3, 8000, 120, 110);
defNode('tin_rock', 'gathering', 'rock', 'Tin rock', 'mining', 1, 'tin_ore', 18, 3, 8000, 120, 230);
defNode('iron_rock', 'gathering', 'rock', 'Iron rock', 'mining', 15, 'iron_ore', 35, 2, 15000, 120, 350);
defNode('coal_rock', 'gathering', 'rock', 'Coal rock', 'mining', 30, 'coal', 50, 2, 20000, 240, 160);
defNode('gem_rock', 'gathering', 'rock', 'Gem rock', 'mining', 40, 'uncut_gem', 65, 1, 30000, 240, 300);
defNode('shrimp_spot', 'gathering', 'fish', 'Shrimp spot', 'fishing', 1, 'raw_shrimps', 10, 4, 8000, 640, 140);
defNode('trout_spot_g', 'gathering', 'fish', 'Trout spot', 'fishing', 20, 'raw_trout', 30, 3, 12000, 640, 300);
defNode('tree_g', 'gathering', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 420, 90);
defNode('oak_g', 'gathering', 'tree', 'Oak tree', 'woodcutting', 15, 'oak_logs', 38, 3, 15000, 470, 360);
// Fishing Cove — trees on the west shore, trout spots along the east lake
// edge. Cove trout are Fishing 1 on purpose: the cove is the starter
// fishing spot (Derek's cove spec names no level); the cave trout spot
// above is the level-20 one.
defNode('tree_c1', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 120, 100);
defNode('tree_c2', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 120, 230);
defNode('tree_c3', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 120, 360);
defNode('trout_spot_c1', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 660, 100);
defNode('trout_spot_c2', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 660, 225);
defNode('trout_spot_c3', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 660, 350);
// Training Cave — one station per combat skill, in a row. XP only.
defNode('attack_dummy', 'training', 'station', 'Attack dummy', 'attack', 1, null, 12, Infinity, 0, 140, 225);
defNode('strength_dummy', 'training', 'station', 'Strength dummy', 'strength', 1, null, 12, Infinity, 0, 240, 225);
defNode('defence_dummy', 'training', 'station', 'Defence dummy', 'defence', 1, null, 12, Infinity, 0, 340, 225);
defNode('ranged_target', 'training', 'station', 'Ranged target', 'ranged', 1, null, 12, Infinity, 0, 440, 225);
defNode('magic_dummy', 'training', 'station', 'Magic dummy', 'magic', 1, null, 12, Infinity, 0, 540, 225);
defNode('prayer_altar', 'training', 'station', 'Prayer altar', 'prayer', 1, null, 6, Infinity, 0, 640, 225);
// Emberfall Mine (Stage 3) — nine rocks across the west/north half;
// the south-east quadrant stays clear for the furnace + anvil (actions,
// not nodes). Iron is Mining 10 here per Derek's mine spec (the
// Gathering Cave's iron rock keeps its 15).
defNode('copper_rock_m', 'mine', 'rock', 'Copper rock', 'mining', 1, 'copper_ore', 18, 4, 8000, 120, 90);
defNode('tin_rock_m', 'mine', 'rock', 'Tin rock', 'mining', 1, 'tin_ore', 18, 4, 8000, 120, 200);
defNode('iron_rock_m', 'mine', 'rock', 'Iron rock', 'mining', 10, 'iron_ore', 35, 3, 12000, 120, 320);
defNode('silver_rock', 'mine', 'rock', 'Silver rock', 'mining', 20, 'silver_ore', 40, 3, 15000, 250, 90);
defNode('coal_rock_m', 'mine', 'rock', 'Coal rock', 'mining', 30, 'coal', 50, 3, 18000, 250, 200);
defNode('gold_rock', 'mine', 'rock', 'Gold rock', 'mining', 40, 'gold_ore', 65, 2, 20000, 380, 90);
defNode('mithril_rock', 'mine', 'rock', 'Mithril rock', 'mining', 55, 'mithril_ore', 80, 2, 25000, 380, 200);
defNode('adamantite_rock', 'mine', 'rock', 'Adamantite rock', 'mining', 70, 'adamantite_ore', 100, 2, 30000, 510, 90);
defNode('runite_rock', 'mine', 'rock', 'Runite rock', 'mining', 85, 'runite_ore', 125, 1, 40000, 510, 200);

function nodesMsg(area) {
  const now = Date.now();
  return {
    type: 'nodes', area,
    nodes: [...NODES.values()].filter((n) => n.area === area).map((n) => ({
      id: n.id, kind: n.kind, name: n.name, skill: n.skill, levelReq: n.levelReq, item: n.item, xp: n.xp,
      x: n.x, y: n.y, depleted: n.depletedUntil > now,
    })),
  };
}
function broadcastNodes(area) {
  const msg = nodesMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}
// Depleted nodes grow back on their respawn timer (checked every 1s,
// like goblin respawns) and the area hears about it.
setInterval(() => {
  const now = Date.now();
  const touched = new Set();
  for (const n of NODES.values()) {
    if (n.depletedUntil && now >= n.depletedUntil) { n.depletedUntil = 0; n.chargesLeft = n.charges; touched.add(n.area); }
  }
  for (const a of touched) broadcastNodes(a);
}, 1000);

// Fires: lit from Logs anywhere, burn 60s. Session-only world state.
const fires = new Map(); // id -> { id, area, x, y, expiresAt }
const FIRE_RANGE = 120; // must be this close to a lit fire to cook on it
const FIRE_BURN_MS = 60000;
function firesMsg(area) {
  const now = Date.now();
  return {
    type: 'fires', area,
    fires: [...fires.values()].filter((f) => f.area === area && f.expiresAt > now)
      .map((f) => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), secondsLeft: Math.max(0, Math.round((f.expiresAt - now) / 1000)) })),
  };
}
function broadcastFires(area) {
  const msg = firesMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}
// Fire sweep every 5s: drop expired fires and refresh countdowns in any
// area where a fire is burning (or just went out).
setInterval(() => {
  const now = Date.now();
  const touched = new Set();
  for (const [id, f] of fires) if (f.expiresAt <= now) { fires.delete(id); touched.add(f.area); }
  for (const f of fires.values()) touched.add(f.area);
  for (const a of touched) broadcastFires(a);
}, 5000);

// Cooking recipes: raw item -> cooked item + Cooking XP on success.
// Burn chance (%) = clamp(55 - cookingLevel * 1.2, 8, 55): 53.8% at
// level 1, falling as Cooking rises, never below 8%.
const COOKABLE = {
  raw_trout: { cooked: 'cooked_trout', xp: 70 },
  raw_shrimps: { cooked: 'cooked_shrimps', xp: 30 },
};
// Shared per-player action cooldown for gather / cook / light_fire.
// Returns true (and does NOT stamp) when the player is acting too fast.
// `ms` lets a caller use a shorter/longer gap (Stage 3 pickaxes shorten
// the Mining gap); the default is unchanged for everything else.
function actionOnCooldown(sess, ms = ACTION_COOLDOWN_MS) {
  const now = Date.now();
  if (now - (sess.lastActionAt || 0) < ms) return true;
  sess.lastActionAt = now;
  return false;
}

// ---------- Smithy (Stage 3): smelting recipes + smithing helpers ----------
// Furnace recipes: bar -> ores consumed per bar, Smithing level, XP per
// bar. Smelting gold ore yields `bars` — the existing Gold bars Exchange
// good (deliberate: there is one gold-bar item in the game, and it is
// the one the Exchange trades).
const BAR_RECIPES = {
  bronze_bar:  { ores: { copper_ore: 1, tin_ore: 1 }, level: 1, xp: 6 },
  iron_bar:    { ores: { iron_ore: 1 }, level: 15, xp: 13 },
  silver_bar:  { ores: { silver_ore: 1 }, level: 20, xp: 14 },
  steel_bar:   { ores: { iron_ore: 1, coal: 2 }, level: 30, xp: 18 },
  bars:        { ores: { gold_ore: 1 }, level: 40, xp: 23 }, // Gold bars (Exchange good)
  mithril_bar: { ores: { mithril_ore: 1, coal: 4 }, level: 55, xp: 30 },
  adamant_bar: { ores: { adamantite_ore: 1, coal: 6 }, level: 70, xp: 38 },
  rune_bar:    { ores: { runite_ore: 1, coal: 8 }, level: 85, xp: 50 },
};
function recipeText(ores) {
  return Object.entries(ores).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(' + ');
}
// The best pickaxe speed multiplier in a backpack (0 = no pickaxe).
function bestPickaxeSpeed(profile) {
  let best = 0;
  for (const s of profile.backpack) {
    const def = ITEMS[s.item];
    if (def && def.kind === 'tool' && def.speed > best) best = def.speed;
  }
  return best;
}
// Smithing heat right now: the stored heat minus 1 point per 2 seconds
// elapsed since it was last stamped (hits and reheats re-stamp it).
function smithHeatNow(sm) {
  if (!sm) return 0;
  return Math.max(0, sm.heat - Math.floor((Date.now() - sm.heatAt) / 2000));
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
  // Everyone logs into the plaza (area is session-only, never saved).
  online.set(key, { ws, profile, x: 100 + Math.random() * 500, y: 100 + Math.random() * 250, area: 'plaza', duelId: null, npcFightId: null, lastActionAt: 0, smithing: null, lastSmithHitAt: 0, lastReheatAt: 0 });
  send(ws, { type: 'welcome', profile: publicProfile(profile), players: playersSnapshot('plaza'), area: 'plaza' });
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

    // ----- Travel between areas (Stage 1) -----
    // The server just validates the destination; the client gates this
    // behind walking to the gates / its teleport menu.
    if (m.type === 'travel') {
      const to = String(m.to || '');
      if (!AREAS[to]) return send(ws, { type: 'error', message: 'Unknown destination.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You cannot travel during a duel.' });
      if (me.npcFightId) { const f = npcFights.get(me.npcFightId); if (f) finishNpcFight(f, 'travel'); }
      me.area = to;
      me.x = AREAS[to].spawn.x; me.y = AREAS[to].spawn.y;
      send(ws, { type: 'area', area: to });
      if (to === 'goblins') send(ws, npcStateMsg());
      // Stage 2: every area entry also brings its node + fire state
      // (empty lists for areas that have none).
      send(ws, nodesMsg(to));
      send(ws, firesMsg(to));
      // Stage 3: an unfinished smithing piece (session-only) is still
      // on the anvil when you come back to the mine — remind the client.
      if (to === 'mine' && me.smithing) {
        send(ws, { type: 'smith_state', item: me.smithing.item, progress: me.smithing.progress, heat: smithHeatNow(me.smithing) });
      }
      broadcastState();
      return;
    }

    // ----- NPC combat (Stage 1): attack / flee -----
    if (m.type === 'attack_npc') {
      const npc = npcs.get(String(m.id || ''));
      if (!npc) return send(ws, { type: 'error', message: 'No such creature.' });
      if (me.area !== npc.area) return send(ws, { type: 'error', message: 'That creature is not here.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are already fighting something.' });
      if (!npc.alive) return send(ws, { type: 'error', message: 'It is already dead.' });
      if (npc.fightId) return send(ws, { type: 'error', message: 'It is already fighting someone else.' });
      if (Math.hypot(me.x - npc.x, me.y - npc.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer.' });
      startNpcFight(key, npc);
      return;
    }
    if (m.type === 'flee') {
      const f = me.npcFightId ? npcFights.get(me.npcFightId) : null;
      if (!f) return send(ws, { type: 'error', message: 'You are not fighting anything.' });
      finishNpcFight(f, 'fled'); // the goblin keeps its remaining HP
      return;
    }

    // ----- Gathering (Stage 2): work a resource node / training station -----
    if (m.type === 'gather') {
      const node = NODES.get(String(m.nodeId || ''));
      if (!node) return send(ws, { type: 'error', message: 'No such spot.' });
      if (me.area !== node.area) return send(ws, { type: 'error', message: 'That spot is not here.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are fighting something.' });
      if (Math.hypot(me.x - node.x, me.y - node.y) > GATHER_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer.' });
      if (node.depletedUntil > Date.now()) return send(ws, { type: 'error', message: `${node.name} is used up — it will grow back shortly.` });
      const level = levelForXp((profile.xp && profile.xp[node.skill]) || 0);
      if (level < node.levelReq) return send(ws, { type: 'error', message: `You need ${cap(node.skill)} level ${node.levelReq} for the ${node.name} (you are level ${level}).` });
      // Pickaxe bonus (Stage 3): the best pickaxe carried speeds up
      // Mining only — a shorter action cooldown and slightly better
      // odds. Other skills keep the standard shared cooldown.
      let cooldownMs = ACTION_COOLDOWN_MS;
      let pickBonus = 0;
      if (node.skill === 'mining') {
        const speed = bestPickaxeSpeed(profile);
        if (speed > 0) { cooldownMs = ACTION_COOLDOWN_MS / speed; pickBonus = (speed - 1) * 0.1; }
      }
      if (actionOnCooldown(me, cooldownMs)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      // Success chance: 55% at the required level, +2% per level above
      // it, capped at 95% (a carried pickaxe adds up to +0.15 for
      // Mining). A failed attempt uses the action (cooldown) but no
      // node charge and grants no XP.
      const chance = Math.max(0.55, Math.min(0.95, 0.55 + 0.02 * (level - node.levelReq) + pickBonus));
      if (Math.random() > chance) return send(ws, { type: 'gather_result', nodeId: node.id, ok: false });
      if (node.chargesLeft !== Infinity) { // stations never deplete
        node.chargesLeft -= 1;
        if (node.chargesLeft <= 0) { node.chargesLeft = 0; node.depletedUntil = Date.now() + node.respawnMs; }
        broadcastNodes(node.area);
      }
      if (node.item) {
        const leftover = addStacks(profile.backpack, node.item, 1, BACKPACK_MAX_STACKS);
        if (leftover > 0) addStacks(profile.bank, node.item, leftover); // full pack: bank it, never lose a gather
      }
      addXp(key, { [node.skill]: node.xp });
      save(key);
      send(ws, { type: 'gather_result', nodeId: node.id, ok: true, item: node.item, xp: node.xp });
      return sendProfile(key);
    }

    // ----- Fires + cooking (Stage 2) -----
    if (m.type === 'light_fire') {
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (stackQty(profile.backpack, 'logs') < 1) return send(ws, { type: 'error', message: 'You need Logs to light a fire.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, 'logs', 1);
      const id = crypto.randomBytes(6).toString('hex');
      fires.set(id, { id, area: me.area, x: me.x, y: me.y, expiresAt: Date.now() + FIRE_BURN_MS });
      addXp(key, { firemaking: 40 });
      save(key);
      broadcastFires(me.area);
      send(ws, { type: 'fire_lit', id, seconds: Math.round(FIRE_BURN_MS / 1000) });
      return sendProfile(key);
    }
    if (m.type === 'cook') {
      const item = String(m.item || '');
      const recipe = COOKABLE[item];
      if (!recipe) return send(ws, { type: 'error', message: 'You can\'t cook that.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${ITEMS[item].name} in your backpack.` });
      const now = Date.now();
      const nearFire = [...fires.values()].some((f) => f.area === me.area && f.expiresAt > now && Math.hypot(me.x - f.x, me.y - f.y) <= FIRE_RANGE);
      if (!nearFire) return send(ws, { type: 'error', message: 'You need a lit fire nearby to cook on.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, item, 1);
      // Burn chance (%) = clamp(55 - cookingLevel * 1.2, 8, 55).
      const cookLevel = levelForXp((profile.xp && profile.xp.cooking) || 0);
      const burnChance = Math.max(8, Math.min(55, 55 - cookLevel * 1.2));
      const burnt = Math.random() * 100 < burnChance;
      const resultItem = burnt ? 'burnt_fish' : recipe.cooked;
      const leftover = addStacks(profile.backpack, resultItem, 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, resultItem, leftover);
      const xp = burnt ? 0 : recipe.xp;
      if (xp) addXp(key, { cooking: xp });
      save(key);
      send(ws, { type: 'cook_result', ok: !burnt, item: resultItem, xp });
      return sendProfile(key);
    }

    // ----- Smelting (Stage 3): the Emberfall furnace -----
    if (m.type === 'smelt') {
      const bar = String(m.bar || '');
      const recipe = BAR_RECIPES[bar];
      if (!recipe) return send(ws, { type: 'error', message: 'The furnace can\'t make that.' });
      if (me.area !== 'mine') return send(ws, { type: 'error', message: 'You need the furnace at the Emberfall Mine & Smithy to smelt ore.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      const level = levelForXp((profile.xp && profile.xp.smithing) || 0);
      if (level < recipe.level) return send(ws, { type: 'error', message: `You need Smithing level ${recipe.level} to smelt ${ITEMS[bar].name} (you are level ${level}).` });
      // How many bars the backpack's ore can pay for, and which ore runs out first.
      let maxQty = Infinity, limitingOre = null;
      for (const [ore, n] of Object.entries(recipe.ores)) {
        const can = Math.floor(stackQty(profile.backpack, ore) / n);
        if (can < maxQty) { maxQty = can; limitingOre = ore; }
      }
      if (maxQty < 1) return send(ws, { type: 'error', message: `Not enough ${ITEMS[limitingOre].name} — ${ITEMS[bar].name} needs ${recipeText(recipe.ores)} per bar.` });
      let qty;
      if (m.qty === 'all') qty = maxQty;
      else qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (qty > maxQty) return send(ws, { type: 'error', message: `You only have ore for ${maxQty} x ${ITEMS[bar].name} (${recipeText(recipe.ores)} per bar).` });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      for (const [ore, n] of Object.entries(recipe.ores)) removeStacks(profile.backpack, ore, n * qty);
      const leftover = addStacks(profile.backpack, bar, qty, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, bar, leftover); // full pack: bank it, never lose a smelt
      const xp = recipe.xp * qty;
      addXp(key, { smithing: xp });
      save(key);
      send(ws, { type: 'smelt_result', bar, qty, xp });
      return sendProfile(key);
    }

    // ----- Smithing (Stage 3): the Emberfall anvil, RS3 heat loop -----
    // The unfinished piece lives on the SESSION (me.smithing), never in
    // the saved profile: log out with a piece on the anvil and the bar
    // is lost. It does survive walking between areas in one session.
    if (m.type === 'smith_start') {
      const item = String(m.item || '');
      const rec = SMITH_RECIPES[item];
      if (!rec) return send(ws, { type: 'error', message: 'That is not something you can smith.' });
      if (me.area !== 'mine') return send(ws, { type: 'error', message: 'You need the anvil at the Emberfall Mine & Smithy to smith.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.smithing) return send(ws, { type: 'error', message: `Your unfinished ${ITEMS[me.smithing.item].name} is still on the anvil — finish it first. (Anvil work is session-only: log out and the piece, and its bar, are lost.)` });
      const level = levelForXp((profile.xp && profile.xp.smithing) || 0);
      if (level < rec.level) return send(ws, { type: 'error', message: `You need Smithing level ${rec.level} to smith ${ITEMS[item].name} (you are level ${level}).` });
      if (stackQty(profile.backpack, rec.bar) < 1) return send(ws, { type: 'error', message: `You need 1 x ${ITEMS[rec.bar].name} in your backpack to start a ${ITEMS[item].name}.` });
      removeStacks(profile.backpack, rec.bar, 1);
      me.smithing = { item, progress: 0, heat: 100, heatAt: Date.now() };
      save(key);
      send(ws, { type: 'smith_state', item, progress: 0, heat: 100, note: 'Work it at the anvil while it is hot — heat fades and cold metal barely moves. Unfinished work is session-only: finish before you log out or the bar is lost.' });
      return sendProfile(key);
    }
    if (m.type === 'smith_hit') {
      if (me.area !== 'mine') return send(ws, { type: 'error', message: 'You need the anvil at the Emberfall Mine & Smithy to work the metal.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      const sm = me.smithing;
      if (!sm) return send(ws, { type: 'error', message: 'Nothing on the anvil — start a piece first (smith_start).' });
      // Hammer hits are fast-tappable: a 300ms floor, not the 1.4s
      // shared action cooldown.
      const now = Date.now();
      if (now - (me.lastSmithHitAt || 0) < 300) return send(ws, { type: 'error', message: 'Too fast — one swing at a time.' });
      me.lastSmithHitAt = now;
      const heat = smithHeatNow(sm);
      // Hot metal moves: +12..18 at heat 66+, +7..11 at 33+, +3..6 cold.
      const gain = heat >= 66 ? 12 + Math.floor(Math.random() * 7)
        : heat >= 33 ? 7 + Math.floor(Math.random() * 5)
        : 3 + Math.floor(Math.random() * 4);
      sm.progress = Math.min(100, sm.progress + gain);
      sm.heat = Math.max(0, heat - (6 + Math.floor(Math.random() * 5))); // each hit also cools it 6..10
      sm.heatAt = now;
      if (sm.progress >= 100) {
        const rec = SMITH_RECIPES[sm.item];
        const doneItem = sm.item;
        me.smithing = null;
        const leftover = addStacks(profile.backpack, doneItem, 1, BACKPACK_MAX_STACKS);
        if (leftover > 0) addStacks(profile.bank, doneItem, leftover);
        addXp(key, { smithing: rec.xp });
        save(key);
        send(ws, { type: 'smith_state', done: true, item: doneItem, xp: rec.xp });
        return sendProfile(key);
      }
      return send(ws, { type: 'smith_state', item: sm.item, progress: sm.progress, heat: sm.heat });
    }
    if (m.type === 'smith_reheat') {
      if (me.area !== 'mine') return send(ws, { type: 'error', message: 'You need the furnace at the Emberfall Mine & Smithy to reheat the metal.' });
      const sm = me.smithing;
      if (!sm) return send(ws, { type: 'error', message: 'Nothing on the anvil to reheat.' });
      const now = Date.now();
      if (now - (me.lastReheatAt || 0) < 1000) return send(ws, { type: 'error', message: 'Too fast — the metal is still heating.' });
      me.lastReheatAt = now;
      sm.heat = 100;
      sm.heatAt = now;
      return send(ws, { type: 'smith_state', item: sm.item, progress: sm.progress, heat: 100 });
    }
    if (m.type === 'smith_upgrade') {
      const item = String(m.item || '');
      const def = ITEMS[item];
      if (!def || !def.smithMetal) return send(ws, { type: 'error', message: 'That is not a smithed item.' });
      if (me.area !== 'mine') return send(ws, { type: 'error', message: 'You need the anvil at the Emberfall Mine & Smithy to upgrade gear.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      const u = def.smithUpgrade || 0;
      if (u >= 4) return send(ws, { type: 'error', message: `${def.name} is already +4 — fully upgraded.` });
      const md = SMITH_METALS[def.smithMetal];
      const level = levelForXp((profile.xp && profile.xp.smithing) || 0);
      if (level < md.level) return send(ws, { type: 'error', message: `You need Smithing level ${md.level} to work ${cap(def.smithMetal)} (you are level ${level}).` });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${def.name} in your backpack.` });
      if (stackQty(profile.backpack, md.bar) < 1) return send(ws, { type: 'error', message: `Upgrading needs 1 x ${ITEMS[md.bar].name} in your backpack.` });
      removeStacks(profile.backpack, md.bar, 1); // the bar is spent either way
      // Success odds fall per step: +1 always lands, then 85 / 70 / 55%.
      const chance = [1, 0.85, 0.7, 0.55][u];
      const ok = Math.random() < chance;
      let resultItem = item;
      let xp = 0;
      if (ok) {
        resultItem = `${def.smithBase}_u${u + 1}`;
        removeStacks(profile.backpack, item, 1);
        const leftover = addStacks(profile.backpack, resultItem, 1, BACKPACK_MAX_STACKS);
        if (leftover > 0) addStacks(profile.bank, resultItem, leftover);
        xp = 15 * (u + 1);
        addXp(key, { smithing: xp });
      }
      save(key);
      send(ws, { type: 'upgrade_result', ok, item: resultItem, xp });
      return sendProfile(key);
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
      // Shops buy anything with a sell price: their own stock at 60%
      // back, and Stage 2 gathered resources at their fixed sellOnly.
      if (!sellPrice(item)) return send(ws, { type: 'error', message: 'The shops don\'t buy that — try the Gold Exchange.' });
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
      // Healing matters mid-fight; refuse (without consuming) outside one.
      const duel = me.duelId ? duels.get(me.duelId) : null;
      if (!duel) {
        // NPC fight (Stage 1): food / restore potions heal that pool too.
        const nf = me.npcFightId ? npcFights.get(me.npcFightId) : null;
        if (!nf) return send(ws, { type: 'error', message: 'Healing only works during a duel.' });
        if (nf.hpYou >= nf.maxHpYou) return send(ws, { type: 'error', message: 'Already at full health.' });
        removeStacks(profile.backpack, item, 1);
        nf.hpYou = Math.min(nf.maxHpYou, nf.hpYou + def.heal);
        save(key);
        const npcNow = npcs.get(nf.npcId);
        send(ws, {
          type: 'npc_fight', phase: 'tick', npcId: nf.npcId,
          hpYou: nf.hpYou, maxHpYou: nf.maxHpYou,
          hpNpc: npcNow ? Math.max(0, npcNow.hp) : 0, maxHpNpc: npcNow ? npcNow.maxHp : 0,
          youHit: 0, npcHit: 0, youSpecial: false, energyYou: profile.specialEnergy,
          note: `${profile.username} used ${def.name} (+${def.heal} HP)`,
        });
        return sendProfile(key);
      }
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
      const nf = !duel && me.npcFightId ? npcFights.get(me.npcFightId) : null;
      if (!duel && !nf) return send(ws, { type: 'error', message: 'You are not in a duel.' });
      if (profile.specialEnergy < SPECIAL_COST) return send(ws, { type: 'error', message: `Dragon Slash needs ${SPECIAL_COST} special energy (you have ${Math.floor(profile.specialEnergy)}).` });
      if (duel) {
        if (duel.specialQueued[key]) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        duel.specialQueued[key] = true;
      } else {
        if (nf.specialQueued) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        nf.specialQueued = true;
      }
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
      if (me.npcFightId || target.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
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
      if (me.npcFightId || fromP.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
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
    if (me && me.npcFightId) {
      const f = npcFights.get(me.npcFightId);
      if (f) finishNpcFight(f, 'disconnect'); // goblin keeps its HP and is free again
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
