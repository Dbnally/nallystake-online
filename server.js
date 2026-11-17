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
//
// Stage 4 (catch-up) adds: the Fight Caves (north gate) — Derek's exact
// 63-wave OSRS table, instanced per player: Tz-Kih prayer drains, Tz-Kek
// splitting on death, Tok-Xil ranged, Yt-MejKot self-heals, Ket-Zek
// magic, and TzTok-Jad (702) with telegraphed prayer-switch attacks and
// exactly 4 Yt-HurKot healers at half health. Protect prayers FULLY
// block matching attack types (the Stage 1 NPC rule). Records save per
// player (best wave / attempts / kills / completions / best time);
// clearing wave 63 pays 500g and a Fire cape. Dying costs nothing —
// you wake in the plaza (the house rule).
//
// Stage 5 (catch-up) adds: the worn expansion (10 slots — the Fire
// cape is wearable in the new cape slot), the Barrows (six brothers,
// crypt fights, one randomised tunnel crypt per run, a puzzle door and
// the reward chest; kills are SAVED on the profile and kept until the
// round is finished), four duel arenas (duels move both fighters into
// a random arena and back to the plaza afterwards), drop piles
// (backpack items dropped as per-area ground piles anyone can pick
// up), and the Muse-game style boosts (Accurate extra hits,
// Aggressive power hits, Defensive / Controlled defender blocks —
// replaced by the Stage 10 RuneScape-style rebalance, see STYLES).
//
// Stage 6 adds: Tree Guardians — an {type:'awaken_tree'} request turns
// the nearest living tree (Gathering Cave / Fishing Cove) into a
// session-only NPC ally: the tree node is consumed (60s regrow), and
// the guardian follows its owner between areas, swings at the owner's
// target every 2nd tick in the three NPC engines (goblins, Barrows,
// Fight Caves — never in PvP duels, and it waits outside the arena
// while its owner duels), and sometimes takes a hit meant for its
// owner. Nothing about guardians is saved: logging out removes yours.
//
// Stage 7A (server only) adds: roles & permissions (the account
// 'nally' is the permanent owner; stored roles are player / mod /
// admin), admin role/style management, the NC and Certificate token
// items (never bought, sold or exchanged), mod certification
// (+1 NC, admin/owner only), mod-run official fights (a certified
// mod — or an admin/owner — spends 1 NC to run a zero-stake duel
// whose winner earns a Certificate), the certificate exchange
// (a Certificate trades to an online admin for 250g), and admin
// item spawning. The client for these arrives in a follow-up stage.
//
// Stage 7B (server only) adds: the rest of Derek's tap-player menu —
// Talk (private whispers), Examine (a read-only look at another
// online player: role, area, levels, record, worn gear — never gold
// or backpack), Invite (session-only parties, social only, no
// gameplay effects) and Trade (two-sided, server-validated, atomic:
// offers can be changed freely until BOTH sides confirm, any change
// un-confirms both, and the swap re-validates against current
// holdings at confirm time so nothing can be pulled mid-trade).
// Challenge and Follow from that menu need no server work here.
//
// Stage 7D (server only) adds: admin/owner-only world editing — a
// custom item editor (an admin clones a base weapon/armour, sets its
// name, icon and stat bonuses, and the result is a NEW item with its
// own permanent item number; every copy in the world shares the one
// definition, so editing it re-tunes all copies at once), reference
// lists (item # / npc # / object # for everything the server really
// defines), and placeable decorative objects (tree / rock / flowers /
// stage light / chest) that persist in the world. Storage follows the
// store's per-user shape: custom definitions live on their CREATOR's
// profile (profile.customItems) and placed objects on their PLACER's
// profile (profile.placedObjects); at boot both are aggregated into
// runtime registries (see buildStage7DRegistry), and every item-id
// lookup that can meet a player-held id goes through itemDef() so
// custom items survive login, banking, trading, staking, dropping
// and equipping exactly like base items. Custom items are never
// shop-sellable and never on the Gold Exchange.
//
// Stage 8 (server only) adds: melee adjacency — Derek's rule that
// you have to walk NEXT to something to hit it with a melee swing.
// In every fight engine, a melee attacker beyond MELEE_REACH (42
// units) does not swing that tick: the tick is a CLOSING tick (hit
// fields null, `closing: true`, and a `moveTo` point for the local
// player to walk to). Server-owned melee monsters (goblins, Fight
// Caves melee monsters) step APPROACH_STEP toward the player each
// tick until they are in reach; Barrows brothers stay at their
// anchor (Karil/Ahrim keep hitting at range — only melee swings are
// gated); duels start toe-to-toe and the closing rule governs the
// rest of the fight. Jad is unchanged. Stage 8 also extends the
// Stage 7D custom item editor: an admin can set a `color` tint
// (#rrggbb) and drawn `art` (a capped PNG data URL) on a custom
// item; both ride on the def, the catalog and the reference lists.
//
// Stage 10 (server only) is the combat-style rebalance Derek asked
// for: fighting ticks now resolve like a RuneScape match — an OSRS
// attack roll vs defence roll (see hitChance) puts two identical
// fighters at about a 50/50 hit chance, and each combat style is a
// single small effect (Accurate +3 Attack, Aggressive +3 Strength,
// Defensive 20% block, Controlled +1/+1 with a 7% block), only one
// active at a time. The Stage 5 proc boosts are removed. Stage 10
// also adds two client-support pieces: inv_swap (drag-to-reorder
// backpack stacks) and saved character appearance (profile.appearance
// — sanitised by cleanAppearance, settable at register and via
// set_appearance, and carried in state snapshots + public profiles
// so every client can render each knight's look).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const TICK_MS = 600;
// Stage 13: the world doubled. Every area's playable space is now
// 0..WORLD_W x 0..WORLD_H server units (was 0..800 x 0..450); every
// world position (spawns, nodes, mounds, gates' destinations, ...)
// sits at its x2 spot so the layout spreads out proportionally,
// while gameplay distances (MELEE_REACH, NPC_RANGE, ranges) and
// object sizes are unchanged — the world grew around them.
const WORLD_W = 1600;
const WORLD_H = 900;
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
// Stage 4: the Fight Caves reward. kind 'trophy': never sold by shops,
// and sellOnly 0 means sellPrice() returns 0, so the shops refuse to buy
// it. Stage 5: it is wearable in the new cape slot and carries small
// bonuses (+0.02 accuracy, +1 max hit, applied in rollHit like a
// weapon's) — a trophy that is also genuinely useful.
ITEMS.fire_cape = { name: 'Fire cape', kind: 'trophy', slot: 'cape', accBonus: 0.02, maxBonus: 1, sellOnly: 0 };
// Stage 5: Barrows weapons — the reward chest's rare roll. Loot-only
// (no `buy`, no shop); shops buy them back at the 800g sellOnly floor.
for (const [id, name, accBonus, maxBonus] of [
  ['dharoks_greataxe', "Dharok's greataxe", 0.10, 9],
  ['guthans_warspear', "Guthan's warspear", 0.09, 8],
  ['torags_hammers', "Torag's hammers", 0.09, 8],
  ['veracs_flail', "Verac's flail", 0.10, 8],
  ['ahrims_staff', "Ahrim's staff", 0.11, 7],
  ['karils_crossbow', "Karil's crossbow", 0.11, 7],
]) {
  ITEMS[id] = { name, kind: 'weapon', slot: 'weapon', sellOnly: 800, accBonus, maxBonus };
}
// Stage 7A: NC and Certificate tokens. kind 'token': stackable like
// any other backpack stack, but NEVER buyable in a shop, NEVER
// sellable to a shop and NEVER on the Gold Exchange — sellOnly 0
// (mirroring fire_cape) makes sellPrice() return 0, and the shop /
// exchange handlers additionally guard on kind 'token' with the
// error 'That can't be sold.'. NC is spent by certified mods (and
// admins/owners) to run official fights; a Certificate is what an
// official-fight winner earns, exchangeable to an admin for 250g.
ITEMS.nc = { name: 'NC', icon: '🪙', kind: 'token', sellOnly: 0 };
ITEMS.certificate = { name: 'Certificate', icon: '📜', kind: 'token', sellOnly: 0 };
// Stage 9: the Note. kind 'note': like the tokens it is never buyable
// and never sellable (sellOnly 0; sellPrice() and the shop / Exchange
// handlers refuse it with "That can't be sold."). Unlike the tokens it
// is also PERSONAL — a player SIGNS one from a Certificate
// ({type:'sign_note'}; the signed text lives on profile.notes, one
// entry per held note item, FIFO) and hands it to an admin
// ({type:'give_note'}) as a request, so the drop / trade / duel-stake
// paths all refuse it with NOTE_PERSONAL_MSG.
ITEMS.note = { name: 'Note', icon: '📝', kind: 'note', sellOnly: 0 };
// The ONE refusal every path that would move a note off its owner
// (drop, trade offer, duel item stakes) answers with.
const NOTE_PERSONAL_MSG = "A note is personal — it can't be dropped, traded, or staked.";

// ---------- Stage 7D: custom items + placed objects (registries) ----------
// Base items are numbered 1..BASE_ITEM_COUNT in ITEMS definition
// order; that count is the floor for custom item numbers.
const BASE_ITEM_COUNT = Object.keys(ITEMS).length;
// Runtime registry of admin-created item definitions, aggregated at
// boot from every profile's customItems (see buildStage7DRegistry).
// The Map values are the SAME objects stored on the creators'
// profiles, so an edit mutates the saved definition in place — the
// caller still has to save the creator's profile (customOwner).
const customItems = new Map(); // customId -> def
const customOwner = new Map(); // customId -> creator's db key
let customSeq = BASE_ITEM_COUNT; // last custom item number handed out (seeded at boot)
let objectSeq = 0; // last placed-object sequence handed out (seeded at boot)
// Placed decorative objects, aggregated at boot from every profile's
// placedObjects. Runtime entries carry two extra fields the saved
// shape does not: `by` (placer's username, for display) and
// `ownerKey` (whose profile holds it, so removal can save it).
const placedObjectsAll = []; // { id, area, kind, x, y, by, ownerKey }
// The ONE lookup for "what is this item id": a custom definition if
// the id is registered, else the base catalog. Every code path that
// can meet a player-held id (backpack / bank / worn / stakes /
// offers) must go through here — a raw ITEMS[id] would make custom
// items invisible, unsellable-by-accident or silently deleted.
function itemDef(id) {
  if (!id) return null;
  const c = customItems.get(id);
  if (c) return c;
  return ITEMS[id] || null;
}
// Icons an admin may give a custom item.
const CUSTOM_ICONS = ['🗡️', '⚔️', '🔪', '🏹', '🪄', '🛡️', '⛑️', '🦺', '👑', '💎', '🔥', '⭐'];
// Placeable decorative prop kinds (Stage 7D feature 3).
const PROP_DEFS = [
  { kind: 'tree', label: 'Tree', icon: '🌳' },
  { kind: 'rock', label: 'Rock', icon: '🪨' },
  { kind: 'flowers', label: 'Flowers', icon: '🌸' },
  { kind: 'light', label: 'Stage light', icon: '💡' },
  { kind: 'chest', label: 'Chest', icon: '🧰' },
];
const PROP_KINDS = PROP_DEFS.map((p) => p.kind);
// The catalog-shaped view of a custom def (same fields catalogList
// emits for base items, plus the Stage 7D identity fields).
function customCatalogEntry(def) {
  return {
    id: def.id, name: def.name, kind: def.kind, slot: def.slot || null, shop: null, buy: 0, sell: 0,
    heal: 0, prayerRestore: 0,
    accBonus: def.accBonus || 0, maxBonus: def.maxBonus || 0, reduction: def.reduction || 0,
    speed: 0, icon: def.icon || null,
    custom: true, num: def.num, base: def.base, by: def.by,
    color: def.color || null, art: def.art || null, // Stage 8: admin tint + drawn art
  };
}
// Stage 8: custom item color + drawn art. A color is only ever a
// #rrggbb tint (stored lowercased); any other value sent for the
// color field means "no tint" (null) — it never rejects. Art is a
// PNG data URL the admin drew in the editor, capped at 32768 chars
// total; a present-but-invalid art value rejects the whole
// create/edit (see the handlers). Both helpers follow the same
// presence rule: a field the message does not carry keeps the
// existing value; art sent as '' (or null) clears the drawing.
const CUSTOM_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CUSTOM_ART_PREFIX = 'data:image/png;base64,';
const CUSTOM_ART_MAX = 32768;
function customColorFrom(m, existing) {
  if (!Object.prototype.hasOwnProperty.call(m, 'color')) return existing;
  return typeof m.color === 'string' && CUSTOM_COLOR_RE.test(m.color) ? m.color.toLowerCase() : null;
}
// Returns { ok: true, value } or { ok: false } (present but invalid).
function customArtFrom(m, existing) {
  if (!Object.prototype.hasOwnProperty.call(m, 'art')) return { ok: true, value: existing };
  if (m.art === '' || m.art === null) return { ok: true, value: null };
  if (typeof m.art === 'string' && m.art.startsWith(CUSTOM_ART_PREFIX) && m.art.length <= CUSTOM_ART_MAX) return { ok: true, value: m.art };
  return { ok: false };
}
// Boot aggregation (called from store.init, BEFORE the server starts
// listening): pull every user's saved custom items and placed
// objects into the runtime registries and seed the id/number
// counters from the maxima already in use, so numbers are never
// reused across restarts.
function buildStage7DRegistry() {
  customItems.clear();
  customOwner.clear();
  placedObjectsAll.length = 0;
  let maxNum = BASE_ITEM_COUNT;
  let maxObj = 0;
  for (const [k, u] of Object.entries(db.users)) {
    if (!u || !u.profile) continue;
    const p = u.profile;
    if (p.customItems && typeof p.customItems === 'object') {
      for (const [id, def] of Object.entries(p.customItems)) {
        if (!def || typeof def !== 'object') continue;
        customItems.set(id, def);
        customOwner.set(id, k);
        if (typeof def.num === 'number' && def.num > maxNum) maxNum = def.num;
      }
    }
    if (Array.isArray(p.placedObjects)) {
      for (const o of p.placedObjects) {
        if (!o || typeof o.id !== 'string') continue;
        placedObjectsAll.push({ id: o.id, area: o.area, kind: o.kind, x: o.x, y: o.y, by: p.username, ownerKey: k });
        const n = parseInt(o.id.slice(4), 10); // 'obj_<n>'
        if (Number.isFinite(n) && n > maxObj) maxObj = n;
      }
    }
  }
  customSeq = maxNum;
  objectSeq = maxObj;
}

const SHOPS = ['Potion', 'Weapon', 'Armour', 'Food & Supplies', 'Pickaxe Pete'];
const exchangePrices = {};
for (const g of GOODS) exchangePrices[g.id] = g.base;

