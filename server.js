// nallystake-online — Phase 1 + Phase 2 multiplayer server (gold-only, no real money)
// Built-in Node HTTP for the test client + `ws` for real-time play.
// The SERVER is authoritative: it holds gold, holds stakes in escrow,
// rolls every hit on the 0.6s tick, and saves every profile. Clients
// can ask — they cannot decide outcomes. That is what stops cheating.
//
// Phase 2 adds (all server-side, all saved per player): backpack / worn /
// bank item state, an item catalog with 4 shops, tap-to-wear equipping,
// consumables, Dragon Slash specials, item staking, the Bank of Gielinor,
// a drifting Gold Exchange, and OSRS Protect prayers (toggle/drain/badge).
// (Stage 16 later made gold itself a bankable coin-stack item — see
// ITEMS.gold and the gold helpers.)
//
// Stage 1 (catch-up) adds: the skills foundation (13 skills on the real
// OSRS XP curve, total level + OSRS combat level, saved per player), the
// areas framework (plaza + Goblin Camp, per-area player snapshots), and
// server-run NPC combat vs goblins (drops: gold, ranarr herbs, prayer
// potions). Prayer rule (Stage 27, Derek's "Everything" decision):
// Deflect prayers stop matching NPC hits entirely and bounce a
// quarter of the rolled damage back onto the attacker; in PvP duels
// they pray off 40% and deflect a quarter of that back (the Stage 1
// rule — Protect fully blocks NPCs, duels ignore prayers — is
// superseded; see the Stage 27 header note).
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
//
// Stage 27 SUPERSEDES the Stage 10 style table and the Stage 1
// prayer rule, on Derek's explicit "Everything" decision (match the
// app / Muse-artifact version's combat rules, trade-offs shown):
//   - Prayers are now DEFLECT prayers (Deflect from Melee / Missiles
//     / Magic — same 'melee'/'missiles'/'magic' values on the wire).
//     Against MONSTERS a matching prayer still stops the whole hit,
//     and a quarter of the rolled damage (max(1, ceil(dmg x 0.25)))
//     bounces back onto the attacker — it can kill, Jad included,
//     and awards no XP. Against PLAYERS (duels, mod duels, casts)
//     the app's PvP rule applies instead: 40% of the rolled hit is
//     prayed off (round(dmg x 0.4)) and a quarter of that blocked
//     part (max(1, round(blocked x 0.25))) deflects back onto the
//     attacker; the rest gets through. The old "duel prayers do
//     nothing" rule is gone. See pvpDeflect / monsterDeflect.
//   - Styles are the app version's again: the same base boosts
//     (Accurate +3 Attack, Aggressive +3 Strength, Defensive +3
//     Defence LEVEL — new: it feeds the defence roll, Controlled
//     +1/+1/+1) PLUS the proc boosts Stage 10 removed: Accurate 25%
//     bonus extra hit, Aggressive 25% power hit, Defensive 25% full
//     block; Controlled rolls all three at 12%. See STYLES /
//     boostChance. Casts (the magic branch) do NOT proc — the app's
//     casts never did — but a cast can be Deflect-prayed and CAN be
//     stopped by the defender's Defensive proc, as Stage 19 built.
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
  ITEMS[`${tier}_sword`] = { name: `${cap(tier)} sword`, kind: 'weapon', slot: 'weapon', style: 'melee', tier, buy, accBonus, maxBonus, shop: 'Weapon' };
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
// Stage 21: party hats — Derek's design. One per metal tier, in that
// tier's colour, prices doubling from Bronze 500,000g to Dragon
// 32,000,000g. Pure flex: kind 'armour' in the head slot with
// reduction 0 (no combat stats — and armourReduction only counts
// reduction > 0 pieces toward the full-set bonus, so a hat never
// completes a set). `color` is Derek's metal palette (the same tint
// field Stage 8 put on the catalog for custom items): the client
// renders the hat's face on a chip of this colour in the backpack,
// the Armour shop, the Worn panel / gear figure and drop-pile
// labels. Sold at the Armour shop; standard 60% sell-back applies.
for (const [tier, buy, color] of [
  ['bronze', 500000, '#8a5a2b'], // brown
  ['iron', 1000000, '#7f7f7f'], // grey
  ['steel', 2000000, '#b9bfc7'], // lighter grey
  ['mithril', 4000000, '#6a5fd8'], // purple / blue-purple
  ['adamant', 8000000, '#3a9e4f'], // green
  ['rune', 16000000, '#4a90d9'], // blue
  ['dragon', 32000000, '#c22f2f'], // red
]) {
  ITEMS[`${tier}_partyhat`] = { name: `${cap(tier)} party hat`, kind: 'armour', slot: 'head', tier, color, buy, reduction: 0, shop: 'Armour' };
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
        ITEMS[id] = { name, kind: 'weapon', slot: 'weapon', style: 'melee', sellOnly, accBonus: Math.round((st.acc + 0.01 * u) * 100) / 100, maxBonus: st.max + u, smithMetal: metal, smithUpgrade: u, smithBase: baseId };
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
// Stage 19: two of the Barrows weapons were never melee — Ahrim's
// staff casts spells and Karil's crossbow shoots (arrows, in this
// port — there is no separate bolt item).
ITEMS.ahrims_staff.style = 'magic';
ITEMS.karils_crossbow.style = 'ranged';
// Stage 28: the Barrows ARMOUR pieces, ported from the app version's
// drop table (its kind:"barrows" gear — the whole brother-piece pool
// there is these seven; the six weapons above stay in the table
// too). Stat mapping from the app's fields: its `block` fraction is
// the online `reduction`; its `acc` points are the online accBonus
// fraction at the same x40 scale weaponAccPoints uses (acc 5 ->
// 0.125, acc 8 -> 0.20 — and gear accuracy now counts from armour
// slots too, see weaponAccPoints); its `hit` is maxBonus (counted
// from armour now too, see maxHit). Loot-only like the weapons:
// no `buy`; shops buy back at the same 800g sellOnly floor. The
// app's examine texts ride along as `desc` (its "Never sold" means
// shops never sell them — true here too: they are never stocked).
const BARROWS_ARMOUR_PIECES = ['dharoks_helm', 'ahrims_hood', 'karils_coif', 'karils_top', 'guthans_chainskirt', 'karils_leatherskirt', 'karils_boots'];
// Stage 28b (Derek's rules, ported from the app version's current
// implementation): the Barrows TIER armour line — decayed, mossy,
// ghost-green namesakes of the nine metal tiers (Barrows Bronze ->
// Barrows Necro), head/body/legs/boots per tier, 36 pieces, from
// the Barrows chest ONLY (never sold: sellOnly 0, like the fire
// cape). The grant rules live in barrowsTierGrant / rollBarrowsLoot:
// all six brothers killed that run, a single 1-in-20 roll, at most
// one piece per chest, and the tier ladder is EARNED — the next
// tier up only drops while you WEAR the full set of the tier below.
// Stat mapping is the same as the brother pieces: the app's block
// is `reduction`, its acc points are accBonus at the x40 scale, its
// hit is maxBonus. The app's examine texts ride as `desc` (its
// platebodies carry no desc there; online composes theirs from the
// same formula its helms/legs/boots use, so every tier piece reads
// its gate in-game).
const BARROWS_TIER_NAMES = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune', 'Dragon', 'Torva', 'Necro'];
const BARROWS_TIER_SLUG = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune', 'dragon', 'torva', 'necro'];
const BARROWS_TIER_COLORS = ['#6e5a35', '#5f6b5e', '#8b968c', '#3f6b8a', '#2e7d46', '#2c4a7c', '#8e2f24', '#a8bfb2', '#4a2470'];
const BARROWS_TIER_SUFFIX = { helm: 'Helm', platebody: 'Platebody', platelegs: 'Platelegs', boots: 'Boots' };
const BARROWS_TIER_SLOT = { helm: 'head', platebody: 'body', platelegs: 'legs', boots: 'feet' };
const BARROWS_TIER_ICON = { helm: '🪖', platebody: '🛡️', platelegs: '🦵', boots: '🥾' };
const BARROWS_TIER_STATS = {
  platebody: { block: [0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.32, 0.36, 0.40] },
  helm: { block: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09], hit: [0, 0, 0, 0, 0, 0, 1, 1, 2] },
  platelegs: { block: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09] },
  boots: { block: [0.01, 0.02, 0.03, 0.03, 0.04, 0.05, 0.05, 0.06, 0.07], acc: [0, 0, 0, 1, 1, 1, 2, 2, 3] },
};
const BARROWS_TIER_FLAVOUR = {
  helm: ['a moss-eaten bronze helm, ghost-green mist curling off it', 'a rusted iron helm furred with grave moss', 'pale steel gone grey-green in the damp dark', "mithril's blue drowned to a ghostly teal", 'adamant green deepened to grave moss', 'dark rune blue with a necrotic green sheen', 'dragon red rusted dark, horns intact', 'pale Torva steel veiled in ghost mist, ice crystals gone green', 'Necro purple, spiked and lightless, the deepest prize in the chest'],
  platebody: ['a moss-eaten bronze platebody, ghost-green mist curling off it', 'a rusted iron platebody furred with grave moss', 'a pale steel platebody gone grey-green in the damp dark', 'a mithril platebody drowned to a ghostly teal', 'an adamant platebody deepened to grave moss', 'a dark rune-blue platebody with a necrotic green sheen', 'a dragon platebody rusted dark', 'a pale Torva platebody veiled in ghost mist', 'a Necro purple platebody, spiked and lightless'],
  platelegs: ['moss-eaten bronze platelegs', 'rusted iron platelegs furred with grave moss', 'pale steel platelegs gone grey-green', 'mithril platelegs drowned to a ghostly teal', 'adamant platelegs deepened to grave moss', 'dark rune-blue platelegs with a necrotic sheen', 'dragon platelegs rusted dark', 'pale Torva platelegs veiled in ghost mist', 'Necro purple platelegs, spiked and lightless'],
  boots: ['moss-eaten bronze boots', 'rusted iron boots furred with grave moss', 'pale steel boots gone grey-green', 'mithril boots drowned to a ghostly teal', 'adamant boots deepened to grave moss', 'dark rune-blue boots with a necrotic sheen', 'dragon boots rusted dark', 'pale Torva boots veiled in ghost mist', 'Necro purple boots, spiked and lightless'],
};
const BARROWS_TIER_PIECES = [];
for (const sfx of ['helm', 'platebody', 'platelegs', 'boots']) {
  for (let t = 0; t < 9; t += 1) {
    const id = `barrows_${BARROWS_TIER_SLUG[t]}_${sfx}`;
    BARROWS_TIER_PIECES.push(id);
    const st = BARROWS_TIER_STATS[sfx];
    const gate = t === 0 ? "the chest's 1-in-20 prize on a 6/6 clear." : `drops only while you wear the full Barrows ${BARROWS_TIER_NAMES[t - 1]} set.`;
    ITEMS[id] = {
      name: `Barrows ${BARROWS_TIER_NAMES[t]} ${BARROWS_TIER_SUFFIX[sfx]}`, icon: BARROWS_TIER_ICON[sfx], kind: 'armour',
      slot: BARROWS_TIER_SLOT[sfx], sellOnly: 0, color: BARROWS_TIER_COLORS[t],
      accBonus: (st.acc ? st.acc[t] : 0) / 40, maxBonus: st.hit ? st.hit[t] : 0, reduction: st.block[t],
      desc: `Decayed Barrows armour — ${BARROWS_TIER_FLAVOUR[sfx][t]}. Barrows tier ${t + 1} of 9: ${gate}`,
    };
  }
}
// Wearing the FULL set (helm, platebody, platelegs, boots) of tier t?
function wearingBarrowsTierSet(profile, t) {
  return ['helm', 'platebody', 'platelegs', 'boots'].every((sfx) => profile.worn && profile.worn[BARROWS_TIER_SLOT[sfx]] === `barrows_${BARROWS_TIER_SLUG[t]}_${sfx}`);
}
// The app's grantBarrowsTierPiece: eligibility climbs one rung at a
// time — tier t is eligible only while the full set of tier t-1 is
// WORN (Bronze, the entry tier, asks for nothing; the chain must be
// unbroken). The piece is chosen from the eligible tier's pieces
// not yet earned — online, "earned" is the collection log (a tier
// piece enters it the moment it is granted, like the weapons).
// Returns null when the whole eligible tier is already earned (the
// caller pays 1200 coins instead, the app's fallback).
function barrowsTierGrant(profile) {
  let elig = 0;
  for (let t = 1; t < 9; t += 1) { if (wearingBarrowsTierSet(profile, t - 1)) elig = t; else break; }
  const earned = profile.clog || {}; // the saved log is an {id: true} map (publicProfile flattens it to an array)
  const candidates = ['helm', 'platebody', 'platelegs', 'boots']
    .map((sfx) => `barrows_${BARROWS_TIER_SLUG[elig]}_${sfx}`)
    .filter((id) => !earned[id]);
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
for (const [id, name, icon, slot, color, accBonus, maxBonus, reduction, desc] of [
  ['dharoks_helm', "Dharok's helm", '🪖', 'head', '#4a4a52', 0, 2, 0.04, "Dharok the Wretched's helm — Barrows loot from the chest at the south gate. Never sold."],
  ['ahrims_hood', "Ahrim's hood", '🧙', 'head', '#6e2a3a', 0.125, 0, 0, "Ahrim the Blighted's hood — Barrows loot from the chest at the south gate. Never sold."],
  ['karils_coif', "Karil's coif", '🪖', 'head', '#3a3f4a', 0.20, 0, 0.04, "Karil the Tainted's spiked coif — the head of the ranged line's Karil's tier. Barrows loot from the chest at the south gate. Never sold."],
  ['karils_top', "Karil's top", '🛡️', 'body', null, 0.20, 0, 0.21, "Karil the Tainted's top — Barrows loot from the chest at the south gate. Never sold."],
  ['guthans_chainskirt', "Guthan's chainskirt", '🦵', 'legs', '#5d7a3a', 0, 0, 0.05, "Guthan the Infested's chainskirt — Barrows loot from the chest at the south gate. Never sold."],
  ['karils_leatherskirt', "Karil's leatherskirt", '🦵', 'legs', '#3a3f4a', 0.20, 0, 0.04, "Karil the Tainted's leatherskirt — the legs of the ranged line's Karil's tier. Barrows loot from the chest at the south gate. Never sold."],
  ['karils_boots', "Karil's boots", '🥾', 'feet', '#3a3f4a', 0.20, 0, 0.04, "Karil the Tainted's boots — the feet of the ranged line's Karil's tier. Barrows loot from the chest at the south gate. Never sold."],
]) {
  ITEMS[id] = { name, icon, kind: 'armour', slot, sellOnly: 800, accBonus, maxBonus, reduction, desc, ...(color ? { color } : {}) };
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
// Stage 16: GOLD IS AN ITEM. Derek: "rework the gold for staking
// and make it an item as well rather than it being stored in a
// 'pouch'." A player's money is a stack of this in their backpack
// and/or bank — kind 'currency': it IS money, so it is never sold
// by shops (no `buy`), never on the Gold Exchange (not in GOODS),
// and sellPrice() is 0 with the shop / Exchange handlers refusing
// it outright. It stacks, banks, drops, pickups and trades like
// any other stack; the duel item-stake picker excludes it (gold
// staking stays the matched amount field — see GOLD_STAKE_MSG).
// profile.gold survives ONLY as a synced mirror of the stack
// total (goldTotal) for the leaderboard and legacy readers — the
// stacks are the single source of truth, and every gold mutation
// routes through addGold / takeGold below.
ITEMS.gold = { name: 'Gold coins', icon: '🪙', kind: 'currency', sellOnly: 0 };
// The ONE refusal every duel item-stake path answers when a client
// tries to stake the gold stack itself as an item.
const GOLD_STAKE_MSG = "Gold can't be staked as an item — use the gold amount.";
// The ONE refusal every path that would move a note off its owner
// (drop, trade offer, duel item stakes) answers with.
const NOTE_PERSONAL_MSG = "A note is personal — it can't be dropped, traded, or staked.";

// ---------- Stage 19: Magic & Ranged supplies (Derek's design) ----------
// Derek, 2026-11-17: "Magic requires runes per spell and range
// requires bow and arrows. ... For magic you need to collect runes
// from killing wizards ... For range you need to fletch them out of
// logs or kill the rangers in the range spot. Rangers drop different
// tier arrow heads that can be used to fletch with logs as well."
// Every weapon def now carries a `style` ('melee' default, 'ranged',
// 'magic') so combat can tell what a wielded weapon does — see
// attackStyleOf / rollStyleAttack in the combat section.
// Runes: kind 'rune'. Never sold in shops (no `buy`); a small fixed
// sell-back (sellOnly 2g) so spares are not worthless. Wizards are
// the supply (see rollNpcDrops).
const RUNE_ICONS = { air: '💨', water: '💧', earth: '🪨', fire: '🔥' };
for (const el of ['air', 'water', 'earth', 'fire']) {
  ITEMS[`${el}_rune`] = { name: `${cap(el)} rune`, icon: RUNE_ICONS[el], kind: 'rune', sellOnly: 2 };
}
// Arrows (kind 'ammo') carry a ranged strength bonus by metal tier;
// they are sold at the Weapon shop AND dropped by rangers AND made
// by fletching. Arrowheads (kind 'arrowhead') are the fletching
// input: rangers drop them; shops buy them back at 3g but never
// sell them (no `buy`).
const ARROW_TIERS = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune'];
const ARROW_STR = { bronze: 2, iron: 4, steel: 6, mithril: 9, adamant: 12, rune: 16 }; // ranged strength bonus per tier
const ARROW_BUY = { bronze: 6, iron: 9, steel: 14, mithril: 22, adamant: 35, rune: 60 }; // Weapon shop price per arrow
const FLETCH_GATE = { bronze: 1, iron: 15, steel: 30, mithril: 45, adamant: 60, rune: 75 }; // Fletching level per tier (Derek's gates)
const FLETCH_XP = { bronze: 10, iron: 16, steel: 24, mithril: 36, adamant: 52, rune: 75 }; // Fletching XP per set of 10 arrows
for (const t of ARROW_TIERS) {
  ITEMS[`${t}_arrow`] = { name: `${cap(t)} arrows`, icon: '🏹', kind: 'ammo', strBonus: ARROW_STR[t], buy: ARROW_BUY[t], shop: 'Weapon' };
  ITEMS[`${t}_arrowhead`] = { name: `${cap(t)} arrowheads`, icon: '🔼', kind: 'arrowhead', sellOnly: 3 };
}
// Bows (style 'ranged') and staves (style 'magic'), Weapon shop.
// Their maxBonus is 0 on purpose: a ranged max hit comes from the
// Ranged level + the arrow's strength bonus, and a magic max hit
// from the spell itself (see rollStyleAttack) — the weapon's job
// is accuracy, rising by tier.
for (const [id, name, buy, accBonus] of [
  ['shortbow', 'Shortbow', 120, 0.04], ['oak_shortbow', 'Oak shortbow', 300, 0.06],
  ['willow_shortbow', 'Willow shortbow', 600, 0.08], ['maple_shortbow', 'Maple shortbow', 1200, 0.10],
  ['yew_shortbow', 'Yew shortbow', 2400, 0.13], ['magic_shortbow', 'Magic shortbow', 4800, 0.16],
]) {
  ITEMS[id] = { name, icon: '🏹', kind: 'weapon', slot: 'weapon', style: 'ranged', buy, accBonus, maxBonus: 0, shop: 'Weapon' };
}
for (const [id, name, buy, accBonus] of [
  ['staff', 'Staff', 150, 0.04], ['magic_staff', 'Magic staff', 700, 0.08], ['mystic_staff', 'Mystic staff', 2500, 0.12],
]) {
  ITEMS[id] = { name, icon: '🪄', kind: 'weapon', slot: 'weapon', style: 'magic', buy, accBonus, maxBonus: 0, shop: 'Weapon' };
}
// The spellbook (Derek: "Magic also comes with a magic book to see
// what runes are required for each spell"). Spell tiers low->high
// are air, water, earth, fire (Derek's order); families are Strike
// (1 rune), Bolt (2) and Blast (3). A spell costs ONLY its own
// element's runes. Max hits are the base spell caps; the caster's
// Magic level scales them modestly (see rollStyleAttack). Magic XP
// per cast: SPELL_CAST_XP by family, plus damage XP like melee.
const SPELLS = [
  { id: 'air_strike', name: 'Air Strike', element: 'air', tier: 'strike', level: 1, runes: 1, max: 6 },
  { id: 'water_strike', name: 'Water Strike', element: 'water', tier: 'strike', level: 5, runes: 1, max: 7 },
  { id: 'earth_strike', name: 'Earth Strike', element: 'earth', tier: 'strike', level: 9, runes: 1, max: 8 },
  { id: 'fire_strike', name: 'Fire Strike', element: 'fire', tier: 'strike', level: 13, runes: 1, max: 9 },
  { id: 'air_bolt', name: 'Air Bolt', element: 'air', tier: 'bolt', level: 17, runes: 2, max: 10 },
  { id: 'water_bolt', name: 'Water Bolt', element: 'water', tier: 'bolt', level: 23, runes: 2, max: 11 },
  { id: 'earth_bolt', name: 'Earth Bolt', element: 'earth', tier: 'bolt', level: 29, runes: 2, max: 12 },
  { id: 'fire_bolt', name: 'Fire Bolt', element: 'fire', tier: 'bolt', level: 35, runes: 2, max: 13 },
  { id: 'air_blast', name: 'Air Blast', element: 'air', tier: 'blast', level: 41, runes: 3, max: 14 },
  { id: 'water_blast', name: 'Water Blast', element: 'water', tier: 'blast', level: 47, runes: 3, max: 15 },
  { id: 'earth_blast', name: 'Earth Blast', element: 'earth', tier: 'blast', level: 53, runes: 3, max: 16 },
  { id: 'fire_blast', name: 'Fire Blast', element: 'fire', tier: 'blast', level: 59, runes: 3, max: 17 },
  // Stage 24: Freeze — Derek's control spell ("a spell that when you
  // use it your opponent is stopping in the spot they are standing
  // for 5 seconds"). Not a damage spell: max hit 0, and a CONNECTED
  // cast (the Stage 19 accuracy roll lands and is not style-blocked)
  // roots the target where it stands for exactly FREEZE_MS. It costs
  // WATER runes — ice is frozen water. Button-cast only (Stage 24
  // Part 2): the spellbook offers no Select for it and set_spell
  // refuses it, because a staff autocasting a 0-damage root every
  // 5 ticks would be a rune-burning loop that never deals damage.
  { id: 'freeze', name: 'Freeze', element: 'water', tier: 'freeze', level: 25, runes: 3, max: 0, icon: '❄️', desc: 'Stops your opponent in the spot they are standing for 5 seconds.' },
];
const SPELL_BY_ID = {};
for (const s of SPELLS) SPELL_BY_ID[s.id] = s;
const SPELL_CAST_XP = { strike: 5, bolt: 10, blast: 15, freeze: 12 }; // flat Magic XP per resolved cast, hit or miss
// Stage 24: how long a connected Freeze roots its target, and the
// personal cooldown between placed-button casts (5 ticks — the same
// cadence as a staff cast; in Fight Caves this applies to button
// casts too, even though FC autocast swings every tick).
const FREEZE_MS = 5000;
const BUTTON_CAST_COOLDOWN_MS = 5 * TICK_MS;
function spellOf(p) { return SPELL_BY_ID[p.spell] || SPELLS[0]; }

// ---------- Stage 20: the rewarding layer ----------
// Starter goals (first steps): five one-time goals, each paying
// STARTER_REWARD gold once via addGold (see completeStarterGoal,
// beside addXp). The ids are the profile.starter.done keys.
const STARTER_GOALS = [
  { id: 'win_duel', label: 'Win a duel' },
  { id: 'kill_monster', label: 'Kill a monster' },
  { id: 'gather', label: 'Gather a resource' },
  { id: 'use_bank', label: 'Use the bank' },
  { id: 'visit_area', label: 'Visit another area' },
];
const STARTER_REWARD = 25;
// Collection log entry ids (56): the six Barrows brothers (their
// BARROWS_BROTHERS ids), the fire cape, the six rare Barrows
// weapons (the BARROWS_WEAPONS item ids), the seven Barrows armour
// pieces, and — Stage 28b — the 36 Barrows tier armour pieces.
// Built from the live tables so it can never drift from them.
function clogEntryIds() {
  return [...Object.keys(BARROWS_BROTHERS), 'fire_cape', ...BARROWS_WEAPONS, ...BARROWS_ARMOUR_PIECES, ...BARROWS_TIER_PIECES];
}

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
    style: def.style || null, strBonus: 0, // Stage 19: a custom cloned from a bow/staff keeps its style
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
  if (def.kind === 'currency') return 0; // Stage 16: gold IS money — it is never sold, it is spent
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
    desc: d.desc || null, // Stage 28: item examine text (the Barrows pieces carry the app's)
    speed: d.speed || 0, // Stage 3: pickaxe speed multiplier (0 for non-tools)
    icon: d.icon || null, // Stage 7A: token icons (null for older items)
    color: d.color || null, // Stage 21: tier tint (party hats) — same field customCatalogEntry emits for Stage 8 customs; null for everything else
    style: d.style || null, // Stage 19: weapon attack style ('melee' / 'ranged' / 'magic')
    strBonus: d.strBonus || 0, // Stage 19: arrow ranged strength bonus
  }));
  // Stage 16: the gold item rides along explicitly (it has no buy
  // price and no sellOnly the filter above would keep): the client
  // needs its name/kind to render the coin stack in backpack/bank.
  // buy 0 / sell 0 / shop null keep it out of every shop list.
  list.push({ id: 'gold', name: ITEMS.gold.name, kind: 'currency', slot: null, shop: null, buy: 0, sell: 0, heal: 0, prayerRestore: 0, accBonus: 0, maxBonus: 0, reduction: 0, speed: 0, icon: ITEMS.gold.icon });
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
  'mining', 'smithing', 'woodcutting', 'firemaking', 'fishing', 'cooking', 'fletching']; // Stage 19 adds fletching (ranged/magic were already here)
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
    // Stage 16: the starter gold IS the backpack coin stack below;
    // the `gold` number above is only its synced mirror (goldTotal).
    backpack: [{ item: 'gold', qty: START_GOLD }], // [{item, qty}] stacks, max BACKPACK_MAX_STACKS distinct
    worn: emptyWorn(),
    bank: [], // [{item, qty}] stacks — gold coins stack here too (Stage 16)
    goldV: 2, // Stage 16: born migrated — money already lives in stacks
    prayerPoints: PRAYER_MAX, prayerMax: PRAYER_MAX, activePrayer: null,
    specialEnergy: 0,
    xp: defaultXp(), // Stage 1 skills — see SKILLS / XP_TABLE above
    fc: { bestWave: 0, attempts: 0, kills: 0, completions: 0, bestTimeMs: 0 }, // Stage 4 Fight Caves records
    // Stage 5 Barrows run state: brothers killed this round, which
    // crypt is the tunnel entrance (null until a run starts), and a
    // looted flag (the round resets the moment the chest is looted,
    // so this is never persisted as true — it completes the shape).
    barrows: { kills: [], tunnel: null, looted: false, puzzleSolved: false },
    barrowsRuns: 0, // Stage 28b: completed Barrows runs (chests looted) — the app's "chests" counter
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
    // Stage 19: the selected spell (an id from SPELLS) — cast from
    // the spellbook whenever a staff is wielded. Default: Air Strike.
    spell: 'air_strike',
    // Stage 9: the texts of the signed Notes this player currently
    // HOLDS, oldest first ([{ text, from, at }] — from is the signer).
    // One entry per held 'note' item, FIFO-matched: signing creates
    // item + entry together, giving a note away removes both, and a
    // declined note returns both.
    notes: [],
    // Stage 20: the rewarding layer. Starter goals: which of the
    // five first-steps goals are done ({ goalId: true }) — each
    // pays STARTER_REWARD gold exactly once (see completeStarterGoal).
    starter: { done: {} },
    // Stage 20: the collection log — entry ids ever earned
    // ({ entryId: true }): the six Barrows brothers, the fire cape
    // and the six rare Barrows weapons (see clogEntryIds).
    clog: {},
    // Stage 22: the mod NPC stake ladder — wins per tier against
    // the three plaza moderators ({ t1, t2, t3 }, each capped at 3:
    // 3 wins in a tier unlock the next). See MOD_NPCS / startModDuel.
    modLadder: { wins: { t1: 0, t2: 0, t3: 0 } },
  };
}
// Migration: Phase 1 accounts gain the v2 fields with defaults. Existing
// rating / record / style are never touched; gold is CONVERTED (never
// changed in amount) by the Stage 16 migration inside ensureV2.
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
  if (!p.barrows || typeof p.barrows !== 'object') { p.barrows = { kills: [], tunnel: null, looted: false, puzzleSolved: false }; changed = true; }
  else {
    if (!Array.isArray(p.barrows.kills)) { p.barrows.kills = []; changed = true; }
    else {
      const clean = [...new Set(p.barrows.kills.filter((k) => BARROWS_BROTHERS[k]))];
      if (clean.length !== p.barrows.kills.length) { p.barrows.kills = clean; changed = true; }
    }
    if (p.barrows.tunnel !== null && !BARROWS_BROTHERS[p.barrows.tunnel]) { p.barrows.tunnel = null; changed = true; }
    if (typeof p.barrows.looted !== 'boolean') { p.barrows.looted = false; changed = true; }
    // Stage 28: a solved puzzle door stays solved for the whole run
    // (the app saves it in the run) — it used to be session-only and
    // reset every time the player climbed out of the tunnels.
    if (typeof p.barrows.puzzleSolved !== 'boolean') { p.barrows.puzzleSolved = false; changed = true; }
  }
  // Stage 28b: the completed-runs counter (chests looted).
  if (typeof p.barrowsRuns !== 'number' || !(p.barrowsRuns >= 0)) { p.barrowsRuns = 0; changed = true; }
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
  // Stage 19 migration: the selected spell. Anything that is not a
  // known spell id falls back to Air Strike (the level-1 default).
  if (typeof p.spell !== 'string' || !SPELL_BY_ID[p.spell]) { p.spell = 'air_strike'; changed = true; }
  // Stage 20 migration: starter goals + collection log. Only the
  // container shapes are enforced; recorded progress is cleaned
  // down to known ids (truthy entries only) and never reset.
  if (!p.starter || typeof p.starter !== 'object' || Array.isArray(p.starter)) { p.starter = { done: {} }; changed = true; }
  if (!p.starter.done || typeof p.starter.done !== 'object' || Array.isArray(p.starter.done)) { p.starter.done = {}; changed = true; }
  else {
    const cleanDone = {};
    for (const g of STARTER_GOALS) if (p.starter.done[g.id]) cleanDone[g.id] = true;
    if (JSON.stringify(cleanDone) !== JSON.stringify(p.starter.done)) { p.starter.done = cleanDone; changed = true; }
  }
  if (!p.clog || typeof p.clog !== 'object' || Array.isArray(p.clog)) { p.clog = {}; changed = true; }
  else {
    const cleanClog = {};
    for (const id of clogEntryIds()) if (p.clog[id]) cleanClog[id] = true;
    if (JSON.stringify(cleanClog) !== JSON.stringify(p.clog)) { p.clog = cleanClog; changed = true; }
  }
  // Stage 22 migration: mod NPC stake-ladder progress. Only the
  // container shape is enforced; recorded wins are clamped to the
  // 0..3 band the ladder stores (3 = tier complete) and never reset.
  if (!p.modLadder || typeof p.modLadder !== 'object' || Array.isArray(p.modLadder)) { p.modLadder = { wins: { t1: 0, t2: 0, t3: 0 } }; changed = true; }
  if (!p.modLadder.wins || typeof p.modLadder.wins !== 'object' || Array.isArray(p.modLadder.wins)) { p.modLadder.wins = { t1: 0, t2: 0, t3: 0 }; changed = true; }
  else {
    for (const t of ['t1', 't2', 't3']) {
      const v = Math.max(0, Math.min(3, Math.floor(+p.modLadder.wins[t] || 0)));
      if (p.modLadder.wins[t] !== v) { p.modLadder.wins[t] = v; changed = true; }
    }
  }
  // Stage 10 migration: character appearance. A missing one is
  // backfilled with the default; a present one is sanitised in
  // place (merged over the default — a set look is never wiped).
  if (!p.appearance || typeof p.appearance !== 'object' || Array.isArray(p.appearance)) { p.appearance = defaultAppearance(); changed = true; }
  else {
    const clean = cleanAppearance(p.appearance, null);
    if (JSON.stringify(clean) !== JSON.stringify(p.appearance)) { p.appearance = clean; changed = true; }
  }
  // Stage 16 migration: gold becomes an ITEM. A legacy profile
  // carries its money ONLY as the `gold` number (the old "pouch").
  // Exactly once (flagged goldV): if that number is positive and
  // the profile holds NO gold stack anywhere, the amount becomes
  // a stack — backpack if a slot is free, else the bank — and the
  // number is re-synced as the mirror of the stack total. A
  // profile that somehow already holds a stack keeps the stack as
  // the truth and only the mirror is re-synced. Idempotent: once
  // goldV is 2 this block never runs again, so a second boot
  // cannot duplicate or move a single coin. Runs on load (the
  // boot sweep) before anyone connects.
  if (typeof p.goldV !== 'number' || !Number.isFinite(p.goldV)) { p.goldV = 1; changed = true; }
  if (p.goldV < 2) {
    const hasStack = stackQty(p.backpack, 'gold') > 0 || stackQty(p.bank, 'gold') > 0;
    const legacy = Math.max(0, Math.floor(+p.gold || 0));
    if (!hasStack && legacy > 0) {
      const leftover = addStacks(p.backpack, 'gold', legacy, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(p.bank, 'gold', leftover); // full pack: the bank holds the coins
    }
    p.goldV = 2; changed = true;
    const total = stackQty(p.backpack, 'gold') + stackQty(p.bank, 'gold');
    if (p.gold !== total) p.gold = total; // the number is now just the mirror
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
    barrows: { kills: [...p.barrows.kills], tunnel: p.barrows.tunnel, looted: p.barrows.looted, puzzleSolved: !!p.barrows.puzzleSolved },
    barrowsRuns: p.barrowsRuns || 0, // Stage 28b
    // Stage 7A: effective role (owner computed) + certification flag.
    role: effectiveRole(p), certified: !!p.certified,
    // Stage 10: character appearance (sanitised on the way in; the
    // spread keeps clients from mutating the stored object).
    appearance: { ...p.appearance },
    // Stage 19: the selected spell id (the client spellbook marks it).
    spell: p.spell || 'air_strike',
    // Stage 20: starter-goal progress (the done map) and the
    // collection log's found entry ids — also pushed as dedicated
    // 'starter' / 'clog' messages on welcome and on every change.
    starter: { done: { ...(p.starter && p.starter.done ? p.starter.done : {}) } },
    clog: clogEntryIds().filter((id) => p.clog && p.clog[id]),
    // Stage 22: mod NPC stake-ladder wins per tier — also pushed as
    // a dedicated 'mod_ladder' message on welcome and on every change.
    modLadder: { wins: { t1: 0, t2: 0, t3: 0, ...((p.modLadder && p.modLadder.wins) || {}) } },
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
// Stage 20: a grant that crosses into a new level also fires the
// level-up fanfare (onLevelUp) — one event per level crossed.
function addXp(key, gains) {
  const u = db.users[key];
  if (!u) return;
  const p = u.profile;
  ensureV2(p);
  let changed = false;
  for (const [skill, amt] of Object.entries(gains)) {
    if (!amt || !(skill in p.xp)) continue;
    const before = levelForXp(p.xp[skill]);
    p.xp[skill] += amt;
    changed = true;
    const after = levelForXp(p.xp[skill]);
    const sess = online.get(key);
    if (sess) send(sess.ws, { type: 'xp', skill, xp: p.xp[skill], level: after });
    for (let lvl = before + 1; lvl <= after; lvl++) onLevelUp(key, skill, lvl);
  }
  if (changed) save(key);
}

// ---------- Stage 20 helpers: announcements, level-ups, starter
// goals, collection log. (Function declarations: the flows above
// and below call them at runtime, after the whole module loads.) ----------
// A game-wide announcement: every online player gets the gold
// banner + chat line (client renders {type:'announce'}).
function announce(text) {
  broadcast({ type: 'announce', text });
}
// What reaching `level` in `skill` unlocks, derived ONLY from the
// requirement tables that already gate the game — node level
// requirements (mining / fishing / woodcutting), the smithing
// tables (smelt recipes + smithable metals), the spellbook and the
// fletching gates. Bows/staves/swords carry no wield level in this
// game, and prayers none either, so those skills simply get null.
function unlockTextFor(skill, level) {
  const parts = [];
  if (skill === 'magic') {
    for (const s of SPELLS) if (s.level === level) parts.push(`You can now cast ${s.name}`);
  }
  if (skill === 'fletching') {
    for (const [tier, gate] of Object.entries(FLETCH_GATE)) if (gate === level) parts.push(`You can now fletch ${cap(tier)} arrows`);
  }
  if (skill === 'smithing') {
    for (const [bar, rec] of Object.entries(BAR_RECIPES)) if (rec.level === level) parts.push(`You can now smelt ${ITEMS[bar].name}`);
    for (const [metal, md] of Object.entries(SMITH_METALS)) if (md.level === level) parts.push(`You can now smith ${cap(metal)} gear`);
  }
  if (skill === 'mining' || skill === 'fishing' || skill === 'woodcutting') {
    const names = [];
    for (const n of NODES.values()) {
      if (n.skill === skill && n.levelReq === level && n.item && !names.includes(n.name)) names.push(n.name);
    }
    if (names.length) {
      if (skill === 'mining') parts.push(`You can now mine ${names.join(' and ')}`);
      else if (skill === 'fishing') parts.push(`You can now fish at the ${names.join(' and the ')}`);
      else parts.push(`You can now chop the ${names.join(' and the ')}`);
    }
  }
  return parts.length ? parts.join(' · ') : null;
}
// The level-up fanfare trigger: the player gets the full
// {type:'level_up'} (banner + fireworks + unlock line on the
// client), everyone else in the same area gets the small
// {type:'player_level_up'} version, and a 99 is announced to the
// whole game.
function onLevelUp(key, skill, level) {
  const u = db.users[key];
  if (!u) return;
  const sess = online.get(key);
  if (sess) {
    send(sess.ws, { type: 'level_up', skill, level, unlock: unlockTextFor(skill, level) });
    for (const [k2, p2] of online) {
      if (k2 !== key && p2.area === sess.area) send(p2.ws, { type: 'player_level_up', username: u.profile.username, skill, level });
    }
  }
  if (level >= 99) announce(`🏆 ${u.profile.username} just reached level 99 ${cap(skill)}!`);
}
function starterMsg(p) {
  ensureV2(p);
  return { type: 'starter', goals: STARTER_GOALS.map((g) => ({ id: g.id, label: g.label, done: !!(p.starter && p.starter.done[g.id]) })) };
}
function clogMsg(p) {
  ensureV2(p);
  const ids = clogEntryIds();
  return { type: 'clog', found: ids.filter((id) => p.clog && p.clog[id]), total: ids.length };
}
// Mark a starter goal done (once only): pays the reward through
// addGold, saves, and pushes the toast + fresh goal state + fresh
// profile to the player if they are online.
function completeStarterGoal(key, goalId) {
  const u = db.users[key];
  if (!u) return;
  const goal = STARTER_GOALS.find((g) => g.id === goalId);
  if (!goal) return;
  const p = u.profile;
  ensureV2(p);
  if (p.starter.done[goalId]) return;
  p.starter.done[goalId] = true;
  addGold(p, STARTER_REWARD);
  save(key);
  const sess = online.get(key);
  if (sess) {
    send(sess.ws, { type: 'starter_done', id: goalId, label: goal.label, reward: STARTER_REWARD });
    send(sess.ws, starterMsg(p));
    sendProfile(key);
  }
}
// Record a collection-log entry (once only) and push the fresh log.
function recordClog(key, entryId) {
  const u = db.users[key];
  if (!u) return;
  if (!clogEntryIds().includes(entryId)) return;
  const p = u.profile;
  ensureV2(p);
  if (p.clog[entryId]) return;
  p.clog[entryId] = true;
  save(key);
  const sess = online.get(key);
  if (sess) send(sess.ws, clogMsg(p));
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

// ---------- Stage 16: gold helpers (the ONLY way gold moves) ----------
// The coin stacks (backpack + bank) are the single source of truth
// for a player's money; profile.gold is a synced MIRROR of their
// total, kept so the leaderboard and legacy readers work unchanged.
// Every gold mutation in the server routes through addGold /
// takeGold — never write profile.gold directly.
function goldTotal(profile) {
  if (!profile) return 0;
  return stackQty(profile.backpack || [], 'gold') + stackQty(profile.bank || [], 'gold');
}
function syncGoldMirror(profile) {
  profile.gold = goldTotal(profile);
  return profile.gold;
}
// Credit gold: top up the backpack stack if one exists, else the
// bank stack if one exists, else open a backpack stack if a slot
// is free, else open the bank stack. Gold can therefore be earned
// with a completely full backpack — it is never silently lost.
function addGold(profile, amt) {
  ensureV2(profile);
  amt = Math.floor(+amt || 0);
  if (amt > 0) {
    if (stackQty(profile.backpack, 'gold') > 0) addStacks(profile.backpack, 'gold', amt);
    else if (stackQty(profile.bank, 'gold') > 0) addStacks(profile.bank, 'gold', amt);
    else {
      const leftover = addStacks(profile.backpack, 'gold', amt, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, 'gold', leftover);
    }
  }
  syncGoldMirror(profile);
}
// Debit gold: backpack stack first, then the bank stack. Returns
// false (and moves nothing) when the total cannot cover it.
function takeGold(profile, amt) {
  ensureV2(profile);
  amt = Math.floor(+amt || 0);
  if (amt <= 0) return true;
  if (goldTotal(profile) < amt) return false;
  let left = amt;
  const inPack = Math.min(left, stackQty(profile.backpack, 'gold'));
  if (inPack > 0) { removeStacks(profile.backpack, 'gold', inPack); left -= inPack; }
  if (left > 0) removeStacks(profile.bank, 'gold', left);
  syncGoldMirror(profile);
  return true;
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
  // Stage 20: skills hiscores — the top 20 accounts by total XP
  // (ties broken by total level, then name for a stable order).
  // Reads the same in-memory db.users the leaderboard reads.
  if (req.method === 'GET' && url.pathname === '/api/hiscores') {
    const rows = Object.values(db.users).map((u) => {
      const p = u.profile;
      ensureV2(p);
      const levels = levelsOf(p);
      return {
        username: p.username,
        totalLevel: SKILLS.reduce((t, s) => t + levels[s], 0),
        totalXp: SKILLS.reduce((t, s) => t + (p.xp[s] || 0), 0),
        combatLevel: Math.round(combatLevelOf(levels) * 100) / 100,
      };
    }).sort((a, b) => (b.totalXp - a.totalXp) || (b.totalLevel - a.totalLevel) || a.username.localeCompare(b.username)).slice(0, 20);
    return json(res, 200, { hiscores: rows });
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
const challenges = new Map(); // id -> { id, from, to, stake, items, itemsTo, rules, freePlay, confirm: {from,to}, expires } (Stage 14/15)
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

// ---------- Stage 17: Stake Board offers (session-only) ----------
// Derek's south-west Stake Board: a player posts a gold bid at the
// sparkling sign, anyone can accept it, both hit Ready (the first
// ready fighter waits in the Waiting Area), and the second Ready
// starts a normal startDuel for the matched stake — the winner
// takes the pot (2x stake). Offers/matches are session-only, like
// challenges: nothing is escrowed until startDuel runs.
const stakeOffers = new Map(); // id -> { id, fromKey, stake, createdAt, status:'open'|'matched', toKey|null, ready:{from,to} }
const STAKE_OFFER_TTL_MS = 10 * 60 * 1000; // open offers expire after 10 minutes
function pruneStakeOffers() {
  const now = Date.now();
  let changed = false;
  for (const [id, o] of [...stakeOffers]) {
    if (o.status === 'open' && now - o.createdAt >= STAKE_OFFER_TTL_MS) { stakeOffers.delete(id); changed = true; }
  }
  return changed;
}
function stakeBoardMsg() {
  pruneStakeOffers();
  return {
    type: 'stake_board',
    offers: [...stakeOffers.values()].filter((o) => o.status === 'open').map((o) => ({
      id: o.id,
      username: db.users[o.fromKey] ? db.users[o.fromKey].profile.username : o.fromKey,
      stake: o.stake, pot: o.stake * 2, ageMs: Date.now() - o.createdAt,
    })),
  };
}
function broadcastStakeBoard() {
  const msg = stakeBoardMsg();
  for (const p of online.values()) send(p.ws, msg);
}
function openStakeOfferForKey(key) {
  for (const o of stakeOffers.values()) if (o.status === 'open' && o.fromKey === key) return o;
  return null;
}
function stakeMatchForKey(key) {
  for (const o of stakeOffers.values()) if (o.status === 'matched' && (o.fromKey === key || o.toKey === key)) return o;
  return null;
}
function stakeBusy(sess) {
  return !!(sess && (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId));
}
function stakeOpponentKey(match, key) { return match.fromKey === key ? match.toKey : match.fromKey; }
function stakeMatchUpdateMsg(match, forKey) {
  const oppKey = stakeOpponentKey(match, forKey);
  const opp = db.users[oppKey];
  return {
    type: 'stake_match_update', matchId: match.id,
    opponent: opp ? opp.profile.username : oppKey, opponentName: opp ? opp.profile.username : oppKey,
    stake: match.stake, pot: match.stake * 2,
    readyMine: forKey === match.fromKey ? match.ready.from : match.ready.to,
    readyOpponent: forKey === match.fromKey ? match.ready.to : match.ready.from,
  };
}
function sendStakeMatchUpdate(match) {
  for (const k of [match.fromKey, match.toKey]) {
    const s = online.get(k);
    if (s) send(s.ws, stakeMatchUpdateMsg(match, k));
  }
}
// Move a session into an area exactly like a travel arrival (area
// message + the per-area state lists the client rebuilds from).
function moveSessionToArea(sess, area, x, y) {
  sess.area = area; sess.x = x; sess.y = y;
  send(sess.ws, { type: 'area', area });
  send(sess.ws, nodesMsg(area));
  send(sess.ws, firesMsg(area));
  send(sess.ws, pilesMsg(area));
  send(sess.ws, alliesMsg(area));
  send(sess.ws, objectsMsg(area));
}
// Cancel a matched stake match before the fight starts: no gold
// ever moves, a party standing in the Waiting Area is returned to
// the plaza spawn, and BOTH parties are told (stake_match_cancelled
// + a chat line). Used by stake_match_cancel, disconnect cleanup,
// the second-Ready validation failure, and startDuel's guard.
function cancelStakeMatch(match, reason) {
  if (!match || match.status !== 'matched') return;
  stakeOffers.delete(match.id);
  for (const k of [match.fromKey, match.toKey]) {
    const s = online.get(k);
    if (!s) continue;
    if (s.area === 'waiting') moveSessionToArea(s, 'plaza', AREAS.plaza.spawn.x, AREAS.plaza.spawn.y);
    send(s.ws, { type: 'stake_match_cancelled', matchId: match.id, reason });
    send(s.ws, { type: 'chat', from: 'Stake Board', text: reason });
  }
  broadcastStakeBoard();
  broadcastState();
}

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

// ---------- Stage 14: duel challenge configuration ----------
// Derek's reference screen: ONE configuration sheet that both
// duelists edit until BOTH confirm — the rules (No Prayer / No
// Potions / No Food / No Special Attacks, and Stage 18's No
// Movement; melee-only is a constant
// of this game, not a toggle), the matched gold stake, and each
// side's item stake. Any terms change resets BOTH confirms (the
// trade flow's rule). The duel — escrow and all — starts only on
// the second confirm, through the existing startDuel path.
const DUEL_RULE_KEYS = ['noPrayer', 'noPotions', 'noFood', 'noSpecial', 'noMovement', 'noMelee', 'noRanged', 'noMagic']; // Stage 19 adds the three style bans
function cleanDuelRules(r) {
  const out = { noPrayer: false, noPotions: false, noFood: false, noSpecial: false, noMovement: false };
  if (r && typeof r === 'object') for (const k of DUEL_RULE_KEYS) out[k] = !!r[k];
  return out;
}
function challengeTermsMsg(ch) {
  const fromU = db.users[ch.from], toU = db.users[ch.to];
  return {
    type: 'challenge_terms', challengeId: ch.id,
    from: fromU ? fromU.profile.username : ch.from,
    to: toU ? toU.profile.username : ch.to,
    stake: ch.stake, items: ch.items, itemsTo: ch.itemsTo,
    rules: ch.rules, freePlay: ch.freePlay, confirm: { from: ch.confirm.from, to: ch.confirm.to },
    seconds: Math.max(0, Math.ceil((ch.expires - Date.now()) / 1000)),
  };
}
function pushChallengeTerms(ch) {
  const msg = challengeTermsMsg(ch);
  const a = online.get(ch.from), b = online.get(ch.to);
  if (a) send(a.ws, msg);
  if (b) send(b.ws, msg);
}
// Applies a terms edit (challenge_update / challenge_confirm) to a
// pending challenge. `items` in m are always the SENDER's own side —
// nobody can edit the other player's stake. Returns an error
// string, or null on success. Any actual change resets both
// confirms: the editor must re-confirm, and so must the other side.
function applyChallengeTerms(ch, senderKey, m) {
  const sender = db.users[senderKey].profile;
  const other = db.users[senderKey === ch.from ? ch.to : ch.from].profile;
  const mine = senderKey === ch.from ? ch.items : ch.itemsTo;
  const theirs = senderKey === ch.from ? ch.itemsTo : ch.items;
  let stake = ch.stake, rules = ch.rules, myItems = mine;
  let freePlay = ch.freePlay;
  if (m.freePlay !== undefined) freePlay = !!m.freePlay;
  if (freePlay) {
    // Stage 15: Free Play coerces the terms — the gold stake is
    // forced to 0 and BOTH item stakes are forced empty, whatever
    // the screen sent. (Flipping Free Play on is itself a terms
    // change: the confirms reset below, like any other change.)
    stake = 0; myItems = [];
  } else {
    if (m.stake !== undefined) {
      stake = Math.floor(+m.stake || 0);
      if (stake < 0 || stake > goldTotal(sender) || stake > goldTotal(other)) return 'Gold stake must be up to what you both have.';
    }
    if (m.items !== undefined) {
      if (Array.isArray(m.items) && m.items.some((e) => e && e.item === 'gold')) return GOLD_STAKE_MSG; // Stage 16: coins stake via the amount
      myItems = sanitizeItems(m.items);
      if (myItems.some((s) => s.item === 'note')) return NOTE_PERSONAL_MSG;
      if (!hasItems(sender, myItems)) return 'You don\'t have all the items you tried to stake.';
    }
  }
  if (m.rules !== undefined) rules = cleanDuelRules(m.rules);
  if (!freePlay && stake < 1 && myItems.length === 0 && theirs.length === 0) return 'Stake at least 1g, or stake items.';
  const changed = stake !== ch.stake
    || freePlay !== ch.freePlay
    || JSON.stringify(rules) !== JSON.stringify(ch.rules)
    || JSON.stringify(myItems) !== JSON.stringify(mine)
    || (freePlay && theirs.length > 0); // coercion also empties the OTHER side's item stake
  if (changed) {
    ch.stake = stake; ch.rules = rules; ch.freePlay = freePlay;
    if (senderKey === ch.from) ch.items = myItems; else ch.itemsTo = myItems;
    if (freePlay) { ch.items = []; ch.itemsTo = []; }
    ch.confirm.from = false; ch.confirm.to = false;
  }
  return null;
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
  // Stage 28: the crypt is ONE room reused for every brother (the
  // app version's structure): entering a mound puts you in the
  // crypt; searching its sarcophagus starts the fight there. The
  // tunnels spawn moved to the entry room of the new maze (the
  // chest is no longer at the spawn — see BARROWS_CHEST).
  barrows_crypt: { name: 'Barrows Crypt', spawn: { x: 800, y: 600 } },
  barrows_tunnels: { name: 'Barrows Tunnels', spawn: { x: 800, y: 800 } },
  arena: { name: 'Duel Arena', spawn: { x: 800, y: 450 } },
  // Stage 17: the Stake Board waiting area — NOT travel-reachable;
  // only the stake-match flow moves players in (stake_ready), and
  // startDuel / a match cancel moves them back out.
  waiting: { name: 'Waiting Area', spawn: { x: 800, y: 450 } },
  // Stage 19: the two hunting grounds. Spawns sit by the south
  // return gate, mirroring the Training Cave.
  magic: { name: 'Wizard Grounds', spawn: { x: 800, y: 720 } },
  range: { name: 'Ranger Camp', spawn: { x: 800, y: 720 } },
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
// ---------- Stage 19 NPCs: Wizards (magic) + Rangers (ranged) ----------
// Same shared-NPC framework as the goblins (own spawn tables, own
// respawns), one hunting ground each. Both attack from range —
// wizards with MAGIC, rangers with MISSILES — on the ranged-NPC
// pattern Karil/Ahrim established in Barrows: they hold their
// ground (they never step toward the player) and swing on a 3-tick
// cadence inside NPC_RANGE. The matching Deflect prayer stops
// them entirely and bounces a quarter of the rolled damage back
// (Magic for wizards, Missiles for rangers) — the npcTick prayer
// check compares attackType, so it just works.
// Tuning (this port's, in line with the goblin/Barrows scale):
// wizard lvl 13, 20 HP, max hit 4; ranger lvl 11, 18 HP, max hit 4;
// both respawn 12s after a kill.
const WIZARD_DEF = { kind: 'wizard', name: 'Wizard', combatLevel: 13, maxHp: 20, maxHit: 4, acc: 0.55, attackType: 'magic', respawnMs: 12000 };
const WIZARD_SPAWNS = [[400, 300], [700, 520], [1000, 300], [1250, 560], [800, 180]];
const RANGER_DEF = { kind: 'ranger', name: 'Ranger', combatLevel: 11, maxHp: 18, maxHit: 4, acc: 0.57, attackType: 'missiles', respawnMs: 12000 };
const RANGER_SPAWNS = [[360, 320], [640, 560], [960, 320], [1240, 560], [800, 700]];
WIZARD_SPAWNS.forEach(([x, y], i) => {
  const id = 'wizard' + (i + 1);
  npcs.set(id, { id, ...WIZARD_DEF, area: 'magic', x, y, spawnX: x, spawnY: y, hp: WIZARD_DEF.maxHp, alive: true, respawnAt: 0, fightId: null });
});
RANGER_SPAWNS.forEach(([x, y], i) => {
  const id = 'ranger' + (i + 1);
  npcs.set(id, { id, ...RANGER_DEF, area: 'range', x, y, spawnX: x, spawnY: y, hp: RANGER_DEF.maxHp, alive: true, respawnAt: 0, fightId: null });
});
// The areas whose live NPC roster rides on npc_state messages.
const NPC_AREAS = ['goblins', 'magic', 'range'];
const npcFights = new Map(); // id -> { id, playerKey, npcId, hpYou, maxHpYou, specialQueued, done, timer, tickCount, nextSwingYou, nextSwingNpc }
// Pseudo-profile so goblins can be the defender in the duel rollHit():
// no style block, no worn gear, no armour reduction.
const NPC_DEFENDER = { style: 'accurate', worn: { weapon: null, shield: null, head: null, body: null, legs: null } };

function npcStateMsg(area) {
  const now = Date.now();
  return {
    type: 'npc_state', area,
    npcs: [...npcs.values()].filter((n) => n.alive && n.area === area).map((n) => ({ id: n.id, kind: n.kind, name: n.name, combatLevel: n.combatLevel, x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp, frozenUntil: (n.frozenUntil && n.frozenUntil > now) ? n.frozenUntil : 0 })), // Stage 24: Freeze root rides the state broadcast like the players'
  };
}
function broadcastNpcState(area) {
  const msg = npcStateMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
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
    wornHead: (p.profile.worn && p.profile.worn.head) || null, // Stage 21: so clients can put a worn party hat on the knight's head
    frozenUntil: (p.frozenUntil && p.frozenUntil > now) ? p.frozenUntil : 0, // Stage 24: Freeze root — clients render the ❄️ state while this is in the future
    role: effectiveRole(p.profile), // Stage 7A
    appearance: p.profile.appearance ? { ...p.profile.appearance } : defaultAppearance(), // Stage 10: how this knight looks
    party: partyListForKey(k), // Stage 7B: member usernames ([] when not in a party)
    // Stage 7C: what this player is visibly doing right now, so other
    // players can tell at a glance. A duel beats a monster fight,
    // which beats a just-used skill (4s window after the action).
    act: (p.duelId || p.modDuelId) ? 'duel'
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
  const validA = offerA.gold <= goldTotal(aProf) && hasItems(aProf, offerA.items);
  const validB = offerB.gold <= goldTotal(bProf) && hasItems(bProf, offerB.items);
  if (!validA || !validB) { cancelTrade(trade, 'The trade fell through — an item or the gold was no longer there.'); return; }
  takeGold(aProf, offerA.gold); takeGold(bProf, offerB.gold);
  for (const s of offerA.items) removeStacks(aProf.backpack, s.item, s.qty);
  for (const s of offerB.items) removeStacks(bProf.backpack, s.item, s.qty);
  addGold(aProf, offerB.gold); addGold(bProf, offerA.gold);
  for (const s of offerB.items) addItemToProfile(aProf, s.item, s.qty);
  for (const s of offerA.items) addItemToProfile(bProf, s.item, s.qty);
  // Stage 16: a gold stack offered AS an item also just moved via
  // the stack paths above — re-sync both mirrors from the stacks.
  syncGoldMirror(aProf); syncGoldMirror(bProf);
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

// Stage 10 built Derek's RuneScape-style rebalance here (an OSRS
// attack roll vs defence roll — two identical fighters land about
// half their swings — with each style a single small effect and the
// Stage 5 procs deleted). Stage 27 replaces the style EFFECTS with
// the app (Muse-artifact) version's, on Derek's explicit
// "Everything" decision: the base boosts stay OSRS-shaped, and the
// procs come back. A combat style is ONE style at a time
// (profile.style is a single value — nothing stacks):
//   accurate   +3 effective Attack level in the accuracy roll.
//   aggressive +3 effective Strength level in the max-hit formula.
//   defensive  +3 effective Defence level in the defence roll.
//   controlled +1 effective Attack, +1 Strength, +1 Defence.
// PLUS the app version's proc boosts, rolled per swing:
//   Accurate   25%: a bonus extra hit of randi(1, ceil(maxHit/2))
//              lands in full as its own damage instance (bonusDmg).
//   Aggressive 25%: a power hit — +randi(2, max(2, round(maxHit x
//              0.75))) stacked onto the swing's rolled damage.
//   Defensive  25%: fully blocks an incoming hit (after prayer).
//   Controlled rolls each of the three at 12% instead.
// (maxHit for the proc bases is the NON-special max, as in the app.)
// The procs live in the roll functions below (melee + ranged
// branches); casts do not proc (the app's casts never did). The
// defender's block chance lives ONLY in boostChance(style,
// 'defensive'): the roll functions read it for player defenders,
// and the NPC / Barrows / Fight Caves ticks read it (via
// styleBlockChance) for monster swings at the player.
const STYLES = {
  accurate:   { atkBoost: 3, strBoost: 0, defBoost: 0 },
  aggressive: { atkBoost: 0, strBoost: 3, defBoost: 0 },
  defensive:  { atkBoost: 0, strBoost: 0, defBoost: 3 },
  controlled: { atkBoost: 1, strBoost: 1, defBoost: 1 },
};
// The app version's boostChance, verbatim in shape: fighting IN a
// style rolls its own boost at 25%; Controlled rolls every boost at
// 12%; any other pairing is 0. `style` is the FIGHTER's style (the
// attacker's for Accurate/Aggressive, the defender's for Defensive),
// `boost` is 'accurate' | 'aggressive' | 'defensive'.
function boostChance(style, boost) {
  if (style === boost) return 0.25;
  if (style === 'controlled') return 0.12;
  return 0;
}
// The chance that `profile`'s fighting style fully blocks one
// incoming hit (the Defensive proc) — the single source the monster
// ticks and the roll functions all read.
function styleBlockChance(profile) {
  return boostChance(profile && profile.style, 'defensive');
}
// Inclusive integer roll, the app version's randi(a, b).
function randiRange(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
// Accurate proc: the bonus extra hit for one connected, unblocked
// swing — randi(1, max(1, ceil(normalMax / 2))) in the app. Returns
// 0 when the proc does not fire. normalMax is the swing's
// non-special max hit.
function procAccurateBonus(attackerProfile, normalMax) {
  if (Math.random() >= boostChance(attackerProfile.style, 'accurate')) return 0;
  return randiRange(1, Math.max(1, Math.ceil(normalMax / 2)));
}
// Aggressive proc: the power-hit bonus stacked onto a landed swing
// — randi(2, max(2, round(normalMax x 0.75))) in the app. Returns 0
// when the proc does not fire.
function procAggressiveBonus(attackerProfile, normalMax) {
  if (Math.random() >= boostChance(attackerProfile.style, 'aggressive')) return 0;
  return randiRange(2, Math.max(2, Math.round(normalMax * 0.75)));
}

// ---------- Stage 27: Deflect prayers (the app version's rules) ----------
// Prayer values on the wire are unchanged ('melee' | 'missiles' |
// 'magic'); only their NAMES (client-side) and their combat effect
// changed: Protect became Deflect. An attack's style maps to the
// prayer that answers it — a 'ranged' attack is answered by the
// 'missiles' prayer; melee and magic answer to themselves.
function prayerForAttackStyle(style) { return style === 'ranged' ? 'missiles' : style; }
// Does `defenderProfile` currently have the Deflect prayer up that
// matches an incoming attack of `attackStyle` (a prayer value:
// 'melee' | 'missiles' | 'magic')? Mirrors the app's prayerDeflect
// gate: the prayer must be active AND the pool non-empty (the drain
// loop nulls the prayer at 0, so this is belt-and-braces).
function deflectUp(defenderProfile, attackStyle) {
  return !!defenderProfile
    && defenderProfile.activePrayer === attackStyle
    && (defenderProfile.prayerPoints || 0) > 0;
}
// The MONSTER rule (the app's prayerDeflect, non-PvP branch): a
// matching Deflect prayer stops the hit ENTIRELY and throws a
// quarter of the rolled damage back at the attacker —
// max(1, ceil(raw x 0.25)). The reflected damage can kill (Jad
// included) and awards no XP. Returns the reflected amount (0 when
// the prayer does not apply). `raw` is the attacker's rolled damage
// before armour.
function monsterDeflect(defenderProfile, attackType, raw) {
  if (!(raw > 0) || !deflectUp(defenderProfile, attackType)) return 0;
  return Math.max(1, Math.ceil(raw * 0.25));
}
// The PvP rule (the app's prayerDeflect pvp branch, used for duel
// rivals and Wilderness PKers there): a matching Deflect prayer
// blocks 40% of the rolled hit — blocked = round(raw x 0.4) — and
// deflects a quarter of the BLOCKED part back at the attacker —
// max(1, round(blocked x 0.25)); the rest gets through. Returns
// { through, deflected } for a rolled damage `raw` (pre-armour, as
// in the app). A hit too small to block a whole point from
// (blocked 0) is not deflected at all.
function pvpDeflect(defenderProfile, attackStyle, raw) {
  if (!(raw > 0) || !deflectUp(defenderProfile, prayerForAttackStyle(attackStyle))) {
    return { through: raw, deflected: 0 };
  }
  const blocked = Math.round(raw * 0.4);
  if (blocked <= 0) return { through: raw, deflected: 0 };
  return { through: raw - blocked, deflected: Math.max(1, Math.round(blocked * 0.25)) };
}
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
  // Stage 28: the reduction SUM now also reads the feet and hands
  // slots (Karil's boots protect from the feet slot, as the app's
  // worn block totals do). The full-set count stays over the
  // original four slots, so existing sets behave exactly as before;
  // no pre-Stage-28 item occupies feet/hands, so the sum is
  // unchanged for every existing piece of gear.
  for (const slot of ['head', 'body', 'legs', 'shield', 'feet', 'hands']) {
    const def = p.worn && p.worn[slot] ? itemDef(p.worn[slot]) : null;
    // Stage 21: only a piece that actually protects (reduction > 0)
    // counts toward the full-set bonus — a cosmetic party hat in the
    // head slot must never complete a set. Every real armour piece
    // has reduction >= 0.03, so existing sets are unchanged.
    if (def && def.kind === 'armour') {
      r += def.reduction || 0;
      if (def.reduction > 0 && ['head', 'body', 'legs', 'shield'].includes(slot)) filled += 1;
    }
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
  // Stage 28: accuracy worn on ARMOUR counts too — the app's gear
  // totals sum acc from every worn piece (Ahrim's hood, Karil's
  // coif/top/skirt/boots all carry it). No pre-Stage-28 armour has
  // an accBonus, so every existing setup rolls exactly as before.
  for (const slot of ['head', 'body', 'legs', 'shield', 'feet', 'hands', 'amulet', 'ring']) {
    const def = p.worn && p.worn[slot] ? itemDef(p.worn[slot]) : null;
    if (def && def.kind === 'armour' && def.accBonus) pts += Math.round(def.accBonus * 40);
  }
  return pts;
}
// Stage 28: max-hit bonus worn on ARMOUR (the app's `hit` field —
// Dharok's helm carries +2). Counted exactly like the weapon's and
// cape's maxBonus in maxHit below; no pre-Stage-28 armour has one.
function armourMaxBonus(p) {
  let b = 0;
  for (const slot of ['head', 'body', 'legs', 'shield', 'feet', 'hands', 'amulet', 'ring']) {
    const def = p.worn && p.worn[slot] ? itemDef(p.worn[slot]) : null;
    if (def && def.kind === 'armour') b += def.maxBonus || 0;
  }
  return b;
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
  const dst = STYLES[defenderProfile.style] || STYLES.accurate;
  const aLv = levelOverride == null ? levelsOf(attackerProfile) : { attack: levelOverride };
  const dLv = levelOverride == null ? levelsOf(defenderProfile) : { defence: levelOverride };
  const atkRoll = (aLv.attack + (s.atkBoost || 0) + 8) * (64 + weaponAccPoints(attackerProfile)) * ACC_BALANCE;
  // Stage 27: the defender's style Defence boost (Defensive +3,
  // Controlled +1) feeds the defence roll — the app's effDef().
  const defRoll = (dLv.defence + (dst.defBoost || 0) + 8) * 64;
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
  max += armourMaxBonus(attackerProfile); // Stage 28: worn armour max-hit bonus (Dharok's helm)
  if (useSpecial) max = Math.floor(max * 1.5); // Dragon Slash
  return max;
}
// One swing, fully resolved: { dmg, connected, outcome, bonusDmg,
// deflected, power }.
// `connected` is the ACCURACY outcome — the swing was on target —
// regardless of the defender's style block or armour: a
// blocked-but-accurate swing still counts as a hit that landed
// (Stage 12's monster unlocks key off it), while a clean miss
// does not. `outcome` is the client-facing clarity
// label: 'hit' when damage got through, 'blocked' when the swing
// connected but was fully stopped (style block, or armour absorbing
// the whole blow), 'miss' when the accuracy roll failed.
// Stage 27 resolution order (the app version's hurtPlayer order):
// accuracy, the rolled damage, the attacker's Aggressive power
// proc stacked on, the defender's Deflect prayer (PvP rule — only
// when the caller passes deflectPvp, i.e. the duel engines), the
// defender's Defensive style proc (a full block of what remains),
// then worn armour. The Accurate proc is a SEPARATE instance: it
// lands in full (no prayer, no armour, no second accuracy roll) as
// `bonusDmg`, kept out of `dmg` so per-swing caps still read off
// `dmg` alone; callers add it to the target's HP and to the XP
// base. `deflected` is the damage the defender's prayer bounced
// back onto the ATTACKER — the caller subtracts it from the
// attacker's HP pool. Neither procs nor deflect award notes: the
// tick messages carry them as fields and the client splats them.
function rollHitDetail(attackerProfile, defenderProfile, useSpecial = false, levelOverride = null, deflectPvp = false) {
  const connected = Math.random() <= hitChance(attackerProfile, defenderProfile, useSpecial, levelOverride);
  if (!connected) return { dmg: 0, connected: false, outcome: 'miss', bonusDmg: 0, deflected: 0, power: false };
  const normalMax = maxHit(attackerProfile, false, levelOverride);
  let raw = 1 + Math.floor(Math.random() * maxHit(attackerProfile, useSpecial, levelOverride));
  // Aggressive proc: a randomly harder hit stacked onto this swing.
  let power = false;
  const powBonus = procAggressiveBonus(attackerProfile, normalMax);
  if (powBonus > 0) { raw += powBonus; power = true; }
  // Deflect (PvP rule) prays off its share BEFORE the style block,
  // exactly as the app's hurtPlayer runs prayer before the boost
  // block — a swing can deflect AND still be style-blocked.
  let deflected = 0;
  if (deflectPvp) {
    const dfl = pvpDeflect(defenderProfile, 'melee', raw);
    raw = dfl.through; deflected = dfl.deflected;
  }
  if (Math.random() < boostChance(defenderProfile.style, 'defensive')) {
    return { dmg: 0, connected: true, outcome: 'blocked', bonusDmg: 0, deflected, power };
  }
  const dmg = Math.floor(raw * (1 - armourReduction(defenderProfile)));
  const bonusDmg = procAccurateBonus(attackerProfile, normalMax);
  return { dmg, connected: true, outcome: (dmg + bonusDmg) > 0 ? 'hit' : 'blocked', bonusDmg, deflected, power };
}
// Returns damage dealt (0 = miss / blocked / fully absorbed by armour).
function rollHit(attackerProfile, defenderProfile, useSpecial = false) {
  return rollHitDetail(attackerProfile, defenderProfile, useSpecial).dmg;
}
// One full player attack for a tick: a single swing whose style
// effects (base boosts + Stage 27 procs) and the defender's prayer
// are already inside the roll. Returns { dmg, connected, outcome,
// bonusDmg, deflected, power, notes } for the callers' tick
// messages (callers grant combat XP on dmg + bonusDmg, apply
// `deflected` to the attacker's own HP pool, and surface the proc
// fields to the client for splats).
function rollPlayerAttack(attackerProfile, defenderProfile, useSpecial = false, levelOverride = null, deflectPvp = false) {
  const r = rollHitDetail(attackerProfile, defenderProfile, useSpecial, levelOverride, deflectPvp);
  return { dmg: r.dmg, connected: r.connected, outcome: r.outcome, bonusDmg: r.bonusDmg, deflected: r.deflected, power: r.power, notes: [] };
}

// ---------- Stage 19: attack styles (melee / ranged / magic) ----------
// A wielded weapon's def carries the style: swords (and everything
// pre-Stage-19) are 'melee', bows 'ranged', staves 'magic'. Unarmed
// is melee. Swing speeds in ticks: melee 4 (MELEE_SPEED, unchanged),
// ranged 3, magic 5 (OSRS bow/staff cadences). Reach: melee needs
// MELEE_REACH; ranged/magic reach NPC_RANGE (150), the same range
// Karil/Ahrim fight at in Barrows.
function attackStyleOf(p) {
  const w = p && p.worn ? p.worn.weapon : null;
  const d = w ? itemDef(w) : null;
  return (d && d.style) || 'melee';
}
function swingSpeed(style) { return style === 'ranged' ? 3 : style === 'magic' ? 5 : MELEE_SPEED; }
function styleRange(style) { return style === 'melee' ? MELEE_REACH : NPC_RANGE; }
function styleBanMsg(style) { return `🚫 No ${cap(style)} in this duel.`; }
// Arrows are consumed from the FIRST ammo stack in backpack slot
// order — the player chooses which arrows are spent by ordering
// their backpack (drag / inv_swap). Said in the arrows' Examine
// text on the client.
function firstArrowStack(p) {
  for (const s of p.backpack) {
    const d = ITEMS[s.item];
    if (d && d.kind === 'ammo' && s.qty > 0) return s;
  }
  return null;
}
// The OSRS attack-roll-vs-defence-roll shape of hitChance(), for
// the Ranged / Magic skill: attack roll = (effective level + style
// boost + 8) x (64 + weapon accuracy points) x ACC_BALANCE; defence
// roll = (Defence + 8) x 64 — the defender's Defence level serves
// for all three styles (a documented simplification: there are no
// separate ranged/magic defence rolls). Dragon Slash keeps its
// +5% on top, for every style. levelOverride is the duel
// equalisation (DUEL_LEVEL) and covers Ranged/Magic too.
function styleHitChance(attackerProfile, defenderProfile, skill, useSpecial = false, levelOverride = null) {
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  const dst = STYLES[defenderProfile.style] || STYLES.accurate;
  const aLv = levelOverride == null ? levelForXp((attackerProfile.xp && attackerProfile.xp[skill]) || 0) : levelOverride;
  const dLv = levelOverride == null ? levelForXp((defenderProfile.xp && defenderProfile.xp.defence) || 0) : levelOverride;
  const atkRoll = (aLv + (s.atkBoost || 0) + 8) * (64 + weaponAccPoints(attackerProfile)) * ACC_BALANCE;
  const defRoll = (dLv + (dst.defBoost || 0) + 8) * 64; // Stage 27: defender style boost, as in hitChance
  let chance = atkRoll > defRoll
    ? 1 - (defRoll + 2) / (2 * (atkRoll + 1))
    : atkRoll / (2 * (defRoll + 1));
  if (useSpecial) chance += 0.05;
  return Math.min(0.98, Math.max(0.02, chance));
}
// One player swing of ANY style, fully resolved. Melee delegates to
// the Stage 10 roll untouched. Ranged/magic return the same shape
// ({ dmg, connected, outcome, notes }) plus the style and what was
// spent (ammoUsed / spell). A swing that cannot happen at all —
// no arrows, missing runes, spell above the caster's level —
// returns { refused: '<reason>' } instead: NOTHING is consumed and
// the callers do not advance the swing timer or spend a queued
// special (the refusal mirrors a closing tick's fairness).
//   Ranged: consumes 1 arrow from the first ammo stack, hit or
//     miss. Max hit = 6 + floor((Ranged + style boost - 1) / 3) +
//     the arrow's strength bonus — the melee max-hit shape with a
//     lower base, the arrow standing in for the weapon bonus.
//   Magic: consumes the selected spell's runes, hit or miss. Max
//     hit = the spell's base cap + floor((Magic + style boost - 1)
//     / 3) — the spell stands in for the base + weapon terms.
//   Both: the defender's style block and worn armour reduction
//     apply exactly as they do to a melee swing, and Dragon Slash
//     multiplies the max hit by 1.5 as it does for melee.
function rollStyleAttack(attackerProfile, defenderProfile, useSpecial = false, levelOverride = null, deflectPvp = false) {
  const style = attackStyleOf(attackerProfile);
  if (style === 'melee') {
    const r = rollPlayerAttack(attackerProfile, defenderProfile, useSpecial, levelOverride, deflectPvp);
    return { ...r, style };
  }
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  if (style === 'ranged') {
    const stack = firstArrowStack(attackerProfile);
    if (!stack) return { refused: "You're out of arrows!", style };
    const arrowId = stack.item;
    const arrowDef = ITEMS[arrowId];
    removeStacks(attackerProfile.backpack, arrowId, 1); // one arrow per shot, hit or miss
    const connected = Math.random() <= styleHitChance(attackerProfile, defenderProfile, 'ranged', useSpecial, levelOverride);
    if (!connected) return { dmg: 0, connected: false, outcome: 'miss', notes: [], style, ammoUsed: arrowId, bonusDmg: 0, deflected: 0, power: false };
    // Stage 27: same resolution order as the melee branch — rolled
    // damage, Aggressive power proc, Deflect (PvP), Defensive proc,
    // armour; the Accurate bonus lands in full as bonusDmg.
    const lvl = levelOverride == null ? levelForXp(attackerProfile.xp.ranged || 0) : levelOverride;
    const normalMax = 6 + Math.floor((lvl + (s.strBoost || 0) - 1) / 3) + (arrowDef ? arrowDef.strBonus || 0 : 0);
    let max = normalMax;
    if (useSpecial) max = Math.floor(max * 1.5);
    let raw = 1 + Math.floor(Math.random() * max);
    let power = false;
    const powBonus = procAggressiveBonus(attackerProfile, normalMax);
    if (powBonus > 0) { raw += powBonus; power = true; }
    let deflected = 0;
    if (deflectPvp) {
      const dfl = pvpDeflect(defenderProfile, 'ranged', raw);
      raw = dfl.through; deflected = dfl.deflected;
    }
    if (Math.random() < boostChance(defenderProfile.style, 'defensive')) {
      return { dmg: 0, connected: true, outcome: 'blocked', notes: [], style, ammoUsed: arrowId, bonusDmg: 0, deflected, power };
    }
    const dmg = Math.floor(raw * (1 - armourReduction(defenderProfile)));
    const bonusDmg = procAccurateBonus(attackerProfile, normalMax);
    return { dmg, connected: true, outcome: (dmg + bonusDmg) > 0 ? 'hit' : 'blocked', notes: [], style, ammoUsed: arrowId, bonusDmg, deflected, power };
  }
  // magic — the attacker's selected spell, cast through the shared
  // resolver below (Stage 24 extracted it so placed-button casts
  // resolve with exactly the same machinery).
  return rollMagicCast(attackerProfile, defenderProfile, spellOf(attackerProfile), useSpecial, levelOverride, deflectPvp);
}

// Stage 24: resolve ONE magic cast of a CHOSEN spell. This is the
// Stage 19 staff-cast logic verbatim, parameterised on the spell:
// level gate first (nothing consumed), then the atomic rune take
// (consumed on the cast, hit or miss), then the accuracy roll, the
// defender's style block, and the level-scaled max hit. Freeze is
// the one special case: max hit 0 by design, and a cast that
// CONNECTS (lands and is not blocked) reports froze:true so the
// caller roots the target for FREEZE_MS — a miss or a block
// consumes the runes and does nothing, like Derek's brief says.
// Stage 27: the block is now the defender's Defensive proc chance
// (boostChance), and duel call sites pass deflectPvp so a damage
// spell is Deflect-prayed (PvP rule) before the block roll; casts
// themselves never proc (no bonusDmg / power off a spell).
function rollMagicCast(attackerProfile, defenderProfile, spell, useSpecial = false, levelOverride = null, deflectPvp = false) {
  const style = 'magic';
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  const mLvl = levelForXp((attackerProfile.xp && attackerProfile.xp.magic) || 0);
  if (mLvl < spell.level) return { refused: `You need Magic level ${spell.level} to cast ${spell.name}.`, style, spell: spell.id };
  const runeId = `${spell.element}_rune`;
  // removeStacks is atomic: false (and nothing taken) when short.
  if (!removeStacks(attackerProfile.backpack, runeId, spell.runes)) {
    return { refused: `You don't have the runes for ${spell.name}.`, style, spell: spell.id };
  }
  const connected = Math.random() <= styleHitChance(attackerProfile, defenderProfile, 'magic', useSpecial, levelOverride);
  if (!connected) return { dmg: 0, connected: false, outcome: 'miss', notes: [], style, spell: spell.id, bonusDmg: 0, deflected: 0, power: false };
  // Stage 27: casts do NOT proc (the app's casts never roll the
  // style boosts — no power hits, no bonus hits off a spell), but
  // the defender's Defensive proc can still stop a cast outright
  // (Stage 19's rule, at the new 25% / 12% chances), and in a duel
  // the defender's Deflect Magic prays off its PvP share first
  // (prayer before the style block, as everywhere). Freeze has no
  // damage to deflect: the prayer check inside pvpDeflect no-ops
  // at 0 damage, so a connected, unblocked Freeze still roots.
  if (spell.id === 'freeze') {
    if (Math.random() < boostChance(defenderProfile.style, 'defensive')) return { dmg: 0, connected: true, outcome: 'blocked', notes: [], style, spell: spell.id, bonusDmg: 0, deflected: 0, power: false };
    return { dmg: 0, connected: true, outcome: 'hit', froze: true, notes: [], style, spell: spell.id, bonusDmg: 0, deflected: 0, power: false };
  }
  const lvl = levelOverride == null ? mLvl : levelOverride;
  let max = spell.max + Math.floor((lvl + (s.strBoost || 0) - 1) / 3);
  if (useSpecial) max = Math.floor(max * 1.5);
  let raw = 1 + Math.floor(Math.random() * max);
  let deflected = 0;
  if (deflectPvp) {
    const dfl = pvpDeflect(defenderProfile, 'magic', raw);
    raw = dfl.through; deflected = dfl.deflected;
  }
  if (Math.random() < boostChance(defenderProfile.style, 'defensive')) return { dmg: 0, connected: true, outcome: 'blocked', notes: [], style, spell: spell.id, bonusDmg: 0, deflected, power: false };
  const dmg = Math.floor(raw * (1 - armourReduction(defenderProfile)));
  return { dmg, connected: true, outcome: dmg > 0 ? 'hit' : 'blocked', notes: [], style, spell: spell.id, bonusDmg: 0, deflected, power: false };
}
// Combat XP for one resolved swing, by attack style. Melee is
// combatXpGains unchanged. Ranged parallels it: dmg*4 Ranged +
// dmg*1.33 Hitpoints (the fighting style's boosts are already in
// the roll; there is no second Ranged "style" to split by). Magic:
// dmg*4 Magic + dmg*1.33 Hitpoints PLUS the spell family's flat
// cast XP (Strike 5 / Bolt 10 / Blast 15) — the cast XP is owed on
// every resolved cast, hit or miss, which is why the engines call
// this for every resolved swing, not only damaging ones (at 0
// damage the melee/ranged gains are all zero and addXp no-ops).
function swingXpGains(fightStyle, attackStyle, dmg, spellId) {
  if (attackStyle === 'ranged') return { ranged: dmg * 4, hitpoints: Math.round(dmg * 1.33) };
  if (attackStyle === 'magic') {
    const sp = spellId ? SPELL_BY_ID[spellId] : null;
    return { magic: dmg * 4 + (sp ? SPELL_CAST_XP[sp.tier] : 0), hitpoints: Math.round(dmg * 1.33) };
  }
  return combatXpGains(fightStyle, dmg);
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
  const itemsWon = [];
  let officialRunner = null;
  if (duel.freePlay) {
    // Stage 15: a FREE PLAY duel is a practice fight — nothing was
    // escrowed at the start, so nothing pays out here: no pot, no
    // item transfer, NO rating change and NO win/loss record change
    // for either player (win, lose, flee or forfeit alike). The
    // saves below still run, so combat XP earned from damage dealt
    // during the fight is kept exactly as in a staked duel.
  } else {
    addGold(winner, duel.pot); // escrow pays out — the pot lands on the winner's coin stack
    // Item escrow: winner takes every staked item. Anything that cannot fit
    // the winner's backpack overflows into their bank so nothing is lost.
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
    officialRunner = duel.official && duel.official.runner ? String(duel.official.runner) : null;
    if (officialRunner) addItemToProfile(winner, 'certificate', 1);
    winner.wins += 1; loser.losses += 1;
    winner.rating += 11; loser.rating = Math.max(0, loser.rating - 11);
  }
  save(winnerKey); save(loserKey);
  // Stage 20: ANY duel win (staked, Free Play or mod-run) completes
  // the winner's "Win a duel" starter goal.
  completeStarterGoal(winnerKey, 'win_duel');
  for (const k of [duel.a, duel.b]) {
    const p = online.get(k);
    if (p) {
      p.duelId = null;
      // Stage 5: the fight is over — both fighters return to the plaza.
      p.area = 'plaza';
      p.x = AREAS.plaza.spawn.x; p.y = AREAS.plaza.spawn.y;
      send(p.ws, { type: 'duel_end', winner: winner.username, reason, pot: duel.pot, itemsWon, freePlay: !!duel.freePlay, profile: publicProfile(db.users[k].profile) });
      send(p.ws, { type: 'area', area: 'plaza' });
      send(p.ws, pilesMsg('plaza'));
      send(p.ws, alliesMsg('plaza')); // Stage 6: your guardian waited for you in the plaza
      send(p.ws, objectsMsg('plaza')); // Stage 7D: placed objects in the plaza
    }
  }
  if (duel.freePlay) broadcast({ type: 'chat', from: 'Duel Master', text: `🆓 ${winner.username} wins the free play fight against ${loser.username} (${reason}) — no stakes, no record.` });
  else broadcast({ type: 'chat', from: 'Duel Master', text: `${winner.username} beat ${loser.username} for ${duel.pot}g (${reason}).` });
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

function startDuel(aKey, bKey, stake, itemsA = [], itemsB = [], official = null, rules = null, freePlay = false) {
  // Stage 7B: a duel starting cancels any open trade involving either
  // fighter first — the trade's other party is notified, nothing moves.
  for (const t of [...trades.values()]) {
    if (t.aKey === aKey || t.bKey === aKey || t.aKey === bKey || t.bKey === bKey) cancelTrade(t, 'Trade cancelled — a duel is starting.');
  }
  // Stage 17: a duel starting any other way cancels a pending stake
  // match involving either fighter (the stake flow itself deletes
  // its match before calling startDuel, so this only fires for
  // challenges / official fights). No gold moves on the cancel.
  for (const m of [...stakeOffers.values()]) {
    if (m.status === 'matched' && (m.fromKey === aKey || m.toKey === aKey || m.fromKey === bKey || m.toKey === bKey)) {
      cancelStakeMatch(m, 'Stake match cancelled — a duel is starting.');
    }
  }
  const a = db.users[aKey].profile, b = db.users[bKey].profile;
  // Stage 14: rules agreed on the challenge configuration screen
  // (null for mod-run fights and every other caller = no
  // restrictions). A No Prayer duel starts with both prayers off —
  // the prayer handler refuses to switch one on again.
  const duelRules = cleanDuelRules(rules);
  if (duelRules.noPrayer) { a.activePrayer = null; b.activePrayer = null; }
  // Stage 15: Free Play is a practice fight — the stakes are forced
  // to nothing HERE as well as on the challenge screen, so no caller
  // can stake a free play duel by mistake, and escrow is skipped
  // entirely: no gold or items leave anyone's purse or backpack.
  const fp = !!freePlay;
  if (fp) { stake = 0; itemsA = []; itemsB = []; }
  const escrowItems = [];
  if (!fp) {
    // Escrow: both gold stakes AND both item stakes leave purses/backpacks
    // before the first tick. A decline never reaches here, so takes nothing.
    // Stage 16: the gold stake is drawn from the coin stacks
    // (backpack first, then bank) by takeGold — the confirm path
    // already validated both totals cover it.
    takeGold(a, stake); takeGold(b, stake);
    for (const s of itemsA) { removeStacks(a.backpack, s.item, s.qty); addStacks(escrowItems, s.item, s.qty); }
    for (const s of itemsB) { removeStacks(b.backpack, s.item, s.qty); addStacks(escrowItems, s.item, s.qty); }
  }
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
    rules: duelRules, // Stage 14: { noPrayer, noPotions, noFood, noSpecial } — enforced by the prayer/use/special handlers; Stage 18 adds noMovement — enforced by the move handler
    freePlay: fp, // Stage 15: practice fight — endDuel settles nothing (no pot, no record, no rating)
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
  // Stage 26: a No Movement duel starts RIGHT next to each other —
  // ~26 units apart (787 vs 813) on the same centre line, already
  // inside MELEE_REACH, so the first engage connects with zero
  // closing and the standing fight reads as toe-to-toe. Movement
  // duels keep the classic 40-unit gap exactly.
  const nmSpawn = duelRules.noMovement;
  sessA.area = 'arena'; sessA.x = nmSpawn ? 787 : 780; sessA.y = 450;
  sessB.area = 'arena'; sessB.x = nmSpawn ? 813 : 820; sessB.y = 450;
  for (const k of [aKey, bKey]) {
    const p = online.get(k);
    send(p.ws, { type: 'area', area: 'arena' });
    send(p.ws, { type: 'duel_start', duelId: id, stake, pot: duel.pot, escrowItems, arena: duel.arena, official: duel.official, rules: duel.rules, freePlay: duel.freePlay, countdownTicks: COUNTDOWN_TICKS, you: db.users[k].profile.username, opponent: db.users[k === aKey ? bKey : aKey].profile.username, profile: publicProfile(db.users[k].profile) });
  }
  // Stage 19: if a fighter's wielded weapon style is banned by the
  // agreed rules, tell them once, up front — their swings will be
  // refused until they swap weapons.
  for (const k of [aKey, bKey]) {
    const st = attackStyleOf(db.users[k].profile);
    if (duelRules['no' + cap(st)]) {
      const p = online.get(k);
      if (p) send(p.ws, { type: 'chat', from: 'Game', text: `${styleBanMsg(st)} Swap weapons to fight.` });
    }
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
    // Stage 8: melee adjacency. If the fighters are not standing
    // next to each other, no melee swing can happen — a CLOSING
    // tick: no specials are consumed, no attacks are rolled and
    // nobody takes damage — each fighter is told where to walk
    // (moveTo, toward their opponent) to get back in reach. Hit
    // fields are null (not 0) so the client can tell "no swing"
    // apart from a swing that missed or was blocked. Stage 19
    // generalises "next to each other" per weapon style, below.
    const posA = online.get(aKey), posB = online.get(bKey);
    // Stage 19: closing is PER-FIGHTER and style-aware. A melee
    // fighter must close to MELEE_REACH; a bow/staff fighter only
    // to NPC_RANGE (the Karil/Ahrim pattern). When BOTH fighters
    // are out of their own range the tick is a pure closing tick,
    // exactly as Stage 8 built it. When only one is out, that
    // fighter's own tick message carries closing + moveTo while
    // the other fights on.
    const styleA = attackStyleOf(a), styleB = attackStyleOf(b);
    const distAB = posA && posB ? Math.hypot(posA.x - posB.x, posA.y - posB.y) : 0;
    const outA = distAB > styleRange(styleA), outB = distAB > styleRange(styleB);
    if (posA && posB && outA && outB) {
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
    // only on a tick where their timer is due; each RESOLVED swing
    // re-arms the timer by that weapon's speed (Stage 19: melee 4,
    // ranged 3, magic 5 ticks). The due time is an absolute duel
    // tick, so a fighter who was out of reach when their timer came
    // due swings on the first tick they are back in THEIR range —
    // the timer never gets pushed forward by distance. An
    // UN-engaged fighter never swings: engagement comes ONLY from
    // their own duel_attack tap (Derek: "players have to tap
    // attack to retaliate" — being hit never engages them). On a
    // tick where a fighter does not swing, their hit field is null
    // (exactly like a closing tick) and a queued special STAYS
    // queued: Dragon Slash only ever fires riding a real swing.
    // Stage 19 adds two more ways a due swing does not fire: the
    // fighter's weapon style is BANNED by the agreed rules (no
    // Melee / no Ranged / no Magic), or the swing is REFUSED (out
    // of arrows / runes). Both leave the timer due and the special
    // queued, consume nothing, and tell the fighter why in their
    // tick note (throttled to once per 8 ticks so standing still
    // with the wrong weapon does not spam).
    const trySwing = (attKey, attProf, defProf, attOut, attStyle) => {
      if (!(duel.engaged[attKey] && tick >= duel.nextSwingAt[attKey])) return { swung: false };
      if (attOut) return { swung: false };
      duel.refuseNoteAt = duel.refuseNoteAt || {};
      const refuseNote = (text) => {
        if (tick - (duel.refuseNoteAt[attKey] || -99) >= 8) { duel.refuseNoteAt[attKey] = tick; return text; }
        return null;
      };
      if (duel.rules && duel.rules['no' + cap(attStyle)]) return { swung: false, note: refuseNote(styleBanMsg(attStyle)) };
      const useSpec = duel.specialQueued[attKey];
      // Stage 10: each fighter's single style effect rides along on
      // every player attack (inside the shared roll functions).
      // Stage 12: duel rolls are EQUALISED at DUEL_LEVEL for both
      // fighters — trained Attack/Strength/Defence do not apply in
      // a duel; Stage 19 extends the equalisation to Ranged/Magic.
      // Weapons, armour, styles, specials and XP stay personal.
      // Stage 27: duel swings resolve with the PvP Deflect rule —
      // a fighter's active prayer prays off 40% of an incoming
      // swing and bounces a quarter of that back (res.deflected,
      // applied to the ATTACKER below). The Accurate proc's bonus
      // hit rides as res.bonusDmg, part of the damage the swing
      // deals and of its XP.
      const res = rollStyleAttack(attProf, defProf, useSpec, DUEL_LEVEL, true);
      if (res.refused) return { swung: false, note: refuseNote(res.refused) };
      duel.nextSwingAt[attKey] = tick + swingSpeed(res.style);
      duel.specialQueued[attKey] = false;
      if (useSpec) attProf.specialEnergy = Math.max(0, attProf.specialEnergy - SPECIAL_COST);
      // Combat XP from damage dealt, per attack style (Stage 19:
      // granted here for every style — the endDuel comment and the
      // free-play end sheet have always said duel XP counts).
      // Stage 27: the Accurate bonus hit earns XP like the app's
      // awardHitXp(extra) — on the swing's total damage.
      const totalDmg = res.dmg + (res.bonusDmg || 0);
      addXp(attKey, swingXpGains(attProf.style, res.style, totalDmg, res.spell));
      // Special energy charges on landed (damaging) hits.
      if (totalDmg > 0) attProf.specialEnergy = Math.min(100, attProf.specialEnergy + SPECIAL_CHARGE_PER_HIT);
      return { swung: true, dmg: res.dmg, bonus: res.bonusDmg || 0, deflected: res.deflected || 0, power: !!res.power, outcome: res.outcome, special: useSpec, notes: res.notes || [] };
    };
    const aSw = trySwing(aKey, a, b, outA, styleA);
    const bSw = trySwing(bKey, b, a, outB, styleB);
    // Stage 27: a fighter's incoming damage is the opponent's swing
    // total (main + Accurate bonus) PLUS whatever their OWN swing
    // had deflected back onto them by the opponent's prayer.
    const dmgToB = (aSw.swung ? aSw.dmg + aSw.bonus : 0) + (bSw.swung ? bSw.deflected : 0);
    const dmgToA = (bSw.swung ? bSw.dmg + bSw.bonus : 0) + (aSw.swung ? aSw.deflected : 0);
    duel.hp[bKey] = Math.max(0, duel.hp[bKey] - dmgToB);
    duel.hp[aKey] = Math.max(0, duel.hp[aKey] - dmgToA);
    for (const k of [aKey, bKey]) {
      const p = online.get(k);
      const own = k === aKey ? aSw : bSw;
      const opp = k === aKey ? bSw : aSw;
      const ownOut = k === aKey ? outA : outB;
      const noteParts = [...(own.notes || [])];
      if (own.note) noteParts.push(own.note);
      if (opp.notes && opp.notes.length) noteParts.push(`Opponent: ${opp.notes.join(' ')}`);
      if (p) send(p.ws, {
        type: 'duel_tick', hpYou: duel.hp[k], hpOpponent: duel.hp[k === aKey ? bKey : aKey],
        youHit: own.swung ? own.dmg : null,
        oppHit: opp.swung ? opp.dmg : null,
        // Stage 27: proc / prayer fields — youBonus/oppBonus are the
        // Accurate bonus hits (own swing / opponent's swing);
        // youDeflected is the damage MY swing bounced back onto ME
        // off the opponent's Deflect prayer; oppDeflected is the
        // damage the OPPONENT's swing bounced back onto THEM off
        // mine. null when that side never swung.
        youBonus: own.swung ? own.bonus : null,
        oppBonus: opp.swung ? opp.bonus : null,
        youDeflected: own.swung ? own.deflected : null,
        oppDeflected: opp.swung ? opp.deflected : null,
        youOutcome: own.swung ? own.outcome : null,
        oppOutcome: opp.swung ? opp.outcome : null,
        youSpecial: own.swung ? own.special : false, oppSpecial: opp.swung ? opp.special : false,
        energyYou: db.users[k].profile.specialEnergy, countdownLeft,
        ...(ownOut && posA && posB ? { closing: true, moveTo: approachPoint(p.x, p.y, (k === aKey ? posB : posA).x, (k === aKey ? posB : posA).y) } : {}),
        note: noteParts.length ? noteParts.join(' ') : undefined,
      });
    }
    if (duel.hp[aKey] <= 0 && duel.hp[bKey] <= 0) endDuel(duel, Math.random() < 0.5 ? aKey : bKey, 'double KO — coin flip');
    else if (duel.hp[bKey] <= 0) endDuel(duel, aKey, 'KO');
    else if (duel.hp[aKey] <= 0) endDuel(duel, bKey, 'KO');
  }, TICK_MS);
}

// ---------- Mod NPC stake ladder (Stage 22) ----------
// Derek's design: three NPC moderators stand in the plaza, one per
// tier, offering stake duels. The stake doubles per tier — Tier 1
// 100g, Tier 2 200g, Tier 3 400g — and winning 3 times in a tier
// unlocks the next. (The names are placeholders Derek can rename.)
//
// ROUTE: the player-duel engine (startDuel) is welded to two real
// player sessions — both fighters are db.users records with live
// sockets, escrow runs through both profiles, and endDuel writes
// win/loss + rating to both. A fake "user" for the mod would land
// in the leaderboard / hiscores and the saved store, so instead
// this is a dedicated engine that mirrors the duel tick's rules
// exactly, fought IN PLACE in the plaza against the standing mod:
//   - 99 HP pools, COUNTDOWN_TICKS countdown (movement frozen,
//     engagement taps accepted), per-fighter swing timers at the
//     wielded weapon's speed, tap-to-engage with NO auto-retaliate
//     (the player engages only via {type:'mod_duel_attack'}; the
//     mod engages itself the moment the countdown ends).
//   - Rolls are the shared rollStyleAttack at DUEL_LEVEL for BOTH
//     sides — the player's gear, style, special and XP are personal
//     exactly as in a player duel; the mod fights from a synthetic
//     profile (its tier's sword, Aggressive style, no armour, no
//     prayers, no potions, no special).
//   - Per-fighter closing exactly like the duel tick: a melee
//     fighter out of MELEE_REACH does not swing and is told where
//     to walk (moveTo); the mod never moves — mods hold their post.
//   - Walking beyond NPC_RANGE (or leaving the plaza) forfeits:
//     the escrowed stake is lost, as on a loss or a disconnect.
//   - Settlement touches NO rating and NO win/loss record (these
//     are not player duels) — but a win DOES complete the Stage 20
//     "Win a duel" starter goal, like every other duel win.
// One fight per mod at a time (the goblin pattern): a busy mod
// refuses new challengers until its fight ends.
const MOD_NPCS = [
  { id: 'mod1', name: 'Mod Ash', tier: 1, stake: 100, x: 680, y: 300, weapon: 'steel_sword', style: 'aggressive', combatLevel: 40 },
  { id: 'mod2', name: 'Mod Blair', tier: 2, stake: 200, x: 800, y: 280, weapon: 'mithril_sword', style: 'aggressive', combatLevel: 40 },
  { id: 'mod3', name: 'Mod Vega', tier: 3, stake: 400, x: 920, y: 300, weapon: 'dragon_sword', style: 'aggressive', combatLevel: 40 },
];
const MOD_NPC_BY_ID = Object.fromEntries(MOD_NPCS.map((d) => [d.id, d]));
const modLive = new Map(MOD_NPCS.map((d) => [d.id, { fightId: null }])); // npcId -> { fightId } (busy lock)
const modDuels = new Map(); // fight id -> fight

function modNpcsMsg() {
  return {
    type: 'mod_npcs',
    npcs: MOD_NPCS.map((d) => ({ id: d.id, name: d.name, tier: d.tier, stake: d.stake, x: d.x, y: d.y, combatLevel: d.combatLevel, busy: !!modLive.get(d.id).fightId })),
  };
}
function broadcastModNpcs() {
  const msg = modNpcsMsg();
  for (const p of online.values()) if (p.area === 'plaza') send(p.ws, msg);
}
function modLadderMsg(p) {
  ensureV2(p);
  return { type: 'mod_ladder', wins: { t1: p.modLadder.wins.t1, t2: p.modLadder.wins.t2, t3: p.modLadder.wins.t3 } };
}
// Tier 1 is always open; tier N (2/3) needs 3 wins in tier N-1.
function modTierUnlocked(p, tier) {
  ensureV2(p);
  if (tier <= 1) return true;
  return (p.modLadder.wins['t' + (tier - 1)] || 0) >= 3;
}
// The mod's half of the fight: a throwaway profile in exactly the
// shape rollStyleAttack reads (style / worn / xp / backpack /
// spell). Built fresh per fight so nothing (energy, arrows) leaks
// between challengers. Melee only — it never touches the
// arrow/rune paths.
function modFightProfile(def) {
  return {
    username: def.name, style: def.style,
    worn: { ...emptyWorn(), weapon: def.weapon },
    xp: defaultXp(), backpack: [], spell: 'air_strike',
    activePrayer: null, specialEnergy: 0,
  };
}
function startModDuel(key, def) {
  const sess = online.get(key);
  if (!sess) return;
  const profile = sess.profile;
  takeGold(profile, def.stake); // escrow — the handler validated the total covers it
  save(key);
  const id = crypto.randomBytes(6).toString('hex');
  const fight = {
    id, playerKey: key, npcId: def.id, tier: def.tier, stake: def.stake, pot: def.stake * 2,
    hpYou: 99, hpNpc: 99,
    // Swing timers mirror the duel engine: the player starts
    // UN-engaged (timer at Infinity) until their mod_duel_attack
    // tap; the mod engages itself — its first swing is armed for
    // the first live tick after the countdown.
    tickCount: 0, engaged: false, nextSwingYou: Infinity, nextSwingNpc: COUNTDOWN_TICKS + 1,
    specialQueued: false, done: false, timer: null,
    modProfile: modFightProfile(def), lastRefuseTick: -99,
  };
  modDuels.set(id, fight);
  modLive.get(def.id).fightId = id;
  sess.modDuelId = id;
  send(sess.ws, {
    type: 'mod_duel', phase: 'start', npcId: def.id, name: def.name, tier: def.tier, stake: def.stake, pot: fight.pot,
    countdownTicks: COUNTDOWN_TICKS, hpYou: 99, maxHpYou: 99, hpNpc: 99, maxHpNpc: 99,
    energyYou: profile.specialEnergy, profile: publicProfile(profile),
  });
  broadcast({ type: 'chat', from: 'Duel Master', text: `${profile.username} takes on ${def.name} (Tier ${def.tier}) for ${def.stake}g — winner takes ${fight.pot}g!` });
  broadcastModNpcs();
  broadcastState();
  fight.timer = setInterval(() => modDuelTick(fight), TICK_MS);
}
function modDuelTick(fight) {
  const sess = online.get(fight.playerKey);
  const def = MOD_NPC_BY_ID[fight.npcId];
  if (!sess || !def) { endModDuel(fight, 'forfeit'); return; } // session vanished mid-tick (the close handler settles first; this is the belt-and-braces path)
  const profile = sess.profile;
  fight.tickCount += 1;
  const tick = fight.tickCount;
  const countdownLeft = Math.max(0, COUNTDOWN_TICKS - tick + 1);
  const dist = Math.hypot(sess.x - def.x, sess.y - def.y);
  // Walking off forfeits the stake — checked every tick, though it
  // cannot trigger during the countdown (moves are frozen then and
  // travel is refused), and the start required standing in range.
  if (sess.area !== 'plaza' || dist > NPC_RANGE) { endModDuel(fight, 'forfeit'); return; }
  if (countdownLeft > 0) {
    // Countdown ticks: positions frozen, nobody swings — but the
    // client overlay counts down from these, exactly like a duel.
    send(sess.ws, {
      type: 'mod_duel', phase: 'tick', npcId: def.id,
      hpYou: fight.hpYou, maxHpYou: 99, hpNpc: fight.hpNpc, maxHpNpc: 99,
      youHit: null, npcHit: null, youOutcome: null, npcOutcome: null, youSpecial: false,
      energyYou: profile.specialEnergy, countdownLeft,
    });
    return;
  }
  // Per-fighter closing, mirroring the duel tick: the player's
  // reach depends on their wielded style; the mod (melee) needs
  // MELEE_REACH. Both out = a closing tick: nobody swings, the
  // player is told where to walk. Only the player out = the mod
  // fights on while the player closes; only the mod out = the
  // player fights on (a bow/staff holder picks the mod apart from
  // range — the mod holds its post and cannot answer).
  const pStyle = attackStyleOf(profile);
  const playerOut = dist > styleRange(pStyle);
  const npcOut = dist > MELEE_REACH;
  if (playerOut && npcOut) {
    send(sess.ws, {
      type: 'mod_duel', phase: 'tick', npcId: def.id,
      hpYou: fight.hpYou, maxHpYou: 99, hpNpc: fight.hpNpc, maxHpNpc: 99,
      youHit: null, npcHit: null, youOutcome: null, npcOutcome: null, youSpecial: false,
      energyYou: profile.specialEnergy, countdownLeft,
      closing: true, moveTo: approachPoint(sess.x, sess.y, def.x, def.y),
      npcFrozenUntil: (fight.modFrozenUntil && fight.modFrozenUntil > Date.now()) ? fight.modFrozenUntil : 0, // Stage 24 (mods never move; Freeze is visual here)
    });
    return;
  }
  const notes = [];
  let youHit = null, youOutcome = null, youSpecial = false;
  // Stage 27: the player's Accurate bonus on the mod, and the damage
  // the player's Deflect prayer bounces back onto the mod.
  let youBonus = 0, npcDeflected = 0;
  if (fight.engaged && tick >= fight.nextSwingYou && !playerOut) {
    // Stage 27: the PvP Deflect flag is passed for symmetry — the
    // mod never prays, so res.deflected is always 0 here; the
    // Accurate bonus rides into the mod's HP and the XP base.
    const res = rollStyleAttack(profile, fight.modProfile, fight.specialQueued, DUEL_LEVEL, true);
    if (res.refused) {
      // Out of arrows / runes: nothing consumed, timer and queued
      // special untouched — the refusal note is throttled like the
      // duel engine's (once per 8 ticks).
      if (tick - fight.lastRefuseTick >= 8) { notes.push(res.refused); fight.lastRefuseTick = tick; }
    } else {
      fight.nextSwingYou = tick + swingSpeed(res.style);
      youSpecial = fight.specialQueued; fight.specialQueued = false;
      if (youSpecial) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
      youHit = res.dmg; youOutcome = res.outcome; youBonus = res.bonusDmg || 0;
      if (res.notes && res.notes.length) notes.push(...res.notes);
      // Combat XP from damage dealt, per attack style — duels
      // grant swing XP for every style (Stage 19), mod duels too.
      addXp(fight.playerKey, swingXpGains(profile.style, res.style, res.dmg + youBonus, res.spell));
      if (res.dmg + youBonus > 0) profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
      fight.hpNpc -= res.dmg + youBonus;
    }
  }
  let npcHit = null, npcOutcome = null;
  if (tick >= fight.nextSwingNpc && !npcOut) {
    fight.nextSwingNpc = tick + MELEE_SPEED;
    // Stage 27: the mod's swing resolves against the player's
    // Deflect prayer by the PvP rule (the shared roll applies it —
    // res.dmg is already the prayed-down amount) and whatever the
    // prayer bounced back (res.deflected) comes off the mod's HP.
    // The mod's own Aggressive power proc rides inside res.dmg;
    // its Accurate bonus is 0 (an Aggressive fighter never rolls
    // the Accurate boost).
    const res = rollStyleAttack(fight.modProfile, profile, false, DUEL_LEVEL, true);
    if (!res.refused) {
      npcHit = res.dmg; npcOutcome = res.outcome; npcDeflected = res.deflected || 0;
      fight.hpYou -= res.dmg + (res.bonusDmg || 0);
      fight.hpNpc -= npcDeflected;
    }
  }
  send(sess.ws, {
    type: 'mod_duel', phase: 'tick', npcId: def.id,
    hpYou: Math.max(0, fight.hpYou), maxHpYou: 99, hpNpc: Math.max(0, fight.hpNpc), maxHpNpc: 99,
    youHit, npcHit, youOutcome, npcOutcome, youSpecial,
    // Stage 27: youBonus = my Accurate bonus on the mod;
    // npcDeflected = damage my Deflect prayer bounced back onto
    // the mod; npcBonus / youDeflected are structurally 0 (the mod
    // is Aggressive and never prays) but ride along so the client
    // renders mod duels exactly like player duels.
    youBonus, npcBonus: 0, youDeflected: 0, npcDeflected,
    energyYou: profile.specialEnergy, countdownLeft,
    ...(playerOut ? { closing: true, moveTo: approachPoint(sess.x, sess.y, def.x, def.y) } : {}),
    note: notes.length ? notes.join(' ') : undefined,
    npcFrozenUntil: (fight.modFrozenUntil && fight.modFrozenUntil > Date.now()) ? fight.modFrozenUntil : 0, // Stage 24
  });
  // The kill counts even on a double-drop tick (the NPC-fight
  // precedent: "the kill still counts"), so the mod's death is
  // checked first.
  if (fight.hpNpc <= 0) endModDuel(fight, 'win');
  else if (fight.hpYou <= 0) endModDuel(fight, 'loss');
}
function endModDuel(fight, result) { // 'win' | 'loss' | 'forfeit'
  if (fight.done) return;
  fight.done = true;
  clearInterval(fight.timer);
  modDuels.delete(fight.id);
  const def = MOD_NPC_BY_ID[fight.npcId];
  const live = modLive.get(fight.npcId);
  if (live && live.fightId === fight.id) live.fightId = null;
  const key = fight.playerKey;
  const u = db.users[key];
  if (!u || !def) { broadcastModNpcs(); return; }
  const profile = u.profile;
  ensureV2(profile);
  let payout = 0;
  let winsNow = profile.modLadder.wins['t' + fight.tier] || 0;
  let unlockedNext = false;
  if (result === 'win') {
    payout = fight.pot; // the escrowed stake back + the mod's matching stake
    addGold(profile, payout);
    winsNow = Math.min(3, winsNow + 1); // stored wins cap at 3 — the tier is complete there
    profile.modLadder.wins['t' + fight.tier] = winsNow;
    unlockedNext = winsNow >= 3 && fight.tier < 3;
  }
  save(key);
  // Stage 20: a mod-duel win is a duel win for the starter goal.
  if (result === 'win') completeStarterGoal(key, 'win_duel');
  const sess = online.get(key);
  if (sess) {
    if (sess.modDuelId === fight.id) sess.modDuelId = null;
    send(sess.ws, {
      type: 'mod_duel', phase: 'end', npcId: def.id, name: def.name, tier: fight.tier,
      stake: fight.stake, pot: fight.pot, result, payout,
      wins: winsNow, unlockedNext, profile: publicProfile(profile),
    });
    send(sess.ws, modLadderMsg(profile));
  }
  if (result === 'win') {
    broadcast({ type: 'chat', from: 'Duel Master', text: `⭐ ${profile.username} beat ${def.name} (Tier ${fight.tier}) and won the ${fight.pot}g pot! (${winsNow}/3 Tier ${fight.tier} wins${unlockedNext ? ` — Tier ${fight.tier + 1} unlocked!` : ''})` });
  }
  broadcastModNpcs();
  broadcastState();
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
// Drop tables by NPC kind.
//   Goblin: 2-8 gold coins always; plus one item roll — 15% prayer
//     potion, 25% ranarr herbs, 60% no item.
//   Wizard (Stage 19): runes — one element per kill, weighted air
//     45% (most common) / water 25% / earth 18% / fire 12% (rarest),
//     3-10 of them, plus 3-8 gold.
//   Ranger (Stage 19): one random tier (weighted bronze 30% / iron
//     25% / steel 20% / mithril 12% / adamant 8% / rune 5%) and a
//     drop shape roll — 55% arrows only (5-15), 30% arrowheads only
//     (1-3), 15% both — plus 3-8 gold.
function rollNpcDrops(profile, npc) {
  const kind = npc ? npc.kind : 'goblin';
  if (kind === 'wizard') {
    const gold = 3 + Math.floor(Math.random() * 6); // 3-8
    addGold(profile, gold);
    const roll = Math.random() * 100;
    const el = roll < 45 ? 'air' : roll < 70 ? 'water' : roll < 88 ? 'earth' : 'fire';
    const qty = 3 + Math.floor(Math.random() * 8); // 3-10 of the one element
    const leftover = addStacks(profile.backpack, `${el}_rune`, qty, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(profile.bank, `${el}_rune`, leftover); // full pack: bank it, never lose a drop
    return { gold, items: [{ item: `${el}_rune`, qty }] };
  }
  if (kind === 'ranger') {
    const gold = 3 + Math.floor(Math.random() * 6); // 3-8
    addGold(profile, gold);
    const tr = Math.random() * 100;
    const tier = tr < 30 ? 'bronze' : tr < 55 ? 'iron' : tr < 75 ? 'steel' : tr < 87 ? 'mithril' : tr < 95 ? 'adamant' : 'rune';
    const what = Math.random();
    const items = [];
    const give = (item, qty) => {
      const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, item, leftover);
      items.push({ item, qty });
    };
    if (what < 0.55 || what >= 0.85) give(`${tier}_arrow`, 5 + Math.floor(Math.random() * 11)); // 5-15 arrows
    if (what >= 0.55) give(`${tier}_arrowhead`, 1 + Math.floor(Math.random() * 3)); // 1-3 arrowheads
    return { gold, items };
  }
  const gold = 2 + Math.floor(Math.random() * 7);
  addGold(profile, gold); // Stage 16: the coins land on the coin stack
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
  // Stage 28: death wakes you in the plaza, so the Barrows drains
  // clear (the app clears them on plaza entry) and the crypt/tunnel
  // session scratch goes with them. The RUN itself (kills, tunnel,
  // solved puzzle) is saved on the profile and is NOT touched here.
  sess.accDrain = 0; sess.strDrain = 0; sess.runDrainedUntil = 0;
  sess.barrowsCrypt = null; sess.barrowsHp = null; sess.barrowsPuzzle = null;
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
  const fight = { id, playerKey: key, npcId: npc.id, hpYou: maxHpYou, maxHpYou, specialQueued: false, done: false, timer: null, tickCount: 0, nextSwingYou: swingSpeed(attackStyleOf(profile)), nextSwingNpc: MELEE_SPEED, npcUnlocked: false, lastRefuseTick: -99 }; // Stage 19: first swing one weapon-speed after engagement (the wielded style's speed); lastRefuseTick throttles out-of-arrows/runes notes
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
  // Walking too far from the creature breaks off the fight.
  if (sess.area !== npc.area || Math.hypot(sess.x - npc.x, sess.y - npc.y) > NPC_RANGE) { finishNpcFight(fight, 'range'); return; }
  // Stage 8: melee adjacency — Stage 19 makes it style-aware. Each
  // side has its own reach: MELEE_REACH for a melee weapon / melee
  // creature, NPC_RANGE for a bow, a staff, or a ranged creature
  // (wizard / ranger — the Karil/Ahrim pattern). This is a CLOSING
  // tick only when NEITHER side can act AND the creature is a melee
  // type that still has to walk in: it steps toward the player,
  // nobody swings either way, a queued special stays queued, and
  // the Tree Guardian holds off (its behaviour below only runs on
  // fighting ticks). Hit fields are null so the client can tell
  // "no swing" from a missed swing. Two mixed cases therefore get
  // fighting ticks instead: a melee player facing a wizard/ranger
  // (only the creature can swing — once unlocked — until the
  // player walks in), and a ranged/magic player facing a goblin
  // (the player shoots while the goblin keeps stepping in, below).
  // For the classic both-melee fight this reduces to exactly the
  // old rule: closing ⟺ distance > MELEE_REACH.
  const pStyle = attackStyleOf(profile);
  const pReach = styleRange(pStyle);
  const npcReach = npc.attackType === 'melee' ? MELEE_REACH : NPC_RANGE;
  const distNow = Math.hypot(sess.x - npc.x, sess.y - npc.y);
  const playerOut = distNow > pReach, npcOut = distNow > npcReach;
  if (playerOut && npcOut && npc.attackType === 'melee') {
    // Stage 24: a Freeze-rooted creature holds its spot instead of
    // stepping in — it may still swing once it's in reach (below).
    if (!((npc.frozenUntil || 0) > Date.now())) stepToward(npc, sess.x, sess.y, APPROACH_STEP);
    send(sess.ws, {
      type: 'npc_fight', phase: 'tick', npcId: npc.id,
      hpYou: Math.max(0, fight.hpYou), maxHpYou: fight.maxHpYou,
      hpNpc: Math.max(0, npc.hp), maxHpNpc: npc.maxHp,
      youHit: null, npcHit: null, youOutcome: null, npcOutcome: null, youSpecial: false, energyYou: profile.specialEnergy,
      closing: true, moveTo: approachPoint(sess.x, sess.y, npc.x, npc.y),
      npcFrozenUntil: (npc.frozenUntil && npc.frozenUntil > Date.now()) ? npc.frozenUntil : 0, // Stage 24
    });
    broadcastNpcState(npc.area);
    return;
  }
  fight.tickCount = (fight.tickCount || 0) + 1;
  const tick = fight.tickCount;
  const tickNotes = [];
  // Stage 12: OSRS swing timers — the player swings once per
  // weapon-speed of fighting ticks, the first swing one full
  // weapon-speed after engagement (no opening beat for NPC fights).
  // Stage 19: the weapon-speed depends on the wielded style (melee
  // 4 / ranged 3 / magic 5 ticks). The creature runs on its own
  // timer but starts LOCKED (see the retaliate unlock in the
  // player's swing below). Between swings a fighter's hit field is
  // null (the client reads null as "no swing", exactly like a
  // closing tick), and a queued special stays queued until the
  // player's swing is actually due — it only ever fires riding a
  // real swing.
  let useSpec = false;
  let youHit = null; // null: the player's swing is not due this tick
  let youOutcome = null; // the player's swing outcome (Stage 12 clarity)
  let youBonus = 0; // Stage 27: the player's Accurate bonus hit this tick
  // Stage 19: a melee creature still out of its own reach keeps
  // closing during fighting ticks (a ranging/maging player keeps
  // shooting it as it comes). Ranged creatures hold their ground.
  // Stage 24: a Freeze-rooted creature holds its spot here too.
  if (npcOut && npc.attackType === 'melee' && !((npc.frozenUntil || 0) > Date.now())) stepToward(npc, sess.x, sess.y, APPROACH_STEP);
  if (!playerOut && tick >= (fight.nextSwingYou || MELEE_SPEED)) {
    // Player swing: Stage 19's style dispatcher — melee is the
    // shared Stage 10 roll; ranged consumes an arrow; magic
    // consumes the selected spell's runes. A REFUSED swing (no
    // arrows / no runes / spell level too high) consumes nothing,
    // leaves the swing timer and a queued special untouched, and
    // its reason rides the tick note, throttled to once per 8
    // ticks so standing in place does not spam it.
    const atkRes = rollStyleAttack(profile, NPC_DEFENDER, fight.specialQueued);
    if (atkRes.refused) {
      if (tick - (fight.lastRefuseTick || -99) >= 8) { tickNotes.push(atkRes.refused); fight.lastRefuseTick = tick; }
    } else {
      fight.nextSwingYou = tick + swingSpeed(atkRes.style);
      useSpec = fight.specialQueued; fight.specialQueued = false;
      if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
      youHit = atkRes.dmg;
      youBonus = atkRes.bonusDmg || 0;
      youOutcome = atkRes.outcome;
      tickNotes.push(...atkRes.notes);
      // Combat XP per attack style (Magic's flat cast XP is owed
      // even on a miss; melee/ranged gains at 0 damage are zero).
      // Stage 27: the Accurate bonus hit earns XP on the total.
      addXp(fight.playerKey, swingXpGains(profile.style, atkRes.style, atkRes.dmg + youBonus, atkRes.spell));
      // Stage 12 retaliate unlock: the creature's swings stay
      // locked until the player's first CONNECTED swing lands on
      // it — then it unlocks, its first swing one of ITS
      // weapon-speeds after the hit. (Guardian damage does not
      // unlock it: only the player's own connected swing counts.)
      if (atkRes.connected && !fight.npcUnlocked) {
        fight.npcUnlocked = true;
        fight.nextSwingNpc = tick + (npc.attackType === 'melee' ? MELEE_SPEED : 3);
      }
    }
  }
  // Creature swing (only once unlocked, only on its due ticks, and
  // only inside its own reach): Stage 27 resolves it in the app
  // version's order — the creature's accuracy, its rolled damage,
  // the player's Deflect prayer (a matching prayer — Melee answers
  // goblins, Magic wizards, Missiles rangers — stops the hit
  // ENTIRELY and bounces max(1, ceil(raw x 0.25)) back onto the
  // creature; it can kill and awards no XP), then the player's
  // Defensive style proc (25% / Controlled 12% — styleBlockChance),
  // then the player's worn armour reduction. Stage 19: ranged
  // creatures swing on a 3-tick cadence; melee keep 4.
  let npcHit = null; // null: the creature never swung this tick (locked, out of reach, or swing not due)
  let npcOutcome = null; // the creature's swing outcome (Stage 12 clarity)
  let npcDeflected = 0; // Stage 27: damage the player's prayer bounced back onto the creature this tick
  const npcCadence = npc.attackType === 'melee' ? MELEE_SPEED : 3;
  const npcOutNow = Math.hypot(sess.x - npc.x, sess.y - npc.y) > npcReach;
  if (fight.npcUnlocked && !npcOutNow && tick >= (fight.nextSwingNpc || MELEE_SPEED)) {
    fight.nextSwingNpc = tick + npcCadence;
    npcHit = 0;
    if (Math.random() > npc.acc) npcOutcome = 'miss';
    else {
      const raw = 1 + Math.floor(Math.random() * npc.maxHit);
      npcDeflected = monsterDeflect(profile, npc.attackType, raw);
      if (npcDeflected > 0) npcOutcome = 'blocked'; // Deflect: nothing gets through, the creature takes the bounce
      else if (Math.random() < styleBlockChance(profile)) {
        npcOutcome = 'blocked';
        tickNotes.push(`Blocked by your ${cap(profile.style)} style!`);
      }
      else {
        npcHit = Math.floor(raw * (1 - armourReduction(profile)));
        npcOutcome = npcHit > 0 ? 'hit' : 'blocked'; // connected, but armour absorbed the whole blow
      }
    }
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
  npc.hp -= (youHit || 0) + youBonus + npcDeflected;
  // ... and the guardian swings at the goblin itself every 2nd
  // fighting tick (its own cadence, unchanged by Stage 12). Its
  // damage grants no XP.
  if (ally && allies.get(fight.playerKey) === ally && fight.tickCount % 2 === 0) {
    const allyDmg = allyDamage(ally);
    npc.hp -= allyDmg;
    tickNotes.push(`🌳 ${ally.name} hits for ${allyDmg}!`);
  }
  fight.hpYou -= npcHit || 0;
  if ((youHit || 0) + youBonus > 0) profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
  // (Combat XP moved into the swing resolution above: Stage 19's
  // dispatcher knows the attack style, and Magic's flat cast XP is
  // owed even on a miss. Melee behaviour is unchanged — the old
  // call granted combatXpGains on damage, which is exactly what
  // swingXpGains returns for a melee swing.)
  send(sess.ws, {
    type: 'npc_fight', phase: 'tick', npcId: npc.id,
    hpYou: Math.max(0, fight.hpYou), maxHpYou: fight.maxHpYou,
    hpNpc: Math.max(0, npc.hp), maxHpNpc: npc.maxHp,
    youHit, npcHit, youOutcome, npcOutcome, youSpecial: useSpec, energyYou: profile.specialEnergy,
    // Stage 27: youBonus = my Accurate bonus on the creature;
    // npcDeflected = damage my Deflect prayer bounced back onto it.
    youBonus, npcDeflected,
    note: tickNotes.length ? tickNotes.join(' ') : undefined,
    npcFrozenUntil: (npc.frozenUntil && npc.frozenUntil > Date.now()) ? npc.frozenUntil : 0, // Stage 24
  });
  broadcastNpcState(npc.area);
  if (npc.hp <= 0) {
    // Kill: drops land, the creature respawns on its def's timer.
    // If the creature's last swing also dropped the player, the
    // kill still counts (duel-style both-resolve tick) and the
    // player still wakes in the plaza.
    npc.alive = false; npc.hp = 0; npc.respawnAt = Date.now() + npc.respawnMs;
    const drops = rollNpcDrops(profile, npc);
    completeStarterGoal(fight.playerKey, 'kill_monster'); // Stage 20: first NPC kill (goblin / wizard / ranger)
    save(fight.playerKey);
    const playerDead = fight.hpYou <= 0;
    finishNpcFight(fight, 'kill', drops);
    broadcastNpcState(npc.area);
    if (playerDead) respawnPlayer(fight.playerKey, `You took the ${npc.name.toLowerCase()} down with you — you wake up in the plaza. Nothing lost.`);
    return;
  }
  if (fight.hpYou <= 0) {
    npc.hp = npc.maxHp; // the creature resets when it wins
    finishNpcFight(fight, 'death', null);
    broadcastNpcState(npc.area);
    respawnPlayer(fight.playerKey, `The ${npc.name.toLowerCase()} got you! You wake up in the plaza at full health. Nothing lost.`);
  }
}

// NPC respawns: after their def's respawnMs, back at full HP on
// their spawn point (goblins 10s, wizards/rangers 12s — Stage 19).
setInterval(() => {
  const touched = new Set();
  for (const npc of npcs.values()) {
    if (!npc.alive && Date.now() >= npc.respawnAt) { npc.alive = true; npc.hp = npc.maxHp; touched.add(npc.area); }
  }
  for (const a of touched) broadcastNpcState(a);
}, 1000);

// ---------- Barrows (Stage 5, rebuilt Stage 28) ----------
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
// Stage 28 rebuilt the minigame around the app (artifact) version's
// structure, on Derek's "all three" + "Everything" decisions:
//   - LAYOUT: every mound leads into a crypt (ONE room, reused for
//     all six, as in the app) with a sarcophagus at its centre.
//     Searching the sarcophagus starts the fight IN the crypt, the
//     brother spawning right beside the player (see
//     barrowsBrotherSpawn). One randomised crypt per run is the
//     TUNNEL crypt: its sarcophagus is the way DOWN, not a fight —
//     its brother is never fought in his crypt. A slain brother's
//     mound offers no crypt action until the run completes, but the
//     tunnel mound always lets you in and down.
//   - The tunnels are a MAZE (entry room, corridor, middle band,
//     puzzle-door corridor, chest room) — see TUNNEL_ROOMS. The
//     puzzle door is the app's pattern puzzle (a shape sequence
//     with its last shape missing; pick it from three options) and
//     a WRONG answer bites for exactly 5 HP off the tunnel HP pool
//     (sess.barrowsHp, dealt on descent, spent by the bite and by
//     the ambush fight). The tunnel brother may AMBUSH at the
//     puzzle door (a coin flip the first time you pass it) and is
//     GUARANTEED to spring when you enter the chest room — or when
//     you try the chest itself, the old guard trigger, kept as a
//     backstop. The chest guard fight is gone; the ambush IS the
//     guard. Loot follows the app's table (see rollBarrowsLoot).
//   - FIGHTS: the brothers keep their online mechanics (below) under
//     the Stage 27 Deflect system, plus the app's drains: Ahrim's
//     landed hits can sap Strength, Karil's can sap Attack (30%
//     each, -1 a time, capped at 5, until you return to the plaza),
//     and Torag's landed hits drain your run (see the tick). Prayer
//     drains at DOUBLE rate while you are in the tunnels.
//   - NO GETTING STUCK (Derek, explicit): brothers MOVE now — a
//     melee brother steps toward the player each tick and slides
//     around the sarcophagus / chest via the same push-out the app
//     uses (barrowsBrotherCollide), and every spawn point is
//     validated clear, so a brother always reaches the player.
//
// Run state is SAVED on the profile (profile.barrows): the brothers
// killed this round, which crypt is the tunnel entrance, and —
// Stage 28 — whether the puzzle door has been solved. Leaving
// mid-run — walking out, logging out, even DYING — keeps all of it
// until the round is finished at the chest (Derek's rule).
//
// Brother tuning — combat levels are the OSRS ones (115 / 98); HP,
// accuracy and max hit are this port's tuning, in line with the
// Fight Caves': ~100 HP. Cadence since Stage 12 is the shared OSRS
// swing timer: every brother swings once per MELEE_SPEED ticks
// (a simplification — in OSRS their weapon speeds vary). A mid-level
// player (HP pool 30-60) with food and the right Deflect prayer wins
// comfortably; without prayer the incoming damage is real but
// survivable on food. Mechanics per Derek's 2026-11-13 spec, exactly:
//   - The matching Deflect prayer stops a brother's hit entirely
//     and bounces a quarter of the rolled damage back onto him
//     (Melee for Dharok/Guthan/Torag/Verac, Magic for Ahrim, Missiles
//     for Karil). Verac has NO prayer bypass — Derek removed it.
//   - Dharok's max hit scales with his missing health: 8 at full HP
//     up to 20 (2.5x) at near-death, with rage warnings in the tick
//     note as he crosses 75% / 50% / 25% HP.
//   - Guthan heals himself for the damage of a connecting hit, 25%
//     of the time (the green swirl — here: the heal + a note).
//   - Torag swings two hammers: two independent hit rolls per swing.
const BARROWS_BROTHERS = {
  dharok: { id: 'dharok', name: 'Dharok the Wretched', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 8, acc: 0.60, mound: { x: 300, y: 220 } },
  guthan: { id: 'guthan', name: 'Guthan the Infested', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 9, acc: 0.60, mound: { x: 660, y: 160 } },
  torag:  { id: 'torag', name: 'Torag the Corrupted', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 7, acc: 0.60, mound: { x: 1020, y: 160 } },
  verac:  { id: 'verac', name: 'Verac the Defiled', combatLevel: 115, attackType: 'melee', maxHp: 100, maxHit: 10, acc: 0.62, mound: { x: 1320, y: 220 } },
  ahrim:  { id: 'ahrim', name: 'Ahrim the Blighted', combatLevel: 98, attackType: 'magic', maxHp: 90, maxHit: 11, acc: 0.60, mound: { x: 480, y: 440 } },
  karil:  { id: 'karil', name: 'Karil the Tainted', combatLevel: 98, attackType: 'missiles', maxHp: 90, maxHit: 11, acc: 0.62, mound: { x: 1120, y: 440 } },
};
// Stage 28 geometry (server units, 1600x900 world). The crypt is
// one room reused for all six brothers (the app's structure): a
// sarcophagus at its centre, the player enters at the south end,
// and the tunnel mouth sits in the north wall of the tunnel crypt.
const CRYPT_ROOM = { x0: 560, x1: 1040, y0: 140, y1: 660 };
const CRYPT_SARCO = { x: 800, y: 400, hx: 36, hy: 56 }; // solid stone coffin (centre + half-extents)
const CRYPT_SPAWN = { x: 800, y: 600 };
const CRYPT_MOUTH = { x: 800, y: 155 }; // tunnel entrance, in the tunnel crypt only
const TUNNEL_LADDER = { x: 860, y: 800 }; // up to the field, above the tunnel mound
// The tunnels maze: an entry room (ladder), a corridor north, a
// middle band, a second corridor with the puzzle door across it,
// and the chest room at the top. Room rects (x0..x1, y0..y1); the
// client mirrors them for walls and collision.
const TUNNEL_ROOMS = [
  { x0: 680, x1: 920, y0: 690, y1: 860 },  // entry room (ladder at 860,800)
  { x0: 764, x1: 836, y0: 470, y1: 690 },  // corridor A
  { x0: 250, x1: 1360, y0: 385, y1: 475 }, // middle band (coffins west)
  { x0: 764, x1: 836, y0: 215, y1: 385 },  // corridor B — the puzzle door bars it at y 378..392
  { x0: 580, x1: 1020, y0: 60, y1: 215 },  // chest room
];
const TUNNEL_DOOR = { x0: 764, x1: 836, y0: 378, y1: 392 };
const BARROWS_CHEST = { x: 800, y: 120 }; // in the chest room (was the tunnels spawn, pre-Stage-28)
const TUNNEL_CHEST_SOLID = { x: 800, y: 120, hx: 46, hy: 30 };
const barrowsFights = new Map(); // id -> fight (instanced, one per player)

function barrowsStateMsg(sess) {
  ensureV2(sess.profile);
  const b = sess.profile.barrows;
  return {
    type: 'barrows_state', kills: [...b.kills], tunnel: b.tunnel, inTunnels: sess.area === 'barrows_tunnels',
    // Stage 28: which brother's crypt the player is standing in
    // (null outside the crypt), whether they are in the crypt at
    // all, and the run's puzzle state (the client hides the door
    // bars once it is solved).
    crypt: sess.barrowsCrypt || null, inCrypt: sess.area === 'barrows_crypt',
    puzzleSolved: !!b.puzzleSolved,
    runs: sess.profile.barrowsRuns || 0, // Stage 28b: completed runs (the tracker shows it, like the app's Barrows HUD)
  };
}
// Stage 28: the app's brotherSpawnPoint, in server units — a brother
// always spawns NEXT TO the player: step from the player toward the
// thing he guards (sarcophagus / chest) by the smaller of 30 units
// or 55% of the distance, clamp inside the room, then push out of
// solids so nobody wedges on the sarcophagus. If that somehow lands
// out of melee reach (a big solid between), try ring points around
// the player instead. The fight therefore starts immediately, in
// reach, on verified-clear floor.
function barrowsBoxPushOut(x, y, box) {
  const dx = x - box.x, dy = y - box.y;
  const px = box.hx - Math.abs(dx), py = box.hy - Math.abs(dy);
  if (px <= 0 || py <= 0) return { x, y };
  if (px < py) return { x: box.x + (dx < 0 ? -box.hx : box.hx), y };
  return { x, y: box.y + (dy < 0 ? -box.hy : box.hy) };
}
function barrowsClampToArea(x, y, area) {
  if (area === 'barrows_crypt') {
    return { x: Math.max(CRYPT_ROOM.x0 + 14, Math.min(CRYPT_ROOM.x1 - 14, x)), y: Math.max(CRYPT_ROOM.y0 + 14, Math.min(CRYPT_ROOM.y1 - 14, y)) };
  }
  if (area === 'barrows_tunnels') {
    // Brothers only ever fight in the chest room (the ambush) — keep
    // them in the room containing their position.
    for (const r of TUNNEL_ROOMS) if (x >= r.x0 - 20 && x <= r.x1 + 20 && y >= r.y0 - 20 && y <= r.y1 + 20) {
      return { x: Math.max(r.x0 + 14, Math.min(r.x1 - 14, x)), y: Math.max(r.y0 + 14, Math.min(r.y1 - 14, y)) };
    }
    return { x: Math.max(40, Math.min(WORLD_W - 40, x)), y: Math.max(40, Math.min(WORLD_H - 40, y)) };
  }
  return { x: Math.max(20, Math.min(WORLD_W - 20, x)), y: Math.max(20, Math.min(WORLD_H - 20, y)) };
}
function barrowsBrotherCollide(x, y, area) {
  let p = { x, y };
  if (area === 'barrows_crypt') p = barrowsBoxPushOut(p.x, p.y, CRYPT_SARCO);
  if (area === 'barrows_tunnels') p = barrowsBoxPushOut(p.x, p.y, TUNNEL_CHEST_SOLID);
  return barrowsClampToArea(p.x, p.y, area);
}
function barrowsBrotherSpawn(me, guardX, guardY, area) {
  const dist = Math.hypot(guardX - me.x, guardY - me.y);
  const step = Math.min(30, dist * 0.55);
  let bx = me.x, by = me.y;
  if (dist > 1) { bx += (guardX - me.x) / dist * step; by += (guardY - me.y) / dist * step; }
  const p = barrowsBrotherCollide(bx, by, area);
  if (Math.hypot(p.x - me.x, p.y - me.y) <= MELEE_REACH) return p;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const q = barrowsBrotherCollide(me.x + Math.cos(a) * 30, me.y + Math.sin(a) * 30, area);
    if (Math.hypot(q.x - me.x, q.y - me.y) <= MELEE_REACH) return q;
  }
  return p; // best effort — the tick's approach steering closes the rest
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
// Stage 28: the fight now starts where the player stands — the
// brother spawns adjacent (barrowsBrotherSpawn) and MOVES with the
// fight (fight.bx/by; the tick steers him). anchorX/anchorY remain
// as the spawn point for the messages that read them (Stage 24
// button casts validate against the anchor). opts.hpYou deals the
// fight from a carried pool (the tunnel ambush spends the tunnel HP
// pool); opts.pool marks that fight so its remaining HP is written
// back to the pool when it ends.
function startBarrowsFight(key, def, area, guardX, guardY, opts = {}) {
  const sess = online.get(key);
  const profile = sess.profile;
  const id = crypto.randomBytes(6).toString('hex');
  // Fight HP pool = the player's Hitpoints level (same as NPC fights).
  const maxHpYou = Math.max(1, levelForXp(profile.xp.hitpoints));
  const spawn = barrowsBrotherSpawn(sess, guardX, guardY, area);
  const fight = {
    id, playerKey: key, brother: def.id, name: def.name, combatLevel: def.combatLevel,
    attackType: def.attackType, area, anchorX: spawn.x, anchorY: spawn.y, bx: spawn.x, by: spawn.y,
    hpYou: opts.hpYou != null ? Math.max(1, Math.min(maxHpYou, opts.hpYou)) : maxHpYou, maxHpYou, hpNpc: def.maxHp, maxHpNpc: def.maxHp,
    pool: !!opts.pool,
    specialQueued: false, done: false, timer: null, tickCount: 0, rageFlags: {},
    nextSwingYou: swingSpeed(attackStyleOf(profile)), nextSwingNpc: MELEE_SPEED, npcUnlocked: false, // Stage 12 swing timers + retaliate lock (Stage 19: first swing at the wielded style's speed)
    lastRefuseTick: -99, // Stage 19: throttles out-of-arrows/runes notes
  };
  barrowsFights.set(id, fight);
  sess.barrowsFightId = id;
  send(sess.ws, {
    type: 'npc_fight', phase: 'start', npcId: def.id, kind: 'barrows', name: def.name, combatLevel: def.combatLevel,
    hpYou: fight.hpYou, maxHpYou, hpNpc: fight.hpNpc, maxHpNpc: fight.maxHpNpc, energyYou: profile.specialEnergy,
    bx: fight.bx, by: fight.by, // Stage 28: the brother's spawn point (adjacent to the player)
  });
  fight.timer = setInterval(() => barrowsTick(fight), TICK_MS);
}
function finishBarrowsFight(fight, reason) {
  if (fight.done) return;
  fight.done = true;
  clearInterval(fight.timer);
  barrowsFights.delete(fight.id);
  const sess = online.get(fight.playerKey);
  // Stage 28: a tunnel (ambush) fight spends the tunnel HP pool —
  // whatever health the player had left is the pool they keep
  // exploring with (on death the pool is spent entirely).
  if (fight.pool && sess) sess.barrowsHp = reason === 'death' ? 0 : Math.max(0, fight.hpYou);
  if (reason === 'kill') {
    // The kill is banked on the SAVED run state at once — it survives
    // walking out, logging out and dying later in the round.
    const u = db.users[fight.playerKey];
    if (u) {
      ensureV2(u.profile);
      if (!u.profile.barrows.kills.includes(fight.brother)) u.profile.barrows.kills.push(fight.brother);
      save(fight.playerKey);
    }
    // Stage 20: a brother kill is a monster kill AND a collection
    // log entry (the brother ids are the clog ids).
    completeStarterGoal(fight.playerKey, 'kill_monster');
    recordClog(fight.playerKey, fight.brother);
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
  // Stage 28: the fight breaks off when the player leaves the area
  // or walks beyond NPC_RANGE of the BROTHER (he moves now — the
  // range is measured against his live position, not a fixed
  // anchor, so fleeing still breaks it off and chasing still works).
  if (sess.area !== fight.area || Math.hypot(sess.x - fight.bx, sess.y - fight.by) > NPC_RANGE) { finishBarrowsFight(fight, 'range'); return; }
  fight.tickCount += 1;
  const notes = [];

  // Stage 28: brother movement (the app's approach steering). A
  // melee brother who is out of reach steps toward the player by
  // APPROACH_STEP, then collides (barrowsBrotherCollide pushes him
  // out of the sarcophagus / chest and clamps him inside the room),
  // so he slides around the coffin and always reaches the player —
  // nobody gets stuck. A frozen brother (Stage 24) holds position.
  // Karil (missiles) and Ahrim (magic) stay put and shoot, as they
  // always have.
  const brotherFrozen = fight.brotherFrozenUntil && fight.brotherFrozenUntil > Date.now();
  if (def.attackType === 'melee' && !brotherFrozen) {
    const d0 = Math.hypot(sess.x - fight.bx, sess.y - fight.by);
    if (d0 > MELEE_REACH) {
      const step = Math.min(APPROACH_STEP, d0);
      const nx = fight.bx + (sess.x - fight.bx) / d0 * step;
      const ny = fight.by + (sess.y - fight.by) / d0 * step;
      const p = barrowsBrotherCollide(nx, ny, fight.area);
      fight.bx = p.x; fight.by = p.y;
    }
  }
  // Stage 8/28: melee adjacency, now measured against the brother's
  // live position. If the player is not standing next to him, a
  // MELEE player's swing cannot happen this tick (a CLOSING tick:
  // youHit null, a queued special stays queued, the guardian holds
  // off, and the tick tells the player where to walk — the brother
  // is walking toward them too). A melee brother is gated the same
  // way below; Karil (missiles) and Ahrim (magic) keep hitting at
  // any range inside NPC_RANGE, as they always have. Stage 19:
  // `closing` still measures MELEE adjacency (it gates melee
  // brothers and the guardian), but the player's own swing keys off
  // their weapon's reach — see playerInReach below.
  const closing = Math.hypot(sess.x - fight.bx, sess.y - fight.by) > MELEE_REACH;
  const ally = helperAlly(fight.playerKey, sess.area);
  let useSpec = false;
  let youHit = null; // null when the player never swung (closing, or the swing is not due yet)
  let youOutcome = null; // the player's swing outcome (Stage 12 clarity)
  let youBonus = 0; // Stage 27: the player's Accurate bonus hit this tick
  // Stage 19: the player's swing is gated on the reach of THEIR
  // wielded style, not on melee adjacency — a bow or staff fights
  // a brother from up to NPC_RANGE away (the fight itself still
  // breaks off beyond NPC_RANGE from the brother, checked above).
  // For a melee player playerInReach is exactly !closing, so melee
  // behaviour is unchanged. The Tree Guardian and Dharok's rage
  // stay inside !closing below: the guardian is a melee ally.
  const pStyleB = attackStyleOf(profile);
  const playerInReach = Math.hypot(sess.x - fight.bx, sess.y - fight.by) <= styleRange(pStyleB);
  // Stage 28: the app's stat drains ride on the player's swings — a
  // player whose Attack / Strength have been sapped rolls with a
  // drained copy of their profile (the app's effAtk/effStr): the
  // attack/strength XP in the copy is set to the drained level, so
  // every roll formula (accuracy, max hit) reads the lower level.
  // The copy shares the backpack/worn references, so arrow and rune
  // consumption still lands on the real profile.
  let rollProfile = profile;
  if ((sess.accDrain || 0) > 0 || (sess.strDrain || 0) > 0) {
    rollProfile = { ...profile, xp: { ...profile.xp } };
    const lv = levelsOf(profile);
    if (sess.accDrain > 0) rollProfile.xp.attack = XP_TABLE[Math.max(1, lv.attack - sess.accDrain)];
    if (sess.strDrain > 0) rollProfile.xp.strength = XP_TABLE[Math.max(1, lv.strength - sess.strDrain)];
  }
  if (playerInReach) {
    // Stage 12: OSRS swing timer — the player swings once per
    // weapon-speed, the first swing one weapon-speed after
    // engagement; on other in-reach ticks youHit stays null and a
    // queued special stays queued for the due swing. Stage 19: the
    // swing resolves through the style dispatcher (ranged consumes
    // an arrow, magic consumes runes; a refused swing consumes
    // nothing, leaves the timer and the queued special untouched,
    // and its reason rides the note, throttled).
    if (fight.tickCount >= (fight.nextSwingYou || MELEE_SPEED)) {
      const atkRes = rollStyleAttack(rollProfile, NPC_DEFENDER, fight.specialQueued); // Stage 28: drained copy when Ahrim/Karil have sapped you
      if (atkRes.refused) {
        if (fight.tickCount - (fight.lastRefuseTick || -99) >= 8) { notes.push(atkRes.refused); fight.lastRefuseTick = fight.tickCount; }
      } else {
        fight.nextSwingYou = fight.tickCount + swingSpeed(atkRes.style);
        useSpec = fight.specialQueued; fight.specialQueued = false;
        if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
        youHit = atkRes.dmg;
        youBonus = atkRes.bonusDmg || 0;
        youOutcome = atkRes.outcome;
        notes.push(...atkRes.notes);
        fight.hpNpc -= youHit + youBonus;
        addXp(fight.playerKey, swingXpGains(profile.style, atkRes.style, atkRes.dmg + youBonus, atkRes.spell));
        if (youHit + youBonus > 0) profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
        // Stage 12 retaliate unlock: the brother's swings stay
        // locked until the player's first CONNECTED swing lands
        // on him — then he unlocks, his first swing one
        // weapon-speed later.
        if (atkRes.connected && !fight.npcUnlocked) {
          fight.npcUnlocked = true;
          fight.nextSwingNpc = fight.tickCount + MELEE_SPEED;
        }
      }
    }
  }
  if (!closing) {
    // Stage 6: a Tree Guardian fighting beside its owner swings at
    // the brother every 2nd tick (its own cadence, unchanged by
    // Stage 12). No XP.
    if (ally && fight.tickCount % 2 === 0) {
      const allyDmg = allyDamage(ally);
      fight.hpNpc -= allyDmg;
      notes.push(`🌳 ${ally.name} hits for ${allyDmg}!`);
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
  let npcDeflected = 0; // Stage 27: damage the player's Deflect prayer bounces back onto the brother this tick
  if (!brotherGated && fight.npcUnlocked && fight.tickCount >= (fight.nextSwingNpc || MELEE_SPEED)) {
    fight.nextSwingNpc = fight.tickCount + MELEE_SPEED;
    npcHit = 0;
    // Stage 27: each hammer resolves in the app version's order —
    // accuracy, the rolled damage (Dharok's rage scaling included),
    // the player's Deflect prayer, the Defensive style proc, worn
    // armour. A matching Deflect stops that hammer ENTIRELY and
    // bounces max(1, ceil(raw x 0.25)) back onto the brother — it
    // can kill him, and a deflected hit never heals Guthan (his
    // swirl below keys off npcHit > 0). Verac is answered like
    // every other brother — NO bypass: Derek's standing online
    // ruling, and the app's Barrows has no Verac exception either.
    const swings = def.id === 'torag' ? 2 : 1; // Torag's two hammers: two independent rolls
    let styleBlocked = false;
    let anyConnected = false; // a hammer was on target (even if armour absorbed it whole)
    let anyDeflected = false;
    const throughs = []; // Stage 28: per-hammer damage that actually got through (the drains key off it)
    for (let sIdx = 0; sIdx < swings; sIdx++) {
      if (Math.random() > def.acc) { throughs.push(0); continue; }
      anyConnected = true;
      let maxHit = def.maxHit;
      // Dharok: +150% of base spread over his missing health (8 -> 20).
      if (def.id === 'dharok') maxHit = Math.round(def.maxHit * (1 + 1.5 * (1 - Math.max(0, fight.hpNpc) / fight.maxHpNpc)));
      const raw = 1 + Math.floor(Math.random() * maxHit);
      const dfl = monsterDeflect(profile, def.attackType, raw);
      if (dfl > 0) { npcDeflected += dfl; anyDeflected = true; throughs.push(0); continue; }
      if (Math.random() < styleBlockChance(profile)) { styleBlocked = true; throughs.push(0); continue; }
      const through = Math.floor(raw * (1 - armourReduction(profile)));
      npcHit += through;
      throughs.push(through);
    }
    // Stage 28: the app's brother drains, applied ONLY on damage
    // that actually lands (the app checks dmg > 0 after prayer and
    // armour — a deflected or blocked hit never triggers them):
    //   - Torag: EVERY landed hammer drains run energy. Online has
    //     no run-energy pool, so the analogue: your run is drained
    //     for 5 seconds — the client walks (it cannot run) while
    //     runDrainedUntil is in the future, and each new landed
    //     hammer refreshes it. (App: -15 of a 100 pool that regens
    //     3.2/s, i.e. about 4.7 seconds of lost running.)
    //   - Ahrim: 30% per landed hit, Strength -1 (cap 5).
    //   - Karil: 30% per landed hit, Attack -1 (cap 5).
    // The stat drains lower your effective Attack/Strength in
    // Barrows fights (see rollProfile above) and clear when you
    // return to the plaza — the app clears them on plaza entry too.
    for (const through of throughs) {
      if (through <= 0) continue;
      if (def.id === 'torag') {
        sess.runDrainedUntil = Date.now() + 5000;
        send(sess.ws, { type: 'run_drained', until: sess.runDrainedUntil });
        if (!notes.some((n) => n.includes('run energy'))) notes.push('💨 Torag drains your run energy — you can only walk for a few seconds!');
      } else if (def.id === 'ahrim' && Math.random() < 0.30 && (sess.strDrain || 0) < 5) {
        sess.strDrain = (sess.strDrain || 0) + 1;
        notes.push(`🌀 Ahrim's magic saps your Strength! (Strength -${sess.strDrain})`);
      } else if (def.id === 'karil' && Math.random() < 0.30 && (sess.accDrain || 0) < 5) {
        sess.accDrain = (sess.accDrain || 0) + 1;
        notes.push(`🌀 Karil's bolts sap your Attack! (Attack -${sess.accDrain})`);
      }
    }
    // One outcome for the whole swing: damage through = 'hit';
    // on target but fully stopped (prayer / style block / armour)
    // = 'blocked'; every hammer off target = 'miss'.
    npcOutcome = npcHit > 0 ? 'hit' : (styleBlocked || anyConnected || anyDeflected) ? 'blocked' : 'miss';
    if (styleBlocked && npcHit === 0 && swings > 0) notes.push(`Blocked by your ${cap(profile.style)} style!`);
    fight.hpNpc -= npcDeflected;
    // Guthan's swirl: a connecting hit (damage got through) has a
    // 25% chance to heal him for what he dealt — never from the dead.
    if (def.id === 'guthan' && npcHit > 0 && fight.hpNpc > 0 && Math.random() < 0.25) {
      fight.hpNpc = Math.min(fight.maxHpNpc, fight.hpNpc + npcHit);
      notes.push(`Guthan's warspear glows green — he heals for ${npcHit}!`);
    }
  }
  // Stage 6: the guardian sometimes takes a connecting brother hit
  // instead — only a hit that actually got through (a Deflect-prayed
  // hit leaves npcHit at 0, and there is nothing to take).
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
    // Stage 27: youBonus = my Accurate bonus on the brother;
    // npcDeflected = damage my Deflect prayer bounced back onto him.
    youBonus, npcDeflected,
    note: notes.length ? notes.join(' ') : undefined,
    npcFrozenUntil: (fight.brotherFrozenUntil && fight.brotherFrozenUntil > Date.now()) ? fight.brotherFrozenUntil : 0, // Stage 24: Freeze roots the brother (Stage 28: he moves now, so the root is real) — tracked and broadcast like everywhere else
    // Stage 28: the brother's live position (he walks toward the
    // player) and the drain state (Ahrim/Karil stat saps, Torag's
    // run drain deadline) ride every tick.
    bx: fight.bx, by: fight.by,
    drains: { accDrain: sess.accDrain || 0, strDrain: sess.strDrain || 0, runDrainedUntil: sess.runDrainedUntil || 0 },
    // Stage 8: on a closing tick, where to walk to reach the brother.
    // Stage 19: "closing" is measured against the PLAYER's style
    // reach — a ranged/magic player inside 150 is fighting, not
    // closing, and is never auto-walked into melee range.
    ...(!playerInReach ? { closing: true, moveTo: approachPoint(sess.x, sess.y, fight.bx, fight.by) } : {}),
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
// Stage 28: the tunnels puzzle door, ported from the app version —
// a shape pattern with its LAST shape missing: one of four pattern
// families over six shapes, the door shows the pattern minus its
// last shape and offers three options (the answer and two random
// others). Answering WRONG costs exactly 5 HP off the tunnel HP
// pool and the SAME puzzle stays open (the app's rule — the old
// online door dealt a fresh 3-symbol combination instead and only
// cost an error message). Solving it is saved on the run.
const BARROWS_PUZZLE_SHAPES = ['🔺', '🔵', '🟥', '⭐', '🌙', '💠'];
function newBarrowsPuzzle(sess) {
  const shuffled = [...BARROWS_PUZZLE_SHAPES].sort(() => Math.random() - 0.5);
  const [a, b, c] = shuffled;
  const patterns = [
    [a, b, a, b, a],
    [a, a, b, a, a, b, a],
    [a, b, c, a, b, c, a],
    [c, b, a, c, b, a, c],
  ];
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  const answer = pattern[pattern.length - 1];
  const options = [answer];
  for (const s of shuffled) { if (options.length >= 3) break; if (!options.includes(s)) options.push(s); }
  options.sort(() => Math.random() - 0.5);
  sess.barrowsPuzzle = { shown: pattern.slice(0, -1), answer, options };
  return { type: 'barrows_puzzle', shown: [...sess.barrowsPuzzle.shown, '❓'], options };
}
// Stage 28: the chest's loot, ported from the app version's table.
// rolls = kills + 1 (7 with all six brothers). Each roll has a
// 1/(450 − 58×kills) chance of a Barrows piece — exactly the app's
// per-kill-count table [1/392, 1/334, 1/276, 1/218, 1/160, 1/102]
// for kills 1..6 — drawn from the combined piece pool: the six
// weapons plus the seven armour pieces above. A roll that is not a
// piece pays the app's filler: 45% coins (250-800), 20% a prayer
// potion, 20% a restore potion, 15% two food rations. With ZERO
// kills there are no rolls at all — just 50-150 pity coins (the
// app's rule). NOT ported, deliberately: the app's second, separate
// "Barrows tier" prize roll (a wear-gated decayed armour line) is
// part of its earned-gear progression system, which has no online
// analogue; and the app's duplicate-piece conversion (1200 coins)
// exists because its pieces are earned flags, not physical items —
// online pieces are real items, so duplicates are normal loot.
const BARROWS_WEAPONS = ['dharoks_greataxe', 'guthans_warspear', 'torags_hammers', 'veracs_flail', 'ahrims_staff', 'karils_crossbow'];
const BARROWS_PIECES = [...BARROWS_WEAPONS, ...BARROWS_ARMOUR_PIECES];
function rollBarrowsLoot(profile, killCount) {
  const items = [];
  const rares = []; // Stage 28: every piece rolled (each lands as its own loot-beam pile)
  const lines = []; // one breakdown line per roll, for the loot message
  let gold = 0;
  const give = (item, qty) => {
    const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(profile.bank, item, leftover); // full pack: bank it, never lose loot
    items.push({ item, qty });
  };
  if (killCount <= 0) {
    gold = randiRange(50, 150);
    addGold(profile, gold); // Stage 16: the coins land on the coin stack
    lines.push({ kind: 'coins', gold });
    return { gold, items, rares, lines, rolls: 1 };
  }
  // Stage 28b (the app's structure, Derek's rules): the tier line
  // rolls ONCE, separately, BEFORE the brother-piece rolls — only
  // on a full 6/6 clear, at 1-in-20, at most one piece per chest
  // (see barrowsTierGrant for the earned ladder). It never displaces
  // a brother-piece roll. If the eligible tier is already fully
  // earned, the prize pays 1200 coins instead (the app's fallback).
  if (killCount === 6 && Math.random() < 1 / 20) {
    const piece = barrowsTierGrant(profile);
    if (piece) { rares.push(piece); lines.push({ kind: 'tierpiece', item: piece }); }
    else { gold += 1200; addGold(profile, 1200); lines.push({ kind: 'tiercoins', gold: 1200 }); }
  }
  const rolls = killCount + 1;
  const pieceChance = 1 / (450 - 58 * killCount);
  for (let roll = 0; roll < rolls; roll++) {
    if (Math.random() < pieceChance) {
      const piece = BARROWS_PIECES[Math.floor(Math.random() * BARROWS_PIECES.length)];
      rares.push(piece);
      lines.push({ kind: 'piece', item: piece });
      continue;
    }
    const r = Math.random();
    if (r < 0.45) {
      const g = randiRange(250, 800);
      gold += g;
      addGold(profile, g);
      lines.push({ kind: 'coins', gold: g });
    } else if (r < 0.65) { give('prayer_potion', 1); lines.push({ kind: 'item', item: 'prayer_potion', qty: 1 }); }
    else if (r < 0.85) { give('restore_potion', 1); lines.push({ kind: 'item', item: 'restore_potion', qty: 1 }); }
    else { give('ration', 2); lines.push({ kind: 'item', item: 'ration', qty: 2 }); }
  }
  return { gold, items, rares, lines, rolls };
}
// Stage 28: the tunnel brother's AMBUSH — he springs on the player
// in the tunnels, beside them, on clear floor by the chest he
// guards, and the fight spends the tunnel HP pool. Called from the
// move handler (entering the chest room guarantees it; passing the
// puzzle door rolls it) and from barrows_loot as a backstop.
function startBarrowsAmbush(key) {
  const sess = online.get(key);
  if (!sess || sess.area !== 'barrows_tunnels' || sess.barrowsFightId) return false;
  ensureBarrowsRun(key);
  const b = sess.profile.barrows;
  if (!b.tunnel || b.kills.includes(b.tunnel)) return false;
  const def = BARROWS_BROTHERS[b.tunnel];
  if (sess.barrowsHp == null) sess.barrowsHp = Math.max(1, levelForXp(sess.profile.xp.hitpoints));
  startBarrowsFight(key, def, 'barrows_tunnels', BARROWS_CHEST.x, BARROWS_CHEST.y, { hpYou: sess.barrowsHp, pool: true });
  send(sess.ws, { type: 'chat', from: 'Game', text: `${def.name} bursts from the shadows — ambush! He was waiting in the tunnels all along!` });
  return true;
}

// ---------- Fight Caves (Stage 4): Derek's 63-wave OSRS table ----------
// Instanced per player: every runner gets their own monster roster
// inside the shared 'fightcaves' area (other players in the area just
// see each other walk around). Combat reuses the goblin engine's rolls
// (rollHit vs NPC_DEFENDER, combatXpGains) and the Stage 1 prayer rule
// as Stage 27 restated it: a Deflect prayer stops a monster hit of
// the matching attack type entirely and bounces a quarter of the
// rolled damage back onto the monster. The player's HP pool is
// their Hitpoints level, like NPC fights.
// Runs are session-only state; the RECORDS live on the profile (fc).
// Monster tuning — the combat levels are Derek's exact table; HP, max
// hit, accuracy and attack cadence (in 0.6s ticks) are this port's
// tuning, kept in line with the Muse game:
//   Tz-Kih 22: on a CONNECTING hit it also drains 2 prayer points —
//     OSRS-style, Deflect from Melee turns the damage back on the
//     Tz-Kih but not the drain; only a Defensive-style proc block
//     or an outright miss avoids it.
//   Tz-Kek 45: splits into two small Tz-Kek (22) when it dies.
//   Yt-MejKot 180: on its attack tick, a 25% chance to heal ITSELF for
//     10 HP instead of attacking (a simplification of OSRS behaviour).
//   TzTok-Jad 702: attacks strictly alternate missiles / magic (first
//     one random). Each attack is TELEGRAPHED ({type:'fc_telegraph'})
//     one tick before it lands, and the pending hit resolves against
//     the prayer active AT RESOLUTION TIME: matching Deflect = 0
//     damage to the player and a quarter of the rolled hit back
//     into Jad; wrong / no prayer = acc 0.75, max hit 30, armour applies.
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
  const now = Date.now();
  return [...run.monsters.values()].filter((m) => m.alive).map((m) => ({
    id: m.id, kind: m.kind, name: m.name, combatLevel: m.combatLevel,
    hp: Math.max(0, m.hp), maxHp: m.maxHp, x: m.x, y: m.y, attackType: m.attackType,
    frozenUntil: (m.frozenUntil && m.frozenUntil > now) ? m.frozenUntil : 0, // Stage 24: Freeze root rides the roster
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
  completeStarterGoal(run.playerKey, 'kill_monster'); // Stage 20: Fight Caves kills count for the starter goal too
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
  // the prayer active right now: Stage 27 — a matching Deflect prayer
  // turns a CONNECTED hit back on Jad himself (see below); the wrong
  // prayer (or none) eats the hit as always.
  if (run.jadPending) {
    const pending = run.jadPending;
    run.jadPending = null;
    const jad = run.monsters.get(pending.from);
    if (jad && jad.alive) {
      if (profile.activePrayer === pending.style) {
        // Deflect (the app version's jadDeflect): Jad's accuracy
        // still rolls — a miss stays a miss — but a connected hit
        // deals the PLAYER nothing and throws max(1, ceil(raw x
        // 0.25)) back into Jad. It can kill him outright (the
        // completion check below ends the run) and it can trip his
        // half-health healers, exactly like a player's own hit.
        let deflected = 0;
        if (Math.random() <= jad.acc) {
          const raw = 1 + Math.floor(Math.random() * jad.maxHit);
          deflected = monsterDeflect(profile, pending.style, raw);
          jad.hp -= deflected;
          if (jad.hp <= 0) killFcMonster(run, jad);
          else maybeSpawnFcHealers(run);
        }
        hitsTaken.push({ from: jad.id, kind: 'jad', dmg: 0, blocked: true, deflected });
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
  // Stage 8: melee adjacency for the player's swing — a target
  // beyond the player's reach cannot be hit, the swing is held, a
  // queued special stays queued, and the tick reports closing +
  // moveTo so the client walks the player in. Stage 19: the reach
  // is the wielded weapon's style range (melee 42 / ranged / magic
  // 150), and the swing resolves through the style dispatcher —
  // the caves' every-tick cadence is unchanged (a bow shoots or a
  // staff casts once per tick while in reach, as melee always
  // swung once per tick here). The ONE exception is Jad himself —
  // his fight is unchanged (Stage 4 rules), so swings at Jad keep
  // the old FC_RANGE reach for every style.
  let useSpec = false;
  let youHit = 0;
  let youBonus = 0; // Stage 27: the player's Accurate bonus hit this tick
  let fcClosing = false;
  if (target && !run.betweenWaves) {
    const tDist = Math.hypot(sess.x - target.x, sess.y - target.y);
    const inReach = target.kind === 'jad' ? tDist <= FC_RANGE : tDist <= styleRange(attackStyleOf(profile));
    if (!inReach) {
      fcClosing = true;
      youHit = null; // no swing happened (null, not 0 — see the closing contract)
      if (tDist > FC_RANGE) note = `Too far away from the ${target.name} — walk closer.`;
    } else {
      // Stage 19: a REFUSED swing (no arrows / no runes) consumes
      // nothing and holds the queued special; its reason rides the
      // tick note, throttled — FC swings every tick, so an
      // unthrottled refusal would spam.
      const atkRes = rollStyleAttack(profile, NPC_DEFENDER, run.specialQueued);
      if (atkRes.refused) {
        if (run.tickCount - (run.lastRefuseTick || -99) >= 8) { note = atkRes.refused; run.lastRefuseTick = run.tickCount; }
        youHit = null; // refused: no swing happened (null, not 0)
      } else {
        useSpec = run.specialQueued; run.specialQueued = false;
        if (useSpec) profile.specialEnergy = Math.max(0, profile.specialEnergy - SPECIAL_COST);
        // Stage 10: the style's level boosts ride along on the swing.
        // Stage 27: so does the Accurate bonus hit (youBonus) — it
        // lands on the target and earns XP like the main hit.
        youHit = atkRes.dmg;
        youBonus = atkRes.bonusDmg || 0;
        if (atkRes.notes.length) note = atkRes.notes.join(' ');
        target.hp -= youHit + youBonus;
        addXp(run.playerKey, swingXpGains(profile.style, atkRes.style, atkRes.dmg + youBonus, atkRes.spell));
        if (youHit + youBonus > 0) profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
        if (target.hp <= 0) killFcMonster(run, target);
        else if (target.kind === 'jad') maybeSpawnFcHealers(run);
      }
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
    if ((mon.frozenUntil || 0) > Date.now()) continue; // Stage 24: a Freeze-rooted monster holds its spot (it may still swing in reach, below)
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
    // Stage 27: the swing resolves in the app version's order —
    // accuracy, the rolled damage, the player's Deflect prayer
    // (a match stops the hit ENTIRELY and bounces max(1, ceil(raw
    // x 0.25)) back onto the monster — it can kill, Tz-Kek splits
    // included, and awards no XP), the Defensive style proc, worn
    // armour. Tz-Kih drains prayer on any CONNECTING hit that is
    // not style-blocked — through a Deflect prayer too (OSRS-style).
    let dmg = 0;
    let deflected = 0;
    let styleBlocked = false;
    let prayerBlocked = false;
    if (Math.random() <= mon.acc) {
      const raw = 1 + Math.floor(Math.random() * mon.maxHit);
      deflected = monsterDeflect(profile, mon.attackType, raw);
      if (deflected > 0) {
        prayerBlocked = true;
        if (mon.kind === 'tzkih') profile.prayerPoints = Math.max(0, profile.prayerPoints - 2);
        mon.hp -= deflected;
        if (mon.hp <= 0) killFcMonster(run, mon);
      } else if (Math.random() < styleBlockChance(profile)) {
        styleBlocked = true;
      } else {
        if (mon.kind === 'tzkih') profile.prayerPoints = Math.max(0, profile.prayerPoints - 2);
        dmg = Math.floor(raw * (1 - armourReduction(profile)));
      }
    }
    if (styleBlocked) anyStyleBlock = true;
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
    hitsTaken.push({ from: mon.id, kind: mon.kind, dmg, blocked: prayerBlocked || styleBlocked, ...(deflected > 0 ? { deflected } : {}) });
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
    youHit, youBonus, hitsTaken, energyYou: profile.specialEnergy,
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
    addGold(p, 500); // Stage 16: the coins land on the coin stack
    const leftover = addStacks(p.backpack, 'fire_cape', 1, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(p.bank, 'fire_cape', leftover); // full pack: bank it, never lose the cape
    reward = { gold: 500, item: 'fire_cape' };
    // Stage 20: the cape is a collection-log entry, and earning one
    // is announced to the whole game.
    recordClog(run.playerKey, 'fire_cape');
    announce(`🌋 ${p.username} just earned a Fire Cape!`);
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
      .map((p) => ({ id: p.id, item: p.item, qty: p.qty, x: Math.round(p.x), y: Math.round(p.y), owner: p.owner, rare: !!p.rare })), // Stage 20: rare piles (Barrows weapons) carry the loot-beam flag
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

// Prayer drain: 1 point per 3 seconds while a Deflect prayer is active
// (1/3 point per 1s tick). At 0 the prayer switches itself off.
// Stage 28 (the app's rule): prayer drains at DOUBLE rate while the
// player is in the Barrows tunnels (2/3 point per 1s tick there).
setInterval(() => {
  let anyOff = false;
  for (const [k, p] of online) {
    const prof = p.profile;
    if (!prof.activePrayer) continue;
    prof.prayerPoints = Math.max(0, prof.prayerPoints - (p.area === 'barrows_tunnels' ? 2 / 3 : 1 / 3));
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
  online.set(key, { ws, profile, x: 200 + Math.random() * 1000, y: 200 + Math.random() * 500, area: 'plaza', duelId: null, modDuelId: null, npcFightId: null, fcRunId: null, lastActionAt: 0, smithing: null, lastSmithHitAt: 0, lastReheatAt: 0, barrowsFightId: null, barrowsPuzzle: null, barrowsCrypt: null, barrowsHp: null, barrowsDoorRolled: false, accDrain: 0, strDrain: 0, runDrainedUntil: 0, actSkill: null, actAt: 0, castReadyAt: 0, frozenUntil: 0 }); // Stage 24: castReadyAt = placed-button cast cooldown; frozenUntil = Freeze root expiry. Stage 28: barrowsCrypt = which brother's crypt the player is in; barrowsHp = the tunnel HP pool; accDrain/strDrain/runDrainedUntil = the app's brother drains
  send(ws, { type: 'welcome', profile: publicProfile(profile), players: playersSnapshot('plaza'), area: 'plaza' });
  send(ws, modNpcsMsg()); // Stage 22: the three plaza moderators + their busy flags
  send(ws, modLadderMsg(profile)); // Stage 22: stake-ladder progress
  send(ws, pilesMsg('plaza')); // Stage 5: any drop piles waiting in the plaza
  send(ws, alliesMsg('plaza')); // Stage 6: any Tree Guardians standing in the plaza
  send(ws, objectsMsg('plaza')); // Stage 7D: any placed objects in the plaza
  send(ws, { type: 'catalog', items: catalogList(), shops: SHOPS, spells: SPELLS });
  send(ws, starterMsg(profile)); // Stage 20: starter-goal state
  send(ws, clogMsg(profile)); // Stage 20: collection-log state
  send(ws, { type: 'exchange_prices', goods: goodsList() });
  send(ws, stakeBoardMsg()); // Stage 17: the current Stake Board offers
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
      // Stage 22: a mod duel's countdown freezes the challenger the
      // same way — the fight opens toe-to-toe with the mod.
      const mdNow = me.modDuelId ? modDuels.get(me.modDuelId) : null;
      const mdFrozen = !!(mdNow && mdNow.tickCount <= COUNTDOWN_TICKS);
      // Stage 18: a No Movement duel locks both fighters at their
      // duel-start spots for the WHOLE duel, not just the countdown.
      // They spawn right next to each other inside melee reach
      // (787 vs 813 since Stage 26), so the standing fight works —
      // swings, specials and eating all carry on; only running away
      // is off the table.
      const noMove = !!(duelNow && duelNow.rules && duelNow.rules.noMovement);
      // Stage 24: a Freeze-rooted player's moves are ignored the
      // same way — they stay on the spot they're standing on until
      // the root expires. Attacking, eating, drinking and praying
      // are untouched; only movement stops.
      const selfFrozen = (me.frozenUntil || 0) > Date.now();
      if (!frozen && !noMove && !mdFrozen && !selfFrozen) {
        me.x = Math.max(0, Math.min(WORLD_W, +m.x || 0));
        me.y = Math.max(0, Math.min(WORLD_H, +m.y || 0));
      }
      // Stage 28: the tunnel brother's ambush. Entering the chest
      // room GUARANTEES it while he lives (the app's rule); the
      // first crossing of the puzzle-door line after solving rolls
      // a coin flip for it (the door roll is this port's addition).
      if (me.area === 'barrows_tunnels' && !me.barrowsFightId) {
        ensureV2(profile);
        const b = profile.barrows;
        if (b.tunnel && !b.kills.includes(b.tunnel)) {
          const chestRoom = TUNNEL_ROOMS[4];
          const inChestRoom = me.x > chestRoom.x0 && me.x < chestRoom.x1 && me.y >= chestRoom.y0 && me.y < chestRoom.y1;
          if (inChestRoom) startBarrowsAmbush(key);
          else if (b.puzzleSolved && !me.barrowsDoorRolled && me.y < TUNNEL_DOOR.y0) {
            me.barrowsDoorRolled = true;
            if (Math.random() < 0.5) startBarrowsAmbush(key);
          }
        }
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
      // Stage 17: the Waiting Area is not travel-reachable — only
      // the stake-match flow moves players in and out of it.
      if (to === 'waiting') return send(ws, { type: 'error', message: 'The Waiting Area is only for stake matches — ready up at the Stake Board.' });
      // Stage 28: the Barrows crypt is reached through a mound, not
      // by travel (its spawn would not know whose crypt it is).
      if (to === 'barrows_crypt') return send(ws, { type: 'error', message: 'Enter a crypt through its mound at the Barrows.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You cannot travel during a duel.' });
      if (me.modDuelId) return send(ws, { type: 'error', message: 'You cannot travel during a duel.' });
      // Stage 17: a player in a matched stake match cannot travel
      // (they are either about to ready up or standing in the
      // Waiting Area) — cancel the match first.
      if (stakeMatchForKey(key)) return send(ws, { type: 'error', message: 'You have a stake match waiting — ready up or cancel it at the Stake Board.' });
      if (me.npcFightId) { const f = npcFights.get(me.npcFightId); if (f) finishNpcFight(f, 'travel'); }
      // Stage 5: travelling abandons a Barrows crypt fight (kills kept).
      if (me.barrowsFightId) { const f = barrowsFights.get(me.barrowsFightId); if (f) finishBarrowsFight(f, 'travel'); }
      // Travelling out of the caves abandons a Fight Caves run (records kept).
      if (me.fcRunId) { const r = fcRuns.get(me.fcRunId); if (r) endFcRun(r, 'left'); }
      me.area = to;
      me.x = AREAS[to].spawn.x; me.y = AREAS[to].spawn.y;
      // Stage 28: travelling leaves any crypt/tunnel session scratch
      // behind (the run itself is saved on the profile and kept).
      me.barrowsCrypt = null; me.barrowsHp = null; me.barrowsPuzzle = null;
      // Stage 28 (the app's rule): Ahrim's and Karil's stat drains
      // clear when you return to the plaza.
      if (to === 'plaza') { me.accDrain = 0; me.strDrain = 0; me.runDrainedUntil = 0; }
      if (to !== 'plaza') completeStarterGoal(key, 'visit_area'); // Stage 20: first trip out of the plaza
      send(ws, { type: 'area', area: to });
      if (to === 'plaza') { send(ws, modNpcsMsg()); send(ws, modLadderMsg(profile)); } // Stage 22: the moderators stand in the plaza
      if (NPC_AREAS.includes(to)) send(ws, npcStateMsg(to));
      // Stage 2: every area entry also brings its node + fire state
      // (empty lists for areas that have none).
      send(ws, nodesMsg(to));
      send(ws, firesMsg(to));
      // Stage 5: every area entry also brings its drop piles, and the
      // Barrows areas bring the saved run state.
      send(ws, pilesMsg(to));
      send(ws, alliesMsg(to)); // Stage 6: guardians already standing there
      send(ws, objectsMsg(to)); // Stage 7D: placed objects in the new area
      if (to === 'barrows' || to === 'barrows_tunnels' || to === 'barrows_crypt') send(ws, barrowsStateMsg(me));
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
      if (me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
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
      if (me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
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

    // ----- Barrows (Stage 5, rebuilt Stage 28): mounds, crypts, tunnels, puzzle door, chest -----
    if (m.type === 'barrows_enter') {
      const def = BARROWS_BROTHERS[String(m.brother || '')];
      if (!def) return send(ws, { type: 'error', message: 'No such barrow.' });
      if (me.area !== 'barrows') return send(ws, { type: 'error', message: 'You need to be at the Barrows to enter a crypt.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are already fighting something.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You are in a Fight Caves run.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      if (Math.hypot(me.x - def.mound.x, me.y - def.mound.y) > NPC_RANGE) return send(ws, { type: 'error', message: `Too far away — walk closer to ${def.name}'s mound.` });
      ensureBarrowsRun(key); // first crypt entry of a round picks the tunnel crypt
      // Stage 28: entering a mound puts you IN the crypt (the app's
      // layout) — the fight starts when you search the sarcophagus.
      // A slain brother's mound offers no crypt action until the
      // run completes — EXCEPT the tunnel mound, which always lets
      // you in (its way down stays open even after he is slain).
      if (profile.barrows.kills.includes(def.id) && def.id !== profile.barrows.tunnel) {
        return send(ws, { type: 'error', message: `You have already defeated ${def.name} this round — his crypt is empty.` });
      }
      me.area = 'barrows_crypt';
      me.x = CRYPT_SPAWN.x; me.y = CRYPT_SPAWN.y;
      me.barrowsCrypt = def.id;
      send(ws, { type: 'area', area: 'barrows_crypt' });
      send(ws, nodesMsg('barrows_crypt'));
      send(ws, firesMsg('barrows_crypt'));
      send(ws, pilesMsg('barrows_crypt'));
      send(ws, alliesMsg('barrows_crypt'));
      send(ws, objectsMsg('barrows_crypt'));
      send(ws, barrowsStateMsg(me));
      broadcastState();
      const isTunnel = def.id === profile.barrows.tunnel;
      return send(ws, {
        type: 'chat', from: 'Game',
        text: isTunnel
          ? `You climb down into ${def.name}'s crypt. A dark opening in the north wall leads down to the tunnels — the sarcophagus here is the way down, not a fight.`
          : `You climb down into ${def.name}'s crypt. His sarcophagus waits in the middle — search it to wake him.`,
      });
    }
    if (m.type === 'barrows_search') {
      if (me.area !== 'barrows_crypt' || !me.barrowsCrypt) return send(ws, { type: 'error', message: 'There is no sarcophagus here.' });
      const def = BARROWS_BROTHERS[me.barrowsCrypt];
      if (!def) return send(ws, { type: 'error', message: 'No such barrow.' });
      if (me.duelId || me.modDuelId || me.npcFightId || me.fcRunId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      ensureBarrowsRun(key);
      if (def.id === profile.barrows.tunnel) return send(ws, { type: 'error', message: `This sarcophagus is the way DOWN — ${def.name} waits in the tunnels, not here. Use Descend.` });
      if (profile.barrows.kills.includes(def.id)) return send(ws, { type: 'error', message: `You have already defeated ${def.name} this round.` });
      if (Math.hypot(me.x - CRYPT_SARCO.x, me.y - CRYPT_SARCO.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk up to the sarcophagus.' });
      // The fight starts in the crypt: he rises right beside you.
      startBarrowsFight(key, def, 'barrows_crypt', CRYPT_SARCO.x, CRYPT_SARCO.y);
      return;
    }
    if (m.type === 'barrows_descend') {
      if (me.area !== 'barrows_crypt' || !me.barrowsCrypt) return send(ws, { type: 'error', message: 'You are not in a crypt.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'Finish the fight first!' });
      ensureBarrowsRun(key);
      if (me.barrowsCrypt !== profile.barrows.tunnel) return send(ws, { type: 'error', message: 'This crypt has no way down — the tunnel entrance is in another mound this run.' });
      me.area = 'barrows_tunnels';
      me.x = AREAS.barrows_tunnels.spawn.x; me.y = AREAS.barrows_tunnels.spawn.y;
      me.barrowsCrypt = null;
      // The tunnel HP pool is dealt fresh on each descent (the app
      // resets the run's health when you go down) and is spent by
      // the puzzle door's bite and the ambush fight.
      me.barrowsHp = Math.max(1, levelForXp(profile.xp.hitpoints));
      me.barrowsDoorRolled = false;
      me.barrowsPuzzle = null;
      send(ws, { type: 'area', area: 'barrows_tunnels' });
      send(ws, nodesMsg('barrows_tunnels'));
      send(ws, firesMsg('barrows_tunnels'));
      send(ws, pilesMsg('barrows_tunnels'));
      send(ws, alliesMsg('barrows_tunnels'));
      send(ws, objectsMsg('barrows_tunnels'));
      send(ws, barrowsStateMsg(me));
      broadcastState();
      return send(ws, { type: 'chat', from: 'Game', text: 'You climb down into the Barrows tunnels. The reward chest waits in the room at the far end, behind a puzzle door — and prayer drains twice as fast down here.' });
    }
    if (m.type === 'barrows_leave_crypt') {
      if (me.area !== 'barrows_crypt') return send(ws, { type: 'error', message: 'You are not in a crypt.' });
      if (me.barrowsFightId) { const f = barrowsFights.get(me.barrowsFightId); if (f) finishBarrowsFight(f, 'fled'); }
      const def = me.barrowsCrypt ? BARROWS_BROTHERS[me.barrowsCrypt] : null;
      me.barrowsCrypt = null;
      me.area = 'barrows';
      me.x = def ? def.mound.x : AREAS.barrows.spawn.x;
      me.y = def ? def.mound.y : AREAS.barrows.spawn.y;
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
    if (m.type === 'barrows_puzzle') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'The puzzle door is in the Barrows tunnels.' });
      ensureV2(profile);
      // Stage 28: solved is saved on the RUN now — once solved, the
      // door stays open for the rest of the round.
      if (profile.barrows.puzzleSolved) return send(ws, { type: 'barrows_puzzle_result', ok: true, alreadySolved: true });
      if (me.barrowsPuzzle) { // the same puzzle stays open until it is answered right (the app's rule)
        return send(ws, { type: 'barrows_puzzle', shown: [...me.barrowsPuzzle.shown, '❓'], options: me.barrowsPuzzle.options });
      }
      return send(ws, newBarrowsPuzzle(me));
    }
    if (m.type === 'barrows_puzzle_answer') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'The puzzle door is in the Barrows tunnels.' });
      if (!me.barrowsPuzzle) return send(ws, { type: 'error', message: 'Ask the door for a puzzle first (barrows_puzzle).' });
      ensureV2(profile);
      const idx = Math.floor(+m.index);
      const chosen = Number.isInteger(idx) ? me.barrowsPuzzle.options[idx] : undefined;
      if (chosen !== undefined && chosen === me.barrowsPuzzle.answer) {
        me.barrowsPuzzle = null;
        profile.barrows.puzzleSolved = true;
        save(key);
        send(ws, barrowsStateMsg(me));
        return send(ws, { type: 'barrows_puzzle_result', ok: true });
      }
      // Stage 28 (the app's rule): a wrong answer bites for exactly
      // 5 HP off the tunnel HP pool — and the same puzzle stays open.
      if (me.barrowsHp == null) me.barrowsHp = Math.max(1, levelForXp(profile.xp.hitpoints));
      me.barrowsHp -= 5;
      const maxHpYou = Math.max(1, levelForXp(profile.xp.hitpoints));
      send(ws, { type: 'barrows_puzzle_result', ok: false, hpYou: Math.max(0, me.barrowsHp), maxHpYou });
      if (me.barrowsHp <= 0) {
        me.barrowsPuzzle = null;
        respawnPlayer(key, 'The puzzle door\'s bite finishes you — you wake up in the plaza. Your Barrows kills, tunnel and solved puzzle are kept.');
      }
      return;
    }
    if (m.type === 'barrows_loot') {
      if (me.area !== 'barrows_tunnels') return send(ws, { type: 'error', message: 'The reward chest is in the Barrows tunnels.' });
      if (me.duelId || me.npcFightId || me.fcRunId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'Finish the fight first!' });
      if (Math.hypot(me.x - BARROWS_CHEST.x, me.y - BARROWS_CHEST.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk to the chest in the room at the far end of the tunnels.' });
      ensureV2(profile);
      if (!profile.barrows.puzzleSolved) return send(ws, { type: 'error', message: 'The chest is locked behind the puzzle door — solve the puzzle first.' });
      const b = profile.barrows;
      // Stage 28: the old chest GUARD fight is gone — reaching for
      // the chest with the tunnel brother still alive springs the
      // AMBUSH instead (he normally springs earlier, when you enter
      // the chest room; this is the backstop). Kill him first.
      if (b.tunnel && !b.kills.includes(b.tunnel)) {
        startBarrowsAmbush(key);
        return;
      }
      // Stage 28 (the app's rule): there is NO minimum-kill lock on
      // the chest any more — the loot table itself scales with the
      // kill count (rolls = kills + 1, piece chance 1/(450-58k)).
      const killCount = b.kills.length;
      const loot = rollBarrowsLoot(profile, killCount);
      // Stage 28b: looting the chest completes the run — the
      // counter goes up (the app's "chests" / "Barrows runs
      // completed") and rides the loot message.
      profile.barrowsRuns = (profile.barrowsRuns || 0) + 1;
      // The round is finished: the run state resets (the next round
      // re-randomises its tunnel crypt) and the player climbs back
      // out onto the field.
      profile.barrows = { kills: [], tunnel: null, looted: false, puzzleSolved: false };
      save(key);
      me.barrowsPuzzle = null; me.barrowsHp = null;
      me.area = 'barrows';
      me.x = AREAS.barrows.spawn.x; me.y = AREAS.barrows.spawn.y;
      // Stage 20/28: every Barrows piece rolled lands as its own
      // drop pile at the winner's feet here on the field — the loot
      // flow climbs out of the tunnels in this same instant, so the
      // chest itself can't hold the moment. Each pile is flagged
      // rare (the client renders the golden loot beam over it), the
      // find goes into the collection log, and the whole game hears
      // about it.
      loot.rares.forEach((piece, i) => {
        const pileId = crypto.randomBytes(6).toString('hex');
        piles.set(pileId, { id: pileId, item: piece, qty: 1, x: me.x + i * 15, y: me.y, area: 'barrows', owner: profile.username, bornAt: Date.now(), rare: true });
        recordClog(key, piece);
        announce(`⚰️ ${profile.username} just looted ${itemDef(piece).name} from Barrows!`);
      });
      send(ws, { type: 'barrows_loot', gold: loot.gold, items: loot.items, rares: loot.rares, lines: loot.lines, rolls: loot.rolls, kills: killCount, runs: profile.barrowsRuns, profile: publicProfile(profile) });
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
      // Stage 28: the run — kills, tunnel AND the solved puzzle —
      // is saved on the profile now, so climbing out keeps all of
      // it (Derek's rule). Only the session scratch goes: the dealt
      // puzzle and the tunnel HP pool (re-dealt on the next descent).
      me.barrowsPuzzle = null; me.barrowsHp = null; me.barrowsCrypt = null;
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
      if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
      if (def.kind === 'note') return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
      if (me.duelId) return send(ws, { type: 'error', message: 'You cannot drop items during a duel.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You cannot drop items during a Fight Caves run.' });
      if (!removeStacks(profile.backpack, item, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${def.name}.` });
      if (item === 'gold') syncGoldMirror(profile); // Stage 16: dropped coins leave the stack total
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
      if (pile.item === 'gold') {
        // Stage 16: picked-up coins join the coin stack (addGold —
        // backpack stack, bank stack, or a fresh stack): a gold
        // pile always fits whole, it never stays on the ground.
        addGold(profile, pile.qty);
        piles.delete(pile.id);
        save(key);
        broadcastPiles(me.area);
        return sendProfile(key);
      }
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
      if (me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
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
      // Stage 20: the first REAL resource gather (a node with an
      // item — Training Cave stations grant XP only, item null, and
      // don't count) completes the "Gather a resource" starter goal.
      if (node.item) completeStarterGoal(key, 'gather');
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

    // ----- Stage 19: spellbook selection + fletching -----
    if (m.type === 'set_spell') {
      const sp = SPELL_BY_ID[String(m.spell || '')];
      if (!sp) return send(ws, { type: 'error', message: 'Unknown spell.' });
      // Stage 24: Freeze is cast from a placed spell button only —
      // a staff autocasting a 0-damage root would just burn runes.
      if (sp.id === 'freeze') return send(ws, { type: 'error', message: '❄️ Freeze is cast from a placed spell button — drag it out of the spellbook onto your screen.' });
      const mLvl = levelForXp((profile.xp && profile.xp.magic) || 0);
      if (mLvl < sp.level) return send(ws, { type: 'error', message: `You need Magic level ${sp.level} for ${sp.name} (you are level ${mLvl}).` });
      profile.spell = sp.id;
      save(key);
      return sendProfile(key);
    }
    if (m.type === 'fletch') {
      // Fletching (Derek's design): 1 base Logs + 1 arrowhead ->
      // 10 arrows of the head's tier, anywhere, like RS. Level
      // gates per tier (FLETCH_GATE); XP per set in FLETCH_XP.
      const headId = String(m.item || '');
      const headDef = itemDef(headId);
      if (!headDef || headDef.kind !== 'arrowhead') return send(ws, { type: 'error', message: 'You can only fletch arrowheads.' });
      const tier = headId.replace(/_arrowhead$/, '');
      const gate = FLETCH_GATE[tier] || 1;
      const fLvl = levelForXp((profile.xp && profile.xp.fletching) || 0);
      if (fLvl < gate) return send(ws, { type: 'error', message: `You need Fletching level ${gate} to fletch ${headDef.name} (you are level ${fLvl}).` });
      if (stackQty(profile.backpack, headId) < 1) return send(ws, { type: 'error', message: `No ${headDef.name} in your backpack.` });
      if (stackQty(profile.backpack, 'logs') < 1) return send(ws, { type: 'error', message: 'You need a Logs to fletch arrows.' });
      if (me.duelId || me.npcFightId || me.barrowsFightId || me.fcRunId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      removeStacks(profile.backpack, headId, 1);
      removeStacks(profile.backpack, 'logs', 1);
      const arrowId = `${tier}_arrow`;
      const leftover = addStacks(profile.backpack, arrowId, 10, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, arrowId, leftover); // full pack: bank the overflow, never lose them
      addXp(key, { fletching: FLETCH_XP[tier] || 10 });
      save(key);
      me.actSkill = 'fletching'; me.actAt = Date.now(); // Stage 7C pattern: activity marker
      send(ws, { type: 'fletch_result', item: arrowId, qty: 10 });
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
      if (goldTotal(profile) < cost) return send(ws, { type: 'error', message: `Not enough gold — ${def.name} x${qty} costs ${cost}g.` });
      if (addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
      takeGold(profile, cost); // Stage 16: paid from the coin stacks
      save(key);
      send(ws, { type: 'shop', action: 'buy', shop: def.shop, item, qty, total: cost });
      // Stage 21: the two top-tier party hats are server-wide news.
      if (item === 'rune_partyhat' || item === 'dragon_partyhat') announce(`🎉 ${profile.username} just bought a ${def.name}!`);
      return sendProfile(key);
    }
    if (m.type === 'shop_sell') {
      const item = String(m.item || '');
      const def = itemDef(item);
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
      if (def.kind === 'token' || def.kind === 'note') return send(ws, { type: 'error', message: "That can't be sold." });
      if (def.kind === 'currency') return send(ws, { type: 'error', message: "That can't be sold." }); // Stage 16: gold IS money — spend it, don't sell it
      if (def.custom) return send(ws, { type: 'error', message: "That can't be sold." }); // Stage 7D: customs, same treatment as tokens
      // Shops buy anything with a sell price: their own stock at 60%
      // back, and Stage 2 gathered resources at their fixed sellOnly.
      if (!sellPrice(item)) return send(ws, { type: 'error', message: 'The shops don\'t buy that — try the Gold Exchange.' });
      if (!removeStacks(profile.backpack, item, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${def.name}.` });
      const total = sellPrice(item) * qty;
      addGold(profile, total); // Stage 16: the payment lands on the coin stack
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
      // Stage 14: duel rules gate consumables for BOTH duelists,
      // before anything is consumed (prayer potions included — they
      // are kind 'potion'). Only a duel is ever checked: NPC,
      // Barrows and Fight Caves fights are not duels.
      const rulesDuel = me.duelId ? duels.get(me.duelId) : null;
      if (rulesDuel && rulesDuel.rules) {
        if (rulesDuel.rules.noFood && def.kind === 'food') return send(ws, { type: 'error', message: '🚫 No Food in this duel.' });
        if (rulesDuel.rules.noPotions && def.kind === 'potion') return send(ws, { type: 'error', message: '🚫 No Potions in this duel.' });
      }
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
        // Mod duel (Stage 22): food / restore potions heal the 99
        // pool too. The echo tick carries null hit fields (not 0):
        // a heal is not a swing, and the client reads a numeric
        // youHit as engagement — the note alone carries the news.
        const md = me.modDuelId ? modDuels.get(me.modDuelId) : null;
        if (md) {
          if (md.hpYou >= 99) return send(ws, { type: 'error', message: 'Already at full health.' });
          removeStacks(profile.backpack, item, 1);
          md.hpYou = Math.min(99, md.hpYou + def.heal);
          save(key);
          send(ws, {
            type: 'mod_duel', phase: 'tick', npcId: md.npcId,
            hpYou: md.hpYou, maxHpYou: 99, hpNpc: Math.max(0, md.hpNpc), maxHpNpc: 99,
            youHit: null, npcHit: null, youOutcome: null, npcOutcome: null, youSpecial: false, energyYou: profile.specialEnergy,
            countdownLeft: Math.max(0, COUNTDOWN_TICKS - md.tickCount + 1),
            note: `${profile.username} used ${def.name} (+${def.heal} HP)`,
          });
          return sendProfile(key);
        }
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

    // ----- Bank of Gielinor (Stage 16: coin stacks bank here too) -----
    if (m.type === 'bank_deposit' || m.type === 'bank_withdraw') {
      const item = String(m.item || '');
      const def = itemDef(item);
      const qty = Math.max(1, Math.min(9999, Math.floor(+m.qty || 1)));
      if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
      if (m.type === 'bank_deposit') {
        if (!removeStacks(profile.backpack, item, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${def.name}.` });
        addStacks(profile.bank, item, qty);
        completeStarterGoal(key, 'use_bank'); // Stage 20: first deposit completes the starter goal
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
      // Stage 16: the gold item gets the same refusal — it IS money.
      const wantedGood = String(m.good || '');
      if (itemDef(wantedGood) && (itemDef(wantedGood).kind === 'token' || itemDef(wantedGood).kind === 'note' || itemDef(wantedGood).kind === 'currency')) return send(ws, { type: 'error', message: "That can't be sold." });
      const good = GOODS.find((g) => g.id === wantedGood);
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!good) return send(ws, { type: 'error', message: 'Unknown exchange good.' });
      const price = exchangePrices[good.id];
      if (m.type === 'exchange_buy') {
        const cost = price * qty;
        if (goldTotal(profile) < cost) return send(ws, { type: 'error', message: `Not enough gold — ${good.name} x${qty} costs ${cost}g.` });
        if (addStacks(profile.backpack, good.id, qty, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
        takeGold(profile, cost); // Stage 16: paid from the coin stacks
        save(key);
        send(ws, { type: 'exchange', action: 'buy', good: good.id, qty, price, total: cost });
      } else {
        if (!removeStacks(profile.backpack, good.id, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${good.name}.` });
        const total = Math.floor(price * qty * EXCHANGE_SELLBACK);
        addGold(profile, total); // Stage 16: the payment lands on the coin stack
        save(key);
        send(ws, { type: 'exchange', action: 'sell', good: good.id, qty, price, total });
      }
      return sendProfile(key);
    }

    // ----- Prayers (Deflect since Stage 27: one at a time, tap toggles) -----
    if (m.type === 'prayer') {
      const want = m.prayer === null ? null : String(m.prayer || '');
      if (want !== null && !['melee', 'missiles', 'magic'].includes(want)) {
        return send(ws, { type: 'error', message: 'Unknown prayer.' });
      }
      // Stage 14: a duel agreed as No Prayer rejects ACTIVATIONS for
      // both duelists. Switching a prayer off (want null, or tapping
      // the active one) is always allowed.
      const prayerDuel = me.duelId ? duels.get(me.duelId) : null;
      if (prayerDuel && prayerDuel.rules && prayerDuel.rules.noPrayer && want !== null && want !== profile.activePrayer) {
        return send(ws, { type: 'error', message: '🚫 No Prayer in this duel.' });
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
      // Stage 19: a fighter whose wielded style is banned by the
      // agreed rules cannot engage with it at all (a mid-duel swap
      // onto a banned weapon is caught at swing resolution instead).
      const myDuelStyle = attackStyleOf(profile);
      if (duel.rules && duel.rules['no' + cap(myDuelStyle)]) {
        return send(ws, { type: 'error', message: styleBanMsg(myDuelStyle) });
      }
      if (!duel.engaged[key]) {
        duel.engaged[key] = true;
        duel.nextSwingAt[key] = Math.max(COUNTDOWN_TICKS, duel.tickCount) + 1;
      }
      return;
    }

    // ----- Mod NPC stake ladder (Stage 22): challenge a moderator -----
    if (m.type === 'mod_duel_start') {
      const def = MOD_NPC_BY_ID[String(m.id || '')];
      if (!def) return send(ws, { type: 'error', message: 'No such moderator.' });
      if (me.area !== 'plaza') return send(ws, { type: 'error', message: 'The moderators are in the plaza.' });
      if (me.duelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.modDuelId) return send(ws, { type: 'error', message: 'You are already in a mod duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are already fighting something.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You are in a Fight Caves run.' });
      if (stakeMatchForKey(key)) return send(ws, { type: 'error', message: 'You have a stake match waiting — ready up or cancel it at the Stake Board.' });
      if (modLive.get(def.id).fightId) return send(ws, { type: 'error', message: `${def.name} is in a fight right now — wait your turn.` });
      if (Math.hypot(me.x - def.x, me.y - def.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer.' });
      // The tier lock is enforced HERE, never trusted to the client.
      if (!modTierUnlocked(profile, def.tier)) return send(ws, { type: 'error', message: `🔒 Tier ${def.tier} is locked — win 3 Tier ${def.tier - 1} fights first.` });
      if (goldTotal(profile) < def.stake) return send(ws, { type: 'error', message: `You need ${def.stake}g for this stake (you have ${goldTotal(profile)}g).` });
      startModDuel(key, def);
      return;
    }
    if (m.type === 'mod_duel_attack') {
      // Tap-to-engage, exactly the duel rule: the ONLY way the
      // challenger starts swinging — being hit never engages them.
      // Taps are accepted during the countdown; the first swing
      // arms for the tick after the countdown (or the next tick).
      const fight = me.modDuelId ? modDuels.get(me.modDuelId) : null;
      if (!fight) return send(ws, { type: 'error', message: 'You are not in a mod duel.' });
      if (!fight.engaged) {
        fight.engaged = true;
        fight.nextSwingYou = Math.max(COUNTDOWN_TICKS, fight.tickCount) + 1;
      }
      return;
    }

    // ----- Stage 24: placed-button tap-to-cast -----
    // The client arms a spell from a placed spell button and taps a
    // target; this message is that tap. Casting from a button needs
    // NO staff (the button is the casting method — Derek's design);
    // the Stage 19 staff autocast is untouched. Everything is
    // validated server-side: the spell exists, the Magic level, the
    // runes (consumed on the cast, hit or miss — rollMagicCast),
    // the target being a real current opponent in the player's
    // current combat context within magic range (NPC_RANGE), and a
    // personal 5-tick cooldown between button casts (in Fight Caves
    // too, even though FC autocast swings every tick). A cast does
    // NOT engage weapon swings — duelists still tap to swing.
    // Refusals consume nothing and never start the cooldown.
    if (m.type === 'cast_at') {
      const spell = SPELL_BY_ID[String(m.spell || '')];
      if (!spell) return send(ws, { type: 'error', message: 'Unknown spell.' });
      const kind = String(m.targetKind || '');
      const targetId = String(m.targetId || '');
      const now = Date.now();
      if (now < (me.castReadyAt || 0)) return send(ws, { type: 'error', message: 'You are still recovering from your last cast.' });
      const castFail = (message) => send(ws, { type: 'error', message });
      // Shared tail for a RESOLVED cast (rollMagicCast already took
      // the runes): cooldown, XP (flat cast XP is owed hit or miss),
      // special-energy charge like the engines, save + profile push
      // so the caster's backpack and XP refresh at once.
      const finishCast = (res) => {
        me.castReadyAt = Date.now() + BUTTON_CAST_COOLDOWN_MS;
        addXp(key, swingXpGains(profile.style, 'magic', res.dmg, spell.id));
        if (res.dmg > 0) profile.specialEnergy = Math.min(100, profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
        save(key);
        sendProfile(key);
      };
      // Freeze housekeeping shared by every context: the cast is
      // refused BEFORE rolling when the target is already rooted —
      // no runes, no cooldown (Freeze never stacks or extends).
      const alreadyFrozen = (until, name) => (until || 0) > Date.now()
        ? (castFail(`❄️ ${name} is already frozen.`), true) : false;

      if (kind === 'duel') {
        // Player duel first, then a mod duel (the client sends the
        // same kind for both; the opponent is implicit either way).
        const duel = me.duelId ? duels.get(me.duelId) : null;
        if (duel) {
          if (duel.rules && duel.rules.noMagic) return castFail(styleBanMsg('magic'));
          if (duel.tickCount <= COUNTDOWN_TICKS) return castFail('The duel has not started yet — wait for the countdown.');
          const oppKey = duel.a === key ? duel.b : duel.a;
          const oppSess = online.get(oppKey);
          const oppProfile = db.users[oppKey] && db.users[oppKey].profile;
          if (!oppSess || !oppProfile) return castFail('Your opponent is gone.');
          if (Math.hypot(me.x - oppSess.x, me.y - oppSess.y) > NPC_RANGE) return castFail('Too far away — walk closer.');
          if (spell.id === 'freeze' && alreadyFrozen(oppSess.frozenUntil, oppProfile.username)) return;
          // Stage 27: a duel cast resolves with the PvP Deflect
          // rule — the opponent's Deflect Magic prays off 40% and
          // bounces a quarter of that back onto the CASTER.
          const res = rollMagicCast(profile, oppProfile, spell, false, DUEL_LEVEL, true);
          if (res.refused) return castFail(res.refused);
          finishCast(res);
          duel.hp[oppKey] = Math.max(0, duel.hp[oppKey] - res.dmg);
          if (res.deflected) duel.hp[key] = Math.max(0, duel.hp[key] - res.deflected);
          let frozenUntil = 0;
          if (res.froze) {
            frozenUntil = Date.now() + FREEZE_MS;
            oppSess.frozenUntil = frozenUntil;
            broadcastState(); // the root rides the player snapshot to the arena
          }
          const result = { type: 'cast_result', context: 'duel', spell: spell.id, targetId: oppProfile.username, targetName: oppProfile.username, outcome: res.outcome, dmg: res.dmg, deflected: res.deflected || 0, hpYou: duel.hp[key], froze: !!res.froze, frozenUntil, hpTarget: duel.hp[oppKey], maxHpTarget: 99 };
          send(ws, result);
          send(oppSess.ws, { ...result, incoming: true, by: profile.username }); // the victim splats + toasts on their own screen
          // Stage 27: a Deflect kill counts too — if the bounce
          // dropped the caster, the opponent wins; if both pools
          // hit 0 on one cast, the duel tick's coin-flip rule
          // decides.
          if (duel.hp[oppKey] <= 0 && duel.hp[key] <= 0) endDuel(duel, Math.random() < 0.5 ? key : oppKey, 'KO');
          else if (duel.hp[oppKey] <= 0) endDuel(duel, key, 'KO');
          else if (duel.hp[key] <= 0) endDuel(duel, oppKey, 'KO');
          return;
        }
        const fight = me.modDuelId ? modDuels.get(me.modDuelId) : null;
        if (fight) {
          const def = MOD_NPC_BY_ID[fight.npcId];
          if (!def) return castFail('Your opponent is gone.');
          if (fight.tickCount <= COUNTDOWN_TICKS) return castFail('The fight has not started yet — wait for the countdown.');
          if (Math.hypot(me.x - def.x, me.y - def.y) > NPC_RANGE) return castFail('Too far away — walk closer.');
          if (spell.id === 'freeze' && alreadyFrozen(fight.modFrozenUntil, def.name)) return;
          // Stage 27: the PvP Deflect flag rides along for symmetry
          // — the mod never prays, so res.deflected is always 0.
          const res = rollMagicCast(profile, fight.modProfile, spell, false, DUEL_LEVEL, true);
          if (res.refused) return castFail(res.refused);
          finishCast(res);
          fight.hpNpc = Math.max(0, fight.hpNpc - res.dmg);
          let frozenUntil = 0;
          if (res.froze) { frozenUntil = Date.now() + FREEZE_MS; fight.modFrozenUntil = frozenUntil; }
          send(ws, { type: 'cast_result', context: 'modduel', spell: spell.id, targetId: def.id, targetName: def.name, outcome: res.outcome, dmg: res.dmg, deflected: res.deflected || 0, froze: !!res.froze, frozenUntil, hpTarget: fight.hpNpc, maxHpTarget: 99 });
          if (fight.hpNpc <= 0) endModDuel(fight, 'win');
          return;
        }
        return castFail('You are not in a duel.');
      }

      if (kind === 'npc') {
        // Mirror attack_npc's guards: the creature must be real,
        // alive, in my area and not busy with someone else.
        if (me.duelId) return castFail('You are in a duel.');
        if (me.modDuelId) return castFail('You are in a mod duel.');
        if (me.barrowsFightId) return castFail('You are fighting a Barrows brother.');
        if (me.fcRunId) return castFail('You are in a Fight Caves run.');
        const npc = npcs.get(targetId);
        if (!npc || !npc.alive) return castFail('That creature is not here.');
        if (npc.area !== me.area) return castFail('That creature is not here.');
        if (npc.fightId && npc.fightId !== me.npcFightId) return castFail('Someone else is fighting that one — pick another.');
        if (me.npcFightId && me.npcFightId !== npc.fightId) return castFail('You are already fighting something.');
        if (Math.hypot(me.x - npc.x, me.y - npc.y) > NPC_RANGE) return castFail('Too far away — walk closer.');
        if (spell.id === 'freeze' && alreadyFrozen(npc.frozenUntil, npc.name)) return;
        // A cast at a creature I'm not fighting OPENS the fight —
        // but only once the cast itself is known-good, so peek at
        // the level and runes first (rollMagicCast re-checks them
        // atomically when it resolves; a refused cast never starts
        // a fight and consumes nothing).
        const mLvl = levelForXp((profile.xp && profile.xp.magic) || 0);
        if (mLvl < spell.level) return castFail(`You need Magic level ${spell.level} to cast ${spell.name}.`);
        if (stackQty(profile.backpack, `${spell.element}_rune`) < spell.runes) return castFail(`You don't have the runes for ${spell.name}.`);
        let fight = me.npcFightId ? npcFights.get(me.npcFightId) : null;
        if (!fight) { startNpcFight(key, npc); fight = npcFights.get(me.npcFightId); }
        if (!fight) return castFail('That fight could not start.');
        const res = rollMagicCast(profile, NPC_DEFENDER, spell, false, null);
        if (res.refused) return castFail(res.refused); // unreachable after the peek — belt and braces
        finishCast(res);
        npc.hp -= res.dmg;
        // A connected cast unlocks the creature's retaliation,
        // exactly like a connected swing does in npcTick.
        if (res.connected && !fight.npcUnlocked) { fight.npcUnlocked = true; fight.nextSwingNpc = fight.tickCount + (npc.attackType === 'melee' ? MELEE_SPEED : 3); }
        let frozenUntil = 0;
        if (res.froze) { frozenUntil = Date.now() + FREEZE_MS; npc.frozenUntil = frozenUntil; }
        send(ws, { type: 'cast_result', context: 'npc', spell: spell.id, targetId: npc.id, targetName: npc.name, outcome: res.outcome, dmg: res.dmg, froze: !!res.froze, frozenUntil, hpTarget: Math.max(0, npc.hp), maxHpTarget: npc.maxHp });
        broadcastNpcState(npc.area);
        if (npc.hp <= 0) {
          // The npcTick kill path, verbatim (a cast can't drop the
          // caster, so the both-die branch doesn't apply).
          npc.alive = false; npc.hp = 0; npc.respawnAt = Date.now() + npc.respawnMs;
          const drops = rollNpcDrops(profile, npc);
          completeStarterGoal(key, 'kill_monster');
          save(key);
          finishNpcFight(fight, 'kill', drops);
          broadcastNpcState(npc.area);
        }
        return;
      }

      if (kind === 'fc') {
        const run = me.fcRunId ? fcRuns.get(me.fcRunId) : null;
        if (!run || run.done) return castFail('You are not in a Fight Caves run.');
        const mon = run.monsters.get(targetId);
        if (!mon || !mon.alive) return castFail('That monster is not here.');
        if (Math.hypot(me.x - mon.x, me.y - mon.y) > NPC_RANGE) return castFail('Too far away — walk closer.');
        if (spell.id === 'freeze' && alreadyFrozen(mon.frozenUntil, mon.name)) return;
        const res = rollMagicCast(profile, NPC_DEFENDER, spell, false, null);
        if (res.refused) return castFail(res.refused);
        finishCast(res);
        run.targetId = mon.id; // tapping a monster targets it, like fc_attack
        mon.hp -= res.dmg;
        let frozenUntil = 0;
        if (res.froze) { frozenUntil = Date.now() + FREEZE_MS; mon.frozenUntil = frozenUntil; }
        send(ws, { type: 'cast_result', context: 'fc', spell: spell.id, targetId: mon.id, targetName: mon.name, outcome: res.outcome, dmg: res.dmg, froze: !!res.froze, frozenUntil, hpTarget: Math.max(0, mon.hp), maxHpTarget: mon.maxHp });
        if (mon.hp <= 0) killFcMonster(run, mon);
        else if (mon.kind === 'jad') maybeSpawnFcHealers(run);
        if (run.jadDead) { endFcRun(run, 'complete'); return; }
        send(ws, fcStateMsg(run));
        run.rosterChanged = false;
        return;
      }

      if (kind === 'barrows') {
        const fight = me.barrowsFightId ? barrowsFights.get(me.barrowsFightId) : null;
        if (!fight || fight.done) return castFail('You are not fighting a Barrows brother.');
        if (Math.hypot(me.x - fight.bx, me.y - fight.by) > NPC_RANGE) return castFail('Too far away — walk closer.'); // Stage 28: the brother's live position (he moves)
        if (spell.id === 'freeze' && alreadyFrozen(fight.brotherFrozenUntil, fight.name)) return;
        const res = rollMagicCast(profile, NPC_DEFENDER, spell, false, null);
        if (res.refused) return castFail(res.refused);
        finishCast(res);
        fight.hpNpc = Math.max(0, fight.hpNpc - res.dmg);
        // A connected cast wakes the brother, like a connected swing.
        if (res.connected && !fight.npcUnlocked) { fight.npcUnlocked = true; fight.nextSwingNpc = fight.tickCount + MELEE_SPEED; }
        let frozenUntil = 0;
        if (res.froze) { frozenUntil = Date.now() + FREEZE_MS; fight.brotherFrozenUntil = frozenUntil; }
        send(ws, { type: 'cast_result', context: 'barrows', spell: spell.id, targetId: fight.brother, targetName: fight.name, outcome: res.outcome, dmg: res.dmg, froze: !!res.froze, frozenUntil, hpTarget: fight.hpNpc, maxHpTarget: fight.maxHpNpc });
        if (fight.hpNpc <= 0) finishBarrowsFight(fight, 'kill');
        return;
      }

      return castFail('There is nothing to cast at here.');
    }

    if (m.type === 'special') {
      const duel = me.duelId ? duels.get(me.duelId) : null;
      const nf = !duel && me.npcFightId ? npcFights.get(me.npcFightId) : null;
      const fc = !duel && !nf && me.fcRunId ? fcRuns.get(me.fcRunId) : null; // Stage 4: specials work in the caves too
      const bf = !duel && !nf && !fc && me.barrowsFightId ? barrowsFights.get(me.barrowsFightId) : null; // Stage 5: and in Barrows crypts
      const md = !duel && !nf && !fc && !bf && me.modDuelId ? modDuels.get(me.modDuelId) : null; // Stage 22: and in mod duels
      if (!duel && !nf && !fc && !bf && !md) return send(ws, { type: 'error', message: 'You are not in a duel.' });
      // Stage 14: a No Special Attacks duel rejects queueing
      // outright — the special can never fire. (NPC / Barrows /
      // Fight Caves specials are not duels and never see this.)
      if (duel && duel.rules && duel.rules.noSpecial) return send(ws, { type: 'error', message: '🚫 No Special Attacks in this duel.' });
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
      } else if (md) {
        if (md.specialQueued) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        md.specialQueued = true;
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
      // Stage 16: spawning gold credits the coin stacks via addGold
      // (an admin grant of money, not a loose stack placement).
      if (item === 'gold') addGold(targetUser.profile, qty);
      else addItemToProfile(targetUser.profile, item, qty);
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
        if (sess.modDuelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
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
      addGold(requesterProfile, 250); // Stage 16: paid onto the coin stack
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
        addGold(signerProfile, 250); // Stage 16: paid onto the coin stack
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
        style: isWeapon ? (baseDef.style || 'melee') : undefined, // Stage 19: a custom cloned from a bow/staff keeps its attack style
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
      addNpc(WIZARD_DEF.name, 'magic'); // Stage 19
      addNpc(RANGER_DEF.name, 'range'); // Stage 19
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
      if (me.modDuelId || target.modDuelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
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
      if (gold > goldTotal(profile)) return send(ws, { type: 'error', message: 'You don\'t have that much gold.' });
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
      let stake = Math.floor(+m.stake || 0);
      let items = sanitizeItems(m.items);
      // Stage 15: a Free Play challenge stakes nothing — coerce here
      // too, so the stored terms are already clean before the first
      // challenge_terms push.
      const freePlay = !!m.freePlay;
      if (freePlay) { stake = 0; items = []; }
      if (items.some((s) => s.item === 'note')) return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
      if (Array.isArray(m.items) && m.items.some((e) => e && e.item === 'gold')) return send(ws, { type: 'error', message: GOLD_STAKE_MSG }); // Stage 16: coins stake via the amount
      const target = online.get(targetKey);
      if (!target || targetKey === key) return send(ws, { type: 'error', message: 'Pick another online player.' });
      if (me.duelId || target.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (me.modDuelId || target.modDuelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (me.npcFightId || target.npcFightId) return send(ws, { type: 'error', message: 'One of you is fighting a monster.' });
      if (me.barrowsFightId || target.barrowsFightId) return send(ws, { type: 'error', message: 'One of you is fighting a Barrows brother.' });
      if (me.fcRunId || target.fcRunId) return send(ws, { type: 'error', message: 'One of you is in the Fight Caves.' });
      if (!freePlay && items.length === 0 && stake < 1) return send(ws, { type: 'error', message: 'Stake at least 1g, or stake items.' });
      if (stake < 0 || stake > goldTotal(profile) || stake > goldTotal(target.profile)) return send(ws, { type: 'error', message: 'Gold stake must be up to what you both have.' });
      if (!hasItems(profile, items)) return send(ws, { type: 'error', message: 'You don\'t have all the items you tried to stake.' });
      const id = crypto.randomBytes(6).toString('hex');
      // Stage 14: the challenge now opens the configuration screen —
      // it carries the agreed rules and BOTH sides' stakes, and waits
      // for both confirms (challenge_confirm) instead of starting on
      // the target's accept.
      const ch = { id, from: key, to: targetKey, stake, items, itemsTo: [], rules: cleanDuelRules(m.rules), freePlay, confirm: { from: false, to: false }, expires: Date.now() + 30000 };
      challenges.set(id, ch);
      send(target.ws, { type: 'challenge_incoming', challengeId: id, from: profile.username, stake, items, rules: ch.rules, freePlay: ch.freePlay, seconds: 30 });
      broadcastChallenging(key, targetKey); // Stage 7C: '!' over the challenger
      pushChallengeTerms(ch); // both screens open on the same terms
      send(ws, { type: 'chat', from: 'Game', text: freePlay ? `Challenge sent to ${target.profile.username} — 🆓 free play, no stakes.` : `Challenge sent to ${target.profile.username} for ${stake}g${items.length ? ' + items' : ''}.` });
    }
    if (m.type === 'challenge_response') {
      const ch = challenges.get(m.challengeId);
      if (!ch || ch.to !== key || ch.expires < Date.now()) { if (ch) broadcastChallengeClear(ch.from); challenges.delete(m.challengeId); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      if (!m.accept) {
        // Decline: exactly the old path — nothing is taken, the '!' comes down.
        challenges.delete(m.challengeId);
        broadcastChallengeClear(ch.from); // Stage 7C: answered — the '!' comes down
        const fromP = online.get(ch.from);
        if (fromP) {
          send(fromP.ws, { type: 'chat', from: 'Game', text: `${profile.username} declined. No gold or items were taken.` });
          send(fromP.ws, { type: 'challenge_closed', challengeId: ch.id }); // Stage 14: close the challenger's config screen
        }
        return;
      }
      // Stage 14: accepting no longer starts the duel — it JOINS the
      // configuration. The target's item stake is recorded, both
      // confirms reset if it changed anything, and the shared terms
      // go back out to both screens. The duel starts on the second
      // challenge_confirm (below). Escrow still only happens there.
      const myItems = ch.freePlay ? [] : sanitizeItems(m.items); // Stage 15: Free Play stakes no items, whatever the accept carried
      if (myItems.some((s) => s.item === 'note')) return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
      if (Array.isArray(m.items) && m.items.some((e) => e && e.item === 'gold')) return send(ws, { type: 'error', message: GOLD_STAKE_MSG }); // Stage 16: coins stake via the amount
      if (!hasItems(profile, myItems)) return send(ws, { type: 'error', message: 'You don\'t have all the items you tried to stake.' });
      if (JSON.stringify(myItems) !== JSON.stringify(ch.itemsTo)) { ch.itemsTo = myItems; ch.confirm.from = false; ch.confirm.to = false; }
      ch.expires = Date.now() + 30000;
      pushChallengeTerms(ch);
    }
    // Stage 14: either duelist edits the shared terms (their own
    // item side, the matched gold, the rules). Any change resets
    // both confirms — see applyChallengeTerms.
    if (m.type === 'challenge_update') {
      const ch = challenges.get(m.challengeId);
      if (!ch || (ch.from !== key && ch.to !== key)) return send(ws, { type: 'error', message: 'That challenge is gone.' });
      if (ch.expires < Date.now()) { challenges.delete(m.challengeId); broadcastChallengeClear(ch.from); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      const err = applyChallengeTerms(ch, key, m);
      if (err) return send(ws, { type: 'error', message: err });
      ch.expires = Date.now() + 30000; // an active negotiation stays alive
      pushChallengeTerms(ch);
    }
    // Stage 14: confirm. The message may carry the sender's current
    // screen state (stake / own items / rules) — applied first, so a
    // confirm with fresh edits resets the OTHER side's confirm
    // before this side's is set. On the second confirm the terms are
    // re-validated end to end (busy states, purses, backpacks — the
    // old accept-time checks) and the existing startDuel path takes
    // the escrow with the agreed rules.
    if (m.type === 'challenge_confirm') {
      const ch = challenges.get(m.challengeId);
      if (!ch || (ch.from !== key && ch.to !== key)) return send(ws, { type: 'error', message: 'That challenge is gone.' });
      if (ch.expires < Date.now()) { challenges.delete(m.challengeId); broadcastChallengeClear(ch.from); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      const err = applyChallengeTerms(ch, key, m);
      if (err) return send(ws, { type: 'error', message: err });
      if (key === ch.from) ch.confirm.from = true; else ch.confirm.to = true;
      ch.expires = Date.now() + 30000;
      if (!(ch.confirm.from && ch.confirm.to)) { pushChallengeTerms(ch); return; }
      const fromSess = online.get(ch.from), toSess = online.get(ch.to);
      if (!fromSess || !toSess) { challenges.delete(m.challengeId); broadcastChallengeClear(ch.from); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      const failStart = (msg) => { ch.confirm.from = false; ch.confirm.to = false; pushChallengeTerms(ch); return send(ws, { type: 'error', message: msg }); };
      if (fromSess.duelId || toSess.duelId) return failStart('One of you is already in a duel.');
      if (fromSess.modDuelId || toSess.modDuelId) return failStart('One of you is already in a duel.');
      if (fromSess.npcFightId || toSess.npcFightId) return failStart('One of you is fighting a monster.');
      if (fromSess.barrowsFightId || toSess.barrowsFightId) return failStart('One of you is fighting a Barrows brother.');
      if (fromSess.fcRunId || toSess.fcRunId) return failStart('One of you is in the Fight Caves.');
      if (goldTotal(db.users[ch.from].profile) < ch.stake || goldTotal(db.users[ch.to].profile) < ch.stake) return failStart('Someone no longer has the gold.');
      if (!hasItems(db.users[ch.from].profile, ch.items)) return failStart('The challenger no longer has the staked items.');
      if (!hasItems(db.users[ch.to].profile, ch.itemsTo)) return failStart('The challenged player no longer has the staked items.');
      challenges.delete(m.challengeId);
      broadcastChallengeClear(ch.from); // Stage 7C: resolved — the '!' comes down
      startDuel(ch.from, ch.to, ch.stake, ch.items, ch.itemsTo, null, ch.rules, ch.freePlay);
    }
    // Stage 14: either side cancels the configuration — the decline
    // path's twin for the challenger (and for a target who already
    // joined). No escrow is ever taken on a cancel.
    if (m.type === 'challenge_cancel') {
      const ch = challenges.get(m.challengeId);
      if (!ch || (ch.from !== key && ch.to !== key)) return send(ws, { type: 'error', message: 'That challenge is gone.' });
      challenges.delete(m.challengeId);
      broadcastChallengeClear(ch.from);
      const other = online.get(ch.from === key ? ch.to : ch.from);
      if (other) {
        send(other.ws, { type: 'chat', from: 'Game', text: `${profile.username} cancelled the challenge. No gold or items were taken.` });
        send(other.ws, { type: 'challenge_closed', challengeId: ch.id });
      }
      send(ws, { type: 'challenge_closed', challengeId: ch.id });
    }

    // ----- Stage 17: Stake Board (south-west sparkling sign) -----
    // Post a gold bid -> anyone accepts -> both Ready (first ready
    // waits in the Waiting Area) -> second Ready starts the duel
    // through startDuel, which escrows and pays the winner the pot.
    if (m.type === 'stake_board_get') {
      if (pruneStakeOffers()) broadcastStakeBoard();
      send(ws, stakeBoardMsg());
    }
    if (m.type === 'stake_offer_create') {
      const stake = Math.floor(+m.stake || 0);
      if (stakeMatchForKey(key)) return send(ws, { type: 'error', message: 'You already have a stake match — ready up or cancel it first.' });
      if (stakeBusy(me)) return send(ws, { type: 'error', message: 'You are in a fight right now.' });
      if (stake < 1) return send(ws, { type: 'error', message: 'Stake at least 1g.' });
      if (stake > goldTotal(profile)) return send(ws, { type: 'error', message: 'You don\'t have that much gold.' });
      // One OPEN offer per player: posting again replaces the old one.
      const old = openStakeOfferForKey(key);
      if (old) stakeOffers.delete(old.id);
      const offer = { id: crypto.randomBytes(6).toString('hex'), fromKey: key, stake, createdAt: Date.now(), status: 'open', toKey: null, ready: { from: false, to: false } };
      stakeOffers.set(offer.id, offer);
      broadcastStakeBoard();
      broadcast({ type: 'chat', from: 'Stake Board', text: `${profile.username} offers a ${stake}g fight at the Stake Board — tap the sparkling sign in the south-west of the plaza to take it.` });
      send(ws, { type: 'chat', from: 'Stake Board', text: `Your ${stake}g offer is on the board — winner takes ${stake * 2}g. It expires in 10 minutes.` });
    }
    if (m.type === 'stake_offer_cancel') {
      const offer = stakeOffers.get(String(m.offerId || ''));
      if (!offer || offer.fromKey !== key || offer.status !== 'open') return send(ws, { type: 'error', message: 'That offer is gone.' });
      stakeOffers.delete(offer.id);
      broadcastStakeBoard();
      send(ws, { type: 'chat', from: 'Stake Board', text: 'Your stake offer was taken down. No gold moved.' });
    }
    if (m.type === 'stake_offer_accept') {
      pruneStakeOffers();
      const offer = stakeOffers.get(String(m.offerId || ''));
      if (!offer || offer.status !== 'open') { broadcastStakeBoard(); return send(ws, { type: 'error', message: 'That offer is gone.' }); }
      if (offer.fromKey === key) return send(ws, { type: 'error', message: 'You can\'t accept your own offer.' });
      if (stakeMatchForKey(key)) return send(ws, { type: 'error', message: 'You already have a stake match — ready up or cancel it first.' });
      if (stakeMatchForKey(offer.fromKey)) return send(ws, { type: 'error', message: 'That player already has a stake match.' });
      const poster = online.get(offer.fromKey);
      if (!poster) { stakeOffers.delete(offer.id); broadcastStakeBoard(); return send(ws, { type: 'error', message: 'That offer is gone — the player left.' }); }
      if (stakeBusy(me) || stakeBusy(poster)) return send(ws, { type: 'error', message: 'One of you is in a fight right now.' });
      if (goldTotal(profile) < offer.stake) return send(ws, { type: 'error', message: 'You don\'t have enough gold to match that bid.' });
      if (goldTotal(poster.profile) < offer.stake) { stakeOffers.delete(offer.id); broadcastStakeBoard(); return send(ws, { type: 'error', message: 'The poster no longer has the gold — the offer is gone.' }); }
      // Matched: my own open offer (if any) comes down — I'm taken.
      const myOpen = openStakeOfferForKey(key);
      if (myOpen) stakeOffers.delete(myOpen.id);
      offer.status = 'matched';
      offer.toKey = key;
      broadcastStakeBoard(); // the matched offer leaves the open board
      // Notify BOTH fighters clearly.
      for (const k of [offer.fromKey, offer.toKey]) {
        const s = online.get(k);
        if (!s) continue;
        const oppName = db.users[stakeOpponentKey(offer, k)].profile.username;
        send(s.ws, { type: 'stake_matched', matchId: offer.id, opponent: oppName, stake: offer.stake, pot: offer.stake * 2 });
        send(s.ws, { type: 'chat', from: 'Stake Board', text: `🤝 Stake match! ${poster.profile.username} vs ${profile.username} for ${offer.stake}g each — winner takes ${offer.stake * 2}g. Hit Ready when you're set.` });
      }
    }
    if (m.type === 'stake_ready') {
      const match = stakeOffers.get(String(m.matchId || ''));
      if (!match || match.status !== 'matched' || (match.fromKey !== key && match.toKey !== key)) return send(ws, { type: 'error', message: 'That stake match is gone.' });
      if (stakeBusy(me)) return send(ws, { type: 'error', message: 'You are in a fight right now.' });
      const isFrom = match.fromKey === key;
      if (isFrom ? match.ready.from : match.ready.to) { sendStakeMatchUpdate(match); return; } // already ready — just refresh
      if (isFrom) match.ready.from = true; else match.ready.to = true;
      const oppKey = stakeOpponentKey(match, key);
      const oppSess = online.get(oppKey);
      const oppName = db.users[oppKey] ? db.users[oppKey].profile.username : oppKey;
      if (match.ready.from && match.ready.to) {
        // SECOND ready: re-validate everything at this moment, then
        // the existing startDuel escrows both stakes, moves both to
        // the arena and runs the countdown — winner takes the pot.
        const fromSess = online.get(match.fromKey), toSess = online.get(match.toKey);
        const fail = !fromSess || !toSess ? 'A fighter has left.'
          : (stakeBusy(fromSess) || stakeBusy(toSess)) ? 'One of you is in a fight right now.'
          : (goldTotal(db.users[match.fromKey].profile) < match.stake || goldTotal(db.users[match.toKey].profile) < match.stake) ? 'Someone no longer has the gold for the stake.'
          : null;
        if (fail) { cancelStakeMatch(match, `Stake match cancelled — ${fail} No gold was taken.`); return; }
        const { fromKey, toKey, stake } = match;
        stakeOffers.delete(match.id);
        broadcastStakeBoard();
        for (const k of [fromKey, toKey]) {
          const s = online.get(k);
          if (s) send(s.ws, { type: 'chat', from: 'Stake Board', text: `⚔️ Both fighters are ready — the ${stake}g stake fight starts now! Winner takes ${stake * 2}g.` });
        }
        startDuel(fromKey, toKey, stake, [], [], null, null, false);
        return;
      }
      // FIRST ready: this fighter spawns into the Waiting Area
      // (poster on the west pad, acceptor on the east pad).
      moveSessionToArea(me, 'waiting', isFrom ? 700 : 900, 450);
      send(ws, { type: 'stake_waiting', matchId: match.id, opponent: oppName, stake: match.stake, pot: match.stake * 2 });
      send(ws, { type: 'chat', from: 'Stake Board', text: `⏳ You're in the Waiting Area — the fight starts the moment ${oppName} is ready.` });
      if (oppSess) send(oppSess.ws, { type: 'chat', from: 'Stake Board', text: `⏳ ${profile.username} is ready and waiting in the Waiting Area — hit Ready to start the fight!` });
      sendStakeMatchUpdate(match);
      broadcastState();
    }
    if (m.type === 'stake_match_cancel') {
      const match = stakeOffers.get(String(m.matchId || ''));
      if (!match || match.status !== 'matched' || (match.fromKey !== key && match.toKey !== key)) return send(ws, { type: 'error', message: 'That stake match is gone.' });
      cancelStakeMatch(match, `${profile.username} cancelled the stake match — no gold was taken.`);
    }
  });

  ws.on('close', () => {
    const me = online.get(key);
    if (me && me.duelId) {
      const duel = duels.get(me.duelId);
      if (duel) endDuel(duel, duel.a === key ? duel.b : duel.a, 'forfeit — left mid-duel');
    }
    if (me && me.modDuelId) {
      const f = modDuels.get(me.modDuelId);
      if (f) endModDuel(f, 'forfeit'); // the escrowed stake is lost, exactly like a duel forfeit
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
    // Stage 17: the leaver's open stake offers come down, and a
    // matched stake match is cancelled — the other party (if they
    // were standing in the Waiting Area) is returned to the plaza
    // and notified. No gold ever moves on a cancel.
    {
      let boardChanged = false;
      for (const [oid, o] of [...stakeOffers]) {
        if (o.status === 'open' && o.fromKey === key) { stakeOffers.delete(oid); boardChanged = true; }
      }
      if (boardChanged) broadcastStakeBoard();
      const myMatch = stakeMatchForKey(key);
      if (myMatch) cancelStakeMatch(myMatch, `${profile.username} left — the stake match is cancelled. No gold was taken.`);
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