function sellPrice(itemId) {
  const def = itemDef(itemId);
  if (!def) return 0;
  if (def.kind === 'token' || def.kind === 'note') return 0; // Stage 7A/9: tokens and notes are never sellable
  if (def.custom) return 0; // Stage 7D: custom items are never sellable
  if (def.buy) return Math.max(1, Math.floor(def.buy * SHOP_SELLBACK));
  if (def.sellOnly) return def.sellOnly; // Stage 2 resources: fixed buy-back
  return 0;
}
function catalogList() {
  // Buyable stock plus sell-only resources (buy: 0, shop: null — the
  // client filters buy lists by shop name, so resources never show as
  // buyable, but sell mode and name lookups can see them).
  const list = Object.entries(ITEMS).filter(([, d]) => d.buy || d.sellOnly).map(([id, d]) => ({
    id, name: d.name, kind: d.kind, slot: d.slot || null, shop: d.shop || null, buy: d.buy || 0, sell: sellPrice(id),
    heal: d.heal || 0, prayerRestore: d.prayerRestore || 0,
    accBonus: d.accBonus || 0, maxBonus: d.maxBonus || 0, reduction: d.reduction || 0,
    speed: d.speed || 0, // Stage 3: pickaxe speed multiplier (0 for non-tools)
    icon: d.icon || null, // Stage 7A: token icons (null for older items)
  }));
  // Stage 7D: custom items ride along after the base catalog,
  // regardless of the buy/sellOnly filter above (they have neither).
  for (const def of [...customItems.values()].sort((a, b) => (a.num || 0) - (b.num || 0))) list.push(customCatalogEntry(def));
  return list;
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
// Stage 5 worn expansion: 10 slots. Only the cape slot has dedicated
// content so far (the Fire cape); amulet / hands / feet / ring start
// empty and simply work with the generic equip/unequip handlers.
const WORN_SLOTS = ['weapon', 'shield', 'head', 'body', 'legs', 'cape', 'amulet', 'hands', 'feet', 'ring'];
function emptyWorn() {
  const w = {};
  for (const s of WORN_SLOTS) w[s] = null;
  return w;
}
// Stage 10: character appearance, saved on the profile. Indexes into
// client-side palettes: hair 0=blonde, 1=brown, 2=black; beard
// 0=clean, 1=short, 2=full; skin 0=pale, 1=tan, 2=dark; torso / arms /
// legs / feet are colour-palette indexes 0..5. `chosen` records that
// the player actually picked a look (at register or via
// set_appearance) rather than wearing the default.
function defaultAppearance() {
  return { gender: 'male', hair: 1, beard: 0, skin: 1, torso: 0, arms: 0, legs: 0, feet: 0, chosen: false };
}
// Sanitise an appearance: start from the default, layer the base
// (prev — itself sanitised field by field), then layer the supplied
// object (a) on top. Every field independently falls back to the
// layer below when its supplied value is invalid; valid numbers are
// rounded and clamped into their palette range. Stray keys never
// leak through — the result always has exactly the nine fields.
function cleanAppearance(a, prev) {
  const clean = defaultAppearance();
  const apply = (src) => {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return;
    if (src.gender === 'male' || src.gender === 'female') clean.gender = src.gender;
    clean.hair = clampAppearanceInt(src.hair, 0, 2, clean.hair);
    clean.beard = clampAppearanceInt(src.beard, 0, 2, clean.beard);
    clean.skin = clampAppearanceInt(src.skin, 0, 2, clean.skin);
    clean.torso = clampAppearanceInt(src.torso, 0, 5, clean.torso);
    clean.arms = clampAppearanceInt(src.arms, 0, 5, clean.arms);
    clean.legs = clampAppearanceInt(src.legs, 0, 5, clean.legs);
    clean.feet = clampAppearanceInt(src.feet, 0, 5, clean.feet);
    if (typeof src.chosen === 'boolean') clean.chosen = src.chosen;
  };
  apply(prev);
  apply(a);
  return clean;
}
function clampAppearanceInt(v, lo, hi, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function newProfile(username) {
  return {
    username, gold: START_GOLD, rating: 1000, wins: 0, losses: 0,
    style: 'accurate', createdAt: new Date().toISOString(),
    appearance: defaultAppearance(), // Stage 10 — see cleanAppearance
    backpack: [], // [{item, qty}] stacks, max BACKPACK_MAX_STACKS distinct
    worn: emptyWorn(),
    bank: [], // [{item, qty}] stacks — items only, gold stays a number
    prayerPoints: PRAYER_MAX, prayerMax: PRAYER_MAX, activePrayer: null,
    specialEnergy: 0,
    xp: defaultXp(), // Stage 1 skills — see SKILLS / XP_TABLE above
    fc: { bestWave: 0, attempts: 0, kills: 0, completions: 0, bestTimeMs: 0 }, // Stage 4 Fight Caves records
    // Stage 5 Barrows run state: brothers killed this round, which
    // crypt is the tunnel entrance (null until a run starts), and a
    // looted flag (the round resets the moment the chest is looted,
    // so this is never persisted as true — it completes the shape).
    barrows: { kills: [], tunnel: null, looted: false },
    // Stage 7A roles: stored role ('player' | 'mod' | 'admin') plus
    // the mod certification flag. The 'owner' role is never stored —
    // it is computed from the username (see effectiveRole).
    role: 'player', certified: false,
    // Stage 7D: item definitions this player created as an admin
    // ({ customId: def }) and decorative objects this player placed
    // ([{ id, area, kind, x, y }]). The store only persists per-user
    // records, so world-shared data rides on its owner's profile and
    // is aggregated into runtime registries at boot.
    customItems: {}, placedObjects: [],
    // Stage 13: world-layout version of this profile's stored
    // coordinates (only placedObjects carry any). New profiles are
    // born at the current version; older ones are scaled once by
    // the ensureV2 migration below.
    worldV: 2,
    // Stage 9: the texts of the signed Notes this player currently
    // HOLDS, oldest first ([{ text, from, at }] — from is the signer).
    // One entry per held 'note' item, FIFO-matched: signing creates
    // item + entry together, giving a note away removes both, and a
    // declined note returns both.
    notes: [],
  };
}
// Migration: Phase 1 accounts gain the v2 fields with defaults. Existing
// gold / rating / record / style are never touched.
function ensureV2(p) {
  let changed = false;
  if (!Array.isArray(p.backpack)) { p.backpack = []; changed = true; }
  if (!p.worn || typeof p.worn !== 'object') { p.worn = emptyWorn(); changed = true; }
  for (const slot of WORN_SLOTS) if (!(slot in p.worn)) { p.worn[slot] = null; changed = true; }
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
  // Stage 4 migration: Fight Caves records. Existing values are never
  // reset — only a missing record or field gains the zero defaults.
  if (!p.fc || typeof p.fc !== 'object') { p.fc = { bestWave: 0, attempts: 0, kills: 0, completions: 0, bestTimeMs: 0 }; changed = true; }
  else {
    for (const f of ['bestWave', 'attempts', 'kills', 'completions', 'bestTimeMs']) {
      if (typeof p.fc[f] !== 'number' || p.fc[f] < 0) { p.fc[f] = 0; changed = true; }
    }
  }
  // Stage 5 migration: Barrows run state. Kills already recorded are
  // NEVER reset (leaving mid-run keeps them until the round ends) —
  // only a missing/corrupt record gains defaults, and the kills list
  // is cleaned down to known brother ids, deduped.
  if (!p.barrows || typeof p.barrows !== 'object') { p.barrows = { kills: [], tunnel: null, looted: false }; changed = true; }
  else {
    if (!Array.isArray(p.barrows.kills)) { p.barrows.kills = []; changed = true; }
    else {
      const clean = [...new Set(p.barrows.kills.filter((k) => BARROWS_BROTHERS[k]))];
      if (clean.length !== p.barrows.kills.length) { p.barrows.kills = clean; changed = true; }
    }
    if (p.barrows.tunnel !== null && !BARROWS_BROTHERS[p.barrows.tunnel]) { p.barrows.tunnel = null; changed = true; }
    if (typeof p.barrows.looted !== 'boolean') { p.barrows.looted = false; changed = true; }
  }
  // Stage 7A migration: role + certified. An unknown/corrupt stored
  // role falls back to 'player'; certification is a plain boolean.
  if (p.role !== 'player' && p.role !== 'mod' && p.role !== 'admin') { p.role = 'player'; changed = true; }
  if (typeof p.certified !== 'boolean') { p.certified = false; changed = true; }
  // Stage 7D migration: custom item definitions + placed objects.
  // Definitions are server-created and trusted as stored — only the
  // container shapes are enforced here, and placed objects are
  // cleaned down to well-formed entries with known prop kinds. The
  // stacks in backpack / bank / worn are deliberately NOT filtered
  // against the item table anywhere in this migration: a custom id
  // is a real item as long as its def is in the boot registry.
  if (!p.customItems || typeof p.customItems !== 'object' || Array.isArray(p.customItems)) { p.customItems = {}; changed = true; }
  if (!Array.isArray(p.placedObjects)) { p.placedObjects = []; changed = true; }
  else {
    const clean = p.placedObjects.filter((o) => o && typeof o.id === 'string' && typeof o.area === 'string'
      && PROP_KINDS.includes(o.kind) && Number.isFinite(+o.x) && Number.isFinite(+o.y));
    if (clean.length !== p.placedObjects.length) { p.placedObjects = clean; changed = true; }
  }
  // Stage 13 migration: the world doubled (800x450 -> 1600x900).
  // placedObjects are the only coordinates a profile stores, so
  // they scale x2 exactly once, flagged by worldV. This runs on
  // load (the boot sweep calls ensureV2 for every profile BEFORE
  // buildStage7DRegistry aggregates placedObjects, and the boot
  // sweep saves when ensureV2 reports a change), so the runtime
  // registry only ever sees migrated coordinates.
  if (typeof p.worldV !== 'number' || !Number.isFinite(p.worldV)) { p.worldV = 1; changed = true; }
  if (p.worldV < 2) {
    for (const o of p.placedObjects) { o.x = Math.round((+o.x || 0) * 2); o.y = Math.round((+o.y || 0) * 2); }
    p.worldV = 2; changed = true;
  }
  // Stage 9 migration: unread note texts. Only the container shape is
  // enforced (entries are server-created): malformed entries drop.
  if (!Array.isArray(p.notes)) { p.notes = []; changed = true; }
  else {
    const clean = p.notes.filter((n) => n && typeof n.text === 'string' && typeof n.from === 'string' && Number.isFinite(+n.at));
    if (clean.length !== p.notes.length) { p.notes = clean; changed = true; }
  }
  // Stage 10 migration: character appearance. A missing one is
  // backfilled with the default; a present one is sanitised in
  // place (merged over the default — a set look is never wiped).
  if (!p.appearance || typeof p.appearance !== 'object' || Array.isArray(p.appearance)) { p.appearance = defaultAppearance(); changed = true; }
  else {
    const clean = cleanAppearance(p.appearance, null);
    if (JSON.stringify(clean) !== JSON.stringify(p.appearance)) { p.appearance = clean; changed = true; }
  }
  return changed;
}
// Stage 7A: the EFFECTIVE role of a session ({profile}), a profile,
// a db record ({profile}) or a username/key string. The account
// 'nally' (any casing) is permanently the owner — its stored role is
// ignored. Everyone else's effective role is their stored role.
function effectiveRole(sessOrProfile) {
  if (!sessOrProfile) return 'player';
  let prof = null;
  if (typeof sessOrProfile === 'string') {
    const u = db.users[sessOrProfile.toLowerCase()];
    prof = u ? u.profile : { username: sessOrProfile };
  } else if (sessOrProfile.profile) prof = sessOrProfile.profile;
  else prof = sessOrProfile;
  if (!prof) return 'player';
  if (String(prof.username || '').toLowerCase() === 'nally') return 'owner';
  if (prof.role === 'admin') return 'admin';
  if (prof.role === 'mod') return 'mod';
  return 'player';
}
function isAdminOrOwner(sessOrProfile) {
  const r = effectiveRole(sessOrProfile);
  return r === 'admin' || r === 'owner';
}
// Normalise a client-supplied username to its db key (usernames are
// stored trimmed; keys are the lowercased name).
function userKeyFor(username) {
  return String(username || '').trim().toLowerCase();
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
    // Stage 4 Fight Caves records (best wave reached, attempts, total
    // kills across all runs, completions, best full-clear time).
    fc: { ...p.fc },
    // Stage 5 Barrows run state (kills this round + tunnel crypt).
    barrows: { kills: [...p.barrows.kills], tunnel: p.barrows.tunnel, looted: p.barrows.looted },
    // Stage 7A: effective role (owner computed) + certification flag.
    role: effectiveRole(p), certified: !!p.certified,
    // Stage 10: character appearance (sanitised on the way in; the
    // spread keeps clients from mutating the stored object).
    appearance: { ...p.appearance },
  };
}
function leaderboardProfile(p) {
  ensureV2(p);
  return { username: p.username, gold: p.gold, rating: p.rating, wins: p.wins, losses: p.losses, style: p.style, role: effectiveRole(p) };
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
    if (!itemDef(item) || qty < 1) continue; // Stage 7D: custom ids are valid stakes too
    merged.set(item, (merged.get(item) || 0) + qty);
  }
  return [...merged.entries()].map(([item, qty]) => ({ item, qty }));
}
function hasItems(profile, items) {
  return items.every((s) => stackQty(profile.backpack, s.item) >= s.qty);
}
// Stage 7A helper (the codebase's overflow-to-bank pattern, factored):
// add qty of an item to a profile's backpack; whatever does not fit
// overflows into the bank so a grant is never lost. Works for online
// and offline profiles alike — the caller saves and, if the target is
// online, pushes a fresh profile with sendProfile().
function addItemToProfile(profile, item, qty) {
  ensureV2(profile);
  const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
  if (leftover > 0) addStacks(profile.bank, item, leftover);
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
    const { username, password, appearance } = await readBody(req);
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_ ]{3,16}$/.test(name)) return json(res, 400, { error: 'Name: 3-16 letters/numbers.' });
    if (String(password || '').length < 6) return json(res, 400, { error: 'Password: 6+ characters.' });
    const key = name.toLowerCase();
    if (db.users[key]) return json(res, 409, { error: 'That name is taken.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const profile = newProfile(name);
    // Stage 10: an optional appearance picked on the register screen
    // is sanitised and stored as chosen; anything unusable simply
    // leaves the default look (chosen stays false).
    if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
      profile.appearance = { ...cleanAppearance(appearance, null), chosen: true };
    }
    db.users[key] = { salt, passHash: hashPass(password, salt), profile };
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
// Stage 7A pending flows (session-only, like challenges):
const fightOffers = new Map(); // id -> { id, runnerKey, aKey, bKey, accepted: Map/key->bool, expires, timer }
const certRequests = new Map(); // requesterKey -> { requesterKey, handled }
// Stage 9: signed-note requests. A player signs a Note from a
// Certificate (sign_note), then GIVES it to an admin (give_note); the
// pending request lives here (session-only, like certRequests) until
// that admin decides (note_reply). The wording of a signed note lives
// in ONE place — noteRequestText.
const noteRequests = new Map(); // id -> { id, fromKey, fromName, text, toKey, at }
let noteSeq = 0;
function noteRequestText(playerName) { return playerName + "'s request: exchange 1 certificate for 250g.\nSigned: " + playerName; }
// Returns a pending signed note to its signer (decline, or the admin
// holding it left): the item (overflow to bank) and its text entry go
// back onto the signer's saved profile, and the signer is told if
// they are online.
function returnSignedNote(req, chatLine) {
  const signerUser = db.users[req.fromKey];
  if (!signerUser) return;
  const signerProfile = signerUser.profile;
  ensureV2(signerProfile);
  signerProfile.notes.push({ text: req.text, from: req.fromName, at: req.at });
  addItemToProfile(signerProfile, 'note', 1);
  save(req.fromKey);
  const signerSess = online.get(req.fromKey);
  if (signerSess) {
    sendProfile(req.fromKey);
    if (chatLine) send(signerSess.ws, { type: 'chat', from: 'Game', text: chatLine });
  }
}
// Stage 7B social/trade state (session-only, never saved to profiles):
const parties = new Map(); // partyId -> Set of player keys
const partyOf = new Map(); // player key -> partyId
const partyInvites = new Map(); // inviterKey -> { inviterKey, targetKey, expires, timer }
const tradeRequests = new Map(); // tradeId -> { id, fromKey, toKey, expires, timer }
const trades = new Map(); // tradeId -> { id, aKey, bKey, offers, confirmed, expires, timer }

// ---------- Stage 7C: challenge '!' markers ----------
// Derek's design: the CHALLENGER wears the '!', not the target. When a
// challenge goes out, everyone hears who is challenging whom (clients
// filter by area and badge the challenger); when it resolves — accept,
// decline, expiry, or either side leaving — the marker clears.
// Clients also auto-expire the marker after 30s, so a missed clear is
// not fatal: these broadcasts are presentation, never game state.
function broadcastChallenging(challengerKey, targetKey) {
  const from = online.get(challengerKey);
  if (!from) return;
  const to = online.get(targetKey);
  broadcast({ type: 'challenging', area: from.area, from: from.profile.username, to: to ? to.profile.username : null });
}
function broadcastChallengeClear(challengerKey) {
  const from = online.get(challengerKey);
  const u = db.users[challengerKey];
  const name = from ? from.profile.username : (u ? u.profile.username : null);
  if (!name) return;
  const msg = { type: 'challenge_clear', from: name };
  if (from) msg.area = from.area; // challenger offline: no current area to report
  broadcast(msg);
}

// ---------- Areas (Stage 1) ----------
// Each area has its own 0..1600 x 0..900 coordinate space (Stage 13:
// doubled from 0..800 x 0..450 — every spawn below is the old spot x2).
// A player's area is SESSION-ONLY state (not saved): everyone logs
// back into the plaza. Movement, snapshots and NPCs are per-area;
// chat stays global.
const AREAS = {
  plaza: { name: 'Plaza', spawn: { x: 800, y: 450 } },
  goblins: { name: 'Goblin Camp', spawn: { x: 200, y: 450 } },
  training: { name: 'Training Cave', spawn: { x: 800, y: 720 } },
  gathering: { name: 'Gathering Cave', spawn: { x: 800, y: 450 } },
  cove: { name: 'Fishing Cove', spawn: { x: 180, y: 450 } },
  mine: { name: 'Emberfall Mine & Smithy', spawn: { x: 800, y: 760 } },
  fightcaves: { name: 'Fight Caves', spawn: { x: 800, y: 800 } },
  // Stage 5: the Barrows field (south entrance) and its tunnels; the
  // duel arena is not travel-reachable in normal play — duels move
  // both fighters in and back out (see startDuel / endDuel).
  barrows: { name: 'Barrows', spawn: { x: 800, y: 800 } },
  barrows_tunnels: { name: 'Barrows Tunnels', spawn: { x: 800, y: 450 } },
  arena: { name: 'Duel Arena', spawn: { x: 800, y: 450 } },
};
const NPC_RANGE = 150; // server units — attack / stay-in-combat range (15 tiles at 10 units/tile)

// ---------- Stage 8: melee adjacency ----------
// Derek's rule: a melee swing only lands when the attacker is
// standing NEXT to the target. MELEE_REACH is that distance;
// APPROACH_STEP is how far a server-owned melee monster walks
// toward the player per tick while it is closing in. Player
// positions are client-driven, so a closing PLAYER is never moved
// by the server — the fight message carries `moveTo` (see
// approachPoint) and the client walks them there.
const MELEE_REACH = 42; // ~4 tiles at 10 units/tile
const APPROACH_STEP = 34; // units per tick for a closing monster

// ---------- Stage 12: OSRS fight pacing ----------
// Derek: "when a fight starts make it more realistic to how OSRS
// mechanics was." In OSRS a melee weapon swings once per its weapon
// speed — 4 ticks (2.4s) for a sword — never on every game tick, and
// a combatant only starts swinging once they choose to attack. So:
//   - Duels open with a COUNTDOWN_TICKS countdown (5 ticks, 3.0s):
//     movement is frozen (move messages from either duelist are
//     ignored) and nobody can swing, but engagement taps ARE
//     accepted. Both fighters start UN-engaged: {type:'duel_attack'}
//     is the ONLY way a duelist engages — first swing on the next
//     tick after the countdown (or on the next tick, once the
//     countdown is past), then one swing per MELEE_SPEED ticks.
//     Derek's clarified rule: "players have to tap attack to
//     retaliate" — being hit, connected or not, NEVER engages a
//     duelist; a fighter who never taps never swings. Duel rolls
//     are also EQUALISED: both fighters roll with effective
//     Attack/Strength/Defence = DUEL_LEVEL whatever their trained
//     levels (weapons, armour, styles, specials and XP awards stay
//     individual). (The countdown replaced the original 3-tick
//     OPENING_TICKS opening for duels; NPC fights never had an
//     opening and are unchanged.)
//   - Goblins / Barrows: the player engages by tapping the monster
//     (attack_npc / barrows_enter, as always) and swings once per
//     MELEE_SPEED ticks from one weapon-speed after engagement. The
//     MONSTER starts with its swings locked — it closes distance
//     but does not swing — until the player's first connected swing
//     lands on it; then it unlocks, first swing one weapon-speed
//     after the unlock, on the same per-combatant timer.
//   - Fight Caves keeps its own per-monster cadence — untouched:
//     its monsters are aggressive by design.
const OPENING_TICKS = 3; // the original duel opening (superseded for duels by COUNTDOWN_TICKS; kept for reference)
const COUNTDOWN_TICKS = 5; // duel countdown: 5 ticks (3.0s) of frozen movement and no swings
const MELEE_SPEED = 4; // OSRS melee weapon speed: one swing per 4 ticks (2.4s)
const DUEL_LEVEL = 40; // duels only: both fighters' effective Attack/Strength/Defence for the rolls
// The point a client should walk its player to so they end up next
// to a target: MELEE_REACH*0.75 from the target, on the line from
// the player toward it, clamped to the area bounds (0..1600 x 0..900).
function approachPoint(px, py, tx, ty) {
  const dx = tx - px, dy = ty - py;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: Math.max(0, Math.min(WORLD_W, Math.round(tx))), y: Math.max(0, Math.min(WORLD_H, Math.round(ty))) };
  const back = MELEE_REACH * 0.75;
  return {
    x: Math.max(0, Math.min(WORLD_W, Math.round(tx - (dx / d) * back))),
    y: Math.max(0, Math.min(WORLD_H, Math.round(ty - (dy / d) * back))),
  };
}
// Step a server-owned monster (any object with x/y) toward a point
// by up to `step` units. Returns true if it actually moved.
function stepToward(obj, tx, ty, step) {
  const dx = tx - obj.x, dy = ty - obj.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return false;
  const s = Math.min(step, d);
  obj.x += (dx / d) * s;
  obj.y += (dy / d) * s;
  return s > 0;
}

// ---------- NPCs (Stage 1): Goblin Camp ----------
// Goblins are stationary at their spawn points this stage (no wandering).
const GOBLIN_DEF = { kind: 'goblin', name: 'Goblin', combatLevel: 5, maxHp: 12, maxHit: 2, acc: 0.55, attackType: 'melee', respawnMs: 10000 };
const GOBLIN_SPAWNS = [[400, 450], [640, 320], [840, 520], [1040, 360], [760, 680], [1200, 600]]; // Stage 13: old spots x2
const npcs = new Map(); // id -> live NPC instance (all in the goblins area)
GOBLIN_SPAWNS.forEach(([x, y], i) => {
  const id = 'goblin' + (i + 1);
  npcs.set(id, { id, ...GOBLIN_DEF, area: 'goblins', x, y, spawnX: x, spawnY: y, hp: GOBLIN_DEF.maxHp, alive: true, respawnAt: 0, fightId: null });
});
const npcFights = new Map(); // id -> { id, playerKey, npcId, hpYou, maxHpYou, specialQueued, done, timer, tickCount, nextSwingYou, nextSwingNpc }
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
  const now = Date.now();
  return [...online.entries()].filter(([, p]) => !area || p.area === area).map(([k, p]) => ({
    username: p.profile.username, x: Math.round(p.x), y: Math.round(p.y), area: p.area,
    inDuel: !!p.duelId, activePrayer: p.profile.activePrayer || null,
    role: effectiveRole(p.profile), // Stage 7A
    appearance: p.profile.appearance ? { ...p.profile.appearance } : defaultAppearance(), // Stage 10: how this knight looks
    party: partyListForKey(k), // Stage 7B: member usernames ([] when not in a party)
    // Stage 7C: what this player is visibly doing right now, so other
    // players can tell at a glance. A duel beats a monster fight,
    // which beats a just-used skill (4s window after the action).
    act: p.duelId ? 'duel'
      : (p.npcFightId || p.barrowsFightId || p.fcRunId) ? 'fight'
      : (p.actAt && now - p.actAt < 4000) ? (p.actSkill || null)
      : null,
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

// ---------- Stage 7B helpers: parties ----------
// Usernames in the party this player belongs to (including themselves),
// or [] when they are not in a party. Party members are always online
// (disconnect removes a member), but fall back to the saved username.
function partyListForKey(key) {
  const partyId = partyOf.get(key);
  if (!partyId) return [];
  const set = parties.get(partyId);
  if (!set) return [];
  return [...set].map((k) => {
    const sess = online.get(k);
    if (sess) return sess.profile.username;
    const u = db.users[k];
    return u ? u.profile.username : k;
  });
}
function sendPartyUpdate(key) {
  const sess = online.get(key);
  if (sess) send(sess.ws, { type: 'party', members: partyListForKey(key) });
}
function partyChat(key, text) {
  const sess = online.get(key);
  if (sess) send(sess.ws, { type: 'chat', from: 'Game', text });
}
function clearPartyInvite(inviterKey) {
  const inv = partyInvites.get(inviterKey);
  if (inv) { clearTimeout(inv.timer); partyInvites.delete(inviterKey); }
}
function findPartyInviteForTarget(targetKey) {
  for (const inv of partyInvites.values()) if (inv.targetKey === targetKey) return inv;
  return null;
}
function clearPartyInvitesInvolving(key) {
  for (const [inviterKey, inv] of [...partyInvites]) {
    if (inviterKey === key || inv.targetKey === key) { clearTimeout(inv.timer); partyInvites.delete(inviterKey); }
  }
}
// A party of one only ever exists while its invite is pending (see the
// party_invite handler): when that invite dies, the solo party goes too.
function dissolveSoloParty(key) {
  const partyId = partyOf.get(key);
  if (!partyId) return;
  const set = parties.get(partyId);
  if (set && set.size === 1 && set.has(key)) {
    parties.delete(partyId);
    partyOf.delete(key);
    sendPartyUpdate(key);
    broadcastState();
  }
}
// Remove a player from their party: they get an empty party update,
// the remaining members are notified and refreshed, and a party that
// drops below 2 members dissolves (its last member goes partyless).
function leaveParty(key) {
  const partyId = partyOf.get(key);
  if (!partyId) return false;
  const set = parties.get(partyId);
  const sess = online.get(key);
  const username = sess ? sess.profile.username : (db.users[key] ? db.users[key].profile.username : key);
  partyOf.delete(key);
  if (set) set.delete(key);
  sendPartyUpdate(key); // partyless now -> members []
  const remaining = set ? [...set] : [];
  if (remaining.length < 2) {
    parties.delete(partyId);
    for (const rk of remaining) {
      partyOf.delete(rk);
      sendPartyUpdate(rk);
      partyChat(rk, `${username} left the party.`);
    }
  } else {
    for (const rk of remaining) {
      sendPartyUpdate(rk);
      partyChat(rk, `${username} left the party.`);
    }
  }
  broadcastState();
  return true;
}

// ---------- Stage 7B helpers: trades ----------
function activeTradeForKey(key) {
  for (const t of trades.values()) if (t.aKey === key || t.bKey === key) return t;
  return null;
}
function pendingTradeForKey(key) {
  for (const r of tradeRequests.values()) if (r.fromKey === key || r.toKey === key) return r;
  return null;
}
function clearTradeRequestsInvolving(key) {
  for (const [id, r] of [...tradeRequests]) {
    if (r.fromKey === key || r.toKey === key) { clearTimeout(r.timer); tradeRequests.delete(id); }
  }
}
function tradeOfferView(offer) {
  return { gold: offer.gold, items: offer.items.map((s) => ({ item: s.item, qty: s.qty })) };
}
// One update per side, each seeing their own offer as `you`.
function sendTradeUpdate(trade) {
  for (const k of [trade.aKey, trade.bKey]) {
    const sess = online.get(k);
    if (!sess) continue;
    const other = k === trade.aKey ? trade.bKey : trade.aKey;
    send(sess.ws, {
      type: 'trade_update', tradeId: trade.id,
      you: tradeOfferView(trade.offers[k]), them: tradeOfferView(trade.offers[other]),
      youConfirmed: !!trade.confirmed[k], themConfirmed: !!trade.confirmed[other],
    });
  }
}
function closeTrade(trade) {
  clearTimeout(trade.timer);
  trades.delete(trade.id);
}
// Cancel an open trade: both sides hear it ended, nothing moves.
function cancelTrade(trade, reason) {
  if (!trades.has(trade.id)) return;
  closeTrade(trade);
  for (const k of [trade.aKey, trade.bKey]) {
    const sess = online.get(k);
    if (sess) send(sess.ws, { type: 'trade_done', tradeId: trade.id, ok: false, reason });
  }
}
// Execute a both-confirmed trade: re-validate BOTH offers against the
// CURRENT purses/backpacks first — if anything offered is no longer
// there, the whole trade falls through and nothing moves. Otherwise
// the swap is exact: each side loses what they offered and gains what
// the other offered (items overflow to the bank, never lost).
function executeTrade(trade) {
  const aUser = db.users[trade.aKey], bUser = db.users[trade.bKey];
  if (!aUser || !bUser) { cancelTrade(trade, 'The trade fell through — an item or the gold was no longer there.'); return; }
  const aProf = aUser.profile, bProf = bUser.profile;
  ensureV2(aProf); ensureV2(bProf);
  const offerA = trade.offers[trade.aKey], offerB = trade.offers[trade.bKey];
  const validA = offerA.gold <= aProf.gold && hasItems(aProf, offerA.items);
  const validB = offerB.gold <= bProf.gold && hasItems(bProf, offerB.items);
  if (!validA || !validB) { cancelTrade(trade, 'The trade fell through — an item or the gold was no longer there.'); return; }
  aProf.gold -= offerA.gold; bProf.gold -= offerB.gold;
  for (const s of offerA.items) removeStacks(aProf.backpack, s.item, s.qty);
  for (const s of offerB.items) removeStacks(bProf.backpack, s.item, s.qty);
  aProf.gold += offerB.gold; bProf.gold += offerA.gold;
  for (const s of offerB.items) addItemToProfile(aProf, s.item, s.qty);
  for (const s of offerA.items) addItemToProfile(bProf, s.item, s.qty);
  save(trade.aKey); save(trade.bKey);
  closeTrade(trade);
  sendProfile(trade.aKey); sendProfile(trade.bKey);
  for (const k of [trade.aKey, trade.bKey]) {
    const sess = online.get(k);
    if (!sess) continue;
    const otherKey = k === trade.aKey ? trade.bKey : trade.aKey;
    send(sess.ws, { type: 'trade_done', tradeId: trade.id, ok: true, with: db.users[otherKey].profile.username });
  }
}

// Stage 10: Derek's RuneScape-style rebalance. A swing is an OSRS
// attack roll vs defence roll, so two identical fighters land about
// half their swings (measured ~50% for a level-matched mirror match —
// the pre-Stage-10 flat style constants landed ~76-91%). A combat
// style is ONE single effect, active at a time (profile.style is a
// single value — nothing stacks), and each effect is small:
//   accurate   +3 effective Attack level in the accuracy roll.
//   aggressive +3 effective Strength level in the max-hit formula.
//   defensive  a flat 20% chance to fully block each incoming hit.
//   controlled +1 effective Attack, +1 effective Strength, 7% block.
// The old Stage 5 procs (Accurate 25% extra hit, Aggressive 25% power
// hit, Defensive 25% / Controlled 12% blocks) are GONE — nothing in
// the tick notes may claim them any more. The defender block chance
// lives ONLY in this table: rollHit reads it for duels, and the NPC /
// Barrows / Fight Caves ticks read it for monster swings.
const STYLES = {
  accurate:   { atkBoost: 3, strBoost: 0, block: 0 },
  aggressive: { atkBoost: 0, strBoost: 3, block: 0 },
  defensive:  { atkBoost: 0, strBoost: 0, block: 0.20 },
  controlled: { atkBoost: 1, strBoost: 1, block: 0.07 },
};
// Attack-roll tuning constant: with identical levels and gear on both
// sides the attack and defence rolls nearly cancel, and this small
// multiplier on the attack roll centres the mirror match on ~50%
// (simulated with the real functions: 49-52% from bronze at level 1
// to dragon at level 50+).
const ACC_BALANCE = 0.97;
// Unarmed / base max hit before weapon, cape and Strength terms — the
// old Accurate style max, so a fresh fighter's damage is unchanged.
const BASE_MAX_HIT = 11;
function weaponBonus(p) {
  const def = p.worn && p.worn.weapon ? itemDef(p.worn.weapon) : null;
  return def && def.kind === 'weapon' ? def : null;
}
function capeBonus(p) {
  // Stage 5: a worn cape (the Fire cape) adds its own small bonuses,
  // exactly like a weapon's — it is the only cape-slot item so far.
  return p.worn && p.worn.cape ? itemDef(p.worn.cape) : null;
}
function armourReduction(p) {
  let r = 0, filled = 0;
  for (const slot of ['head', 'body', 'legs', 'shield']) {
    const def = p.worn && p.worn[slot] ? itemDef(p.worn[slot]) : null;
    if (def && def.kind === 'armour') { r += def.reduction; filled += 1; }
  }
  if (filled === 4) r += 0.05; // full-set bonus
  return Math.min(r, 0.45);
}
// OSRS-style accuracy points for the attack roll: the item table's
// accBonus fractions (0.02 bronze sword ... 0.12 dragon, up to 0.50
// for admin customs) become roll points (bronze 1, steel 2, dragon 5).
function weaponAccPoints(p) {
  let pts = 0;
  const w = weaponBonus(p);
  if (w) pts += Math.round((w.accBonus || 0) * 40);
  const capeDef = capeBonus(p);
  if (capeDef) pts += Math.round((capeDef.accBonus || 0) * 40);
  return pts;
}
// The chance (0..1) that one swing connects, before the defender's
// style block and armour are considered: OSRS attack roll vs defence
// roll. Attack roll = (effective Attack + 8) x (64 + weapon points);
// defence roll = (Defence + 8) x 64 (armour's contribution stays its
// damage reduction, below — it does not also dodge). A special
// (Dragon Slash) adds its +5% on top, as before.
// levelOverride (duel call sites only): when given, BOTH profiles
// roll with this effective level for Attack/Strength/Defence
// instead of their trained levels (DUEL_LEVEL equalisation). Every
// other call site omits it and rolls real skills, as Stage 10 built.
function hitChance(attackerProfile, defenderProfile, useSpecial = false, levelOverride = null) {
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  const aLv = levelOverride == null ? levelsOf(attackerProfile) : { attack: levelOverride };
  const dLv = levelOverride == null ? levelsOf(defenderProfile) : { defence: levelOverride };
  const atkRoll = (aLv.attack + (s.atkBoost || 0) + 8) * (64 + weaponAccPoints(attackerProfile)) * ACC_BALANCE;
  const defRoll = (dLv.defence + 8) * 64;
  let chance = atkRoll > defRoll
    ? 1 - (defRoll + 2) / (2 * (atkRoll + 1))
    : atkRoll / (2 * (defRoll + 1));
  if (useSpecial) chance += 0.05;
  return Math.min(0.98, Math.max(0.02, chance));
}
// Max hit for one swing: base + weapon + cape, plus the Strength
// term — every 3 effective Strength levels above 1 add +1, so
// Aggressive's +3 is worth exactly +1 max hit at any level, and
// Controlled's +1 crosses a step at some levels (a little of each).
function maxHit(attackerProfile, useSpecial = false, levelOverride = null) {
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  const lv = levelOverride == null ? levelsOf(attackerProfile) : { strength: levelOverride };
  const w = weaponBonus(attackerProfile);
  let max = BASE_MAX_HIT + Math.floor((lv.strength + (s.strBoost || 0) - 1) / 3) + (w ? w.maxBonus : 0);
  const capeDef = capeBonus(attackerProfile);
  if (capeDef) max += capeDef.maxBonus || 0;
  if (useSpecial) max = Math.floor(max * 1.5); // Dragon Slash
  return max;
}
// One swing, fully resolved: { dmg, connected, outcome }.
// `connected` is the ACCURACY outcome — the swing was on target —
// regardless of the defender's style block or armour: a
// blocked-but-accurate swing still counts as a hit that landed
// (Stage 12's monster unlocks key off it), while a clean miss
// does not. `outcome` is the client-facing clarity
// label: 'hit' when damage got through, 'blocked' when the swing
// connected but was fully stopped (style block, or armour absorbing
// the whole blow), 'miss' when the accuracy roll failed. The damage
// law is unchanged: damage is dealt only when the swing is both
// unblocked and accurate, exactly as before.
function rollHitDetail(attackerProfile, defenderProfile, useSpecial = false, levelOverride = null) {
  const d = STYLES[defenderProfile.style] || STYLES.accurate;
  const blocked = !!(d.block && Math.random() < d.block);
  const connected = Math.random() <= hitChance(attackerProfile, defenderProfile, useSpecial, levelOverride);
  if (blocked || !connected) return { dmg: 0, connected, outcome: connected ? 'blocked' : 'miss' };
  const raw = 1 + Math.floor(Math.random() * maxHit(attackerProfile, useSpecial, levelOverride));
  const dmg = Math.floor(raw * (1 - armourReduction(defenderProfile)));
  return { dmg, connected: true, outcome: dmg > 0 ? 'hit' : 'blocked' };
}
// Returns damage dealt (0 = miss / blocked / fully absorbed by armour).
function rollHit(attackerProfile, defenderProfile, useSpecial = false) {
  return rollHitDetail(attackerProfile, defenderProfile, useSpecial).dmg;
}
// One full player attack for a tick. Since Stage 10 this is a single
// swing — the style's whole effect is already inside rollHit's rolls
// (level boosts) or the defender's block — so there are no proc notes
// to surface. Returns { dmg, connected, outcome, notes } for the callers' tick
// messages (callers grant combat XP on `dmg` like any other hit).
function rollPlayerAttack(attackerProfile, defenderProfile, useSpecial = false, levelOverride = null) {
  const r = rollHitDetail(attackerProfile, defenderProfile, useSpecial, levelOverride);
  return { dmg: r.dmg, connected: r.connected, outcome: r.outcome, notes: [] };
}

// Stage 5: the four duel arenas. A duel picks one at random; both
// fighters are moved into the shared 'arena' area for the fight (the
// client renders the variant from the arena id in duel_start) and
// returned to the plaza spawn when it ends — win, lose or forfeit.
const DUEL_ARENAS = [
  { id: 'sand', name: 'Sand Arena' },
  { id: 'ember', name: 'Ember Arena' },
  { id: 'azure', name: 'Azure Arena' },
  { id: 'violet', name: 'Violet Arena' },
];

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
  // Stage 7A: an OFFICIAL duel (run by a certified mod / admin /
  // owner for 1 NC) pays its winner a Certificate — backpack first,
  // overflow to the bank, exactly like item escrow above. This runs
  // before the saves and the duel_end profiles below, so the win is
  // already visible in both.
  const officialRunner = duel.official && duel.official.runner ? String(duel.official.runner) : null;
  if (officialRunner) addItemToProfile(winner, 'certificate', 1);
  winner.wins += 1; loser.losses += 1;
  winner.rating += 11; loser.rating = Math.max(0, loser.rating - 11);
  save(winnerKey); save(loserKey);
  for (const k of [duel.a, duel.b]) {
    const p = online.get(k);
    if (p) {
      p.duelId = null;
      // Stage 5: the fight is over — both fighters return to the plaza.
      p.area = 'plaza';
      p.x = AREAS.plaza.spawn.x; p.y = AREAS.plaza.spawn.y;
      send(p.ws, { type: 'duel_end', winner: winner.username, reason, pot: duel.pot, itemsWon, profile: publicProfile(db.users[k].profile) });
      send(p.ws, { type: 'area', area: 'plaza' });
      send(p.ws, pilesMsg('plaza'));
      send(p.ws, alliesMsg('plaza')); // Stage 6: your guardian waited for you in the plaza
      send(p.ws, objectsMsg('plaza')); // Stage 7D: placed objects in the plaza
    }
  }
  broadcast({ type: 'chat', from: 'Duel Master', text: `${winner.username} beat ${loser.username} for ${duel.pot}g (${reason}).` });
  // Stage 7A: official-duel settlement is announced game-wide, and
  // the runner hears it directly as well (the broadcast already
  // reaches them; the admin_note makes it unmissable in their feed).
  if (officialRunner) {
    const line = `🏆 ${winner.username} won the official fight run by ${officialRunner} and earned a Certificate!`;
    broadcast({ type: 'chat', from: 'Game', text: line });
    const runnerSess = online.get(officialRunner.toLowerCase());
    if (runnerSess) send(runnerSess.ws, { type: 'admin_note', text: line });
  }
  broadcastState();
}

function startDuel(aKey, bKey, stake, itemsA = [], itemsB = [], official = null) {
  // Stage 7B: a duel starting cancels any open trade involving either
  // fighter first — the trade's other party is notified, nothing moves.
  for (const t of [...trades.values()]) {
    if (t.aKey === aKey || t.bKey === aKey || t.aKey === bKey || t.bKey === bKey) cancelTrade(t, 'Trade cancelled — a duel is starting.');
  }
  const a = db.users[aKey].profile, b = db.users[bKey].profile;
  // Escrow: both gold stakes AND both item stakes leave purses/backpacks
  // before the first tick. A decline never reaches here, so takes nothing.
  a.gold -= stake; b.gold -= stake;
  const escrowItems = [];
  for (const s of itemsA) { removeStacks(a.backpack, s.item, s.qty); addStacks(escrowItems, s.item, s.qty); }
  for (const s of itemsB) { removeStacks(b.backpack, s.item, s.qty); addStacks(escrowItems, s.item, s.qty); }
  save(aKey); save(bKey);
  const id = crypto.randomBytes(6).toString('hex');
  // Stage 5: this duel is fought in one of the four arenas, picked at
  // random. Both fighters move into the 'arena' area at facing start
  // positions; endDuel walks them back to the plaza.
  const arenaDef = DUEL_ARENAS[Math.floor(Math.random() * DUEL_ARENAS.length)];
  const duel = {
    id, a: aKey, b: bKey, stake, pot: stake * 2, escrowItems,
    hp: { [aKey]: 99, [bKey]: 99 }, specialQueued: { [aKey]: false, [bKey]: false },
    // Stage 12: swing timers in duel ticks. tickCount counts every
    // tick of the duel (closing ticks included). Both fighters
    // start UN-engaged — their timers sit at Infinity — until they
    // tap to attack ({type:'duel_attack'}); nothing else engages
    // them (no auto-retaliate in duels).
    tickCount: 0,
    engaged: { [aKey]: false, [bKey]: false },
    nextSwingAt: { [aKey]: Infinity, [bKey]: Infinity },
    done: false, timer: null,
    arena: { id: arenaDef.id, name: arenaDef.name },
    official: official || null, // Stage 7A: { runner: username } for mod-run fights
  };
  duels.set(id, duel);
  const sessA = online.get(aKey), sessB = online.get(bKey);
  sessA.duelId = id; sessB.duelId = id;
  // Stage 8: a duel starts toe-to-toe — the fighters spawn within
  // melee reach of each other, either side of the arena centre
  // (780 vs 820, still 40 apart: Stage 13 doubled the arena centre
  // to (800,450), but the 40-unit gap is a gameplay distance and
  // does not scale). From then on the closing rule in the tick
  // governs: run apart and the swings stop until someone walks back.
  sessA.area = 'arena'; sessA.x = 780; sessA.y = 450;
  sessB.area = 'arena'; sessB.x = 820; sessB.y = 450;
  for (const k of [aKey, bKey]) {
    const p = online.get(k);
    send(p.ws, { type: 'area', area: 'arena' });
    send(p.ws, { type: 'duel_start', duelId: id, stake, pot: duel.pot, escrowItems, arena: duel.arena, official: duel.official, countdownTicks: COUNTDOWN_TICKS, you: db.users[k].profile.username, opponent: db.users[k === aKey ? bKey : aKey].profile.username, profile: publicProfile(db.users[k].profile) });
  }
  broadcast({ type: 'chat', from: 'Duel Master', text: `${a.username} vs ${b.username} — now fighting in the ${arenaDef.name}!` });
  broadcastState();
  duel.timer = setInterval(() => {
    duel.tickCount += 1;
    const tick = duel.tickCount;
    // Stage 12 countdown: ticks 1..COUNTDOWN_TICKS are the countdown
    // (countdownLeft counts 5,4,3,2,1); from tick COUNTDOWN_TICKS+1
    // the fight is live and countdownLeft is 0. No swing can be due
    // during the countdown — engagement arms the first swing for
    // the tick after it.
    const countdownLeft = Math.max(0, COUNTDOWN_TICKS - tick + 1);
    // Stage 8: melee adjacency. Every duel attack is melee-type, so
    // if the fighters are not standing next to each other this tick
    // is a CLOSING tick: no specials are consumed, no attacks are
    // rolled and nobody takes damage — each fighter is told where
    // to walk (moveTo, toward their opponent) to get back in reach.
    // Hit fields are null (not 0) so the client can tell "no swing"
    // apart from a swing that missed or was blocked.
    const posA = online.get(aKey), posB = online.get(bKey);
    if (posA && posB && Math.hypot(posA.x - posB.x, posA.y - posB.y) > MELEE_REACH) {
      for (const k of [aKey, bKey]) {
        const p = online.get(k);
        if (!p) continue;
        const opp = k === aKey ? posB : posA;
        send(p.ws, {
          type: 'duel_tick', hpYou: duel.hp[k], hpOpponent: duel.hp[k === aKey ? bKey : aKey],
          youHit: null, oppHit: null, youOutcome: null, oppOutcome: null, youSpecial: false, oppSpecial: false,
          energyYou: db.users[k].profile.specialEnergy, countdownLeft,
          closing: true, moveTo: approachPoint(p.x, p.y, opp.x, opp.y),
        });
      }
      return;
    }
    // Stage 12: per-fighter swing timers. An ENGAGED fighter swings
    // only on a tick where their timer is due; each swing re-arms
    // the timer MELEE_SPEED ticks out. The due time is an absolute
    // duel tick, so a fighter who was out of reach when their timer
    // came due (closing ticks above return first) swings on the
    // first tick they are back in reach — the timer never gets
    // pushed forward by distance. An UN-engaged fighter never
    // swings: engagement comes ONLY from their own duel_attack tap
    // (Derek: "players have to tap attack to retaliate" — being
    // hit never engages them). On a tick where a fighter does not
    // swing, their hit field is null (exactly like a closing tick)
    // and a queued special STAYS queued: Dragon Slash only ever
    // fires riding a real swing.
    const aDue = duel.engaged[aKey] && tick >= duel.nextSwingAt[aKey];
    const bDue = duel.engaged[bKey] && tick >= duel.nextSwingAt[bKey];
    if (aDue) duel.nextSwingAt[aKey] = tick + MELEE_SPEED;
    if (bDue) duel.nextSwingAt[bKey] = tick + MELEE_SPEED;
    const aSpecial = aDue && duel.specialQueued[aKey];
    const bSpecial = bDue && duel.specialQueued[bKey];
    if (aDue) duel.specialQueued[aKey] = false;
    if (bDue) duel.specialQueued[bKey] = false;
    if (aSpecial) a.specialEnergy = Math.max(0, a.specialEnergy - SPECIAL_COST);
    if (bSpecial) b.specialEnergy = Math.max(0, b.specialEnergy - SPECIAL_COST);
    // Stage 10: each fighter's single style effect rides along on
    // every player attack (inside the shared roll functions).
    // Stage 12: duel rolls are EQUALISED at DUEL_LEVEL for both
    // fighters — trained Attack/Strength/Defence do not apply in a
    // duel; weapons, armour, styles, specials and XP stay personal.
    const aRes = aDue ? rollPlayerAttack(a, b, aSpecial, DUEL_LEVEL) : { dmg: 0, connected: false, outcome: null, notes: [] };
    const bRes = bDue ? rollPlayerAttack(b, a, bSpecial, DUEL_LEVEL) : { dmg: 0, connected: false, outcome: null, notes: [] };
    const dmgToB = aRes.dmg;
    const dmgToA = bRes.dmg;
    duel.hp[bKey] = Math.max(0, duel.hp[bKey] - dmgToB);
    duel.hp[aKey] = Math.max(0, duel.hp[aKey] - dmgToA);
    // Special energy charges on landed (damaging) hits.
    if (dmgToB > 0) a.specialEnergy = Math.min(100, a.specialEnergy + SPECIAL_CHARGE_PER_HIT);
    if (dmgToA > 0) b.specialEnergy = Math.min(100, b.specialEnergy + SPECIAL_CHARGE_PER_HIT);
    for (const k of [aKey, bKey]) {
      const p = online.get(k);
      const ownNotes = k === aKey ? aRes.notes : bRes.notes;
      const oppNotes = k === aKey ? bRes.notes : aRes.notes;
      const noteParts = [...ownNotes];
      if (oppNotes.length) noteParts.push(`Opponent: ${oppNotes.join(' ')}`);
      if (p) send(p.ws, {
        type: 'duel_tick', hpYou: duel.hp[k], hpOpponent: duel.hp[k === aKey ? bKey : aKey],
        youHit: k === aKey ? (aDue ? dmgToB : null) : (bDue ? dmgToA : null),
        oppHit: k === aKey ? (bDue ? dmgToA : null) : (aDue ? dmgToB : null),
        youOutcome: k === aKey ? aRes.outcome : bRes.outcome,
        oppOutcome: k === aKey ? bRes.outcome : aRes.outcome,
        youSpecial: k === aKey ? aSpecial : bSpecial, oppSpecial: k === aKey ? bSpecial : aSpecial,
        energyYou: db.users[k].profile.specialEnergy, countdownLeft,
        note: noteParts.length ? noteParts.join(' ') : undefined,
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
  send(sess.ws, pilesMsg('plaza'));
  send(sess.ws, alliesMsg('plaza')); // Stage 6: guardians standing in the plaza (yours follows you here)
  send(sess.ws, objectsMsg('plaza')); // Stage 7D: placed objects in the plaza
  send(sess.ws, { type: 'chat', from: 'Game', text: note });
  broadcastState();
}
function startNpcFight(key, npc) {
  const sess = online.get(key);
  const profile = sess.profile;
  const id = crypto.randomBytes(6).toString('hex');
  // Fight HP pool = the player's Hitpoints level (duels keep their 99 pool).
  const maxHpYou = Math.max(1, levelForXp(profile.xp.hitpoints));
  const fight = { id, playerKey: key, npcId: npc.id, hpYou: maxHpYou, maxHpYou, specialQueued: false, done: false, timer: null, tickCount: 0, nextSwingYou: MELEE_SPEED, nextSwingNpc: MELEE_SPEED, npcUnlocked: false };
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
  // Stage 8: melee adjacency. Beyond MELEE_REACH (but still inside
  // NPC_RANGE, checked above) this is a CLOSING tick: the goblin
  // steps toward the player, nobody swings either way, a queued
  // special stays queued, and the Tree Guardian holds off (its
  // behaviour below only runs on fighting ticks). Hit fields are
  // null so the client can tell "no swing" from a missed swing.
  if (Math.hypot(sess.x - npc.x, sess.y - npc.y) > MELEE_REACH) {
    stepToward(npc, sess.x, sess.y, APPROACH_STEP);
    send(sess.ws, {
      type: 'npc_fight', phase: 'tick', npcId: npc.id,
      hpYou: Math.max(0, fight.hpYou), maxHpYou: fight.maxHpYou,
      hpNpc: Math.max(0, npc.hp), maxHpNpc: npc.maxHp,
      youHit: null, npcHit: null, youOutcome: null, npcOutcome: null, youSpecial: false, energyYou: profile.specialEnergy,
      closing: true, moveTo: approachPoint(sess.x, sess.y, npc.x, npc.y),
    });
    broadcastNpcState();
    return;
  }
  fight.tickCount = (fight.tickCount || 0) + 1;
  const tick = fight.tickCount;
  const tickNotes = [];
  // Stage 12: OSRS swing timers — the player swings once per
  // MELEE_SPEED fighting ticks, the first swing one full
  // weapon-speed after engagement (no opening beat for NPC fights).
  // The goblin runs on the same timer but starts LOCKED (see the
  // retaliate unlock in the player's swing below). Between swings a
  // fighter's hit field is null (the client reads null as "no
  // swing", exactly like a closing tick), and a queued special
  // stays queued until the player's swing is actually due — it only
  // ever fires riding a real swing.
  let useSpec = false;
  let youHit = null; // null: the player's swing is not due this tick
  let youOutcome = null; // the player's swing outcome (Stage 12 clarity)
  if (tick >= (fight.nextSwingYou || MELEE_SPEED)) {
    fight.nextSwingYou = tick + MELEE_SPEED;
    useSpec = fight.specialQueued; fight.specialQueued = false;
    if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
    // Player swing: the shared Stage 10 roll (style level boosts vs
    // the NPC defender profile, worn weapon, no armour).
    const atkRes = rollPlayerAttack(profile, NPC_DEFENDER, useSpec);
    youHit = atkRes.dmg;
    youOutcome = atkRes.outcome;
    tickNotes.push(...atkRes.notes);
    // Stage 12 retaliate unlock: the goblin's swings stay locked
    // until the player's first CONNECTED swing lands on it — then
    // it unlocks, its first swing one weapon-speed after the hit.
    // (Guardian damage does not unlock it: only the player's own
    // connected swing counts.)
    if (atkRes.connected && !fight.npcUnlocked) {
      fight.npcUnlocked = true;
      fight.nextSwingNpc = tick + MELEE_SPEED;
    }
  }
  // Goblin swing (only once unlocked, and only on its due ticks):
  // Protect from Melee FULLY blocks it (Derek's OSRS spec);
  // otherwise the duel rules apply — the style's block chance
  // (Stage 10: Defensive 20% / Controlled 7%, from the STYLES table),
  // then the goblin's accuracy, then the player's worn armour
  // reduction.
  let npcHit = null; // null: the goblin never swung this tick (locked, or swing not due)
  let npcOutcome = null; // the goblin's swing outcome (Stage 12 clarity)
  if (fight.npcUnlocked && tick >= (fight.nextSwingNpc || MELEE_SPEED)) {
    fight.nextSwingNpc = tick + MELEE_SPEED;
    npcHit = 0;
    if (profile.activePrayer === npc.attackType) { npcHit = 0; npcOutcome = 'blocked'; }
    else if (STYLES[profile.style] && STYLES[profile.style].block && Math.random() < STYLES[profile.style].block) {
      npcHit = 0;
      npcOutcome = 'blocked';
      tickNotes.push(`Blocked by your ${cap(profile.style)} style!`);
    }
    else if (Math.random() <= npc.acc) {
      const raw = 1 + Math.floor(Math.random() * npc.maxHit);
      npcHit = Math.floor(raw * (1 - armourReduction(profile)));
      npcOutcome = npcHit > 0 ? 'hit' : 'blocked'; // connected, but armour absorbed the whole blow
    }
    else npcOutcome = 'miss';
  }
  // Stage 6: a Tree Guardian fighting beside its owner sometimes
  // takes the goblin's hit instead — only a hit that actually got
  // through (a prayer-blocked hit is already 0 by this point).
  const ally = helperAlly(fight.playerKey, sess.area);
  if (ally && npcHit > 0 && Math.random() < 0.35) {
    ally.hp -= npcHit;
    npcHit = 0;
    tickNotes.push(`🌳 Your ${ally.name} takes the hit for you!`);
    if (ally.hp <= 0) killAlly(ally);
  }
  npc.hp -= youHit || 0;
  // ... and the guardian swings at the goblin itself every 2nd
  // fighting tick (its own cadence, unchanged by Stage 12). Its
  // damage grants no XP.
  if (ally && allies.get(fight.playerKey) === ally && fight.tickCount % 2 === 0) {
    const allyDmg = allyDamage(ally);
    npc.hp -= allyDmg;
    tickNotes.push(`🌳 ${ally.name} hits for ${allyDmg}!`);
  }
  fight.hpYou -= npcHit || 0;
  if (youHit > 0) {
    profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
    addXp(fight.playerKey, combatXpGains(profile.style, youHit));
  }
  send(sess.ws, {
    type: 'npc_fight', phase: 'tick', npcId: npc.id,
    hpYou: Math.max(0, fight.hpYou), maxHpYou: fight.maxHpYou,
    hpNpc: Math.max(0, npc.hp), maxHpNpc: npc.maxHp,
    youHit, npcHit, youOutcome, npcOutcome, youSpecial: useSpec, energyYou: profile.specialEnergy,
    note: tickNotes.length ? tickNotes.join(' ') : undefined,
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

// ---------- Barrows (Stage 5) ----------
// Six brothers in six mounds across the north of the 'barrows' field.
// DESIGN CHOICE: crypt fights are instanced per player (like Fight
// Caves runs), NOT shared world NPCs like the goblins — a brother
// exists only inside his killer's fight. The fight itself is a
// dedicated engine modelled on the goblin one (server auto-combat on
// the 0.6s tick, fight HP pool = Hitpoints level, flee / walk-away
// breaks it off) and it speaks the same npc_fight message shapes with
// kind 'barrows', so the client reuses one fight UI. It cannot reuse
// npcTick itself: brothers need per-brother mechanics (below) and the
// goblin kill path is wired to goblin drops/respawns.
//
// Run state is SAVED on the profile (profile.barrows): the brothers
// killed this round and which crypt is the tunnel entrance. Leaving
// mid-run — walking out, logging out, even DYING — keeps the kills
// until the round is finished at the chest (Derek's rule). One crypt
// per run is the tunnel: entering it descends to 'barrows_tunnels'
// instead of starting a crypt fight, and its brother waits by the
// chest if he has not been killed yet. The puzzle door and the chest
// live in the tunnels; climbing out (barrows_leave_tunnel) surfaces
// above the tunnel mound with the run intact.
//
// Brother tuning — combat levels are the OSRS ones (115 / 98); HP,
// accuracy and max hit are this port's tuning, in line with the
// Fight Caves': ~100 HP. Cadence since Stage 12 is the shared OSRS
// swing timer: every brother swings once per MELEE_SPEED ticks
// (a simplification — in OSRS their weapon speeds vary). A mid-level
// player (HP pool 30-60) with food and the right Protect prayer wins
// comfortably; without prayer the incoming damage is real but
// survivable on food. Mechanics per Derek's 2026-11-13 spec, exactly:
//   - The matching Protect prayer FULLY prevents a brother's damage
//     (Melee for Dharok/Guthan/Torag/Verac, Magic for Ahrim, Missiles
//     for Karil). Verac has NO prayer bypass — Derek removed it.
//   - Dharok's max hit scales with his missing health: 8 at full HP
//     up to 20 (2.5x) at near-death, with rage warnings in the tick
//     note as he crosses 75% / 50% / 25% HP.
//   - Guthan heals himself for the damage of a connecting hit, 25%
//     of the time (the green swirl — here: the heal + a note).
//   - Torag swings two hammers: two independent hit rolls per swing.
//   - Prayer drain in crypt fights is the ordinary active-prayer
//     drain only — no extra Barrows drain (parity with goblin fights).
const BARROWS_BROTHERS = {
  dharok: { id: 'dharok', name: 'Dharok the Wretched', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 8, acc: 0.60, mound: { x: 300, y: 220 } },
  guthan: { id: 'guthan', name: 'Guthan the Infested', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 9, acc: 0.60, mound: { x: 660, y: 160 } },
  torag:  { id: 'torag', name: 'Torag the Corrupted', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 7, acc: 0.60, mound: { x: 1020, y: 160 } },
  verac:  { id: 'verac', name: 'Verac the Defiled', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 10, acc: 0.62, mound: { x: 1320, y: 220 } },
  ahrim:  { id: 'ahrim', name: 'Ahrim the Blighted', combatLevel: 98, attackType: 'magic', maxHp: 90, maxHit: 11, acc: 0.60, mound: { x: 480, y: 440 } },
  karil:  { id: 'karil', name: 'Karil the Tainted', combatLevel: 98, attackType: 'missiles', maxHp: 90, maxHit: 11, acc: 0.62, mound: { x: 1120, y: 440 } },
};
const BARROWS_CHEST = { x: 800, y: 450 }; // centre of the tunnels = the tunnels spawn (Stage 13: x2)
const BARROWS_PUZZLE_SYMBOLS = ['circle', 'square', 'triangle', 'diamond'];
const barrowsFights = new Map(); // id -> fight (instanced, one per player)

function barrowsStateMsg(sess) {
  ensureV2(sess.profile);
  const b = sess.profile.barrows;
  return { type: 'barrows_state', kills: [...b.kills], tunnel: b.tunnel, inTunnels: sess.area === 'barrows_tunnels' };
}
function sendBarrowsState(key) {
  const sess = online.get(key);
  if (sess) send(sess.ws, barrowsStateMsg(sess));
}
// A run starts at the first crypt entry of a round: if no tunnel crypt
// has been chosen yet, one of the six is randomised now.
function ensureBarrowsRun(key) {
  const u = db.users[key];
  if (!u) return;
  ensureV2(u.profile);
  if (!u.profile.barrows.tunnel) {
    const ids = Object.keys(BARROWS_BROTHERS);
    u.profile.barrows.tunnel = ids[Math.floor(Math.random() * ids.length)];
    save(key);
  }
}
function startBarrowsFight(key, def, area, anchorX, anchorY) {
  const sess = online.get(key);
  const profile = sess.profile;
  const id = crypto.randomBytes(6).toString('hex');
  // Fight HP pool = the player's Hitpoints level (same as NPC fights).
  const maxHpYou = Math.max(1, levelForXp(profile.xp.hitpoints));
  const fight = {
    id, playerKey: key, brother: def.id, name: def.name, combatLevel: def.combatLevel,
    attackType: def.attackType, area, anchorX, anchorY,
    hpYou: maxHpYou, maxHpYou, hpNpc: def.maxHp, maxHpNpc: def.maxHp,
    specialQueued: false, done: false, timer: null, tickCount: 0, rageFlags: {},
    nextSwingYou: MELEE_SPEED, nextSwingNpc: MELEE_SPEED, npcUnlocked: false, // Stage 12 swing timers + retaliate lock
  };
  barrowsFights.set(id, fight);
  sess.barrowsFightId = id;
  send(sess.ws, {
    type: 'npc_fight', phase: 'start', npcId: def.id, kind: 'barrows', name: def.name, combatLevel: def.combatLevel,
    hpYou: fight.hpYou, maxHpYou, hpNpc: fight.hpNpc, maxHpNpc: fight.maxHpNpc, energyYou: profile.specialEnergy,
  });
  fight.timer = setInterval(() => barrowsTick(fight), TICK_MS);
}
function finishBarrowsFight(fight, reason) {
  if (fight.done) return;
  fight.done = true;
  clearInterval(fight.timer);
  barrowsFights.delete(fight.id);
  const sess = online.get(fight.playerKey);
  if (reason === 'kill') {
    // The kill is banked on the SAVED run state at once — it survives
    // walking out, logging out and dying later in the round.
    const u = db.users[fight.playerKey];
    if (u) {
      ensureV2(u.profile);
      if (!u.profile.barrows.kills.includes(fight.brother)) u.profile.barrows.kills.push(fight.brother);
      save(fight.playerKey);
    }
    if (sess) sendBarrowsState(fight.playerKey);
  }
  if (sess) {
    if (sess.barrowsFightId === fight.id) sess.barrowsFightId = null;
    send(sess.ws, { type: 'npc_fight', phase: 'end', npcId: fight.brother, kind: 'barrows', reason, drops: null, profile: publicProfile(sess.profile) });
  }
}
function barrowsTick(fight) {
  const sess = online.get(fight.playerKey);
  const def = BARROWS_BROTHERS[fight.brother];
  if (!sess || !def) { finishBarrowsFight(fight, 'gone'); return; }
  const profile = sess.profile;
  // Walking too far from the crypt (or leaving the area) breaks it off.
  if (sess.area !== fight.area || Math.hypot(sess.x - fight.anchorX, sess.y - fight.anchorY) > NPC_RANGE) { finishBarrowsFight(fight, 'range'); return; }
  fight.tickCount += 1;
  const notes = [];

  // Stage 8: melee adjacency. The brother stays at his anchor; if
  // the player is not standing next to it, the player's swing cannot
  // happen this tick (a CLOSING tick for the player: youHit null, a
  // queued special stays queued, the guardian holds off, and the
  // tick tells the player where to walk). A melee brother is gated
  // the same way below; Karil (missiles) and Ahrim (magic) keep
  // hitting at any range inside NPC_RANGE, as they always have.
  const closing = Math.hypot(sess.x - fight.anchorX, sess.y - fight.anchorY) > MELEE_REACH;
  const ally = helperAlly(fight.playerKey, sess.area);
  let useSpec = false;
  let youHit = null; // null when the player never swung (closing, or the swing is not due yet)
  let youOutcome = null; // the player's swing outcome (Stage 12 clarity)
  if (!closing) {
    // Stage 12: OSRS swing timer — the player swings once per
    // MELEE_SPEED ticks, the first swing one weapon-speed after
    // engagement; on other in-reach ticks youHit stays null and a
    // queued special stays queued for the due swing. The swing
    // itself is the shared player attack — style boosts included —
    // with combat XP on the total damage, like goblin fights.
    if (fight.tickCount >= (fight.nextSwingYou || MELEE_SPEED)) {
      fight.nextSwingYou = fight.tickCount + MELEE_SPEED;
      useSpec = fight.specialQueued; fight.specialQueued = false;
      if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
      const atkRes = rollPlayerAttack(profile, NPC_DEFENDER, useSpec);
      youHit = atkRes.dmg;
      youOutcome = atkRes.outcome;
      notes.push(...atkRes.notes);
      fight.hpNpc -= youHit;
      // Stage 12 retaliate unlock: the brother's swings stay locked
      // until the player's first CONNECTED swing lands on him —
      // then he unlocks, his first swing one weapon-speed later.
      if (atkRes.connected && !fight.npcUnlocked) {
        fight.npcUnlocked = true;
        fight.nextSwingNpc = fight.tickCount + MELEE_SPEED;
      }
    }
    // Stage 6: a Tree Guardian fighting beside its owner swings at
    // the brother every 2nd tick (its own cadence, unchanged by
    // Stage 12). No XP.
    if (ally && fight.tickCount % 2 === 0) {
      const allyDmg = allyDamage(ally);
      fight.hpNpc -= allyDmg;
      notes.push(`🌳 ${ally.name} hits for ${allyDmg}!`);
    }
    if (youHit > 0) {
      profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
      addXp(fight.playerKey, combatXpGains(profile.style, youHit));
    }
    // Dharok's rage: warn once at each HP threshold he falls through.
    if (def.id === 'dharok' && fight.hpNpc > 0) {
      const frac = fight.hpNpc / fight.maxHpNpc;
      for (const t of [0.75, 0.5, 0.25]) {
        if (frac <= t && !fight.rageFlags[t]) {
          fight.rageFlags[t] = true;
          notes.push(`⚠️ Dharok the Wretched is enraged (${Math.round(t * 100)}% health) — he hits harder as his health falls!`);
        }
      }
    }
  }

  // Brother swing, on his own Stage 12 swing timer (MELEE_SPEED for
  // every brother), and only once the retaliate unlock above has
  // freed it. He swings even on the tick the player kills him (the
  // goblin rule: both sides resolve, then deaths are checked).
  // Stage 8: a MELEE brother cannot swing at a player who has not
  // walked up to him — his hit field is null on a closing tick (he
  // never swung), and it stays null between his swings too. A gated
  // brother's timer does not advance: he swings on the first tick
  // the player is back in reach once his timer is due.
  const brotherGated = closing && def.attackType === 'melee';
  let npcHit = null;
  let npcOutcome = null; // the brother's swing outcome (Stage 12 clarity)
  if (!brotherGated && fight.npcUnlocked && fight.tickCount >= (fight.nextSwingNpc || MELEE_SPEED)) {
    fight.nextSwingNpc = fight.tickCount + MELEE_SPEED;
    npcHit = 0;
    if (profile.activePrayer === def.attackType) {
      npcHit = 0; // the matching Protect prayer FULLY prevents it — Verac included, no bypass
      npcOutcome = 'blocked';
    } else {
      const swings = def.id === 'torag' ? 2 : 1; // Torag's two hammers: two independent rolls
      let styleBlocked = false;
      let anyConnected = false; // a hammer was on target (even if armour absorbed it whole)
      for (let sIdx = 0; sIdx < swings; sIdx++) {
        if (STYLES[profile.style] && STYLES[profile.style].block && Math.random() < STYLES[profile.style].block) { styleBlocked = true; continue; }
        if (Math.random() > def.acc) continue;
        anyConnected = true;
        let maxHit = def.maxHit;
        // Dharok: +150% of base spread over his missing health (8 -> 20).
        if (def.id === 'dharok') maxHit = Math.round(def.maxHit * (1 + 1.5 * (1 - Math.max(0, fight.hpNpc) / fight.maxHpNpc)));
        const raw = 1 + Math.floor(Math.random() * maxHit);
        npcHit += Math.floor(raw * (1 - armourReduction(profile)));
      }
      // One outcome for the whole swing: damage through = 'hit';
      // on target but fully stopped (style block / armour) =
      // 'blocked'; every hammer off target = 'miss'.
      npcOutcome = npcHit > 0 ? 'hit' : (styleBlocked || anyConnected) ? 'blocked' : 'miss';
      if (styleBlocked && npcHit === 0 && swings > 0) notes.push(`Blocked by your ${cap(profile.style)} style!`);
      // Guthan's swirl: a connecting hit (damage got through) has a
      // 25% chance to heal him for what he dealt — never from the dead.
      if (def.id === 'guthan' && npcHit > 0 && fight.hpNpc > 0 && Math.random() < 0.25) {
        fight.hpNpc = Math.min(fight.maxHpNpc, fight.hpNpc + npcHit);
        notes.push(`Guthan's warspear glows green — he heals for ${npcHit}!`);
      }
    }
  }
  // Stage 6: the guardian sometimes takes a connecting brother hit
  // instead — only a hit that actually got through (the matching
  // Protect prayer leaves npcHit at 0, and there is nothing to take).
  // (Guthan's heal above keys off the rolled hit, redirect or not.)
  if (ally && npcHit > 0 && Math.random() < 0.35) {
    ally.hp -= npcHit;
    npcHit = 0;
    notes.push(`🌳 Your ${ally.name} takes the hit for you!`);
    if (ally.hp <= 0) killAlly(ally);
  }
  fight.hpYou -= npcHit || 0; // npcHit is null when the brother never swung (gated, Stage 8; or between swings, Stage 12)

  send(sess.ws, {
    type: 'npc_fight', phase: 'tick', npcId: fight.brother, kind: 'barrows',
    hpYou: Math.max(0, fight.hpYou), maxHpYou: fight.maxHpYou,
    hpNpc: Math.max(0, fight.hpNpc), maxHpNpc: fight.maxHpNpc,
    youHit, npcHit, youOutcome, npcOutcome, youSpecial: useSpec, energyYou: profile.specialEnergy,
    note: notes.length ? notes.join(' ') : undefined,
    // Stage 8: on a closing tick, where to walk to reach the brother.
    ...(closing ? { closing: true, moveTo: approachPoint(sess.x, sess.y, fight.anchorX, fight.anchorY) } : {}),
  });

  if (fight.hpNpc <= 0) {
    // Kill banked (see finishBarrowsFight). If his last swing dropped
    // the player too, the kill still counts and the player still
    // wakes in the plaza (the both-resolve tick rule).
    const playerDead = fight.hpYou <= 0;
    finishBarrowsFight(fight, 'kill');
    if (playerDead) respawnPlayer(fight.playerKey, `${def.name} took you down with him — you wake up in the plaza. Your Barrows kills are kept.`);
    return;
  }
  if (fight.hpYou <= 0) {
    finishBarrowsFight(fight, 'death');
    respawnPlayer(fight.playerKey, `${def.name} got you! You wake up in the plaza at full health. Your Barrows kills are kept — nothing else lost.`);
  }
}
// The tunnels puzzle door: a 3-symbol sequence drawn from 4 symbols.
// The server sends the sequence (the client shows it as the door's
// combination); the player answers it back. A wrong answer earns an
// error and a fresh puzzle.
function newBarrowsPuzzle(sess) {
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push(BARROWS_PUZZLE_SYMBOLS[Math.floor(Math.random() * BARROWS_PUZZLE_SYMBOLS.length)]);
  sess.barrowsPuzzle = seq;
  return { type: 'barrows_puzzle', sequence: seq, options: [...BARROWS_PUZZLE_SYMBOLS] };
}
// The reward chest: OSRS-flavoured loot scaled by brothers killed
// (6 = the full round, the best roll). Gold 300-900 scaled by kills/6;
// two item rolls from the common table (existing items); and a rare
// roll — 8% at 6 kills, proportionally less with fewer — for one of
// the six Barrows weapons.
const BARROWS_LOOT_ITEMS = [
  { item: 'runes', min: 10, max: 30 },
  { item: 'herbs', min: 2, max: 5 },
  { item: 'gems', min: 1, max: 2 },
  { item: 'bars', min: 1, max: 3 },
  { item: 'coal', min: 5, max: 15 },
];
const BARROWS_WEAPONS = ['dharoks_greataxe', 'guthans_warspear', 'torags_hammers', 'veracs_flail', 'ahrims_staff', 'karils_crossbow'];
function rollBarrowsLoot(profile, killCount) {
  const gold = Math.round((300 + Math.floor(Math.random() * 601)) * (killCount / 6));
  profile.gold += gold;
  const items = [];
  const give = (item, qty) => {
    const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(profile.bank, item, leftover); // full pack: bank it, never lose loot
    items.push({ item, qty });
  };
  for (let roll = 0; roll < 2; roll++) {
    const row = BARROWS_LOOT_ITEMS[Math.floor(Math.random() * BARROWS_LOOT_ITEMS.length)];
    give(row.item, row.min + Math.floor(Math.random() * (row.max - row.min + 1)));
  }
  if (Math.random() < 0.08 * (killCount / 6)) {
    give(BARROWS_WEAPONS[Math.floor(Math.random() * BARROWS_WEAPONS.length)], 1);
  }
  return { gold, items };
}

// ---------- Fight Caves (Stage 4): Derek's 63-wave OSRS table ----------
// Instanced per player: every runner gets their own monster roster
// inside the shared 'fightcaves' area (other players in the area just
// see each other walk around). Combat reuses the goblin engine's rolls
// (rollHit vs NPC_DEFENDER, combatXpGains) and the Stage 1 prayer rule:
// a Protect prayer FULLY blocks a monster hit of the matching attack
// type. The player's HP pool is their Hitpoints level, like NPC fights.
// Runs are session-only state; the RECORDS live on the profile (fc).
// Monster tuning — the combat levels are Derek's exact table; HP, max
// hit, accuracy and attack cadence (in 0.6s ticks) are this port's
// tuning, kept in line with the Muse game:
//   Tz-Kih 22: on a CONNECTING hit it also drains 2 prayer points —
//     OSRS-style, Protect from Melee blocks the damage but not the
//     drain; only a Defensive-style block or an outright miss avoids it.
//   Tz-Kek 45: splits into two small Tz-Kek (22) when it dies.
//   Yt-MejKot 180: on its attack tick, a 25% chance to heal ITSELF for
//     10 HP instead of attacking (a simplification of OSRS behaviour).
//   TzTok-Jad 702: attacks strictly alternate missiles / magic (first
//     one random). Each attack is TELEGRAPHED ({type:'fc_telegraph'})
//     one tick before it lands, and the pending hit resolves against
//     the prayer active AT RESOLUTION TIME: matching Protect = 0
//     damage; wrong / no prayer = acc 0.75, max hit 30, armour applies.
//   Yt-HurKot 108: never attacks; heals Jad for 8 HP every 3 ticks.
//     Exactly 4 spawn the first time Jad drops to half health or below.
const FC_DEFS = {
  tzkih:       { kind: 'tzkih', name: 'Tz-Kih', combatLevel: 22, maxHp: 10, maxHit: 2, acc: 0.6, attackType: 'melee', attackEvery: 2 },
  tzkek:       { kind: 'tzkek', name: 'Tz-Kek', combatLevel: 45, maxHp: 20, maxHit: 3, acc: 0.6, attackType: 'melee', attackEvery: 2 },
  tzkek_small: { kind: 'tzkek_small', name: 'Tz-Kek', combatLevel: 22, maxHp: 10, maxHit: 2, acc: 0.6, attackType: 'melee', attackEvery: 2 },
  tokxil:      { kind: 'tokxil', name: 'Tok-Xil', combatLevel: 90, maxHp: 40, maxHit: 5, acc: 0.6, attackType: 'missiles', attackEvery: 3 },
  ytmejkot:    { kind: 'ytmejkot', name: 'Yt-MejKot', combatLevel: 180, maxHp: 80, maxHit: 8, acc: 0.6, attackType: 'melee', attackEvery: 3 },
  ketzek:      { kind: 'ketzek', name: 'Ket-Zek', combatLevel: 360, maxHp: 120, maxHit: 12, acc: 0.62, attackType: 'magic', attackEvery: 4 },
  jad:         { kind: 'jad', name: 'TzTok-Jad', combatLevel: 702, maxHp: 250, maxHit: 30, acc: 0.75, attackType: 'jad', attackEvery: 3 },
  hurkot:      { kind: 'hurkot', name: 'Yt-HurKot', combatLevel: 108, maxHp: 40, maxHit: 0, acc: 0, attackType: null, attackEvery: 3 },
};
// Wave compositions, waves 1-62: counts of [Tz-Kih, Tz-Kek, Tok-Xil,
// Yt-MejKot, Ket-Zek] — the canonical OSRS table Derek supplied. Wave 63
// is TzTok-Jad alone and is spawned specially in spawnFcWave().
const FC_WAVE_KINDS = ['tzkih', 'tzkek', 'tokxil', 'ytmejkot', 'ketzek'];
const FC_WAVES = [null,
  [1,0,0,0,0],[2,0,0,0,0],[0,1,0,0,0],[1,1,0,0,0],[2,1,0,0,0],[0,2,0,0,0],
  [0,0,1,0,0],[1,0,1,0,0],[2,0,1,0,0],[0,1,1,0,0],[1,1,1,0,0],[2,1,1,0,0],[0,2,1,0,0],[0,0,2,0,0],
  [0,0,0,1,0],[1,0,0,1,0],[2,0,0,1,0],[0,1,0,1,0],[1,1,0,1,0],[2,1,0,1,0],[0,2,0,1,0],
  [0,0,1,1,0],[1,0,1,1,0],[2,0,1,1,0],[0,1,1,1,0],[1,1,1,1,0],[2,1,1,1,0],[0,2,1,1,0],[0,0,2,1,0],[0,0,0,2,0],
  [0,0,0,0,1],[1,0,0,0,1],[2,0,0,0,1],[0,1,0,0,1],[1,1,0,0,1],[2,1,0,0,1],[0,2,0,0,1],
  [0,0,1,0,1],[1,0,1,0,1],[2,0,1,0,1],[0,1,1,0,1],[1,1,1,0,1],[2,1,1,0,1],[0,2,1,0,1],[0,0,2,0,1],
  [0,0,0,1,1],[1,0,0,1,1],[2,0,0,1,1],[0,1,0,1,1],[1,1,0,1,1],[2,1,0,1,1],[0,2,0,1,1],
  [0,0,1,1,1],[1,0,1,1,1],[2,0,1,1,1],[0,1,1,1,1],[1,1,1,1,1],[2,1,1,1,1],[0,2,1,1,1],[0,0,2,1,1],[0,0,0,2,1],[0,0,0,0,2],
]; // index = wave number (1..62)
// Deterministic spawn grid across the cave's north two-thirds (the
// entrance is at the south, y=800). Since Stage 8 the melee monsters
// walk toward the player (see the approach pass in fcTick); the
// ranged monsters, healers and Jad stay where they spawn.
// (Stage 13: every point is the old spot x2.)
const FC_SPAWN_POINTS = [
  [800, 180], [500, 180], [1100, 180], [240, 300], [1360, 300],
  [500, 340], [1100, 340], [800, 340], [240, 480], [1360, 480],
  [500, 500], [1100, 500], [800, 500], [360, 120], [1240, 120],
];
const FC_RANGE = NPC_RANGE; // 150 units — attack / stay-in-combat range
const FC_WAVE_PAUSE_MS = 2000; // breather between waves
const fcRuns = new Map(); // run id -> run

function fcRoster(run) {
  return [...run.monsters.values()].filter((m) => m.alive).map((m) => ({
    id: m.id, kind: m.kind, name: m.name, combatLevel: m.combatLevel,
    hp: Math.max(0, m.hp), maxHp: m.maxHp, x: m.x, y: m.y, attackType: m.attackType,
  }));
}
function fcStateMsg(run) {
  return { type: 'fc_state', wave: run.wave, hpYou: Math.max(0, run.hpYou), maxHpYou: run.maxHpYou, monsters: fcRoster(run) };
}
function addFcMonster(run, kind, x, y) {
  const def = FC_DEFS[kind];
  run.spawnSeq += 1;
  let px = x, py = y;
  if (px === undefined) { const p = FC_SPAWN_POINTS[(run.spawnSeq - 1) % FC_SPAWN_POINTS.length]; px = p[0]; py = p[1]; }
  const mon = {
    id: 'fc' + run.spawnSeq, kind: def.kind, name: def.name, combatLevel: def.combatLevel,
    maxHp: def.maxHp, hp: def.maxHp, maxHit: def.maxHit, acc: def.acc,
    attackType: def.attackType, attackEvery: def.attackEvery,
    x: px, y: py, alive: true, cooldown: def.attackEvery,
  };
  run.monsters.set(mon.id, mon);
  return mon;
}
function spawnFcWave(run, wave) {
  run.wave = wave;
  run.betweenWaves = false;
  run.monsters.clear();
  run.jadPending = null;
  if (wave === 63) addFcMonster(run, 'jad', 800, 220); // wave 63: TzTok-Jad alone (Stage 13: x2)
  else {
    const counts = FC_WAVES[wave];
    FC_WAVE_KINDS.forEach((kind, i) => { for (let n = 0; n < counts[i]; n++) addFcMonster(run, kind); });
  }
  const first = [...run.monsters.values()].find((m) => m.alive);
  run.targetId = first ? first.id : null;
  const sess = online.get(run.playerKey);
  if (sess) {
    if (wave > 1) send(sess.ws, { type: 'fc_wave', wave, monsters: fcRoster(run) });
    send(sess.ws, fcStateMsg(run));
  }
}
function startFcRun(key) {
  const sess = online.get(key);
  const profile = sess.profile;
  ensureV2(profile);
  profile.fc.attempts += 1; // an attempt counts the moment the run starts
  save(key);
  const id = crypto.randomBytes(6).toString('hex');
  // Fight HP pool = the player's Hitpoints level (duels keep their 99 pool).
  const maxHpYou = Math.max(1, levelForXp(profile.xp.hitpoints));
  const run = {
    id, playerKey: key, wave: 0, monsters: new Map(), targetId: null,
    hpYou: maxHpYou, maxHpYou, specialQueued: false, done: false, tickCount: 0,
    timer: null, waveTimer: null, startedAt: Date.now(), kills: 0,
    spawnSeq: 0, betweenWaves: false, rosterChanged: false,
    jadPending: null, // { style, from } — telegraphed last tick, lands now
    jadNextStyle: Math.random() < 0.5 ? 'missiles' : 'magic',
    healersSpawned: false, jadDead: false,
  };
  fcRuns.set(id, run);
  sess.fcRunId = id;
  spawnFcWave(run, 1);
  run.timer = setInterval(() => fcTick(run), TICK_MS);
}
// A monster died: count the kill, run the on-death specials (Tz-Kek
// splits into two small Tz-Kek in the same wave; Jad ends the caves).
function killFcMonster(run, mon) {
  mon.alive = false;
  mon.hp = 0;
  run.kills += 1;
  run.rosterChanged = true;
  if (mon.kind === 'tzkek') {
    addFcMonster(run, 'tzkek_small', Math.max(0, mon.x - 25), mon.y);
    addFcMonster(run, 'tzkek_small', Math.min(WORLD_W, mon.x + 25), mon.y); // +-25 is a separation distance, not a position: unscaled
  }
  if (mon.kind === 'jad') run.jadDead = true;
}
// The first time Jad falls to half health or below, exactly 4 Yt-HurKot
// healers rush in around him.
function maybeSpawnFcHealers(run) {
  if (run.healersSpawned) return;
  const jad = [...run.monsters.values()].find((m) => m.kind === 'jad' && m.alive);
  if (!jad || jad.hp > jad.maxHp / 2) return;
  run.healersSpawned = true;
  run.rosterChanged = true;
  for (const [hx, hy] of [[680, 140], [920, 140], [680, 320], [920, 320]]) addFcMonster(run, 'hurkot', hx, hy); // Stage 13: old spots x2 (healers heal Jad at any range, so the wider ring is safe)
}
function fcTick(run) {
  if (run.done) return;
  const sess = online.get(run.playerKey);
  if (!sess) { endFcRun(run, 'disconnect'); return; }
  if (sess.area !== 'fightcaves') { endFcRun(run, 'left'); return; } // safety net; travel ends runs itself
  const profile = sess.profile;
  run.tickCount = (run.tickCount || 0) + 1;
  // Stage 6: the runner's Tree Guardian, if it followed them in.
  let ally = helperAlly(run.playerKey, sess.area);
  const hitsTaken = [];
  let note = null;

  // 1) A telegraphed Jad hit lands FIRST (it was announced last tick, so
  // the player had a full tick to switch prayer). It resolves against
  // the prayer active right now: matching Protect fully blocks it.
  if (run.jadPending) {
    const pending = run.jadPending;
    run.jadPending = null;
    const jad = run.monsters.get(pending.from);
    if (jad && jad.alive) {
      if (profile.activePrayer === pending.style) {
        hitsTaken.push({ from: jad.id, kind: 'jad', dmg: 0, blocked: true });
      } else {
        let dmg = 0;
        if (Math.random() <= jad.acc) {
          const raw = 1 + Math.floor(Math.random() * jad.maxHit);
          dmg = Math.floor(raw * (1 - armourReduction(profile)));
        }
        run.hpYou -= dmg;
        hitsTaken.push({ from: jad.id, kind: 'jad', dmg, blocked: false });
      }
    }
  }

  // 2) The player's swing at their current target (auto-retargets to the
  // first living monster when the target is gone). Out of range = a
  // wasted swing, said so in the note.
  let target = run.targetId ? run.monsters.get(run.targetId) : null;
  if (!target || !target.alive) {
    target = [...run.monsters.values()].find((m) => m.alive) || null;
    run.targetId = target ? target.id : null;
  }
  // Stage 8: melee adjacency for the player's swing. The online
  // Fight Caves has NO ranged weapon mode (checked: neither the
  // server nor the client stores one — the Melee/Ranged switch only
  // exists in the old Muse game), so every player attack here is a
  // melee swing: a target beyond MELEE_REACH cannot be hit, the
  // swing is held, a queued special stays queued, and the tick
  // reports closing + moveTo so the client walks the player in.
  // The ONE exception is Jad himself — his fight is unchanged
  // (Stage 4 rules), so swings at Jad keep the old FC_RANGE reach.
  let useSpec = false;
  let youHit = 0;
  let fcClosing = false;
  if (target && !run.betweenWaves) {
    const tDist = Math.hypot(sess.x - target.x, sess.y - target.y);
    const inReach = target.kind === 'jad' ? tDist <= FC_RANGE : tDist <= MELEE_REACH;
    if (!inReach) {
      fcClosing = true;
      youHit = null; // no swing happened (null, not 0 — see the closing contract)
      if (tDist > FC_RANGE) note = `Too far away from the ${target.name} — walk closer.`;
    } else {
      useSpec = run.specialQueued; run.specialQueued = false;
      if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
      // Stage 10: the style's level boosts ride along on the swing.
      const atkRes = rollPlayerAttack(profile, NPC_DEFENDER, useSpec);
      youHit = atkRes.dmg;
      if (atkRes.notes.length) note = atkRes.notes.join(' ');
      target.hp -= youHit;
      if (youHit > 0) {
        profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
        addXp(run.playerKey, combatXpGains(profile.style, youHit));
      }
      if (target.hp <= 0) killFcMonster(run, target);
      else if (target.kind === 'jad') maybeSpawnFcHealers(run);
      // Stage 6: the guardian swings at the same target every 2nd
      // tick, through the same kill path — Tz-Kek splits and Jad's
      // healer trigger process normally, and Jad is a valid target.
      // Its damage grants no XP. If the owner's swing just killed
      // the target, the guardian holds off until the next target.
      if (ally && run.tickCount % 2 === 0) {
        const cur = run.monsters.get(run.targetId);
        if (cur && cur.alive) {
          const allyDmg = allyDamage(ally);
          cur.hp -= allyDmg;
          const allyNote = `🌳 ${ally.name} hits for ${allyDmg}!`;
          note = note ? `${note} ${allyNote}` : allyNote;
          if (cur.hp <= 0) killFcMonster(run, cur);
          else if (cur.kind === 'jad') maybeSpawnFcHealers(run);
        }
      }
    }
  }

  // Beating Jad ends the caves at once (healers still standing or not).
  if (run.jadDead) { endFcRun(run, 'complete'); return; }
  if (run.hpYou <= 0) { endFcRun(run, 'death'); return; }

  // Stage 8: the approach pass — melee monsters (Tz-Kih, Tz-Kek,
  // Tz-Kek small, Yt-MejKot) step toward the player EVERY tick until
  // they are within MELEE_REACH. Tok-Xil (missiles), Ket-Zek
  // (magic), the Yt-HurKot healers and Jad never move. Positions
  // ride to the client on the fc_state resend at the end of the
  // tick (movement marks the roster changed).
  for (const mon of run.monsters.values()) {
    if (!mon.alive || mon.attackType !== 'melee') continue;
    if (Math.hypot(sess.x - mon.x, sess.y - mon.y) > MELEE_REACH) {
      if (stepToward(mon, sess.x, sess.y, APPROACH_STEP)) run.rosterChanged = true;
    }
  }

  // 3) The surviving monsters act on their own cadences.
  let anyStyleBlock = false;
  for (const mon of run.monsters.values()) {
    if (!mon.alive || run.done) continue;
    mon.cooldown -= 1;
    if (mon.cooldown > 0) continue;
    mon.cooldown = mon.attackEvery;
    if (mon.kind === 'hurkot') {
      // Healers never attack: they pour health back into Jad.
      const jad = [...run.monsters.values()].find((m) => m.kind === 'jad' && m.alive);
      if (jad && jad.hp < jad.maxHp) jad.hp = Math.min(jad.maxHp, jad.hp + 8);
      continue;
    }
    if (mon.kind === 'jad') {
      // Jad does not hit instantly: he TELEGRAPHS. The style alternates
      // strictly; the damage resolves at the start of the next tick.
      const style = run.jadNextStyle;
      run.jadNextStyle = style === 'missiles' ? 'magic' : 'missiles';
      run.jadPending = { style, from: mon.id };
      send(sess.ws, { type: 'fc_telegraph', style, wave: run.wave });
      continue;
    }
    // Stage 8: melee monsters only swing within MELEE_REACH (they
    // walked in during the approach pass above); ranged monsters
    // (Tok-Xil / Ket-Zek) attack at any range, as they always have.
    if (mon.attackType === 'melee' && Math.hypot(sess.x - mon.x, sess.y - mon.y) > MELEE_REACH) continue;
    // Yt-MejKot: 25% of its attack ticks it heals itself instead —
    // only when it would actually attack (in reach, checked above).
    if (mon.kind === 'ytmejkot' && mon.hp < mon.maxHp && Math.random() < 0.25) {
      mon.hp = Math.min(mon.maxHp, mon.hp + 10);
      if (!note) note = 'The Yt-MejKot heals itself!';
      continue;
    }
    const styleBlocked = !!(STYLES[profile.style] && STYLES[profile.style].block && Math.random() < STYLES[profile.style].block);
    if (styleBlocked) anyStyleBlock = true;
    const prayerBlocked = profile.activePrayer === mon.attackType;
    let dmg = 0;
    if (!styleBlocked && Math.random() <= mon.acc) {
      // The hit connects. Tz-Kih drains prayer even through a Protect
      // prayer (OSRS-style); the damage itself is fully blocked by it.
      if (mon.kind === 'tzkih') profile.prayerPoints = Math.max(0, profile.prayerPoints - 2);
      if (!prayerBlocked) {
        const raw = 1 + Math.floor(Math.random() * mon.maxHit);
        dmg = Math.floor(raw * (1 - armourReduction(profile)));
      }
    }
    // Stage 6: the guardian sometimes takes a monster's hit instead.
    // Jad never reaches this loop — his telegraphed hits resolve in
    // step 1 and are NEVER redirected (the prayer game stays pure).
    if (ally && dmg > 0 && Math.random() < 0.35) {
      ally.hp -= dmg;
      const redirNote = `🌳 Your ${ally.name} takes the hit for you!`;
      note = note ? `${note} ${redirNote}` : redirNote;
      if (ally.hp <= 0) { killAlly(ally); ally = null; }
      dmg = 0;
    }
    run.hpYou -= dmg;
    hitsTaken.push({ from: mon.id, kind: mon.kind, dmg, blocked: prayerBlocked || styleBlocked });
  }

  if (run.hpYou <= 0) { endFcRun(run, 'death'); return; }
  // Stage 5: surface a style block in the tick note (once per tick).
  if (anyStyleBlock) {
    const blockNote = `Blocked by your ${cap(profile.style)} style!`;
    note = note ? `${note} ${blockNote}` : blockNote;
  }

  // 4) Wave clear: everything (splits included) is dead — a breather,
  // then the next wave spawns.
  const anyAlive = [...run.monsters.values()].some((m) => m.alive);
  if (!anyAlive && !run.betweenWaves) {
    run.betweenWaves = true;
    run.targetId = null;
    note = note || `Wave ${run.wave} cleared!`;
    run.waveTimer = setTimeout(() => { if (!run.done) spawnFcWave(run, run.wave + 1); }, FC_WAVE_PAUSE_MS);
  }

  if (run.rosterChanged) { run.rosterChanged = false; send(sess.ws, fcStateMsg(run)); }
  const tgt = run.targetId ? run.monsters.get(run.targetId) : null;
  send(sess.ws, {
    type: 'fc_tick', wave: run.wave,
    hpYou: Math.max(0, run.hpYou), maxHpYou: run.maxHpYou,
    targetId: run.targetId, targetHp: tgt ? Math.max(0, tgt.hp) : 0,
    youHit, hitsTaken, energyYou: profile.specialEnergy,
    monsters: [...run.monsters.values()].filter((m) => m.alive).map((m) => ({ id: m.id, hp: Math.max(0, m.hp) })),
    note,
    // Stage 8: on a closing tick, where to walk to reach the target.
    ...(fcClosing && target ? { closing: true, moveTo: approachPoint(sess.x, sess.y, target.x, target.y) } : {}),
  });
}
// End a run and settle the saved records. bestWave is the highest wave
// REACHED. Reason 'death' also wakes the player in the plaza (house
// rule: dying costs nothing). Reason 'disconnect' settles silently.
function endFcRun(run, reason) {
  if (run.done) return;
  run.done = true;
  clearInterval(run.timer);
  if (run.waveTimer) clearTimeout(run.waveTimer);
  fcRuns.delete(run.id);
  const sess = online.get(run.playerKey);
  if (sess && sess.fcRunId === run.id) sess.fcRunId = null;
  const u = db.users[run.playerKey];
  if (!u) return;
  const p = u.profile;
  ensureV2(p);
  const timeMs = Date.now() - run.startedAt;
  p.fc.kills += run.kills;
  if (run.wave > p.fc.bestWave) p.fc.bestWave = run.wave;
  let reward = null;
  if (reason === 'complete') {
    p.fc.completions += 1;
    if (!p.fc.bestTimeMs || timeMs < p.fc.bestTimeMs) p.fc.bestTimeMs = timeMs;
    p.gold += 500;
    const leftover = addStacks(p.backpack, 'fire_cape', 1, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(p.bank, 'fire_cape', leftover); // full pack: bank it, never lose the cape
    reward = { gold: 500, item: 'fire_cape' };
  }
  save(run.playerKey);
  if (sess && reason !== 'disconnect') {
    send(sess.ws, { type: 'fc_end', reason, wave: run.wave, kills: run.kills, timeMs, reward, profile: publicProfile(p) });
    if (reason === 'death') respawnPlayer(run.playerKey, 'The Fight Caves overwhelm you — you wake up in the plaza. Nothing lost.');
  }
}

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
defNode('copper_rock', 'gathering', 'rock', 'Copper rock', 'mining', 1, 'copper_ore', 18, 3, 8000, 240, 220);
defNode('tin_rock', 'gathering', 'rock', 'Tin rock', 'mining', 1, 'tin_ore', 18, 3, 8000, 240, 460);
defNode('iron_rock', 'gathering', 'rock', 'Iron rock', 'mining', 15, 'iron_ore', 35, 2, 15000, 240, 700);
defNode('coal_rock', 'gathering', 'rock', 'Coal rock', 'mining', 30, 'coal', 50, 2, 20000, 480, 320);
defNode('gem_rock', 'gathering', 'rock', 'Gem rock', 'mining', 40, 'uncut_gem', 65, 1, 30000, 480, 600);
defNode('shrimp_spot', 'gathering', 'fish', 'Shrimp spot', 'fishing', 1, 'raw_shrimps', 10, 4, 8000, 1280, 280);
defNode('trout_spot_g', 'gathering', 'fish', 'Trout spot', 'fishing', 20, 'raw_trout', 30, 3, 12000, 1280, 600);
defNode('tree_g', 'gathering', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 840, 180);
defNode('oak_g', 'gathering', 'tree', 'Oak tree', 'woodcutting', 15, 'oak_logs', 38, 3, 15000, 940, 720);
// Fishing Cove — trees on the west shore, trout spots along the east lake
// edge. Cove trout are Fishing 1 on purpose: the cove is the starter
// fishing spot (Derek's cove spec names no level); the cave trout spot
// above is the level-20 one.
defNode('tree_c1', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 240, 200);
defNode('tree_c2', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 240, 460);
defNode('tree_c3', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 240, 720);
defNode('trout_spot_c1', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 1320, 200);
defNode('trout_spot_c2', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 1320, 450);
defNode('trout_spot_c3', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 1320, 700);
// Training Cave — one station per combat skill, in a row. XP only.
defNode('attack_dummy', 'training', 'station', 'Attack dummy', 'attack', 1, null, 12, Infinity, 0, 280, 450);
defNode('strength_dummy', 'training', 'station', 'Strength dummy', 'strength', 1, null, 12, Infinity, 0, 480, 450);
defNode('defence_dummy', 'training', 'station', 'Defence dummy', 'defence', 1, null, 12, Infinity, 0, 680, 450);
defNode('ranged_target', 'training', 'station', 'Ranged target', 'ranged', 1, null, 12, Infinity, 0, 880, 450);
defNode('magic_dummy', 'training', 'station', 'Magic dummy', 'magic', 1, null, 12, Infinity, 0, 1080, 450);
defNode('prayer_altar', 'training', 'station', 'Prayer altar', 'prayer', 1, null, 6, Infinity, 0, 1280, 450);
// Emberfall Mine (Stage 3) — nine rocks across the west/north half;
// the south-east quadrant stays clear for the furnace + anvil (actions,
// not nodes). Iron is Mining 10 here per Derek's mine spec (the
// Gathering Cave's iron rock keeps its 15).
defNode('copper_rock_m', 'mine', 'rock', 'Copper rock', 'mining', 1, 'copper_ore', 18, 4, 8000, 240, 180);
defNode('tin_rock_m', 'mine', 'rock', 'Tin rock', 'mining', 1, 'tin_ore', 18, 4, 8000, 240, 400);
defNode('iron_rock_m', 'mine', 'rock', 'Iron rock', 'mining', 10, 'iron_ore', 35, 3, 12000, 240, 640);
defNode('silver_rock', 'mine', 'rock', 'Silver rock', 'mining', 20, 'silver_ore', 40, 3, 15000, 500, 180);
defNode('coal_rock_m', 'mine', 'rock', 'Coal rock', 'mining', 30, 'coal', 50, 3, 18000, 500, 400);
defNode('gold_rock', 'mine', 'rock', 'Gold rock', 'mining', 40, 'gold_ore', 65, 2, 20000, 760, 180);
defNode('mithril_rock', 'mine', 'rock', 'Mithril rock', 'mining', 55, 'mithril_ore', 80, 2, 25000, 760, 400);
defNode('adamantite_rock', 'mine', 'rock', 'Adamantite rock', 'mining', 70, 'adamantite_ore', 100, 2, 30000, 1020, 180);
defNode('runite_rock', 'mine', 'rock', 'Runite rock', 'mining', 85, 'runite_ore', 125, 1, 40000, 1020, 400);

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

// ---------- Drop piles (Stage 5) ----------
// Backpack items dropped on the ground: per-area, session-only world
// state (like fires). A pile is visible to everyone in its area, anyone
// in range can pick it up, and it despawns after 3 minutes. Gold can
// never be a pile — it is a profile number, not an item.
const piles = new Map(); // id -> { id, item, qty, x, y, area, owner, bornAt }
const PILE_DESPAWN_MS = 3 * 60 * 1000;
function pilesMsg(area) {
  return {
    type: 'piles', area,
    piles: [...piles.values()].filter((p) => p.area === area)
      .map((p) => ({ id: p.id, item: p.item, qty: p.qty, x: Math.round(p.x), y: Math.round(p.y), owner: p.owner })),
  };
}
function broadcastPiles(area) {
  const msg = pilesMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}

// ---------- Placed objects (Stage 7D) ----------
// Decorative props an admin placed in the world (tree / rock /
// flowers / stage light / chest). Unlike piles they PERSIST: the
// saved copies live on the placers' profiles and the runtime list
// (placedObjectsAll, built at boot) is what gets broadcast, on the
// piles pattern — the full per-area list on placement, removal and
// area entry. Decorative only this stage: no gathering, no blocking.
function objectsMsg(area) {
  return {
    type: 'objects', area,
    objects: placedObjectsAll.filter((o) => o.area === area)
      .map((o) => ({ id: o.id, kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), by: o.by })),
  };
}
function broadcastObjects(area) {
  const msg = objectsMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}
// Pile sweep: expired piles vanish and their area hears about it.
setInterval(() => {
  const now = Date.now();
  const touched = new Set();
  for (const [id, p] of piles) if (now - p.bornAt >= PILE_DESPAWN_MS) { piles.delete(id); touched.add(p.area); }
  for (const a of touched) broadcastPiles(a);
}, 5000);

// ---------- Tree Guardians (Stage 6) ----------
// Derek's Stage 6 ask: a button that attacks the nearest tree and the
// tree becomes an NPC ally — it teams with you, follows you and
// protects you. Awakening CONSUMES the tree: its node is depleted for
// 60s, then grows back on the usual node sweep. Guardians are
// session-only world state, like piles and fires: one per player,
// keyed by owner key, NEVER saved to the profile — logging out
// removes yours. They fight beside their owner in the three NPC
// engines (goblins, Barrows brothers, Fight Caves monsters) and
// NEVER in PvP duels; while the owner duels, the guardian waits
// where it was instead of following into the arena.
const allies = new Map(); // ownerKey -> ally
let allySeq = 0;
function alliesMsg(area) {
  return {
    type: 'allies', area,
    allies: [...allies.values()].filter((a) => a.area === area)
      .map((a) => ({ id: a.id, owner: a.owner, name: a.name, oak: a.oak, x: Math.round(a.x), y: Math.round(a.y), hp: Math.max(0, a.hp), maxHp: a.maxHp })),
  };
}
function broadcastAllies(area) {
  const msg = alliesMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}
// The guardian that can help this player in a fight right now: alive
// and standing in the same area as the fight.
function helperAlly(key, area) {
  const ally = allies.get(key);
  return ally && ally.hp > 0 && ally.area === area ? ally : null;
}
// One guardian swing's damage: 1-6 for a Tree Guardian, 2-8 for an
// Oak Guardian. Guardian damage grants no XP (callers only ever add
// it to the target's HP loss, never to an addXp call).
function allyDamage(ally) {
  return ally.oak ? 2 + Math.floor(Math.random() * 7) : 1 + Math.floor(Math.random() * 6);
}
// The one place a guardian dies: out of the map, its area hears about
// it, and the owner gets the dedicated message. After a death the
// player is free to awaken another tree.
function killAlly(ally) {
  if (allies.get(ally.ownerKey) !== ally) return; // already gone
  allies.delete(ally.ownerKey);
  broadcastAllies(ally.area);
  const sess = online.get(ally.ownerKey);
  if (sess) {
    send(sess.ws, { type: 'ally_died', name: ally.name });
    send(sess.ws, { type: 'chat', from: 'Game', text: `🌳 Your ${ally.name} has fallen!` });
  }
}
// Follow loop (the combat tick): guardians trail their owner at ~70
// units, hop to the owner's area when the owner travels, wait out
// duels in place, and vanish when the owner goes offline.
setInterval(() => {
  if (!allies.size) return;
  const touched = new Set();
  for (const [ownerKey, ally] of [...allies]) {
    const sess = online.get(ownerKey);
    if (!sess) { allies.delete(ownerKey); touched.add(ally.area); continue; }
    if (sess.duelId) continue; // duelling: the guardian waits outside the arena
    if (ally.area !== sess.area) {
      touched.add(ally.area);
      ally.area = sess.area;
      ally.x = Math.max(0, sess.x - 40); ally.y = sess.y;
      touched.add(ally.area);
      continue;
    }
    const d = Math.hypot(sess.x - ally.x, sess.y - ally.y);
    if (d > 70) {
      const step = Math.min(26, d - 70);
      ally.x += ((sess.x - ally.x) / d) * step;
      ally.y += ((sess.y - ally.y) / d) * step;
      touched.add(ally.area);
    }
  }
  for (const a of allies.values()) touched.add(a.area);
  for (const a of touched) broadcastAllies(a);
}, TICK_MS);

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
    const def = itemDef(s.item);
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
  // Stage 13: the login scatter is the old 100..600 x 100..350 box x2.
  online.set(key, { ws, profile, x: 200 + Math.random() * 1000, y: 200 + Math.random() * 500, area: 'plaza', duelId: null, npcFightId: null, fcRunId: null, lastActionAt: 0, smithing: null, lastSmithHitAt: 0, lastReheatAt: 0, barrowsFightId: null, barrowsPuzzle: null, barrowsPuzzleSolved: false, actSkill: null, actAt: 0 });
  send(ws, { type: 'welcome', profile: publicProfile(profile), players: playersSnapshot('plaza'), area: 'plaza' });
  send(ws, pilesMsg('plaza')); // Stage 5: any drop piles waiting in the plaza
  send(ws, alliesMsg('plaza')); // Stage 6: any Tree Guardians standing in the plaza
  send(ws, objectsMsg('plaza')); // Stage 7D: any placed objects in the plaza
  send(ws, { type: 'catalog', items: catalogList(), shops: SHOPS });
  send(ws, { type: 'exchange_prices', goods: goodsList() });
  broadcast({ type: 'chat', from: 'Game', text: `${profile.username} entered the plaza.` }, key);
  broadcastState();

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = online.get(key); if (!me) return;
    if (m.type === 'move') {
      // Stage 12: duel countdown freeze — while a duel's countdown
      // is still running (its tick count has not passed
      // COUNTDOWN_TICKS), a duelist's move is IGNORED: their server
      // position stays at the duel-start spot. The state broadcast
      // still runs so every client keeps the authoritative spot.
      const duelNow = me.duelId ? duels.get(me.duelId) : null;
      const frozen = !!(duelNow && duelNow.tickCount <= COUNTDOWN_TICKS);
      if (!frozen) {
        me.x = Math.max(0, Math.min(WORLD_W, +m.x || 0));
        me.y = Math.max(0, Math.min(WORLD_H, +m.y || 0));
      }
      broadcastState();
    }
    if (m.type === 'chat') {
      const text = String(m.text || '').slice(0, 140).trim();
      if (text) broadcast({ type: 'chat', from: profile.username, text });
    }
    // ----- Jump relay (Stage 6): cosmetic only — tell everyone else in
    // this area so their client plays the same hop/flip on this knight.
    // Rate-limited to one relay per 500ms per session.
    if (m.type === 'jump') {
      const now = Date.now();
      if (now - (me.lastJumpAt || 0) >= 500) {
        me.lastJumpAt = now;
        for (const p of online.values()) if (p !== me && p.area === me.area) send(p.ws, { type: 'player_jump', username: profile.username });
      }
    }
    if (m.type === 'style') {
      if (STYLES[m.style]) { profile.style = m.style; save(key); send(ws, { type: 'profile', profile: publicProfile(profile) }); }
    }
    // Stage 10: change your character's appearance. Sanitised over
    // the current look (partial updates keep the rest), marked
    // chosen, saved, and broadcast so every nearby client re-renders
    // the knight — the state snapshot carries appearance per player.
    if (m.type === 'set_appearance') {
      profile.appearance = { ...cleanAppearance(m.appearance, profile.appearance), chosen: true };
      save(key);
      sendProfile(key);
      broadcastState();
      return;
    }

    // ----- Travel between areas (Stage 1) -----
    // The server just validates the destination; the client gates this
    // behind walking to the gates / its teleport menu.
    if (m.type === 'travel') {
      const to = String(m.to || '');
      if (!AREAS[to]) return send(ws, { type: 'error', message: 'Unknown destination.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You cannot travel during a duel.' });
      if (me.npcFightId) { const f = npcFights.get(me.npcFightId); if (f) finishNpcFight(f, 'travel'); }
      // Stage 5: travelling abandons a Barrows crypt fight (kills kept).
      if (me.barrowsFightId) { const f = barrowsFights.get(me.barrowsFightId); if (f) finishBarrowsFight(f, 'travel'); }
      // Travelling out of the caves abandons a Fight Caves run (records kept).
      if (me.fcRunId) { const r = fcRuns.get(me.fcRunId); if (r) endFcRun(r, 'left'); }
      me.area = to;
      me.x = AREAS[to].spawn.x; me.y = AREAS[to].spawn.y;
      send(ws, { type: 'area', area: to });
      if (to === 'goblins') send(ws, npcStateMsg());
      // Stage 2: every area entry also brings its node + fire state
      // (empty lists for areas that have none).
      send(ws, nodesMsg(to));
      send(ws, firesMsg(to));
      // Stage 5: every area entry also brings its drop piles, and the
      // Barrows areas bring the saved run state.
      send(ws, pilesMsg(to));
      send(ws, alliesMsg(to)); // Stage 6: guardians already standing there
      send(ws, objectsMsg(to)); // Stage 7D: placed objects in the new area
      if (to === 'barrows' || to === 'barrows_tunnels') send(ws, barrowsStateMsg(me));
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
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      if (!npc.alive) return send(ws, { type: 'error', message: 'It is already dead.' });
      if (npc.fightId) return send(ws, { type: 'error', message: 'It is already fighting someone else.' });
      if (Math.hypot(me.x - npc.x, me.y - npc.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer.' });
      startNpcFight(key, npc);
      return;
    }
    if (m.type === 'flee') {
      const f = me.npcFightId ? npcFights.get(me.npcFightId) : null;
      if (f) { finishNpcFight(f, 'fled'); return; } // the goblin keeps its remaining HP
      // Stage 5: fleeing also breaks off a Barrows crypt fight.
      const bf = me.barrowsFightId ? barrowsFights.get(me.barrowsFightId) : null;
      if (bf) { finishBarrowsFight(bf, 'fled'); return; }
      return send(ws, { type: 'error', message: 'You are not fighting anything.' });
    }

    // ----- Fight Caves (Stage 4): start / target / leave a run -----
    if (m.type === 'fc_start') {
      if (me.area !== 'fightcaves') return send(ws, { type: 'error', message: 'You need to be in the Fight Caves to start a run.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are already fighting something.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You are already in a Fight Caves run — leave it first.' });
      startFcRun(key);
      return;
    }
    if (m.type === 'fc_attack') {
      const run = me.fcRunId ? fcRuns.get(me.fcRunId) : null;
      if (!run) return send(ws, { type: 'error', message: 'You are not in a Fight Caves run.' });
      const mon = run.monsters.get(String(m.id || ''));
      if (!mon || !mon.alive) return send(ws, { type: 'error', message: 'That monster is not here (or already dead).' });
      run.targetId = mon.id;
      return;
    }
    if (m.type === 'fc_leave') {
      const run = me.fcRunId ? fcRuns.get(me.fcRunId) : null;
      if (!run) return send(ws, { type: 'error', message: 'You are not in a Fight Caves run.' });
      endFcRun(run, 'left');
      return;
    }

    // ----- Barrows (Stage 5): crypts, tunnels, puzzle door, chest -----
    if (m.type === 'barrows_enter') {
      const def = BARROWS_BROTHERS[String(m.brother || '')];
      if (!def) return send(ws, { type: 'error', message: 'No such barrow.' });
      if (me.area !== 'barrows') return send(ws, { type: 'error', message: 'You need to be at the Barrows to enter a crypt.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are already fighting something.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You are in a Fight Caves run.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      if (Math.hypot(me.x - def.mound.x, me.y - def.mound.y) > NPC_RANGE) return send(ws, { type: 'error', message: `Too far away — walk closer to ${def.name}'s mound.` });
      ensureBarrowsRun(key); // first crypt entry of a round picks the tunnel crypt
      if (def.id === profile.barrows.tunnel) {
        // The tunnel entrance: descending replaces the crypt fight.
        me.area = 'barrows_tunnels';
        me.x = AREAS.barrows_tunnels.spawn.x; me.y = AREAS.barrows_tunnels.spawn.y;
        me.barrowsPuzzle = null; me.barrowsPuzzleSolved = false; // a fresh puzzle door below
        send(ws, { type: 'area', area: 'barrows_tunnels' });
        send(ws, nodesMsg('barrows_tunnels'));
        send(ws, firesMsg('barrows_tunnels'));
        send(ws, pilesMsg('barrows_tunnels'));
        send(ws, alliesMsg('barrows_tunnels'));
        send(ws, objectsMsg('barrows_tunnels'));
        send(ws, barrowsStateMsg(me));
        broadcastState();
        return send(ws, { type: 'chat', from: 'Game', text: 'You climb down into the Barrows tunnels. The reward chest waits at the centre, behind a puzzle door.' });
      }
      if (profile.barrows.kills.includes(def.id)) return send(ws, { type: 'error', message: `You have already defeated ${def.name} this round.` });
      startBarrowsFight(key, def, 'barrows', def.mound.x, def.mound.y);
      send(ws, barrowsStateMsg(me)); // the tunnel assignment may be new
      return;
    }
    if (m.type === 'barrows_puzzle') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'The puzzle door is in the Barrows tunnels.' });
      if (me.barrowsPuzzleSolved) return send(ws, { type: 'barrows_puzzle_result', ok: true, alreadySolved: true });
      return send(ws, newBarrowsPuzzle(me));
    }
    if (m.type === 'barrows_puzzle_answer') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'The puzzle door is in the Barrows tunnels.' });
      if (!me.barrowsPuzzle) return send(ws, { type: 'error', message: 'Ask the door for a puzzle first (barrows_puzzle).' });
      const answer = Array.isArray(m.answer) ? m.answer.map((s) => String(s)) : [];
      if (JSON.stringify(answer) === JSON.stringify(me.barrowsPuzzle)) {
        me.barrowsPuzzle = null;
        me.barrowsPuzzleSolved = true;
        return send(ws, { type: 'barrows_puzzle_result', ok: true });
      }
      send(ws, { type: 'error', message: 'Wrong combination — the door resets with a new puzzle.' });
      return send(ws, newBarrowsPuzzle(me));
    }
    if (m.type === 'barrows_loot') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'The reward chest is in the Barrows tunnels.' });
      if (me.duelId || me.npcFightId || me.fcRunId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'Finish the fight first!' });
      if (Math.hypot(me.x - BARROWS_CHEST.x, me.y - BARROWS_CHEST.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk to the chest at the centre of the tunnels.' });
      if (!me.barrowsPuzzleSolved) return send(ws, { type: 'error', message: 'The chest is locked behind the puzzle door — solve the puzzle first.' });
      ensureV2(profile);
      const b = profile.barrows;
      // The tunnel brother guards his own chest: if he has not been
      // killed yet, approaching the loot wakes him — kill him first.
      if (b.tunnel && !b.kills.includes(b.tunnel)) {
        const def = BARROWS_BROTHERS[b.tunnel];
        startBarrowsFight(key, def, 'barrows_tunnels', BARROWS_CHEST.x, BARROWS_CHEST.y);
        return send(ws, { type: 'chat', from: 'Game', text: `${def.name} bursts from the shadows by the chest — he guards the loot himself!` });
      }
      if (b.kills.length < 5) return send(ws, { type: 'error', message: `The chest stays shut — defeat more brothers first (${b.kills.length}/6).` });
      const killCount = b.kills.length;
      const loot = rollBarrowsLoot(profile, killCount);
      // The round is finished: the run state resets (the next round
      // re-randomises its tunnel crypt) and the player climbs back
      // out onto the field.
      profile.barrows = { kills: [], tunnel: null, looted: false };
      save(key);
      me.barrowsPuzzle = null; me.barrowsPuzzleSolved = false;
      me.area = 'barrows';
      me.x = AREAS.barrows.spawn.x; me.y = AREAS.barrows.spawn.y;
      send(ws, { type: 'barrows_loot', gold: loot.gold, items: loot.items, kills: killCount, profile: publicProfile(profile) });
      send(ws, { type: 'area', area: 'barrows' });
      send(ws, nodesMsg('barrows'));
      send(ws, firesMsg('barrows'));
      send(ws, pilesMsg('barrows'));
      send(ws, alliesMsg('barrows'));
      send(ws, objectsMsg('barrows'));
      send(ws, barrowsStateMsg(me));
      broadcastState();
      return;
    }
    if (m.type === 'barrows_leave_tunnel') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'You are not in the Barrows tunnels.' });
      if (me.barrowsFightId) { const f = barrowsFights.get(me.barrowsFightId); if (f) finishBarrowsFight(f, 'fled'); }
      ensureV2(profile);
      // Climb out above the TUNNEL mound — still in the Barrows
      // field, and the run (kills, tunnel) is kept (Derek's rule).
      const def = profile.barrows.tunnel ? BARROWS_BROTHERS[profile.barrows.tunnel] : null;
      me.area = 'barrows';
      me.x = def ? def.mound.x : AREAS.barrows.spawn.x;
      me.y = def ? def.mound.y : AREAS.barrows.spawn.y;
      me.barrowsPuzzle = null; me.barrowsPuzzleSolved = false; // the door resets behind you
      send(ws, { type: 'area', area: 'barrows' });
      send(ws, nodesMsg('barrows'));
      send(ws, firesMsg('barrows'));
      send(ws, pilesMsg('barrows'));
      send(ws, alliesMsg('barrows'));
      send(ws, objectsMsg('barrows'));
      send(ws, barrowsStateMsg(me));
      broadcastState();
      return;
    }

    // ----- Drop piles (Stage 5): drop / pick up backpack items -----
    if (m.type === 'drop') {
      const item = String(m.item || '');
      const def = itemDef(item);
      const qty = Math.max(1, Math.min(9999, Math.floor(+m.qty || 1)));
      if (!def) return send(ws, { type: 'error', message: 'Unknown item. (Gold is not an item — it cannot be dropped.)' });
      if (def.kind === 'note') return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
      if (me.duelId) return send(ws, { type: 'error', message: 'You cannot drop items during a duel.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You cannot drop items during a Fight Caves run.' });
      if (!removeStacks(profile.backpack, item, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${def.name}.` });
      const id = crypto.randomBytes(6).toString('hex');
      piles.set(id, { id, item, qty, x: me.x, y: me.y, area: me.area, owner: profile.username, bornAt: Date.now() });
      save(key);
      broadcastPiles(me.area);
      return sendProfile(key);
    }
    if (m.type === 'pickup') {
      const pile = piles.get(String(m.pileId || ''));
      if (!pile) return send(ws, { type: 'error', message: 'That pile is gone.' });
      if (me.area !== pile.area) return send(ws, { type: 'error', message: 'That pile is not here.' });
      if (Math.hypot(me.x - pile.x, me.y - pile.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer to the pile.' });
      const leftover = addStacks(profile.backpack, pile.item, pile.qty, BACKPACK_MAX_STACKS);
      if (leftover === pile.qty) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
      if (leftover > 0) pile.qty = leftover; // partial pickup: the rest stays on the ground
      else piles.delete(pile.id);
      save(key);
      broadcastPiles(me.area);
      return sendProfile(key);
    }

    // ----- Tree Guardians (Stage 6): awaken the nearest tree -----
    if (m.type === 'awaken_tree') {
      if (me.duelId) return send(ws, { type: 'error', message: 'You cannot awaken a tree during a duel.' });
      if (allies.has(key)) return send(ws, { type: 'error', message: 'Your Tree Guardian still stands.' });
      // The nearest living tree in this area, within 300 units.
      let best = null, bestDist = Infinity;
      for (const n of NODES.values()) {
        if (n.kind !== 'tree' || n.area !== me.area || n.chargesLeft <= 0) continue;
        const d = Math.hypot(me.x - n.x, me.y - n.y);
        if (d <= 300 && d < bestDist) { best = n; bestDist = d; }
      }
      if (!best) return send(ws, { type: 'error', message: 'No tree nearby to awaken.' });
      // The tree is consumed: depleted for 60s, then it grows back
      // on the node sweep like any other gathered-out node.
      best.chargesLeft = 0;
      best.depletedUntil = Date.now() + 60000;
      broadcastNodes(me.area);
      const oak = best.name.includes('Oak');
      const ally = {
        id: 'tg' + (++allySeq), ownerKey: key, owner: profile.username,
        name: oak ? 'Oak Guardian' : 'Tree Guardian', oak,
        x: best.x, y: best.y, area: best.area,
        hp: oak ? 80 : 50, maxHp: oak ? 80 : 50,
      };
      allies.set(key, ally);
      broadcastAllies(me.area);
      return send(ws, { type: 'chat', from: 'Game', text: `🌳 The ${best.name.toLowerCase()} rises as your ${ally.name}! It will follow you and fight beside you.` });
    }

    // ----- Gathering (Stage 2): work a resource node / training station -----
    if (m.type === 'gather') {
      const node = NODES.get(String(m.nodeId || ''));
      if (!node) return send(ws, { type: 'error', message: 'No such spot.' });
      if (me.area !== node.area) return send(ws, { type: 'error', message: 'That spot is not here.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are fighting something.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are fighting a Barrows brother.' });
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
      me.actSkill = node.skill; me.actAt = Date.now(); // Stage 7C: activity marker (training stations share this handler)
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
      me.actSkill = 'firemaking'; me.actAt = Date.now(); // Stage 7C: activity marker
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
      me.actSkill = 'cooking'; me.actAt = Date.now(); // Stage 7C: activity marker
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
      me.actSkill = 'smithing'; me.actAt = Date.now(); // Stage 7C: activity marker
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
      me.actSkill = 'smithing'; me.actAt = Date.now(); // Stage 7C: activity marker
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
      me.actSkill = 'smithing'; me.actAt = now; // Stage 7C: activity marker
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
      me.actSkill = 'smithing'; me.actAt = now; // Stage 7C: activity marker
      sm.heat = 100;
      sm.heatAt = now;
      return send(ws, { type: 'smith_state', item: sm.item, progress: sm.progress, heat: 100 });
    }
    if (m.type === 'smith_upgrade') {
      const item = String(m.item || '');
      const def = itemDef(item);
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
      const def = itemDef(item);
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
      const def = itemDef(item);
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
      if (def.kind === 'token' || def.kind === 'note') return send(ws, { type: 'error', message: "That can't be sold." });
      if (def.custom) return send(ws, { type: 'error', message: "That can't be sold." }); // Stage 7D: customs, same treatment as tokens
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
      const def = itemDef(item);
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
    // Stage 10 (client drag-to-move): reorder two backpack stacks.
    // A pure swap of two EXISTING stack entries — no quantities
    // change, no item is created or destroyed, so no item rule can
    // be bypassed. a == b is a no-op success (the client fires it
    // when a drag ends where it started); anything out of bounds or
    // non-integer is an error and changes nothing.
    if (m.type === 'inv_swap') {
      const a = m.a, b = m.b;
      if (!Number.isInteger(a) || !Number.isInteger(b)
        || a < 0 || b < 0 || a >= profile.backpack.length || b >= profile.backpack.length) {
        return send(ws, { type: 'error', message: 'No backpack slot there to swap.' });
      }
      if (a !== b) {
        const tmp = profile.backpack[a];
        profile.backpack[a] = profile.backpack[b];
        profile.backpack[b] = tmp;
        save(key);
      }
      return sendProfile(key);
    }

    // ----- Use a consumable -----
    if (m.type === 'use') {
      const item = String(m.item || '');
      const def = itemDef(item);
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
        if (!nf) {
          // Barrows fight (Stage 5): food / restore potions heal it too.
          const bf = me.barrowsFightId ? barrowsFights.get(me.barrowsFightId) : null;
          if (bf) {
            if (bf.hpYou >= bf.maxHpYou) return send(ws, { type: 'error', message: 'Already at full health.' });
            removeStacks(profile.backpack, item, 1);
            bf.hpYou = Math.min(bf.maxHpYou, bf.hpYou + def.heal);
            save(key);
            send(ws, {
              type: 'npc_fight', phase: 'tick', npcId: bf.brother, kind: 'barrows',
              hpYou: bf.hpYou, maxHpYou: bf.maxHpYou,
              hpNpc: Math.max(0, bf.hpNpc), maxHpNpc: bf.maxHpNpc,
              youHit: 0, npcHit: 0, youOutcome: null, npcOutcome: null, youSpecial: false, energyYou: profile.specialEnergy,
              note: `${profile.username} used ${def.name} (+${def.heal} HP)`,
            });
            return sendProfile(key);
          }
          // Fight Caves (Stage 4): food / restore potions heal the run pool.
          const run = me.fcRunId ? fcRuns.get(me.fcRunId) : null;
          if (!run) return send(ws, { type: 'error', message: 'Healing only works during a duel.' });
          if (run.hpYou >= run.maxHpYou) return send(ws, { type: 'error', message: 'Already at full health.' });
          removeStacks(profile.backpack, item, 1);
          run.hpYou = Math.min(run.maxHpYou, run.hpYou + def.heal);
          save(key);
          const tgt = run.targetId ? run.monsters.get(run.targetId) : null;
          send(ws, {
            type: 'fc_tick', wave: run.wave,
            hpYou: run.hpYou, maxHpYou: run.maxHpYou,
            targetId: run.targetId, targetHp: tgt ? Math.max(0, tgt.hp) : 0,
            youHit: 0, hitsTaken: [], energyYou: profile.specialEnergy,
            monsters: [...run.monsters.values()].filter((x) => x.alive).map((x) => ({ id: x.id, hp: Math.max(0, x.hp) })),
            note: `${profile.username} used ${def.name} (+${def.heal} HP)`,
          });
          return sendProfile(key);
        }
        if (nf.hpYou >= nf.maxHpYou) return send(ws, { type: 'error', message: 'Already at full health.' });
        removeStacks(profile.backpack, item, 1);
        nf.hpYou = Math.min(nf.maxHpYou, nf.hpYou + def.heal);
        save(key);
        const npcNow = npcs.get(nf.npcId);
        send(ws, {
          type: 'npc_fight', phase: 'tick', npcId: nf.npcId,
          hpYou: nf.hpYou, maxHpYou: nf.maxHpYou,
          hpNpc: npcNow ? Math.max(0, npcNow.hp) : 0, maxHpNpc: npcNow ? npcNow.maxHp : 0,
          youHit: 0, npcHit: 0, youOutcome: null, npcOutcome: null, youSpecial: false, energyYou: profile.specialEnergy,
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
          youHit: 0, oppHit: 0, youOutcome: null, oppOutcome: null, youSpecial: false, oppSpecial: false,
          energyYou: db.users[k].profile.specialEnergy,
          countdownLeft: Math.max(0, COUNTDOWN_TICKS - duel.tickCount + 1),
          note: `${profile.username} used ${def.name} (+${def.heal} HP)`,
        });
      }
      return sendProfile(key);
    }

    // ----- Bank of Gielinor (items only; gold stays a profile number) -----
    if (m.type === 'bank_deposit' || m.type === 'bank_withdraw') {
      const item = String(m.item || '');
      const def = itemDef(item);
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
      // Stage 7A: tokens are never Exchange goods — a sell attempt
      // gets the token error, not the generic unknown-good one.
      const wantedGood = String(m.good || '');
      if (itemDef(wantedGood) && (itemDef(wantedGood).kind === 'token' || itemDef(wantedGood).kind === 'note')) return send(ws, { type: 'error', message: "That can't be sold." });
      const good = GOODS.find((g) => g.id === wantedGood);
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
    if (m.type === 'duel_attack') {
      // Stage 12: tap-to-attack. A duel fighter starts UN-engaged
      // and never swings until they tap their opponent (this
      // message) — the ONLY way to engage: being hit never wakes a
      // duelist (no auto-retaliate; "players have to tap attack to
      // retaliate"). Taps are accepted during the countdown;
      // engaging arms the swing timer: the first swing lands on
      // the next tick after the duel's 5-tick countdown — or on
      // the next tick, if the countdown is long past. Tapping
      // again while already engaged is a harmless no-op.
      const duel = me.duelId ? duels.get(me.duelId) : null;
      if (!duel) return send(ws, { type: 'error', message: 'You are not in a duel.' });
      if (!duel.engaged[key]) {
        duel.engaged[key] = true;
        duel.nextSwingAt[key] = Math.max(COUNTDOWN_TICKS, duel.tickCount) + 1;
      }
      return;
    }

    if (m.type === 'special') {
      const duel = me.duelId ? duels.get(me.duelId) : null;
      const nf = !duel && me.npcFightId ? npcFights.get(me.npcFightId) : null;
      const fc = !duel && !nf && me.fcRunId ? fcRuns.get(me.fcRunId) : null; // Stage 4: specials work in the caves too
      const bf = !duel && !nf && !fc && me.barrowsFightId ? barrowsFights.get(me.barrowsFightId) : null; // Stage 5: and in Barrows crypts
      if (!duel && !nf && !fc && !bf) return send(ws, { type: 'error', message: 'You are not in a duel.' });
      if (profile.specialEnergy < SPECIAL_COST) return send(ws, { type: 'error', message: `Dragon Slash needs ${SPECIAL_COST} special energy (you have ${Math.floor(profile.specialEnergy)}).` });
      if (duel) {
        if (duel.specialQueued[key]) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        duel.specialQueued[key] = true;
      } else if (fc) {
        if (fc.specialQueued) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        fc.specialQueued = true;
      } else if (bf) {
        if (bf.specialQueued) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        bf.specialQueued = true;
      } else {
        if (nf.specialQueued) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        nf.specialQueued = true;
      }
      return send(ws, { type: 'chat', from: 'Game', text: 'Dragon Slash queued — it fires on the next tick.' });
    }

    // ----- Stage 7A: roles, certification, official fights, spawning -----
    if (m.type === 'set_role') {
      const senderRole = effectiveRole(profile);
      if (senderRole !== 'owner' && senderRole !== 'admin') return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const role = String(m.role || '');
      if (role !== 'player' && role !== 'mod' && role !== 'admin') return send(ws, { type: 'error', message: 'Invalid role.' });
      const targetKey = userKeyFor(m.target);
      const targetUser = db.users[targetKey];
      if (!targetUser) return send(ws, { type: 'error', message: 'No such player.' });
      ensureV2(targetUser.profile);
      const targetEff = effectiveRole(targetUser.profile);
      if (senderRole === 'admin') {
        if (role === 'admin') return send(ws, { type: 'error', message: 'Admins cannot create admins.' });
        if (targetEff !== 'player' && targetEff !== 'mod') return send(ws, { type: 'error', message: 'Admins can only change players and mods.' });
      }
      targetUser.profile.role = role;
      if (role !== 'mod') targetUser.profile.certified = false;
      save(targetKey);
      const note = `Set ${targetUser.profile.username}'s role to ${role}.`;
      const targetSess = online.get(targetKey);
      if (targetSess) {
        sendProfile(targetKey);
        send(targetSess.ws, { type: 'chat', from: 'Game', text: `Your role is now ${role}.` });
        send(targetSess.ws, { type: 'admin_note', text: `Your role is now ${role}.` });
      }
      send(ws, { type: 'admin_note', text: note });
      send(ws, { type: 'chat', from: 'Game', text: note });
      broadcastState();
      return;
    }
    if (m.type === 'set_style_admin') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const targetKey = userKeyFor(m.target);
      const targetSess = online.get(targetKey);
      if (!targetSess) return send(ws, { type: 'error', message: 'That player is not online.' });
      const style = String(m.style || '');
      if (!STYLES[style]) return send(ws, { type: 'error', message: 'Unknown style.' });
      targetSess.profile.style = style;
      save(targetKey);
      send(targetSess.ws, { type: 'profile', profile: publicProfile(targetSess.profile) });
      send(targetSess.ws, { type: 'chat', from: 'Game', text: `An admin set your style to ${style}.` });
      send(targetSess.ws, { type: 'admin_note', text: `Your style was set to ${style} by an admin.` });
      const note = `Set ${targetSess.profile.username}'s style to ${style}.`;
      send(ws, { type: 'admin_note', text: note });
      send(ws, { type: 'chat', from: 'Game', text: note });
      return;
    }
    if (m.type === 'admin_list') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const players = Object.entries(db.users).map(([k, u]) => {
        ensureV2(u.profile);
        return { username: u.profile.username, role: effectiveRole(u.profile), certified: !!u.profile.certified, online: online.has(k) };
      });
      return send(ws, { type: 'admin_list', players });
    }
    if (m.type === 'online_list') {
      const r = effectiveRole(profile);
      if (r !== 'mod' && r !== 'admin' && r !== 'owner') return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const players = [...online.values()].map((sess) => ({ username: sess.profile.username, area: sess.area, role: effectiveRole(sess.profile) }));
      return send(ws, { type: 'online_list', players });
    }
    if (m.type === 'certify') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const targetKey = userKeyFor(m.target);
      const targetUser = db.users[targetKey];
      if (!targetUser) return send(ws, { type: 'error', message: 'No such player.' });
      ensureV2(targetUser.profile);
      if (effectiveRole(targetUser.profile) !== 'mod') return send(ws, { type: 'error', message: 'Only mods can be certified.' });
      targetUser.profile.certified = true;
      addItemToProfile(targetUser.profile, 'nc', 1);
      save(targetKey);
      const targetSess = online.get(targetKey);
      if (targetSess) {
        sendProfile(targetKey);
        send(targetSess.ws, { type: 'chat', from: 'Game', text: `⭐ You were certified by ${profile.username} (+1 NC).` });
        send(targetSess.ws, { type: 'admin_note', text: `You were certified by ${profile.username} (+1 NC).` });
      }
      broadcast({ type: 'chat', from: 'Game', text: `⭐ ${targetUser.profile.username} was certified by ${profile.username} (+1 NC).` });
      send(ws, { type: 'admin_note', text: `Certified ${targetUser.profile.username} (+1 NC).` });
      return;
    }
    if (m.type === 'spawn_item') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const item = String(m.item || '');
      const spawnDef = itemDef(item); // Stage 7D: custom ids are spawnable too
      if (!spawnDef) return send(ws, { type: 'error', message: 'Unknown item.' });
      const qty = Math.max(1, Math.min(99, Math.floor(+m.qty || 1)));
      const targetKey = m.target ? userKeyFor(m.target) : key;
      const targetUser = db.users[targetKey];
      if (!targetUser) return send(ws, { type: 'error', message: 'No such player.' });
      ensureV2(targetUser.profile);
      addItemToProfile(targetUser.profile, item, qty);
      save(targetKey);
      const targetSess = online.get(targetKey);
      if (targetSess) {
        sendProfile(targetKey);
        if (targetKey !== key) {
          send(targetSess.ws, { type: 'chat', from: 'Game', text: `You received ${qty} x ${spawnDef.name}.` });
          send(targetSess.ws, { type: 'admin_note', text: `You received ${qty} x ${spawnDef.name}.` });
        }
      }
      const note = `Spawned ${qty} x ${spawnDef.name} for ${targetUser.profile.username}.`;
      send(ws, { type: 'admin_note', text: note });
      if (targetKey !== key) send(ws, { type: 'chat', from: 'Game', text: note });
      return;
    }
    if (m.type === 'run_fight') {
      const senderRole = effectiveRole(profile);
      const allowed = senderRole === 'admin' || senderRole === 'owner' || (senderRole === 'mod' && !!profile.certified);
      if (!allowed) {
        if (senderRole === 'mod') return send(ws, { type: 'error', message: 'You need to be certified to run official fights.' });
        return send(ws, { type: 'error', message: 'You do not have permission to run official fights.' });
      }
      const aKey = userKeyFor(m.a);
      const bKey = userKeyFor(m.b);
      if (!aKey || !bKey || aKey === bKey) return send(ws, { type: 'error', message: 'Pick two different fighters.' });
      if (aKey === key || bKey === key) return send(ws, { type: 'error', message: 'The runner cannot be a fighter.' });
      const sessA = online.get(aKey);
      const sessB = online.get(bKey);
      if (!sessA || !sessB) return send(ws, { type: 'error', message: 'Both fighters must be online.' });
      // Mirror the challenge busy-checks for the runner and both fighters.
      for (const sess of [me, sessA, sessB]) {
        if (sess.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
        if (sess.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
        if (sess.barrowsFightId) return send(ws, { type: 'error', message: 'One of you is fighting a Barrows brother.' });
        if (sess.fcRunId) return send(ws, { type: 'error', message: 'One of you is in the Fight Caves.' });
      }
      for (const o of fightOffers.values()) {
        if (o.runnerKey === key || o.aKey === aKey || o.bKey === aKey || o.aKey === bKey || o.bKey === bKey) {
          return send(ws, { type: 'error', message: 'A fight offer is already pending for one of those players.' });
        }
      }
      if (stackQty(profile.backpack, 'nc') < 1) return send(ws, { type: 'error', message: 'You need 1 NC to run an official fight.' });
      const id = crypto.randomBytes(6).toString('hex');
      const offer = { id, runnerKey: key, aKey, bKey, accepted: {}, expires: Date.now() + 30000, timer: null };
      offer.timer = setTimeout(() => {
        if (!fightOffers.has(id)) return;
        fightOffers.delete(id);
        const line = 'The official fight offer expired.';
        const rSess = online.get(offer.runnerKey);
        if (rSess) { send(rSess.ws, { type: 'chat', from: 'Game', text: line }); send(rSess.ws, { type: 'admin_note', text: line }); }
        for (const fk of [offer.aKey, offer.bKey]) {
          const fSess = online.get(fk);
          if (fSess) send(fSess.ws, { type: 'chat', from: 'Game', text: line });
        }
      }, 30000);
      if (offer.timer.unref) offer.timer.unref();
      fightOffers.set(id, offer);
      send(sessA.ws, { type: 'fight_offer', id, fightId: id, from: profile.username, opponent: sessB.profile.username });
      send(sessB.ws, { type: 'fight_offer', id, fightId: id, from: profile.username, opponent: sessA.profile.username });
      send(ws, { type: 'admin_note', text: `Official fight offer sent: ${sessA.profile.username} vs ${sessB.profile.username}.` });
      send(ws, { type: 'chat', from: 'Game', text: `Official fight offer sent: ${sessA.profile.username} vs ${sessB.profile.username}.` });
      return;
    }
    if (m.type === 'fight_reply') {
      let offer = null;
      for (const o of fightOffers.values()) if (o.aKey === key || o.bKey === key) { offer = o; break; }
      if (!offer) return send(ws, { type: 'error', message: 'No fight offer is pending.' });
      if (offer.expires < Date.now()) {
        clearTimeout(offer.timer); fightOffers.delete(offer.id);
        return send(ws, { type: 'error', message: 'That fight offer has expired.' });
      }
      const runnerSess = online.get(offer.runnerKey);
      const otherKey = offer.aKey === key ? offer.bKey : offer.aKey;
      const otherSess = online.get(otherKey);
      if (m.accept !== true) {
        // Decline: spend nothing, tell the runner and the other fighter.
        clearTimeout(offer.timer); fightOffers.delete(offer.id);
        const line = `${profile.username} declined the official fight — the fight is off. No NC was spent.`;
        if (runnerSess) { send(runnerSess.ws, { type: 'chat', from: 'Game', text: line }); send(runnerSess.ws, { type: 'admin_note', text: line }); }
        if (otherSess) send(otherSess.ws, { type: 'chat', from: 'Game', text: line });
        return;
      }
      offer.accepted[key] = true;
      if (!(offer.accepted[offer.aKey] && offer.accepted[offer.bKey])) {
        if (runnerSess) send(runnerSess.ws, { type: 'admin_note', text: `${profile.username} accepted the official fight.` });
        return;
      }
      // Both accepted: claim the offer first so nothing double-starts.
      clearTimeout(offer.timer); fightOffers.delete(offer.id);
      const runnerUser = db.users[offer.runnerKey];
      const runnerProfile = runnerUser ? runnerUser.profile : null;
      const sessA2 = online.get(offer.aKey);
      const sessB2 = online.get(offer.bKey);
      const cancelAll = (line) => {
        for (const s of [runnerSess, sessA2, sessB2]) if (s) send(s.ws, { type: 'chat', from: 'Game', text: line });
        if (runnerSess) send(runnerSess.ws, { type: 'admin_note', text: line });
      };
      if (!runnerProfile || stackQty(runnerProfile.backpack, 'nc') < 1) { cancelAll('The official fight was cancelled — the runner no longer has an NC.'); return; }
      if (!sessA2 || !sessB2) { cancelAll('The official fight was cancelled — a fighter went offline.'); return; }
      if (sessA2.duelId || sessB2.duelId || sessA2.npcFightId || sessB2.npcFightId || sessA2.barrowsFightId || sessB2.barrowsFightId || sessA2.fcRunId || sessB2.fcRunId) {
        cancelAll('The official fight was cancelled — a fighter is busy.'); return;
      }
      removeStacks(runnerProfile.backpack, 'nc', 1);
      save(offer.runnerKey);
      if (runnerSess) sendProfile(offer.runnerKey);
      startDuel(offer.aKey, offer.bKey, 0, [], [], { runner: runnerProfile.username });
      return;
    }
    if (m.type === 'exchange_cert') {
      if (stackQty(profile.backpack, 'certificate') < 1) return send(ws, { type: 'error', message: "You don't have a Certificate to exchange." });
      const adminsOnline = [...online.entries()].filter(([k, sess]) => k !== key && isAdminOrOwner(sess.profile));
      if (adminsOnline.length === 0) return send(ws, { type: 'error', message: 'No admin is online right now.' });
      if (certRequests.has(key)) return send(ws, { type: 'error', message: 'You already have a certificate exchange request pending.' });
      certRequests.set(key, { requesterKey: key, handled: false });
      for (const [, sess] of adminsOnline) send(sess.ws, { type: 'cert_request', from: profile.username });
      send(ws, { type: 'chat', from: 'Game', text: 'Certificate exchange requested — waiting for an admin.' });
      return;
    }
    if (m.type === 'cert_reply') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      let requesterKey = m.from ? userKeyFor(m.from) : null;
      let req = requesterKey ? certRequests.get(requesterKey) : null;
      if (!req && !requesterKey && certRequests.size > 0) {
        const first = certRequests.entries().next().value;
        requesterKey = first[0]; req = first[1];
      }
      if (!req || req.handled) return send(ws, { type: 'error', message: 'That certificate request is gone.' });
      const requesterSess = online.get(requesterKey);
      const requesterUser = db.users[requesterKey];
      if (m.accept !== true) {
        req.handled = true; certRequests.delete(requesterKey);
        const line = `${profile.username} declined your certificate exchange.`;
        if (requesterSess) send(requesterSess.ws, { type: 'chat', from: 'Game', text: line });
        send(ws, { type: 'admin_note', text: `Declined ${requesterUser ? requesterUser.profile.username : requesterKey}'s certificate exchange.` });
        return;
      }
      // First accept wins: claim it before touching any balances, so
      // a second admin's reply can never pay out twice.
      req.handled = true; certRequests.delete(requesterKey);
      if (!requesterUser) return send(ws, { type: 'error', message: 'That player is gone.' });
      const requesterProfile = requesterUser.profile;
      ensureV2(requesterProfile);
      if (stackQty(requesterProfile.backpack, 'certificate') < 1) {
        const line = 'The certificate exchange failed — the player no longer has a Certificate.';
        if (requesterSess) send(requesterSess.ws, { type: 'chat', from: 'Game', text: line });
        return send(ws, { type: 'error', message: line });
      }
      removeStacks(requesterProfile.backpack, 'certificate', 1);
      requesterProfile.gold += 250;
      save(requesterKey); save(key);
      if (requesterSess) {
        sendProfile(requesterKey);
        send(requesterSess.ws, { type: 'chat', from: 'Game', text: `📜 You exchanged a Certificate with ${profile.username} for 250g.` });
      }
      send(ws, { type: 'admin_note', text: `Accepted ${requesterProfile.username}'s Certificate exchange (250g paid).` });
      send(ws, { type: 'chat', from: 'Game', text: `📜 ${requesterProfile.username} exchanged a Certificate with you for 250g.` });
      broadcast({ type: 'chat', from: 'Game', text: `📜 ${requesterProfile.username} exchanged a Certificate with ${profile.username} for 250g.` });
      return;
    }
    // ----- Stage 9: signed notes (the certificate request flow) -----
    // A player signs a Note FROM a Certificate, then gives the signed
    // note to an admin as a request; the admin agrees (signer +250g)
    // or declines (the signed note returns). The broadcast
    // exchange_cert panel flow above is separate and unchanged.
    if (m.type === 'sign_note') {
      ensureV2(profile);
      const certQty = stackQty(profile.backpack, 'certificate');
      if (certQty < 1) return send(ws, { type: 'error', message: "You don't have a Certificate to sign." });
      // The note needs a backpack stack of its own: signing always
      // fits unless the pack is full AND the certificate stack
      // survives the signing (qty > 1) AND no note stack exists yet.
      const hasNoteStack = profile.backpack.some((s) => s.item === 'note');
      if (!hasNoteStack && certQty > 1 && profile.backpack.length >= BACKPACK_MAX_STACKS) {
        return send(ws, { type: 'error', message: 'Your backpack is full (28 stacks).' });
      }
      removeStacks(profile.backpack, 'certificate', 1);
      addStacks(profile.backpack, 'note', 1, BACKPACK_MAX_STACKS);
      profile.notes.push({ text: noteRequestText(profile.username), from: profile.username, at: Date.now() });
      save(key);
      send(ws, { type: 'chat', from: 'Game', text: '📝 You signed a Note requesting 250g for 1 Certificate. Give it to an admin to ask.' });
      return sendProfile(key);
    }
    if (m.type === 'read_note') {
      // Reading shows the OLDEST held signed note and consumes
      // NOTHING — the note is still yours to give away afterwards.
      ensureV2(profile);
      if (stackQty(profile.backpack, 'note') < 1) return send(ws, { type: 'error', message: 'You have no note to read.' });
      if (profile.notes.length === 0) return send(ws, { type: 'error', message: 'That note is blank.' });
      const entry = profile.notes[0];
      return send(ws, { type: 'note_text', text: entry.text, from: entry.from, at: entry.at });
    }
    if (m.type === 'give_note') {
      ensureV2(profile);
      if (stackQty(profile.backpack, 'note') < 1) return send(ws, { type: 'error', message: 'You have no note to give.' });
      if (profile.notes.length === 0) return send(ws, { type: 'error', message: 'That note is blank.' });
      const targetKey = userKeyFor(m.to);
      if (targetKey === key) return send(ws, { type: 'error', message: "You can't give a note to yourself." });
      const target = online.get(targetKey);
      if (!target) return send(ws, { type: 'error', message: 'That admin is not online right now.' });
      if (!isAdminOrOwner(target.profile)) return send(ws, { type: 'error', message: 'You can only give a note to an admin.' });
      removeStacks(profile.backpack, 'note', 1);
      const entry = profile.notes.shift();
      const id = ++noteSeq;
      noteRequests.set(id, { id, fromKey: key, fromName: profile.username, text: entry.text, toKey: targetKey, at: entry.at });
      save(key);
      send(target.ws, { type: 'note_request', id, from: profile.username, text: entry.text });
      send(ws, { type: 'chat', from: 'Game', text: `📝 You gave your signed Note to ${target.profile.username}.` });
      return sendProfile(key);
    }
    if (m.type === 'admin_notes') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const notes = [...noteRequests.values()]
        .filter((r) => r.toKey === key)
        .map((r) => ({ id: r.id, from: r.fromName, text: r.text, at: r.at }));
      return send(ws, { type: 'admin_notes', notes });
    }
    if (m.type === 'note_reply') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const req = noteRequests.get(Math.floor(+m.id || 0));
      if (!req) return send(ws, { type: 'error', message: 'That note is gone.' });
      if (req.toKey !== key) return send(ws, { type: 'error', message: 'That note was given to another admin.' });
      // The decision removes the pending note either way.
      noteRequests.delete(req.id);
      const signerUser = db.users[req.fromKey];
      if (!signerUser) return send(ws, { type: 'error', message: 'That player is gone.' });
      const signerProfile = signerUser.profile;
      ensureV2(signerProfile);
      const signerSess = online.get(req.fromKey);
      if (m.accept === true) {
        // Settled on the signer's SAVED profile — they are paid even
        // if they have gone offline since handing the note over.
        signerProfile.gold += 250;
        save(req.fromKey); save(key);
        if (signerSess) {
          sendProfile(req.fromKey);
          send(signerSess.ws, { type: 'chat', from: 'Game', text: `📜 Your signed Note was approved by ${profile.username} — 250g paid.` });
        }
        send(ws, { type: 'admin_note', text: `Approved ${req.fromName}'s signed Note (250g paid).` });
        send(ws, { type: 'chat', from: 'Game', text: `📜 You approved ${req.fromName}'s signed Note (250g paid).` });
        return;
      }
      returnSignedNote(req, `📝 ${profile.username} declined your signed Note — it has been returned to you.`);
      save(key);
      send(ws, { type: 'admin_note', text: `Declined ${req.fromName}'s signed Note — returned to them.` });
      return;
    }

    // ----- Stage 7D: custom item editor, reference lists, placed objects -----
    // Everything in this section is admin/owner only — mods and
    // players get the standard permission error.
    if (m.type === 'create_custom') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const baseId = String(m.base || '');
      const baseDef = ITEMS[baseId]; // base catalog ONLY: a custom id (or a token) is not a valid base
      if (!baseDef || (baseDef.kind !== 'weapon' && baseDef.kind !== 'armour')) {
        return send(ws, { type: 'error', message: 'Pick a base weapon or armour item to clone.' });
      }
      const name = String(m.name || '').trim();
      if (name.length < 1 || name.length > 30) return send(ws, { type: 'error', message: 'Custom items need a name of 1-30 characters.' });
      // Stage 8: the drawn art is validated before anything is
      // created — a bad image rejects the whole create (and does
      // not consume an item number).
      const artIn = customArtFrom(m, null);
      if (!artIn.ok) return send(ws, { type: 'error', message: 'That image is too big or not a PNG drawing.' });
      const isWeapon = baseDef.kind === 'weapon';
      const icon = CUSTOM_ICONS.includes(m.icon) ? m.icon : (baseDef.icon || (isWeapon ? '🗡️' : '🛡️'));
      // A stat the admin supplied wins (clamped); an omitted stat is
      // cloned from the base item. Fields irrelevant to the base kind
      // are zeroed (a sword has no reduction; armour has no bonuses).
      const statOr = (v, hi, fallback) => {
        const n = +v;
        return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(hi, n)) * 100) / 100 : fallback;
      };
      const num = ++customSeq;
      const def = {
        id: `custom_${num}`, num, base: baseId, name, icon,
        kind: baseDef.kind, slot: baseDef.slot,
        accBonus: isWeapon ? statOr(m.accBonus, 0.50, baseDef.accBonus || 0) : 0,
        maxBonus: isWeapon ? Math.round(statOr(m.maxBonus, 30, baseDef.maxBonus || 0)) : 0,
        reduction: isWeapon ? 0 : statOr(m.reduction, 0.45, baseDef.reduction || 0),
        custom: true, by: profile.username, buy: 0, sellOnly: 0,
        // Stage 8: the admin's tint + drawn art (null when unset).
        color: customColorFrom(m, null), art: artIn.value,
      };
      ensureV2(profile);
      profile.customItems[def.id] = def; // the def lives on MY profile (see the storage note at the top)
      customItems.set(def.id, def);
      customOwner.set(def.id, key);
      addItemToProfile(profile, def.id, 1); // the creator receives the first copy
      save(key);
      sendProfile(key);
      broadcast({ type: 'catalog', items: catalogList(), shops: SHOPS }); // everyone sees the new item at once
      send(ws, { type: 'admin_note', text: `Created custom item #${def.num}: ${def.name} (${def.id}).` });
      return send(ws, { type: 'custom_created', item: customCatalogEntry(def) });
    }
    if (m.type === 'edit_custom') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const def = customItems.get(String(m.id || ''));
      if (!def) return send(ws, { type: 'error', message: 'No such custom item.' });
      // Stage 8: a present-but-invalid drawn image rejects the
      // whole edit before anything changes.
      const artIn = customArtFrom(m, def.art || null);
      if (!artIn.ok) return send(ws, { type: 'error', message: 'That image is too big or not a PNG drawing.' });
      if (m.name !== undefined) {
        const name = String(m.name || '').trim();
        if (name.length < 1 || name.length > 30) return send(ws, { type: 'error', message: 'Custom items need a name of 1-30 characters.' });
        def.name = name;
      }
      if (m.icon !== undefined) {
        if (!CUSTOM_ICONS.includes(m.icon)) return send(ws, { type: 'error', message: 'That icon is not allowed for custom items.' });
        def.icon = m.icon;
      }
      // Only the fields relevant to the def's kind can change; every
      // copy in the world shares this one def, so the edit re-tunes
      // them all at once (the intended design).
      if (def.kind === 'weapon') {
        if (m.accBonus !== undefined && Number.isFinite(+m.accBonus)) def.accBonus = Math.round(Math.max(0, Math.min(0.50, +m.accBonus)) * 100) / 100;
        if (m.maxBonus !== undefined && Number.isFinite(+m.maxBonus)) def.maxBonus = Math.round(Math.max(0, Math.min(30, +m.maxBonus)));
      }
      if (def.kind === 'armour') {
        if (m.reduction !== undefined && Number.isFinite(+m.reduction)) def.reduction = Math.round(Math.max(0, Math.min(0.45, +m.reduction)) * 100) / 100;
      }
      // Stage 8: color / art apply only when the message carries the
      // field — an absent field keeps the existing value, art sent
      // as '' clears the drawing, and an invalid color clears the
      // tint (customColorFrom / customArtFrom hold the rules).
      def.color = customColorFrom(m, def.color || null);
      def.art = artIn.value;
      // The def lives on its creator's profile — save THAT profile.
      const ownerKey = customOwner.get(def.id);
      if (ownerKey && db.users[ownerKey]) save(ownerKey);
      broadcast({ type: 'catalog', items: catalogList(), shops: SHOPS });
      send(ws, { type: 'admin_note', text: `Edited custom item #${def.num}: ${def.name}.` });
      return send(ws, { type: 'custom_edited', item: customCatalogEntry(def) });
    }
    if (m.type === 'ref_lists') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      // Items: base catalog in definition order (num = 1-based
      // position), then every custom in number order.
      const items = Object.keys(ITEMS).map((id, i) => ({ num: i + 1, id, name: ITEMS[id].name, kind: ITEMS[id].kind }));
      for (const def of [...customItems.values()].sort((a, b) => (a.num || 0) - (b.num || 0))) {
        items.push({ num: def.num, id: def.id, name: def.name, kind: def.kind, custom: true, color: def.color || null, art: def.art || null }); // Stage 8: tint + drawn art
      }
      // NPCs: only what the server really defines — the one shared
      // goblin def behind the six Goblin Camp spawns, the six
      // Barrows brothers, the Fight Caves monster table (the small
      // Tz-Kek is its own def), and the Tree Guardian allies.
      const npcs = [];
      const addNpc = (npcName, area) => npcs.push({ num: npcs.length + 1, name: npcName, area });
      addNpc(GOBLIN_DEF.name, 'goblins');
      for (const b of Object.values(BARROWS_BROTHERS)) addNpc(b.name, 'barrows');
      for (const [kind, d] of Object.entries(FC_DEFS)) addNpc(kind === 'tzkek_small' ? 'Tz-Kek (small)' : d.name, 'fightcaves');
      addNpc('Tree Guardian', 'anywhere');
      addNpc('Oak Guardian', 'anywhere');
      const objects = PROP_DEFS.map((p, i) => ({ num: i + 1, kind: p.kind, label: p.label, icon: p.icon }));
      return send(ws, { type: 'ref_lists', items, npcs, objects });
    }
    if (m.type === 'place_object') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const pd = PROP_DEFS.find((p) => p.kind === String(m.kind || ''));
      if (!pd) return send(ws, { type: 'error', message: 'Unknown object kind.' });
      // Coordinates clamp inside my current area (0..1600 x 0..900);
      // a missing/invalid coordinate falls back to where I stand.
      let px = Math.floor(+m.x); if (!Number.isFinite(px)) px = Math.round(me.x);
      let py = Math.floor(+m.y); if (!Number.isFinite(py)) py = Math.round(me.y);
      px = Math.max(0, Math.min(WORLD_W, px));
      py = Math.max(0, Math.min(WORLD_H, py));
      ensureV2(profile);
      const entry = { id: `obj_${++objectSeq}`, area: me.area, kind: pd.kind, x: px, y: py };
      profile.placedObjects.push(entry); // saved on MY profile (see the storage note at the top)
      placedObjectsAll.push({ ...entry, by: profile.username, ownerKey: key });
      save(key);
      broadcastObjects(me.area);
      return send(ws, { type: 'admin_note', text: `Placed a ${pd.label} in the ${AREAS[me.area].name} (${entry.id}).` });
    }
    if (m.type === 'remove_object') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const id = String(m.id || '');
      const idx = placedObjectsAll.findIndex((o) => o.id === id);
      if (idx < 0) return send(ws, { type: 'error', message: 'No such object.' });
      const [obj] = placedObjectsAll.splice(idx, 1);
      // The saved copy lives on its placer's profile — remove + save it there.
      const ownerUser = db.users[obj.ownerKey];
      if (ownerUser) {
        ensureV2(ownerUser.profile);
        ownerUser.profile.placedObjects = ownerUser.profile.placedObjects.filter((o) => o.id !== id);
        save(obj.ownerKey);
      }
      broadcastObjects(obj.area);
      return send(ws, { type: 'admin_note', text: `Removed the placed object ${id}.` });
    }

    // ----- Stage 7B: Talk (whispers) -----
    if (m.type === 'whisper') {
      const text = String(m.text || '').trim().slice(0, 200);
      if (!text) return; // empty whispers are ignored, like empty chat
      const targetName = String(m.to || '').trim();
      const targetKey = userKeyFor(m.to);
      const target = online.get(targetKey);
      if (!target) return send(ws, { type: 'error', message: `${targetName} is not online.` });
      if (targetKey !== key) send(target.ws, { type: 'whisper', from: profile.username, text });
      // Echo to the sender (with `to`) so their client renders their own line.
      return send(ws, { type: 'whisper', from: profile.username, to: target.profile.username, text });
    }

    // ----- Stage 7B: Examine (read-only; never gold or backpack) -----
    if (m.type === 'examine') {
      const targetName = String(m.target || '').trim();
      const targetKey = userKeyFor(m.target);
      const target = online.get(targetKey);
      if (!target) return send(ws, { type: 'error', message: `${targetName} is not online.` });
      ensureV2(target.profile);
      const levels = levelsOf(target.profile);
      return send(ws, {
        type: 'examine',
        player: {
          username: target.profile.username, role: effectiveRole(target.profile), area: target.area,
          combatLevel: Math.round(combatLevelOf(levels) * 100) / 100,
          totalLevel: SKILLS.reduce((t, s) => t + levels[s], 0),
          wins: target.profile.wins, losses: target.profile.losses, rating: target.profile.rating,
          style: target.profile.style, worn: { ...target.profile.worn }, inDuel: !!target.duelId,
        },
      });
    }

    // ----- Stage 7B: parties (Invite) -----
    if (m.type === 'party_invite') {
      const targetName = String(m.target || '').trim();
      const targetKey = userKeyFor(m.target);
      const target = online.get(targetKey);
      if (!target) return send(ws, { type: 'error', message: `${targetName} is not online.` });
      if (targetKey === key) return send(ws, { type: 'error', message: 'You cannot invite yourself.' });
      const myPartyId = partyOf.get(key);
      if (myPartyId && parties.get(myPartyId) && parties.get(myPartyId).has(targetKey)) {
        return send(ws, { type: 'error', message: `${target.profile.username} is already in your party.` });
      }
      // One pending invite per inviter and per target: stale ones go.
      const staleForTarget = findPartyInviteForTarget(targetKey);
      if (staleForTarget) clearPartyInvite(staleForTarget.inviterKey);
      if (partyInvites.has(key)) clearPartyInvite(key);
      // Not in a party yet: I become a party of one pending the invite.
      if (!partyOf.has(key)) {
        const partyId = crypto.randomBytes(6).toString('hex');
        parties.set(partyId, new Set([key]));
        partyOf.set(key, partyId);
        sendPartyUpdate(key);
        broadcastState();
      }
      const inv = { inviterKey: key, targetKey, expires: Date.now() + 30000, timer: null };
      inv.timer = setTimeout(() => {
        if (!partyInvites.has(key)) return;
        partyInvites.delete(key);
        const inviterSess = online.get(key);
        if (inviterSess) send(inviterSess.ws, { type: 'chat', from: 'Game', text: `Your party invite to ${targetName} expired.` });
        dissolveSoloParty(key);
      }, 30000);
      if (inv.timer.unref) inv.timer.unref();
      partyInvites.set(key, inv);
      return send(target.ws, { type: 'party_invite', from: profile.username });
    }
    if (m.type === 'party_reply') {
      const inv = findPartyInviteForTarget(key);
      if (!inv) return send(ws, { type: 'error', message: 'No party invite is pending.' });
      if (inv.expires < Date.now()) {
        clearPartyInvite(inv.inviterKey);
        dissolveSoloParty(inv.inviterKey);
        return send(ws, { type: 'error', message: 'That party invite has expired.' });
      }
      const inviterKey = inv.inviterKey;
      clearPartyInvite(inviterKey);
      const inviter = online.get(inviterKey);
      if (m.accept !== true) {
        if (inviter) send(inviter.ws, { type: 'chat', from: 'Game', text: `${profile.username} declined your party invite.` });
        dissolveSoloParty(inviterKey);
        return;
      }
      if (!inviter) return send(ws, { type: 'error', message: 'That party invite has expired.' });
      // Joining from a different party: leave that one first.
      const myPartyId = partyOf.get(key);
      if (myPartyId && myPartyId !== partyOf.get(inviterKey)) leaveParty(key);
      let partyId = partyOf.get(inviterKey);
      if (!partyId) {
        partyId = crypto.randomBytes(6).toString('hex');
        parties.set(partyId, new Set([inviterKey]));
        partyOf.set(inviterKey, partyId);
      }
      const set = parties.get(partyId);
      set.add(key);
      partyOf.set(key, partyId);
      for (const mk of [...set]) {
        sendPartyUpdate(mk);
        partyChat(mk, `${profile.username} joined the party.`);
      }
      broadcastState();
      return;
    }
    if (m.type === 'party_leave') {
      if (!partyOf.has(key)) return send(ws, { type: 'error', message: 'You are not in a party.' });
      leaveParty(key);
      return;
    }

    // ----- Stage 7B: trades -----
    if (m.type === 'trade_request') {
      const targetKey = userKeyFor(m.target);
      const target = online.get(targetKey);
      if (!target || targetKey === key) return send(ws, { type: 'error', message: 'Pick another online player.' });
      if (me.duelId || target.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (me.npcFightId || target.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
      if (me.barrowsFightId || target.barrowsFightId) return send(ws, { type: 'error', message: 'One of you is fighting a Barrows brother.' });
      if (me.fcRunId || target.fcRunId) return send(ws, { type: 'error', message: 'One of you is in the Fight Caves.' });
      if (activeTradeForKey(key) || activeTradeForKey(targetKey)) return send(ws, { type: 'error', message: 'One of you is already in a trade.' });
      if (pendingTradeForKey(key) || pendingTradeForKey(targetKey)) return send(ws, { type: 'error', message: 'A trade request is already pending for one of you.' });
      const id = crypto.randomBytes(6).toString('hex');
      const req = { id, fromKey: key, toKey: targetKey, expires: Date.now() + 30000, timer: null };
      req.timer = setTimeout(() => {
        if (!tradeRequests.has(id)) return;
        tradeRequests.delete(id);
        const fromSess = online.get(key);
        if (fromSess) send(fromSess.ws, { type: 'chat', from: 'Game', text: `Your trade request to ${target.profile.username} expired.` });
      }, 30000);
      if (req.timer.unref) req.timer.unref();
      tradeRequests.set(id, req);
      send(target.ws, { type: 'trade_incoming', from: profile.username, tradeId: id });
      return send(ws, { type: 'chat', from: 'Game', text: `Trade request sent to ${target.profile.username}.` });
    }
    if (m.type === 'trade_response') {
      const req = tradeRequests.get(String(m.tradeId || ''));
      if (!req || req.toKey !== key || req.expires < Date.now()) {
        if (req) { clearTimeout(req.timer); tradeRequests.delete(req.id); }
        return send(ws, { type: 'error', message: 'That trade request is gone.' });
      }
      clearTimeout(req.timer);
      tradeRequests.delete(req.id);
      const fromSess = online.get(req.fromKey);
      if (m.accept !== true) {
        if (fromSess) send(fromSess.ws, { type: 'chat', from: 'Game', text: `${profile.username} declined your trade request.` });
        return;
      }
      if (!fromSess) return send(ws, { type: 'error', message: 'That trade request is gone.' });
      // Re-check busy state at accept time, like challenge_response.
      if (me.duelId || fromSess.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (activeTradeForKey(key) || activeTradeForKey(req.fromKey)) return send(ws, { type: 'error', message: 'One of you is already in a trade.' });
      const trade = {
        id: req.id, aKey: req.fromKey, bKey: key,
        offers: { [req.fromKey]: { gold: 0, items: [] }, [key]: { gold: 0, items: [] } },
        confirmed: { [req.fromKey]: false, [key]: false },
        expires: Date.now() + 120000, timer: null,
      };
      trade.timer = setTimeout(() => { if (trades.has(trade.id)) cancelTrade(trade, 'Trade timed out.'); }, 120000);
      if (trade.timer.unref) trade.timer.unref();
      trades.set(trade.id, trade);
      send(fromSess.ws, { type: 'trade_open', tradeId: trade.id, with: profile.username });
      return send(ws, { type: 'trade_open', tradeId: trade.id, with: fromSess.profile.username });
    }
    if (m.type === 'trade_offer') {
      const trade = trades.get(String(m.tradeId || ''));
      if (!trade || (trade.aKey !== key && trade.bKey !== key)) return send(ws, { type: 'error', message: 'That trade is gone.' });
      const gold = m.gold === undefined ? 0 : +m.gold;
      if (!Number.isFinite(gold) || gold < 0 || Math.floor(gold) !== gold) return send(ws, { type: 'error', message: 'Invalid gold amount.' });
      if (gold > profile.gold) return send(ws, { type: 'error', message: 'You don\'t have that much gold.' });
      const rawItems = m.items === undefined ? [] : m.items;
      if (!Array.isArray(rawItems)) return send(ws, { type: 'error', message: 'Invalid items.' });
      const merged = new Map();
      for (const e of rawItems.slice(0, 28)) {
        const item = String((e && e.item) || '');
        const qty = Math.floor(+(e && e.qty) || 0);
        if (!itemDef(item)) return send(ws, { type: 'error', message: 'Unknown item.' }); // Stage 7D: customs are tradeable
        if (itemDef(item).kind === 'note') return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
        if (qty < 1) return send(ws, { type: 'error', message: 'Invalid item quantity.' });
        merged.set(item, (merged.get(item) || 0) + qty);
      }
      const items = [...merged.entries()].map(([item, qty]) => ({ item, qty }));
      if (!hasItems(profile, items)) return send(ws, { type: 'error', message: 'You don\'t have all the items you tried to offer.' });
      trade.offers[key] = { gold, items };
      // Anti-scam: any offer change un-confirms BOTH sides.
      trade.confirmed[trade.aKey] = false;
      trade.confirmed[trade.bKey] = false;
      return sendTradeUpdate(trade);
    }
    if (m.type === 'trade_confirm') {
      const trade = trades.get(String(m.tradeId || ''));
      if (!trade || (trade.aKey !== key && trade.bKey !== key)) return send(ws, { type: 'error', message: 'That trade is gone.' });
      trade.confirmed[key] = true;
      sendTradeUpdate(trade);
      if (trade.confirmed[trade.aKey] && trade.confirmed[trade.bKey]) executeTrade(trade);
      return;
    }
    if (m.type === 'trade_cancel') {
      const trade = trades.get(String(m.tradeId || ''));
      if (!trade || (trade.aKey !== key && trade.bKey !== key)) return send(ws, { type: 'error', message: 'That trade is gone.' });
      cancelTrade(trade, 'Trade cancelled.');
      return;
    }

    // ----- Challenges & duels -----
    if (m.type === 'challenge') {
      const targetKey = String(m.target || '').toLowerCase();
      const stake = Math.floor(+m.stake || 0);
      const items = sanitizeItems(m.items);
      if (items.some((s) => s.item === 'note')) return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
      const target = online.get(targetKey);
      if (!target || targetKey === key) return send(ws, { type: 'error', message: 'Pick another online player.' });
      if (me.duelId || target.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (me.npcFightId || target.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
      if (me.barrowsFightId || target.barrowsFightId) return send(ws, { type: 'error', message: 'One of you is fighting a Barrows brother.' });
      if (me.fcRunId || target.fcRunId) return send(ws, { type: 'error', message: 'One of you is in the Fight Caves.' });
      if (items.length === 0 && stake < 1) return send(ws, { type: 'error', message: 'Stake at least 1g, or stake items.' });
      if (stake < 0 || stake > profile.gold || stake > target.profile.gold) return send(ws, { type: 'error', message: 'Gold stake must be up to what you both have.' });
      if (!hasItems(profile, items)) return send(ws, { type: 'error', message: 'You don\'t have all the items you tried to stake.' });
      const id = crypto.randomBytes(6).toString('hex');
      challenges.set(id, { from: key, to: targetKey, stake, items, expires: Date.now() + 30000 });
      send(target.ws, { type: 'challenge_incoming', challengeId: id, from: profile.username, stake, items, seconds: 30 });
      broadcastChallenging(key, targetKey); // Stage 7C: '!' over the challenger
      send(ws, { type: 'chat', from: 'Game', text: `Challenge sent to ${target.profile.username} for ${stake}g${items.length ? ' + items' : ''}.` });
    }
    if (m.type === 'challenge_response') {
      const ch = challenges.get(m.challengeId);
      if (!ch || ch.to !== key || ch.expires < Date.now()) { if (ch) broadcastChallengeClear(ch.from); challenges.delete(m.challengeId); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      challenges.delete(m.challengeId);
      broadcastChallengeClear(ch.from); // Stage 7C: answered — the '!' comes down
      const fromP = online.get(ch.from);
      if (!fromP) return;
      if (!m.accept) { send(fromP.ws, { type: 'chat', from: 'Game', text: `${profile.username} declined. No gold or items were taken.` }); return; }
      if (me.npcFightId || fromP.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
      if (me.barrowsFightId || fromP.barrowsFightId) return send(ws, { type: 'error', message: 'One of you is fighting a Barrows brother.' });
      if (me.fcRunId || fromP.fcRunId) return send(ws, { type: 'error', message: 'One of you is in the Fight Caves.' });
      const myItems = sanitizeItems(m.items);
      if (myItems.some((s) => s.item === 'note')) return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
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
    if (me && me.barrowsFightId) {
      const f = barrowsFights.get(me.barrowsFightId);
      if (f) finishBarrowsFight(f, 'disconnect'); // the run's banked kills are saved state — they stay
    }
    if (me && me.fcRunId) {
      const r = fcRuns.get(me.fcRunId);
      if (r) endFcRun(r, 'disconnect'); // records settle silently; the run is gone
    }
    // Stage 7C: pending challenges involving the leaver die with
    // them — clear the challenger's '!' marker either way.
    for (const [cid, ch] of [...challenges]) {
      if (ch.from === key || ch.to === key) { challenges.delete(cid); broadcastChallengeClear(ch.from); }
    }
    // Stage 7A: pending official-fight offers and certificate
    // requests involving the leaver are cancelled (nothing is spent).
    for (const [oid, o] of [...fightOffers]) {
      if (o.runnerKey === key || o.aKey === key || o.bKey === key) {
        clearTimeout(o.timer); fightOffers.delete(oid);
        for (const otherKey of [o.runnerKey, o.aKey, o.bKey]) {
          if (otherKey === key) continue;
          const s = online.get(otherKey);
          if (s) send(s.ws, { type: 'chat', from: 'Game', text: 'The official fight offer was cancelled — a player left.' });
        }
      }
    }
    certRequests.delete(key);
    // Stage 9: signed notes an admin was holding when they left go
    // back to their signers (item + text) — a note is never lost
    // because its admin logged off. Notes the leaver gave away stay
    // pending: their signer is settled from the saved profile.
    for (const [nid, r] of [...noteRequests]) {
      if (r.toKey === key) {
        noteRequests.delete(nid);
        returnSignedNote(r, '📝 The admin left, so your signed Note was returned to you.');
      }
    }
    // Stage 7B: leaving removes you from your party (remaining
    // members are notified and refreshed; a party under 2 dissolves),
    // clears pending party invites involving you, cancels any active
    // trade (the other side is notified) and clears pending trade
    // requests involving you.
    clearPartyInvitesInvolving(key);
    if (partyOf.has(key)) leaveParty(key);
    const myTrade = activeTradeForKey(key);
    if (myTrade) cancelTrade(myTrade, 'Trade cancelled — the other player left.');
    clearTradeRequestsInvolving(key);
    // Stage 6: a Tree Guardian is session-only — it goes when you do.
    if (allies.has(key)) { const ally = allies.get(key); allies.delete(key); broadcastAllies(ally.area); }
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
  // Stage 7D: aggregate every user's custom item definitions and
  // placed objects into the runtime registries BEFORE anyone can
  // connect, so the first login's catalog and item validation
  // already know every custom id.
  buildStage7DRegistry();
  const mode = process.env.DATABASE_URL ? 'Postgres database' : 'local file (test mode)';
  server.listen(PORT, () => console.log(`nallystake-online listening on :${PORT} (gold-only, saving: ${mode})`));
}).catch((e) => { console.error('Could not open the saving database:', e.message); process.exit(1); });
