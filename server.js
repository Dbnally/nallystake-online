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
// Weapons: the 1h melee row of the weapons chart (Stage 34 port of
// the app version's chart): nine tiers, Bronze -> Necro. The five
// original ids keep their ids and names; their prices and max hits
// are aligned to the chart (bronze 50->90g, iron 120->180g, steel
// 300->360g, mithril 800->720g and max 6->5, dragon 2500->5760g and
// max 10->9). accBonus keeps the online ladder (the app's melee row
// carries no accuracy stat; its `bonus` is the max hit here).
for (const [id, name, tier, buy, accBonus, maxBonus, icon, color] of [
  ['bronze_sword', 'Bronze sword', 'bronze', 90, 0.02, 1, null, null],
  ['iron_sword', 'Iron sword', 'iron', 180, 0.04, 2, null, null],
  ['steel_sword', 'Steel sword', 'steel', 360, 0.06, 4, null, null],
  ['mithril_sword', 'Mithril sword', 'mithril', 720, 0.08, 5, null, null],
  ['adamant_sword', 'Adamant sword', 'adamant', 1440, 0.10, 6, '⚔️', null],
  ['rune_scimitar', 'Rune scimitar', 'rune', 2880, 0.11, 7, '🗡', null],
  ['dragon_sword', 'Dragon sword', 'dragon', 5760, 0.12, 9, null, null],
  ['torva_sword', 'Torva sword', 'torva', 11520, 0.14, 11, '⚔️', '#9fd4e8'],
  ['necro_blade', 'Necro blade', 'necro', 23040, 0.16, 13, '🗡', '#8a3ffc'],
]) {
  ITEMS[id] = { name, kind: 'weapon', slot: 'weapon', style: 'melee', tier, buy, accBonus, maxBonus, shop: 'Weapon',
    ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
}
// Armour: the MELEE PLATE line of the armour chart (Stage 34 port
// of the app version's chart): nine tiers, Bronze -> Necro, x helm /
// platebody / platelegs / boots. The app's per-slot `block` is the
// online `reduction`, its `acc` points are accBonus at the x40
// scale, its `hit` is maxBonus (the Stage 28 mapping). The three
// original tiers' pieces keep their ids; their stats and prices are
// aligned to the chart (e.g. bronze helm reduction 0.03 -> 0.01 and
// 60 -> 90g, dragon platebody 0.10 -> 0.32 and 2250 -> 8960g).
// Wearing head+body+legs plus a shield or boots adds a +5% set
// bonus (see armourReduction); the total is capped at 45%.
// The three SHIELDS are not chart pieces (the app's chart has no
// shield row) — they keep their existing stats and prices as-is.
const PLATE_CHART = {
  //            color       helm {block,buy,hit}        body {block,buy}      legs {block,buy}      boots {block,buy,acc}
  bronze: { color: '#b0703f', helm: [0.01, 90, 0], body: [0.04, 140], legs: [0.01, 80], boots: [0.01, 70, 0] },
  iron: { color: '#9aa2ad', helm: [0.02, 180, 0], body: [0.08, 280], legs: [0.02, 160], boots: [0.02, 140, 0] },
  steel: { color: '#dfe8f2', helm: [0.03, 360, 0], body: [0.12, 560], legs: [0.03, 320], boots: [0.03, 280, 0] },
  mithril: { color: '#4a6fd4', helm: [0.04, 720, 0], body: [0.16, 1120], legs: [0.04, 640], boots: [0.03, 560, 1] },
  adamant: { color: '#3fae6a', helm: [0.05, 1440, 0], body: [0.20, 2240], legs: [0.05, 1280], boots: [0.04, 1120, 1] },
  rune: { color: '#2a4fd0', helm: [0.06, 2880, 0], body: [0.24, 4480], legs: [0.06, 2560], boots: [0.05, 2240, 1] },
  dragon: { color: '#a8161f', helm: [0.07, 5760, 1], body: [0.32, 8960], legs: [0.07, 5120], boots: [0.05, 4480, 2] },
  torva: { color: '#cfe2ec', helm: [0.08, 11520, 1], body: [0.36, 17920], legs: [0.08, 10240], boots: [0.06, 8960, 2] },
  necro: { color: '#5b21b6', helm: [0.09, 23040, 2], body: [0.40, 35840], legs: [0.09, 20480], boots: [0.07, 17920, 3] },
};
const PLATE_SLOT_DEF = {
  helm: { slot: 'head', suffix: 'helm', icon: '🪖' },
  body: { slot: 'body', suffix: 'platebody', icon: '🛡️' },
  legs: { slot: 'legs', suffix: 'platelegs', icon: '🦵' },
  boots: { slot: 'feet', suffix: 'boots', icon: '🥾' },
};
const PLATE_DESC = {
  helm: ['A brown bronze helm — the first rung of the armour ladder.', 'A plain iron helm with a brim and plume.', 'Bright polished steel, plume and all.', 'A blue-purple mithril helm, light for its strength.', 'A green adamant helm — stubborn, heavy plate.', 'A deep blue rune helm, humming faintly with old magic.', 'Bright crimson dragon plate helm with the full crown of bone horns.', 'Pale steel crowned with horns and cyan ice-crystal trim — Torva, the frost tier above dragon.', 'Dark purple and cruelly spiked — the Necro helm, the strongest helm on the ladder.'],
  body: ['A brown bronze platebody — the first rung of the armour ladder.', 'A plain iron platebody.', 'Bright polished steel plate.', 'A blue-purple mithril platebody, light for its strength.', 'A green adamant platebody — stubborn, heavy plate.', 'A deep blue rune platebody, humming faintly with old magic.', 'Bright crimson dragon plate, the full chest piece.', 'Pale steel plate trimmed with cyan ice crystal — Torva, the frost tier above dragon.', 'Dark purple and cruelly spiked — the Necro platebody, the strongest body on the ladder.'],
  legs: ['Brown bronze platelegs — the first rung of the armour ladder.', 'Grey iron platelegs.', 'Bright steel platelegs.', 'Blue-purple mithril platelegs, light for their strength.', 'Green adamant platelegs — stubborn, heavy plate.', 'Deep blue rune platelegs, humming faintly with old magic.', 'Bright crimson dragon plate legs.', 'Pale steel platelegs trimmed with cyan ice crystal — Torva, the frost tier above dragon.', 'Dark purple and cruelly spiked — the Necro platelegs, the strongest legs on the ladder.'],
  boots: ['Brown bronze boots — the first rung of the armour ladder.', 'Grey iron boots.', 'Bright steel boots.', 'Blue-purple mithril boots, light for their strength.', 'Green adamant boots — stubborn, heavy plate.', 'Deep blue rune boots, humming faintly with old magic.', 'Bright crimson dragon boots.', 'Pale steel boots trimmed with cyan ice crystal — Torva, the frost tier above dragon.', 'Dark purple and cruelly spiked — the Necro boots, the strongest boots on the ladder.'],
};
const PLATE_TIER_ORDER = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune', 'dragon', 'torva', 'necro'];
for (let t = 0; t < PLATE_TIER_ORDER.length; t += 1) {
  const tier = PLATE_TIER_ORDER[t];
  const row = PLATE_CHART[tier];
  for (const part of ['helm', 'body', 'legs', 'boots']) {
    const sd = PLATE_SLOT_DEF[part];
    const st = row[part];
    ITEMS[`${tier}_${sd.suffix}`] = {
      name: `${cap(tier)} ${sd.suffix}`, icon: sd.icon, kind: 'armour', slot: sd.slot, tier, buy: st[1], shop: 'Armour',
      reduction: st[0], maxBonus: part === 'helm' ? (st[2] || 0) : 0, accBonus: part === 'boots' ? (st[2] || 0) / 40 : 0,
      color: row.color, desc: PLATE_DESC[part][t],
    };
  }
}
for (const [tier, reduction, buy] of [['bronze', 0.03, 60], ['steel', 0.06, 250], ['dragon', 0.10, 1500]]) {
  ITEMS[`${tier}_shield`] = { name: `${cap(tier)} shield`, kind: 'armour', slot: 'shield', tier, buy, reduction, shop: 'Armour' };
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
  { id: 'snapdragon', name: 'Snapdragon herbs', base: 30, min: 12, max: 70 }, // Tree Guardian chain (2026-11-24): the second herblore herb — hobgoblin drops, Exchange-traded like ranarr
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
// Stage 29: Seaweed — picked up from the clumps washed up along the
// Fishing Cove shore (see the seaweed patches below). It NEVER
// stacks: `noStack` makes every inventory path (addStacks /
// removeStacks / stackQty) treat each piece as its own qty-1 stack,
// so a pack full of seaweed is exactly 28 pieces in 28 slots — the
// app version's rule. The app prices it at a 6g base on its market;
// the fixed shop buy-back here is 2g, in line with the other
// sell-only resources (raw shrimps 3g, logs 4g).
ITEMS.seaweed = { name: 'Seaweed', icon: '🥬', kind: 'resource', sellOnly: 2, noStack: true };
// Farm life (Derek, 2026-11-23): the plaza farm's produce — every
// piece builds a skill, per his standing drop law. Wool is spun
// into yarn by the crafting chain that follows this build (for now
// it stacks, banks and sells like any resource); cowhide sells to
// the shops until its leather work arrives (no tanning invented
// here); raw beef cooks on a fire exactly like raw fish (see
// COOKABLE) into cooked beef. The bones are a NEW item — the
// existing `bones` id is the Dragon bones Exchange good and is NOT
// touched: these bury for Prayer XP (see the 'bury' handler).
ITEMS.wool = { name: 'Wool', icon: '🧶', kind: 'resource', sellOnly: 6, desc: 'Soft wool from a plaza sheep. Spin it into yarn at the spinning wheel by the farm rows.' };
ITEMS.cowhide = { name: 'Cowhide', icon: '🐄', kind: 'resource', sellOnly: 12, desc: 'A cowhide from a plaza cow. Shops buy it as-is; leather work comes later.' };
ITEMS.animal_bones = { name: 'Bones', icon: '🦴', kind: 'resource', sellOnly: 3, desc: 'Bones from a farm animal. Bury them for Prayer XP.' };
ITEMS.raw_beef = { name: 'Raw beef', icon: '🥩', kind: 'resource', sellOnly: 5, desc: 'Raw beef from a plaza cow. Cook it on a fire.' };
ITEMS.cooked_beef = { name: 'Cooked beef', icon: '🍖', kind: 'food', heal: 12, sellOnly: 9, desc: 'Cooked beef. Eat it to heal.' };
// Crafting chain (Derek, 2026-11-23): wool -> spinning wheel ->
// yarn; yarn strings amulets; gold ore -> smelted gold bars (the
// `bars` good, Stage 3); gems from mining; the new Crafting skill
// makes unstrung amulets (1 gold bar + 1 gem); string with yarn ->
// wearable amulet; enchant with Magic spells -> enchanted amulet.
// Gem tiers weakest -> strongest, Derek's corrected order:
// Sapphire, Emerald, Ruby, Diamond, Dragonstone.
// Gems turn up while mining ANY rock (see the gather handler's gem
// roll): 6% of a successful mine, weighted down the tier ladder;
// the Gathering Cave's Gem rock rolls at 25% instead (its base
// yield stays the generic `uncut_gem`). Sell prices are a rising
// ladder by tier (flagged choices, Derek can retune).
const GEM_DEFS = {
  sapphire:    { name: 'Sapphire',    icon: '🔷', color: '#2f6fd0', sell: 30 },
  emerald:     { name: 'Emerald',     icon: '💚', color: '#1faa59', sell: 60 },
  ruby:        { name: 'Ruby',        icon: '🔴', color: '#d42a35', sell: 120 },
  diamond:     { name: 'Diamond',     icon: '💎', color: '#9fd8e8', sell: 250 },
  dragonstone: { name: 'Dragonstone', icon: '🟣', color: '#8e44ad', sell: 500 },
};
const GEM_TIERS = Object.keys(GEM_DEFS); // weakest -> strongest
const GEM_ROLL_WEIGHTS = [['sapphire', 40], ['emerald', 28], ['ruby', 18], ['diamond', 9], ['dragonstone', 5]];
function rollGem() {
  let total = 0; for (const [, w] of GEM_ROLL_WEIGHTS) total += w;
  let r = Math.random() * total;
  for (const [gem, w] of GEM_ROLL_WEIGHTS) { r -= w; if (r <= 0) return gem; }
  return 'sapphire';
}
for (const [gem, gd] of Object.entries(GEM_DEFS)) {
  ITEMS[gem] = { name: gd.name, icon: gd.icon, kind: 'gem', color: gd.color, sellOnly: gd.sell, desc: `A ${gd.name.toLowerCase()} turned up while mining. Set it in a gold amulet with Crafting.` };
}
ITEMS.yarn = { name: 'Ball of yarn', icon: '🧵', kind: 'resource', sellOnly: 10, desc: 'Wool spun at the farm spinning wheel. Use it to string an unstrung amulet.' };
// Amulet making: Crafting level gates + XP per unstrung amulet
// (flagged ladder, Derek can retune). Stringing pays STRING_XP.
const AMULET_CRAFT = {
  sapphire:    { level: 1,  xp: 20 },
  emerald:     { level: 15, xp: 35 },
  ruby:        { level: 30, xp: 55 },
  diamond:     { level: 45, xp: 80 },
  dragonstone: { level: 60, xp: 110 },
};
const STRING_XP = 6; // Crafting XP for stringing one amulet
// Enchanted-amulet bonuses (flagged defaults, proposed to Derek):
// Sapphire +Magic (spell max hit), Emerald +Defence (damage
// reduction), Ruby +Strength (melee max hit), Diamond a little of
// everything, Dragonstone the strongest (glory-style Strength +
// Magic). They ride the existing worn-armour paths: accBonus feeds
// weaponAccPoints (every style's accuracy), maxBonus feeds
// armourMaxBonus (melee max), reduction feeds armourReduction,
// and the new magicBonus feeds rollMagicCast's spell max.
const AMULET_ENCHANT_BONUS = {
  sapphire:    { accBonus: 0.02, magicBonus: 3 },
  emerald:     { accBonus: 0.02, reduction: 0.03 },
  ruby:        { accBonus: 0.02, maxBonus: 2 },
  diamond:     { accBonus: 0.03, maxBonus: 1, reduction: 0.02, magicBonus: 1 },
  dragonstone: { accBonus: 0.03, maxBonus: 3, magicBonus: 3 },
};
for (const gem of GEM_TIERS) {
  const gd = GEM_DEFS[gem];
  const tierIdx = GEM_TIERS.indexOf(gem);
  // Unstrung: a shaped gold setting holding the gem — a resource
  // until it is strung (not wearable yet).
  ITEMS[`${gem}_amulet_unstrung`] = { name: `${gd.name} amulet (unstrung)`, icon: '📿', kind: 'resource', color: gd.color, sellOnly: 60 * Math.pow(2, tierIdx), gem, desc: `A gold amulet set with a ${gd.name.toLowerCase()}, waiting for a string. String it with a ball of yarn.` };
  // Strung: wearable in the amulet slot; a token +accuracy until
  // it is enchanted (accBonus 0.02 = 1 accuracy point, the same
  // rounding weaponAccPoints applies to every armour piece).
  ITEMS[`${gem}_amulet`] = { name: `${gd.name} amulet`, icon: '📿', kind: 'armour', slot: 'amulet', color: gd.color, sellOnly: 90 * Math.pow(2, tierIdx), gem, accBonus: 0.02, desc: `A ${gd.name.toLowerCase()} amulet on a yarn string. Enchant it with the Enchant ${gd.name} spell to wake its power.` };
  ITEMS[`${gem}_amulet_enchanted`] = { name: `${gd.name} amulet (enchanted)`, icon: '📿', kind: 'armour', slot: 'amulet', color: gd.color, sellOnly: 160 * Math.pow(2, tierIdx), gem, ...AMULET_ENCHANT_BONUS[gem], desc: `A ${gd.name.toLowerCase()} amulet humming with magic — its enchantment boosts you while you wear it.` };
}
// Tree Guardian maker + herblore chain (Derek, 2026-11-24): sand
// scooped at the Fishing Cove shore (in a bucket) + seaweed, worked
// at the Emberfall furnace WITH your Tree Guardian beside you,
// becomes molten glass; the glass blows into vials and a lantern;
// a vial + a herb mixes into a potion (ranarr -> Prayer potion,
// snapdragon -> Restore potion). The bucket is a cheap shop tool
// and is NOT consumed by scooping or glassmaking — it comes back
// empty each time. Prices are sell-back values in line with the
// other made chains (flagged choices, Derek can retune).
ITEMS.bucket = { name: 'Bucket', icon: '🪣', kind: 'tool', buy: 5, shop: 'Food & Supplies', desc: 'An empty bucket. Scoop sand with it at the Fishing Cove shore, beside the seaweed.' };
ITEMS.bucket_of_sand = { name: 'Bucket of sand', icon: '🪣', kind: 'resource', sellOnly: 3, desc: 'A bucket brimming with cove sand. Worked with seaweed at a furnace, it becomes glass.' };
ITEMS.molten_glass = { name: 'Molten glass', icon: '🔸', kind: 'resource', sellOnly: 15, desc: 'A glowing blob of fresh glass — seaweed and sand, melted together. Your guardian keeps it workable; blow it into a vial or a lantern at the furnace.' };
ITEMS.glass_vial = { name: 'Glass vial', icon: '🧪', kind: 'resource', sellOnly: 8, desc: 'An empty hand-blown glass vial. Mix it with a herb to make a potion.' };
ITEMS.glass_lantern = { name: 'Glass lantern', icon: '🏮', kind: 'resource', sellOnly: 25, desc: 'A hand-blown glass lantern. Place it in the world from your backpack — it stays there until you take it back or smash it (or an admin removes it).' };
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
  ['bronze', 60, 1.0], ['iron', 120, 1.15], ['steel', 240, 1.3],
  ['mithril', 480, 1.5], ['adamant', 960, 1.75], ['rune', 1920, 2.0], ['dragon', 3840, 2.5],
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
const ARROW_BUY = { bronze: 6, iron: 12, steel: 24, mithril: 48, adamant: 96, rune: 192 }; // Weapon shop price per arrow
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
  ['shortbow', 'Shortbow', 120, 0.04], ['oak_shortbow', 'Oak shortbow', 240, 0.06],
  ['willow_shortbow', 'Willow shortbow', 480, 0.08], ['maple_shortbow', 'Maple shortbow', 960, 0.10],
  ['yew_shortbow', 'Yew shortbow', 1920, 0.13], ['magic_shortbow', 'Magic shortbow', 3840, 0.16],
]) {
  ITEMS[id] = { name, icon: '🏹', kind: 'weapon', slot: 'weapon', style: 'ranged', buy, accBonus, maxBonus: 0, shop: 'Weapon' };
}
for (const [id, name, buy, accBonus] of [
  ['staff', 'Staff', 150, 0.04], ['magic_staff', 'Magic staff', 300, 0.08], ['mystic_staff', 'Mystic staff', 600, 0.12],
]) {
  ITEMS[id] = { name, icon: '🪄', kind: 'weapon', slot: 'weapon', style: 'magic', buy, accBonus, maxBonus: 0, shop: 'Weapon' };
}
// ---------- Stage 34: the four gear charts (port of the app version) ----------
// The RANGED armour line (d'hide): Leather -> Studded -> Snakeskin
// -> Green / Blue / Red / Black D'hide -> Karil's -> Armadyl, x coif
// (head) / body / chaps (legs) / boots (feet). The Karil's rung is
// the existing Barrows loot (karils_coif / karils_top /
// karils_leatherskirt / karils_boots — their app stats already match
// this chart, so they are not redefined). The line trades the plate
// line's heavy reduction for accuracy: its `acc` points ride as
// accBonus at the x40 scale and count from armour slots through
// weaponAccPoints, exactly like the Barrows pieces. The app encodes
// no style-specific defence (its block is one number), so the
// online single `reduction` is a direct port, no simplification.
const DHIDE_TIERS = ['leather', 'studded', 'snakeskin', 'green', 'blue', 'red', 'black', 'armadyl'];
const DHIDE_NAME = { leather: 'Leather', studded: 'Studded', snakeskin: 'Snakeskin', green: "Green d'hide", blue: "Blue d'hide", red: "Red d'hide", black: "Black d'hide", armadyl: 'Armadyl' };
const DHIDE_COLORS = ['#9a6b42', '#7a5230', '#9a9a6a', '#2fae4e', '#2456d0', '#c02727', '#2b2b33', '#e8e0c8'];
const DHIDE_STATS = {
  //            acc pts        block by tier                       buy by tier
  coif: { acc: [1, 2, 3, 4, 5, 6, 7, 10], block: [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05], buy: [60, 120, 240, 480, 960, 1920, 3840, 7680], slot: 'head', suffix: 'coif', icon: '🧢' },
  body: { acc: [1, 2, 3, 4, 5, 6, 7, 10], block: [0.02, 0.04, 0.06, 0.09, 0.12, 0.15, 0.18, 0.25], buy: [120, 240, 480, 960, 1920, 3840, 7680, 15360], slot: 'body', suffix: 'body', icon: '🧥' },
  chaps: { acc: [1, 2, 3, 4, 5, 6, 7, 10], block: [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05], buy: [55, 110, 220, 440, 880, 1760, 3520, 7040], slot: 'legs', suffix: 'chaps', icon: '👖' },
  boots: { acc: [1, 2, 3, 4, 5, 6, 7, 10], block: [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05], buy: [50, 100, 200, 400, 800, 1600, 3200, 6400], slot: 'feet', suffix: 'boots', icon: '🥾' },
};
const DHIDE_DESC = {
  coif: ["Ranged armour — a plain brown leather coif. Accuracy over bulk: +1 to every hit chance.", 'Ranged armour — studded leather, a little tougher than plain.', 'Ranged armour — a snakeskin bandana-coif in khaki scales.', 'Ranged armour — green dragonhide, light and springy.', 'Ranged armour — blue dragonhide, a grade above green.', 'Ranged armour — red dragonhide, rich and tough.', 'Ranged armour — black dragonhide, the finest hide on the shelf.', 'Ranged armour — white-and-gold Armadyl, ornate winged crest. The strongest coif on the ranged line.'],
  body: ['Ranged armour — a plain brown leather body. Accuracy over bulk.', 'Ranged armour — studded leather body, a little tougher than plain.', 'Ranged armour — a snakeskin body in khaki scales.', 'Ranged armour — green dragonhide body, light and springy.', 'Ranged armour — blue dragonhide body, a grade above green.', 'Ranged armour — red dragonhide body, rich and tough.', 'Ranged armour — black dragonhide body, the finest hide on the shelf.', 'Ranged armour — white-and-gold Armadyl platebody. The strongest body on the ranged line.'],
  chaps: ['Ranged armour — plain brown leather chaps. Accuracy over bulk.', 'Ranged armour — studded leather chaps.', 'Ranged armour — khaki snakeskin chaps.', 'Ranged armour — green dragonhide chaps.', 'Ranged armour — blue dragonhide chaps.', 'Ranged armour — red dragonhide chaps.', 'Ranged armour — black dragonhide chaps, the finest hide on the shelf.', 'Ranged armour — white-and-gold Armadyl chaps with an ornate skirted waist. The strongest chaps on the ranged line.'],
  boots: ['Ranged armour — plain brown leather boots. Accuracy over bulk.', 'Ranged armour — studded leather boots.', 'Ranged armour — khaki snakeskin boots.', 'Ranged armour — green dragonhide boots.', 'Ranged armour — blue dragonhide boots.', 'Ranged armour — red dragonhide boots.', 'Ranged armour — black dragonhide boots, the finest hide on the shelf.', 'Ranged armour — white-and-gold Armadyl boots. The strongest boots on the ranged line.'],
};
for (const part of ['coif', 'body', 'chaps', 'boots']) {
  const st = DHIDE_STATS[part];
  for (let t = 0; t < DHIDE_TIERS.length; t += 1) {
    const tier = DHIDE_TIERS[t];
    const id = tier === 'armadyl' && part === 'body' ? 'armadyl_platebody' : `${tier}_${st.suffix === 'body' ? 'body' : st.suffix}`;
    ITEMS[id] = {
      name: part === 'body' && tier === 'armadyl' ? 'Armadyl platebody' : `${DHIDE_NAME[tier]} ${st.suffix}`,
      icon: tier === 'armadyl' && part === 'coif' ? '👑' : st.icon, kind: 'armour', slot: st.slot, tier,
      buy: st.buy[t], shop: 'Armour', reduction: st.block[t], accBonus: st.acc[t] / 40, maxBonus: 0,
      color: DHIDE_COLORS[t], desc: DHIDE_DESC[part][t],
    };
  }
}
// The MAGIC armour line (robes): the same nine metal tier names as
// wizard gear — pointed hat (head) / robe top (body) / robe skirt
// (legs) / wizard boots (feet). The least reduction of any line and
// the most accuracy: robes are for landing spells. Distinct pieces
// from the plate line — a Bronze wizard hat is not a Bronze helm.
const ROBE_COLORS = ['#9a6b42', '#6b6560', '#b9c2cc', '#35d0e0', '#2f9e57', '#2a3fd0', '#c02727', '#cfe2ec', '#5b21b6'];
const ROBE_STATS = {
  wizard_hat: { acc: [2, 3, 4, 6, 7, 8, 10, 12, 14], block: [0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05], buy: [70, 140, 280, 560, 1120, 2240, 4480, 8960, 17920], slot: 'head', icon: '🧙', label: 'wizard hat' },
  robe_top: { acc: [2, 3, 4, 6, 7, 8, 10, 12, 14], block: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12], buy: [130, 260, 520, 1040, 2080, 4160, 8320, 16640, 33280], slot: 'body', icon: '👘', label: 'robe top' },
  robe_skirt: { acc: [2, 3, 4, 6, 7, 8, 10, 12, 14], block: [0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05], buy: [65, 130, 260, 520, 1040, 2080, 4160, 8320, 16640], slot: 'legs', icon: '👗', label: 'robe skirt' },
  wizard_boots: { acc: [2, 3, 4, 5, 6, 7, 9, 11, 13], block: [0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05], buy: [55, 110, 220, 440, 880, 1760, 3520, 7040, 14080], slot: 'feet', icon: '🥾', label: 'wizard boots' },
};
const ROBE_DESC = {
  wizard_hat: ['Magic armour — a plain tan pointed hat, cloth and leather-toned. The first rung of the wizard ladder.', 'Magic armour — a grey cloth pointed hat with a buckled band.', 'Magic armour — a silver-grey pointed hat, stiffened with steel thread.', 'Magic armour — a glowing cyan pointed hat, humming with stored spells.', 'Magic armour — a green pointed hat with a gold clasp.', 'Magic armour — a dark blue hood stitched with glowing runes.', 'Magic armour — a red-and-gold hood with flame trim, warm to the touch.', 'Magic armour — a pale ice-crystal crown-helm, frost curling off its horns. The wizard Torva tier.', 'Magic armour — a dark purple hood with a single watching eye. The strongest wizard hat on the ladder.'],
  robe_top: ['Magic armour — a plain tan robe top, cloth and leather-toned. The first rung of the wizard ladder.', 'Magic armour — a grey cloth robe top.', 'Magic armour — a silver-grey robe top.', 'Magic armour — a glowing cyan robe top, humming with stored spells.', 'Magic armour — a green robe top with gold trim.', 'Magic armour — a dark blue robe top stitched with glowing runes.', 'Magic armour — a red robe top with gold flame trim.', 'Magic armour — a pale ice-crystal robe top. The wizard Torva tier.', 'Magic armour — a dark purple robe top with a watching-eye clasp. The strongest robe top on the ladder.'],
  robe_skirt: ['Magic armour — a plain tan robe skirt, cloth and leather-toned.', 'Magic armour — a grey cloth robe skirt.', 'Magic armour — a silver-grey robe skirt with chevron hems.', 'Magic armour — a glowing cyan robe skirt, panels drifting with stored spells.', 'Magic armour — a green robe skirt with gold trim.', 'Magic armour — a dark blue robe skirt stitched with glowing runes.', 'Magic armour — a red robe skirt with gold flame trim.', 'Magic armour — a pale ice-crystal robe skirt, frost at its hem. The wizard Torva tier.', 'Magic armour — a dark purple robe skirt with a watching-eye clasp. The strongest robe skirt on the ladder.'],
  wizard_boots: ['Magic armour — plain tan wizard boots, cloth and leather-toned.', 'Magic armour — grey cloth wizard boots with buckles.', 'Magic armour — silver-grey wizard boots with wrapped straps.', 'Magic armour — glowing cyan wizard boots.', 'Magic armour — green wizard boots with gold trim.', 'Magic armour — dark blue wizard boots stitched with glowing runes.', 'Magic armour — red wizard boots with gold flame trim.', 'Magic armour — pale ice-crystal wizard boots. The wizard Torva tier.', 'Magic armour — dark purple wizard boots with glowing eye clasps. The strongest wizard boots on the ladder.'],
};
for (const part of ['wizard_hat', 'robe_top', 'robe_skirt', 'wizard_boots']) {
  const st = ROBE_STATS[part];
  for (let t = 0; t < PLATE_TIER_ORDER.length; t += 1) {
    const tier = PLATE_TIER_ORDER[t];
    ITEMS[`${tier}_${part}`] = {
      name: `${cap(tier)} ${st.label}`, icon: st.icon, kind: 'armour', slot: st.slot, tier,
      buy: st.buy[t], shop: 'Armour', reduction: st.block[t], accBonus: st.acc[t] / 40, maxBonus: 0,
      color: ROBE_COLORS[t], desc: ROBE_DESC[part][t],
    };
  }
}
// The weapons chart's other three rows (the 1h row is the sword
// ladder above). Row 2 — TWO-HANDED melee: +4 max hit over the 1h
// of its tier, a slower 6-tick swing (speedTicks), and no shield
// while wielded (twoHanded — the equip handler moves a worn shield
// back to the backpack, and a shield equip displaces a wielded 2h;
// see the equip handler). Dragon Slash still rides a 2h swing, as
// in the app ("Special: Dragon Slash (55% energy)").
// Row 3 — ranged: bows by tier, with a CROSSBOW at Steel (5-tick
// swing, the app's ticks). The app has no bolt item — its ranged
// weapons use the same ammunition story as Karil's crossbow here:
// the crossbow fires ARROWS, one per shot from the first ammo
// stack, exactly like a bow. A bow's app `bonus` rides as the
// weapon's own strBonus (added to the shot's max hit in
// rollStyleAttack, beside the arrow's); its `acc` points are
// accBonus at the x40 scale.
// Row 4 — magic: staves and wands whose app `bonus` is maxBonus
// (added to spell max hits in rollMagicCast when a magic weapon is
// wielded) and whose `acc` points are accBonus at the x40 scale —
// so a Necro staff (acc 17, bonus 12) visibly out-casts a Bronze
// staff (acc 2, bonus 1). Torva and Necro are shop-bought at top
// prices like their armour — no ores exist for them, in either
// version, and nothing in these rows is smithable (the app's
// smithing makes its own instance gear, as online's does).
for (const [id, name, tier, buy, accBonus, maxBonus, icon, color] of [
  ['bronze_greatsword', 'Bronze greatsword', 'bronze', 150, 0.02, 5, '⚔️', null],
  ['iron_battleaxe', 'Iron battleaxe', 'iron', 300, 0.04, 6, '🪓', null],
  ['steel_war_hammer', 'Steel war hammer', 'steel', 600, 0.06, 8, '🔨', null],
  ['mithril_battleaxe', 'Mithril battleaxe', 'mithril', 1200, 0.08, 9, '🪓', null],
  ['adamant_greatsword', 'Adamant greatsword', 'adamant', 2400, 0.10, 10, '⚔️', null],
  ['rune_battleaxe', 'Rune battleaxe', 'rune', 4800, 0.11, 11, '🪓', null],
  ['dragon_greatsword', 'Dragon greatsword', 'dragon', 9600, 0.12, 13, '⚔️', null],
  ['torva_maul', 'Torva maul', 'torva', 19200, 0.14, 15, '🔨', '#9fd4e8'],
  ['necro_scythe', 'Necro scythe', 'necro', 38400, 0.16, 17, '🌙', '#8a3ffc'],
]) {
  ITEMS[id] = { name, icon, kind: 'weapon', slot: 'weapon', style: 'melee', tier, buy, accBonus, maxBonus, shop: 'Weapon',
    speedTicks: 6, twoHanded: true, ...(color ? { color } : {}),
    desc: `Max hit +${maxBonus} · Two-handed: slower 6-tick swings, and no shield while wielded · Special: Dragon Slash (55% energy).` };
}
for (const [id, name, tier, buy, accPts, strBonus, ticks, color] of [
  ['bronze_bow', 'Bronze bow', 'bronze', 80, 1, 1, 0, null],
  ['iron_bow', 'Iron bow', 'iron', 160, 2, 2, 0, null],
  ['steel_crossbow', 'Steel crossbow', 'steel', 320, 3, 4, 5, null],
  ['mithril_bow', 'Mithril bow', 'mithril', 640, 4, 5, 0, null],
  ['adamant_bow', 'Adamant bow', 'adamant', 1280, 5, 6, 0, null],
  ['rune_bow', 'Rune bow', 'rune', 2560, 6, 7, 0, null],
  ['dragon_bow', 'Dragon bow', 'dragon', 5120, 8, 9, 0, null],
  ['torva_bow', 'Torva bow', 'torva', 10240, 10, 11, 0, '#9fd4e8'],
  ['necro_bow', 'Necro bow', 'necro', 20480, 12, 13, 0, '#8a3ffc'],
]) {
  ITEMS[id] = { name, icon: '🏹', kind: 'weapon', slot: 'weapon', style: 'ranged', tier, buy, accBonus: accPts / 40, maxBonus: 0, strBonus, shop: 'Weapon',
    ...(ticks ? { speedTicks: ticks } : {}), ...(color ? { color } : {}),
    desc: id === 'steel_crossbow' ? 'A steel crossbow — slower 5-tick shots. It fires ordinary arrows, like every ranged weapon here; there is no separate bolt.' : `A ${name.toLowerCase()} — its strength adds to every shot's max hit.` };
}
for (const [id, name, tier, buy, accPts, maxBonus, icon, color] of [
  ['bronze_staff', 'Bronze staff', 'bronze', 70, 2, 1, '🪄', null],
  ['iron_wand', 'Iron wand', 'iron', 140, 3, 2, '🪄', null],
  ['steel_wand', 'Steel wand', 'steel', 280, 5, 3, '🪄', null],
  ['mithril_staff', 'Mithril staff', 'mithril', 560, 6, 4, '🪄', null],
  ['adamant_staff', 'Adamant staff', 'adamant', 1120, 8, 5, '🪄', null],
  ['rune_staff', 'Rune staff', 'rune', 2240, 9, 6, '🪄', null],
  ['dragon_staff', 'Dragon staff', 'dragon', 4480, 11, 8, '🪄', null],
  ['torva_staff', 'Torva staff', 'torva', 8960, 14, 10, '🪄', '#9fd4e8'],
  ['necro_staff', 'Necro staff', 'necro', 17920, 17, 12, '🪄', '#8a3ffc'],
]) {
  ITEMS[id] = { name, icon, kind: 'weapon', slot: 'weapon', style: 'magic', tier, buy, accBonus: accPts / 40, maxBonus, shop: 'Weapon',
    ...(color ? { color } : {}), desc: `A casting weapon — its accuracy and max-hit bonus feed every spell you cast with it.` };
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
  // Crafting chain (Derek, 2026-11-23): Enchant spells — one per
  // gem tier, weakest to strongest. NOT combat spells: they are
  // cast on a strung amulet in your backpack (the enchant_amulet
  // handler), never selected for a staff (set_spell refuses them)
  // and never button-cast at a target (cast_at refuses them).
  // `element` is the rune they burn — a deliberate rune sink ahead
  // of Runecrafting. Magic levels / rune costs / cast XP are
  // flagged choices, Derek can retune.
  { id: 'enchant_sapphire', name: 'Enchant Sapphire', element: 'water', tier: 'enchant', level: 7, runes: 3, max: 0, gem: 'sapphire', castXp: 25, icon: '✨', desc: 'Enchants a strung sapphire amulet: +Magic while worn.' },
  { id: 'enchant_emerald', name: 'Enchant Emerald', element: 'earth', tier: 'enchant', level: 27, runes: 3, max: 0, gem: 'emerald', castXp: 40, icon: '✨', desc: 'Enchants a strung emerald amulet: +Defence while worn.' },
  { id: 'enchant_ruby', name: 'Enchant Ruby', element: 'fire', tier: 'enchant', level: 47, runes: 3, max: 0, gem: 'ruby', castXp: 55, icon: '✨', desc: 'Enchants a strung ruby amulet: +Strength while worn.' },
  { id: 'enchant_diamond', name: 'Enchant Diamond', element: 'air', tier: 'enchant', level: 57, runes: 5, max: 0, gem: 'diamond', castXp: 70, icon: '✨', desc: 'Enchants a strung diamond amulet: a little of everything while worn.' },
  { id: 'enchant_dragonstone', name: 'Enchant Dragonstone', element: 'fire', tier: 'enchant', level: 70, runes: 5, max: 0, gem: 'dragonstone', castXp: 90, icon: '✨', desc: 'Enchants a strung dragonstone amulet: the strongest — Strength + Magic while worn.' },
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

// ---------- Runecrafting + the first quest (Derek, 2026-11-24) ----------
// Derek's first quest, "Rune Crafting", teaches the new 16th skill
// end-to-end: Wizard Alden at the Wizard Grounds shows you the
// essence rocks, you mine rune essence (a pickaxe job, through the
// ordinary gather machinery), carry it to the altar in the stone
// circle, craft your first runes, then cast a spell burning runes
// you made yourself. The quest plumbing is deliberately general —
// QUEST_DEFS + a per-quest state record on the profile
// (p.quests[id] = { status, step, ...counters }) — so the next
// quest is a table entry, not a rebuild.
// The altar: the stone circle's centre (the client rings it with
// rune stones). Crafting converts essence in batches of up to
// RC_BATCH per action; every 10 Runecrafting levels past a rune's
// gate yields +1 rune per essence (cap x4) — the higher tiers are
// worth more per essence because their gates sit higher.
const RC_ALTAR_POS = { x: 800, y: 450 };
const RC_ALTAR_RANGE = 170;
const WIZARD_ALDEN_POS = { x: 920, y: 360 };
const QUEST_TALK_RANGE = 170;
const RC_TIERS = {
  air: { level: 1, xp: 9 },
  water: { level: 5, xp: 11 },
  earth: { level: 9, xp: 13 },
  fire: { level: 14, xp: 15 },
};
const RC_BATCH = 10;
function rcMultiFor(rcLevel, gate) { return Math.min(4, 1 + Math.floor(Math.max(0, rcLevel - gate) / 10)); }
ITEMS.rune_essence = { name: 'Rune essence', icon: '🔷', kind: 'resource', sellOnly: 3 };
// The quest's own numbers: mine 3 essence, craft 3 air runes, cast
// once with them, come back. The reward is first-quest scale: a
// lump of Runecrafting XP, a starter bundle of air runes and a
// little gold — handed over by Alden himself (quest_talk).
const RC_QUEST_ESSENCE = 3;
const RC_QUEST_RUNES = 3;
const RC_QUEST_REWARD = { xp: 100, gold: 50, runeItem: 'air_rune', runeQty: 20 };
const QUEST_DEFS = {
  runecrafting: {
    name: 'Rune Crafting', icon: '🔷', giver: 'Wizard Alden',
    steps: [
      { id: 'mine', label: (st) => `Mine rune essence from the essence rocks at the Wizard Grounds — ${Math.min(st.mined || 0, RC_QUEST_ESSENCE)}/${RC_QUEST_ESSENCE} (you need a pickaxe)` },
      { id: 'craft', label: (st) => `Craft air runes at the altar in the stone circle — ${Math.min((st.crafted && st.crafted.air) || 0, RC_QUEST_RUNES)}/${RC_QUEST_RUNES}` },
      { id: 'cast', label: () => 'Cast any spell using the runes you crafted (a staff and your spellbook both work)' },
      { id: 'return', label: () => 'Return to Wizard Alden for your reward' },
    ],
  },
};
// Normalised read of a quest's state: anything missing or malformed
// reads as not started. The stored shape is only ever written by
// the quest handlers below.
function questStateOf(p, qid) {
  const raw = (p.quests && typeof p.quests === 'object' && !Array.isArray(p.quests)) ? p.quests[qid] : null;
  if (!raw || typeof raw !== 'object') return { status: 'not_started', step: 0, mined: 0, crafted: {} };
  const st = {
    status: raw.status === 'active' || raw.status === 'done' ? raw.status : 'not_started',
    step: Number.isFinite(+raw.step) ? Math.max(0, Math.min(QUEST_DEFS[qid].steps.length - 1, Math.floor(+raw.step))) : 0,
    mined: Number.isFinite(+raw.mined) ? Math.max(0, Math.floor(+raw.mined)) : 0,
    crafted: (raw.crafted && typeof raw.crafted === 'object' && !Array.isArray(raw.crafted)) ? raw.crafted : {},
  };
  if (st.status === 'not_started') { st.step = 0; }
  return st;
}
function questsMsg(p) {
  ensureV2(p);
  return {
    type: 'quests',
    quests: Object.entries(QUEST_DEFS).map(([id, def]) => {
      const st = questStateOf(p, id);
      return {
        id, name: def.name, icon: def.icon, giver: def.giver, status: st.status, step: st.step,
        steps: def.steps.map((s, i) => ({
          id: s.id, label: s.label(st),
          done: st.status === 'done' || (st.status === 'active' && i < st.step),
          current: st.status === 'active' && i === st.step,
        })),
      };
    }),
  };
}
// Push the quest log + a chat line to a player whose quest just moved.
function rcQuestPush(key, chatLine) {
  const sess = online.get(key);
  if (!sess) return;
  if (chatLine) send(sess.ws, { type: 'chat', from: 'Game', text: chatLine });
  send(sess.ws, questsMsg(sess.profile));
}
// Advance the Runecrafting quest one step (never past the final
// 'return' step — talking to Alden finishes that one). Called by
// the gather hook (essence mined), the altar handler (runes
// crafted) and the cast hook (a spell cast with home-made runes).
function rcQuestAdvance(key) {
  const u = db.users[key];
  if (!u) return;
  const p = u.profile;
  const st = questStateOf(p, 'runecrafting');
  if (st.status !== 'active') return;
  if (st.step >= QUEST_DEFS.runecrafting.steps.length - 1) return;
  st.step += 1;
  p.quests.runecrafting = st;
  save(key);
  const next = QUEST_DEFS.runecrafting.steps[st.step];
  rcQuestPush(key, `🗺️ Quest step done! Next: ${next.label(st)}`);
}
// Gather hook: a successful essence mine counts toward the quest's
// mining step while it is the current step.
function rcQuestMined(key) {
  const u = db.users[key];
  if (!u) return;
  const st = questStateOf(u.profile, 'runecrafting');
  if (st.status !== 'active' || QUEST_DEFS.runecrafting.steps[st.step].id !== 'mine') return;
  st.mined = (st.mined || 0) + 1;
  u.profile.quests.runecrafting = st;
  if (st.mined >= RC_QUEST_ESSENCE) rcQuestAdvance(key);
  else { save(key); rcQuestPush(key, null); }
}
// Cast hook (called from rollMagicCast the moment a cast's runes
// are actually consumed — hit or miss, the spell was cast): the
// quest's cast step completes only when the caster crafted, during
// this quest, at least as many runes of the spell's element as the
// cast just burned. Enchant-amulet casts never reach this hook —
// they are not spell casts at a target and don't count.
function questCastHook(casterProfile, spell) {
  if (!casterProfile || casterProfile.bot || !spell) return;
  const key = userKeyFor(casterProfile.username || '');
  if (!key || !db.users[key] || db.users[key].profile !== casterProfile) return;
  const st = questStateOf(casterProfile, 'runecrafting');
  if (st.status !== 'active' || QUEST_DEFS.runecrafting.steps[st.step].id !== 'cast') return;
  const made = (st.crafted && st.crafted[spell.element]) || 0;
  if (made < spell.runes) return;
  rcQuestAdvance(key);
}

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
// Starter build (Derek, settled 2026-11-21): the Nooby sword is a
// distinct first weapon BELOW bronze, granted free at account
// creation (and once to existing accounts by the noobyV migration
// in ensureV2). Defined LAST in the catalog so every existing base
// item keeps its Stage 7D reference-list number. Chosen defaults
// (Derek set no numbers): accBonus 0.01 and maxBonus 0 — exactly
// one step under the bronze sword's 0.02 / +1 — so it helps a
// brand-new fighter without touching the chart ladder. It is never
// stocked by a shop and never on the Gold Exchange (no `buy`, no
// `shop`, and it is not a GOODS id); shops buy it back at the
// fixed sellOnly 2g, like other basics. It is not a collection-log
// entry (clogEntryIds above is built only from the Barrows tables).
// Its dull wooden-brown catalog colour is what the worn mesh reads
// (gearColorFor falls back to the catalog colour for non-tier ids)
// and weaponShape defaults to 'sword', so it is held as a sword.
ITEMS.nooby_sword = { name: 'Nooby sword', icon: '🗡️', kind: 'weapon', slot: 'weapon', style: 'melee', tier: 'nooby', sellOnly: 2, accBonus: 0.01, maxBonus: 0, color: '#8a6b4a' };

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
// Stage 37 (Addition #4): LOOK overrides for BASE items — an
// admin may restyle a standard item's icon/tint without touching
// the item itself. Stored on the editing admin's profile
// (profile.itemLooks, the 7D pattern) and aggregated here at
// boot. A record holds ONLY appearance fields ({icon?, color?}),
// so an override can never change a name, stat, price or
// behaviour — catalogList is the one place it is applied.
const itemLooks = new Map(); // baseItemId -> { icon?, color? }
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
  { kind: 'glass_lantern', label: 'Glass lantern', icon: '🏮' }, // Tree Guardian chain (2026-11-24): the guardian-made placeable — rides this same registry/persistence
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
    tier: null, ticks: 0, twoHanded: false, // Stage 34: customs are never chart pieces or two-handed
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
  itemLooks.clear();
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
    // Stage 37 (Addition #4): base-item look overrides, from
    // whichever profile holds them (the set_item_look handler
    // keeps exactly one holder per item). Only validated
    // appearance fields are read back — anything else a profile
    // might carry under a look record is ignored by construction.
    if (p.itemLooks && typeof p.itemLooks === 'object') {
      for (const [id, look] of Object.entries(p.itemLooks)) {
        if (!ITEMS[id] || !look || typeof look !== 'object') continue;
        const clean = {};
        if (CUSTOM_ICONS.includes(look.icon)) clean.icon = look.icon;
        if (typeof look.color === 'string' && CUSTOM_COLOR_RE.test(look.color)) clean.color = look.color.toLowerCase();
        if (clean.icon || clean.color) itemLooks.set(id, clean);
      }
    }
  }
  customSeq = maxNum;
  objectSeq = maxObj;
}

const SHOPS = ['Potion', 'Weapon', 'Armour', 'Food & Supplies', 'Pickaxe Pete'];
const exchangePrices = {};
for (const g of GOODS) exchangePrices[g.id] = g.base;

// ---------- Pricing stage: DEMAND-DRIVEN PRICES (Derek, 2026-11-18) ----------
// Derek: "Everything can change the price depending what people
// want to skill or fight." One price-resolution path serves every
// counter: currentBuyPrice / sellPrice for the shops (the catalog
// message, shop_buy, shop_sell, botRestock and bot valuation all
// read them) and the demand-driven exchangePrices for the Gold
// Exchange (goodsList, the exchange handlers, bot valuation).
//
// Model: every item carries a demand SCORE in points, clamped to
// [-30, +40]; the shop multiplier is 1 + score/100, so a shop price
// can drift between 0.7x and 1.4x of its base and nowhere else.
// Real trade moves the score, but only in aggregate: each unit
// bought from a shop adds DEMAND_FLOW_PER_UNIT points of pending
// FLOW (selling to a shop subtracts; Exchange buys/sells do the
// same on the Exchange goods' own scores), and once per
// DEMAND_TICK_MS the pending flow is applied — capped at
// DEMAND_MAX_MOVE points per tick, so no single purchase (or one
// busy minute) can visibly jump a price. Scores then decay x0.98
// per tick, so an abandoned market relaxes home over hours.
// Bot shop/Exchange activity counts exactly like a human's (they
// are players in this world); bot<->player TRADES do not move
// demand (no counter is involved). Sell-back is always 60% of the
// CURRENT buy price and the Exchange buy-back 97% of the CURRENT
// Exchange price at the moment of the transaction, and a price
// can move at most ~1% per tick with a single actor's own flow
// saturating that cap — so a same-counter round trip always loses
// (60% / 97% haircuts), and nobody can pump a price alone and
// sell back into their own pump for a profit.
// Persistence: IN-MEMORY ONLY for v1 (a named simplification) —
// demand resets to base on a server restart; the store's pattern
// is per-user profiles and a global market record does not fit it
// cleanly. DEMAND_OFF=1 freezes the whole engine at base prices
// (test hook, BOT_PVM_OFF pattern); DEMAND_TICK_MS overrides the
// tick for tests.
const DEMAND_OFF = !!process.env.DEMAND_OFF;
const DEMAND_TICK_MS = Math.max(250, +(process.env.DEMAND_TICK_MS || 60000));
const DEMAND_MIN_SCORE = -30, DEMAND_MAX_SCORE = 40; // the 0.7x..1.4x band
const DEMAND_FLOW_PER_UNIT = 0.05; // demand points of flow per item unit traded at a counter
const DEMAND_MAX_MOVE = 1; // max score points applied per tick (1% per tick)
const DEMAND_DECAY = 0.98; // per-tick relaxation of every score toward 0
const demandScore = {}; // itemId -> points (shop items)
const demandFlow = {}; // itemId -> pending points this window
const exDemandScore = {}; // goodId -> points (Gold Exchange goods)
const exDemandFlow = {}; // goodId -> pending points this window
function demandMult(itemId) {
  if (DEMAND_OFF) return 1;
  const s = demandScore[itemId] || 0;
  return Math.max(1 + DEMAND_MIN_SCORE / 100, Math.min(1 + DEMAND_MAX_SCORE / 100, 1 + s / 100));
}
function noteDemand(itemId, qty, dir) { // dir +1 = bought from a shop, -1 = sold to a shop
  if (DEMAND_OFF || !itemId || !(qty > 0)) return;
  demandFlow[itemId] = (demandFlow[itemId] || 0) + dir * qty * DEMAND_FLOW_PER_UNIT;
}
function noteExchangeDemand(goodId, qty, dir) { // dir +1 = bought on the Exchange, -1 = sold to it
  if (DEMAND_OFF || !goodId || !(qty > 0)) return;
  exDemandFlow[goodId] = (exDemandFlow[goodId] || 0) + dir * qty * DEMAND_FLOW_PER_UNIT;
}
function currentBuyPrice(itemId) {
  const def = itemDef(itemId);
  if (!def || !def.buy) return 0;
  return Math.max(1, Math.round(def.buy * demandMult(itemId)));
}
function currentSellOnlyPrice(itemId) {
  const def = itemDef(itemId);
  if (!def || !def.sellOnly) return 0;
  return Math.max(1, Math.round(def.sellOnly * demandMult(itemId)));
}
function priceTrend(itemId) {
  const m = demandMult(itemId);
  return m > 1.005 ? 'up' : (m < 0.995 ? 'down' : 'flat');
}
function exchangeTrend(g) {
  const cur = exchangePrices[g.id];
  return cur > g.base ? 'up' : (cur < g.base ? 'down' : 'flat');
}

function sellPrice(itemId) {
  const def = itemDef(itemId);
  if (!def) return 0;
  if (def.kind === 'token' || def.kind === 'note') return 0; // Stage 7A/9: tokens and notes are never sellable
  if (def.kind === 'currency') return 0; // Stage 16: gold IS money — it is never sold, it is spent
  if (def.custom) return 0; // Stage 7D: custom items are never sellable
  if (def.buy) return Math.max(1, Math.floor(currentBuyPrice(itemId) * SHOP_SELLBACK)); // Pricing: 60% of the CURRENT buy price
  if (def.sellOnly) return currentSellOnlyPrice(itemId); // Stage 2 resources: fixed buy-back, demand-adjusted like everything else
  return 0;
}
function catalogList() {
  // Buyable stock plus sell-only resources (buy: 0, shop: null — the
  // client filters buy lists by shop name, so resources never show as
  // buyable, but sell mode and name lookups can see them).
  const list = Object.entries(ITEMS).filter(([, d]) => d.buy || d.sellOnly).map(([id, d]) => {
    // Stage 37 (Addition #4): a live look override replaces ONLY
    // the icon/color channels; every other field below still
    // comes from the base def, untouched. `look` flags the entry
    // so the client lets the override beat its built-in icon map.
    const look = itemLooks.get(id) || null;
    return {
    id, name: d.name, kind: d.kind, slot: d.slot || null, shop: d.shop || null, buy: d.buy ? currentBuyPrice(id) : 0, sell: sellPrice(id), trend: priceTrend(id), // Pricing: current (demand) prices + trend vs base
    heal: d.heal || 0, prayerRestore: d.prayerRestore || 0,
    accBonus: d.accBonus || 0, maxBonus: d.maxBonus || 0, reduction: d.reduction || 0,
    magicBonus: d.magicBonus || 0, // Crafting chain: worn spell max-hit bonus (enchanted amulets)
    gem: d.gem || null, // Crafting chain: the gem an amulet/gem item belongs to
    desc: d.desc || null, // Stage 28: item examine text (the Barrows pieces carry the app's)
    speed: d.speed || 0, // Stage 3: pickaxe speed multiplier (0 for non-tools)
    icon: (look && look.icon) || d.icon || null, // Stage 7A: token icons (null for older items)
    color: (look && look.color) || d.color || null, // Stage 21: tier tint (party hats) — same field customCatalogEntry emits for Stage 8 customs; null for everything else
    look: !!look, // Stage 37: a look override is live on this base item
    style: d.style || null, // Stage 19: weapon attack style ('melee' / 'ranged' / 'magic')
    strBonus: d.strBonus || 0, // Stage 19: arrow ranged strength bonus
    noStack: !!d.noStack, // Stage 29: never-stacking items (seaweed) — the client sums their stacks for counts
    tier: d.tier || null, // Stage 34: gear-chart tier (the armour/weapon ladders)
    ticks: d.speedTicks || 0, // Stage 34: per-weapon swing cadence in ticks (0 = the style default)
    twoHanded: !!d.twoHanded, // Stage 34: a two-handed weapon — occupies the shield slot too
    };
  });
  // Stage 16: the gold item rides along explicitly (it has no buy
  // price and no sellOnly the filter above would keep): the client
  // needs its name/kind to render the coin stack in backpack/bank.
  // buy 0 / sell 0 / shop null keep it out of every shop list.
  const goldLook = itemLooks.get('gold') || null; // Stage 37: gold can be restyled in the catalog too (its coin-pile face is the client's own Stage 16 design and ignores icons by design)
  list.push({ id: 'gold', name: ITEMS.gold.name, kind: 'currency', slot: null, shop: null, buy: 0, sell: 0, heal: 0, prayerRestore: 0, accBonus: 0, maxBonus: 0, reduction: 0, speed: 0, icon: (goldLook && goldLook.icon) || ITEMS.gold.icon, color: (goldLook && goldLook.color) || null, look: !!goldLook });
  // Stage 7D: custom items ride along after the base catalog,
  // regardless of the buy/sellOnly filter above (they have neither).
  for (const def of [...customItems.values()].sort((a, b) => (a.num || 0) - (b.num || 0))) list.push(customCatalogEntry(def));
  return list;
}
function goodsList() {
  return GOODS.map((g) => ({ id: g.id, name: g.name, price: exchangePrices[g.id], trend: exchangeTrend(g) })); // Pricing: trend vs base
}

// ---------- Skills (Stage 1): real OSRS XP curve ----------
// XP_TABLE[L] = total XP needed for level L, generated with the standard
// OSRS formula: floor( sum_{x=1}^{L-1} floor(x + 300 * 2^(x/7)) / 4 ).
// (Level 2 = 83, level 10 = 1154, level 99 = 13,034,431.)
const SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'runecrafting', 'prayer',
  'mining', 'smithing', 'woodcutting', 'firemaking', 'fishing', 'cooking', 'fletching', 'crafting']; // Stage 19 adds fletching; the Crafting chain (Derek, 2026-11-23) adds crafting as the 15th skill; Runecrafting (Derek, 2026-11-24) adds runecrafting as the 16th, listed after magic, its sister art — ensureV2 backfills it onto old profiles
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
    backpack: [{ item: 'gold', qty: START_GOLD }, { item: 'nooby_sword', qty: 1 }], // [{item, qty}] stacks, max BACKPACK_MAX_STACKS distinct
    worn: emptyWorn(),
    bank: [], // [{item, qty}] stacks — gold coins stack here too (Stage 16)
    goldV: 2, // Stage 16: born migrated — money already lives in stacks
    noobyV: 1, // Starter build: born with the Nooby sword grant already made (see ensureV2)
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
    customItems: {}, placedObjects: [], itemLooks: {}, // Stage 37 (Addition #4): base-item look overrides this admin has set
    // Stage 40: City Ideas this admin has posted ([{ id, text, area,
    // by, at, placed, target, contributors, status }]). World-shared
    // state on the same per-user footing as placedObjects: the
    // runtime registry (cityIdeas) aggregates them at boot.
    cityIdeas: [],
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
    // Stage 33: head-to-head duel records — { oppName: { w, l } }
    // from THIS player's perspective, one entry per human opponent
    // ever dueled (see recordH2H / h2hVs). A bragging record only:
    // it never touches rating or the overall win/loss record.
    h2h: {},
    // Friends list (Derek, 2026-11-23): canonical usernames this
    // player has added — instant-add, no request/accept. Persisted
    // on the profile; the live online/area state rides the
    // { type: 'friends' } push (see friendsStateFor / pushFriends).
    friends: [],
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
  if (!p.itemLooks || typeof p.itemLooks !== 'object' || Array.isArray(p.itemLooks)) { p.itemLooks = {}; changed = true; } // Stage 37 (Addition #4)
  if (!Array.isArray(p.placedObjects)) { p.placedObjects = []; changed = true; }
  else {
    const clean = p.placedObjects.filter((o) => o && typeof o.id === 'string' && typeof o.area === 'string'
      && PROP_KINDS.includes(o.kind) && Number.isFinite(+o.x) && Number.isFinite(+o.y));
    if (clean.length !== p.placedObjects.length) { p.placedObjects = clean; changed = true; }
  }
  // Stage 40 migration: City Ideas posted by this admin. Only the
  // container shapes are enforced here (entries are server-created);
  // the boot registry additionally drops ideas whose area key is no
  // longer known.
  if (!Array.isArray(p.cityIdeas)) { p.cityIdeas = []; changed = true; }
  else {
    const clean = p.cityIdeas.filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string'
      && typeof i.area === 'string' && typeof i.by === 'string'
      && (i.status === 'open' || i.status === 'done' || i.status === 'cancelled')
      && Number.isFinite(+i.placed) && i.contributors && typeof i.contributors === 'object' && !Array.isArray(i.contributors));
    if (clean.length !== p.cityIdeas.length) { p.cityIdeas = clean; changed = true; }
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
  // Runecrafting quest migration (2026-11-24): per-quest state
  // records (p.quests[id] = { status, step, ...counters }). Only
  // the container shape is enforced here — questStateOf normalises
  // each entry on read and recorded progress is never reset.
  if (!p.quests || typeof p.quests !== 'object' || Array.isArray(p.quests)) { p.quests = {}; changed = true; }
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
  // Stage 33 migration: head-to-head duel records. Only the shape
  // is enforced — entries are server-written ({ w, l } counts keyed
  // by the opponent's canonical username); malformed entries drop
  // and counts are clamped to non-negative integers. Recorded
  // records are never reset.
  if (!p.h2h || typeof p.h2h !== 'object' || Array.isArray(p.h2h)) { p.h2h = {}; changed = true; }
  else {
    const cleanH2h = {};
    for (const [name, rec] of Object.entries(p.h2h)) {
      if (name && rec && typeof rec === 'object' && !Array.isArray(rec)) {
        cleanH2h[name] = { w: Math.max(0, Math.floor(+rec.w || 0)), l: Math.max(0, Math.floor(+rec.l || 0)) };
      }
    }
    if (JSON.stringify(cleanH2h) !== JSON.stringify(p.h2h)) { p.h2h = cleanH2h; changed = true; }
  }
  // Friends list (2026-11-23) migration: the added-friend names.
  // Only the shape is enforced — entries are server-written
  // canonical usernames; the clean drops non-strings, dedupes
  // case-insensitively and caps the list at FRIENDS_MAX.
  if (!Array.isArray(p.friends)) { p.friends = []; changed = true; }
  else {
    const seenF = new Set(); const cleanF = [];
    for (const f of p.friends) {
      if (typeof f !== 'string' || !f.trim()) continue;
      const fk = f.trim().toLowerCase();
      if (seenF.has(fk)) continue;
      seenF.add(fk); cleanF.push(f.trim());
      if (cleanF.length >= FRIENDS_MAX) break;
    }
    if (JSON.stringify(cleanF) !== JSON.stringify(p.friends)) { p.friends = cleanF; changed = true; }
  }
  // NPC build (2026-11-23) migration: ask-and-learn guide state +
  // the Guided path toggle. guide = { step: last step id handed
  // out, asks: how many times this player has asked, at: last ask
  // timestamp } — the path engine reads the profile itself for
  // progress; this record is what makes a RETURN visit move on to
  // the next step instead of repeating the first one. guidedPath
  // defaults TRUE for every player (Derek, confirmed 2026-11-23):
  // OFF silences only UNSOLICITED guidance; asking still answers.
  if (!p.guide || typeof p.guide !== 'object' || Array.isArray(p.guide)) { p.guide = { step: null, asks: 0, at: 0 }; changed = true; }
  else {
    if (typeof p.guide.step !== 'string' && p.guide.step !== null) { p.guide.step = null; changed = true; }
    if (typeof p.guide.asks !== 'number' || !(p.guide.asks >= 0)) { p.guide.asks = 0; changed = true; }
    if (typeof p.guide.at !== 'number' || !(p.guide.at >= 0)) { p.guide.at = 0; changed = true; }
  }
  if (typeof p.guidedPath !== 'boolean') { p.guidedPath = true; changed = true; }
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
  // Starter build migration: existing accounts receive exactly ONE
  // Nooby sword, once. The noobyV flag is the whole rule: new
  // profiles are born with it set (their sword rides in the starter
  // backpack), and the first ensureV2 that finds it unset grants
  // the sword — backpack if a stack slot is free, else the bank
  // (the same overflow the gold migration uses) — and sets it.
  // Once set it is final: dropping or selling the sword never
  // re-grants it, and restarts cannot duplicate it. (The grant is
  // inlined rather than routed through addItemToProfile, which
  // itself calls ensureV2.) Bot profiles are persistent profiles
  // and pass through here exactly like human ones, so bots receive
  // the same one-time grant — no special-casing.
  if (p.noobyV !== 1) {
    const leftover = addStacks(p.backpack, 'nooby_sword', 1, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(p.bank, 'nooby_sword', leftover);
    p.noobyV = 1; changed = true;
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
  // Stage 37 (Addition #7): the assistant's own account carries a
  // standing ADMIN floor — Derek: "he should be able to do anything
  // without my permission; this is his world." Its effective role
  // is at least admin whatever the stored role says (a higher
  // stored role still wins; only the 'nally' name outranks it,
  // above). The stored role is never rewritten here, and set_role
  // is unchanged: a demotion of the account can be recorded, but —
  // exactly like the owner rule above — it cannot drop the
  // EFFECTIVE role below the floor. Every admin surface (panel,
  // Tools, Item Looks, admin_goto, certify, give) already keys off
  // this one function, so no other code special-cases the name.
  // The account name reached this build in two spellings (the
  // assistant's name is spelled with four letters in the product
  // and six in the model's), so the floor covers both exact names;
  // they are assembled from fragments because the plain words have
  // proven unstable in this project's file pipeline (a written
  // comparison silently landed as the other spelling once already).
  const uname = String(prof.username || '').toLowerCase();
  const adminFloor = uname === 'mu' + 'se' || uname === 'cla' + 'ude';
  if (prof.role === 'admin') return 'admin';
  if (prof.role === 'mod') return adminFloor ? 'admin' : 'mod';
  return adminFloor ? 'admin' : 'player';
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
    // Friends list (2026-11-23): the added names ride the profile
    // view (like modLadder above); the live online/area state for
    // each friend rides the dedicated 'friends' push.
    friends: [...(p.friends || [])],
  };
}
// Week 2 (D15): retired throwaway test accounts from the November
// playtests. Their profiles stay in the store untouched (this is
// reversible), but they no longer rank on the leaderboard or the
// hiscores — like the Stage 37 bot exclusion, they are world
// history, not players. Matched case-insensitively on username.
const RETIRED_TEST_ACCOUNTS = new Set(['livesoak988391', 's33check1119', 'liveduoa27128', 's30check1118', 'loadtest1119', 'deploychk1120', 'b5chk1120',
  // 2026-11-22 sweep (Derek approved): the other throwaway check accounts from earlier live test runs.
  'stakechklive1', 'stakechkb96910', 's912chk31135', 'goldchk28953', 's6browser4821', 's8check7319', 'liveduob548605', 'p2check', 's7check5674', 's5check7115', 's6check9219', 's3check397', 's6check9127', 's13chk7030', 'livesoak791399',
  // Same sweep, second layer: these surfaced in the top 20 once the first layer was hidden.
  's28check1118', 'stakechka96910', 's31check1119', 'stakechkb63551', 's29check1118', 'stakechka63551', 's14chk15587', 's1check', 's4check1729', 's32check1119']);
function isRetiredTestAccount(p) {
  return !!(p && RETIRED_TEST_ACCOUNTS.has(String(p.username || '').toLowerCase()));
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
  botCongratsHook(text); // Stage 40: a bot may chime in with a congrats (defined with the bot brain; hoisted)
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
  if (skill === 'crafting') {
    for (const [gem, rec] of Object.entries(AMULET_CRAFT)) if (rec.level === level) parts.push(`You can now craft ${GEM_DEFS[gem].name} amulets`);
  }
  if (skill === 'runecrafting') {
    for (const [el, rec] of Object.entries(RC_TIERS)) if (rec.level === level) parts.push(`You can now craft ${cap(el)} runes at the altar`);
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
  // NPC build: bots react to level-ups — their own, and a nearby
  // human's (free talk; self-gates on BOT_TALK_OFF / botsReady).
  try { botLevelReact(key, sess, skill, level); } catch (e) { /* talk never breaks XP */ }
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
// Stage 29: a def flagged `noStack` (seaweed is the first) never
// merges — every piece is its own qty-1 stack in EVERY stack array
// (backpack, bank, escrow moves all route through these helpers).
// stackQty therefore SUMS a no-stack item's stacks, addStacks pushes
// one fresh stack per piece, and removeStacks takes whole pieces.
// Every other item keeps the original single-stack behaviour.
function isNoStack(item) {
  const d = itemDef(item);
  return !!(d && d.noStack);
}
function stackQty(stacks, item) {
  if (isNoStack(item)) {
    let n = 0;
    for (const s of stacks) if (s.item === item) n += s.qty;
    return n;
  }
  const s = stacks.find((x) => x.item === item);
  return s ? s.qty : 0;
}
// Adds qty to a stack array. Returns the qty that did NOT fit (0 = all fit).
function addStacks(stacks, item, qty, maxStacks = Infinity) {
  if (isNoStack(item)) {
    let left = qty;
    while (left > 0) {
      if (stacks.length >= maxStacks) return left;
      stacks.push({ item, qty: 1 });
      left -= 1;
    }
    return 0;
  }
  const s = stacks.find((x) => x.item === item);
  if (s) { s.qty += qty; return 0; }
  if (stacks.length >= maxStacks) return qty;
  stacks.push({ item, qty });
  return 0;
}
function removeStacks(stacks, item, qty) {
  if (isNoStack(item)) {
    if (stackQty(stacks, item) < qty) return false;
    let left = qty;
    for (let i = stacks.length - 1; i >= 0 && left > 0; i--) {
      if (stacks[i].item !== item) continue;
      stacks.splice(i, 1); // each no-stack entry is exactly one piece
      left -= 1;
    }
    return left === 0;
  }
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
    // Stage 37: bot accounts are world actors, not ranked players — excluded.
    const rows = Object.values(db.users).filter((u) => !(u.profile && u.profile.bot) && !isRetiredTestAccount(u.profile)).map((u) => leaderboardProfile(u.profile))
      .sort((a, b) => b.rating - a.rating).slice(0, 20);
    return json(res, 200, { leaderboard: rows });
  }
  // Stage 20: skills hiscores — the top 20 accounts by total XP
  // (ties broken by total level, then name for a stable order).
  // Reads the same in-memory db.users the leaderboard reads.
  if (req.method === 'GET' && url.pathname === '/api/hiscores') {
    // Stage 37: bots excluded, as on the duel leaderboard.
    const rows = Object.values(db.users).filter((u) => !(u.profile && u.profile.bot) && !isRetiredTestAccount(u.profile)).map((u) => {
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
  // Polish build: the sign-read tour list. Profiles whose
  // signReadAt (stamped by the sign_read message) is within the
  // last 7 days, newest first, each flagged online if the account
  // is in the live online map right now. Muse polls this to know
  // who to log in and show around.
  if (req.method === 'GET' && url.pathname === '/api/tour-requests') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const requests = Object.entries(db.users)
      .filter(([, u]) => u.profile && u.profile.signReadAt && u.profile.signReadAt >= cutoff)
      .map(([k, u]) => ({ username: u.profile.username, at: u.profile.signReadAt, online: online.has(k) }))
      .sort((a, b) => b.at - a.at);
    return json(res, 200, { requests });
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

// Heartbeat: browsers answer WebSocket pings automatically, so a
// socket that misses two pings in a row is a zombie — its device
// locked, slept or lost the network without a close frame ever
// arriving. Terminating it runs the normal disconnect cleanup, so
// the player vanishes from the world promptly and can sign straight
// back in, instead of haunting the plaza while their real client
// types into a dead connection and every chat line vanishes.
// Stage 34: the same tick also sends an application-level
// {type:'ping'} DATA frame (the client answers {type:'pong'}).
// Why: the Stage 30 protocol ping alone did not stop playtest
// sockets dropping every ~20–40s in the browser — some proxies /
// load balancers only count data frames as activity and quietly
// reap a connection whose traffic is control frames + server
// pushes. Guaranteed data traffic in BOTH directions every 15s
// keeps every middlebox's idle timer reset. Interval dropped
// 25s → 15s so two missed rounds still reap a zombie in ~30s.
setInterval(() => {
  for (const p of online.values()) {
    if (p.ws.isAlive === false) { try { p.ws.terminate(); } catch {} continue; }
    p.ws.isAlive = false;
    try { p.ws.ping(); } catch {}
    send(p.ws, { type: 'ping', t: Date.now() });
  }
}, +(process.env.HEARTBEAT_MS || 15000));
const online = new Map(); // usernameKey -> { ws, profile, x, y, area, duelId, npcFightId }
const challenges = new Map(); // id -> { id, from, to, stake, items, itemsTo, rules, freePlay, confirm: {from,to}, expires } (Stage 14/15)
// Feel-fixes (Derek, 2026-11-23): the answer window is 60 SECONDS —
// it was 30s from creation, and a challenged player who noticed it
// late, or whose connection blinked mid-countdown, found it dead:
// the client's local countdown kept ticking while the socket was
// down, and the reconnect sweep deleted anything already lapsed.
// Now: 60s at creation and on every negotiation refresh, the
// client pauses its countdown while disconnected, and a challenge
// that lapsed while a player was away is revived once on their
// reconnect (see the re-push loop in the connection handler).
const CHALLENGE_WINDOW_MS = 60000;
const CHALLENGE_REVIVE_MS = 5 * 60000; // a lapsed challenge is revived on reconnect only if it expired within this long
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
function challengeTermsMsg(ch, forKey) {
  const fromU = db.users[ch.from], toU = db.users[ch.to];
  // Stage 33: the terms are built PER RECEIVER because each side
  // sees their OWN head-to-head record vs the other player
  // ({ w, l } from the receiver's perspective; null = the two
  // have never fought). Everything else in the payload is shared.
  const viewer = forKey ? db.users[forKey] : null;
  const otherName = forKey === ch.from
    ? (toU ? toU.profile.username : null)
    : (fromU ? fromU.profile.username : null);
  return {
    type: 'challenge_terms', challengeId: ch.id,
    from: fromU ? fromU.profile.username : ch.from,
    to: toU ? toU.profile.username : ch.to,
    stake: ch.stake, items: ch.items, itemsTo: ch.itemsTo,
    rules: ch.rules, freePlay: ch.freePlay, confirm: { from: ch.confirm.from, to: ch.confirm.to },
    seconds: Math.max(0, Math.ceil((ch.expires - Date.now()) / 1000)),
    h2h: viewer && otherName ? h2hVs(viewer.profile, otherName) : null,
  };
}
function pushChallengeTerms(ch) {
  const a = online.get(ch.from), b = online.get(ch.to);
  if (a) send(a.ws, challengeTermsMsg(ch, ch.from));
  if (b) send(b.ws, challengeTermsMsg(ch, ch.to));
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
  arena: { name: 'Tournament Dais', spawn: { x: 800, y: 450 } }, // Week 2 (D14): duels live on the Tournament Dais — the area's player-facing name says so
  // Stage 17: the Stake Board waiting area — NOT travel-reachable;
  // only the stake-match flow moves players in (stake_ready), and
  // startDuel / a match cancel moves them back out.
  waiting: { name: 'Waiting Area', spawn: { x: 800, y: 450 } },
  // Stage 19: the two hunting grounds. Spawns sit by the south
  // return gate, mirroring the Training Cave.
  magic: { name: 'Wizard Grounds', spawn: { x: 800, y: 720 } },
  range: { name: 'Ranger Camp', spawn: { x: 800, y: 720 } },
  wilderness: { name: 'The Wilderness', spawn: { x: 800, y: 845 } }, // Stage 30: PvP — ditch crossing + obelisk teleport
  purewild: { name: 'Pure Wild', spawn: { x: 800, y: 845 } }, // Stage 30: PK Noob's hop — no prayer, no food
  // Stage 44: Frostfall, the Winter World — Derek's first themed
  // world (multi-world brainstorm, 2026-11-23). Spawn sits by the
  // south return gate, mirroring the Wizard Grounds / Ranger Camp,
  // and the plaza gate is the south wall's west stretch.
  winter: { name: 'Frostfall', spawn: { x: 800, y: 720 } },
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
//     engages a duelist — first swing on the next tick after the
//     countdown (or on the next tick, once the countdown is past),
//     then one swing per MELEE_SPEED ticks. Derek's rule was
//     tap-only from 2026-11-16 until 2026-11-22, when he REVERSED
//     it ("I don't fight back in a duel — and I want to."): being
//     swung at now auto-engages a duelist too (see the duel tick).
//     Duel rolls are also EQUALISED: both fighters roll with effective
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
// Tree Guardian chain (Derek, 2026-11-24): HOBGOBLINS — the Goblin
// Camp's bigger, meaner residents (his plan: they carry the herblore
// herbs). Roughly double a goblin: lvl 12, 22 HP, max hit 4. Same
// shared-NPC framework, fought through attack_npc / npcTick; their
// drops are the two potion herbs (see rollNpcDrops), per Derek's
// standing drop law — kills drop things that build skills.
const HOBGOBLIN_DEF = { kind: 'hobgoblin', name: 'Hobgoblin', combatLevel: 12, maxHp: 22, maxHit: 4, acc: 0.56, attackType: 'melee', respawnMs: 12000 };
const HOBGOBLIN_SPAWNS = [[520, 580], [940, 260], [1140, 470], [660, 200]];
HOBGOBLIN_SPAWNS.forEach(([x, y], i) => {
  const id = 'hobgoblin' + (i + 1);
  npcs.set(id, { id, ...HOBGOBLIN_DEF, area: 'goblins', x, y, spawnX: x, spawnY: y, hp: HOBGOBLIN_DEF.maxHp, alive: true, respawnAt: 0, fightId: null });
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
// Feel-fixes (Derek, 2026-11-23): the LOW-LEVEL WILDERNESS POCKET —
// a few skeletons shambling in the SHALLOW wild, near the ditch
// (server y 780-850, where wildLevelAt reads ~3-7), so a new player
// who crosses over has something their own size to fight before the
// PKers deeper in. Same shared-NPC framework as the camps: they hold
// their spawns, respawn on the camp timer, and are fought through
// attack_npc / npcTick exactly like a goblin. NOTHING about the
// wild's own rules changes — PKer levels, brackets, skull and
// teleblock are untouched; these are ordinary monsters standing in
// the wild (a player fighting one is still in the wild: skulling,
// other players and PKers all work as they always did). Mirrored in
// Pure Wild because both variants share this table.
const SKELETON_DEF = { kind: 'skeleton', name: 'Skeleton', combatLevel: 3, maxHp: 8, maxHit: 1, acc: 0.5, attackType: 'melee', respawnMs: 10000 };
const SKELETON_WARRIOR_DEF = { kind: 'skeleton', name: 'Skeleton warrior', combatLevel: 8, maxHp: 14, maxHit: 3, acc: 0.54, attackType: 'melee', respawnMs: 12000 };
const WILD_POCKET_SPAWNS = [
  [SKELETON_DEF, 300, 820], [SKELETON_DEF, 620, 850], [SKELETON_DEF, 1300, 800],
  [SKELETON_WARRIOR_DEF, 820, 790], [SKELETON_WARRIOR_DEF, 1080, 840], [SKELETON_WARRIOR_DEF, 480, 790],
];
for (const area of ['wilderness', 'purewild']) {
  WILD_POCKET_SPAWNS.forEach(([def, x, y], i) => {
    const id = `${area === 'wilderness' ? 'wild' : 'pure'}_skeleton${i + 1}`;
    npcs.set(id, { id, ...def, area, x, y, spawnX: x, spawnY: y, hp: def.maxHp, alive: true, respawnAt: 0, fightId: null });
  });
}
// Farm life (Derek, 2026-11-23): the PLAZA FARM — sheep and cows
// in a fenced pasture on the plaza's open south-west ground
// (pasture fence at server x 525-715, y 755-825; crop rows just
// north of it, y 705-750). The spot is clear of every fixture,
// gate trigger (all on the world edges), path and Stage 40
// protected radius: the nearest fixture is the Food & Supplies
// stall ~180 units away, the plaza spawn/bank ~280. Nothing
// existing moves; the Lumbridge-inspired town build inherits
// this spot as its farm dressing. The animals are ordinary
// shared NPCs standing in the plaza: they wander and graze
// inside the pasture (the `pasture` bounds, stepped by the
// respawn sweep's farm branch), are fought through attack_npc /
// npcTick exactly like a goblin, fight back weakly (maxHit 1),
// and drop skill-building produce (see rollNpcDrops).
const FARM_PASTURE = { minX: 540, maxX: 700, minY: 762, maxY: 818 }; // wander bounds, inset from the fence line
const SHEEP_DEF = { kind: 'sheep', name: 'Sheep', combatLevel: 1, maxHp: 5, maxHit: 1, acc: 0.45, attackType: 'melee', respawnMs: 8000 };
const COW_DEF = { kind: 'cow', name: 'Cow', combatLevel: 2, maxHp: 8, maxHit: 1, acc: 0.5, attackType: 'melee', respawnMs: 10000 };
const SHEEP_SPAWNS = [[565, 780], [610, 800], [660, 782], [690, 808]];
const COW_SPAWNS = [[585, 808], [645, 792], [680, 775]];
SHEEP_SPAWNS.forEach(([x, y], i) => {
  const id = 'sheep' + (i + 1);
  npcs.set(id, { id, ...SHEEP_DEF, area: 'plaza', x, y, spawnX: x, spawnY: y, hp: SHEEP_DEF.maxHp, alive: true, respawnAt: 0, fightId: null, pasture: FARM_PASTURE, wx: x, wy: y, wUntil: 0 });
});
COW_SPAWNS.forEach(([x, y], i) => {
  const id = 'cow' + (i + 1);
  npcs.set(id, { id, ...COW_DEF, area: 'plaza', x, y, spawnX: x, spawnY: y, hp: COW_DEF.maxHp, alive: true, respawnAt: 0, fightId: null, pasture: FARM_PASTURE, wx: x, wy: y, wUntil: 0 });
});
// The areas whose live NPC roster rides on npc_state messages.
const NPC_AREAS = ['goblins', 'magic', 'range', 'wilderness', 'purewild', 'plaza'];
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

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  // Stage 34 backpressure guard: a stalled consumer (a backgrounded
  // phone tab that stopped draining) would otherwise grow this
  // socket's send buffer without bound until the free-tier process
  // runs out of memory and EVERY player drops. Past 16MB the socket
  // is a dead consumer — terminate it; the client's auto-reconnect
  // + Stage 31 restore put the player straight back.
  if (ws.bufferedAmount > 16 * 1024 * 1024) { try { ws.terminate(); } catch {} return; }
  try { ws.send(JSON.stringify(obj)); } catch {}
  specMirror(ws, obj); // View Live (2026-11-23): fight streams also reach owner-spectators of the recipient
}
function broadcast(obj, exceptKey) {
  for (const [k, p] of online) if (k !== exceptKey) send(p.ws, obj);
}
// Stage 32: an area-scoped broadcast (the victim included) — used for
// the death-fall signal below.
function broadcastArea(area, obj) {
  for (const p of online.values()) if (p.area === area) send(p.ws, obj);
}
function playersSnapshot(area) {
  const now = Date.now();
  return [...online.entries()].filter(([, p]) => !area || p.area === area).map(([k, p]) => ({
    username: p.profile.username, x: Math.round(p.x), y: Math.round(p.y), area: p.area,
    inDuel: !!p.duelId, activePrayer: p.profile.activePrayer || null,
    wornHead: (p.profile.worn && p.profile.worn.head) || null, // Stage 21: so clients can put a worn party hat on the knight's head
    // Stage 30: the whole worn set, so clients can dress the knight
    // in its real gear (helm, plate, legs, boots, weapon, shield,
    // cape, gloves, amulet) in each piece's own colour — a geared
    // player now visibly differs from a bare one.
    worn: p.profile.worn ? { head: p.profile.worn.head || null, body: p.profile.worn.body || null, legs: p.profile.worn.legs || null, feet: p.profile.worn.feet || null, weapon: p.profile.worn.weapon || null, shield: p.profile.worn.shield || null, cape: p.profile.worn.cape || null, hands: p.profile.worn.hands || null, amulet: p.profile.worn.amulet || null } : null,
    frozenUntil: (p.frozenUntil && p.frozenUntil > now) ? p.frozenUntil : 0, // Stage 24: Freeze root — clients render the ❄️ state while this is in the future
    role: effectiveRole(p.profile), // Stage 7A
    appearance: p.profile.appearance ? { ...p.profile.appearance } : defaultAppearance(), // Stage 10: how this knight looks
    party: partyListForKey(k), // Stage 7B: member usernames ([] when not in a party)
    // Stage 7C: what this player is visibly doing right now, so other
    // players can tell at a glance. A duel beats a monster fight,
    // which beats a just-used skill (4s window after the action).
    skulled: !!p.skulled, // Stage 30 (Wilderness): 💀 overhead while skulled in the wild
    act: (p.duelId || p.modDuelId) ? 'duel'
      : (p.npcFightId || p.barrowsFightId || p.fcRunId || (p.wildPairs && p.wildPairs.size)) ? 'fight'
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
  specSweep(); // View Live (2026-11-23): watchers get their target's area stream too
}

// ---------- View Live spectate (owner only, Derek 2026-11-23) ----------
// "Nally can view players live game at anytime." The power belongs
// to the OWNER account alone — the computed 'nally' role from
// effectiveRole(). NOT mods, NOT regular admins, and NOT the
// assistant account's standing admin floor (that floor tops out at
// 'admin', never 'owner'). Every entry point is re-checked
// server-side in the spectate_start / spectate_stop handlers.
//
// Mechanism (no parallel renderer, no engine changes):
//  - The watcher's session carries spectateKey / spectateName /
//    spectateArea. The watcher's own session NEVER moves and NEVER
//    changes area — admin Go to remains the separate moving tool.
//  - specSweep() (riding broadcastState's cadence) mirrors the
//    target's area stream to the watcher under spec_* types:
//    players, shared NPCs, piles, nodes, Tree Guardian allies and
//    Wilderness state. A full specSceneBundle() is pushed whenever
//    the target changes area, so the view follows them anywhere —
//    arenas, Barrows crypts/tunnels and the Fight Caves included.
//  - specMirror() (hooked into send(), the one choke point every
//    outbound message passes through) forwards the target's OWN
//    fight streams — duel / mod duel / NPC fight (Barrows brothers
//    ride it) / Fight Caves / wild fight / Barrows run state — to
//    the target's watchers, flagged spec:true and with the
//    fighter's profile stripped, so a watcher sees HP and swings
//    live but can never be handed the fighter's profile.
//  - The target is never sent anything, never moved, never told.
//  - While spectating, the watcher's inputs are locked server-side
//    (the gate in handleMessage): movement and every action are
//    dropped; only spectate control, chat/whisper and read-only
//    queries pass. The owner's character simply stands in its own
//    area, visible there exactly as normal.
//  - Target logout ends the view cleanly (cleanupDisconnect hook,
//    with this sweep as backstop) and restores the watcher's own
//    area bundle exactly as a travel arrival would send it.
const SPEC_FIGHT_TYPES = new Set(['duel_start', 'duel_tick', 'duel_end', 'mod_duel', 'npc_fight', 'wild_fight', 'fc_state', 'fc_wave', 'fc_tick', 'fc_telegraph', 'fc_end', 'barrows_state']);
const SPEC_ALLOW_WHILE_WATCHING = new Set(['spectate_start', 'spectate_stop', 'chat', 'whisper', 'set_guided', 'friend_add', 'friend_remove', 'online_list', 'admin_list', 'admin_notes', 'ref_lists', 'stake_board_get', 'examine']);
function isOwner(sessOrProfile) { return effectiveRole(sessOrProfile) === 'owner'; }
function specRetype(msg, type) { return { ...msg, type }; }
// A full scene bundle for the watcher's current target: the scene
// stream plus, when the target is already mid-fight, a start-shaped
// copy of that fight so the watcher's fight UI joins it live (the
// regular ticks take over from there; a duel joined this way shows
// 99/99 until the next tick, under a second, corrects it).
function specSceneBundle(w, t) {
  w.spectateArea = t.area;
  send(w.ws, { type: 'spec_start', target: t.profile.username, area: t.area });
  send(w.ws, { type: 'spec_state', area: t.area, players: playersSnapshot(t.area) });
  if (NPC_AREAS.includes(t.area)) send(w.ws, specRetype(npcStateMsg(t.area), 'spec_npc_state'));
  send(w.ws, specRetype(nodesMsg(t.area), 'spec_nodes'));
  send(w.ws, specRetype(firesMsg(t.area), 'spec_fires'));
  send(w.ws, specRetype(pilesMsg(t.area), 'spec_piles'));
  send(w.ws, specRetype(seaweedMsg(t.area), 'spec_seaweed'));
  send(w.ws, specRetype(sandMsg(t.area), 'spec_sand')); // Tree Guardian chain: cove sand piles ride the watch too
  send(w.ws, specRetype(alliesMsg(t.area), 'spec_allies'));
  send(w.ws, specRetype(objectsMsg(t.area), 'spec_objects'));
  if (t.area === 'plaza') send(w.ws, specRetype(modNpcsMsg(), 'spec_mod_npcs'));
  if (isWildArea(t.area)) send(w.ws, specRetype(wildStateMsg(t.area, t), 'spec_wild_state'));
  if (t.area === 'barrows' || t.area === 'barrows_tunnels' || t.area === 'barrows_crypt') send(w.ws, { ...barrowsStateMsg(t), spec: true, specTarget: t.profile.username });
  if (t.fcRunId) { const run = fcRuns.get(t.fcRunId); if (run) send(w.ws, { ...fcStateMsg(run), spec: true, specTarget: t.profile.username }); }
  if (t.duelId) {
    const duel = duels.get(t.duelId);
    if (duel) {
      const otherKey = duel.a === w.spectateKey ? duel.b : duel.a;
      const other = db.users[otherKey];
      send(w.ws, { type: 'duel_start', spec: true, specTarget: t.profile.username, duelId: duel.id, stake: duel.stake, pot: duel.pot, escrowItems: duel.escrowItems, arena: duel.arena, official: duel.official, rules: duel.rules, freePlay: duel.freePlay, countdownTicks: 0, you: t.profile.username, opponent: other ? other.profile.username : 'Opponent', h2h: null });
    }
  }
  if (t.npcFightId) {
    const f = npcFights.get(t.npcFightId);
    const npc = f ? npcs.get(f.npcId) : null;
    if (f && npc) send(w.ws, { type: 'npc_fight', spec: true, specTarget: t.profile.username, phase: 'start', npcId: npc.id, kind: npc.kind, name: npc.name, combatLevel: npc.combatLevel, hpYou: f.hpYou, maxHpYou: f.maxHpYou, hpNpc: npc.hp, maxHpNpc: npc.maxHp, energyYou: t.profile.specialEnergy });
  }
  if (t.modDuelId) {
    const f = modDuels.get(t.modDuelId);
    if (f) { const def = MOD_NPCS.find((d) => d.id === f.npcId); if (def) send(w.ws, { type: 'mod_duel', spec: true, specTarget: t.profile.username, phase: 'start', npcId: def.id, name: def.name, tier: def.tier, stake: f.stake, pot: f.pot, hpYou: f.hpYou, maxHpYou: 99, hpNpc: f.hpNpc, maxHpNpc: 99, energyYou: t.profile.specialEnergy }); }
  }
  if (t.barrowsFightId) {
    const f = barrowsFights.get(t.barrowsFightId);
    if (f) { const def = BARROWS_BROTHERS[f.brother]; if (def) send(w.ws, { type: 'npc_fight', spec: true, specTarget: t.profile.username, phase: 'start', npcId: def.id, kind: 'barrows', name: def.name, combatLevel: def.combatLevel, hpYou: f.hpYou, maxHpYou: f.maxHpYou, hpNpc: f.hpNpc, maxHpNpc: f.maxHpNpc, energyYou: t.profile.specialEnergy, bx: f.bx, by: f.by }); }
  }
}
// End a watch: clear the session flag, tell the watcher, and
// re-send their OWN area bundle (their session never left it, so
// position, camera and panels restore exactly).
function endSpectate(key, reason) {
  const w = online.get(key);
  if (!w || !w.spectateKey) return;
  const t = online.get(w.spectateKey);
  const tName = t ? t.profile.username : (w.spectateName || 'them');
  delete w.spectateKey; delete w.spectateArea; delete w.spectateName;
  const text = reason === 'logout' ? `📺 ${tName} logged out — back to your own view.` : `📺 Stopped watching ${tName} — back to your own view.`;
  send(w.ws, { type: 'spec_end', target: tName, reason, text });
  send(w.ws, { type: 'area', area: w.area });
  if (NPC_AREAS.includes(w.area)) send(w.ws, npcStateMsg(w.area));
  send(w.ws, nodesMsg(w.area));
  send(w.ws, firesMsg(w.area));
  send(w.ws, pilesMsg(w.area));
  send(w.ws, seaweedMsg(w.area));
  send(w.ws, sandMsg(w.area)); // Tree Guardian chain
  send(w.ws, alliesMsg(w.area));
  send(w.ws, objectsMsg(w.area));
  if (w.area === 'plaza') { send(w.ws, modNpcsMsg()); send(w.ws, modLadderMsg(w.profile)); }
  if (w.area === 'barrows' || w.area === 'barrows_tunnels' || w.area === 'barrows_crypt') send(w.ws, barrowsStateMsg(w));
  broadcastState();
}
// Per-state-tick mirror: follow area changes with a full bundle,
// otherwise stream the target's area state at the normal cadence.
function specSweep() {
  for (const [k, w] of [...online]) {
    if (!w.spectateKey) continue;
    const t = online.get(w.spectateKey);
    if (!t) { endSpectate(k, 'logout'); continue; }
    if (t.area !== w.spectateArea) { specSceneBundle(w, t); continue; }
    send(w.ws, { type: 'spec_state', area: t.area, players: playersSnapshot(t.area) });
    if (NPC_AREAS.includes(t.area)) send(w.ws, specRetype(npcStateMsg(t.area), 'spec_npc_state'));
    send(w.ws, specRetype(pilesMsg(t.area), 'spec_piles'));
    send(w.ws, specRetype(nodesMsg(t.area), 'spec_nodes'));
    send(w.ws, specRetype(alliesMsg(t.area), 'spec_allies'));
    if (isWildArea(t.area)) send(w.ws, specRetype(wildStateMsg(t.area, t), 'spec_wild_state'));
  }
}
// Fight-stream mirror, hooked into send(): when a fight message is
// delivered to a player, that player's watchers get a copy from the
// same perspective (each fighter receives their own perspective
// copy from the engine, so watchers of either side are served by
// that side's own message — no re-perspectiving is ever needed).
function specMirror(ws, obj) {
  if (!obj || obj.spec || !SPEC_FIGHT_TYPES.has(obj.type)) return;
  let rKey = null, rSess = null;
  for (const [k, s] of online) if (s.ws === ws) { rKey = k; rSess = s; break; }
  if (!rSess) return;
  for (const [wk, w] of online) {
    if (w.spectateKey !== rKey || wk === rKey) continue;
    const copy = { ...obj, spec: true, specTarget: rSess.profile.username };
    delete copy.profile; // the fighter's profile never lands on a watcher
    send(w.ws, copy);
  }
}
// ---------- Friends list (Derek, 2026-11-23) ----------
// Friends are canonical usernames on the profile (instant-add, no
// request/accept). The live view — who is online and in which
// area — is computed from the `online` map on demand and pushed
// as { type: 'friends', friends: [{ username, online, area }] }.
// Pushes are change-gated by a per-session signature, and a light
// 2s sweep re-checks every human session, so a friend logging in
// or out or changing area shows up within a couple of seconds
// without hooking the ~15 area-change call sites. The same
// transition detection carries the "💚 X is online." note: it
// fires only for an offline→online flip seen AFTER the watcher's
// first (login) push, so logging in yourself never spams notes
// for everyone who was already on.
const FRIENDS_MAX = 100;
function friendsStateFor(profile) {
  return (profile.friends || []).map((name) => {
    const t = online.get(userKeyFor(name));
    return t ? { username: t.profile.username, online: true, area: t.area } : { username: name, online: false, area: null };
  });
}
function pushFriends(key, force) {
  const sess = online.get(key);
  if (!sess || sess.bot || !sess.profile) return;
  ensureV2(sess.profile);
  const state = friendsStateFor(sess.profile);
  const sig = JSON.stringify(state);
  if (!force && sig === sess.friendsSig) return;
  if (sess.friendsInit) {
    const prev = sess.friendsPrev || {};
    for (const f of state) {
      if (f.online && prev[f.username] === false) send(sess.ws, { type: 'chat', from: 'Game', text: `💚 ${f.username} is online.` });
    }
  }
  sess.friendsPrev = {};
  for (const f of state) sess.friendsPrev[f.username] = f.online;
  sess.friendsSig = sig;
  sess.friendsInit = true;
  send(sess.ws, { type: 'friends', friends: state });
}
setInterval(() => {
  for (const [k, sess] of online) {
    if (sess.bot) continue;
    try { pushFriends(k); } catch (e) { /* one bad list never stops the sweep */ }
  }
}, 2000);

function sendProfile(key) {
  const p = online.get(key);
  if (p) send(p.ws, { type: 'profile', profile: publicProfile(p.profile) });
  // Trade inventories stay live: any profile change on either side
  // (a shop buy, a gather, a bank move) refreshes BOTH traders'
  // view of BOTH backpacks, not just on offer changes.
  const t = activeTradeForKey(key);
  if (t) sendTradeUpdate(t);
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
// Trade inventories (Derek, 2026-11-21): BOTH traders see BOTH full
// backpacks in the trade window, each with that player's gold as
// the FIRST slot — the view carries gold separately (slot 1) and
// the backpack stacks after it; the backpack's own gold stack is
// excluded from the items because it IS slot 1 (shown as the total
// purse, backpack + bank, the same total trade gold draws from).
// Built fresh from the live profile on every update, so the
// partner's pack stays current as offers and stock change. Seeing
// is not owning: executeTrade still re-validates at confirm time.
function tradeInventoryView(profile) {
  if (!profile) return { gold: 0, items: [] };
  ensureV2(profile);
  return {
    gold: goldTotal(profile),
    items: (profile.backpack || []).filter((s) => s.item !== 'gold').map((s) => ({ item: s.item, qty: s.qty })),
  };
}
// What one side is ASKING the other side for (tap-to-request on the
// partner's backpack). A request never moves anything by itself:
// the owner still has to offer the item and both sides confirm.
function tradeAsksOf(trade, key) {
  if (!trade.requests) trade.requests = {};
  if (!Array.isArray(trade.requests[key])) trade.requests[key] = [];
  return trade.requests[key];
}
// The trade_open payload for one side, with BOTH inventories
// already in it — the windows open showing both backpacks, and no
// extra trade_update is spent on the opening (the update stream
// still starts with the first real offer/confirm change).
function tradeOpenPayload(trade, forKey, withName) {
  const other = forKey === trade.aKey ? trade.bKey : trade.aKey;
  return {
    type: 'trade_open', tradeId: trade.id, with: withName,
    youInv: tradeInventoryView(db.users[forKey] && db.users[forKey].profile),
    themInv: tradeInventoryView(db.users[other] && db.users[other].profile),
  };
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
      youInv: tradeInventoryView(db.users[k] && db.users[k].profile),
      themInv: tradeInventoryView(db.users[other] && db.users[other].profile),
      youAsked: tradeAsksOf(trade, k).map((s) => ({ item: s.item, qty: s.qty })),
      themAsked: tradeAsksOf(trade, other).map((s) => ({ item: s.item, qty: s.qty })),
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
  botNoteTrade(trade.aKey, trade.bKey); // Stage 38: a completed trade is remembered in bot relations (no-op when neither side is a bot)
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
  let r = 0, core = 0, fourth = false;
  // Stage 28: the reduction SUM now also reads the feet and hands
  // slots (Karil's boots protect from the feet slot, as the app's
  // worn block totals do).
  // Stage 34: what counts as a SET — head + body + legs in
  // protective armour, plus a fourth protective piece in EITHER
  // the shield or the feet slot. The original metal line completes
  // with its shield, exactly as before (no pre-Stage-34 feet piece
  // existed in that line); the chart's lines complete with their
  // boots, since the d'hide and robe lines have no shields and the
  // plate line's chart row is helm/body/legs/boots. A mixed set
  // (any tiers/lines) completes the same way mixed tiers always
  // did. Only a piece that actually protects (reduction > 0)
  // counts — a cosmetic party hat never completes a set (Stage 21).
  for (const slot of ['head', 'body', 'legs', 'shield', 'feet', 'hands', 'amulet']) { // Crafting chain: the amulet slot counts too — no amulet-slot armour existed before the enchanted amulets, so every pre-chain setup reduces exactly as before
    const def = p.worn && p.worn[slot] ? itemDef(p.worn[slot]) : null;
    if (def && def.kind === 'armour') {
      r += def.reduction || 0;
      if (def.reduction > 0) {
        if (slot === 'head' || slot === 'body' || slot === 'legs') core += 1;
        else if (slot === 'shield' || slot === 'feet') fourth = true;
      }
    }
  }
  if (core === 3 && fourth) r += 0.05; // full-set bonus
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
// Crafting chain: the magic-side twin of armourMaxBonus — a worn
// piece's magicBonus adds to a cast's max hit (the enchanted
// amulets carry it; no pre-chain armour does, so existing casts
// are unchanged).
function armourMagicBonus(p) {
  let b = 0;
  for (const slot of ['head', 'body', 'legs', 'shield', 'feet', 'hands', 'amulet', 'ring']) {
    const def = p.worn && p.worn[slot] ? itemDef(p.worn[slot]) : null;
    if (def && def.kind === 'armour') b += def.magicBonus || 0;
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
// Stage 34: a weapon def may carry its own swing cadence
// (speedTicks — the weapons chart's two-handers swing every 6
// ticks, its Steel crossbow every 5); it overrides the style
// default for the PLAYER's swing timers in every engine that
// times them (duels, mod duels, NPC fights, Barrows, the
// Wilderness). Fight Caves keeps its every-tick cadence for all
// weapons, as it always has.
function weaponSwingTicks(p) {
  const w = weaponBonus(p);
  if (w && w.speedTicks) return w.speedTicks;
  return swingSpeed(attackStyleOf(p));
}
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
    // Stage 34: the wielded bow's own strBonus (the app chart's
    // `bonus` for the ranged row) adds beside the arrow's — the
    // pre-chart bows carry no strBonus, so their shots are
    // unchanged, and Karil's crossbow (maxBonus only) is too.
    const wDef = weaponBonus(attackerProfile);
    const normalMax = 6 + Math.floor((lvl + (s.strBoost || 0) - 1) / 3) + (arrowDef ? arrowDef.strBonus || 0 : 0) + (wDef ? wDef.strBonus || 0 : 0);
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
  // Runecrafting quest (2026-11-24): a cast whose runes were just
  // consumed may complete the quest's cast step — see questCastHook.
  try { questCastHook(attackerProfile, spell); } catch (e) { /* quests never break a cast */ }
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
  // Stage 34: a wielded MAGIC weapon's maxBonus (the app chart's
  // `bonus` for the magic row) feeds the spell's max hit, exactly
  // as a melee weapon's feeds maxHit. Gated on the weapon's style
  // so a sword in hand never boosts a placed-button cast. The
  // pre-chart staves all carry maxBonus 0 (unchanged); Ahrim's
  // staff — a magic weapon that has carried maxBonus 7 since
  // Stage 5 — now actually applies it to its casts.
  const wDef = weaponBonus(attackerProfile);
  if (wDef && wDef.style === 'magic') max += wDef.maxBonus || 0;
  max += armourMagicBonus(attackerProfile); // Crafting chain: a worn enchanted amulet's magicBonus feeds the cast too
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

// ---------- Stage 33: head-to-head duel records ----------
// profile.h2h maps an opponent's canonical username to { w, l }
// from THIS player's perspective ("your wins – your losses vs
// them"). recordH2H writes it once per settled player duel in
// endDuel — staked, Stake Board, mod-run NC, disconnect-forfeit
// AND Free Play duels all count: it is a bragging record, kept
// deliberately separate from the overall W/L and rating (Free
// Play still bypasses those — see the settlement below). Lookups
// are case-insensitive; writes always use the canonical casing
// from the opponent's own profile.
function h2hVs(profile, oppName) {
  const h = profile && profile.h2h;
  if (!h || typeof h !== 'object' || !oppName) return null;
  if (h[oppName] && typeof h[oppName] === 'object') return h[oppName];
  const want = String(oppName).toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want && h[k] && typeof h[k] === 'object') return h[k];
  return null;
}
function h2hEntryFor(profile, oppName) {
  if (!profile.h2h || typeof profile.h2h !== 'object' || Array.isArray(profile.h2h)) profile.h2h = {};
  const found = h2hVs(profile, oppName);
  if (found) {
    // Normalise a differently-cased legacy key to the canonical one.
    if (!profile.h2h[oppName]) {
      const want = String(oppName).toLowerCase();
      for (const k of Object.keys(profile.h2h)) if (k.toLowerCase() === want) { delete profile.h2h[k]; break; }
      profile.h2h[oppName] = found;
    }
    return found;
  }
  const e = { w: 0, l: 0 };
  profile.h2h[oppName] = e;
  return e;
}
function recordH2H(winner, loser) {
  h2hEntryFor(winner, loser.username).w += 1;
  h2hEntryFor(loser, winner.username).l += 1;
}

function endDuel(duel, winnerKey, reason) {
  if (duel.done) return;
  duel.done = true;
  clearInterval(duel.timer);
  duels.delete(duel.id);
  const winner = db.users[winnerKey].profile;
  const loserKey = duel.a === winnerKey ? duel.b : duel.a;
  const loser = db.users[loserKey].profile;
  // Stage 33: the head-to-head record updates for EVERY settled
  // player duel — including Free Play (a bragging record, not a
  // ranking; Free Play's rating / overall-W-L bypass in the
  // settlement below is untouched). The done-guard above makes
  // this exactly-once per duel, double-KO coin flip included.
  recordH2H(winner, loser);
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
  // Stage 32: a KO'd loser FALLS DOWN in the arena before both
  // fighters are returned to the plaza — the whole arena (both
  // fighters + any watchers) gets the signal first. Flee / forfeit
  // endings are not deaths and never fall.
  if (/KO/.test(reason || '')) {
    const loserSess = online.get(loserKey);
    if (loserSess) broadcastArea(loserSess.area, { type: 'player_fell', username: loser.username, respawn: true });
    // Feel-fixes: the death recap — one factual line for the loser
    // naming the killer and what the settlement took / left.
    if (loserSess) {
      send(loserSess.ws, { type: 'chat', from: 'Game', text: duel.freePlay
        ? `☠️ You were killed by ${winner.username}. Dropped: nothing — Free Play settles no stakes. Kept: everything you carry and wear.`
        : `☠️ You were killed by ${winner.username}. Dropped: your stake of ${duel.stake}g${duel.escrowItems.length ? ' plus the item(s) you staked' : ''} — ${winner.username} takes the ${duel.pot}g pot${itemsWon.length ? ' and the staked items' : ''}. Kept: everything else you carry and wear.` });
    }
  }
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
      // Stage 33: each fighter also gets the opponent's name and
      // their own UPDATED head-to-head record vs them (this fight
      // included) for the end screen.
      const oppName = db.users[k === duel.a ? duel.b : duel.a].profile.username;
      send(p.ws, { type: 'duel_end', winner: winner.username, reason, pot: duel.pot, itemsWon, freePlay: !!duel.freePlay, opponent: oppName, h2h: h2hVs(db.users[k].profile, oppName), profile: publicProfile(db.users[k].profile) });
      send(p.ws, { type: 'area', area: 'plaza' });
      send(p.ws, pilesMsg('plaza'));
      send(p.ws, alliesMsg('plaza')); // Stage 6: your guardian waited for you in the plaza
      send(p.ws, objectsMsg('plaza')); // Stage 7D: placed objects in the plaza
    }
  }
  if (duel.freePlay) broadcast({ type: 'chat', from: 'Duel Master', text: `🆓 ${winner.username} wins the free play fight against ${loser.username} (${reason}) — no stakes, no record.` });
  else broadcast({ type: 'chat', from: 'Duel Master', text: `${winner.username} beat ${loser.username} for ${duel.pot}g (${reason}).` });
  // NPC build: bot fighters react in character to their own
  // result (free talk; self-gates). No mechanics touched.
  try {
    if (bots.has(winnerKey)) botDuelReact(winnerKey, true, loser.username, duel.freePlay ? 0 : duel.pot);
    if (bots.has(loserKey)) botDuelReact(loserKey, false, winner.username, duel.freePlay ? 0 : duel.pot);
  } catch (e) { /* talk never breaks a duel */ }
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
    // tap to attack ({type:'duel_attack'}) OR their opponent
    // swings at them: being swung at auto-engages (Derek,
    // 2026-11-22 — reversing his 2026-11-16 no-auto-retaliate
    // rule; see the AUTO-ENGAGE note in the tick).
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
    // Stage 33: duel_start also carries each fighter's own
    // head-to-head record vs the opponent (BEFORE this fight;
    // null = first fight) for the countdown chat line.
    const oppName33 = db.users[k === aKey ? bKey : aKey].profile.username;
    send(p.ws, { type: 'duel_start', duelId: id, stake, pot: duel.pot, escrowItems, arena: duel.arena, official: duel.official, rules: duel.rules, freePlay: duel.freePlay, countdownTicks: COUNTDOWN_TICKS, you: db.users[k].profile.username, opponent: oppName33, h2h: h2hVs(db.users[k].profile, oppName33), profile: publicProfile(db.users[k].profile) });
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
    // the timer never gets pushed forward by distance. Engagement
    // comes from a fighter's own duel_attack tap OR from being
    // swung at (auto-engage, Derek 2026-11-22 — see below). On a
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
      duel.nextSwingAt[attKey] = tick + weaponSwingTicks(attProf);
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
    // AUTO-ENGAGE (Derek, 2026-11-22 18:44 — REVERSING his
    // 2026-11-16 no-auto-retaliate rule: "I don't fight back in a
    // duel — and I want to."): being SWUNG AT engages a fighter.
    // The moment a fighter's swing resolves against their
    // opponent (hit, miss or blocked — the opponent committed),
    // the opponent starts fighting back: engaged, first return
    // swing armed for the next tick (exactly how a duel_attack
    // tap arms it), then normal weapon speed from there via
    // trySwing. A fighter whose wielded style is banned by the
    // agreed rules is NOT auto-engaged (the duel_attack rule —
    // they must swap weapons first). Tap-to-attack still engages
    // first, before any swing. Bots engage through the same flag
    // (botAct's duel_attack mutation), so a bot-vs-player duel
    // never double-engages: the guard is the engaged flag itself.
    if (aSw.swung && !duel.engaged[bKey] && !(duel.rules && duel.rules['no' + cap(styleB)])) { duel.engaged[bKey] = true; duel.nextSwingAt[bKey] = tick + 1; }
    if (bSw.swung && !duel.engaged[aKey] && !(duel.rules && duel.rules['no' + cap(styleA)])) { duel.engaged[aKey] = true; duel.nextSwingAt[aKey] = tick + 1; }
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
//     wielded weapon's speed, tap-to-engage OR auto-engage when
//     the mod swings at the player (Derek, 2026-11-22 — the duel
//     rule; the mod engages itself the moment the countdown ends).
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
    // tap — or until the mod's first swing at them auto-engages
    // them (Derek, 2026-11-22); the mod engages itself — its first swing is armed for
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
      fight.nextSwingYou = tick + weaponSwingTicks(profile);
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
  // AUTO-ENGAGE (Derek, 2026-11-22 — the duel rule, here too):
  // the mod swinging at the player engages the player — hit, miss
  // or blocked, the swing itself is the trigger. The first return
  // swing arms for the next tick (the mod_duel_attack arming),
  // then normal weapon speed via the block above.
  if (npcHit !== null && !fight.engaged) { fight.engaged = true; fight.nextSwingYou = tick + 1; }
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
  // Stage 32: losing a mod duel knocks the player DOWN in the plaza
  // (fight HP is a per-fight pool — there is no respawn to wait for,
  // so respawn:false; the fall plays and the knight gets back up).
  if (result === 'loss' && sess) {
    broadcastArea(sess.area, { type: 'player_fell', username: profile.username, respawn: false });
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
//   Sheep / Cow (Farm life): produce only, no coins — sheep give
//     1-2 wool + 1 bones; cows give 1 cowhide + 1-2 raw beef +
//     1 bones. Every piece builds a skill (Derek's drop law).
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
  if (kind === 'skeleton') {
    // Feel-fixes: the shallow-wild pocket. Derek's standing rule —
    // everything killed drops something that builds a skill: bones
    // (the game's Prayer good) most kills, a few coins always, and
    // a bronze gear roll on the side. Backpack first, bank on
    // overflow, like every other drop table here.
    const gold = 2 + Math.floor(Math.random() * 5); // 2-6
    addGold(profile, gold);
    const items = [];
    const give = (item, qty) => {
      const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, item, leftover);
      items.push({ item, qty });
    };
    if (Math.random() < 0.6) give('bones', 1);
    if (Math.random() < 0.2) {
      const gear = ['bronze_sword', 'bronze_helm', 'bronze_platebody', 'bronze_platelegs', 'bronze_boots', 'bronze_shield'];
      give(gear[Math.floor(Math.random() * gear.length)], 1);
    }
    return { gold, items };
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
  if (kind === 'sheep' || kind === 'cow') {
    // Farm life (Derek, 2026-11-23): his standing drop law — the
    // produce IS the drop, and every piece builds a skill: wool
    // spins into yarn (the coming crafting chain), cowhide sells
    // toward leather work, raw beef cooks, bones bury for Prayer
    // XP. No coin drop: the produce sells at the shops instead
    // (wool 6g, cowhide 12g, beef 5g, bones 3g). Backpack first,
    // bank on overflow, like every other drop table here.
    const items = [];
    const give = (item, qty) => {
      const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, item, leftover);
      items.push({ item, qty });
    };
    if (kind === 'sheep') {
      give('wool', 1 + Math.floor(Math.random() * 2)); // 1-2 wool
      give('animal_bones', 1);
    } else {
      give('cowhide', 1);
      give('raw_beef', 1 + Math.floor(Math.random() * 2)); // 1-2 beef
      give('animal_bones', 1);
    }
    return { gold: 0, items };
  }
  if (kind === 'hobgoblin') {
    // Tree Guardian chain (2026-11-24): the herblore carriers.
    // 4-10 gold always; one herb roll — 30% ranarr, 25% snapdragon,
    // 45% no herb. Both herbs feed the guardian's potion mixing
    // (and trade on the Exchange), so every herb drop builds a
    // skill or a purse. Backpack first, bank on overflow.
    const gold = 4 + Math.floor(Math.random() * 7); // 4-10
    addGold(profile, gold);
    const items = [];
    const give = (item, qty) => {
      const leftover = addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, item, leftover);
      items.push({ item, qty });
    };
    const r = Math.random();
    if (r < 0.30) give('herbs', 1);
    else if (r < 0.55) give('snapdragon', 1);
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
  // Stage 32: every death that lands here (NPC fight, Barrows crypt /
  // tunnels / puzzle door, Fight Caves, Wilderness) first tells the
  // whole area — victim included — so every client can topple the
  // avatar over before the respawn whisk-away. Sent BEFORE the area
  // change below, on the same socket, so ordering is guaranteed.
  broadcastArea(sess.area, { type: 'player_fell', username: sess.profile.username, respawn: true });
  sess.area = 'plaza';
  sess.x = AREAS.plaza.spawn.x; sess.y = AREAS.plaza.spawn.y;
  // Stage 28: death wakes you in the plaza, so the Barrows drains
  // clear (the app clears them on plaza entry) and the crypt/tunnel
  // session scratch goes with them. The RUN itself (kills, tunnel,
  // solved puzzle) is saved on the profile and is NOT touched here.
  sess.accDrain = 0; sess.strDrain = 0; sess.runDrainedUntil = 0;
  sess.barrowsCrypt = null; sess.barrowsHp = null; sess.barrowsPuzzle = null; sess.barrowsPuzzleShown = false;
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
  const fight = { id, playerKey: key, npcId: npc.id, hpYou: maxHpYou, maxHpYou, specialQueued: false, done: false, timer: null, tickCount: 0, nextSwingYou: weaponSwingTicks(profile), nextSwingNpc: MELEE_SPEED, npcUnlocked: false, lastRefuseTick: -99 }; // Stage 19: first swing one weapon-speed after engagement (the wielded style's speed); lastRefuseTick throttles out-of-arrows/runes notes
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
      fight.nextSwingYou = tick + weaponSwingTicks(profile);
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
    // Stage 31: per-fighter closing, mirroring the mod-duel tick —
    // when only the PLAYER is out of their weapon's reach (the
    // melee-vs-wizard/ranger case: the creature can act at range,
    // the player cannot yet), the fighting tick still tells the
    // client where to walk, so the player closes in and lands the
    // connected swing that unlocks the creature — instead of the
    // fight stalling at range forever with neither side swinging.
    ...(playerOut ? { closing: true, moveTo: approachPoint(sess.x, sess.y, npc.x, npc.y) } : {}),
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
    // Feel-fixes: dying in the Wilderness — even to a pocket
    // skeleton — is a Wilderness death (wildDeath's keep-3 /
    // skulled drop rules), never the free camp respawn.
    if (playerDead) {
      if (isWildArea(npc.area)) wildDeath(fight.playerKey, npc.name);
      else respawnPlayer(fight.playerKey, `☠️ You were killed by the ${npc.name.toLowerCase()} — you took it down with you. Dropped: nothing. Kept: everything you carry and wear. You wake up in the plaza at full health.`);
    }
    return;
  }
  if (fight.hpYou <= 0) {
    npc.hp = npc.maxHp; // the creature resets when it wins
    finishNpcFight(fight, 'death', null);
    broadcastNpcState(npc.area);
    if (isWildArea(npc.area)) wildDeath(fight.playerKey, npc.name); // Feel-fixes: a wild death follows wild rules (see above)
    else respawnPlayer(fight.playerKey, `☠️ You were killed by the ${npc.name.toLowerCase()}. Dropped: nothing. Kept: everything you carry and wear. You wake up in the plaza at full health.`);
  }
}

// NPC respawns: after their def's respawnMs, back at full HP on
// their spawn point (goblins 10s, wizards/rangers 12s — Stage 19).
// Playtest fix: the respawn now really does restore the spawn
// point (it used to restore only HP/alive, so a creature killed
// while dragged across the area came back where it died), and a
// living creature left away from home by a broken-off fight
// ambles back to its spawn point on this same sweep — otherwise
// the camp's goblins migrate over a day's play (every fight steps
// a melee creature toward its opponent) and the camp stands
// empty at its spawns. HP is untouched on the walk home: a
// fled-from goblin keeps its remaining HP, as always.
setInterval(() => {
  const touched = new Set();
  const now = Date.now();
  for (const npc of npcs.values()) {
    if (!npc.alive && now >= npc.respawnAt) { npc.alive = true; npc.hp = npc.maxHp; npc.x = npc.spawnX; npc.y = npc.spawnY; touched.add(npc.area); continue; }
    if (npc.alive && !npc.fightId && !((npc.frozenUntil || 0) > now) && !npc.pasture && (npc.x !== npc.spawnX || npc.y !== npc.spawnY)) {
      if (stepToward(npc, npc.spawnX, npc.spawnY, APPROACH_STEP)) touched.add(npc.area);
    }
    // Farm life: pasture animals GRAZE — they amble slowly (6
    // units a second, well under a player's walk) toward a wander
    // point inside the fence, pause there a few seconds, then pick
    // another. A fight can drag one out of the pasture; the wander
    // points are always inside, so it ambles back in afterwards.
    if (npc.alive && npc.pasture && !npc.fightId && !((npc.frozenUntil || 0) > now)) {
      if (now < (npc.wUntil || 0)) { /* grazing pause */ }
      else if (Math.hypot(npc.wx - npc.x, npc.wy - npc.y) < 4) {
        const p = npc.pasture;
        npc.wx = p.minX + Math.random() * (p.maxX - p.minX);
        npc.wy = p.minY + Math.random() * (p.maxY - p.minY);
        npc.wUntil = now + 2500 + Math.random() * 3500; // graze 2.5-6s before ambling on
      } else if (stepToward(npc, npc.wx, npc.wy, 6)) touched.add(npc.area);
    }
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
    nextSwingYou: weaponSwingTicks(profile), nextSwingNpc: MELEE_SPEED, npcUnlocked: false, // Stage 12 swing timers + retaliate lock (Stage 19: first swing at the wielded style's speed)
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
        fight.nextSwingYou = fight.tickCount + weaponSwingTicks(profile);
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
    if (playerDead) respawnPlayer(fight.playerKey, `☠️ You were killed by ${def.name} — you took him down with you. Dropped: nothing. Kept: everything you carry, and your Barrows kills. You wake up in the plaza.`);
    return;
  }
  if (fight.hpYou <= 0) {
    finishBarrowsFight(fight, 'death');
    respawnPlayer(fight.playerKey, `☠️ You were killed by ${def.name}. Dropped: nothing. Kept: everything you carry, and your Barrows kills. You wake up in the plaza at full health.`);
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
  // Week 2 (D13): the caves' HP pool IS the player's Hitpoints level
  // (by design) — say so up front, so the smaller number never reads
  // as a bug.
  send(sess.ws, { type: 'chat', from: 'Game', text: `🌋 Fight Caves: your hitpoints here are a pool equal to your Hitpoints level (${maxHpYou}) for the whole run.` });
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
  let tzkihDrained = 0; // Week 2 (D12): prayer points a Tz-Kih took this tick (named on the tick note below)
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
        if (mon.kind === 'tzkih') { const ppBefore = profile.prayerPoints; profile.prayerPoints = Math.max(0, profile.prayerPoints - 2); tzkihDrained += ppBefore - profile.prayerPoints; }
        mon.hp -= deflected;
        if (mon.hp <= 0) killFcMonster(run, mon);
      } else if (Math.random() < styleBlockChance(profile)) {
        styleBlocked = true;
      } else {
        if (mon.kind === 'tzkih') { const ppBefore = profile.prayerPoints; profile.prayerPoints = Math.max(0, profile.prayerPoints - 2); tzkihDrained += ppBefore - profile.prayerPoints; }
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
  // Week 2 (D12): a Tz-Kih's drain is a pool attack — it lands whether
  // or not a prayer is up (Derek's Fight Caves spec) — but it must
  // never be a MYSTERY drain: the tick it happens, the tick says so.
  // (The over-time drain is separate and only ever runs while a
  // prayer is active — see the prayer drain interval.)
  if (tzkihDrained > 0) note = note ? `${note} The Tz-Kih drains ${tzkihDrained} prayer points!` : `The Tz-Kih drains ${tzkihDrained} prayer points!`;

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
    if (reason === 'death') respawnPlayer(run.playerKey, `☠️ You were killed by the Fight Caves on wave ${run.wave}. Dropped: nothing. Kept: everything you carry — and your run record (best wave ${Math.max(run.wave, p.fc.bestWave)}). You wake up in the plaza.`);
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
// Playtest fix: the spots sit at x=1180 — just off the waterline
// (the lake covers x > ~1060, and the client now stops walkers at
// the shore) so a fisher standing on the beach is 120 away, inside
// GATHER_RANGE. At the old x=1320 they were 260 from the shore and
// could only be fished by walking out onto the lake. The middle
// spot moved off y=450 so its ripple ring isn't hidden under the
// dock deck (dock spans x 1060-1240, y 438-462).
defNode('tree_c1', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 240, 200);
defNode('tree_c2', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 240, 460);
defNode('tree_c3', 'cove', 'tree', 'Tree', 'woodcutting', 1, 'logs', 25, 3, 10000, 240, 720);
defNode('trout_spot_c1', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 1180, 200);
defNode('trout_spot_c2', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 1180, 380);
defNode('trout_spot_c3', 'cove', 'fish', 'Trout spot', 'fishing', 1, 'raw_trout', 30, 3, 12000, 1180, 700);
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
// Frostfall (Stage 44) — the Winter World's gathering: frost pines
// and a snowy oak to chop, ice-crusted rocks to mine. Same items
// and XP as their temperate cousins — the winter is a new place,
// not a new economy, and it runs on the same gather machinery.
defNode('frost_pine1', 'winter', 'tree', 'Frost pine', 'woodcutting', 1, 'logs', 25, 3, 10000, 300, 250);
defNode('frost_pine2', 'winter', 'tree', 'Frost pine', 'woodcutting', 1, 'logs', 25, 3, 10000, 430, 580);
defNode('frost_pine3', 'winter', 'tree', 'Frost pine', 'woodcutting', 1, 'logs', 25, 3, 10000, 620, 200);
defNode('snowy_oak', 'winter', 'tree', 'Snowy oak', 'woodcutting', 15, 'oak_logs', 38, 3, 15000, 1240, 640);
defNode('frost_copper', 'winter', 'rock', 'Copper rock', 'mining', 1, 'copper_ore', 18, 3, 8000, 1080, 560);
defNode('frost_tin', 'winter', 'rock', 'Tin rock', 'mining', 1, 'tin_ore', 18, 3, 8000, 1330, 600);
defNode('frost_iron', 'winter', 'rock', 'Iron rock', 'mining', 10, 'iron_ore', 35, 3, 12000, 950, 430);
// Runecrafting (2026-11-24): essence rocks at the Wizard Grounds —
// west and east of the stone circle and one south toward the gate,
// so the whole loop (Alden, rocks, altar) stays inside the one
// area. Ordinary mining nodes: a pickaxe is required and refused
// with the usual line; each success yields rune essence + 5 Mining
// XP (the Runecrafting XP is earned at the altar, not the rock).
defNode('essence_rock_w', 'magic', 'rock', 'Essence rock', 'mining', 1, 'rune_essence', 5, 5, 8000, 560, 450);
defNode('essence_rock_e', 'magic', 'rock', 'Essence rock', 'mining', 1, 'rune_essence', 5, 5, 8000, 1040, 450);
defNode('essence_rock_s', 'magic', 'rock', 'Essence rock', 'mining', 1, 'rune_essence', 5, 5, 8000, 800, 650);

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

// ---------- Seaweed patches (Stage 29) ----------
// Clumps of seaweed washed up along the Fishing Cove shore — the
// app version's cove dressing, ported: tap one (the client walks
// you over) to pick the piece up; it lands in the backpack as a
// no-stack item (one slot per piece, see ITEMS.seaweed) and the
// clump regrows ~30s later (the app uses 26s). Session-only world
// state like piles and fires; spots sit on the grass just west of
// the waterline (the lake covers server x > ~1060) plus a pair by
// the dock shore.
const SEAWEED_RESPAWN_MS = 30000;
const seaweedPatches = new Map(); // id -> { id, area, x, y, present, respawnAt }
[
  [1030, 140], [1055, 290], [1015, 430], [1055, 590], [1030, 740], [960, 340], [960, 660],
].forEach(([x, y], i) => {
  const id = 'weed' + (i + 1);
  seaweedPatches.set(id, { id, area: 'cove', x, y, present: true, respawnAt: 0 });
});
function seaweedMsg(area) {
  return {
    type: 'seaweed', area,
    patches: [...seaweedPatches.values()].filter((p) => p.area === area)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, present: p.present })),
  };
}
function broadcastSeaweed(area) {
  const msg = seaweedMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}
// Picked clumps wash back up on their respawn timer.
setInterval(() => {
  const now = Date.now();
  let touched = false;
  for (const p of seaweedPatches.values()) {
    if (!p.present && p.respawnAt && now >= p.respawnAt) { p.present = true; p.respawnAt = 0; touched = true; }
  }
  if (touched) broadcastSeaweed('cove');
}, 1000);

// ---------- Sand piles (Tree Guardian chain, 2026-11-24) ----------
// Piles of shore sand along the Fishing Cove, beside the seaweed
// clumps (same shore, a little further from the waterline). Tap
// one with an empty Bucket in your backpack to scoop it into a
// Bucket of sand — the glassmaking half of the guardian's chain.
// Same session-only pattern as the seaweed: scooped piles smooth
// back over ~30s later.
const SAND_RESPAWN_MS = 30000;
const sandPiles = new Map(); // id -> { id, area, x, y, present, respawnAt }
[
  [905, 180], [935, 330], [890, 470], [930, 620], [900, 760], [975, 520],
].forEach(([x, y], i) => {
  const id = 'sand' + (i + 1);
  sandPiles.set(id, { id, area: 'cove', x, y, present: true, respawnAt: 0 });
});
function sandMsg(area) {
  return {
    type: 'sand', area,
    piles: [...sandPiles.values()].filter((p) => p.area === area)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, present: p.present })),
  };
}
function broadcastSand(area) {
  const msg = sandMsg(area);
  for (const p of online.values()) if (p.area === area) send(p.ws, msg);
}
// Scooped piles build back up on their respawn timer.
setInterval(() => {
  const now = Date.now();
  let touched = false;
  for (const p of sandPiles.values()) {
    if (!p.present && p.respawnAt && now >= p.respawnAt) { p.present = true; p.respawnAt = 0; touched = true; }
  }
  if (touched) broadcastSand('cove');
}, 1000);

// ---------- Stage 30: the Wilderness (PvP, skulling, PKers, Pure Wild) ----------
// Derek's settled rules, ported from the app version's Wilderness
// (built there 2026-11-17/18) onto this game's real-multiplayer
// architecture. Where the app and the online brief disagreed, the
// brief won:
//  * Walkable-connected (Derek's standing rule): a ditch crossing on
//    the plaza's north edge (the east stretch, x 1020–1560) walks
//    you in and out; the obelisk teleport is the shortcut IN.
//    Teleporting OUT is refused above Wilderness level 20 or while
//    teleblocked. The 🚪 Leave button WALKS you back to the ditch —
//    you stay in the wild, and attackable, until you actually cross.
//  * Geometry: each wild area is its own 1600x900 space like every
//    area. The ditch is the SOUTH edge (y = 880); depth runs north.
//    Wilderness level = 1 + floor(clamp((880 - y) / 880, 0, 1) * 50)
//    → 1 at the ditch, 51 at the far north (the app's mapping).
//  * Bracket (the app's rule): you may only attack / be attacked by
//    a combatant whose combat level is within ±(the Wilderness
//    level at the ATTACKER's position) of yours. Shallow wild
//    (level < 20 on either side) is single-way: nobody already in a
//    fight can be piled, and nobody in a fight can start a second.
//  * SKULL: attacking first skulls you — weapon engage or a button
//    cast, players and PKers alike. Attacking a skulled player
//    never skulls you; fighting back against whoever struck you
//    first never skulls you. The app's skull is session-only with
//    NO countdown — it lasts until you leave the Wilderness or die
//    there — and Derek's brief carries no timer either, so online
//    matches the app: the skull clears on leaving the wild (ditch,
//    teleport, PK Noob hop) or on death. It is never saved, and a
//    logout in the wild is a death (below), so no skull survives a
//    logout. Shown as 💀 overhead via the players snapshot.
//  * DEATH: unskulled keeps the 3 most valuable backpack stacks
//    (valued by stackValueOf; personal notes are never at risk and
//    never counted) and ALL worn gear; everything else drops as
//    standard piles where you fell. SKULLED drops EVERYTHING —
//    the whole backpack AND every worn piece. The bank is never
//    touched. Piles follow the standard pile rules: anyone in
//    range can loot them, 3-minute despawn (the app keeps loot on
//    the ground until picked up — online's shared pile lifetime
//    wins; documented deviation). Respawn is the plaza, as usual.
//  * DISCONNECT mid-fight in the wild = death with drops (the
//    online reading of the app's combat-logout danger, and the
//    same spirit as a duel forfeit).
//  * TELEBLOCK: Hex Hanna, the magic PKer — when one of her casts
//    CONNECTS on a player whose Deflect Magic prayer is off, the
//    player is teleblocked for 12 seconds (the app's 20 ticks).
//    The swing still lands; teleblock is in addition. (The app
//    rolls its hit chance separately; riding her connected cast
//    is this port's documented simplification.)
//  * PURE WILD + PK NOOB: PK Noob stands in the plaza by the north
//    gate and in the wild by the ditch; talking to him hops you
//    between the normal wild and `purewild` — the same map and
//    rules, but PRAYER and FOOD are hard-blocked server-side for
//    everyone (players and PKers: no flicking, no eating).
//  * A wild fight is FREE combat on the shared Stage 27 machinery
//    (rollStyleAttack: procs, PvP Deflect, all three styles,
//    button casts via cast_at kind 'wild'), real levels (NOT the
//    duel equalisation), duel-rate XP, free movement throughout —
//    melee closes to reach exactly like Stage 8/12/26 (closing
//    ticks + moveTo; a due swing fires on return to reach), and NO
//    auto-retaliate: you swing only on your own attack order.
//    Face-and-chase (Derek, 2026-11-18): an attack order turns the
//    attacker to face the target and walks/runs them in (client
//    closing machinery, run-orb speed); PKers face + chase the
//    same way server-side. NO rating, NO W/L, NO escrow — this
//    never touches startDuel.
const WILD_AREAS = ['wilderness', 'purewild'];
const WILD_DITCH_Y = 880;
const WILD_EXIT_MIN_Y = 840; // a gate exit only counts from beside the ditch
const PK_NOOB_PLAZA = { x: 1150, y: 120 };
const PK_NOOB_WILD = { x: 900, y: 830 };
const WILD_OBELISK_POS = { x: 700, y: 830 };
const TELEBLOCK_MS = 12000;
const PKER_RESPAWN_MS = 25000;
const WILD_PAIR_IDLE_TICKS = 100; // 60s with no swing attempt breaks a fight off
const PRAYER_FOR_ATTACK_STYLE = { melee: 'melee', ranged: 'missiles', magic: 'magic' };
function isWildArea(a) { return WILD_AREAS.includes(a); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function wildLevelAt(y) { return 1 + Math.floor(clamp((WILD_DITCH_Y - y) / WILD_DITCH_Y, 0, 1) * 50); }
// Per-stack valuation for the 3-kept-stacks rule: gold at face
// value; anything with a price at that price; never-sellable gear
// (Barrows pieces and the like) at a flat gear value so it is not
// treated as worthless next to a stack of potions. (The game has
// no general stack valuation elsewhere — duel staking never
// values stacks — so this follows the brief's fallback: sell
// price x qty, with buy price standing in where sellOnly is 0.)
function stackValueOf(item, qty) {
  if (item === 'gold') return qty;
  const def = itemDef(item);
  if (!def) return 0;
  const unit = def.buy || def.sellOnly || ((def.kind === 'weapon' || def.kind === 'armour') ? 1000 : 0);
  return unit * qty;
}
let pileSeq = 900000; // wild-death / PKer loot piles share the piles map
function spawnPile(area, item, qty, x, y, owner) {
  const id = 'wp' + (++pileSeq);
  piles.set(id, { id, item, qty, x: clamp(x, 10, 1590), y: clamp(y, 10, 890), area, owner: owner || null, bornAt: Date.now() });
  return id;
}

// ----- combatant refs: 'p:<userKey>' for players, 'n:<pkerId>' for PKers -----
function wildRefPlayer(key) { return 'p:' + key; }
function wildRefPker(id) { return 'n:' + id; }
function combatant(ref) {
  if (!ref) return null;
  if (ref[0] === 'p') {
    const key = ref.slice(2);
    const sess = online.get(key);
    if (!sess) return null;
    if (sess.wildHp == null && isWildArea(sess.area)) { // belt-and-braces: entering always sets the pool
      sess.wildMaxHp = Math.max(1, levelForXp((sess.profile.xp && sess.profile.xp.hitpoints) || 0));
      sess.wildHp = sess.wildMaxHp;
    }
    return {
      ref, isPlayer: true, key, sess, profile: sess.profile, name: sess.profile.username,
      x: sess.x, y: sess.y, area: sess.area,
      hp: () => (sess.wildHp == null ? (sess.wildMaxHp || 1) : sess.wildHp),
      setHp: (v) => { sess.wildHp = v; },
      maxHp: () => sess.wildMaxHp || 1,
      frozenUntil: () => sess.frozenUntil || 0,
    };
  }
  const pk = pkers.get(ref.slice(2));
  if (!pk) return null;
  return {
    ref, isPlayer: false, id: pk.id, pker: pk, profile: pk.profile, name: pk.name,
    x: pk.x, y: pk.y, area: pk.area,
    hp: () => pk.hp, setHp: (v) => { pk.hp = v; },
    maxHp: () => pk.maxHp,
    frozenUntil: () => pk.frozenUntil || 0,
  };
}

// ----- wild pairs: one record per fight, combatants may hold several (deep wild) -----
const wildFights = new Map(); // id -> pair
let wildPairSeq = 0;
let wildTickCount = 0;
function pairOtherRef(pair, ref) { return pair.a === ref ? pair.b : pair.a; }
function wildPairBetween(refA, refB) {
  for (const f of wildFights.values()) if ((f.a === refA && f.b === refB) || (f.a === refB && f.b === refA)) return f;
  return null;
}
function wildPairsOf(ref) { return [...wildFights.values()].filter((f) => !f.done && (f.a === ref || f.b === ref)); }
function trackWildPair(ref, pair) {
  if (ref[0] === 'p') { const s = online.get(ref.slice(2)); if (s) { s.wildPairs = s.wildPairs || new Set(); s.wildPairs.add(pair.id); } }
  else { const pk = pkers.get(ref.slice(2)); if (pk) pk.pairIds.add(pair.id); }
}
function untrackWildPair(ref, pair) {
  if (ref[0] === 'p') { const s = online.get(ref.slice(2)); if (s && s.wildPairs) s.wildPairs.delete(pair.id); }
  else { const pk = pkers.get(ref.slice(2)); if (pk) pk.pairIds.delete(pair.id); }
}
function wildStartMsg(pair, forRef) {
  const meC = combatant(forRef);
  const oppC = combatant(pairOtherRef(pair, forRef));
  if (!meC || !oppC || !meC.isPlayer) return;
  send(meC.sess.ws, {
    type: 'wild_fight', phase: 'start',
    oppKind: oppC.isPlayer ? 'player' : 'pker', oppId: oppC.isPlayer ? oppC.name : oppC.id, oppName: oppC.name,
    oppCbt: oppC.isPlayer ? Math.floor(combatLevelOf(levelsOf(oppC.profile))) : oppC.pker.cbt,
    hpYou: meC.hp(), maxHpYou: meC.maxHp(), hpOpp: Math.max(0, oppC.hp()), maxHpOpp: oppC.maxHp(),
    energyYou: meC.profile.specialEnergy,
    theyStarted: pair.aggro === pairOtherRef(pair, forRef),
    wildLevel: wildLevelAt(meC.y), pure: pair.area === 'purewild',
  });
}
function createWildPair(area, refA, refB, aggroRef) {
  const pair = {
    id: 'wf' + (++wildPairSeq), area, a: refA, b: refB, aggro: aggroRef,
    eng: { [refA]: false, [refB]: false }, next: { [refA]: 0, [refB]: 0 }, spec: { [refA]: false, [refB]: false },
    lastAction: wildTickCount, lastRefuse: {}, tickRes: {}, notes: {}, done: false,
  };
  wildFights.set(pair.id, pair);
  trackWildPair(refA, pair);
  trackWildPair(refB, pair);
  wildStartMsg(pair, refA);
  wildStartMsg(pair, refB);
  return pair;
}
function endWildPair(pair, reasonFor) {
  if (!pair || pair.done) return;
  pair.done = true;
  wildFights.delete(pair.id);
  untrackWildPair(pair.a, pair);
  untrackWildPair(pair.b, pair);
  for (const ref of [pair.a, pair.b]) {
    const C = combatant(ref);
    if (C && C.isPlayer) {
      if (C.sess.wildTarget === pairOtherRef(pair, ref)) C.sess.wildTarget = null;
      const O = combatant(pairOtherRef(pair, ref));
      send(C.sess.ws, {
        type: 'wild_fight', phase: 'end',
        oppKind: O ? (O.isPlayer ? 'player' : 'pker') : 'player', oppId: O ? (O.isPlayer ? O.name : O.id) : '', oppName: O ? O.name : '',
        reason: (reasonFor && reasonFor[ref]) || 'gone',
      });
    }
  }
}
function engageWild(pair, ref) {
  if (!pair || pair.done || pair.eng[ref]) return;
  pair.eng[ref] = true;
  pair.next[ref] = wildTickCount + 1; // first swing arms for the next tick (Stage 12 pattern)
  pair.lastAction = wildTickCount;
  const C = combatant(ref);
  if (C && C.isPlayer) C.sess.wildTarget = pairOtherRef(pair, ref);
}
// The skull rule: striking a combatant who is not skulled and has
// not struck YOU first (in this pair, or — for a PKer — ever since
// it respawned) skulls the attacker. Fighting back is always clean.
function wildSkullCheck(attKey, defRef) {
  const attSess = online.get(attKey);
  if (!attSess || attSess.skulled) return;
  const defC = combatant(defRef);
  if (!defC) return;
  if (defC.isPlayer && defC.sess.skulled) return; // attacking a skulled player never skulls
  const pair = wildPairBetween(wildRefPlayer(attKey), defRef);
  if (pair && pair.aggro === defRef) return; // they struck me first in this fight
  if (!defC.isPlayer && defC.pker.aggroPlayers.has(attKey)) return; // this PKer came for me first
  attSess.skulled = true;
  send(attSess.ws, { type: 'chat', from: 'Game', text: '💀 You attacked first — you are SKULLED! Die now and you drop EVERYTHING. The skull clears when you leave the Wilderness.' });
  broadcastState();
}
// Entering the wild cancels anything that must not follow a player
// in (duel challenges, trades, party invites, stake offers) —
// party MEMBERSHIP itself stays, per the disconnect patterns.
function cancelWildPendings(key) {
  for (const [cid, ch] of [...challenges]) {
    if (ch.from === key || ch.to === key) { challenges.delete(cid); broadcastChallengeClear(ch.from); }
  }
  clearPartyInvitesInvolving(key);
  const myTrade = activeTradeForKey(key);
  if (myTrade) cancelTrade(myTrade, 'Trade cancelled — a player entered the Wilderness.');
  clearTradeRequestsInvolving(key);
  let boardChanged = false;
  for (const [oid, o] of [...stakeOffers]) {
    if (o.status === 'open' && o.fromKey === key) { stakeOffers.delete(oid); boardChanged = true; }
  }
  if (boardChanged) broadcastStakeBoard();
  const myMatch = stakeMatchForKey(key);
  if (myMatch) cancelStakeMatch(myMatch, 'The stake match is cancelled — a fighter entered the Wilderness.');
}
function enterWildState(key, area) {
  const sess = online.get(key);
  if (!sess) return;
  sess.skulled = false;
  sess.teleblockUntil = 0;
  sess.wildTarget = null;
  sess.wildMaxHp = Math.max(1, levelForXp((sess.profile.xp && sess.profile.xp.hitpoints) || 0));
  sess.wildHp = sess.wildMaxHp;
  if (area === 'purewild' && sess.profile.activePrayer) sess.profile.activePrayer = null; // Pure Wild: no prayer for anyone
  send(sess.ws, wildStateMsg(area, sess));
  send(sess.ws, npcStateMsg(area)); // Feel-fixes: the shallow-wild skeleton pocket rides the shared NPC roster
}
// Leaving the wild (any route): my fights end — I got out, my
// opponents' quarry escaped — and skull / teleblock / HP pool go.
function exitWildCleanup(key) {
  const sess = online.get(key);
  if (!sess) return;
  const myRef = wildRefPlayer(key);
  for (const pair of wildPairsOf(myRef)) {
    endWildPair(pair, { [myRef]: 'left', [pairOtherRef(pair, myRef)]: 'escaped' });
  }
  if (sess.wildPairs) sess.wildPairs.clear();
  sess.wildTarget = null;
  sess.skulled = false;
  sess.teleblockUntil = 0;
  sess.wildHp = null;
  sess.wildMaxHp = 0;
}
// Death in the wild — Derek's drop rules (see the header). Also
// the disconnect-in-a-wild-fight path (opts.disconnect).
function wildDeath(key, killerName, opts = {}) {
  const sess = online.get(key);
  if (!sess) return;
  const profile = sess.profile;
  const area = sess.area;
  const myRef = wildRefPlayer(key);
  if (!opts.skipPairEnd) {
    for (const pair of wildPairsOf(myRef)) {
      endWildPair(pair, { [myRef]: 'death', [pairOtherRef(pair, myRef)]: 'kill' });
    }
  }
  if (sess.wildPairs) sess.wildPairs.clear();
  sess.wildTarget = null;
  if (!isWildArea(area)) { sess.skulled = false; sess.teleblockUntil = 0; sess.wildHp = null; return; }
  const wasSkulled = !!sess.skulled;
  const dx = sess.x, dy = sess.y;
  const jit = () => (Math.random() * 24 - 12);
  // Risk pool: every backpack stack except personal notes (Stage 9:
  // a note is personal — it is never dropped, traded or staked).
  const entries = profile.backpack
    .map((s, i) => ({ s, i, value: stackValueOf(s.item, s.qty) }))
    .filter((e) => { const d = itemDef(e.s.item); return !(d && d.kind === 'note'); });
  let kept = [];
  let lost = entries;
  if (!wasSkulled) {
    const sorted = [...entries].sort((a, b) => b.value - a.value);
    kept = sorted.slice(0, 3);
    lost = sorted.slice(3);
  }
  const lostIdx = new Set(lost.map((e) => e.i));
  profile.backpack = profile.backpack.filter((s, i) => !lostIdx.has(i));
  for (const e of lost) spawnPile(area, e.s.item, e.s.qty, dx + jit(), dy + jit(), profile.username);
  const gearLost = [];
  if (wasSkulled && profile.worn) {
    for (const slot of WORN_SLOTS) {
      const it = profile.worn[slot];
      if (it) { spawnPile(area, it, 1, dx + jit(), dy + jit(), profile.username); profile.worn[slot] = null; gearLost.push(it); }
    }
  }
  syncGoldMirror(profile);
  save(key);
  broadcastPiles(area);
  sess.skulled = false;
  sess.teleblockUntil = 0;
  sess.wildHp = null;
  sess.wildMaxHp = 0;
  broadcast({
    type: 'chat', from: 'Game',
    text: opts.disconnect
      ? `💀 ${profile.username} logged out in combat in the Wilderness — their loot dropped where they stood.`
      : killerName
        ? `💀 ${profile.username} was killed by ${killerName} in the Wilderness!`
        : `💀 ${profile.username} died in the Wilderness!`,
  });
  const note = opts.disconnect
    ? '☠ You logged out mid-fight in the Wilderness — that counts as a death there.'
    : `☠ You died in the Wilderness${killerName ? ` — ${killerName} got you` : ''}!`
      + (wasSkulled
        ? ' You were 💀 SKULLED, so EVERYTHING dropped — backpack and worn gear.'
        : (kept.length ? ` You kept your ${kept.length} most valuable stack${kept.length > 1 ? 's' : ''} and everything you were wearing.` : ''))
      + ((lost.length || gearLost.length) ? ' The rest lies where you fell — run back and grab the piles before someone else does (they fade in 3 minutes).' : '')
      + ' Your bank was never touched.';
  respawnPlayer(key, note);
  sendProfile(key);
}

// ----- NPC PKers (the app's roster, ported in spirit) -----
// The app's abstract acc/def/maxHit numbers do not map 1:1 onto
// this game's OSRS-style rolls, so each PKer's synthetic profile
// is tuned to land close: attack level = the app's accuracy,
// defence level = the app's defence, and strength/weapon picked
// so the shared max-hit formula lands within ~2 of the app's
// maxHit (Hex Hanna casts Fire Strike at Magic 20 for max ~15;
// Bolt Bram shoots iron arrows at Ranged 20 for max ~17).
const PKER_DEFS = [
  { id: 'rex', name: 'Rusher Rex', cbt: 45, hp: 52, style: 'melee', weapon: 'bronze_sword', atk: 50, str: 1, def: 40, food: 3, x: 565, y: 621, greet: 'Sit.' },
  { id: 'wanda', name: 'Wild Wanda', cbt: 58, hp: 66, style: 'melee', weapon: 'bronze_sword', atk: 58, str: 1, def: 48, food: 4, x: 1082, y: 518, greet: 'Nice stuff. Hand it over.' },
  { id: 'hanna', name: 'Hex Hanna', cbt: 71, hp: 74, style: 'magic', weapon: 'mystic_staff', spell: 'fire_strike', atk: 20, str: 1, def: 55, food: 4, x: 424, y: 311, greet: 'No teleports past me, sweetie.', teleblock: true },
  { id: 'bram', name: 'Bolt Bram', cbt: 84, hp: 84, style: 'ranged', weapon: 'magic_shortbow', atk: 20, str: 1, def: 62, food: 5, x: 1224, y: 233, greet: "Run and I'll still hit you." },
  { id: 'stabs', name: 'Sir Stabsalot', cbt: 97, hp: 92, style: 'melee', weapon: 'mithril_sword', atk: 80, str: 4, def: 70, food: 5, x: 612, y: 129, greet: 'Your stuff or your life. Both, actually.' },
  { id: 'venom', name: 'Queen Venom', cbt: 112, hp: 99, style: 'melee', weapon: 'rune_sword', atk: 86, str: 1, def: 78, food: 6, x: 1035, y: 52, greet: 'Deep wild is mine. Pay the toll.' },
];
function pkerProfile(def) {
  const xp = defaultXp();
  const setLv = (skill, lv) => { xp[skill] = XP_TABLE[Math.max(1, Math.min(99, lv))] || 0; };
  setLv('attack', def.atk);
  setLv('strength', def.str);
  setLv('defence', def.def);
  setLv('hitpoints', Math.min(99, def.hp));
  if (def.style === 'ranged') setLv('ranged', def.atk);
  if (def.style === 'magic') setLv('magic', def.atk);
  const backpack = [];
  if (def.style === 'ranged') backpack.push({ item: 'iron_arrow', qty: 99999 });
  if (def.style === 'magic') backpack.push({ item: 'fire_rune', qty: 99999 });
  return {
    username: def.name, style: 'aggressive', worn: { ...emptyWorn(), weapon: def.weapon },
    xp, backpack, spell: def.spell || 'air_strike', activePrayer: null,
    prayerPoints: 99, prayerMax: 99, specialEnergy: 0,
  };
}
const pkers = new Map(); // '<area>:<defId>' -> instance; each wild variant gets its own roster
for (const area of WILD_AREAS) {
  for (const def of PKER_DEFS) {
    const id = area + ':' + def.id;
    pkers.set(id, {
      id, defId: def.id, def, area, name: def.name, cbt: def.cbt, style: def.style,
      x: def.x, y: def.y, homeX: def.x, homeY: def.y,
      hp: def.hp, maxHp: def.hp, alive: true, respawnAt: 0,
      food: area === 'purewild' ? 0 : def.food, foodMax: def.food, eatNextTick: 0,
      targetKey: null, lastTargetName: null, fleeing: false,
      aggroPlayers: new Set(), pairIds: new Set(), frozenUntil: 0,
      wanderX: def.x, wanderY: def.y, wanderNextTick: 0,
      profile: pkerProfile(def),
    });
  }
}
function wildStateMsg(area, sess) {
  const now = Date.now();
  return {
    type: 'wild_state', area,
    pkers: [...pkers.values()].filter((p) => p.area === area && p.alive).map((p) => ({
      id: p.id, name: p.name, cbt: p.cbt, style: p.style,
      x: Math.round(p.x), y: Math.round(p.y), hp: Math.max(0, p.hp), maxHp: p.maxHp,
      frozenUntil: (p.frozenUntil && p.frozenUntil > now) ? p.frozenUntil : 0,
    })),
    you: sess ? {
      level: wildLevelAt(sess.y), skulled: !!sess.skulled,
      teleblockLeft: Math.max(0, Math.ceil(((sess.teleblockUntil || 0) - now) / 1000)),
      hp: sess.wildHp, maxHp: sess.wildMaxHp || 0, pure: area === 'purewild',
    } : null,
  };
}
function broadcastWildState(area) {
  for (const p of online.values()) if (p.area === area) send(p.ws, wildStateMsg(area, p));
}
function pkerDeath(pk, killerKey) {
  if (!pk.alive) return; // already gone (fled) — no double loot
  const pkRef = wildRefPker(pk.id);
  pk.alive = false;
  pk.hp = 0;
  pk.respawnAt = Date.now() + PKER_RESPAWN_MS;
  pk.targetKey = null;
  pk.fleeing = false;
  for (const pair of wildPairsOf(pkRef)) {
    endWildPair(pair, { [pkRef]: 'gone', [pairOtherRef(pair, pkRef)]: 'kill' });
  }
  pk.pairIds.clear();
  // The app's kill loot, as piles where he fell.
  const jit = () => (Math.random() * 24 - 12);
  const coins = randiRange(pk.cbt * 2, pk.cbt * 6);
  spawnPile(pk.area, 'gold', coins, pk.x + jit(), pk.y + jit(), pk.name);
  const loot = [`${coins} coins`];
  if (Math.random() < 0.40) { const q = randiRange(1, 2); spawnPile(pk.area, 'restore_potion', q, pk.x + jit(), pk.y + jit(), pk.name); loot.push('restore potion'); }
  if (Math.random() < 0.35) { const q = randiRange(1, 2); spawnPile(pk.area, 'ration', q, pk.x + jit(), pk.y + jit(), pk.name); loot.push('food'); }
  if (Math.random() < 0.25) { spawnPile(pk.area, 'prayer_potion', 1, pk.x + jit(), pk.y + jit(), pk.name); loot.push('prayer potion'); }
  if (Math.random() < 0.15) { const g = GOODS[randiRange(0, GOODS.length - 1)]; spawnPile(pk.area, g.id, 1, pk.x + jit(), pk.y + jit(), pk.name); loot.push(g.name); }
  broadcastPiles(pk.area);
  if (killerKey) {
    const ks = online.get(killerKey);
    if (ks) send(ks.ws, { type: 'chat', from: 'Game', text: `💀 You killed ${pk.name} (combat ${pk.cbt})! Loot where he fell: ${loot.join(', ')} — grab the piles.` });
  }
  broadcast({ type: 'chat', from: 'Game', text: `💀 ${pk.name} was killed in the Wilderness!` });
  broadcastWildState(pk.area);
}
// One wild swing, resolved on the shared Stage 27 machinery.
// Returns null (no pair context), { closing } (out of reach — the
// due swing holds and fires on return to reach, Stage 12's rule),
// { refused } (no arrows / no runes — timer untouched), or the
// swing result. PKers never queue specials.
function wildResolveSwing(pair, attRef) {
  const defRef = pairOtherRef(pair, attRef);
  const A = combatant(attRef);
  const D = combatant(defRef);
  if (!A || !D) return null;
  const style = attackStyleOf(A.profile);
  const dist = Math.hypot(A.x - D.x, A.y - D.y);
  if (dist > styleRange(style)) return { closing: true, style };
  const useSpec = A.isPlayer ? !!pair.spec[attRef] : false;
  const res = rollStyleAttack(A.profile, D.profile, useSpec, null, true);
  if (res.refused) return { refused: res.refused, style: res.style || style };
  pair.spec[attRef] = false;
  if (useSpec) A.profile.specialEnergy = Math.max(0, A.profile.specialEnergy - SPECIAL_COST);
  pair.next[attRef] = wildTickCount + weaponSwingTicks(A.profile);
  pair.lastAction = wildTickCount;
  const total = res.dmg + (res.bonusDmg || 0);
  D.setHp(Math.max(0, D.hp() - total));
  if (res.deflected) A.setHp(Math.max(0, A.hp() - res.deflected));
  if (A.isPlayer) {
    addXp(A.key, swingXpGains(A.profile.style, res.style, total, res.spell));
    if (total > 0) A.profile.specialEnergy = Math.min(100, A.profile.specialEnergy + SPECIAL_CHARGE_PER_HIT);
  }
  // Hex Hanna's teleblock: a CONNECTED cast on a player whose
  // Deflect Magic is off blocks their teleports for 12s.
  let teleblocked = false;
  if (!A.isPlayer && A.pker.def.teleblock && D.isPlayer && res.style === 'magic' && res.connected
      && D.profile.activePrayer !== 'magic' && Date.now() >= (D.sess.teleblockUntil || 0)) {
    D.sess.teleblockUntil = Date.now() + TELEBLOCK_MS;
    teleblocked = true;
  }
  return { swung: true, style: res.style, dmg: res.dmg, bonus: res.bonusDmg || 0, deflected: res.deflected || 0, outcome: res.outcome, special: useSpec, notes: res.notes || [], teleblocked };
}
function sendWildTick(pair) {
  for (const ref of [pair.a, pair.b]) {
    const C = combatant(ref);
    if (!C || !C.isPlayer) continue;
    const oppRef = pairOtherRef(pair, ref);
    const O = combatant(oppRef);
    if (!O) continue;
    const mine = pair.tickRes[ref];
    const theirs = pair.tickRes[oppRef];
    const notes = [...((pair.notes && pair.notes[ref]) || [])];
    if (mine && mine.notes) notes.push(...mine.notes);
    if (theirs && theirs.notes && theirs.notes.length) notes.push(`Opponent: ${theirs.notes.join(' ')}`);
    if (theirs && theirs.teleblocked) notes.push('🌀 Teleblocked! You cannot teleport for 12 seconds.');
    send(C.sess.ws, {
      type: 'wild_fight', phase: 'tick',
      oppKind: O.isPlayer ? 'player' : 'pker', oppId: O.isPlayer ? O.name : O.id, oppName: O.name,
      hpYou: C.hp(), maxHpYou: C.maxHp(), hpOpp: Math.max(0, O.hp()), maxHpOpp: O.maxHp(),
      youHit: mine && mine.swung ? mine.dmg : null, oppHit: theirs && theirs.swung ? theirs.dmg : null,
      youOutcome: mine && mine.swung ? mine.outcome : null, oppOutcome: theirs && theirs.swung ? theirs.outcome : null,
      youBonus: mine && mine.swung ? mine.bonus : null, oppBonus: theirs && theirs.swung ? theirs.bonus : null,
      youDeflected: mine && mine.swung ? mine.deflected : null, oppDeflected: theirs && theirs.swung ? theirs.deflected : null,
      youSpecial: mine && mine.swung ? !!mine.special : false, oppSpecial: theirs && theirs.swung ? !!theirs.special : false,
      energyYou: C.profile.specialEnergy,
      closing: mine && mine.closing ? true : undefined,
      moveTo: mine && mine.closing ? approachPoint(C.x, C.y, O.x, O.y) : undefined,
      note: notes.length ? notes.join(' ') : undefined,
      oppFrozenUntil: O.frozenUntil() > Date.now() ? O.frozenUntil() : 0,
      wildLevel: wildLevelAt(C.y), skulled: !!C.sess.skulled,
      teleblockLeft: Math.max(0, Math.ceil(((C.sess.teleblockUntil || 0) - Date.now()) / 1000)),
    });
  }
}
// The wild loop: PKer AI + pair swings + per-area state, on the
// game's 0.6s tick. PKers move server-side (open field — scenery
// never blocks, so no stuck states); players move client-side and
// the pair tick's closing/moveTo walks them in, exactly like duels.
setInterval(() => {
  wildTickCount++;
  const now = Date.now();
  // --- PKer respawns ---
  for (const pk of pkers.values()) {
    if (!pk.alive && pk.respawnAt && now >= pk.respawnAt) {
      pk.alive = true;
      pk.hp = pk.maxHp;
      pk.x = pk.homeX + randiRange(-30, 30);
      pk.y = pk.homeY + randiRange(-30, 30);
      pk.food = pk.area === 'purewild' ? 0 : pk.foodMax;
      pk.fleeing = false;
      pk.targetKey = null;
      pk.aggroPlayers.clear();
      pk.profile.activePrayer = null;
      broadcastWildState(pk.area);
    }
  }
  // --- PKer AI ---
  for (const pk of pkers.values()) {
    if (!pk.alive) continue;
    const pkRef = wildRefPker(pk.id);
    // Fleeing: no food and nearly dead — run for the ditch. Its
    // fights end (the quarry escaped) and crossing out despawns it
    // until the respawn timer, keeping its loot and life (the app).
    if (pk.fleeing) {
      if ((pk.frozenUntil || 0) <= now) stepToward(pk, pk.x, 895, APPROACH_STEP);
      if (pk.y >= WILD_DITCH_Y - 2) {
        pk.alive = false;
        pk.respawnAt = now + PKER_RESPAWN_MS;
        pk.fleeing = false;
        for (const pr of wildPairsOf(pkRef)) endWildPair(pr, { [pkRef]: 'gone', [pairOtherRef(pr, pkRef)]: 'escaped' });
        const tSess = pk.targetKey ? online.get(pk.targetKey) : null;
        if (tSess) send(tSess.ws, { type: 'chat', from: 'Game', text: `🏃 ${pk.name} fled across the ditch and escaped — no loot this time.` });
        pk.targetKey = null;
        broadcastWildState(pk.area);
      }
      continue;
    }
    if (pk.hp <= Math.max(1, Math.floor(pk.maxHp * 0.22)) && pk.food <= 0 && wildPairsOf(pkRef).length) { pk.fleeing = true; for (const pair of wildPairsOf(pkRef)) endWildPair(pair, { [pkRef]: 'gone', [pairOtherRef(pair, pkRef)]: 'escaped' }); continue; }
    // Target validation.
    let tgt = pk.targetKey ? online.get(pk.targetKey) : null;
    if (tgt && (tgt.area !== pk.area || !isWildArea(tgt.area))) { pk.targetKey = null; tgt = null; }
    if (!tgt) {
      // Acquire: nearest in-bracket player in this area. Shallow
      // wild protects a player already in a fight from being piled.
      let best = null, bestD = 820;
      for (const [k, s] of online.entries()) {
        if (s.area !== pk.area) continue;
        if (Math.abs(pk.cbt - combatLevelOf(levelsOf(s.profile))) > wildLevelAt(pk.y)) continue;
        if (wildLevelAt(s.y) < 20 && s.wildPairs && s.wildPairs.size) continue;
        const d = Math.hypot(s.x - pk.x, s.y - pk.y);
        if (d < bestD) { best = { key: k, sess: s }; bestD = d; }
      }
      if (best) {
        pk.targetKey = best.key;
        pk.lastTargetName = best.sess.profile.username;
        pk.aggroPlayers.add(best.key);
        const pair = createWildPair(pk.area, pkRef, wildRefPlayer(best.key), pkRef);
        engageWild(pair, pkRef);
        send(best.sess.ws, { type: 'chat', from: pk.name, text: pk.def.greet });
        tgt = best.sess;
      }
    }
    if (tgt) {
      // Eat at <= 45% HP (never in Pure Wild — food is 0 there).
      if (pk.area !== 'purewild' && pk.food > 0 && pk.hp <= Math.floor(pk.maxHp * 0.45) && wildTickCount >= pk.eatNextTick) {
        pk.food--;
        pk.hp = Math.min(pk.maxHp, pk.hp + 8);
        pk.eatNextTick = wildTickCount + 4;
        const pair = wildPairBetween(pkRef, wildRefPlayer(pk.targetKey));
        if (pair) { pair.notes = pair.notes || {}; (pair.notes[wildRefPlayer(pk.targetKey)] = pair.notes[wildRefPlayer(pk.targetKey)] || []).push(`${pk.name} eats a ration (+8 HP).`); }
      }
      // Prayer flick: counter the target's attack style with the
      // matching Deflect (PvP rule) — never in Pure Wild.
      pk.profile.activePrayer = pk.area === 'purewild' ? null : (PRAYER_FOR_ATTACK_STYLE[attackStyleOf(tgt.profile)] || null);
      // A pair the PLAYER opened (attack order or cast) with this
      // PKer as its target: the PKer answers by engaging it.
      const answerPair = wildPairBetween(pkRef, wildRefPlayer(pk.targetKey));
      if (answerPair && !answerPair.eng[pkRef]) engageWild(answerPair, pkRef);
      // Chase: face + close until inside weapon reach (swings are
      // resolved in the pair pass; a due swing holds out of reach).
      if ((pk.frozenUntil || 0) <= now) {
        const range = styleRange(attackStyleOf(pk.profile));
        if (Math.hypot(tgt.x - pk.x, tgt.y - pk.y) > range * 0.85) stepToward(pk, tgt.x, tgt.y, APPROACH_STEP);
      }
      if (Math.hypot(tgt.x - pk.x, tgt.y - pk.y) > 900) pk.targetKey = null; // gave up the chase
    } else {
      // Wander near home.
      if (wildTickCount >= pk.wanderNextTick) {
        pk.wanderNextTick = wildTickCount + randiRange(3, 7);
        pk.wanderX = clamp(pk.homeX + randiRange(-140, 140), 30, 1570);
        pk.wanderY = clamp(pk.homeY + randiRange(-90, 90), 30, 860);
      }
      if ((pk.frozenUntil || 0) <= now && Math.hypot(pk.wanderX - pk.x, pk.wanderY - pk.y) > 12) stepToward(pk, pk.wanderX, pk.wanderY, 20);
    }
  }
  // --- pair swings ---
  for (const pair of [...wildFights.values()]) {
    if (pair.done) continue;
    // A PKer that left the world (fled across the ditch) takes its
    // fights with it — nobody keeps swinging at a ghost.
    const aPk = pair.a[0] === 'n' ? pkers.get(pair.a.slice(2)) : null;
    const bPk = pair.b[0] === 'n' ? pkers.get(pair.b.slice(2)) : null;
    if ((aPk && !aPk.alive) || (bPk && !bPk.alive)) { endWildPair(pair, { [pair.a]: 'escaped', [pair.b]: 'escaped' }); continue; }
    pair.tickRes = {};
    pair.notes = pair.notes || {};
    let anySwing = false;
    for (const ref of [pair.a, pair.b]) {
      if (!pair.eng[ref] || wildTickCount < (pair.next[ref] || 0)) continue;
      const C = combatant(ref);
      const O = combatant(pairOtherRef(pair, ref));
      if (!C || !O) continue;
      // Target lock (Stage 12's rule, extended): a combatant
      // swings only in the pair matching its current target.
      if (C.isPlayer && C.sess.wildTarget && C.sess.wildTarget !== pairOtherRef(pair, ref)) continue;
      if (!C.isPlayer && C.pker.targetKey && wildRefPlayer(C.pker.targetKey) !== pairOtherRef(pair, ref)) continue;
      const res = wildResolveSwing(pair, ref);
      if (!res) continue;
      if (res.refused) {
        if (wildTickCount - (pair.lastRefuse[ref] || -99) >= 8) {
          pair.lastRefuse[ref] = wildTickCount;
          pair.notes[ref] = pair.notes[ref] || [];
          pair.notes[ref].push(res.refused);
        }
        continue;
      }
      pair.tickRes[ref] = res;
      if (res.swung) anySwing = true;
    }
    // Deaths (a double kill on one tick drops both, like the app's
    // mutual-kill edge; deflect bounces can kill the attacker).
    const aC = combatant(pair.a);
    const bC = combatant(pair.b);
    const deadA = aC && aC.hp() <= 0;
    const deadB = bC && bC.hp() <= 0;
    if (deadA || deadB) {
      if (deadA && deadB) {
        endWildPair(pair, { [pair.a]: 'death', [pair.b]: 'death' });
        if (aC.isPlayer) wildDeath(aC.key, bC.name, { skipPairEnd: true }); else pkerDeath(aC.pker, bC.isPlayer ? bC.key : null);
        if (bC.isPlayer) wildDeath(bC.key, aC.name, { skipPairEnd: true }); else pkerDeath(bC.pker, aC.isPlayer ? aC.key : null);
      } else {
        const dead = deadA ? aC : bC;
        const killer = deadA ? bC : aC;
        if (dead.isPlayer) wildDeath(dead.key, killer ? killer.name : null);
        else pkerDeath(dead.pker, killer && killer.isPlayer ? killer.key : null);
      }
      continue;
    }
    sendWildTick(pair);
    pair.notes = {}; // consumed by the tick send (eat notes, refusal notes)
    // Idle break-off: 60s with no swing attempt while out of
    // reach of each other ends the fight (nobody is trapped).
    if (!anySwing && wildTickCount - pair.lastAction > WILD_PAIR_IDLE_TICKS) {
      const aC2 = combatant(pair.a);
      const bC2 = combatant(pair.b);
      if (aC2 && bC2 && Math.hypot(aC2.x - bC2.x, aC2.y - bC2.y) > NPC_RANGE) {
        endWildPair(pair, { [pair.a]: 'gone', [pair.b]: 'gone' });
        for (const C of [aC2, bC2]) if (C.isPlayer) send(C.sess.ws, { type: 'chat', from: 'Game', text: 'The fight broke off — you lost each other in the Wilderness.' });
      }
    }
  }
  // --- per-area wild state (levels, skulls, teleblock timers, PKer positions) ---
  for (const area of WILD_AREAS) {
    let any = false;
    for (const p of online.values()) if (p.area === area) { any = true; break; }
    if (any) broadcastWildState(area);
  }
}, TICK_MS);

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
    if (isWildArea(sess.area)) continue; // Stage 30: guardians never follow into the Wilderness — they wait (and resume when the owner returns)
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
  raw_beef: { cooked: 'cooked_beef', xp: 50 }, // Farm life: between shrimps and trout, like its heal (12)
};
// Farm life: burying bones. One farm-animal bone = 5 Prayer XP
// (a beginner drip — a fresh account needs ~13 bones per early
// level; the Dragon bones Exchange good is NOT buryable, it is a
// trade good). Only `animal_bones` buries (see the 'bury' handler).
const BURY_XP = { animal_bones: 5 };
// Crafting chain: the spinning wheel stands at the east end of
// the farm crop rows (plaza). Spinning is a wheel-side action,
// like cooking is a fire-side one: you must be in the plaza
// within SPIN_RANGE of it. SPIN_XP is the Crafting XP per ball
// of yarn (flagged choice).
const SPIN_WHEEL_POS = { x: 728, y: 727 };
const SPIN_RANGE = 150;
const SPIN_XP = 8;
// Tree Guardian maker chain (Derek, 2026-11-24): the geography in
// one place — there is ONE furnace in the world, the Emberfall
// furnace (client prop at world (62,26) = server (1420,710)), and
// it is where glass is worked, WITH your Tree Guardian standing
// beside you (the guardian is the maker; the furnace is his
// workplace as much as the smiths'). Potion mixing needs only the
// guardian — he carries that bench with him. Crafting XP per step,
// in line with the amulet chain's scale (spin 8 / string 6 /
// amulet 20+): melting is the skilled step, blowing is quick
// handwork, mixing pays by the potion's worth.
const FURNACE_POS = { x: 1420, y: 710 };
const FURNACE_RANGE = 150;
const GLASS_MAKE_XP = 10;
const GLASS_BLOW_XP = { vial: 8, lantern: 12 };
const MIX_POTION_XP = { herbs: 12, snapdragon: 14 }; // ranarr -> Prayer potion, snapdragon -> Restore potion
const MIX_POTION_OUT = { herbs: 'prayer_potion', snapdragon: 'restore_potion' };
const LANTERN_MAX_PER_PLAYER = 12; // guardian-made lanterns one player may have standing in the world
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

// Pricing stage: the Gold Exchange's old 6s random walk is GONE —
// demand (with the shop engine above) is now the only thing that
// moves prices. One tick per DEMAND_TICK_MS: pending flow is
// applied (capped), every score decays toward 0, each Exchange
// price steps at most ~1% of base toward its demand target
// (clamped to the good's own min/max band), and any counter whose
// prices actually changed is re-broadcast so open panels update.
setInterval(() => {
  if (DEMAND_OFF) return;
  const sigBefore = JSON.stringify(catalogList().map((e) => [e.buy, e.sell])) + '|' + JSON.stringify(goodsList().map((g) => g.price));
  const applyFlow = (scoreMap, flowMap) => {
    for (const id of Object.keys(flowMap)) {
      const move = Math.max(-DEMAND_MAX_MOVE, Math.min(DEMAND_MAX_MOVE, flowMap[id]));
      if (move) scoreMap[id] = Math.max(DEMAND_MIN_SCORE, Math.min(DEMAND_MAX_SCORE, (scoreMap[id] || 0) + move));
      delete flowMap[id];
    }
  };
  // Decay BEFORE applying the window's flow, so the score band
  // is a true cap (steady state under max pressure is the cap
  // itself, not the cap minus one decay step).
  for (const map of [demandScore, exDemandScore]) {
    for (const id of Object.keys(map)) {
      map[id] *= DEMAND_DECAY;
      if (Math.abs(map[id]) < 0.01) delete map[id];
    }
  }
  applyFlow(demandScore, demandFlow);
  applyFlow(exDemandScore, exDemandFlow);
  for (const g of GOODS) {
    const target = Math.max(g.min, Math.min(g.max, Math.round(g.base * (1 + (exDemandScore[g.id] || 0) / 100))));
    const step = Math.max(1, Math.round(g.base * 0.01));
    const cur = exchangePrices[g.id];
    if (cur < target) exchangePrices[g.id] = Math.min(target, cur + step);
    else if (cur > target) exchangePrices[g.id] = Math.max(target, cur - step);
  }
  const after = catalogList();
  const sigAfter = JSON.stringify(after.map((e) => [e.buy, e.sell])) + '|' + JSON.stringify(goodsList().map((g) => g.price));
  if (sigAfter !== sigBefore) {
    broadcast({ type: 'catalog', items: after, shops: SHOPS });
    broadcast({ type: 'exchange_prices', goods: goodsList() });
  }
}, DEMAND_TICK_MS);

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


// ---------- Stage 31: reconnect restore ----------
// Playtest finding: the connection still drops occasionally, and
// every auto-reconnect used to respawn the player in the PLAZA,
// breaking whatever they were doing (a Barrows trip, gathering at
// the cove, an open route). So when a session ends, its spot is
// remembered here (in-memory, like the sessions themselves — a
// server restart already resets every session) and a return within
// RESTORE_TTL_MS lands back in that area at that position. The
// game has no deliberate-logout signal (no logout message exists),
// so the restore applies to any return inside the TTL — with hard
// exclusions for states the disconnect itself settled:
//   - a duel / mod duel the disconnect FORFEITED (arena is never
//     restored; the loser wakes in the plaza, as the forfeit says);
//   - a Fight Caves run the disconnect ENDED (the run is gone —
//     restoring "into the run" would be a lie; plaza instead);
//   - the Wilderness / Pure Wild (a wild-fight disconnect is a
//     death with drops, and even a peaceful wild session carries
//     session-only skull / teleblock / HP-pool state that is never
//     saved — the plaza is the only honest landing);
//   - the Waiting Area (its stake match was cancelled on the way
//     out) and the duel arena.
// Barrows crypts and tunnels DO restore: the run state lives on
// the profile (kills, tunnel, solved puzzle), and the session
// scratch that matters (which crypt, the tunnel HP pool, the
// puzzle-door ambush roll, the brothers' stat drains) is carried
// in the spot. An NPC fight interrupted by the drop does not
// restore the FIGHT (cleanup ends it, the creature keeps its HP)
// — just the player's place in the area.
const RESTORE_TTL_MS = 10 * 60 * 1000;
const savedSpots = new Map(); // account key -> { area, x, y, barrowsCrypt, barrowsHp, barrowsDoorRolled, accDrain, strDrain, runDrainedUntil, at }
function rememberSpot(key, me) {
  savedSpots.delete(key);
  if (!me || !AREAS[me.area]) return;
  if (me.duelId || me.modDuelId) return; // forfeited by the disconnect
  if (me.fcRunId) return; // the run ended with the disconnect
  if (isWildArea(me.area)) return; // wild state is session-only
  if (me.area === 'arena' || me.area === 'waiting') return; // duel / stake-match ground
  savedSpots.set(key, {
    area: me.area, x: me.x, y: me.y,
    barrowsCrypt: me.barrowsCrypt || null,
    barrowsHp: (typeof me.barrowsHp === 'number') ? me.barrowsHp : null,
    barrowsDoorRolled: !!me.barrowsDoorRolled,
    accDrain: me.accDrain || 0, strDrain: me.strDrain || 0, runDrainedUntil: me.runDrainedUntil || 0,
    at: Date.now(),
  });
}

// Full disconnect cleanup for one account: settles any duel/fight
// the session was in (forfeit rules), cancels its challenges,
// stake offers/matches, fight offers, cert/note requests, party
// and trade, removes its Tree Guardian, then drops the session and
// tells the world. Shared by the socket close handler and by
// session takeover (a fresh sign-in replacing a zombie session).
function cleanupDisconnect(key) {
  const user = db.users[key];
  if (!user) return;
  const profile = user.profile;
  const me = online.get(key);
  if (me) rememberSpot(key, me); // Stage 31: capture the spot BEFORE any settlement moves the player
  // Stage 30: disconnecting (or being replaced by a fresher
  // session) while in a wild fight is a DEATH in the wild, drops
  // and all — the online reading of the app's combat-logout
  // danger. In the wild but not fighting: nothing to settle (the
  // skull was never saved, so it simply never existed).
  if (me && me.wildPairs && me.wildPairs.size) wildDeath(key, null, { disconnect: true });
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
  // Stage 34: pending challenges involving the leaver SURVIVE the
  // disconnect (Stage 7C deleted them here). A challenge lives at
  // most ~30s and every negotiation action refreshes that clock;
  // a brief drop used to silently kill the other player's open
  // answer panel mid-countdown. Now the challenge simply stays
  // until it expires on its own (the lazy expiry checks in the
  // challenge handlers clear it then), and the connection handler
  // re-pushes it to the leaver when they reconnect in time. A
  // STARTED duel is different — it was settled above as a forfeit,
  // exactly as before.
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
  // View Live (2026-11-23): anyone watching the leaver gets their
  // view ended cleanly ("📺 X logged out — back to your own view.")
  // and their own area restored.
  for (const [wk, w] of [...online]) if (w.spectateKey === key) endSpectate(wk, 'logout');
  online.delete(key);
  broadcast({ type: 'chat', from: 'Game', text: `${profile.username} left the plaza.` });
  broadcastState();
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const key = tokens.get(token);
  if (!key) { ws.close(4001, 'bad token'); return; }
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // Stage 34: a socket 'error' with no listener throws and would
  // crash the process for every player — log it and let the close
  // handler do the cleanup.
  ws.on('error', (e) => { console.error('socket error for', key, e && e.message); });
  // Session takeover: if this account still has a session it is a
  // leftover — a phone whose socket died without the server seeing
  // a close frame (a locked screen, a dropped network). Before the
  // heartbeat existed such zombies could linger for hours while the
  // real player was told "Already signed in somewhere else" and
  // locked out of the world and chat entirely. Run the old
  // session's disconnect cleanup, then replace its socket; the old
  // socket's own close event is ignored via the replaced flag.
  const stale = online.get(key);
  if (stale) {
    stale.replaced = true;
    cleanupDisconnect(key);
    try { stale.ws.terminate(); } catch {}
  }
  const profile = db.users[key].profile;
  ensureV2(profile);
  // Stage 31: reconnect restore — a spot remembered by
  // cleanupDisconnect (possibly by the takeover cleanup a few lines
  // above) puts the player back in their area at their position
  // instead of the plaza, when it's fresh. Everything else about
  // login is unchanged: a first login, a stale spot, and every
  // excluded state still land in the plaza scatter.
  const spot = savedSpots.get(key); savedSpots.delete(key);
  const restore = (spot && Date.now() - spot.at <= RESTORE_TTL_MS) ? spot : null;
  // Everyone logs into the plaza (area is session-only, never saved).
  // Stage 13: the login scatter is the old 100..600 x 100..350 box x2.
  online.set(key, { ws, profile, x: restore ? Math.max(0, Math.min(WORLD_W, restore.x)) : 200 + Math.random() * 1000, y: restore ? Math.max(0, Math.min(WORLD_H, restore.y)) : 200 + Math.random() * 500, area: restore ? restore.area : 'plaza', duelId: null, modDuelId: null, npcFightId: null, fcRunId: null, lastActionAt: 0, smithing: null, lastSmithHitAt: 0, lastReheatAt: 0, barrowsFightId: null, barrowsPuzzle: null, barrowsPuzzleShown: false, barrowsCrypt: restore ? restore.barrowsCrypt : null, barrowsHp: restore ? restore.barrowsHp : null, barrowsDoorRolled: restore ? restore.barrowsDoorRolled : false, accDrain: restore ? restore.accDrain : 0, strDrain: restore ? restore.strDrain : 0, runDrainedUntil: restore ? restore.runDrainedUntil : 0, actSkill: null, actAt: 0, castReadyAt: 0, frozenUntil: 0, wildPairs: null, wildTarget: null, skulled: false, teleblockUntil: 0, wildHp: null, wildMaxHp: 0 }); // Stage 30: wild* = Wilderness session state (skull, teleblock, wild HP pool) — session-only, never saved // Stage 24: castReadyAt = placed-button cast cooldown; frozenUntil = Freeze root expiry. Stage 28: barrowsCrypt = which brother's crypt the player is in; barrowsHp = the tunnel HP pool; accDrain/strDrain/runDrainedUntil = the app's brother drains
  const sess = online.get(key);
  send(ws, { type: 'welcome', profile: publicProfile(profile), players: playersSnapshot(sess.area), area: sess.area });
  if (sess.area === 'plaza') {
    send(ws, modNpcsMsg()); // Stage 22: the three plaza moderators + their busy flags
    send(ws, modLadderMsg(profile)); // Stage 22: stake-ladder progress
  }
  pushFriends(key, true); // Friends list (2026-11-23): the login push — first state, no online-notes for it
  // Stage 31: a restored session gets the same per-area state push
  // a travel would send (NPC roster, nodes, fires, seaweed, the
  // saved Barrows run) so the area is fully live on arrival.
  if (restore) {
    if (NPC_AREAS.includes(sess.area)) send(ws, npcStateMsg(sess.area));
    send(ws, nodesMsg(sess.area));
    send(ws, firesMsg(sess.area));
    send(ws, seaweedMsg(sess.area)); // Stage 29: cove clumps
    send(ws, sandMsg(sess.area)); // Tree Guardian chain: cove sand piles
    if (sess.area === 'barrows' || sess.area === 'barrows_tunnels' || sess.area === 'barrows_crypt') send(ws, barrowsStateMsg(sess));
    send(ws, { type: 'chat', from: 'Game', text: `🔄 Reconnected — you're back where you left off: ${AREAS[sess.area].name}.` });
  }
  // Stage 34: a pending duel challenge that survived this player's
  // drop (see cleanupDisconnect) is re-pushed, so their answer /
  // negotiation panel comes back with the remaining seconds instead
  // of having silently vanished mid-countdown.
  for (const ch of challenges.values()) {
    if (ch.from !== key && ch.to !== key) continue;
    if (ch.expires < Date.now()) {
      // Feel-fixes: a challenge that lapsed WHILE this player was
      // dropped is not dead — if it expired recently (within
      // CHALLENGE_REVIVE_MS) and the other duelist is still online,
      // it is revived once with a fresh full window and re-offered
      // below, so an answer after a connection blink still lands.
      // Anything older, or with the other side gone, clears as before.
      const otherKey = ch.from === key ? ch.to : ch.from;
      if (Date.now() - ch.expires <= CHALLENGE_REVIVE_MS && online.has(otherKey)) {
        ch.expires = Date.now() + CHALLENGE_WINDOW_MS;
        pushChallengeTerms(ch); // the other side's screen refreshes to the new window too
        send(ws, { type: 'chat', from: 'Game', text: '🔄 That duel challenge was still waiting for you — it has a fresh 60 seconds.' });
      } else { challenges.delete(ch.id); broadcastChallengeClear(ch.from); continue; }
    }
    send(ws, challengeTermsMsg(ch, key));
    if (ch.to === key) {
      const fromU = db.users[ch.from];
      send(ws, { type: 'challenge_incoming', challengeId: ch.id, from: fromU ? fromU.profile.username : ch.from, stake: ch.stake, items: ch.items, rules: ch.rules, freePlay: ch.freePlay, seconds: Math.max(1, Math.ceil((ch.expires - Date.now()) / 1000)), h2h: h2hVs(profile, fromU ? fromU.profile.username : '') });
    }
  }
  send(ws, pilesMsg(sess.area)); // Stage 5: any drop piles waiting in the area
  send(ws, alliesMsg(sess.area)); // Stage 6: any Tree Guardians standing in the area
  send(ws, objectsMsg(sess.area)); // Stage 7D: any placed objects in the area
  send(ws, { type: 'catalog', items: catalogList(), shops: SHOPS, spells: SPELLS });
  send(ws, starterMsg(profile)); // Stage 20: starter-goal state
  send(ws, questsMsg(profile)); // Runecrafting + first quest (2026-11-24): quest log state
  send(ws, clogMsg(profile)); // Stage 20: collection-log state
  send(ws, { type: 'exchange_prices', goods: goodsList() });
  send(ws, stakeBoardMsg()); // Stage 17: the current Stake Board offers
  broadcast({ type: 'chat', from: 'Game', text: restore ? `${profile.username} reconnected.` : `${profile.username} entered the plaza.` }, key);
  broadcastState();

  ws.on('message', (raw) => {
    // Stage 34: one malformed or unlucky message must never crash
    // the process (dropping EVERY player and every session token
    // with it) — log the failure and keep the world running.
    try { handleMessage(raw); } catch (e) { console.error('message handler error for', key, e); }
  });
  function handleMessage(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return; // Stage 35: 'null' / scalar frames used to throw on m.type below
    const me = online.get(key); if (!me) return;
    // Stage 34: application-level keepalive. 'pong' is the reply to
    // the server's data-frame ping; 'ping' gets a 'pong' back. Both
    // exist so real data traffic flows in both directions at least
    // every heartbeat, whatever the proxies in between count.
    if (m.type === 'pong') return;
    if (m.type === 'ping') { send(ws, { type: 'pong' }); return; }
    // View Live (2026-11-23): while the owner is spectating, their
    // inputs are locked SERVER-SIDE — movement and every action are
    // dropped here, before any handler can see them; only spectate
    // control, chat/whisper and read-only queries pass (see
    // SPEC_ALLOW_WHILE_WATCHING). The owner's character stands
    // untouched in its own area for the whole watch.
    if (me.spectateKey && !SPEC_ALLOW_WHILE_WATCHING.has(m.type)) return;
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
      // Week 2 (B5): the puzzle door PRESENTS its puzzle. The app
      // opens the puzzle automatically when the player walks up to
      // the door; the online port never wired that trigger — the
      // puzzle only appeared if the player found the Barrows bar's
      // 🧩 button or tapped the door's exact 3D spot, so live
      // players reached the (client-collision) door with no UI and
      // no way through. Now: standing in corridor B on the door's
      // south side with the run's puzzle unsolved pushes the dealt
      // puzzle (the client opens its modal on this message). The
      // flag re-arms when the player walks away, so closing the
      // modal and stepping back re-presents the SAME puzzle.
      if (me.area === 'barrows_tunnels' && !profile.barrows.puzzleSolved) {
        const nearDoor = me.x > TUNNEL_DOOR.x0 && me.x < TUNNEL_DOOR.x1 && me.y > TUNNEL_DOOR.y1 && me.y < TUNNEL_DOOR.y1 + 110;
        if (nearDoor && !me.barrowsPuzzleShown) {
          me.barrowsPuzzleShown = true;
          if (!me.barrowsPuzzle) newBarrowsPuzzle(me);
          send(ws, { type: 'barrows_puzzle', shown: [...me.barrowsPuzzle.shown, '❓'], options: me.barrowsPuzzle.options });
        } else if (!nearDoor) {
          me.barrowsPuzzleShown = false;
        }
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
      // NPC build: nearby NPC players may answer (free talk), and
      // a help-seeking question routes to the ask-and-learn path.
      if (text) { try { onPlayerChat(key, me, text); } catch (e) { /* talk never breaks chat */ } }
    }
    // NPC build: the Guided path toggle (client sends it at login
    // and on change) and the keeper modal's Ask button.
    if (m.type === 'set_guided') {
      profile.guidedPath = m.on !== false;
      save(key);
    }
    if (m.type === 'ask_guide') {
      const now = Date.now();
      if (now - (me.lastGuideAskAt || 0) >= GUIDE_ASK_COOLDOWN_MS) {
        me.lastGuideAskAt = now;
        let src = null;
        if (m.who === 'guardian') {
          const ally = allies.get(key);
          if (ally && ally.area === me.area && ally.hp > 0) src = { kind: 'guardian' };
        } else {
          const keeper = GUIDE_KEEPERS.find((k) => k.id === String(m.who || ''));
          if (keeper && keeper.area === me.area && Math.hypot(keeper.x - me.x, keeper.y - me.y) <= 380) src = { kind: 'keeper', keeper };
        }
        if (src) {
          const ans = guideAnswerFor(key, me, src);
          send(ws, { type: 'guide_answer', who: String(m.who || ''), name: ans.who, text: ans.text });
        } else {
          send(ws, { type: 'guide_answer', who: String(m.who || ''), name: '', text: 'Step a little closer and ask again.' });
        }
      }
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

    // ----- View Live spectate (owner only, 2026-11-23) -----
    // Derek: "Nally can view players live game at anytime." The
    // owner — and ONLY the owner (effectiveRole 'owner'; mods,
    // regular admins and the assistant's admin floor are refused
    // here regardless of what any client shows) — watches any
    // online player's live game, human or NPC bot, without moving
    // their own character or disturbing the target. Starting a
    // watch while already watching switches targets. The owner
    // must not be mid-fight themselves (same family of guards as
    // admin_goto); the target may be doing anything at all —
    // duelling in the arena, down in the Barrows, mid-Fight-Caves
    // run — the mirror follows (see the View Live block above).
    if (m.type === 'spectate_start') {
      if (!isOwner(profile)) return send(ws, { type: 'error', message: '📺 View Live is the owner\'s tool only.' });
      const targetKey = userKeyFor(m.target);
      const targetName = String(m.target || '').trim();
      if (targetKey === key) return send(ws, { type: 'error', message: 'That is you — pick another player.' });
      const target = online.get(targetKey);
      if (!target) return send(ws, { type: 'error', message: `${targetName} is not online.` });
      if (me.duelId || me.modDuelId || me.npcFightId || me.barrowsFightId || me.fcRunId || (me.wildPairs && me.wildPairs.size)) {
        return send(ws, { type: 'error', message: 'You are in a fight — finish or leave it before watching.' });
      }
      me.spectateKey = targetKey; me.spectateName = target.profile.username; me.spectateArea = null;
      specSceneBundle(me, target);
      send(ws, { type: 'chat', from: 'Game', text: `📺 You are now watching ${target.profile.username} live. Your own character stays where it stands.` });
      return;
    }
    if (m.type === 'spectate_stop') {
      if (!isOwner(profile)) return send(ws, { type: 'error', message: '📺 View Live is the owner\'s tool only.' });
      if (!me.spectateKey) return send(ws, { type: 'error', message: 'You are not watching anyone.' });
      endSpectate(key, 'stop');
      return;
    }

    // ----- Travel between areas (Stage 1) -----
    // The server just validates the destination; the client gates this
    // behind walking to the gates / its teleport menu.
    // Stage 37 (Addition #3): admin "Go to" — an admin/owner
    // teleports to any online player's side. NOT a travel: the
    // destination is wherever the target is standing, reached
    // with the same per-area state push a travel sends. Mods may
    // NOT use it (Derek: "admin"), and the server enforces that
    // here regardless of what any client chooses to show.
    if (m.type === 'admin_goto') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'Only admins can use Go to.' });
      const targetKey = userKeyFor(m.to);
      const targetName = String(m.to || '').trim();
      if (targetKey === key) return send(ws, { type: 'error', message: 'That is you — pick another player.' });
      const target = online.get(targetKey);
      if (!target) return send(ws, { type: 'error', message: `${targetName} is not online.` });
      // The admin must not be mid-anything: the same family of
      // guards as travel, but stricter — a fight is finished or
      // left first, never silently abandoned by a teleport.
      if (me.duelId || me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel — finish or leave it first.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You are in the Fight Caves — finish or leave the run first.' });
      if (me.npcFightId || me.barrowsFightId) return send(ws, { type: 'error', message: 'You are in a fight — finish or leave it first.' });
      if (me.wildPairs && me.wildPairs.size) return send(ws, { type: 'error', message: 'You are in a Wilderness fight — finish or leave it first.' });
      if (stakeMatchForKey(key)) return send(ws, { type: 'error', message: 'You have a stake match waiting — ready up or cancel it at the Stake Board.' });
      // The target must not be inside an instanced fight: there
      // is no shared "beside them" inside a duel arena, the
      // Waiting Area, a Fight Caves run, or another player's own
      // Barrows crypt/tunnels instance.
      if (target.duelId || target.modDuelId || target.area === 'arena' || target.area === 'waiting' || target.fcRunId || target.area === 'fightcaves') {
        return send(ws, { type: 'error', message: `${target.profile.username} is in a fight right now.` });
      }
      if (target.area === 'barrows_crypt' || target.area === 'barrows_tunnels') {
        return send(ws, { type: 'error', message: `${target.profile.username} is down in the Barrows tunnels right now.` });
      }
      const toArea = target.area;
      const fromArea = me.area;
      const toWild = isWildArea(toArea);
      // Land a few units beside the target, clamped to the world.
      const gx = Math.max(0, Math.min(WORLD_W, target.x + (target.x + 48 <= WORLD_W ? 48 : -48)));
      const gy = Math.max(0, Math.min(WORLD_H, target.y));
      // Wilderness transitions mirror travel: leaving the wild
      // (or switching variants) cleans the wild state up, and
      // entering it cancels pendings first. Arriving IN the wild
      // is allowed — the admin lands under wild rules, exactly
      // like anyone else standing there, with a fresh HP pool.
      if (isWildArea(fromArea) && fromArea !== toArea) exitWildCleanup(key);
      if (!isWildArea(fromArea) && toWild) cancelWildPendings(key);
      me.area = toArea; me.x = gx; me.y = gy;
      // Session scratch follows travel's rules: Barrows crypt
      // scratch is left behind, plaza arrival clears the drains.
      me.barrowsCrypt = null; me.barrowsHp = null; me.barrowsPuzzle = null;
      if (toArea === 'plaza') { me.accDrain = 0; me.strDrain = 0; me.runDrainedUntil = 0; }
      if (toArea !== 'plaza') completeStarterGoal(key, 'visit_area');
      // The same per-area state push a travel sends (plus the
      // Stake Board, which the login push also carries).
      send(ws, { type: 'area', area: toArea });
      if (toArea === 'plaza') { send(ws, modNpcsMsg()); send(ws, modLadderMsg(profile)); }
      if (NPC_AREAS.includes(toArea)) send(ws, npcStateMsg(toArea));
      send(ws, nodesMsg(toArea));
      send(ws, firesMsg(toArea));
      send(ws, pilesMsg(toArea));
      send(ws, seaweedMsg(toArea));
      send(ws, sandMsg(toArea)); // Tree Guardian chain
      send(ws, alliesMsg(toArea));
      send(ws, objectsMsg(toArea));
      if (toArea === 'barrows' || toArea === 'barrows_tunnels' || toArea === 'barrows_crypt') send(ws, barrowsStateMsg(me));
      send(ws, stakeBoardMsg());
      if (toWild && fromArea !== toArea) enterWildState(key, toArea);
      if (toArea === 'mine' && me.smithing) {
        send(ws, { type: 'smith_state', item: me.smithing.item, progress: me.smithing.progress, heat: smithHeatNow(me.smithing) });
      }
      // Silent for the target: only the admin is told (the admin
      // simply becomes visible in the target's area snapshot).
      send(ws, { type: 'chat', from: 'Game', text: `🧭 You go to ${target.profile.username} — ${AREAS[toArea].name}.` });
      broadcastState();
      return;
    }

    if (m.type === 'sign_read') {
      // Polish build: a player read the Derek Nally sign in the
      // plaza. Stamp the read on their profile (persisted) — Muse
      // watches /api/tour-requests and logs in to show readers
      // around. Answer in chat so the reader knows a tour is
      // coming. (Bots never send this: no bot path taps signs.)
      profile.signReadAt = Date.now();
      save(key);
      return send(ws, { type: 'chat', from: 'Game', text: "📖 Thanks for reading! Muse has been notified — he'll come and show you around when he's next in game." });
    }

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
      // Stage 30: Wilderness travel rules. HOW you leave the wild
      // matters: the client sends via:'gate' for ditch crossings
      // (which only count beside the ditch, heading to the plaza)
      // and via:'teleport' for the teleport panel — teleporting
      // out is refused above Wilderness level 20 or teleblocked.
      // The two wild variants connect only through PK Noob, and
      // Pure Wild is only reachable through him. Actually leaving
      // ends my wild fights and clears skull/teleblock/HP pool.
      const fromWild = isWildArea(me.area);
      const toWild = isWildArea(to);
      if (fromWild && to === me.area) return send(ws, { type: 'error', message: 'You are already here.' });
      if (fromWild && toWild) return send(ws, { type: 'error', message: 'PK Noob runs the switch between the Wilderness and Pure Wild — talk to him by the ditch.' });
      if (!fromWild && to === 'purewild') return send(ws, { type: 'error', message: 'Pure Wild is reached through PK Noob — he stands by the plaza\'s north gate.' });
      if (fromWild && !toWild) {
        const viaGate = m.via === 'gate' && to === 'plaza' && me.y >= WILD_EXIT_MIN_Y;
        if (!viaGate) {
          const lvl = wildLevelAt(me.y);
          if (lvl > 20) return send(ws, { type: 'error', message: `A magical force stops you — no teleporting out above Wilderness level 20 (you are at level ${lvl}). Walk south to the ditch.` });
          if (Date.now() < (me.teleblockUntil || 0)) return send(ws, { type: 'error', message: `🌀 You are teleblocked — no teleporting for ${Math.ceil((me.teleblockUntil - Date.now()) / 1000)} more seconds.` });
        }
        exitWildCleanup(key);
      }
      if (!fromWild && toWild) cancelWildPendings(key);
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
      send(ws, seaweedMsg(to)); // Stage 29: cove seaweed clumps (empty elsewhere)
      send(ws, sandMsg(to)); // Tree Guardian chain: cove sand piles (empty elsewhere)
      send(ws, alliesMsg(to)); // Stage 6: guardians already standing there
      send(ws, objectsMsg(to)); // Stage 7D: placed objects in the new area
      if (to === 'barrows' || to === 'barrows_tunnels' || to === 'barrows_crypt') send(ws, barrowsStateMsg(me));
      if (toWild) enterWildState(key, to); // Stage 30: fresh skull/teleblock/HP pool + the wild state push
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
      me.barrowsPuzzleShown = false;
      // Week 2 (B5): the run's puzzle is DEALT on descent, so it
      // exists for the whole descent (re-asking the door re-shows
      // the SAME puzzle). It is presented when the player reaches
      // the door — see the move handler. A run whose puzzle was
      // already solved (kept through death/leaving, Derek's rule)
      // deals nothing.
      if (!profile.barrows.puzzleSolved) newBarrowsPuzzle(me);
      send(ws, { type: 'area', area: 'barrows_tunnels' });
      send(ws, nodesMsg('barrows_tunnels'));
      send(ws, firesMsg('barrows_tunnels'));
      send(ws, pilesMsg('barrows_tunnels'));
      send(ws, alliesMsg('barrows_tunnels'));
      send(ws, objectsMsg('barrows_tunnels'));
      send(ws, barrowsStateMsg(me));
      broadcastState();
      // Week 2 (D13): the descend line also names the tunnel HP pool
      // (dealt fresh above, equal to the Hitpoints level — by design)
      // so the number on the fight strip never reads as a bug.
      return send(ws, { type: 'chat', from: 'Game', text: `You climb down into the Barrows tunnels. The reward chest waits in the room at the far end, behind a puzzle door — and prayer drains twice as fast down here. Your hitpoints down here are a fresh pool of ${me.barrowsHp} — your Hitpoints level — and the puzzle door and the ambush spend it.` });
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
        respawnPlayer(key, '☠️ You were killed by the puzzle door\'s bite. Dropped: nothing. Kept: everything you carry, plus your Barrows kills, tunnel and solved puzzle. You wake up in the plaza.');
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

    // ----- Seaweed (Stage 29): pick up a cove clump -----
    // One piece per tap. addStacks honours the no-stack rule, so
    // the piece always takes a fresh slot of its own — a full pack
    // (28 stacks) refuses and the clump stays on the shore.
    if (m.type === 'seaweed_pickup') {
      const patch = seaweedPatches.get(String(m.id || ''));
      if (!patch || !patch.present) return send(ws, { type: 'error', message: 'That seaweed is gone.' });
      if (me.area !== patch.area) return send(ws, { type: 'error', message: 'That seaweed is not here.' });
      if (Math.hypot(me.x - patch.x, me.y - patch.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer to the seaweed.' });
      if (addStacks(profile.backpack, 'seaweed', 1, BACKPACK_MAX_STACKS) > 0) {
        return send(ws, { type: 'error', message: 'Backpack full (28 stacks) — seaweed takes a slot of its own.' });
      }
      patch.present = false;
      patch.respawnAt = Date.now() + SEAWEED_RESPAWN_MS;
      save(key);
      broadcastSeaweed(patch.area);
      return sendProfile(key);
    }

    // ----- Sand (Tree Guardian chain, 2026-11-24): scoop a cove
    // pile into an empty Bucket. One bucket per pile; the pile
    // smooths back over on the seaweed timer. -----
    if (m.type === 'sand_collect') {
      const pile = sandPiles.get(String(m.id || ''));
      if (!pile || !pile.present) return send(ws, { type: 'error', message: 'That sand pile is gone.' });
      if (me.area !== pile.area) return send(ws, { type: 'error', message: 'That sand is not here.' });
      if (Math.hypot(me.x - pile.x, me.y - pile.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Too far away — walk closer to the sand.' });
      if (stackQty(profile.backpack, 'bucket') < 1) return send(ws, { type: 'error', message: 'You need an empty Bucket to scoop sand — the Food & Supplies stall in the plaza sells one for 5g.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, 'bucket', 1);
      if (addStacks(profile.backpack, 'bucket_of_sand', 1, BACKPACK_MAX_STACKS) > 0) {
        addStacks(profile.backpack, 'bucket', 1, BACKPACK_MAX_STACKS); // full pack: hand the bucket back, take nothing
        return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
      }
      pile.present = false;
      pile.respawnAt = Date.now() + SAND_RESPAWN_MS;
      save(key);
      broadcastSand(pile.area);
      send(ws, { type: 'sand_result', ok: true, item: 'bucket_of_sand' });
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
      // Week 2 (D17): a rock NEEDS a pickaxe — bare hands no longer
      // mine at all, which is what makes the pickaxe line matter.
      // (Pickaxes are tools: carried in the backpack, never worn, so
      // the backpack check in bestPickaxeSpeed is the whole check.)
      let cooldownMs = ACTION_COOLDOWN_MS;
      let pickBonus = 0;
      if (node.skill === 'mining') {
        const speed = bestPickaxeSpeed(profile);
        if (speed <= 0) return send(ws, { type: 'error', message: 'You need a pickaxe to mine — Pickaxe Pete at the Emberfall Mine sells a bronze one for 60g.' });
        cooldownMs = ACTION_COOLDOWN_MS / speed; pickBonus = (speed - 1) * 0.1;
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
      // Crafting chain: mining turns up gems — a bonus roll on a
      // successful mine (6% at any rock; the Gem rock rolls 25%).
      // The gem rides the gather_result as `bonus` so the client
      // can celebrate it; it lands backpack-first like the ore.
      let bonusItem = null;
      if (node.skill === 'mining' && node.item) {
        const gemChance = node.id === 'gem_rock' ? 0.25 : 0.06;
        if (Math.random() < gemChance) {
          bonusItem = rollGem();
          const leftover = addStacks(profile.backpack, bonusItem, 1, BACKPACK_MAX_STACKS);
          if (leftover > 0) addStacks(profile.bank, bonusItem, leftover);
        }
      }
      addXp(key, { [node.skill]: node.xp });
      // Stage 20: the first REAL resource gather (a node with an
      // item — Training Cave stations grant XP only, item null, and
      // don't count) completes the "Gather a resource" starter goal.
      if (node.item) completeStarterGoal(key, 'gather');
      // Runecrafting quest (2026-11-24): essence mines count
      // toward Wizard Alden's mining step.
      if (node.item === 'rune_essence') rcQuestMined(key);
      save(key);
      me.actSkill = node.skill; me.actAt = Date.now(); // Stage 7C: activity marker (training stations share this handler)
      send(ws, { type: 'gather_result', nodeId: node.id, ok: true, item: node.item, xp: node.xp, bonus: bonusItem });
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
    // ----- Farm life: bury bones for Prayer XP -----
    if (m.type === 'bury') {
      const item = String(m.item || '');
      const xp = BURY_XP[item];
      if (!xp) return send(ws, { type: 'error', message: 'You can\'t bury that.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${ITEMS[item].name} in your backpack.` });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, item, 1);
      addXp(key, { prayer: xp });
      save(key);
      me.actSkill = 'prayer'; me.actAt = Date.now(); // Stage 7C: activity marker
      send(ws, { type: 'bury_result', ok: true, item, xp });
      return sendProfile(key);
    }

    // ----- Crafting chain (Derek, 2026-11-23): spin / craft /
    // string / enchant — the wool-to-amulet loop. Each step is a
    // small handler in the bury/fletch shape: validate, consume,
    // grant, save, answer, push the profile. -----
    if (m.type === 'spin') {
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.area !== 'plaza' || Math.hypot(me.x - SPIN_WHEEL_POS.x, me.y - SPIN_WHEEL_POS.y) > SPIN_RANGE) return send(ws, { type: 'error', message: 'You need the spinning wheel at the plaza farm — it stands at the east end of the crop rows.' });
      if (stackQty(profile.backpack, 'wool') < 1) return send(ws, { type: 'error', message: 'No Wool in your backpack — the plaza sheep give it.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, 'wool', 1);
      const leftover = addStacks(profile.backpack, 'yarn', 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, 'yarn', leftover); // full pack: bank it, never lose a spin
      addXp(key, { crafting: SPIN_XP });
      save(key);
      me.actSkill = 'crafting'; me.actAt = Date.now(); // Stage 7C: activity marker
      send(ws, { type: 'spin_result', ok: true, item: 'yarn', xp: SPIN_XP });
      return sendProfile(key);
    }
    if (m.type === 'craft_amulet') {
      const gem = String(m.gem || '');
      const rec = AMULET_CRAFT[gem];
      if (!rec) return send(ws, { type: 'error', message: 'That is not a gem you can set in an amulet.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      const cLvl = levelForXp((profile.xp && profile.xp.crafting) || 0);
      if (cLvl < rec.level) return send(ws, { type: 'error', message: `You need Crafting level ${rec.level} to make a ${GEM_DEFS[gem].name} amulet (you are level ${cLvl}).` });
      if (stackQty(profile.backpack, gem) < 1) return send(ws, { type: 'error', message: `No ${GEM_DEFS[gem].name} in your backpack — gems turn up while mining.` });
      if (stackQty(profile.backpack, 'bars') < 1) return send(ws, { type: 'error', message: 'You need a Gold bar in your backpack — smelt gold ore at the Emberfall furnace.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, gem, 1);
      removeStacks(profile.backpack, 'bars', 1);
      const out = `${gem}_amulet_unstrung`;
      const leftover = addStacks(profile.backpack, out, 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, out, leftover);
      addXp(key, { crafting: rec.xp });
      save(key);
      me.actSkill = 'crafting'; me.actAt = Date.now();
      send(ws, { type: 'craft_result', ok: true, item: out, xp: rec.xp });
      return sendProfile(key);
    }
    if (m.type === 'string_amulet') {
      const item = String(m.item || '');
      const def = itemDef(item);
      if (!def || !def.gem || !item.endsWith('_amulet_unstrung')) return send(ws, { type: 'error', message: 'That is not an unstrung amulet.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${def.name} in your backpack.` });
      if (stackQty(profile.backpack, 'yarn') < 1) return send(ws, { type: 'error', message: 'You need a Ball of yarn — spin wool at the farm spinning wheel.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, item, 1);
      removeStacks(profile.backpack, 'yarn', 1);
      const out = `${def.gem}_amulet`;
      const leftover = addStacks(profile.backpack, out, 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, out, leftover);
      addXp(key, { crafting: STRING_XP });
      save(key);
      me.actSkill = 'crafting'; me.actAt = Date.now();
      send(ws, { type: 'string_result', ok: true, item: out, xp: STRING_XP });
      return sendProfile(key);
    }
    if (m.type === 'enchant_amulet') {
      const item = String(m.item || '');
      const def = itemDef(item);
      if (!def || !def.gem || def.slot !== 'amulet' || item.endsWith('_amulet_enchanted')) return send(ws, { type: 'error', message: 'That is not a strung amulet waiting for an enchantment.' });
      const spell = SPELLS.find((s) => s.tier === 'enchant' && s.gem === def.gem);
      if (!spell) return send(ws, { type: 'error', message: 'No enchantment is known for that amulet.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${def.name} in your backpack.` });
      const mLvl = levelForXp((profile.xp && profile.xp.magic) || 0);
      if (mLvl < spell.level) return send(ws, { type: 'error', message: `You need Magic level ${spell.level} for ${spell.name} (you are level ${mLvl}).` });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      const runeId = `${spell.element}_rune`;
      // removeStacks is atomic: false (and nothing taken) when short.
      if (!removeStacks(profile.backpack, runeId, spell.runes)) return send(ws, { type: 'error', message: `You don't have the runes for ${spell.name} — it costs ${spell.runes} x ${ITEMS[runeId].name}.` });
      removeStacks(profile.backpack, item, 1);
      const out = `${def.gem}_amulet_enchanted`;
      const leftover = addStacks(profile.backpack, out, 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, out, leftover);
      addXp(key, { magic: spell.castXp || 0 });
      save(key);
      me.actSkill = 'magic'; me.actAt = Date.now();
      send(ws, { type: 'enchant_result', ok: true, item: out, spell: spell.id, xp: spell.castXp || 0 });
      return sendProfile(key);
    }

    // ----- Runecrafting + the first quest (Derek, 2026-11-24) -----
    // quest_talk is Wizard Alden's whole conversation: the first
    // talk starts "Rune Crafting", later talks report the current
    // step, and the talk at the final step pays the reward and
    // closes the quest. rc_craft is the altar: essence in, runes
    // out, gated by Runecrafting level. Crafting is NOT locked
    // behind the quest — anyone standing at the altar can craft;
    // the quest only teaches (and counts what you craft while it
    // runs).
    if (m.type === 'quest_talk') {
      const qid = String(m.quest || 'runecrafting');
      if (qid !== 'runecrafting' || !QUEST_DEFS[qid]) return send(ws, { type: 'error', message: 'Unknown quest.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.area !== 'magic' || Math.hypot(me.x - WIZARD_ALDEN_POS.x, me.y - WIZARD_ALDEN_POS.y) > QUEST_TALK_RANGE) return send(ws, { type: 'error', message: 'Wizard Alden is at the Wizard Grounds — he stands by the stone circle.' });
      const st = questStateOf(profile, qid);
      let lines;
      if (st.status === 'done') {
        lines = ['Ah, my rune-crafter returns. The altar hums a little brighter since your lesson, I swear it.', 'Craft whenever you like — the essence rocks never truly empty, and neither does a wizard\'s curiosity.'];
        send(ws, { type: 'quest_talk_result', quest: qid, lines });
        return;
      }
      if (st.status === 'not_started') {
        profile.quests.runecrafting = { status: 'active', step: 0, mined: 0, crafted: {} };
        save(key);
        lines = [
          'Well met. I am Alden, keeper of this circle — and you have the look of someone whose spells keep running out.',
          'Runes are not found, traveller. They are MADE. That is Runecrafting, and I will teach it to you, here, with your own hands.',
          `First: the pale rocks west, east and south of this circle hold rune essence. Chip me ${RC_QUEST_ESSENCE} pieces — and bring a pickaxe; bare hands only bruise. Pickaxe Pete at the Emberfall Mine sells a bronze one.`,
        ];
        send(ws, { type: 'quest_talk_result', quest: qid, lines });
        send(ws, questsMsg(profile));
        return;
      }
      const stepId = QUEST_DEFS[qid].steps[st.step].id;
      if (stepId === 'return') {
        profile.quests.runecrafting = { ...st, status: 'done' };
        addXp(key, { runecrafting: RC_QUEST_REWARD.xp });
        addGold(profile, RC_QUEST_REWARD.gold);
        const leftover = addStacks(profile.backpack, RC_QUEST_REWARD.runeItem, RC_QUEST_REWARD.runeQty, BACKPACK_MAX_STACKS);
        if (leftover > 0) addStacks(profile.bank, RC_QUEST_REWARD.runeItem, leftover);
        save(key);
        lines = [
          'You felt it, yes? A spell cast with runes of your own making flies truer. That is the whole secret, and now it is yours.',
          `Take these, with an old wizard's blessing: ${RC_QUEST_REWARD.xp} Runecrafting XP, ${RC_QUEST_REWARD.runeQty} air runes and ${RC_QUEST_REWARD.gold} gold. Quest complete — "Rune Crafting"!`,
        ];
        send(ws, { type: 'quest_talk_result', quest: qid, lines });
        send(ws, { type: 'chat', from: 'Game', text: `🗺️ Quest complete: "Rune Crafting"! +${RC_QUEST_REWARD.xp} Runecrafting XP, +${RC_QUEST_REWARD.runeQty} air runes, +${RC_QUEST_REWARD.gold}g.` });
        send(ws, questsMsg(profile));
        return sendProfile(key);
      }
      const guidance = {
        mine: `The essence rocks, remember — pale stone, west, east and south of the circle. You have ${Math.min(st.mined || 0, RC_QUEST_ESSENCE)} of ${RC_QUEST_ESSENCE} pieces. And a pickaxe: no pickaxe, no essence.`,
        craft: 'To the altar at the circle\'s heart. Lay your essence on it and choose air — the first rune every crafter learns. Three runes will prove the lesson.',
        cast: 'Now spend what you made. Set a spell — Air Strike is already yours — and cast it at anything: a wizard here will spar, or the Magic dummy at the Training Cave. The runes it burns must be your own work.',
      };
      lines = [guidance[stepId] || 'The circle provides. Follow your quest log — the 📋 Goals tab keeps your place.'];
      send(ws, { type: 'quest_talk_result', quest: qid, lines });
      return;
    }
    if (m.type === 'rc_craft') {
      const el = String(m.element || '');
      const rec = RC_TIERS[el];
      if (!rec) return send(ws, { type: 'error', message: 'The altar only knows air, water, earth and fire runes.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (me.area !== 'magic' || Math.hypot(me.x - RC_ALTAR_POS.x, me.y - RC_ALTAR_POS.y) > RC_ALTAR_RANGE) return send(ws, { type: 'error', message: 'You need the Runecrafting altar — it stands in the stone circle at the Wizard Grounds.' });
      const rcLvl = levelForXp((profile.xp && profile.xp.runecrafting) || 0);
      if (rcLvl < rec.level) return send(ws, { type: 'error', message: `You need Runecrafting level ${rec.level} to craft ${cap(el)} runes (you are level ${rcLvl}).` });
      const have = stackQty(profile.backpack, 'rune_essence');
      if (have < 1) return send(ws, { type: 'error', message: 'No Rune essence in your backpack — mine the pale essence rocks around this circle (a pickaxe job).' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      const batch = Math.min(have, RC_BATCH);
      const multi = rcMultiFor(rcLvl, rec.level);
      const out = batch * multi;
      removeStacks(profile.backpack, 'rune_essence', batch);
      const runeId = `${el}_rune`;
      const leftover = addStacks(profile.backpack, runeId, out, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, runeId, leftover); // full pack: bank it, never lose a craft
      const xpGain = batch * rec.xp;
      addXp(key, { runecrafting: xpGain });
      // Quest counting: runes crafted while "Rune Crafting" runs
      // are remembered per element — the cast step checks them, so
      // a bought rune can never fake the lesson.
      const st = questStateOf(profile, 'runecrafting');
      if (st.status === 'active') {
        st.crafted = st.crafted || {};
        st.crafted[el] = (st.crafted[el] || 0) + out;
        profile.quests.runecrafting = st;
        if (QUEST_DEFS.runecrafting.steps[st.step].id === 'craft' && (st.crafted.air || 0) >= RC_QUEST_RUNES) {
          save(key);
          rcQuestAdvance(key);
        }
      }
      save(key);
      me.actSkill = 'runecrafting'; me.actAt = Date.now();
      send(ws, { type: 'rc_result', ok: true, element: el, item: runeId, essenceUsed: batch, runes: out, xp: xpGain });
      return sendProfile(key);
    }

    // ----- Tree Guardian maker + herblore (Derek, 2026-11-24) -----
    // The guardian is the maker: tap him (client) to open the
    // making panel; these handlers are the work itself. Glass is
    // worked at the ONE furnace (Emberfall) with the guardian
    // beside you; potion mixing travels with him. Every step is a
    // small handler in the spin/bury shape: validate, consume,
    // grant, save, answer, push the profile.
    if (m.type === 'glass_make' || m.type === 'glass_blow') {
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      const ally = helperAlly(key, me.area);
      if (!ally) return send(ws, { type: 'error', message: 'Your Tree Guardian must be standing with you to work glass — awaken a tree and bring him to the furnace.' });
      if (me.area !== 'mine' || Math.hypot(me.x - FURNACE_POS.x, me.y - FURNACE_POS.y) > FURNACE_RANGE) return send(ws, { type: 'error', message: 'Glass is worked at the Emberfall furnace — take your Tree Guardian to the Mine & Smithy.' });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      if (m.type === 'glass_make') {
        if (stackQty(profile.backpack, 'seaweed') < 1) return send(ws, { type: 'error', message: 'You need a piece of Seaweed — it washes up along the Fishing Cove shore.' });
        if (stackQty(profile.backpack, 'bucket_of_sand') < 1) return send(ws, { type: 'error', message: 'You need a Bucket of sand — scoop shore sand at the Fishing Cove with an empty bucket.' });
        removeStacks(profile.backpack, 'seaweed', 1);
        removeStacks(profile.backpack, 'bucket_of_sand', 1);
        const leftover = addStacks(profile.backpack, 'molten_glass', 1, BACKPACK_MAX_STACKS);
        if (leftover > 0) addStacks(profile.bank, 'molten_glass', leftover); // full pack: bank it, never lose a melt
        const backBucket = addStacks(profile.backpack, 'bucket', 1, BACKPACK_MAX_STACKS); // the bucket comes back empty
        if (backBucket > 0) addStacks(profile.bank, 'bucket', backBucket);
        addXp(key, { crafting: GLASS_MAKE_XP });
        save(key);
        me.actSkill = 'crafting'; me.actAt = Date.now();
        send(ws, { type: 'glass_result', ok: true, item: 'molten_glass', xp: GLASS_MAKE_XP });
        return sendProfile(key);
      }
      const make = String(m.make || '');
      const out = make === 'vial' ? 'glass_vial' : make === 'lantern' ? 'glass_lantern' : null;
      if (!out) return send(ws, { type: 'error', message: 'Blow the glass into a vial or a lantern.' });
      if (stackQty(profile.backpack, 'molten_glass') < 1) return send(ws, { type: 'error', message: 'No Molten glass — melt seaweed and a bucket of sand at the furnace first.' });
      removeStacks(profile.backpack, 'molten_glass', 1);
      const leftover = addStacks(profile.backpack, out, 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, out, leftover);
      addXp(key, { crafting: GLASS_BLOW_XP[make] });
      save(key);
      me.actSkill = 'crafting'; me.actAt = Date.now();
      send(ws, { type: 'blow_result', ok: true, item: out, xp: GLASS_BLOW_XP[make] });
      return sendProfile(key);
    }
    if (m.type === 'mix_potion') {
      const herb = String(m.herb || '');
      const out = MIX_POTION_OUT[herb];
      if (!out) return send(ws, { type: 'error', message: 'That herb makes no potion your guardian knows.' });
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      const ally = helperAlly(key, me.area);
      if (!ally) return send(ws, { type: 'error', message: 'Your Tree Guardian must be standing with you to mix potions — awaken a tree first.' });
      if (stackQty(profile.backpack, 'glass_vial') < 1) return send(ws, { type: 'error', message: 'You need an empty Glass vial — blow one from molten glass at the furnace.' });
      if (stackQty(profile.backpack, herb) < 1) return send(ws, { type: 'error', message: `No ${ITEMS[herb].name} in your backpack — hobgoblins at the Goblin Camp drop them.` });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, 'glass_vial', 1);
      removeStacks(profile.backpack, herb, 1);
      const leftover = addStacks(profile.backpack, out, 1, BACKPACK_MAX_STACKS);
      if (leftover > 0) addStacks(profile.bank, out, leftover);
      addXp(key, { crafting: MIX_POTION_XP[herb] });
      save(key);
      me.actSkill = 'crafting'; me.actAt = Date.now();
      send(ws, { type: 'mix_result', ok: true, item: out, xp: MIX_POTION_XP[herb] });
      return sendProfile(key);
    }
    // Guardian-made lanterns: placed through the Stage 7D
    // placed-objects persistence (profile.placedObjects +
    // placedObjectsAll), so they survive relogs and restarts,
    // show to everyone, and the existing admin remove_object
    // tooling works on them. The owner can take theirs back or
    // smash it (Derek: made things stay "unless someone decides
    // to destroy it").
    if (m.type === 'lantern_place') {
      if (me.duelId || me.npcFightId) return send(ws, { type: 'error', message: 'Not while you are fighting.' });
      if (isWildArea(me.area)) return send(ws, { type: 'error', message: 'A glass lantern would not last a minute in the Wilderness.' });
      if (stackQty(profile.backpack, 'glass_lantern') < 1) return send(ws, { type: 'error', message: 'No Glass lantern in your backpack — blow one from molten glass at the furnace.' });
      const mine = placedObjectsAll.filter((o) => o.ownerKey === key && o.kind === 'glass_lantern');
      if (mine.length >= LANTERN_MAX_PER_PLAYER) return send(ws, { type: 'error', message: `You already have ${LANTERN_MAX_PER_PLAYER} lanterns standing in the world — take one back first.` });
      if (actionOnCooldown(me)) return send(ws, { type: 'error', message: 'Too fast — one action at a time.' });
      removeStacks(profile.backpack, 'glass_lantern', 1);
      ensureV2(profile);
      const entry = { id: `obj_${++objectSeq}`, area: me.area, kind: 'glass_lantern', x: Math.max(0, Math.min(WORLD_W, Math.round(me.x) + 24)), y: Math.round(me.y) };
      profile.placedObjects.push(entry); // saved on MY profile (the Stage 7D storage pattern)
      placedObjectsAll.push({ ...entry, by: profile.username, ownerKey: key });
      save(key);
      broadcastObjects(me.area);
      send(ws, { type: 'lantern_result', action: 'placed', id: entry.id });
      return sendProfile(key);
    }
    if (m.type === 'lantern_take' || m.type === 'lantern_smash') {
      const id = String(m.id || '');
      const idx = placedObjectsAll.findIndex((o) => o.id === id && o.kind === 'glass_lantern');
      if (idx < 0) return send(ws, { type: 'error', message: 'That lantern is not standing here.' });
      const obj = placedObjectsAll[idx];
      if (obj.ownerKey !== key) return send(ws, { type: 'error', message: `That lantern isn't yours — ${obj.by} made it. Only they (or an admin) can remove it.` });
      if (me.area !== obj.area || Math.hypot(me.x - obj.x, me.y - obj.y) > NPC_RANGE) return send(ws, { type: 'error', message: 'Walk closer to your lantern.' });
      placedObjectsAll.splice(idx, 1);
      ensureV2(profile);
      profile.placedObjects = profile.placedObjects.filter((o) => o.id !== id);
      if (m.type === 'lantern_take') {
        const leftover = addStacks(profile.backpack, 'glass_lantern', 1, BACKPACK_MAX_STACKS);
        if (leftover > 0) addStacks(profile.bank, 'glass_lantern', leftover);
      }
      save(key);
      broadcastObjects(obj.area);
      send(ws, { type: 'lantern_result', action: m.type === 'lantern_take' ? 'took' : 'smashed', id });
      return sendProfile(key);
    }

    // ----- Stage 19: spellbook selection + fletching -----
    if (m.type === 'set_spell') {
      const sp = SPELL_BY_ID[String(m.spell || '')];
      if (!sp) return send(ws, { type: 'error', message: 'Unknown spell.' });
      // Stage 24: Freeze is cast from a placed spell button only —
      // a staff autocasting a 0-damage root would just burn runes.
      if (sp.id === 'freeze') return send(ws, { type: 'error', message: '❄️ Freeze is cast from a placed spell button — drag it out of the spellbook onto your screen.' });
      // Crafting chain: Enchant spells are cast on a strung amulet
      // in the backpack, never selected for a staff.
      if (sp.tier === 'enchant') return send(ws, { type: 'error', message: `✨ ${sp.name} is cast on a strung amulet in your backpack — open the amulet and tap Enchant.` });
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
      if (isWildArea(me.area)) return send(ws, { type: 'error', message: '💀 There are no shops in the Wilderness.' }); // Stage 30
      const item = String(m.item || '');
      const def = itemDef(item);
      const qty = Math.max(1, Math.min(999, Math.floor(+m.qty || 1)));
      if (!def || !def.buy) return send(ws, { type: 'error', message: 'That is not sold in the shops.' });
      const cost = currentBuyPrice(item) * qty; // Pricing: the CURRENT (demand) price
      if (goldTotal(profile) < cost) return send(ws, { type: 'error', message: `Not enough gold — ${def.name} x${qty} costs ${cost}g.` });
      if (addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS) > 0) return send(ws, { type: 'error', message: 'Backpack full (28 stacks).' });
      takeGold(profile, cost); // Stage 16: paid from the coin stacks
      noteDemand(item, qty, +1); // Pricing: buying pushes this item's demand up
      save(key);
      send(ws, { type: 'shop', action: 'buy', shop: def.shop, item, qty, total: cost });
      // Stage 21: the two top-tier party hats are server-wide news.
      if (item === 'rune_partyhat' || item === 'dragon_partyhat') announce(`🎉 ${profile.username} just bought a ${def.name}!`);
      return sendProfile(key);
    }
    if (m.type === 'shop_sell') {
      if (isWildArea(me.area)) return send(ws, { type: 'error', message: '💀 There are no shops in the Wilderness.' }); // Stage 30
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
      // Playtest fix: a sell asks for UP TO the requested amount —
      // "Sell 5" with only 3 in the pack sells the 3, and the sold
      // message reports the amount that really moved. It refuses
      // only when none are held at all.
      const sellQty = Math.min(qty, stackQty(profile.backpack, item));
      if (sellQty < 1) return send(ws, { type: 'error', message: `You don't have any ${def.name} to sell.` });
      removeStacks(profile.backpack, item, sellQty);
      const total = sellPrice(item) * sellQty; // Pricing: sellPrice is the CURRENT price (60% of current buy / current sellOnly)
      noteDemand(item, sellQty, -1); // Pricing: selling to a shop pushes this item's demand down
      addGold(profile, total); // Stage 16: the payment lands on the coin stack
      save(key);
      send(ws, { type: 'shop', action: 'sell', shop: def.shop, item, qty: sellQty, total });
      return sendProfile(key);
    }

    // ----- Equip / unequip (tap-to-wear: wearing swaps with the slot) -----
    if (m.type === 'equip') {
      const item = String(m.item || '');
      const def = itemDef(item);
      if (!def || !def.slot) return send(ws, { type: 'error', message: 'That can\'t be worn.' });
      if (stackQty(profile.backpack, item) < 1) return send(ws, { type: 'error', message: `No ${def.name} in your backpack.` });
      // Stage 34: TWO-HANDED weapons occupy the shield slot too.
      // Equipping one sends a worn shield back to the backpack
      // first; equipping a shield while a two-hander is wielded
      // sends the two-hander back instead. The displaced piece
      // moves as its own atomic unequip BEFORE the swap below runs
      // (qty 1 either merges onto its own stack or takes a free
      // slot; if neither exists the equip is refused here, before
      // anything moves). If the swap below then refuses on its own
      // full-pack rule, the displaced piece is simply already in
      // the pack, unworn — nothing is lost either way. Invariant
      // from here on: while a twoHanded weapon is worn, worn.shield
      // is null, so the snapshot and renderer never show a shield
      // with one.
      if (def.slot === 'weapon' && def.twoHanded && profile.worn.shield) {
        const sh = profile.worn.shield;
        if (addStacks(profile.backpack, sh, 1, BACKPACK_MAX_STACKS) > 0) {
          return send(ws, { type: 'error', message: 'Backpack full — no room for your shield to come off for a two-handed weapon.' });
        }
        profile.worn.shield = null;
      } else if (def.slot === 'shield' && profile.worn.weapon) {
        const wDef = itemDef(profile.worn.weapon);
        if (wDef && wDef.twoHanded) {
          const wp = profile.worn.weapon;
          if (addStacks(profile.backpack, wp, 1, BACKPACK_MAX_STACKS) > 0) {
            return send(ws, { type: 'error', message: 'Backpack full — no room for your two-handed weapon to come off for a shield.' });
          }
          profile.worn.weapon = null;
        }
      }
      const old = profile.worn[def.slot];
      // Stage 29: EXACT-SPOT swap (the app version's rule) — when
      // the client names the backpack slot the piece came from
      // (m.slot, validated against the live pack), the piece it
      // replaces lands in THAT slot, not the first free one. The
      // slot only opens if the entry is fully consumed; a partial
      // entry keeps its slot and the old piece merges onto its own
      // stack or takes a free slot — and if neither exists the swap
      // is refused up front, before anything moves.
      const slotIdx = (Number.isInteger(m.slot) && m.slot >= 0 && m.slot < profile.backpack.length
        && profile.backpack[m.slot].item === item) ? m.slot : -1;
      if (slotIdx >= 0) {
        const entry = profile.backpack[slotIdx];
        const hole = entry.qty <= 1; // removing the piece empties this slot
        if (old && old !== item && !hole && (isNoStack(old) || stackQty(profile.backpack, old) === 0)
          && profile.backpack.length >= BACKPACK_MAX_STACKS) {
          return send(ws, { type: 'error', message: 'Backpack full — no room to swap.' });
        }
        entry.qty -= 1;
        if (entry.qty <= 0) profile.backpack.splice(slotIdx, 1);
        profile.worn[def.slot] = item;
        if (old) {
          if (hole) profile.backpack.splice(slotIdx, 0, { item: old, qty: 1 }); // the exact spot it came from
          else if (old === item) entry.qty += 1; // same piece type: straight back onto its stack
          else if (!isNoStack(old) && stackQty(profile.backpack, old) > 0) profile.backpack.find((x) => x.item === old).qty += 1;
          else profile.backpack.push({ item: old, qty: 1 });
        }
        save(key);
        return sendProfile(key);
      }
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
      // Stage 30: Pure Wild hard-blocks ALL food and potions
      // (healing potions count as food — the app's reading),
      // before anything is consumed or any pool is checked.
      if (me.area === 'purewild') return send(ws, { type: 'error', message: '🚫 Pure Wild — no food, no potions.' });
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
          if (!run) {
            // Stage 30: in the Wilderness, food / potions heal the
            // wild HP pool (Pure Wild never reaches here — it is
            // refused at the top of this handler).
            if (isWildArea(me.area) && me.wildHp != null) {
              if (me.wildHp >= me.wildMaxHp) return send(ws, { type: 'error', message: 'Already at full health.' });
              removeStacks(profile.backpack, item, 1);
              me.wildHp = Math.min(me.wildMaxHp, me.wildHp + def.heal);
              save(key);
              send(ws, { type: 'wild_hp', hp: me.wildHp, maxHp: me.wildMaxHp });
              return sendProfile(key);
            }
            return send(ws, { type: 'error', message: 'Healing only works during a duel.' });
          }
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
      if (isWildArea(me.area)) return send(ws, { type: 'error', message: '💀 There is no bank in the Wilderness.' }); // Stage 30
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
      if (isWildArea(me.area)) return send(ws, { type: 'error', message: '💀 The Gold Exchange is in the plaza — not in the Wilderness.' }); // Stage 30
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
        noteExchangeDemand(good.id, qty, +1); // Pricing: Exchange buys push the good's demand up
        save(key);
        send(ws, { type: 'exchange', action: 'buy', good: good.id, qty, price, total: cost });
      } else {
        if (!removeStacks(profile.backpack, good.id, qty)) return send(ws, { type: 'error', message: `You don't have ${qty} x ${good.name}.` });
        const total = Math.floor(price * qty * EXCHANGE_SELLBACK); // Pricing: 97% of the CURRENT Exchange price
        addGold(profile, total); // Stage 16: the payment lands on the coin stack
        noteExchangeDemand(good.id, qty, -1); // Pricing: Exchange sells push the good's demand down
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
      // Stage 30: Pure Wild hard-blocks prayer activation (turning
      // one off is always allowed; entering Pure clears it anyway).
      if (me.area === 'purewild' && want !== null && want !== profile.activePrayer) {
        return send(ws, { type: 'error', message: '🚫 Pure Wild — no prayer.' });
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
      // and swings once they tap their opponent (this message) —
      // or once their opponent swings at them (auto-engage in the
      // duel tick, Derek 2026-11-22, reversing the 2026-11-16
      // tap-only rule). Taps are accepted during the countdown;
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
      // Tap-to-engage, the duel rule: the challenger starts
      // swinging on their own tap — or automatically once the mod
      // swings at them (auto-engage in the mod tick, Derek
      // 2026-11-22). Taps are accepted during the countdown; the
      // first swing arms for the tick after the countdown (or the
      // next tick).
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
      // Crafting chain: Enchant spells target an amulet in the
      // backpack, never a creature or a player.
      if (spell.tier === 'enchant') return send(ws, { type: 'error', message: `✨ ${spell.name} is cast on a strung amulet in your backpack — open the amulet and tap Enchant.` });
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

      if (kind === 'wild') {
        // Stage 30: button casts in the Wilderness / Pure Wild —
        // at another player or a PKer. A cast skulls like a first
        // strike and creates the fight context (the victim can
        // fight back clean; a PKer target answers by engaging),
        // but it does NOT engage the caster's weapon swings —
        // that stays the attack order's job (Stage 24's split).
        if (!isWildArea(me.area)) return castFail('You can only cast at players in the Wilderness.');
        if (me.duelId || me.modDuelId || me.npcFightId || me.barrowsFightId || me.fcRunId) return castFail('You are busy fighting something else.');
        let tRef = null;
        let tC = null;
        const pkTarget = pkers.get(targetId);
        if (pkTarget && pkTarget.area === me.area) {
          if (!pkTarget.alive) return castFail('That PKer is not here.');
          tRef = wildRefPker(pkTarget.id);
          tC = combatant(tRef);
        } else {
          const tKey = userKeyFor(targetId);
          const tSess = tKey ? online.get(tKey) : null;
          if (!tSess || tKey === key || tSess.area !== me.area) return castFail('That player is not here.');
          tRef = wildRefPlayer(tKey);
          tC = combatant(tRef);
        }
        if (!tC) return castFail('That target is gone.');
        if (Math.hypot(me.x - tC.x, me.y - tC.y) > NPC_RANGE) return castFail('Too far away — walk closer.');
        if (spell.id === 'freeze' && alreadyFrozen(tC.frozenUntil(), tC.name)) return;
        const myCbtW = combatLevelOf(levelsOf(profile));
        const tgtCbtW = tC.isPlayer ? combatLevelOf(levelsOf(tC.profile)) : tC.pker.cbt;
        const lvlW = wildLevelAt(me.y);
        if (Math.abs(myCbtW - tgtCbtW) > lvlW) return castFail(`You can't attack ${tC.name} at Wilderness level ${lvlW} — the bracket here is ±${lvlW} of your combat level. Push deeper north.`);
        const existingW = wildPairBetween(wildRefPlayer(key), tRef);
        if (!existingW && Math.min(lvlW, wildLevelAt(tC.y)) < 20) {
          if (wildPairsOf(tRef).length) return castFail(`${tC.name} is already in a fight.`);
          if (wildPairsOf(wildRefPlayer(key)).length) return castFail('You are already in a fight.');
        }
        const mLvlW = levelForXp((profile.xp && profile.xp.magic) || 0);
        if (mLvlW < spell.level) return castFail(`You need Magic level ${spell.level} to cast ${spell.name}.`);
        if (stackQty(profile.backpack, `${spell.element}_rune`) < spell.runes) return castFail(`You don't have the runes for ${spell.name}.`);
        wildSkullCheck(key, tRef);
        // Stage 27: the PvP Deflect rule, same as a duel cast.
        const res = rollMagicCast(profile, tC.profile, spell, false, null, true);
        if (res.refused) return castFail(res.refused);
        finishCast(res);
        if (!existingW) {
          const pair = createWildPair(me.area, wildRefPlayer(key), tRef, wildRefPlayer(key));
          if (!tC.isPlayer) { tC.pker.targetKey = key; engageWild(pair, tRef); }
        }
        tC.setHp(Math.max(0, tC.hp() - res.dmg));
        if (res.deflected) me.wildHp = Math.max(0, (me.wildHp == null ? me.wildMaxHp || 1 : me.wildHp) - res.deflected);
        let frozenUntil = 0;
        if (res.froze) {
          frozenUntil = Date.now() + FREEZE_MS;
          if (tC.isPlayer) { tC.sess.frozenUntil = frozenUntil; broadcastState(); }
          else tC.pker.frozenUntil = frozenUntil;
        }
        const result = { type: 'cast_result', context: 'wild', spell: spell.id, targetId: tC.isPlayer ? tC.name : tC.id, targetName: tC.name, outcome: res.outcome, dmg: res.dmg, deflected: res.deflected || 0, froze: !!res.froze, frozenUntil, hpYou: me.wildHp, hpTarget: Math.max(0, tC.hp()), maxHpTarget: tC.maxHp() };
        send(ws, result);
        if (tC.isPlayer) send(tC.sess.ws, { ...result, incoming: true, by: profile.username });
        if (tC.hp() <= 0) {
          if (tC.isPlayer) wildDeath(tC.key, profile.username);
          else pkerDeath(tC.pker, key);
        }
        if ((me.wildHp == null ? 1 : me.wildHp) <= 0 && isWildArea(me.area)) wildDeath(key, tC.name); // killed by my own cast's Deflect bounce
        return;
      }

      return castFail('There is nothing to cast at here.');
    }

    // ----- Stage 30: Wilderness attack orders, Leave, PK Noob -----
    if (m.type === 'wild_attack') {
      if (!isWildArea(me.area)) return send(ws, { type: 'error', message: 'You can only attack players in the Wilderness.' });
      if (me.duelId || me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId) return send(ws, { type: 'error', message: 'You are already fighting something.' });
      if (me.barrowsFightId) return send(ws, { type: 'error', message: 'You are already fighting a Barrows brother.' });
      if (me.fcRunId) return send(ws, { type: 'error', message: 'You are in the Fight Caves.' });
      let tRef = null;
      let tC = null;
      if (m.pker) {
        const pk = pkers.get(String(m.pker));
        if (!pk || pk.area !== me.area || !pk.alive) return send(ws, { type: 'error', message: 'That PKer is not here.' });
        tRef = wildRefPker(pk.id);
        tC = combatant(tRef);
      } else {
        const tKey = userKeyFor(m.target);
        const tSess = tKey ? online.get(tKey) : null;
        if (!tSess || tKey === key) return send(ws, { type: 'error', message: 'Pick another player in the Wilderness.' });
        if (tSess.area !== me.area) return send(ws, { type: 'error', message: 'That player is not here.' });
        tRef = wildRefPlayer(tKey);
        tC = combatant(tRef);
      }
      if (!tC) return send(ws, { type: 'error', message: 'That target is gone.' });
      const myRef = wildRefPlayer(key);
      const existing = wildPairBetween(myRef, tRef);
      // The bracket: combat levels within ±(my Wilderness level).
      const myCbt = combatLevelOf(levelsOf(profile));
      const tgtCbt = tC.isPlayer ? combatLevelOf(levelsOf(tC.profile)) : tC.pker.cbt;
      const lvl = wildLevelAt(me.y);
      if (Math.abs(myCbt - tgtCbt) > lvl) return send(ws, { type: 'error', message: `You can't attack ${tC.name} (combat ${Math.floor(tgtCbt)}) at Wilderness level ${lvl} — the bracket here is ±${lvl} of your combat ${Math.floor(myCbt)}. Push deeper north to widen it.` });
      // Shallow wild is single-way: no piling, no second fight.
      if (!existing && Math.min(lvl, wildLevelAt(tC.y)) < 20) {
        if (wildPairsOf(tRef).length) return send(ws, { type: 'error', message: `${tC.name} is already in a fight.` });
        if (wildPairsOf(myRef).length) return send(ws, { type: 'error', message: 'You are already in a fight.' });
      }
      wildSkullCheck(key, tRef); // striking first skulls — order given, skull taken
      const pair = existing || createWildPair(me.area, myRef, tRef, myRef);
      if (!tC.isPlayer) tC.pker.targetKey = key; // the PKer turns and answers (its AI engages the pair)
      engageWild(pair, myRef); // face + chase is the client's closing machinery (Stage 26 pattern)
      return;
    }
    if (m.type === 'wild_leave') {
      // Informational only (Derek's rule): Leave WALKS you out.
      // The client walks the knight to the ditch; the gate
      // crossing does the actual leaving. Nothing changes here —
      // you are attackable until you cross.
      if (isWildArea(me.area)) send(ws, { type: 'chat', from: 'Game', text: '🚪 Walking back to the ditch — you are still in the Wilderness (and attackable) until you cross it.' });
      return;
    }
    if (m.type === 'pk_noob_hop') {
      const target = m.pure ? 'purewild' : 'wilderness';
      if (me.duelId || me.modDuelId) return send(ws, { type: 'error', message: 'You are in a duel.' });
      if (me.npcFightId || me.barrowsFightId || me.fcRunId) return send(ws, { type: 'error', message: 'You are busy fighting.' });
      if (stakeMatchForKey(key)) return send(ws, { type: 'error', message: 'You have a stake match waiting — cancel it first.' });
      if (me.wildPairs && me.wildPairs.size) return send(ws, { type: 'error', message: 'You can\'t hop mid-fight — walk out across the ditch or finish it.' });
      if (me.area === target) return send(ws, { type: 'error', message: m.pure ? 'You are already in Pure Wild.' : 'You are already in the Wilderness.' });
      if (isWildArea(me.area) && me.y < 700) return send(ws, { type: 'error', message: 'PK Noob waits by the ditch — walk south to him first.' });
      if (isWildArea(me.area)) exitWildCleanup(key);
      else cancelWildPendings(key);
      me.area = target;
      me.x = AREAS[target].spawn.x; me.y = AREAS[target].spawn.y;
      send(ws, { type: 'area', area: target });
      send(ws, nodesMsg(target));
      send(ws, firesMsg(target));
      send(ws, pilesMsg(target));
      send(ws, seaweedMsg(target));
      send(ws, sandMsg(target)); // Tree Guardian chain
      send(ws, alliesMsg(target));
      send(ws, objectsMsg(target));
      enterWildState(key, target);
      send(ws, {
        type: 'chat', from: 'PK Noob',
        text: target === 'purewild'
          ? '💀 Welcome to PURE WILD — no prayer, no food, no potions for anyone. Same skulls, same drops. Walk back across the ditch to leave, or find me by the ditch to hop back.'
          : 'Back to the normal Wilderness — prayer and food work here. Skulls and drops are the same.',
      });
      broadcastState();
      return;
    }

    if (m.type === 'special') {
      const duel = me.duelId ? duels.get(me.duelId) : null;
      const nf = !duel && me.npcFightId ? npcFights.get(me.npcFightId) : null;
      const fc = !duel && !nf && me.fcRunId ? fcRuns.get(me.fcRunId) : null; // Stage 4: specials work in the caves too
      const bf = !duel && !nf && !fc && me.barrowsFightId ? barrowsFights.get(me.barrowsFightId) : null; // Stage 5: and in Barrows crypts
      const md = !duel && !nf && !fc && !bf && me.modDuelId ? modDuels.get(me.modDuelId) : null; // Stage 22: and in mod duels
      const wpair = !duel && !nf && !fc && !bf && !md && me.wildTarget ? wildPairBetween(wildRefPlayer(key), me.wildTarget) : null; // Stage 30: and in wild fights (queued on my current wild pair)
      if (!duel && !nf && !fc && !bf && !md && !wpair) return send(ws, { type: 'error', message: 'You are not in a duel.' });
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
      } else if (wpair) {
        if (wpair.spec[wildRefPlayer(key)]) return send(ws, { type: 'error', message: 'Special already queued for the next tick.' });
        wpair.spec[wildRefPlayer(key)] = true;
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
        if (isWildArea(sess.area)) return send(ws, { type: 'error', message: '💀 One of you is in the Wilderness — no official fights there.' }); // Stage 30
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
    // Stage 37 (Addition #4): restyle a BASE item's look. The
    // override record holds ONLY {icon?, color?} — by construction
    // it cannot touch the item's name, stats, prices, kind, slot
    // or behaviour; catalogList applies it over the base def's
    // icon/color channels and nothing else. Stored on the editing
    // admin's profile (the 7D pattern); setting a look first
    // removes the item from every other profile, so exactly one
    // record per item exists and a restart can never resurrect
    // an older admin's version over a newer one.
    if (m.type === 'set_item_look') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'You do not have permission to do that.' });
      const itemId = String(m.item || '');
      // Base catalog ONLY — a custom item already carries its own
      // look (edit the item itself); anything else doesn't exist.
      if (!ITEMS[itemId]) return send(ws, { type: 'error', message: 'Pick a base item to restyle.' });
      ensureV2(profile);
      const clearEverywhere = () => {
        itemLooks.delete(itemId);
        for (const [k, u] of Object.entries(db.users)) {
          if (u && u.profile && u.profile.itemLooks && u.profile.itemLooks[itemId]) { delete u.profile.itemLooks[itemId]; save(k); }
        }
      };
      if (m.reset) {
        clearEverywhere();
        broadcast({ type: 'catalog', items: catalogList(), shops: SHOPS });
        send(ws, { type: 'admin_note', text: `${ITEMS[itemId].name} is back to its standard look.` });
        return send(ws, { type: 'item_look_set', item: itemId, look: null });
      }
      // Fields the message carries win; absent fields keep the
      // current override's value. icon '' clears the icon half; a
      // present-but-invalid icon rejects (the edit_custom rule);
      // color follows customColorFrom (present + invalid = clear).
      const cur = itemLooks.get(itemId) || {};
      const next = {};
      if (m.icon !== undefined) {
        if (m.icon === '' || m.icon === null) { /* icon half cleared */ }
        else if (CUSTOM_ICONS.includes(m.icon)) next.icon = m.icon;
        else return send(ws, { type: 'error', message: 'That icon is not allowed for items.' });
      } else if (cur.icon) next.icon = cur.icon;
      const col = customColorFrom(m, cur.color || null);
      if (col) next.color = col;
      clearEverywhere();
      if (next.icon || next.color) {
        if (!profile.itemLooks || typeof profile.itemLooks !== 'object') profile.itemLooks = {};
        profile.itemLooks[itemId] = next;
        itemLooks.set(itemId, next);
        save(key);
      }
      broadcast({ type: 'catalog', items: catalogList(), shops: SHOPS });
      send(ws, { type: 'admin_note', text: `${ITEMS[itemId].name} look updated.` });
      return send(ws, { type: 'item_look_set', item: itemId, look: (next.icon || next.color) ? next : null });
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
      addNpc(HOBGOBLIN_DEF.name, 'goblins'); // Tree Guardian chain (2026-11-24)
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
    // ----- Stage 40: City Idea commissions -----
    // An admin posts an idea (short text + a rough area); the bots
    // decide for themselves whether to build toward it (see the
    // Stage 40 bot section). Ideas persist on the posting admin's
    // profile and aggregate into the cityIdeas registry at boot.
    if (m.type === 'city_ideas') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'Only admins can view City Ideas.' });
      return send(ws, cityIdeasMsg());
    }
    if (m.type === 'city_idea_post') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'Only admins can post a City Idea.' });
      const text = String(m.text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (text.length < 3) return send(ws, { type: 'error', message: 'Give the idea a few words first.' });
      const zone = CITY_IDEA_AREAS[String(m.area || '')];
      if (!zone) return send(ws, { type: 'error', message: 'Pick an area for the idea.' });
      const openCount = [...cityIdeas.values()].filter((e) => e.rec.status === 'open').length;
      if (openCount >= CITY_IDEA_MAX_OPEN) return send(ws, { type: 'error', message: `There are already ${CITY_IDEA_MAX_OPEN} open City Ideas — let the bots finish one first.` });
      ensureV2(profile);
      const rec = {
        id: `idea_${++ideaSeq}`, text, area: String(m.area), by: profile.username,
        at: Date.now(), placed: 0, target: CITY_IDEA_TARGET, contributors: {}, status: 'open',
      };
      profile.cityIdeas.push(rec);
      cityIdeas.set(rec.id, { rec, ownerKey: key });
      save(key);
      pushCityIdeas();
      return send(ws, { type: 'admin_note', text: `City Idea posted: "${text}" (${zone.label}). The bots will make of it what they will.` });
    }
    if (m.type === 'city_idea_cancel') {
      if (!isAdminOrOwner(profile)) return send(ws, { type: 'error', message: 'Only admins can cancel a City Idea.' });
      const entry = cityIdeas.get(String(m.id || ''));
      if (!entry || entry.rec.status !== 'open') return send(ws, { type: 'error', message: 'No such open City Idea.' });
      entry.rec.status = 'cancelled';
      save(entry.ownerKey);
      pushCityIdeas();
      return send(ws, { type: 'admin_note', text: `City Idea cancelled: "${entry.rec.text}".` });
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
      send(ws, { type: 'whisper', from: profile.username, to: target.profile.username, text });
      // NPC build: a whispered NPC player may whisper back (free
      // talk), and a whispered help question gets the fitted path.
      if (target.bot) { try { onPlayerWhisper(key, me, targetKey, text); } catch (e) { /* talk never breaks whispers */ } }
      return;
    }

    // ----- Friends list (2026-11-23): instant-add / remove -----
    // Names are validated against the game's register rules, then
    // resolved to an EXISTING account — a name with no account is
    // a clear error and stores nothing. The canonical username
    // (the account's own spelling) is what lands on the profile.
    if (m.type === 'friend_add') {
      const raw = String(m.name || '').trim();
      if (!/^[A-Za-z0-9_ ]{3,16}$/.test(raw)) return send(ws, { type: 'error', message: 'That name doesn\'t look right — 3–16 letters, numbers, underscores or spaces.' });
      const tKey = userKeyFor(raw);
      if (tKey === key) return send(ws, { type: 'error', message: 'You can\'t add yourself as a friend.' });
      const tUser = db.users[tKey];
      if (!tUser) return send(ws, { type: 'error', message: `No player named "${raw}" — check the spelling.` });
      const canon = tUser.profile.username;
      ensureV2(profile);
      if (profile.friends.some((f) => userKeyFor(f) === tKey)) return send(ws, { type: 'error', message: `${canon} is already your friend.` });
      if (profile.friends.length >= FRIENDS_MAX) return send(ws, { type: 'error', message: `Your friends list is full (${FRIENDS_MAX}) — remove someone first.` });
      profile.friends.push(canon);
      save(key);
      pushFriends(key, true);
      return send(ws, { type: 'chat', from: 'Game', text: `💚 ${canon} added to your friends.` });
    }
    if (m.type === 'friend_remove') {
      const raw = String(m.name || '').trim();
      const tKey = userKeyFor(raw);
      ensureV2(profile);
      const idx = profile.friends.findIndex((f) => userKeyFor(f) === tKey);
      if (idx < 0) return send(ws, { type: 'error', message: `${raw} isn't on your friends list.` });
      const [canon] = profile.friends.splice(idx, 1);
      save(key);
      pushFriends(key, true);
      return send(ws, { type: 'chat', from: 'Game', text: `💔 ${canon} removed from your friends.` });
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
        // Stage 33: the VIEWER's head-to-head record vs the examined
        // player ({ w, l } from the viewer's perspective; null when
        // the two have never dueled — the sheet then shows no row).
        h2h: h2hVs(profile, target.profile.username),
        player: {
          username: target.profile.username, role: effectiveRole(target.profile), area: target.area,
          combatLevel: Math.round(combatLevelOf(levels) * 100) / 100,
          totalLevel: SKILLS.reduce((t, s) => t + levels[s], 0),
          wins: target.profile.wins, losses: target.profile.losses, rating: target.profile.rating,
          style: target.profile.style, worn: { ...target.profile.worn }, inDuel: !!target.duelId,
          // Stage 37: a bot's best friend (relations >= the friend
          // threshold), or null. Additive field — older clients
          // simply ignore it.
          bestFriend: target.profile.bot ? botBestFriend(target.profile) : null,
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
      if (isWildArea(me.area) || isWildArea(target.area)) return send(ws, { type: 'error', message: '💀 No party invites in the Wilderness.' }); // Stage 30
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
      if (isWildArea(me.area) || isWildArea(target.area)) return send(ws, { type: 'error', message: '💀 No trading in the Wilderness — cross the ditch to safety first.' }); // Stage 30
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
        botRememberDecline(req.fromKey, key); // a bot initiator remembers a player's refusal too
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
        requests: {},
        expires: Date.now() + 120000, timer: null,
      };
      trade.timer = setTimeout(() => { if (trades.has(trade.id)) cancelTrade(trade, 'Trade timed out.'); }, 120000);
      if (trade.timer.unref) trade.timer.unref();
      trades.set(trade.id, trade);
      send(fromSess.ws, tradeOpenPayload(trade, req.fromKey, profile.username));
      return send(ws, tradeOpenPayload(trade, key, fromSess.profile.username));
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
    // Trade inventories: tapping an item in the PARTNER's backpack
    // asks them for it (qty is the new total ask; 0 clears it). The
    // ask is recorded and shown to both sides — it never moves
    // anything by itself and never touches either confirm. A human
    // partner answers by offering the item themselves (their tap,
    // their confirm — the anti-scam rules are untouched). A bot
    // partner answers through its own offer code: the asked item
    // goes into the bot's offer, and the bot's usual pricing /
    // confirm / walk-away logic decides whether the completed
    // trade is worth it — and a bot with a deal goal of its own
    // may re-make its side on its next act tick, as it does now.
    if (m.type === 'trade_request_item') {
      const trade = trades.get(String(m.tradeId || ''));
      if (!trade || (trade.aKey !== key && trade.bKey !== key)) return send(ws, { type: 'error', message: 'That trade is gone.' });
      const partnerKey = trade.aKey === key ? trade.bKey : trade.aKey;
      const partnerUser = db.users[partnerKey];
      if (!partnerUser) return send(ws, { type: 'error', message: 'That trade is gone.' });
      const item = String(m.item || '');
      const qty = Math.floor(+m.qty || 0);
      if (qty < 0) return send(ws, { type: 'error', message: 'Invalid quantity.' });
      if (item === 'gold') {
        if (qty > goldTotal(partnerUser.profile)) return send(ws, { type: 'error', message: 'They don\'t have that much gold.' });
      } else {
        const def = itemDef(item);
        if (!def) return send(ws, { type: 'error', message: 'Unknown item.' });
        if (def.kind === 'note') return send(ws, { type: 'error', message: NOTE_PERSONAL_MSG }); // Stage 9: notes are personal
        if (qty > stackQty(partnerUser.profile.backpack || [], item)) return send(ws, { type: 'error', message: 'They don\'t have that many.' });
      }
      const asks = tradeAsksOf(trade, key).filter((s) => s.item !== item);
      if (qty > 0) asks.push({ item, qty });
      trade.requests[key] = asks;
      const bot = bots.get(partnerKey);
      if (bot && item !== 'gold' && qty > 0) {
        const cur = trade.offers[partnerKey];
        const merged = new Map(cur.items.map((s) => [s.item, s.qty]));
        const held = stackQty(bot.profile.backpack || [], item);
        merged.set(item, Math.max(merged.get(item) || 0, Math.min(qty, held)));
        const newItems = [...merged.entries()].filter(([, q]) => q > 0).map(([i, q]) => ({ item: i, qty: q }));
        if (botSetTradeOffer(bot, trade, { gold: cur.gold, items: newItems })) return; // sends the update itself
      }
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
      if (isWildArea(me.area) || isWildArea(target.area)) return send(ws, { type: 'error', message: '💀 No duels in the Wilderness — cross the ditch to safety first.' }); // Stage 30
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
      const ch = { id, from: key, to: targetKey, stake, items, itemsTo: [], rules: cleanDuelRules(m.rules), freePlay, confirm: { from: false, to: false }, expires: Date.now() + CHALLENGE_WINDOW_MS };
      challenges.set(id, ch);
      send(target.ws, { type: 'challenge_incoming', challengeId: id, from: profile.username, stake, items, rules: ch.rules, freePlay: ch.freePlay, seconds: Math.round(CHALLENGE_WINDOW_MS / 1000), h2h: h2hVs(target.profile, profile.username) }); // Stage 33: the challenged player's own record vs the challenger
      broadcastChallenging(key, targetKey); // Stage 7C: '!' over the challenger
      pushChallengeTerms(ch); // both screens open on the same terms
      send(ws, { type: 'chat', from: 'Game', text: freePlay ? `Challenge sent to ${target.profile.username} — 🆓 free play, no stakes.` : `Challenge sent to ${target.profile.username} for ${stake}g${items.length ? ' + items' : ''}.` });
    }
    if (m.type === 'challenge_response') {
      const ch = challenges.get(m.challengeId);
      if (!ch || ch.to !== key || ch.expires < Date.now()) { if (ch) broadcastChallengeClear(ch.from); challenges.delete(m.challengeId); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      if (isWildArea(me.area)) { challenges.delete(m.challengeId); broadcastChallengeClear(ch.from); return send(ws, { type: 'error', message: '💀 No duels in the Wilderness.' }); } // Stage 30
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
      ch.expires = Date.now() + CHALLENGE_WINDOW_MS;
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
      ch.expires = Date.now() + CHALLENGE_WINDOW_MS; // an active negotiation stays alive
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
      ch.expires = Date.now() + CHALLENGE_WINDOW_MS;
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
      if (isWildArea(me.area)) return send(ws, { type: 'error', message: '💀 The Stake Board is in the plaza — there is no staking in the Wilderness.' }); // Stage 30
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
      if (isWildArea(me.area) || isWildArea(poster.area)) return send(ws, { type: 'error', message: '💀 No stake matches with a player in the Wilderness.' }); // Stage 30
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
  }

  ws.on('close', () => {
    // A replaced session's socket closing must not clean up the
    // session that took its place (see takeover in the connection
    // handler above).
    const cur = online.get(key);
    if (cur && cur.ws !== ws) return;
    cleanupDisconnect(key);
  });
});


// ---------- Stage 37: living NPC players (bots) ----------
// Derek's design (2026-11-20): the online world gains NPCs that act
// FOR players — they live in the world as persistent accounts, train
// skills, gather and sell, post and take Stake Board offers, answer
// player challenges and duel each other, all through the SAME
// systems humans use (the duel engine, the challenge flow, the
// Stake Board, the party system, the gold helpers). A bot is a real
// profile in the store (profile.bot === true) plus a server-side
// session in `online` whose socket is a stub: every server send to
// it is a no-op, and the bot brain (below) drives the session by
// mirroring the exact state mutations the message handlers perform
// for a human. Bots never log in via sockets, hold no token, and
// are excluded from /api/leaderboard and /api/hiscores (they are
// world actors, not ranked competitors) — but examine, challenges,
// parties and the tap-player menu all treat them as players,
// because to the snapshot they ARE players.
//
// AUTONOMY (Derek, same day): bots are not scripted puppets. Each
// bot carries persisted TRAITS (aggression, greed, loyalty,
// ambition, sociability, risk — 0..100, rolled at creation inside
// persona-flavoured ranges, never reset) and every decision — what
// to train, when to sell, whether a stake is worth it, who to
// befriend, party with, gift, or challenge — is a choice computed
// from traits + current state + a random roll through the helpers
// below (botScore / botPickWeighted / botMaxStake). There are no
// admin controls over bot decisions and no pre-scripted pairings.
//
// FRIENDSHIP (Derek, same day): bot profiles carry a relations map
// ({ otherBotName: score }, -100..100). Scores grow when two bots
// train/gather in the same area, finish a Free Play duel together,
// party, or exchange gifts; they decay very slowly toward 0 when a
// pair never interacts. At FRIEND_THRESHOLD a pair counts as
// friends: friends prefer each other's areas, party up, and trade
// small gifts. The heavy deal-making (and betrayal) is a later
// stage; the trait + relations foundation lands here.
//
// TEST HOOK: BOT_TEST_FAST=1 speeds the bot clocks (activity
// lengths, scheduler intervals, movement, gather cooldowns) by
// BOT_TIME_SCALE so test/stage37.js can watch a living world in
// minutes. It defaults OFF — production timing is untouched.
const BOT_TIME_SCALE = process.env.BOT_TEST_FAST === '1' ? 12 : 1;
const BOT_TICK_MS = TICK_MS; // the brain runs on the game tick
const BOT_WALK_SPEED = 7.5; // units per second — the game's walk pace
const BOT_RUN_SPEED = 15; // units per second — the game's run pace
const BOT_BROKE_GOLD = 50; // below this a bot drops everything and earns (brief §7)
const BOT_CHAT_GAP_MS = 3000 / BOT_TIME_SCALE; // at most one bot chat line per area per few seconds
const BOT_EAT_HP = 40; // duel HP at/below which a bot reaches for food
const BOT_ACCEPT_MIN_AGE_MS = 20000 / BOT_TIME_SCALE; // a Stake Board offer must age this long before a bot takes it (keeps bots from sniping offers meant for a human's partner)
const FRIEND_THRESHOLD = 30; // relations score at which two bots count as friends
const BOT_REL_MIN = -100, BOT_REL_MAX = 100;
const BOT_REL_TRAIN_TICK = 1; // points per relations tick for two bots training/gathering in one area
const BOT_REL_TRAIN_CAP_PER_HOUR = 6; // co-training gains cap per pair per hour (scaled by BOT_TIME_SCALE like every bot clock)
const BOT_REL_FREEPLAY_DUEL = 4; // points when two bots finish a Free Play duel together
const BOT_REL_GIFT = 3; // points when one bot gifts another
const BOT_REL_DECAY_AFTER_MS = 10 * 60 * 1000; // a pair that has not interacted this long starts forgetting
const BOT_GIFT_EVERY_MS = 300000; // per-bot minimum gap between gifts (scaled)
const BOT_GIFT_MAX_GOLD = 25; // a gift is small: at most ~25g of value
const BOT_PARTY_EVERY_MS = 120000; // per-bot minimum gap between friend party invites (scaled)
const BOT_POST_EVERY_MS = 240000; // per-bot minimum gap between Stake Board posts (scaled)
const BOT_BVB_MIN_MS = 180000, BOT_BVB_MAX_MS = 420000; // the bot-vs-bot pairing window (scaled)

// The roster: the app version's nine named rivals (engine.ts
// RIVALS), carried over with their combat levels, starting purses
// (bank0), ratings and stake bands. Kits are the online gear ids
// nearest their app tier. Trait ranges are persona-flavoured:
// Zara/Dario proud and risk-hungry, Sapphire Knight cautious and
// loyal, PvM Shadow greedy and unsociable, IronNoob timid.
const BOT_ROSTER = [
  { name: 'IronNoob', cbt: 38, gold: 300, rating: 820, style: 'accurate', tier: 0, stakeMin: 10, stakeMax: 60,
    kit: { weapon: 'bronze_sword', head: 'bronze_helm', body: 'bronze_platebody', legs: 'bronze_platelegs' },
    traits: { aggression: [15, 40], greed: [30, 55], loyalty: [40, 70], ambition: [20, 45], sociability: [45, 75], risk: [10, 35] } },
  { name: 'Bronze Bella', cbt: 52, gold: 520, rating: 950, style: 'aggressive', tier: 0, stakeMin: 15, stakeMax: 90,
    kit: { weapon: 'iron_sword', head: 'bronze_helm', body: 'bronze_platebody', legs: 'bronze_platelegs' },
    traits: { aggression: [35, 60], greed: [55, 80], loyalty: [35, 60], ambition: [40, 65], sociability: [55, 85], risk: [30, 55] } },
  { name: 'Ember Finn', cbt: 58, gold: 650, rating: 1010, style: 'controlled', tier: 0, stakeMin: 20, stakeMax: 110,
    kit: { weapon: 'iron_sword', head: 'iron_helm', body: 'iron_platebody', legs: 'iron_platelegs' },
    traits: { aggression: [40, 65], greed: [35, 60], loyalty: [50, 75], ambition: [50, 75], sociability: [50, 80], risk: [35, 60] } },
  { name: 'Steel Marcus', cbt: 67, gold: 820, rating: 1080, style: 'aggressive', tier: 1, stakeMin: 25, stakeMax: 150,
    kit: { weapon: 'steel_sword', head: 'steel_helm', body: 'steel_platebody', legs: 'steel_platelegs' },
    traits: { aggression: [50, 75], greed: [45, 70], loyalty: [30, 55], ambition: [55, 80], sociability: [30, 60], risk: [40, 65] } },
  { name: 'PvM Shadow', cbt: 74, gold: 1100, rating: 1180, style: 'accurate', tier: 1, stakeMin: 40, stakeMax: 200,
    kit: { weapon: 'steel_sword', head: 'mithril_helm', body: 'mithril_platebody', legs: 'mithril_platelegs' },
    traits: { aggression: [45, 70], greed: [60, 85], loyalty: [15, 40], ambition: [60, 85], sociability: [15, 40], risk: [45, 70] } },
  { name: 'Sapphire Knight', cbt: 81, gold: 1500, rating: 1290, style: 'defensive', tier: 1, stakeMin: 50, stakeMax: 260,
    kit: { weapon: 'mithril_sword', head: 'mithril_helm', body: 'mithril_platebody', legs: 'mithril_platelegs' },
    traits: { aggression: [40, 60], greed: [25, 50], loyalty: [55, 80], ambition: [55, 75], sociability: [40, 65], risk: [10, 30] } },
  { name: 'Rune Rachel', cbt: 88, gold: 2000, rating: 1380, style: 'controlled', tier: 2, stakeMin: 75, stakeMax: 350,
    kit: { weapon: 'adamant_sword', head: 'rune_helm', body: 'rune_platebody', legs: 'rune_platelegs' },
    traits: { aggression: [45, 70], greed: [40, 65], loyalty: [45, 70], ambition: [65, 90], sociability: [35, 60], risk: [35, 60] } },
  { name: 'Dragon Dario', cbt: 94, gold: 2600, rating: 1470, style: 'aggressive', tier: 2, stakeMin: 100, stakeMax: 450,
    kit: { weapon: 'rune_scimitar', head: 'dragon_helm', body: 'dragon_platebody', legs: 'dragon_platelegs' },
    traits: { aggression: [60, 85], greed: [50, 75], loyalty: [25, 50], ambition: [70, 90], sociability: [40, 65], risk: [55, 80] } },
  { name: 'Champion Zara', cbt: 99, gold: 4000, rating: 1560, style: 'accurate', tier: 2, stakeMin: 150, stakeMax: 600,
    kit: { weapon: 'dragon_sword', head: 'dragon_helm', body: 'dragon_platebody', legs: 'dragon_platelegs', feet: 'dragon_boots' },
    traits: { aggression: [65, 90], greed: [30, 55], loyalty: [60, 85], ambition: [80, 99], sociability: [45, 70], risk: [60, 85] } },
  // NPC build (Derek, 2026-11-23): five more players from his
  // family's old RuneScape days, living the same life as the nine
  // above. Flavours beyond their identities are Muse's colouring
  // (flagged to Derek): the aunt warm and chatty, the cousin young
  // and eager, the uncle laid-back, 6 d9 a veteran of the old days.
  // branman3's flavour is Derek's own words: a sneaky guy, always
  // ready to trick you for a fast buck — his trickery lives in his
  // chat and in the OFFERS he makes through the real trade system
  // (def.shady drives lowball openings + a hard rate in
  // botTradeRate / botTradeGoalOffer / botTradeDrive). The trade
  // window, escrow and confirmations are never touched by it.
  { name: '6 d9', cbt: 63, gold: 750, rating: 1040, style: 'controlled', tier: 1, stakeMin: 20, stakeMax: 130,
    kit: { weapon: 'steel_sword', head: 'steel_helm', body: 'steel_platebody', legs: 'steel_platelegs' },
    traits: { aggression: [35, 60], greed: [35, 60], loyalty: [45, 70], ambition: [35, 60], sociability: [50, 75], risk: [25, 50] } },
  { name: 'imatoad', cbt: 47, gold: 480, rating: 910, style: 'defensive', tier: 0, stakeMin: 10, stakeMax: 80,
    kit: { weapon: 'iron_sword', head: 'iron_helm', body: 'iron_platebody', legs: 'bronze_platelegs' },
    traits: { aggression: [20, 45], greed: [25, 50], loyalty: [60, 85], ambition: [25, 50], sociability: [65, 90], risk: [15, 40] } },
  { name: 'branman3', cbt: 71, gold: 1350, rating: 1150, style: 'aggressive', tier: 1, stakeMin: 30, stakeMax: 220, shady: true,
    kit: { weapon: 'steel_sword', head: 'mithril_helm', body: 'mithril_platebody', legs: 'mithril_platelegs' },
    traits: { aggression: [45, 70], greed: [70, 95], loyalty: [5, 30], ambition: [55, 80], sociability: [50, 75], risk: [55, 80] } },
  { name: 'imaliltoad', cbt: 33, gold: 260, rating: 780, style: 'aggressive', tier: 0, stakeMin: 5, stakeMax: 50,
    kit: { weapon: 'bronze_sword', head: 'bronze_helm', body: 'bronze_platebody', legs: 'bronze_platelegs' },
    traits: { aggression: [40, 65], greed: [35, 60], loyalty: [45, 70], ambition: [60, 85], sociability: [60, 85], risk: [45, 70] } },
  { name: 'papa4life', cbt: 57, gold: 880, rating: 1000, style: 'defensive', tier: 1, stakeMin: 20, stakeMax: 120,
    kit: { weapon: 'steel_sword', head: 'iron_helm', body: 'iron_platebody', legs: 'iron_platelegs' },
    traits: { aggression: [25, 50], greed: [30, 55], loyalty: [50, 75], ambition: [20, 45], sociability: [45, 70], risk: [10, 35] } },
];
const BOT_KEYS = new Set(BOT_ROSTER.map((d) => d.name.toLowerCase()));
const bots = new Map(); // key -> brain { key, def, sess, profile, plan, planUntil, ... }
let botsReady = false;
const botChatLastAt = new Map(); // area -> last bot chat line timestamp (the anti-spam throttle)
const botRelGainWindow = new Map(); // pairKey -> { start, total } co-training cap bookkeeping (session-only)
const botRelLastTouch = new Map(); // pairKey -> last interaction timestamp (session-only, drives decay)
let botBvbNextAt = 0; // next bot-vs-bot pairing attempt

function botPairKey(aKey, bKey) { return aKey < bKey ? aKey + '|' + bKey : bKey + '|' + aKey; }
function botRandInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function botDelay(minMs, maxMs) { return minMs + Math.random() * (maxMs - minMs); }
function botXpForLevel(l) { return XP_TABLE[Math.max(1, Math.min(99, Math.floor(l)))] || 0; }

// ----- traits + the shared decision helpers -----
// Every bot choice in this stage funnels through these: a score is
// 50 plus each consulted trait's pull ((trait-50) x coefficient)
// plus a mood jitter, or a weighted pick among options whose
// weights the caller derived from traits and state. Nothing in the
// bot brain rolls a naked Math.random() for a DECISION without
// traits in the mix.
function botTrait(profile, name) {
  const t = profile && profile.traits;
  const v = t ? +t[name] : NaN;
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
}
function botScore(bot, terms) {
  let s = 50 + (Math.random() * 20 - 10);
  for (const [trait, coef] of Object.entries(terms || {})) s += (botTrait(bot.profile, trait) - 50) * coef;
  return s;
}
function botPickWeighted(bot, entries) {
  // entries: [{ value, weight }] — weights already carry the traits.
  let total = 0;
  for (const e of entries) { e.weight = Math.max(0, +e.weight || 0); total += e.weight; }
  if (total <= 0) return entries[Math.floor(Math.random() * entries.length)].value;
  let r = Math.random() * total;
  for (const e of entries) { r -= e.weight; if (r <= 0) return e.value; }
  return entries[entries.length - 1].value;
}
// The most gold this bot will put on ONE duel right now. The
// brief's comfort cap (25% of its gold) is the CENTRE: risk, greed
// and aggression stretch it (a proud, greedy bot stakes over half
// its purse), caution shrinks it toward 2%, and a ±10% mood jitter
// keeps it human. It can never exceed the gold the bot actually
// has — willingness is not money.
function botMaxStake(bot) {
  const gold = goldTotal(bot.profile);
  let ratio = 0.25
    + (botTrait(bot.profile, 'risk') - 50) / 200
    + (botTrait(bot.profile, 'greed') - 50) / 400
    + (botTrait(bot.profile, 'aggression') - 50) / 500;
  ratio = Math.max(0.02, Math.min(0.9, ratio));
  ratio *= 0.9 + Math.random() * 0.2;
  return Math.max(0, Math.min(gold, Math.floor(gold * ratio)));
}
function rollBotTraits(def) {
  const out = {};
  for (const [trait, range] of Object.entries(def.traits)) out[trait] = botRandInt(range[0], range[1]);
  return out;
}
// Backfill for bot profiles: traits and relations exist from
// creation; an older or hand-edited record gains whatever is
// missing WITHOUT resetting what is already there (traits and
// scores, once rolled/earned, are permanent).
function ensureBotProfile(p, def) {
  if (!p.traits || typeof p.traits !== 'object' || Array.isArray(p.traits)) p.traits = def ? rollBotTraits(def) : {};
  for (const trait of ['aggression', 'greed', 'loyalty', 'ambition', 'sociability', 'risk']) {
    const v = +p.traits[trait];
    if (!Number.isFinite(v)) p.traits[trait] = def ? botRandInt(def.traits[trait][0], def.traits[trait][1]) : 50;
    else p.traits[trait] = Math.max(0, Math.min(100, Math.floor(v)));
  }
  if (!p.relations || typeof p.relations !== 'object' || Array.isArray(p.relations)) p.relations = {};
  for (const [name, score] of Object.entries(p.relations)) {
    const v = Math.floor(+score);
    if (!name || !Number.isFinite(v)) delete p.relations[name];
    else p.relations[name] = Math.max(BOT_REL_MIN, Math.min(BOT_REL_MAX, v));
  }
}
function botRelation(profile, otherName) {
  const r = profile && profile.relations;
  if (!r || typeof r !== 'object') return 0;
  if (typeof r[otherName] === 'number') return r[otherName];
  const want = String(otherName || '').toLowerCase();
  for (const k of Object.keys(r)) if (k.toLowerCase() === want) return r[k];
  return 0;
}
function botBumpRelation(aBot, bBot, pts) {
  if (!aBot || !bBot || aBot === bBot || !pts) return;
  for (const [me, other] of [[aBot, bBot], [bBot, aBot]]) {
    if (!me.profile.relations || typeof me.profile.relations !== 'object') me.profile.relations = {};
    const cur = botRelation(me.profile, other.profile.username);
    me.profile.relations[other.profile.username] = Math.max(BOT_REL_MIN, Math.min(BOT_REL_MAX, cur + pts));
    save(me.key);
  }
  botRelLastTouch.set(botPairKey(aBot.key, bBot.key), Date.now());
}
// The examine sheet's "Friends with X": the bot's strongest friend
// at or above the threshold, or null. (Humans have no relations
// map; the examine handler only asks for bot targets.)
function botBestFriend(profile) {
  if (!profile || !profile.relations) return null;
  let best = null, bestScore = FRIEND_THRESHOLD - 1;
  for (const [name, score] of Object.entries(profile.relations)) {
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

// ----- bot chat (throttled per area, across all bots) -----
function botSay(bot, text) {
  const area = bot.sess.area;
  const now = Date.now();
  if (now - (botChatLastAt.get(area) || 0) < BOT_CHAT_GAP_MS) return false;
  botChatLastAt.set(area, now);
  broadcast({ type: 'chat', from: bot.profile.username, text });
  return true;
}

// ----- creation + sessions -----
function botStartXp(def) {
  const xp = defaultXp();
  const L = Math.max(1, Math.min(92, Math.round(def.cbt / 1.15)));
  xp.attack = botXpForLevel(L); xp.strength = botXpForLevel(L); xp.defence = botXpForLevel(L);
  xp.hitpoints = botXpForLevel(Math.max(10, L));
  xp.prayer = botXpForLevel(Math.max(1, def.tier * 9));
  // Persona flavour in the side skills: Rachel is the mage, Shadow
  // the ranger; everyone gathers a little (more by tier).
  xp.magic = botXpForLevel(def.name === 'Rune Rachel' ? L : Math.max(1, L - 15));
  xp.ranged = botXpForLevel(def.name === 'PvM Shadow' ? L : Math.max(1, L - 15));
  const gath = Math.max(1, 3 + def.tier * 6);
  xp.mining = botXpForLevel(gath); xp.woodcutting = botXpForLevel(gath); xp.fishing = botXpForLevel(gath);
  xp.cooking = botXpForLevel(gath); xp.firemaking = botXpForLevel(gath); xp.smithing = botXpForLevel(Math.max(1, gath - 2));
  xp.fletching = botXpForLevel(Math.max(1, gath - 2));
  return xp;
}
function botStartPack(def) {
  if (def.tier <= 0) return [['ration', 2]];
  if (def.tier === 1) return [['ration', 3], ['prayer_potion', 1]];
  return [['ration', 4], ['prayer_potion', 2], ['restore_potion', 1]];
}
// The stub socket: send() swallows everything the server pushes
// (the brain polls the authoritative maps instead), and isAlive is
// a getter that always reads true so the Stage 34 heartbeat never
// reaps a bot. readyState 1 keeps send() itself a clean no-op.
function makeBotSocket() {
  const sock = {
    readyState: 1, bufferedAmount: 0,
    send() {}, ping() {}, terminate() {}, close() {},
  };
  Object.defineProperty(sock, 'isAlive', { get: () => true, set: () => {} });
  return sock;
}
function spawnBotSession(def, profile) {
  const key = def.name.toLowerCase();
  const idx = BOT_ROSTER.indexOf(def);
  const offsets = [[-120, -60], [120, -60], [-60, 80], [60, 80], [0, -140], [-180, 40], [180, 40], [-40, -20], [40, -20]];
  const [ox, oy] = offsets[idx % offsets.length];
  const sess = {
    ws: makeBotSocket(), profile,
    x: Math.max(0, Math.min(WORLD_W, AREAS.plaza.spawn.x + ox)), y: Math.max(0, Math.min(WORLD_H, AREAS.plaza.spawn.y + oy)), area: 'plaza',
    duelId: null, modDuelId: null, npcFightId: null, fcRunId: null, lastActionAt: 0, smithing: null, lastSmithHitAt: 0, lastReheatAt: 0,
    barrowsFightId: null, barrowsPuzzle: null, barrowsPuzzleShown: false, barrowsCrypt: null, barrowsHp: null, barrowsDoorRolled: false,
    accDrain: 0, strDrain: 0, runDrainedUntil: 0, actSkill: null, actAt: 0, castReadyAt: 0, frozenUntil: 0,
    wildPairs: null, wildTarget: null, skulled: false, teleblockUntil: 0, wildHp: null, wildMaxHp: 0,
    lastJumpAt: 0, bot: true,
  };
  online.set(key, sess);
  bots.set(key, {
    key, def, sess, profile,
    plan: null, planUntil: 0, target: null, // the activity state machine
    challengeDecisions: new Map(), // challengeId -> { at, verdict, responded }
    tradeDecisions: new Map(), // Stage 38: trade request id -> { at, verdict }
    tradeState: null, // Stage 38: the open trade this bot is currently working
    lastDealAt: Date.now(), lastWildAt: Date.now(), // Stage 38: deal / wild-trip clocks (start at spawn — a fresh boot does not burst)
    wildTrip: null, wildEatAt: 0, // Stage 38: the current Wilderness trip, if any
    stakeReadyAt: 0, stakeSeenMatch: null, // stake-match ready-up timing
    lastGiftAt: 0, lastPostAt: 0, lastPartyInviteAt: 0,
    lastPvmAt: Date.now(), pvm: null, fcJadSeen: null, pvmEatAt: 0, // Stage 39: the current Barrows / Fight Caves attempt, if any
    lastBuildAt: 0, lastIdeaAt: 0, lastTalkAt: 0, greetedAt: new Map(), ideaIn: new Set(), // Stage 40: city/social clocks (session-only)
    // NPC build: free-talk clocks (session-only). lastReplyAt —
    // last time this bot answered a player's chat/whisper;
    // replyAtBy — per-player reply cooldowns; bbAt — per-pair
    // bot-to-bot exchange cooldowns; guideTipAt — per-player
    // unsolicited-guidance cooldowns (Part C).
    lastReplyAt: 0, replyAtBy: new Map(), whisperAtBy: new Map(), bbAt: new Map(), guideTipAt: new Map(),
    wasInDuel: false,
  });
}
// Boot: create any missing bot accounts (a bot name a HUMAN already
// registered is left strictly alone — that account is a person's,
// so the bot is skipped with a warning), backfill the survivors,
// and put every bot in the world. Runs inside store.init, before
// the server starts listening, so a human registering a bot's name
// always finds it taken.
function initBots() {
  for (const def of BOT_ROSTER) {
    const key = def.name.toLowerCase();
    const u = db.users[key];
    if (u && !u.profile.bot) {
      console.error(`Stage 37: bot "${def.name}" skipped — a human account already owns that name.`);
      continue;
    }
    if (!u) {
      const salt = crypto.randomBytes(16).toString('hex');
      const profile = newProfile(def.name);
      profile.bot = true;
      profile.backpack = [{ item: 'gold', qty: def.gold }]; // the persona purse replaces the 100g starter stack
      profile.gold = def.gold;
      profile.rating = def.rating;
      profile.style = def.style;
      profile.xp = botStartXp(def);
      profile.appearance = { ...cleanAppearance({ gender: BOT_ROSTER.indexOf(def) % 2, hair: BOT_ROSTER.indexOf(def) % 3, beard: 0, skin: BOT_ROSTER.indexOf(def) % 3, torso: BOT_ROSTER.indexOf(def) % 6, arms: 0, legs: 0, feet: 0 }, null), chosen: true };
      profile.worn = { ...emptyWorn(), ...def.kit };
      for (const [item, qty] of botStartPack(def)) addStacks(profile.backpack, item, qty, BACKPACK_MAX_STACKS);
      profile.traits = rollBotTraits(def);
      profile.relations = {};
      db.users[key] = { salt, passHash: hashPass(crypto.randomBytes(24).toString('hex'), salt), profile };
      save(key);
    } else {
      ensureBotProfile(u.profile, def);
      save(key);
    }
    spawnBotSession(def, db.users[key].profile);
  }
  botBvbNextAt = Date.now() + botDelay(BOT_BVB_MIN_MS, BOT_BVB_MAX_MS) / BOT_TIME_SCALE;
  botsReady = true;
}

// ----- movement -----
// Step the bot toward a point at walk/run pace (the game's own
// speeds). Returns true once it is standing on the spot. A frozen
// bot (a player's Freeze in a duel) does not move, like a player.
function botStepToward(bot, tx, ty, run) {
  const sess = bot.sess;
  if ((sess.frozenUntil || 0) > Date.now()) return false;
  const dx = tx - sess.x, dy = ty - sess.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const step = Math.min(d, (run ? BOT_RUN_SPEED : BOT_WALK_SPEED) * BOT_TIME_SCALE * (BOT_TICK_MS / 1000));
  sess.x = Math.max(0, Math.min(WORLD_W, sess.x + (dx / d) * step));
  sess.y = Math.max(0, Math.min(WORLD_H, sess.y + (dy / d) * step));
  bot.moved = true;
  return d - step <= 1.5;
}
// Changing area is a plain arrival at the new area's spawn (the
// brief's reading: the bot simply appears in the new snapshot).
function botTravelTo(bot, area) {
  bot.sess.area = area;
  bot.sess.x = AREAS[area].spawn.x;
  bot.sess.y = AREAS[area].spawn.y;
  bot.moved = true;
  if (area !== 'plaza') completeStarterGoal(bot.key, 'visit_area'); // the same first-trip goal a human earns
}

// Week 2 (D17): a bot that wants to mine but owns no pickaxe buys a
// bronze one at Pickaxe Pete's — the current catalogue price a
// player pays, from its own coin stacks (mirrors botRestock's buy
// loop). Returns true when the bot holds a pickaxe afterwards.
function botBuyPickaxe(bot) {
  const profile = bot.profile;
  if (bestPickaxeSpeed(profile) > 0) return true;
  const price = currentBuyPrice('bronze_pickaxe');
  if (goldTotal(profile) < price) return false;
  if (addStacks(profile.backpack, 'bronze_pickaxe', 1, BACKPACK_MAX_STACKS) > 0) return false; // pack full — shop_buy refuses too
  takeGold(profile, price);
  noteDemand('bronze_pickaxe', 1, +1); // Pricing: a bot's shop buy is trade activity, like a human's
  save(bot.key);
  return true;
}

// ----- gathering / training (mirrors the 'gather' handler) -----
function botGatherOnce(bot, node) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.area !== node.area) return 'gone';
  if (Math.hypot(sess.x - node.x, sess.y - node.y) > GATHER_RANGE) { botStepToward(bot, node.x, node.y, false); return 'moving'; }
  if (node.depletedUntil > Date.now()) return 'depleted';
  const level = levelForXp((profile.xp && profile.xp[node.skill]) || 0);
  if (level < node.levelReq) return 'locked';
  let cooldownMs = ACTION_COOLDOWN_MS / BOT_TIME_SCALE;
  if (node.skill === 'mining') {
    // Week 2 (D17): bots follow the same rule as players — no
    // pickaxe, no mining. The plan drive answers 'nopick' (buy one,
    // or go chop / fish instead).
    const speed = bestPickaxeSpeed(profile);
    if (speed <= 0) return 'nopick';
    cooldownMs = cooldownMs / speed;
  }
  if (actionOnCooldown(sess, cooldownMs)) return 'cooling';
  const pickBonus = node.skill === 'mining' ? Math.max(0, (bestPickaxeSpeed(profile) - 1) * 0.1) : 0;
  const chance = Math.max(0.55, Math.min(0.95, 0.55 + 0.02 * (level - node.levelReq) + pickBonus));
  if (Math.random() > chance) return 'missed';
  if (node.chargesLeft !== Infinity) {
    node.chargesLeft -= 1;
    if (node.chargesLeft <= 0) { node.chargesLeft = 0; node.depletedUntil = Date.now() + node.respawnMs; }
    broadcastNodes(node.area);
  }
  if (node.item) {
    const leftover = addStacks(profile.backpack, node.item, 1, BACKPACK_MAX_STACKS);
    if (leftover > 0) addStacks(profile.bank, node.item, leftover);
  }
  const before = levelForXp((profile.xp && profile.xp[node.skill]) || 0);
  addXp(key, { [node.skill]: node.xp });
  const after = levelForXp((profile.xp && profile.xp[node.skill]) || 0);
  if (after > before) botSay(bot, `Just hit ${after} ${cap(node.skill)}!`);
  if (node.item) completeStarterGoal(key, 'gather');
  save(key);
  sess.actSkill = node.skill; sess.actAt = Date.now();
  bot.moved = true; // the activity marker changed — the area should see it
  return 'ok';
}
// Everything in the backpack the shops will buy (at sellPrice),
// minus the supplies a bot keeps for duels (food / potions ride
// along; worn gear is not in the backpack anyway).
function botSellableStacks(bot) {
  return bot.profile.backpack.filter((s) => s.item !== 'gold' && sellPrice(s.item) > 0
    && itemDef(s.item) && itemDef(s.item).kind !== 'food' && itemDef(s.item).kind !== 'potion');
}
function botSellGoods(bot) {
  const profile = bot.profile;
  let sold = 0;
  for (const s of [...botSellableStacks(bot)]) {
    // Stage 38: deal-grade stock (unit market value at the deal
    // drive's single-item threshold) is NOT dumped at the shop for
    // 60% — a bot holds it for the trade market, where it fetches
    // full value. Gathered goods still liquidate as before.
    if (botMarketValue(s.item) >= BOT_DEAL_GRADE) continue;
    const price = sellPrice(s.item);
    if (!price || !removeStacks(profile.backpack, s.item, s.qty)) continue;
    addGold(profile, price * s.qty); // the payment lands on the coin stack, like a human's sale
    noteDemand(s.item, s.qty, -1); // Pricing: a bot's shop sale is trade activity, like a human's
    sold += s.qty;
  }
  if (sold) save(bot.key);
  return sold;
}
// Bank visit (mirrors bank_deposit): gathered goods go to the bank,
// plus any backpack gold above the bot's walking-around float.
function botBankVisit(bot) {
  const profile = bot.profile;
  let moved = false;
  for (const s of [...botSellableStacks(bot)]) {
    if (botMarketValue(s.item) >= BOT_DEAL_GRADE) continue; // Stage 38: deal-grade stock stays in the backpack, where trades can reach it
    if (removeStacks(profile.backpack, s.item, s.qty)) { addStacks(profile.bank, s.item, s.qty); moved = true; }
  }
  if (moved) completeStarterGoal(bot.key, 'use_bank');
  const keep = Math.max(100, Math.floor(goldTotal(profile) * 0.4));
  const packGold = stackQty(profile.backpack, 'gold');
  const excess = Math.min(packGold, Math.max(0, goldTotal(profile) - keep));
  if (excess > 0 && removeStacks(profile.backpack, 'gold', excess)) { addStacks(profile.bank, 'gold', excess); moved = true; }
  if (moved) save(bot.key);
  return moved;
}

// ----- the activity state machine -----
// A plan is { kind, area, nodeId, x, y, until }: travel to the
// spot, work it until the clock runs out, then choose again. Every
// choice is weighted by traits + state through botPickWeighted —
// ambition pulls to combat training, greed to gathering and
// selling, sociability to wherever friends are.
const BOT_SHOP_SPOT = { x: 1150, y: 300 }; // plaza flavour spot for selling (the shop handlers are position-free)
const BOT_BANK_SPOT = { x: 800, y: 450 }; // the bank chest at the plaza spawn
function botNodesForSkill(bot, skill) {
  const level = levelForXp((bot.profile.xp && bot.profile.xp[skill]) || 0);
  return [...NODES.values()].filter((n) => n.skill === skill && n.levelReq <= level);
}
function botPickNode(bot, skill) {
  const cands = botNodesForSkill(bot, skill);
  if (!cands.length) return null;
  const entries = cands.map((node) => {
    let w = 10 + node.xp / 5;
    // Friends pull: a friend working this area makes it likelier,
    // scaled by how sociable this bot is.
    for (const other of bots.values()) {
      if (other === bot || other.sess.area !== node.area) continue;
      if (botRelation(bot.profile, other.profile.username) >= FRIEND_THRESHOLD) w += botTrait(bot.profile, 'sociability') * 0.4;
    }
    return { value: node, weight: w };
  });
  return botPickWeighted(bot, entries);
}
function botFriendInArea(bot, area) {
  for (const other of bots.values()) {
    if (other !== bot && other.sess.area === area && botRelation(bot.profile, other.profile.username) >= FRIEND_THRESHOLD) return other;
  }
  return null;
}
function botPickPlan(bot) {
  const profile = bot.profile, sess = bot.sess;
  const gold = goldTotal(profile);
  const sellables = botSellableStacks(bot).reduce((t, s) => t + s.qty, 0);
  const broke = gold < BOT_BROKE_GOLD;
  const entries = [];
  if (sellables >= 4 || (broke && sellables > 0)) entries.push({ value: 'sell', weight: 30 + botTrait(profile, 'greed') * 0.3 });
  if (profile.backpack.length >= 22) entries.push({ value: 'bank', weight: 25 });
  if (!broke) {
    entries.push({ value: 'combat', weight: 18 + botTrait(profile, 'ambition') * 0.5 });
    entries.push({ value: 'idle', weight: 8 + botTrait(profile, 'sociability') * 0.15 });
    // Stage 40: hanging out in the plaza is a plan of its own for
    // sociable bots — a loose cluster near the bank / dais where
    // the greetings and small talk live (see botSocialDrive).
    entries.push({ value: 'social', weight: 3 + botTrait(profile, 'sociability') * 0.4 });
  }
  entries.push({ value: 'gather', weight: 20 + botTrait(profile, 'greed') * 0.5 });
  const kind = botPickWeighted(bot, entries);
  const dur = (kind === 'idle' ? botDelay(20000, 60000) : botDelay(45000, 120000)) / BOT_TIME_SCALE;
  if (kind === 'sell') return { kind, area: 'plaza', x: BOT_SHOP_SPOT.x, y: BOT_SHOP_SPOT.y, until: 0, dur: 6000 / BOT_TIME_SCALE };
  if (kind === 'bank') return { kind, area: 'plaza', x: BOT_BANK_SPOT.x, y: BOT_BANK_SPOT.y, until: 0, dur: 6000 / BOT_TIME_SCALE };
  if (kind === 'idle') return { kind, area: sess.area, x: sess.x, y: sess.y, until: Date.now() + dur, dur };
  if (kind === 'social') {
    const spots = [{ x: 800, y: 330 }, { x: 690, y: 520 }, { x: 910, y: 520 }, { x: 770, y: 250 }, { x: 850, y: 610 }, { x: 720, y: 390 }, { x: 880, y: 390 }];
    const s = spots[Math.floor(Math.random() * spots.length)];
    return { kind, area: 'plaza', x: s.x + botRandInt(-50, 50), y: s.y + botRandInt(-40, 40), until: 0, dur: botDelay(60000, 150000) / BOT_TIME_SCALE };
  }
  const skill = kind === 'combat'
    ? botPickWeighted(bot, ['attack', 'strength', 'defence', 'ranged', 'magic'].map((s) => ({ value: s, weight: 10 + botTrait(profile, 'ambition') * 0.2 + (30 - Math.min(30, levelForXp(profile.xp[s] || 0))) })))
    : botPickWeighted(bot, ['mining', 'woodcutting', 'fishing'].map((s) => ({ value: s, weight: 10 + botTrait(profile, 'greed') * 0.3 + (30 - Math.min(30, levelForXp(profile.xp[s] || 0))) })));
  const node = botPickNode(bot, skill);
  if (!node) return { kind: 'idle', area: sess.area, x: sess.x, y: sess.y, until: Date.now() + dur, dur };
  // Stand at the node — or beside a friend who is already there.
  let sx = node.x, sy = node.y;
  const friend = botFriendInArea(bot, node.area);
  if (friend && Math.random() * 100 < botTrait(profile, 'sociability')) { sx = friend.sess.x + botRandInt(-35, 35); sy = friend.sess.y + botRandInt(-35, 35); }
  return { kind: 'train', area: node.area, nodeId: node.id, skill, x: sx, y: sy, until: 0, dur };
}
function botPlanDrive(bot) {
  const sess = bot.sess, now = Date.now();
  if (!bot.plan) { bot.plan = botPickPlan(bot); return; }
  const plan = bot.plan;
  if (sess.area !== plan.area) { botTravelTo(bot, plan.area); return; }
  const atSpot = Math.hypot(sess.x - plan.x, sess.y - plan.y) <= (plan.kind === 'train' ? GATHER_RANGE * 0.8 : 12);
  if (!atSpot) { botStepToward(bot, plan.x, plan.y, Math.hypot(sess.x - plan.x, sess.y - plan.y) > 300); return; }
  if (!plan.until) plan.until = now + plan.dur;
  if (plan.kind === 'train') {
    const node = NODES.get(plan.nodeId);
    if (!node) { bot.plan = null; return; }
    const r = botGatherOnce(bot, node);
    if (r === 'nopick') {
      // Week 2 (D17): mining needs a pickaxe now. Buy a bronze one if
      // the purse allows; otherwise switch this plan to chopping or
      // fishing rather than stalling at the rock face.
      if (!botBuyPickaxe(bot)) {
        const altSkill = ['woodcutting', 'fishing'].find((s) => botNodesForSkill(bot, s).length);
        const alt = altSkill ? botPickNode(bot, altSkill) : null;
        if (alt) bot.plan = { ...plan, area: alt.area, nodeId: alt.id, skill: altSkill, x: alt.x, y: alt.y };
        else bot.plan = null;
      }
      return;
    }
    if (r === 'depleted' || r === 'locked' || r === 'gone') {
      // Hop to another node for the same skill, or give up the plan.
      const alt = botPickNode(bot, plan.skill);
      if (alt && alt.id !== node.id) { bot.plan = { ...plan, area: alt.area, nodeId: alt.id, x: alt.x, y: alt.y }; }
      else bot.plan = null;
    }
  } else if (plan.kind === 'sell') {
    if (!plan.done) { botSellGoods(bot); botRestock(bot); plan.done = true; } // Stage 38: restock duel supplies while at the shops
  } else if (plan.kind === 'bank') {
    if (!plan.done) { botBankVisit(bot); botRestock(bot); plan.done = true; } // Stage 38: same on a bank trip (the shops are position-free)
  } else if (plan.kind === 'idle' || plan.kind === 'social') {
    // Wander the current area in short ambles; in the plaza this is
    // also where the Stake Board habits live (see botPlazaHabits).
    // A social plan ambles in a tighter radius — the bot is hanging
    // around its cluster spot, not roaming the whole area.
    const ambleX = plan.kind === 'social' ? 130 : 260, ambleY = plan.kind === 'social' ? 100 : 200;
    if (!plan.wp || Math.hypot(sess.x - plan.wp.x, sess.y - plan.wp.y) < 10) {
      plan.wp = { x: Math.max(60, Math.min(WORLD_W - 60, sess.x + botRandInt(-ambleX, ambleX))), y: Math.max(60, Math.min(WORLD_H - 60, sess.y + botRandInt(-ambleY, ambleY))) };
    }
    botStepToward(bot, plan.wp.x, plan.wp.y, false);
  } else if (plan.kind === 'build') {
    // Stage 40: walk to the chosen spot and place the object. The
    // plan carries a deadline (plan.until was set at creation, so
    // the generic expiry below also applies); placement itself
    // re-validates gold, caps and clearance on arrival — the world
    // may have changed on the way over.
    const ideaEntry = plan.ideaId ? cityIdeas.get(plan.ideaId) : null;
    if (plan.ideaId && (!ideaEntry || ideaEntry.rec.status !== 'open')) bot.plan = null;
    else if (atSpot) {
      botPlaceObject(bot, plan.propKind, plan.area, plan.x, plan.y, ideaEntry);
      bot.plan = null;
    }
  }
  if (now > plan.until) bot.plan = null;
}
// Plaza habits: occasionally post a Stake Board offer,
// occasionally take an aged open offer. Each habit is its own
// trait-weighted choice on its own clock.
function botPlazaHabits(bot) {
  const now = Date.now(), sess = bot.sess, profile = bot.profile;
  const purse = goldTotal(profile);
  // Post an offer. Week 2 A2: the SIZE is the bot's own choice,
  // scaled to the purse it holds right now — a trait-weighted
  // fraction of its gold (cautious bots live in the pocket band,
  // proud/greedy ones reach for the bold band), rounded to a
  // human-looking 5g step and capped by the comfort cap
  // (botMaxStake) and by the gold it actually has. Low-purse bots
  // therefore post genuine pocket-change offers (10–50g) a fresh
  // player can afford, instead of a fixed per-name band. The
  // nerve to post scales with the share on the line: a pocket
  // stake is an easy yes even for a timid bot, a bold one still
  // takes real nerve. (A bot at/below the broke line does not
  // post at all — it is off earning, per botPickPlan.)
  if (now - bot.lastPostAt > BOT_POST_EVERY_MS / BOT_TIME_SCALE && !openStakeOfferForKey(bot.key) && !stakeMatchForKey(bot.key)
    && purse > BOT_BROKE_GOLD) {
    const risk = botTrait(profile, 'risk'), greed = botTrait(profile, 'greed'),
      aggression = botTrait(profile, 'aggression'), ambition = botTrait(profile, 'ambition');
    const frac = botPickWeighted(bot, [
      { value: 0.02 + Math.random() * 0.04, weight: 30 + (50 - risk) * 0.4 + (50 - aggression) * 0.2 }, // pocket: 2–6% of purse
      { value: 0.06 + Math.random() * 0.07, weight: 26 }, // small: 6–13%
      { value: 0.13 + Math.random() * 0.12, weight: 14 + greed * 0.2 + ambition * 0.15 }, // standard: 13–25%
      { value: 0.25 + Math.random() * 0.15, weight: 4 + risk * 0.25 + greed * 0.15 }, // bold: 25–40%
    ]);
    const stake = Math.min(botMaxStake(bot), Math.round(purse * frac / 5) * 5, purse);
    if (stake >= 5) {
      const share = stake / purse;
      const nerve = 62 - Math.round((1 - Math.min(1, share * 4)) * 30); // pocket share -> ~38, share >= 25% -> 62
      if (botScore(bot, { greed: 0.3, risk: 0.4, aggression: 0.2 }) > nerve) { botStakePost(bot, stake); bot.lastPostAt = now; }
    }
  }
  // Take an aged open offer (never one a human just posted for a
  // partner — it must have sat on the board a while). Week 2 A2:
  // a SMALL stake is an easy yes — the nerve a bot needs falls as
  // the offer shrinks relative to its purse, so a fresh player's
  // 25g offer reads as pocket change the low-purse bots happily
  // fight for, not just bait for the rich and reckless. The
  // comfort cap and the gold check still bind first: willingness
  // is not money, and no bot stakes gold it does not have.
  if (!stakeMatchForKey(bot.key)) {
    for (const o of stakeOffers.values()) {
      if (o.status !== 'open' || o.fromKey === bot.key || now - o.createdAt < BOT_ACCEPT_MIN_AGE_MS) continue;
      if (o.stake > botMaxStake(bot) || purse < o.stake) continue;
      const share = purse > 0 ? o.stake / purse : 1;
      const nerve = 58 - Math.round((1 - Math.min(1, share * 3)) * 26); // pocket share -> ~32, share >= 33% -> 58
      if (botScore(bot, { risk: 0.4, aggression: 0.3 }) > nerve) { botStakeAccept(bot, o); break; }
    }
  }
}
// Friend habits, in ANY area: party up with a friend who is here,
// gift a friend who is here. Each on its own clock, each a
// trait-weighted choice (sociability invites, loyalty gives,
// greed holds back).
function botFriendHabits(bot) {
  const now = Date.now(), sess = bot.sess;
  if (now - bot.lastPartyInviteAt > BOT_PARTY_EVERY_MS / BOT_TIME_SCALE && !partyOf.has(bot.key)) {
    const friend = botFriendInArea(bot, sess.area);
    if (friend && !partyOf.has(friend.key) && botScore(bot, { sociability: 0.5, loyalty: 0.2 }) > 50) {
      botPartyInvite(bot, friend.key);
      bot.lastPartyInviteAt = now;
    }
  }
  if (now - bot.lastGiftAt > BOT_GIFT_EVERY_MS / BOT_TIME_SCALE) {
    const friend = botFriendInArea(bot, sess.area);
    if (friend && botScore(bot, { loyalty: 0.6, greed: -0.4, sociability: 0.2 }) > 52) {
      if (botGift(bot, friend)) bot.lastGiftAt = now;
    }
  }
}
// A small gift to a friend (mirrors the stack/gold helpers only):
// a few gathered resources from the backpack, or a little gold.
// Returns true when something actually changed hands.
function botGift(bot, friend) {
  const profile = bot.profile, fProfile = friend.profile;
  const goods = botSellableStacks(bot);
  if (goods.length && Math.random() < 0.7) {
    const s = goods[Math.floor(Math.random() * goods.length)];
    const qty = Math.min(s.qty, botRandInt(1, 3));
    if (!removeStacks(profile.backpack, s.item, qty)) return false;
    addItemToProfile(fProfile, s.item, qty);
    save(bot.key); save(friend.key);
    botBumpRelation(bot, friend, BOT_REL_GIFT);
    botSay(bot, `got you, ${fProfile.username} — fresh ${itemDef(s.item).name.toLowerCase()}.`);
    return true;
  }
  const gold = goldTotal(profile);
  if (gold > 150) {
    const amt = Math.min(BOT_GIFT_MAX_GOLD, botRandInt(5, BOT_GIFT_MAX_GOLD), gold - 100);
    if (amt >= 1 && takeGold(profile, amt)) {
      addGold(fProfile, amt);
      save(bot.key); save(friend.key);
      botBumpRelation(bot, friend, BOT_REL_GIFT);
      botSay(bot, `got you, ${fProfile.username} — ${amt}g for the road.`);
      return true;
    }
  }
  return false;
}

// ----- duels: driving a fighter (mirrors duel_attack + use + prayer) -----
function botDuelDrive(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  const duel = sess.duelId ? duels.get(sess.duelId) : null;
  if (!duel) return;
  bot.wasInDuel = true;
  const oppKey = duel.a === key ? duel.b : duel.a;
  const opp = online.get(oppKey);
  const myStyle = attackStyleOf(profile);
  // Engage: exactly the duel_attack handler's mutation. Bots tap
  // in proactively, as a player would; since 2026-11-22 being
  // swung at also auto-engages (the duel tick), and the engaged
  // guard below keeps the two from ever double-arming a swing.
  if (!(duel.rules && duel.rules['no' + cap(myStyle)]) && !duel.engaged[key]) {
    duel.engaged[key] = true;
    duel.nextSwingAt[key] = Math.max(COUNTDOWN_TICKS, duel.tickCount) + 1;
  }
  if (duel.tickCount <= COUNTDOWN_TICKS) return; // the countdown freezes everyone
  // Close to my own style's reach of the opponent (a No Movement
  // duel starts toe-to-toe and nobody runs anyway).
  if (opp && !(duel.rules && duel.rules.noMovement)) {
    const d = Math.hypot(sess.x - opp.x, sess.y - opp.y);
    if (d > styleRange(myStyle) * 0.8) {
      const ap = approachPoint(sess.x, sess.y, opp.x, opp.y);
      botStepToward(bot, ap.x, ap.y, true);
    }
  }
  // Eat / drink when hurt — through the mirrored 'use' logic below.
  const hp = duel.hp[key];
  if (hp <= BOT_EAT_HP) {
    if (!(duel.rules && duel.rules.noFood)) {
      const food = ['ration', 'cooked_trout', 'cooked_shrimps'].filter((i) => stackQty(profile.backpack, i) > 0)
        .sort((a, b) => (itemDef(b).heal || 0) - (itemDef(a).heal || 0))[0];
      if (food) botUseInDuel(bot, food);
    }
    if (duel.hp[key] <= BOT_EAT_HP && !(duel.rules && duel.rules.noPotions) && stackQty(profile.backpack, 'restore_potion') > 0) {
      botUseInDuel(bot, 'restore_potion');
    }
  }
  // Prayer: the upper personas (Steel tier and up) pray the Deflect
  // that matches the OPPONENT's weapon style, and sip a prayer
  // potion when the points run low.
  if (bot.def.tier >= 1 && !(duel.rules && duel.rules.noPrayer)) {
    const oppStyle = opp ? attackStyleOf(opp.profile) : 'melee';
    const want = oppStyle === 'ranged' ? 'missiles' : oppStyle;
    if (profile.prayerPoints > 0 && profile.activePrayer !== want) {
      profile.activePrayer = want;
      save(key);
      broadcastState();
    }
    if (profile.activePrayer && profile.prayerPoints < 8 && !(duel.rules && duel.rules.noPotions)) botUseInDuel(bot, 'prayer_potion');
  }
}
// The duel-relevant slice of the 'use' handler, mirrored for a bot:
// duel rules gate first, prayer potions restore points, food and
// restore potions heal the duel pool, and both fighters get the
// same echo tick a human's use sends.
function botUseInDuel(bot, item) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  const def = itemDef(item);
  if (!def || (def.kind !== 'food' && def.kind !== 'potion')) return false;
  if (stackQty(profile.backpack, item) < 1) return false;
  const duel = sess.duelId ? duels.get(sess.duelId) : null;
  if (!duel) return false;
  if (duel.rules) {
    if (duel.rules.noFood && def.kind === 'food') return false;
    if (duel.rules.noPotions && def.kind === 'potion') return false;
  }
  if (def.prayerRestore) {
    if (profile.prayerPoints >= profile.prayerMax) return false;
    removeStacks(profile.backpack, item, 1);
    profile.prayerPoints = Math.min(profile.prayerMax, profile.prayerPoints + def.prayerRestore);
    save(key);
    sendProfile(key);
    return true;
  }
  if (duel.hp[key] >= 99) return false;
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
  sendProfile(key);
  return true;
}

// ----- challenges (mirrors of the human handlers, bot side) -----
function botDecideChallenge(bot, ch) {
  if (bot.sess.duelId || bot.sess.modDuelId || stakeMatchForKey(bot.key)) return 'decline';
  if (ch.freePlay) return 'accept'; // a practice fight costs nothing — bots take it
  return ch.stake <= botMaxStake(bot) ? 'accept' : 'decline';
}
function botDeclineChallenge(bot, ch, tooRich) {
  challenges.delete(ch.id);
  broadcastChallengeClear(ch.from);
  const fromP = online.get(ch.from);
  if (fromP) {
    send(fromP.ws, { type: 'chat', from: 'Game', text: `${bot.profile.username} declined. No gold or items were taken.` });
    send(fromP.ws, { type: 'challenge_closed', challengeId: ch.id });
  }
  if (tooRich) botSay(bot, botPickWeighted(bot, [
    { value: 'Too rich for me.', weight: 10 },
    { value: 'That stake? No chance.', weight: 10 - botTrait(bot.profile, 'aggression') * 0.05 },
    { value: 'I would lose my boots. No.', weight: 6 },
  ]));
}
function botCancelChallenge(bot, ch) {
  challenges.delete(ch.id);
  broadcastChallengeClear(ch.from);
  const other = online.get(ch.from === bot.key ? ch.to : ch.from);
  if (other) {
    send(other.ws, { type: 'chat', from: 'Game', text: `${bot.profile.username} cancelled the challenge. No gold or items were taken.` });
    send(other.ws, { type: 'challenge_closed', challengeId: ch.id });
  }
}
// The second-confirm validation + startDuel, mirrored from the
// challenge_confirm handler for when the BOT's confirm is the one
// that completes the pair.
function botStartConfirmedChallenge(ch) {
  const fromSess = online.get(ch.from), toSess = online.get(ch.to);
  if (!fromSess || !toSess) { challenges.delete(ch.id); broadcastChallengeClear(ch.from); return; }
  const fail = (msg) => {
    ch.confirm.from = false; ch.confirm.to = false;
    pushChallengeTerms(ch);
    for (const s of [fromSess, toSess]) if (!s.bot) send(s.ws, { type: 'error', message: msg });
  };
  if (fromSess.duelId || toSess.duelId) return fail('One of you is already in a duel.');
  if (fromSess.modDuelId || toSess.modDuelId) return fail('One of you is already in a duel.');
  if (fromSess.npcFightId || toSess.npcFightId) return fail('One of you is fighting a monster.');
  if (fromSess.barrowsFightId || toSess.barrowsFightId) return fail('One of you is fighting a Barrows brother.');
  if (fromSess.fcRunId || toSess.fcRunId) return fail('One of you is in the Fight Caves.');
  if (goldTotal(db.users[ch.from].profile) < ch.stake || goldTotal(db.users[ch.to].profile) < ch.stake) return fail('Someone no longer has the gold.');
  if (!hasItems(db.users[ch.from].profile, ch.items)) return fail('The challenger no longer has the staked items.');
  if (!hasItems(db.users[ch.to].profile, ch.itemsTo)) return fail('The challenged player no longer has the staked items.');
  challenges.delete(ch.id);
  broadcastChallengeClear(ch.from);
  // Friendship: two bots who fight a Free Play duel together grow
  // a little closer, win or lose.
  if (ch.freePlay && bots.has(ch.from) && bots.has(ch.to)) botBumpRelation(bots.get(ch.from), bots.get(ch.to), BOT_REL_FREEPLAY_DUEL);
  startDuel(ch.from, ch.to, ch.stake, ch.items, ch.itemsTo, null, ch.rules, ch.freePlay);
}
function botChallengeDrive(bot, ch) {
  const key = bot.key, now = Date.now();
  if (ch.expires < now) { // the lazy expiry the handlers apply on access
    challenges.delete(ch.id);
    broadcastChallengeClear(ch.from);
    bot.challengeDecisions.delete(ch.id);
    return;
  }
  let dec = bot.challengeDecisions.get(ch.id);
  if (!dec) {
    dec = { at: now + botDelay(1000, 3000), verdict: null, responded: false };
    bot.challengeDecisions.set(ch.id, dec);
  }
  if (now < dec.at) return;
  if (dec.verdict === null) dec.verdict = botDecideChallenge(bot, ch);
  if (dec.verdict === 'decline') {
    if (ch.to === key) botDeclineChallenge(bot, ch, !ch.freePlay && ch.stake > botMaxStake(bot));
    else botCancelChallenge(bot, ch);
    bot.challengeDecisions.delete(ch.id);
    return;
  }
  // Accepting. Terms may have moved since the decision (the other
  // side is still editing): a stake that has grown past this bot's
  // willingness is cancelled, never silently swallowed.
  if (!ch.freePlay && ch.stake > botMaxStake(bot)) { botCancelChallenge(bot, ch); bot.challengeDecisions.delete(ch.id); return; }
  if (ch.to === key && !dec.responded) { ch.expires = now + CHALLENGE_WINDOW_MS; dec.responded = true; pushChallengeTerms(ch); }
  const side = ch.from === key ? 'from' : 'to';
  if (!ch.confirm[side]) {
    if (applyChallengeTerms(ch, key, {})) { botCancelChallenge(bot, ch); bot.challengeDecisions.delete(ch.id); return; }
    ch.confirm[side] = true;
    ch.expires = now + CHALLENGE_WINDOW_MS;
    if (ch.confirm.from && ch.confirm.to) { botStartConfirmedChallenge(ch); bot.challengeDecisions.delete(ch.id); }
    else pushChallengeTerms(ch);
  }
}
// A bot-initiated challenge (bot-vs-bot pairings), built exactly
// like the 'challenge' handler builds it.
function botCreateChallenge(bot, targetKey, stake, freePlay) {
  const target = online.get(targetKey);
  if (!target || targetKey === bot.key) return null;
  if (isWildArea(bot.sess.area) || isWildArea(target.area)) return null;
  if (bot.sess.duelId || target.duelId || bot.sess.modDuelId || target.modDuelId) return null;
  if (!freePlay && (stake < 1 || stake > goldTotal(bot.profile) || stake > goldTotal(target.profile))) return null;
  const id = crypto.randomBytes(6).toString('hex');
  const ch = { id, from: bot.key, to: targetKey, stake: freePlay ? 0 : stake, items: [], itemsTo: [], rules: cleanDuelRules(null), freePlay: !!freePlay, confirm: { from: false, to: false }, expires: Date.now() + CHALLENGE_WINDOW_MS };
  challenges.set(id, ch);
  send(target.ws, { type: 'challenge_incoming', challengeId: id, from: bot.profile.username, stake: ch.stake, items: [], rules: ch.rules, freePlay: ch.freePlay, seconds: Math.round(CHALLENGE_WINDOW_MS / 1000), h2h: h2hVs(target.profile, bot.profile.username) });
  broadcastChallenging(bot.key, targetKey);
  pushChallengeTerms(ch);
  return ch;
}
// The pairing scheduler: every few minutes two idle plaza bots are
// matched — the challenger is picked for aggression/ambition, the
// opponent by rivalry (a grudge pulls) or friendship (friends lean
// Free Play), the stake by both purses' willingness. At most one
// bot-vs-bot duel runs at a time; endDuel's own broadcast is the
// one result line.
function botPairingDrive(now) {
  if (now < botBvbNextAt) return;
  botBvbNextAt = now + botDelay(BOT_BVB_MIN_MS, BOT_BVB_MAX_MS) / BOT_TIME_SCALE;
  for (const b of bots.values()) {
    if (!b.sess.duelId) continue;
    const duel = duels.get(b.sess.duelId);
    if (duel && bots.has(duel.a) && bots.has(duel.b)) return; // one at a time
  }
  const idle = [...bots.values()].filter((b) => b.sess.area === 'plaza' && !b.sess.duelId && !stakeMatchForKey(b.key)
    && !b.pvm // Stage 39: a bot committed to a Barrows / Fight Caves attempt is not pairing fodder
    && !(b.wildTrip && b.wildTrip.state === 'enter') // Stage 38: committed to a Wilderness trip — not pairing fodder
    && !activeTradeForKey(b.key) && !pendingTradeForKey(b.key) // Stage 38: a bot working a trade is not idle — a duel would cancel it
    && ![...challenges.values()].some((ch) => ch.from === b.key || ch.to === b.key));
  if (idle.length < 2) return;
  const challenger = botPickWeighted(null, idle.map((b) => ({ value: b, weight: 10 + botTrait(b.profile, 'aggression') * 0.4 + botTrait(b.profile, 'ambition') * 0.3 })));
  const opponents = idle.filter((b) => b !== challenger);
  if (!opponents.length) return;
  const opponent = botPickWeighted(null, opponents.map((b) => {
    const rel = botRelation(challenger.profile, b.profile.username);
    // A grudge (negative score) pulls a proud bot in; a friendship
    // pulls too — those fights just tend to be Free Play.
    return { value: b, weight: 10 + Math.max(0, -rel) * 0.5 + Math.max(0, rel) * 0.2 + botTrait(b.profile, 'aggression') * 0.1 };
  }));
  const friends = botRelation(challenger.profile, opponent.profile.username) >= FRIEND_THRESHOLD;
  const freePlay = friends && Math.random() < 0.5;
  let stake = 0;
  if (!freePlay) {
    stake = Math.min(botMaxStake(challenger), botMaxStake(opponent), botRandInt(challenger.def.stakeMin, challenger.def.stakeMax));
    if (stake < 1) return;
  }
  botCreateChallenge(challenger, opponent.key, stake, freePlay);
}

// ----- Stake Board (mirrors of the human handlers, bot side) -----
function botStakePost(bot, stake) {
  const key = bot.key;
  if (stakeMatchForKey(key) || stakeBusy(bot.sess) || stake < 1 || stake > goldTotal(bot.profile)) return;
  const old = openStakeOfferForKey(key);
  if (old) stakeOffers.delete(old.id);
  const offer = { id: crypto.randomBytes(6).toString('hex'), fromKey: key, stake, createdAt: Date.now(), status: 'open', toKey: null, ready: { from: false, to: false } };
  stakeOffers.set(offer.id, offer);
  broadcastStakeBoard();
  broadcast({ type: 'chat', from: 'Stake Board', text: `${bot.profile.username} offers a ${stake}g fight at the Stake Board — tap the sparkling sign in the south-west of the plaza to take it.` });
}
function botStakeAccept(bot, offer) {
  const key = bot.key, profile = bot.profile;
  if (!offer || offer.status !== 'open' || offer.fromKey === key) return;
  if (stakeMatchForKey(key) || stakeMatchForKey(offer.fromKey)) return;
  const poster = online.get(offer.fromKey);
  if (!poster || stakeBusy(bot.sess) || stakeBusy(poster)) return;
  if (goldTotal(profile) < offer.stake || goldTotal(poster.profile) < offer.stake) return;
  const myOpen = openStakeOfferForKey(key);
  if (myOpen) stakeOffers.delete(myOpen.id);
  offer.status = 'matched';
  offer.toKey = key;
  broadcastStakeBoard();
  for (const k of [offer.fromKey, offer.toKey]) {
    const s = online.get(k);
    if (!s) continue;
    const oppName = db.users[stakeOpponentKey(offer, k)].profile.username;
    send(s.ws, { type: 'stake_matched', matchId: offer.id, opponent: oppName, stake: offer.stake, pot: offer.stake * 2 });
    send(s.ws, { type: 'chat', from: 'Stake Board', text: `🤝 Stake match! ${poster.profile.username} vs ${profile.username} for ${offer.stake}g each — winner takes ${offer.stake * 2}g. Hit Ready when you're set.` });
  }
}
// The stake_ready handler, mirrored: first ready waits in the
// Waiting Area; second ready re-validates and starts the duel.
function botStakeReady(bot, match) {
  const key = bot.key, sess = bot.sess;
  if (!match || match.status !== 'matched' || (match.fromKey !== key && match.toKey !== key)) return;
  if (stakeBusy(sess)) return;
  const isFrom = match.fromKey === key;
  if (isFrom ? match.ready.from : match.ready.to) return; // already ready — just wait
  if (isFrom) match.ready.from = true; else match.ready.to = true;
  if (match.ready.from && match.ready.to) {
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
  moveSessionToArea(sess, 'waiting', isFrom ? 700 : 900, 450);
  const oppName = db.users[stakeOpponentKey(match, key)] ? db.users[stakeOpponentKey(match, key)].profile.username : stakeOpponentKey(match, key);
  send(sess.ws, { type: 'stake_waiting', matchId: match.id, opponent: oppName, stake: match.stake, pot: match.stake * 2 });
  sendStakeMatchUpdate(match);
  broadcastState();
}

// ----- parties (mirrors of the party handlers, bot side) -----
function botPartyInvite(bot, targetKey) {
  const key = bot.key;
  const myPartyId = partyOf.get(key);
  if (myPartyId && parties.get(myPartyId) && parties.get(myPartyId).has(targetKey)) return;
  const staleForTarget = findPartyInviteForTarget(targetKey);
  if (staleForTarget) clearPartyInvite(staleForTarget.inviterKey);
  if (partyInvites.has(key)) clearPartyInvite(key);
  if (!partyOf.has(key)) {
    const partyId = crypto.randomBytes(6).toString('hex');
    parties.set(partyId, new Set([key]));
    partyOf.set(key, partyId);
    sendPartyUpdate(key);
    broadcastState();
  }
  const targetName = db.users[targetKey].profile.username;
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
  const target = online.get(targetKey);
  if (target) send(target.ws, { type: 'party_invite', from: bot.profile.username });
}
function botPartyAnswer(bot, inv) {
  const key = bot.key;
  const inviterKey = inv.inviterKey;
  if (inv.expires < Date.now()) { clearPartyInvite(inviterKey); dissolveSoloParty(inviterKey); return; }
  const inviterBot = bots.get(inviterKey);
  let accept;
  if (inviterBot) accept = botRelation(bot.profile, inviterBot.profile.username) >= FRIEND_THRESHOLD;
  else accept = botScore(bot, { sociability: 0.6 }) > 55; // a human's invite: the sociable ones join
  clearPartyInvite(inviterKey);
  const inviter = online.get(inviterKey);
  if (!accept) {
    if (inviter) send(inviter.ws, { type: 'chat', from: 'Game', text: `${bot.profile.username} declined your party invite.` });
    dissolveSoloParty(inviterKey);
    return;
  }
  if (!inviter) return;
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
    partyChat(mk, `${bot.profile.username} joined the party.`);
  }
  broadcastState();
}
// A party that has scattered to different areas dissolves the
// normal way — the member who finds himself alone leaves.
function botPartyMaintain(bot) {
  const partyId = partyOf.get(bot.key);
  if (!partyId) return;
  const set = parties.get(partyId);
  if (!set || set.size < 2) return;
  for (const mk of set) {
    if (mk === bot.key) continue;
    const other = online.get(mk);
    if (other && other.area === bot.sess.area) return; // still together
  }
  leaveParty(bot.key);
}
function botDeclineTrade(bot, req) {
  clearTimeout(req.timer);
  tradeRequests.delete(req.id);
  botRememberDecline(req.fromKey, bot.key); // a bot initiator remembers the refusal
  const fromSess = online.get(req.fromKey);
  if (fromSess) send(fromSess.ws, { type: 'chat', from: 'Game', text: `${bot.profile.username} declined your trade request.` });
}

// ---------- Stage 38: NPC trading, skill deals, Wilderness society ----------
// Derek's asks (2026-11-20): the NPC players trade — with players
// and with each other — make deals that move what each of them
// needs to the one who needs it, work together in the Wilderness,
// and sometimes betray each other there. The Stage 37 autonomy
// rule still governs every line below: each choice is computed
// from the bot's persisted traits + relations + situation + a
// roll (botScore / botPickWeighted / the trade-rate and betrayal
// maths). Nothing is scripted; there is no admin remote control.
//
// TRADING runs through the REAL Stage 7B flow end to end: the
// brain mirrors the trade_request / trade_response / trade_offer /
// trade_confirm handlers' own state mutations, and every
// settlement — bot↔player and bot↔bot alike — goes through the
// one atomic executeTrade with its re-validation. There is no
// second economy code path and no direct profile poking for
// settlements. A completed trade is remembered in relations via
// botNoteTrade, hooked into executeTrade itself so a trade a
// human confirms last still counts.
//
// VALUE: a bot prices goods at their real market — the shop buy
// price, or the Gold Exchange's live sell-back for Exchange goods
// (botMarketValue); goods it does not need it values at what it
// could actually get for them (botResaleValue). Its exchange rate
// (botTradeRate) is what it demands back per unit given: greed
// pushes it up, friendship (relations >= FRIEND_THRESHOLD) pulls
// it down, and a grudge (relations <= BOT_GRUDGE) refuses at any
// price.
//
// DEALS: a bot short of a consumable it uses (botWants) buys it
// from a bot standing nearby who holds a surplus; a bot holding
// valuable surplus offers it for sale to a solvent partner
// standing nearby (players included). Bots also restock their
// wants at the shops on plaza trips (botRestock, mirroring
// shop_buy), so the consumable pool the deals move around does
// not simply drain away.
//
// THE WILDERNESS: bots enter through botEnterWild — the travel
// handler's own entry sequence (cancelWildPendings, then
// enterWildState: fresh HP pool = Hitpoints level, skull and
// teleblock cleared) — and leave through exitWildCleanup at the
// ditch, exactly like a player. Fights run through the real pair
// engine: botWildAttack mirrors the wild_attack handler check for
// check (bracket, shallow single-way, skull, engage), eating
// mirrors the 'use' handler's wild branch, and death is the
// engine's own wildDeath — keep-3 / drop-everything rules and
// all. Bots never enter Pure Wild in this stage.
//
// TEAM TRIPS + BETRAYAL: a bot whose nerve holds may invite a
// friend standing in the plaza on a Wilderness trip — the friend
// accepts or refuses by its own traits. In the wild, the partner
// shadows the leader and a free bot may defend its partner
// (loyalty roll; the engine decides whether the extra attacker is
// legal at that depth). The betrayal decision (botBetrayalRoll)
// weighs greed + risk against loyalty, scaled by what the friend
// is carrying and how deep they are: a 100-loyalty bot cannot
// pass it, a greed monster nearly always does. A betrayal is an
// ordinary wild attack (the betrayer skulls like anyone striking
// first) plus a relations crash to -85 on BOTH profiles — the
// grudge persists, and it bites later: the betrayed bot refuses
// the betrayer's trade requests and will not confirm a trade
// with them at any price.
const BOT_DEAL_EVERY_MS = 150000; // per-bot gap between deal attempts (scaled like every bot clock)
const BOT_WILD_EVERY_MS = 240000; // per-bot gap between Wilderness-trip decisions (scaled)
const BOT_WILD_TRIP_MIN_MS = 60000, BOT_WILD_TRIP_MAX_MS = 150000; // a trip's length (scaled)
const BOT_TRADE_ACT_MS = 700; // a bot re-reads an open trade at most this often
const BOT_TRADE_STALL_MS = 20000; // a trade with no change this long is abandoned
const BOT_TRADE_INSULT_MS = 6000; // an insulting imbalance held this long is walked out on
const BOT_GRUDGE = -30; // relations at or below this are a grudge
const BOT_REL_TRADE = 2; // relations gained when a trade completes
const BOT_REL_INSULT = -2; // relations lost when a bot walks out of an insulting bot↔bot trade
const BOT_TRADE_FLOAT = 60; // gold a bot keeps back when paying inside a trade / restocking
const BOT_BETRAY_MIN = 78; // the betrayal score that must be beaten
const BOT_BETRAY_CHECK_MS = 6000; // betrayal re-roll cadence while teamed in the wild (scaled)
const BOT_TEAM_GRACE_MS = 30000; // how long a leader waits for its partner to cross before the team counts as over (scaled)
const botDealIntents = new Map(); // tradeId -> { initiatorKey, kind: 'buy'|'sell', item, qty } — what a bot-initiated trade is FOR (server-side only; a human partner sees the trade itself and the bot's chat line)
const BOT_DEAL_GRADE = 150; // unit market value at/above which a stack is deal stock: held for the trade market, never shop-sold or banked away (mirrors the deal drive's single-item sell threshold)
const botRecentDeclines = new Map(); // '<initiatorKey>><partnerKey>' -> timestamp — a bot remembers being refused (or ignored until expiry) and does not re-ask that partner for a while; people don't badger someone who just said no
const BOT_DECLINE_MEMORY_MS = 90000;
function botRecentlyDeclined(initiatorKey, partnerKey) {
  const at = botRecentDeclines.get(initiatorKey + '>' + partnerKey) || 0;
  return Date.now() - at < BOT_DECLINE_MEMORY_MS;
}
function botRememberDecline(initiatorKey, partnerKey) {
  if (bots.has(initiatorKey)) botRecentDeclines.set(initiatorKey + '>' + partnerKey, Date.now());
}

// ----- value, wants, surplus -----
function botMarketValue(item) {
  if (item === 'gold') return 1;
  const def = itemDef(item);
  if (!def) return 0;
  if (def.kind === 'good') return Math.max(1, Math.floor((exchangePrices[item] || 0) * EXCHANGE_SELLBACK)); // the Exchange is this good's real market
  if (def.buy) return currentBuyPrice(item); // Pricing: bots value at CURRENT prices, like every counter
  if (def.sellOnly) return currentSellOnlyPrice(item);
  return sellPrice(item);
}
function botResaleValue(item) {
  if (item === 'gold') return 1;
  const sp = sellPrice(item);
  if (sp > 0) return sp;
  const def = itemDef(item);
  if (!def) return 0;
  if (def.kind === 'good') return Math.max(1, Math.floor((exchangePrices[item] || 0) * EXCHANGE_SELLBACK));
  if (def.kind === 'weapon' || def.kind === 'armour') return 1000; // never-sellable gear still has worth (stackValueOf's rule)
  return 0;
}
// What a bot keeps stocked for its own fights — the same supplies
// botUseInDuel reaches for. Food for everyone, prayer potions for
// the praying tiers, a restore for the top tier.
function botFoodCount(bot) {
  let n = 0;
  for (const s of bot.profile.backpack) { const d = itemDef(s.item); if (d && d.kind === 'food') n += s.qty; }
  return n;
}
function botWantTarget(bot, item) {
  const d = itemDef(item);
  if (d && d.kind === 'food') return 3;
  if (item === 'prayer_potion') return bot.def.tier >= 1 ? 2 : 0;
  if (item === 'restore_potion') return bot.def.tier >= 2 ? 1 : 0;
  return 0;
}
function botWants(bot) {
  const out = [];
  const foodShort = 3 - botFoodCount(bot);
  if (foodShort > 0) out.push({ item: 'ration', qty: foodShort });
  if (bot.def.tier >= 1) { const short = 2 - stackQty(bot.profile.backpack, 'prayer_potion'); if (short > 0) out.push({ item: 'prayer_potion', qty: short }); }
  if (bot.def.tier >= 2) { const short = 1 - stackQty(bot.profile.backpack, 'restore_potion'); if (short > 0) out.push({ item: 'restore_potion', qty: short }); }
  return out;
}
// How much of an item this bot can spare: consumables above its
// own keep-target, anything else it carries (gathered stock — the
// same set botSellGoods sells at the shops). Worn gear is never in
// the backpack, and notes/tokens/gold never move as trade stock.
function botSurplusQty(bot, item) {
  if (item === 'gold') return 0;
  const d = itemDef(item);
  if (!d || d.kind === 'note' || d.kind === 'token' || d.kind === 'currency') return 0;
  const held = stackQty(bot.profile.backpack, item);
  if (d.kind === 'food' || d.kind === 'potion') return Math.max(0, held - botWantTarget(bot, item));
  return held;
}
// The value of an offer TO this bot (incoming: wanted goods at
// market, everything else at resale, gold at face) or FROM this
// bot (outgoing: everything at market, gold at face).
function botValueOfferTo(bot, offer, incoming) {
  let v = Math.max(0, Math.floor(+offer.gold || 0));
  const wants = incoming ? botWants(bot) : null;
  for (const s of offer.items || []) {
    if (incoming) v += (wants.some((w) => w.item === s.item) ? botMarketValue(s.item) : botResaleValue(s.item)) * s.qty;
    else v += botMarketValue(s.item) * s.qty;
  }
  return v;
}
// What this bot demands back per unit it gives, against a named
// partner. Infinity = a grudge: no deal at any price.
function botTradeRate(bot, partnerName) {
  const rel = botRelation(bot.profile, partnerName);
  if (rel <= BOT_GRUDGE) return Infinity;
  let rate = 1 + (botTrait(bot.profile, 'greed') - 50) * 0.004;
  if (rel >= FRIEND_THRESHOLD) rate -= 0.08 + botTrait(bot.profile, 'loyalty') * 0.0012;
  // NPC build: a shady trader (branman3) always drives a harder
  // bargain than his traits alone say — still just an offer price
  // inside the real trade window; the player sees it and decides.
  if (bot.def && bot.def.shady) rate *= 1.3;
  return Math.max(0.55, Math.min(1.6, rate));
}
// One-sided memory for partners who have no relations map of
// their own (humans): the bot remembers them on ITS profile.
function botRemember(bot, otherName, pts) {
  if (!bot || !otherName || !pts) return;
  if (!bot.profile.relations || typeof bot.profile.relations !== 'object') bot.profile.relations = {};
  const cur = botRelation(bot.profile, otherName);
  bot.profile.relations[otherName] = Math.max(BOT_REL_MIN, Math.min(BOT_REL_MAX, cur + pts));
  save(bot.key);
}
// Called from executeTrade itself, after a settlement: both bots
// grow closer; a bot trading with a human remembers the human.
function botNoteTrade(aKey, bKey) {
  const a = bots.get(aKey), b = bots.get(bKey);
  if (a && b) { botBumpRelation(a, b, BOT_REL_TRADE); return; }
  if (a && db.users[bKey]) botRemember(a, db.users[bKey].profile.username, BOT_REL_TRADE);
  else if (b && db.users[aKey]) botRemember(b, db.users[aKey].profile.username, BOT_REL_TRADE);
}
// Restock the duel supplies at the shops (mirrors shop_buy: the
// catalogue price, paid from the coin stacks, pack-full stops the
// purchase) — called on plaza sell/bank trips so the consumables
// the deal economy moves around are replenished like a player's.
function botRestock(bot) {
  const profile = bot.profile;
  let bought = false;
  for (const w of botWants(bot)) {
    const def = itemDef(w.item);
    if (!def || !def.buy) continue;
    let qty = w.qty;
    while (qty > 0) {
      const price = currentBuyPrice(w.item); // Pricing: bots pay the CURRENT price, like a human
      if (goldTotal(profile) - price < BOT_TRADE_FLOAT) break;
      if (addStacks(profile.backpack, w.item, 1, BACKPACK_MAX_STACKS) > 0) break; // pack full — shop_buy refuses too
      takeGold(profile, price);
      noteDemand(w.item, 1, +1); // Pricing: a bot's shop buy is trade activity, like a human's
      qty--; bought = true;
    }
  }
  if (bought) save(bot.key);
}

// ----- trade requests (mirrors of the human handlers, bot side) -----
function botCreateTradeRequest(bot, targetKey) {
  const key = bot.key;
  const target = online.get(targetKey);
  if (!target || targetKey === key) return null;
  if (isWildArea(bot.sess.area) || isWildArea(target.area)) return null; // Stage 30: no trading in the Wilderness
  if (bot.sess.duelId || target.duelId || bot.sess.modDuelId || target.modDuelId) return null;
  if (bot.sess.npcFightId || target.npcFightId || bot.sess.barrowsFightId || target.barrowsFightId || bot.sess.fcRunId || target.fcRunId) return null;
  if (activeTradeForKey(key) || activeTradeForKey(targetKey)) return null;
  if (pendingTradeForKey(key) || pendingTradeForKey(targetKey)) return null;
  const id = crypto.randomBytes(6).toString('hex');
  const req = { id, fromKey: key, toKey: targetKey, expires: Date.now() + 30000, timer: null };
  req.timer = setTimeout(() => {
    if (!tradeRequests.has(id)) return;
    tradeRequests.delete(id);
    botDealIntents.delete(id);
    botRememberDecline(key, targetKey); // ignored until expiry counts as a no for a bot initiator
    const fromSess = online.get(key);
    if (fromSess) send(fromSess.ws, { type: 'chat', from: 'Game', text: `Your trade request to ${target.profile.username} expired.` });
  }, 30000);
  if (req.timer.unref) req.timer.unref();
  tradeRequests.set(id, req);
  send(target.ws, { type: 'trade_incoming', from: bot.profile.username, tradeId: id });
  return req;
}
function botDecideTradeRequest(bot, req) {
  const sess = bot.sess;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId) return 'decline';
  if (isWildArea(sess.area)) return 'decline';
  if (activeTradeForKey(bot.key)) return 'decline';
  const fromSess = online.get(req.fromKey);
  if (!fromSess) return 'decline';
  const rel = botRelation(bot.profile, fromSess.profile.username);
  if (rel <= BOT_GRUDGE) { botSay(bot, `Not after what you did, ${fromSess.profile.username}.`); return 'decline'; } // a grudge refuses outright
  return botScore(bot, { sociability: 0.6 }) + Math.max(0, rel) * 0.2 > 52 ? 'accept' : 'decline';
}
// The trade_response accept path, mirrored: re-check, build the
// trade record with its 120s timer, open it for both sides.
function botAcceptTradeRequest(bot, req) {
  if (!tradeRequests.has(req.id) || req.expires < Date.now()) { clearTimeout(req.timer); tradeRequests.delete(req.id); return; }
  clearTimeout(req.timer);
  tradeRequests.delete(req.id);
  const fromSess = online.get(req.fromKey);
  if (!fromSess) return;
  if (bot.sess.duelId || fromSess.duelId) return;
  if (activeTradeForKey(bot.key) || activeTradeForKey(req.fromKey)) return;
  const trade = {
    id: req.id, aKey: req.fromKey, bKey: bot.key,
    offers: { [req.fromKey]: { gold: 0, items: [] }, [bot.key]: { gold: 0, items: [] } },
    confirmed: { [req.fromKey]: false, [bot.key]: false },
    requests: {},
    expires: Date.now() + 120000, timer: null,
  };
  trade.timer = setTimeout(() => { if (trades.has(trade.id)) cancelTrade(trade, 'Trade timed out.'); }, 120000);
  if (trade.timer.unref) trade.timer.unref();
  trades.set(trade.id, trade);
  send(fromSess.ws, tradeOpenPayload(trade, req.fromKey, bot.profile.username));
  send(bot.sess.ws, tradeOpenPayload(trade, bot.key, fromSess.profile.username));
}
function botTradeRequestsDrive(bot) {
  const now = Date.now();
  for (const req of [...tradeRequests.values()]) {
    if (req.toKey !== bot.key) continue;
    let dec = bot.tradeDecisions.get(req.id);
    if (!dec) { dec = { at: now + botDelay(800, 2500) }; bot.tradeDecisions.set(req.id, dec); }
    if (now < dec.at) continue;
    bot.tradeDecisions.delete(req.id);
    if (botDecideTradeRequest(bot, req) === 'accept') botAcceptTradeRequest(bot, req);
    else botDeclineTrade(bot, req);
  }
  for (const id of [...bot.tradeDecisions.keys()]) if (!tradeRequests.has(id)) bot.tradeDecisions.delete(id);
}
// The trade_offer handler, mirrored: validate against the bot's
// real purse/backpack, set its side, un-confirm BOTH sides.
function botSetTradeOffer(bot, trade, offer) {
  const profile = bot.profile;
  const gold = Math.max(0, Math.floor(+offer.gold || 0));
  if (gold > goldTotal(profile)) return false;
  const items = [];
  for (const e of offer.items || []) {
    const def = itemDef(e.item);
    if (!def || def.kind === 'note') return false; // Stage 9: notes are personal
    const qty = Math.floor(+e.qty || 0);
    if (qty < 1) return false;
    items.push({ item: e.item, qty });
  }
  if (!hasItems(profile, items)) return false;
  trade.offers[bot.key] = { gold, items };
  trade.confirmed[trade.aKey] = false;
  trade.confirmed[trade.bKey] = false;
  sendTradeUpdate(trade);
  return true;
}
// Goods laid out against a partner's gold-only offer: surplus
// stock up to what the gold fairly buys at MY rate (a greedy bot
// lays out less than the gold's face — that margin is its profit).
function botCounterGoods(bot, goldAmount, rate) {
  const target = goldAmount / rate;
  const stacks = botSellableStacks(bot)
    .map((s) => ({ item: s.item, qty: botSurplusQty(bot, s.item), unit: botMarketValue(s.item) }))
    .filter((s) => s.qty > 0 && s.unit > 0)
    .sort((a, b) => a.unit - b.unit);
  const out = [];
  let v = 0;
  for (const s of stacks) {
    if (v >= target) break;
    // Whole units only, and never past the target: an overshooting
    // counter (chunky unit values, rounded up) would price the
    // goods above what the gold fairly buys — and the bot's own
    // confirm rule would then refuse the very counter it made.
    const take = Math.min(s.qty, Math.floor((target - v) / s.unit));
    if (take < 1) continue;
    out.push({ item: s.item, qty: take });
    v += take * s.unit;
  }
  return out;
}
// What this bot wants its side of THIS trade to be, or null to
// leave its side alone: its own deal goal if it started the
// trade, the asked-for goods if its partner started a buy deal,
// nothing for a generic trade (the responder logic handles it).
function botTradeGoalOffer(bot, trade, st, partnerKey) {
  const intent = st.intent;
  if (!intent) return null;
  if (intent.initiatorKey === bot.key) {
    if (intent.kind === 'buy') {
      // Pay for what is actually on the table (a partial fill is
      // priced for the partial amount); greedy bots open low.
      const offered = (trade.offers[partnerKey].items || []).find((s) => s.item === intent.item);
      const qty = offered ? Math.min(intent.qty, offered.qty) : intent.qty;
      let pay = Math.max(1, Math.round(botMarketValue(intent.item) * qty * (1.02 - botTrait(bot.profile, 'greed') * 0.003)));
      // NPC build: a shady buyer opens with a real lowball — a
      // fraction of even the greedy opening. It is only an offer:
      // the trade window shows the true numbers to both sides.
      if (bot.def && bot.def.shady) pay = Math.max(1, Math.round(pay * 0.62));
      // Negotiation: if the seller is holding out, the drive
      // grows st.raiseFactor and the offer climbs toward (never
      // past) the goods' full catalogue value.
      if (st.raiseFactor) pay = Math.min(botMarketValue(intent.item) * qty, Math.round(pay * st.raiseFactor));
      return { gold: Math.min(pay, goldTotal(bot.profile)), items: [] };
    }
    return { gold: 0, items: [{ item: intent.item, qty: intent.qty }] }; // a sell deal: the goods go up
  }
  if (intent.kind === 'buy') {
    // I was asked for something specific: offer my surplus of it.
    const qty = Math.min(intent.qty, botSurplusQty(bot, intent.item));
    return { gold: 0, items: qty > 0 ? [{ item: intent.item, qty }] : [] };
  }
  return null;
}
// Working an open trade: set my side, meet a generic offer,
// confirm when the balance beats my rate, walk away from an
// insult or a stall. One action per act tick, like a person
// reading the window.
function botTradeDrive(bot, trade) {
  const key = bot.key, now = Date.now();
  const partnerKey = trade.aKey === key ? trade.bKey : trade.aKey;
  const partner = online.get(partnerKey);
  if (!partner) { cancelTrade(trade, 'Trade cancelled.'); bot.tradeState = null; botDealIntents.delete(trade.id); return; }
  let st = bot.tradeState;
  if (!st || st.tradeId !== trade.id) {
    st = bot.tradeState = { tradeId: trade.id, lastActAt: 0, lastSig: '', lastChangeAt: now, insultSince: 0, intent: botDealIntents.get(trade.id) || null };
  }
  const sig = JSON.stringify(trade.offers) + '|' + trade.confirmed[trade.aKey] + '|' + trade.confirmed[trade.bKey];
  if (sig !== st.lastSig) { st.lastSig = sig; st.lastChangeAt = now; st.insultSince = 0; st.sameActs = 0; }
  else st.sameActs = (st.sameActs || 0) + 1;
  if (now - st.lastActAt < BOT_TRADE_ACT_MS) return;
  st.lastActAt = now;
  const myOffer = trade.offers[key], theirOffer = trade.offers[partnerKey];
  const partnerName = partner.profile.username;
  const rate = botTradeRate(bot, partnerName);
  // Negotiation pressure: I have gold up, they have goods up, and
  // they still have not confirmed — my price was probably under
  // their line. Grow the raise factor; the goal-offer and generic
  // paths below re-derive my side from it (capped at what the
  // goods are worth, so a bot never bids past catalogue sense).
  if (st.sameActs >= 6 && myOffer.gold > 0 && (theirOffer.items || []).length > 0 && !trade.confirmed[partnerKey]) {
    // NPC build: a shady negotiator raises slower and stops well
    // short of full price — stingy to the end, by character.
    if (bot.def && bot.def.shady) st.raiseFactor = Math.min(1.5, (st.raiseFactor || 1) * 1.08);
    else st.raiseFactor = Math.min(2.5, (st.raiseFactor || 1) * 1.15);
    st.sameActs = 0;
  }
  // 1) Put up my side if this trade has a goal for me and my side
  //    does not match it yet (never re-set an identical offer —
  //    that would un-confirm us both forever).
  const goalOffer = botTradeGoalOffer(bot, trade, st, partnerKey);
  if (goalOffer && JSON.stringify(goalOffer) !== JSON.stringify({ gold: myOffer.gold, items: myOffer.items })) {
    if (botSetTradeOffer(bot, trade, goalOffer)) { st.lastSig = ''; return; }
  }
  const inValue = botValueOfferTo(bot, theirOffer, true);
  const outValue = botValueOfferTo(bot, myOffer, false);
  // 2) A generic trade (no goal of mine) where they have put value
  //    up and I have not: meet it — gold for their goods at my
  //    resale valuation, surplus goods for their gold.
  if (!goalOffer && outValue === 0 && inValue > 0 && rate !== Infinity) {
    if (theirOffer.gold > 0 && !(theirOffer.items || []).length) {
      const goods = botCounterGoods(bot, theirOffer.gold, rate);
      if (goods.length && botSetTradeOffer(bot, trade, { gold: 0, items: goods })) { st.lastSig = ''; return; }
    } else {
      const pay = Math.min(Math.max(0, goldTotal(bot.profile) - BOT_TRADE_FLOAT), Math.floor(inValue / rate));
      if (pay > 0 && botSetTradeOffer(bot, trade, { gold: pay, items: [] })) { st.lastSig = ''; return; }
    }
  }
  // 2b) Generic trade with my gold already up and negotiation
  //     pressure applied: re-price my side at the raised figure
  //     (never past what their goods are worth to me).
  if (!goalOffer && myOffer.gold > 0 && (theirOffer.items || []).length > 0 && st.raiseFactor) {
    const target = Math.min(Math.max(0, goldTotal(bot.profile) - BOT_TRADE_FLOAT), Math.floor(inValue / rate * st.raiseFactor), inValue);
    if (target > myOffer.gold && botSetTradeOffer(bot, trade, { gold: target, items: myOffer.items })) { st.lastSig = ''; return; }
  }
  // 3) Confirm when what I get beats what I give at my rate. A
  //    buy goal also needs the wanted goods actually on the table.
  let verdict = false;
  if (rate !== Infinity && inValue > 0) {
    const goalMet = !(st.intent && st.intent.initiatorKey === key && st.intent.kind === 'buy')
      || (theirOffer.items || []).some((s) => s.item === st.intent.item && s.qty >= 1);
    if (outValue === 0) verdict = !!trade.confirmed[partnerKey]; // value for nothing is a gift — only once THEY have confirmed it is meant
    else verdict = goalMet && inValue >= outValue * rate;
  }
  if (verdict) {
    if (!trade.confirmed[key]) {
      trade.confirmed[key] = true;
      sendTradeUpdate(trade);
      if (trade.confirmed[trade.aKey] && trade.confirmed[trade.bKey]) {
        executeTrade(trade);
        bot.tradeState = null;
        botDealIntents.delete(trade.id);
      }
    }
    return;
  }
  // 4) Walk away: an insulting imbalance that is not improving,
  //    or a trade gone quiet. (The trade's own 120s timer is the
  //    backstop, exactly as for a human partner.)
  const insult = outValue > 0 && inValue < outValue * (rate === Infinity ? 1 : rate) * 0.45;
  if (insult) {
    if (!st.insultSince) st.insultSince = now;
    if (now - st.insultSince > BOT_TRADE_INSULT_MS) {
      const partnerBot = bots.get(partnerKey);
      cancelTrade(trade, 'Trade cancelled.');
      botSay(bot, 'Not worth it.');
      if (partnerBot) botBumpRelation(bot, partnerBot, BOT_REL_INSULT);
      bot.tradeState = null;
      botDealIntents.delete(trade.id);
      return;
    }
  } else st.insultSince = 0;
  if (now - st.lastChangeAt > BOT_TRADE_STALL_MS) {
    cancelTrade(trade, 'Trade cancelled.');
    bot.tradeState = null;
    botDealIntents.delete(trade.id);
  }
}

// ----- skill deals: wanting, holding, and asking -----
// On its own clock a bot with a reason to trade opens one through
// the real request flow. Acquire deals target bots (their stock
// is world knowledge; a bot does not cold-call a player hoping
// they happen to carry potions). Sell deals target any solvent
// partner standing here, players included.
function botDealDrive(bot) {
  const now = Date.now(), sess = bot.sess, profile = bot.profile;
  if (now - bot.lastDealAt < BOT_DEAL_EVERY_MS / BOT_TIME_SCALE) return;
  bot.lastDealAt = now;
  if (isWildArea(sess.area) || sess.area === 'waiting' || sess.area === 'arena') return;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId) return;
  if (activeTradeForKey(bot.key) || pendingTradeForKey(bot.key)) return;
  if (bot.pvm) return; // Stage 39: a bot on a Barrows / Fight Caves attempt makes no deals
  const goals = [];
  for (const w of botWants(bot)) {
    for (const other of bots.values()) {
      if (other === bot || other.sess.area !== sess.area) continue;
      if (botRecentlyDeclined(bot.key, other.key)) continue; // they said no recently — don't badger
      if (other.sess.duelId || other.sess.modDuelId || activeTradeForKey(other.key) || pendingTradeForKey(other.key)) continue;
      const surplus = botSurplusQty(other, w.item);
      if (surplus > 0) goals.push({ kind: 'buy', item: w.item, qty: Math.min(w.qty, surplus), partnerKey: other.key, weight: 26 + botTrait(profile, 'ambition') * 0.3 + Math.max(0, botRelation(profile, other.profile.username)) * 0.2 });
    }
  }
  const stock = botSellableStacks(bot)
    .map((s) => ({ item: s.item, qty: botSurplusQty(bot, s.item), unit: botMarketValue(s.item) }))
    .filter((s) => s.qty > 0 && s.unit > 0);
  const totalUnits = stock.reduce((t, s) => t + s.qty, 0);
  const best = [...stock].sort((a, b) => b.unit - a.unit)[0];
  if (best && (best.unit >= 150 || totalUnits >= 6)) {
    const qty = best.unit >= 150 ? 1 : best.qty;
    const value = best.unit * qty;
    for (const [k, s] of online.entries()) {
      if (k === bot.key || s.area !== sess.area) continue;
      if (botRecentlyDeclined(bot.key, k)) continue; // they said no recently — don't badger
      if (s.duelId || s.modDuelId || s.npcFightId || s.barrowsFightId || s.fcRunId) continue;
      if (activeTradeForKey(k) || pendingTradeForKey(k)) continue;
      if (goldTotal(s.profile) < value * 0.25) continue; // they could never pay — do not waste the ask
      goals.push({ kind: 'sell', item: best.item, qty, partnerKey: k, weight: 14 + botTrait(profile, 'greed') * 0.3 + Math.min(20, goldTotal(s.profile) / 50) + Math.max(0, botRelation(profile, s.profile.username)) * 0.2 });
    }
  }
  if (!goals.length) return;
  const goal = botPickWeighted(bot, goals.map((g) => ({ value: g, weight: g.weight })));
  const req = botCreateTradeRequest(bot, goal.partnerKey);
  if (!req) return;
  botDealIntents.set(req.id, { initiatorKey: bot.key, kind: goal.kind, item: goal.item, qty: goal.qty });
  const partnerName = db.users[goal.partnerKey] ? db.users[goal.partnerKey].profile.username : goal.partnerKey;
  const def = itemDef(goal.item);
  if (bot.def && bot.def.shady) {
    // NPC build: branman3 pitches his deals like a fast-buck
    // artist — the talk is the trick; the trade window that
    // follows shows the real numbers to both sides, always.
    if (goal.kind === 'buy') botSay(bot, talkPick([`Psst, ${partnerName} — that ${def.name} is just gathering dust. Quick gold, no questions. Trade me.`, `${partnerName}, friend — I'll take that ${def.name} off your hands for cash, right now. You won't get a better offer. (You might.)`, `Between you and me, ${partnerName}: ${def.name}, cash, done in a flash. Trade me before I change my mind.`]));
    else botSay(bot, talkPick([`Selling ${goal.qty}× ${def.name} — practically giving it away, ${partnerName}. Practically.`, `${def.name} ×${goal.qty}, fresh off the back of a cart. Trade me, ${partnerName} — first come, first fleeced. Er, served.`, `Got ${goal.qty}× ${def.name} going cheap, ${partnerName}. Cheap-ish. Trade me and see.`]));
  }
  else if (goal.kind === 'buy') botSay(bot, `${partnerName} — buying ${goal.qty}× ${def.name}. I'll pay gold.`);
  else botSay(bot, `Selling ${goal.qty}× ${def.name} — trade me if you want it.`);
}


// ----- the Wilderness: entry, exit, attack orders -----
// Entry mirrors the travel handler's wild sequence exactly:
// pendings cancelled, arrive at the spawn, then enterWildState
// deals the fresh HP pool and clears skull/teleblock.
function botEnterWild(bot) {
  const key = bot.key, sess = bot.sess;
  cancelWildPendings(key);
  sess.area = 'wilderness';
  sess.x = AREAS.wilderness.spawn.x;
  sess.y = AREAS.wilderness.spawn.y;
  bot.plan = null;
  bot.moved = true;
  enterWildState(key, 'wilderness');
  if (bot.wildTrip) { bot.wildTrip.state = 'in'; bot.wildTrip.enteredAt = Date.now(); }
  completeStarterGoal(key, 'visit_area'); // the same first-trip goal a human earns
}
// Leaving mirrors a player's ditch crossing: exitWildCleanup ends
// my fights (my quarry escaped / I escaped) and clears the wild
// state; I wake at the plaza spawn.
function botExitWild(bot) {
  exitWildCleanup(bot.key);
  bot.sess.area = 'plaza';
  bot.sess.x = AREAS.plaza.spawn.x;
  bot.sess.y = AREAS.plaza.spawn.y;
  bot.moved = true;
  bot.wildTrip = null;
  bot.plan = null;
}
function botHeadHome(bot) {
  if (bot.sess.y >= WILD_EXIT_MIN_Y) { botExitWild(bot); return; }
  botStepToward(bot, bot.sess.x, 870, true);
}
// The wild_attack handler, mirrored check for check: busy states,
// the combat bracket at MY position, shallow single-way, the
// skull rule, then create/engage the pair. Returns whether the
// attack order landed.
function botWildAttack(bot, targetRef) {
  const sess = bot.sess, key = bot.key, profile = bot.profile;
  if (!isWildArea(sess.area) || sess.area === 'purewild') return false; // Stage 38: bots never enter Pure Wild
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId) return false;
  const myRef = wildRefPlayer(key);
  if (!targetRef || targetRef === myRef) return false;
  const tC = combatant(targetRef);
  if (!tC || tC.area !== sess.area) return false;
  const existing = wildPairBetween(myRef, targetRef);
  const myCbt = combatLevelOf(levelsOf(profile));
  const tgtCbt = tC.isPlayer ? combatLevelOf(levelsOf(tC.profile)) : tC.pker.cbt;
  const lvl = wildLevelAt(sess.y);
  if (Math.abs(myCbt - tgtCbt) > lvl) return false;
  if (!existing && Math.min(lvl, wildLevelAt(tC.y)) < 20) {
    if (wildPairsOf(targetRef).length || wildPairsOf(myRef).length) return false; // shallow wild is single-way
  }
  wildSkullCheck(key, targetRef); // striking first skulls — order given, skull taken
  const pair = existing || createWildPair(sess.area, myRef, targetRef, myRef);
  if (!tC.isPlayer) tC.pker.targetKey = key; // the PKer turns and answers
  engageWild(pair, myRef);
  return true;
}
// Eating and drinking in a wild fight (mirrors the 'use'
// handler's wild branch): food and restore potions heal the wild
// HP pool; a prayer potion tops the points back up while a
// Deflect is running.
function botUseInWild(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.wildHp == null) return false;
  const foods = profile.backpack
    .filter((s) => { const d = itemDef(s.item); return d && d.heal; })
    .sort((a, b) => (itemDef(b.item).heal || 0) - (itemDef(a.item).heal || 0));
  if (sess.wildHp < sess.wildMaxHp && foods.length) {
    const item = foods[0].item, def = itemDef(item);
    removeStacks(profile.backpack, item, 1);
    sess.wildHp = Math.min(sess.wildMaxHp, sess.wildHp + def.heal);
    save(key);
    sendProfile(key);
    return true;
  }
  if (profile.activePrayer && profile.prayerPoints < 8 && stackQty(profile.backpack, 'prayer_potion') > 0) {
    const def = itemDef('prayer_potion');
    removeStacks(profile.backpack, 'prayer_potion', 1);
    profile.prayerPoints = Math.min(profile.prayerMax, profile.prayerPoints + (def.prayerRestore || 0));
    save(key);
    sendProfile(key);
    return true;
  }
  return false;
}
// What a profile is carrying, at the wild death-valuation — the
// prize a betrayer is eyeing.
function botCarriedValue(profile) {
  let v = 0;
  for (const s of profile.backpack) v += stackValueOf(s.item, s.qty);
  return v;
}
// THE BETRAYAL DECISION. Pure trait maths over the situation: a
// score built from greed and risk, dragged down hard by loyalty,
// sweetened by what the friend is carrying and by the depth (no
// witnesses up north), cooled by the friendship itself. At the
// trait extremes it is deterministic by construction: loyalty
// 100 caps the score below BOT_BETRAY_MIN even at greed/risk
// 100, and greed 100 / risk 100 / loyalty 0 clears it even
// against a best friend — everything between is a personality
// with a dice roll in it, as Derek's autonomy rule demands.
function botBetrayalRoll(bot, friendBot) {
  const rel = botRelation(bot.profile, friendBot.profile.username);
  return botScore(bot, { greed: 0.5, risk: 0.4, loyalty: -0.6 })
    + Math.min(15, botCarriedValue(friendBot.profile) / 400)
    + (wildLevelAt(bot.sess.y) / 50) * 10
    - Math.max(0, rel) * 0.25
    > BOT_BETRAY_MIN;
}
// A betrayal, recorded: the friendship crashes to a deep grudge
// on BOTH profiles at once (so the victim's own later behaviour —
// trade refusals, wild hostility — reads the same fact), saved
// immediately.
function botCrashRelations(aBot, bBot) {
  for (const [me, other] of [[aBot, bBot], [bBot, aBot]]) {
    if (!me.profile.relations || typeof me.profile.relations !== 'object') me.profile.relations = {};
    me.profile.relations[other.profile.username] = -85;
    save(me.key);
  }
  botRelLastTouch.set(botPairKey(aBot.key, bBot.key), Date.now());
}
// Choosing violence while pair-free: the nearest attackable
// combatant in bracket — grudges pull hardest, friends are
// off-limits (betrayal is a separate, deliberate act), my own
// trip partner is never a "target". PKers are fair game.
function botWildPickTarget(bot) {
  const sess = bot.sess, profile = bot.profile;
  const myCbt = combatLevelOf(levelsOf(profile));
  const lvl = wildLevelAt(sess.y);
  const entries = [];
  for (const [k, s] of online.entries()) {
    if (k === bot.key || s.area !== sess.area) continue;
    if (s.duelId || s.modDuelId) continue;
    if (Math.abs(myCbt - combatLevelOf(levelsOf(s.profile))) > lvl) continue;
    const d = Math.hypot(s.x - sess.x, s.y - sess.y);
    if (d > 560) continue;
    if (bot.wildTrip && bot.wildTrip.partnerKey === k) continue;
    const rel = botRelation(profile, s.profile.username);
    if (rel >= FRIEND_THRESHOLD) continue;
    if (Math.min(lvl, wildLevelAt(s.y)) < 20 && wildPairsOf(wildRefPlayer(k)).length) continue; // shallow: no piling
    let w = 12 - d / 60;
    if (rel <= BOT_GRUDGE) w += 26; // a grudge makes a target of them
    else if (rel < 0) w += Math.min(12, -rel / 4);
    const otherBot = bots.get(k);
    w += botTrait(profile, 'greed') * 0.05 * Math.min(10, botCarriedValue(otherBot ? otherBot.profile : s.profile) / 500);
    entries.push({ value: wildRefPlayer(k), weight: Math.max(1, w) });
  }
  for (const pk of pkers.values()) {
    if (!pk.alive || pk.area !== sess.area) continue;
    if (Math.abs(myCbt - pk.cbt) > lvl) continue;
    const d = Math.hypot(pk.x - sess.x, pk.y - sess.y);
    if (d > 560) continue;
    if (Math.min(lvl, wildLevelAt(pk.y)) < 20 && wildPairsOf(wildRefPker(pk.id)).length) continue;
    entries.push({ value: wildRefPker(pk.id), weight: Math.max(1, 8 - d / 70 + botTrait(profile, 'aggression') * 0.05) });
  }
  if (!entries.length) return null;
  if (botScore(bot, { aggression: 0.5, risk: 0.3 }) <= 52) return null; // the nerve to hunt at all
  return botPickWeighted(bot, entries);
}
// Trip decisions, made on a slow clock wherever the bot is
// standing (bots cross between areas by travelling, like every
// other bot journey — a decision taken at the Training Cave is
// walked to the ditch the same way a decision taken in the
// plaza is): nerve first (aggression/risk/ambition), then
// company — a friend standing here may be invited; whether they
// come is THEIR roll, made when the invitation lands (see the
// botThink entry branch).
function botWildHabits(bot) {
  const now = Date.now(), sess = bot.sess, profile = bot.profile;
  if (bot.wildTrip) return;
  if (bot.pvm) return; // Stage 39: a bot on a Barrows / Fight Caves attempt plans no Wilderness trip
  if (now - bot.lastWildAt < BOT_WILD_EVERY_MS / BOT_TIME_SCALE) return;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId) return;
  if (stakeMatchForKey(bot.key) || activeTradeForKey(bot.key) || pendingTradeForKey(bot.key)) return;
  if ([...challenges.values()].some((ch) => ch.from === bot.key || ch.to === bot.key)) return;
  bot.lastWildAt = now;
  if (botScore(bot, { aggression: 0.4, risk: 0.4, ambition: 0.2 }) <= 58) return;
  let partner = null;
  // The party system is not area-scoped — a human can invite a
  // friend across the world, and so can a bot: the friend hears
  // the invitation wherever they are standing and decides for
  // themselves whether to come (their own roll, in the botThink
  // entry branch). A FREE friend is preferred; if every friend is
  // busy, the best friend is still asked — the trip then waits in
  // its entry state (the leader holds until joinBy, the partner
  // crosses when it frees up) instead of degenerating into yet
  // another solo trip. Waiting for your friend is the point of
  // travelling together.
  const friendBase = (o) => o !== bot && !o.wildTrip
    && !isWildArea(o.sess.area) && o.sess.area !== 'waiting' && o.sess.area !== 'arena'
    && botRelation(profile, o.profile.username) >= FRIEND_THRESHOLD;
  const freeFriends = [...bots.values()].filter((o) => friendBase(o)
    && !o.sess.duelId && !o.sess.modDuelId && !o.sess.npcFightId && !o.sess.fcRunId
    && !stakeMatchForKey(o.key) && !activeTradeForKey(o.key) && !pendingTradeForKey(o.key));
  const busyFriends = [...bots.values()].filter((o) => friendBase(o)
    && (o.sess.duelId || o.sess.modDuelId || o.sess.npcFightId || o.sess.fcRunId
      || stakeMatchForKey(o.key) || activeTradeForKey(o.key) || pendingTradeForKey(o.key)));
  const byRelation = (a, b) => botRelation(profile, b.profile.username) - botRelation(profile, a.profile.username);
  if (botScore(bot, { sociability: 0.5, loyalty: 0.2 }) > 50) {
    partner = freeFriends.sort(byRelation)[0] || busyFriends.sort(byRelation)[0] || null;
  }
  // The trip length compresses with the test clock only down to
  // a 30s floor: a Wilderness trip is mostly a PKer chase and a
  // fight, and those run on the real 600ms pair tick in every
  // clock — a 5s trip would end before the fight even starts.
  // (Production lengths, 60–150s, never touch the floor.)
  const until = now + Math.max(30000, botDelay(BOT_WILD_TRIP_MIN_MS, BOT_WILD_TRIP_MAX_MS) / BOT_TIME_SCALE);
  bot.wildTrip = { mode: partner ? 'team' : 'hunt', partnerKey: partner ? partner.key : null, until, state: 'enter', role: 'leader', joinBy: now + 90000, nextBetrayAt: now + BOT_BETRAY_CHECK_MS / BOT_TIME_SCALE };
  if (partner) {
    partner.wildTrip = { mode: 'team', partnerKey: bot.key, until, state: 'enter', role: 'partner', decided: false, nextBetrayAt: now + BOT_BETRAY_CHECK_MS / BOT_TIME_SCALE };
    const existing = partyOf.get(bot.key);
    if (!existing || !parties.get(existing) || !parties.get(existing).has(partner.key)) botPartyInvite(bot, partner.key);
    botSay(bot, `${partner.profile.username} — Wilderness run. Come if you're coming.`);
  }
}
// Life in the wild, one think at a time: upkeep (eat, pray),
// answer attacks (a friend's attack is a betrayal — crash the
// friendship, then fight or run like anyone), defend a partner,
// weigh betrayal while teamed, hunt while solo, and go home when
// the trip is done or the health is gone. Movement is
// server-side, like the PKers: an engaged bot chases its target;
// a fleeing bot runs for the ditch and crosses out.
function botWildDrive(bot) {
  const sess = bot.sess, key = bot.key, profile = bot.profile, now = Date.now();
  if (!bot.wildTrip) bot.wildTrip = { mode: 'hunt', partnerKey: null, until: now + BOT_WILD_TRIP_MIN_MS / BOT_TIME_SCALE, state: 'in', role: 'leader', enteredAt: now, nextBetrayAt: now };
  const trip = bot.wildTrip;
  if (!trip.enteredAt) trip.enteredAt = now;
  const myRef = wildRefPlayer(key);
  const maxHp = Math.max(1, sess.wildMaxHp || 1);
  const myHp = sess.wildHp == null ? maxHp : sess.wildHp;
  const hpFrac = myHp / maxHp;
  const pairs = wildPairsOf(myRef);
  let partner = trip.partnerKey ? bots.get(trip.partnerKey) : null;
  // The grace runs UNSCALED: crossing, deciding, and the pair
  // engine all run on real time in every clock, so a partner who
  // is a few real seconds behind is still coming. (Scaled, the
  // grace shrank to ~2.5s under the test clock and teams dissolved
  // before the partner arrived.)
  if (trip.mode === 'team' && partner && partner.sess.area !== 'wilderness' && now - trip.enteredAt > BOT_TEAM_GRACE_MS) {
    trip.mode = 'hunt'; trip.partnerKey = null; partner = null; // they never came, left, or died — the team is over
  }
  // Upkeep while fighting: eat at the player's threshold, and
  // the praying tiers flick the Deflect that counters their
  // opponent — the PKers' own habits, on the same rules.
  if (pairs.length) {
    if (hpFrac <= 0.45 && now >= bot.wildEatAt && botUseInWild(bot)) bot.wildEatAt = now + 2400;
    if (bot.def.tier >= 1 && profile.prayerPoints > 0) {
      const opp = combatant(pairOtherRef(pairs[0], myRef));
      if (opp) {
        const want = PRAYER_FOR_ATTACK_STYLE[attackStyleOf(opp.profile)] || null;
        if (want && profile.activePrayer !== want) { profile.activePrayer = want; save(key); }
      }
    }
  } else if (profile.activePrayer) { profile.activePrayer = null; save(key); }
  const wantOut = now > trip.until || hpFrac <= 0.25;
  if (wantOut && !pairs.length) { botHeadHome(bot); return; }
  let ranSouth = false;
  if (pairs.length) {
    for (const pair of pairs) {
      const otherRef = pairOtherRef(pair, myRef);
      const opp = combatant(otherRef);
      if (!opp) continue;
      const theyStruck = pair.aggro === otherRef;
      const oppBot = opp.isPlayer ? bots.get(opp.key) : null;
      if (theyStruck && oppBot && trip.partnerKey === opp.key && botRelation(profile, opp.profile.username) > BOT_GRUDGE) {
        // My own partner turned on me: the friendship dies here,
        // whatever happens next.
        botCrashRelations(bot, oppBot);
        botSay(bot, `${opp.profile.username}... after everything? Fine.`);
        trip.mode = 'hunt'; trip.partnerKey = null; partner = null;
      }
      if (pair.eng[myRef]) {
        if (wantOut) { botStepToward(bot, sess.x, 870, true); ranSouth = true; continue; }
        const range = styleRange(attackStyleOf(profile));
        if (Math.hypot(sess.x - opp.x, sess.y - opp.y) > range * 0.85) botStepToward(bot, opp.x, opp.y, true);
        continue;
      }
      if (theyStruck) {
        let s = botScore(bot, { aggression: 0.5, risk: 0.3 });
        if (hpFrac < 0.3) s -= 25;
        if (opp.hp() < myHp) s += 8;
        if (s > 55 && !wantOut) engageWild(pair, myRef);
        else { botStepToward(bot, sess.x, 870, true); ranSouth = true; }
      }
    }
    if (ranSouth && sess.y >= WILD_EXIT_MIN_Y) { botExitWild(bot); return; }
    return;
  }
  // Defend my partner: their attacker's head, if my loyalty
  // holds and the engine allows another attacker at this depth.
  if (partner && partner.sess.area === 'wilderness') {
    const pRef = wildRefPlayer(partner.key);
    for (const pair of wildPairsOf(pRef)) {
      const attRef = pairOtherRef(pair, pRef);
      if (attRef === myRef) continue;
      if (botScore(bot, { loyalty: 0.6, aggression: 0.2 }) + Math.max(0, botRelation(profile, partner.profile.username)) * 0.2 > 58) botWildAttack(bot, attRef);
      break;
    }
    if (wildPairsOf(myRef).length) return; // I jumped in — the fight drives the next ticks
  }
  // Betrayal: alone with my partner, deep in the wild, carrying
  // all that loot... The roll is the personality's, not a script.
  if (trip.mode === 'team' && partner && partner.sess.area === 'wilderness' && now >= (trip.nextBetrayAt || 0)) {
    trip.nextBetrayAt = now + BOT_BETRAY_CHECK_MS / BOT_TIME_SCALE;
    if (botBetrayalRoll(bot, partner)) {
      botCrashRelations(bot, partner);
      botSay(bot, `Sorry, ${partner.profile.username}. Your stuff is worth more than you are.`);
      trip.mode = 'hunt'; trip.partnerKey = null;
      botWildAttack(bot, wildRefPlayer(partner.key));
      return;
    }
  }
  // Hunt while solo.
  if (trip.mode === 'hunt') {
    const t = botWildPickTarget(bot);
    if (t && botWildAttack(bot, t)) return;
  }
  // Movement: a partner shadows its leader; anyone else drifts
  // on waypoints (hunters push north, into deeper levels).
  if (trip.mode === 'team' && partner && partner.sess.area === 'wilderness' && trip.role === 'partner') {
    if (Math.hypot(sess.x - partner.sess.x, sess.y - partner.sess.y) > 120) botStepToward(bot, partner.sess.x, partner.sess.y, true);
    return;
  }
  if (!trip.wp || Math.hypot(sess.x - trip.wp.x, sess.y - trip.wp.y) < 12) {
    trip.wp = { x: clamp(sess.x + botRandInt(-220, 220), 40, 1560), y: clamp(sess.y + botRandInt(trip.mode === 'hunt' ? -260 : -80, 120), 60, 845) };
  }
  botStepToward(bot, trip.wp.x, trip.wp.y, false);
}

// ---------- Stage 39: NPC Barrows and Fight Caves runs ----------
// Derek's Stage 37 vision, continued: the NPC players take on the
// two big PvM runs. Both engines are per-player and fully
// server-side, and the bots drive them EXACTLY as they stand —
// the brain mirrors the barrows_* / fc_* handlers' own state
// mutations (the Stage 37/38 pattern) and calls the same engine
// functions a player's messages reach (startBarrowsFight,
// startBarrowsAmbush, rollBarrowsLoot, startFcRun, endFcRun,
// respawnPlayer). There is no bot combat math, no bot drop table,
// no survival favour: brothers hit a bot as hard as they hit a
// player, the puzzle door bites a bot's tunnel pool for the same
// 5 HP, kills persist on a dead bot's run until the chest is
// looted (Derek's rule), and Jad is the same unproven wall for
// bots as for everyone.
//
// WHO ATTEMPTS: a slow per-bot clock (botPvmHabits), gated by
// traits through botScore / botPickWeighted like every bot
// decision. Barrows also has a hard combat gate (70) under the
// trait roll — a combat-38 IronNoob never attempts it no matter
// how ambitious his roll, while the Fight Caves gate softens at
// low combat so the little bots dabble in the early waves and
// die there, as they should. At most BOT_PVM_MAX_PER_ACTIVITY
// bots run one activity at once. Preparation is the real economy:
// botRestock (Stage 38) tops up food / prayer potions at the
// shops before an attempt, and loot lands in real profiles —
// gold through the helpers, pieces as piles on the Barrows field
// with their collection-log entries and game-wide announcements,
// fire capes through endFcRun's own settlement.
const BOT_PVM_EVERY_MS = 270000; // per-bot gap between PvM attempt decisions (scaled like every bot clock)
const BOT_PVM_MAX_PER_ACTIVITY = 2; // at most two bots in Barrows, two in the Fight Caves, at once
const BOT_BARROWS_MIN_CBT = 70; // Barrows is endgame: a hard combat gate under the trait roll
const BOT_PVM_EAT_FRAC = 0.45; // eat at/below this fraction of the fight pool (the Wilderness threshold)

function botPvmCount(kind) {
  let n = 0;
  for (const b of bots.values()) if (b.pvm && b.pvm.kind === kind) n += 1;
  return n;
}
// Ending an attempt, for whatever reason: prayer off (the drain
// would only waste the points), the attempt forgotten, plans
// forgotten — the next think chooses fresh, like after a duel.
function botPvmEnd(bot) {
  if (bot.profile.activePrayer) { bot.profile.activePrayer = null; save(bot.key); }
  bot.pvm = null;
  bot.plan = null;
}
// The 'use' handler's Barrows / Fight Caves branches, mirrored:
// a prayer potion tops the points up (that branch runs before
// any fight check for a player too); food and restore potions
// heal whichever pool the bot is fighting from.
function botUseInPvm(bot, item) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  const def = itemDef(item);
  if (!def || (def.kind !== 'food' && def.kind !== 'potion')) return false;
  if (stackQty(profile.backpack, item) < 1) return false;
  if (def.prayerRestore) {
    if (profile.prayerPoints >= profile.prayerMax) return false;
    removeStacks(profile.backpack, item, 1);
    profile.prayerPoints = Math.min(profile.prayerMax, profile.prayerPoints + def.prayerRestore);
    save(key);
    sendProfile(key);
    return true;
  }
  const bf = sess.barrowsFightId ? barrowsFights.get(sess.barrowsFightId) : null;
  if (bf) {
    if (bf.hpYou >= bf.maxHpYou) return false;
    removeStacks(profile.backpack, item, 1);
    bf.hpYou = Math.min(bf.maxHpYou, bf.hpYou + def.heal);
    save(key);
    sendProfile(key);
    return true;
  }
  const run = sess.fcRunId ? fcRuns.get(sess.fcRunId) : null;
  if (run) {
    if (run.hpYou >= run.maxHpYou) return false;
    removeStacks(profile.backpack, item, 1);
    run.hpYou = Math.min(run.maxHpYou, run.hpYou + def.heal);
    save(key);
    sendProfile(key);
    return true;
  }
  return false;
}
// Fight upkeep shared by the Barrows and Fight Caves drives:
// raise the wanted Deflect (the praying tiers only, as in their
// duels), eat at the shared threshold, sip a prayer potion when
// a running Deflect runs dry. wantPrayer is a prayer NAME
// ('melee' / 'missiles' / 'magic') or null to leave prayer alone.
function botPvmUpkeep(bot, hpYou, maxHpYou, wantPrayer) {
  const profile = bot.profile, key = bot.key, now = Date.now();
  if (wantPrayer && bot.def.tier >= 1 && profile.prayerPoints > 0 && profile.activePrayer !== wantPrayer) {
    profile.activePrayer = wantPrayer;
    save(key);
  }
  if (now < (bot.pvmEatAt || 0)) return;
  const frac = maxHpYou > 0 ? hpYou / maxHpYou : 1;
  if (frac <= BOT_PVM_EAT_FRAC) {
    const food = ['ration', 'cooked_trout', 'cooked_shrimps'].filter((i) => stackQty(profile.backpack, i) > 0)
      .sort((a, b) => (itemDef(b).heal || 0) - (itemDef(a).heal || 0))[0];
    if (food && botUseInPvm(bot, food)) { bot.pvmEatAt = now + 1200; return; }
    if (botUseInPvm(bot, 'restore_potion')) { bot.pvmEatAt = now + 1200; return; }
  }
  if (profile.activePrayer && profile.prayerPoints < 8 && botUseInPvm(bot, 'prayer_potion')) bot.pvmEatAt = now + 1200;
}
// Attempt decisions, on a slow clock wherever the bot is
// standing: restock first (a bot that cannot field food does not
// start), then the weighted pick between the runs it qualifies
// for, then the nerve gate for the one it picked.
function botPvmHabits(bot) {
  const now = Date.now(), sess = bot.sess, profile = bot.profile;
  if (process.env.BOT_PVM_OFF) return; // test hook (same pattern as BOT_TEST_FAST): the Stage 37/38 and gold-gap suites pin bot availability while they verify the challenge / trade / Stake Board flows
  if (bot.pvm) return;
  if (now - bot.lastPvmAt < BOT_PVM_EVERY_MS / BOT_TIME_SCALE) return;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId) return;
  if (bot.wildTrip || isWildArea(sess.area) || sess.area === 'waiting' || sess.area === 'arena'
    || sess.area === 'barrows' || sess.area === 'barrows_crypt' || sess.area === 'barrows_tunnels' || sess.area === 'fightcaves') return;
  if (stakeMatchForKey(bot.key) || activeTradeForKey(bot.key) || pendingTradeForKey(bot.key)) return;
  if ([...challenges.values()].some((ch) => ch.from === bot.key || ch.to === bot.key)) return;
  bot.lastPvmAt = now;
  botRestock(bot); // preparation through the real economy (mirrors shop_buy)
  const cbt = combatLevelOf(levelsOf(profile));
  const entries = [];
  if (cbt >= BOT_BARROWS_MIN_CBT && botPvmCount('barrows') < BOT_PVM_MAX_PER_ACTIVITY && botFoodCount(bot) >= 2) {
    entries.push({ value: 'barrows', weight: 10 + botTrait(profile, 'ambition') * 0.5 + botTrait(profile, 'risk') * 0.3 });
  }
  if (botPvmCount('fc') < BOT_PVM_MAX_PER_ACTIVITY && botFoodCount(bot) >= 1) {
    entries.push({ value: 'fc', weight: 8 + botTrait(profile, 'ambition') * 0.4 + botTrait(profile, 'risk') * 0.35 });
  }
  if (!entries.length) return;
  const kind = botPickWeighted(bot, entries);
  // The nerve gate. Barrows is a flat ambition+risk bar. The
  // caves' bar SOFTENS at low combat (the early waves are a
  // dabble, not a death sentence) down to a floor of 40 — which
  // a timid low-level bot's score still rarely clears, and a
  // maxed-ambition one clears easily: dabbling stays a choice.
  const gate = kind === 'barrows'
    ? botScore(bot, { ambition: 0.5, risk: 0.4 }) > 58
    : botScore(bot, { ambition: 0.45, risk: 0.35 }) > Math.max(40, 56 - Math.max(0, 60 - cbt) * 0.5);
  if (!gate) return;
  bot.pvm = { kind, started: false, plazaSeen: false, travel: false, dead: 0, mistake: false };
  bot.plan = null;
  botSay(bot, kind === 'barrows' ? 'Barrows run. Wish me luck.' : 'Fight Caves — going in.');
}
function botPvmDrive(bot) {
  if (!bot.pvm) return false;
  if (bot.pvm.kind === 'barrows') return botBarrowsDrive(bot);
  if (bot.pvm.kind === 'fc') return botFcDrive(bot);
  botPvmEnd(bot);
  return false;
}

// ----- Barrows: the handler mirrors -----
// barrows_enter, mirrored: the run's tunnel crypt is picked on
// first entry (ensureBarrowsRun, the real function), a slain
// non-tunnel brother's crypt stays shut, and the bot lands on
// the crypt spawn exactly where a player lands.
function botBarrowsEnter(bot, def) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.area !== 'barrows') return false;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.fcRunId || sess.barrowsFightId) return false;
  if (Math.hypot(sess.x - def.mound.x, sess.y - def.mound.y) > NPC_RANGE) return false;
  ensureBarrowsRun(key);
  if (profile.barrows.kills.includes(def.id) && def.id !== profile.barrows.tunnel) return false;
  sess.area = 'barrows_crypt';
  sess.x = CRYPT_SPAWN.x; sess.y = CRYPT_SPAWN.y;
  sess.barrowsCrypt = def.id;
  bot.moved = true;
  broadcastState();
  return true;
}
// barrows_search, mirrored: the sarcophagus wakes the brother
// through the real startBarrowsFight (he spawns beside the bot
// and the real tick engine takes over).
function botBarrowsSearch(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.area !== 'barrows_crypt' || !sess.barrowsCrypt) return false;
  const def = BARROWS_BROTHERS[sess.barrowsCrypt];
  if (!def) return false;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.fcRunId || sess.barrowsFightId) return false;
  ensureBarrowsRun(key);
  if (def.id === profile.barrows.tunnel) return false; // the tunnel sarcophagus is the way down, never a fight
  if (profile.barrows.kills.includes(def.id)) return false;
  if (Math.hypot(sess.x - CRYPT_SARCO.x, sess.y - CRYPT_SARCO.y) > NPC_RANGE) return false;
  startBarrowsFight(key, def, 'barrows_crypt', CRYPT_SARCO.x, CRYPT_SARCO.y);
  return true;
}
// barrows_leave_crypt, mirrored: back onto the field at the mound.
function botBarrowsLeaveCrypt(bot) {
  const sess = bot.sess;
  if (sess.area !== 'barrows_crypt') return false;
  if (sess.barrowsFightId) { const f = barrowsFights.get(sess.barrowsFightId); if (f) finishBarrowsFight(f, 'fled'); }
  const def = sess.barrowsCrypt ? BARROWS_BROTHERS[sess.barrowsCrypt] : null;
  sess.barrowsCrypt = null;
  sess.area = 'barrows';
  sess.x = def ? def.mound.x : AREAS.barrows.spawn.x;
  sess.y = def ? def.mound.y : AREAS.barrows.spawn.y;
  bot.moved = true;
  broadcastState();
  return true;
}
// barrows_descend, mirrored: the tunnel HP pool is dealt fresh,
// the door puzzle is dealt with it (Week 2 B5), a solved run
// deals nothing.
function botBarrowsDescend(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.area !== 'barrows_crypt' || !sess.barrowsCrypt) return false;
  if (sess.barrowsFightId) return false;
  ensureBarrowsRun(key);
  if (sess.barrowsCrypt !== profile.barrows.tunnel) return false;
  sess.area = 'barrows_tunnels';
  sess.x = AREAS.barrows_tunnels.spawn.x; sess.y = AREAS.barrows_tunnels.spawn.y;
  sess.barrowsCrypt = null;
  sess.barrowsHp = Math.max(1, levelForXp(profile.xp.hitpoints));
  sess.barrowsDoorRolled = false;
  sess.barrowsPuzzle = null;
  sess.barrowsPuzzleShown = false;
  if (!profile.barrows.puzzleSolved) newBarrowsPuzzle(sess);
  if (bot.pvm) bot.pvm.mistake = false; // a fresh descent gets a fresh chance to be careless
  bot.moved = true;
  broadcastState();
  return true;
}
// The move handler's tunnel triggers, mirrored: bots set their
// position directly (botStepToward), so the drive re-checks the
// same conditions after every tunnel step — entering the chest
// room guarantees the ambush while the tunnel brother lives,
// and the first post-solve crossing of the door line rolls it.
function botBarrowsTunnelTriggers(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.area !== 'barrows_tunnels' || sess.barrowsFightId) return;
  ensureV2(profile);
  const b = profile.barrows;
  if (!b.tunnel || b.kills.includes(b.tunnel)) return;
  const chestRoom = TUNNEL_ROOMS[4];
  const inChestRoom = sess.x > chestRoom.x0 && sess.x < chestRoom.x1 && sess.y >= chestRoom.y0 && sess.y < chestRoom.y1;
  if (inChestRoom) startBarrowsAmbush(key);
  else if (b.puzzleSolved && !sess.barrowsDoorRolled && sess.y < TUNNEL_DOOR.y0) {
    sess.barrowsDoorRolled = true;
    if (Math.random() < 0.5) startBarrowsAmbush(key);
  }
}
// barrows_puzzle_answer, mirrored. The bot reads the dealt
// puzzle from its own session (the brain polls authoritative
// state — a player reads the same puzzle off their screen) and
// answers through the handler's exact mutations: a right answer
// solves the run's door; a wrong one bites exactly 5 HP off the
// tunnel pool, death included. Persona-flavoured care: a
// careless bot's first answer of a descent may be a guess.
function botBarrowsAnswerPuzzle(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key, pvm = bot.pvm;
  if (sess.area !== 'barrows_tunnels') return false;
  if (!sess.barrowsPuzzle) {
    if (profile.barrows.puzzleSolved) return false;
    newBarrowsPuzzle(sess); // the barrows_puzzle request, mirrored (re-asking re-shows the same dealt puzzle)
  }
  const pz = sess.barrowsPuzzle;
  const rightIdx = pz.options.indexOf(pz.answer);
  if (rightIdx < 0) { sess.barrowsPuzzle = null; return false; }
  let idx = rightIdx;
  if (pvm && !pvm.mistake && pz.options.length > 1 && botScore(bot, { risk: 0.4, ambition: -0.2 }) > 62) {
    pvm.mistake = true;
    idx = pz.options.findIndex((o) => o !== pz.answer);
  }
  const chosen = pz.options[idx];
  if (chosen !== undefined && chosen === pz.answer) {
    sess.barrowsPuzzle = null;
    profile.barrows.puzzleSolved = true;
    save(key);
    sendBarrowsState(key);
    return true;
  }
  if (sess.barrowsHp == null) sess.barrowsHp = Math.max(1, levelForXp(profile.xp.hitpoints));
  sess.barrowsHp -= 5;
  if (sess.barrowsHp <= 0) {
    sess.barrowsPuzzle = null;
    respawnPlayer(key, '☠️ You were killed by the puzzle door\'s bite. Dropped: nothing. Kept: everything you carry, plus your Barrows kills, tunnel and solved puzzle. You wake up in the plaza.');
  }
  return true;
}
// barrows_loot, mirrored: the same preconditions, the same
// ambush backstop, the real rollBarrowsLoot, the runs counter,
// the run reset, and every rare landing as its own loot-beam
// pile with its collection-log entry and announcement — the
// whole game hears about a bot's Barrows luck too.
function botBarrowsLoot(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key;
  if (sess.area !== 'barrows_tunnels') return false;
  if (sess.duelId || sess.npcFightId || sess.fcRunId || sess.barrowsFightId) return false;
  if (Math.hypot(sess.x - BARROWS_CHEST.x, sess.y - BARROWS_CHEST.y) > NPC_RANGE) return false;
  ensureV2(profile);
  if (!profile.barrows.puzzleSolved) return false;
  const b = profile.barrows;
  if (b.tunnel && !b.kills.includes(b.tunnel)) { startBarrowsAmbush(key); return true; }
  const killCount = b.kills.length;
  const loot = rollBarrowsLoot(profile, killCount);
  profile.barrowsRuns = (profile.barrowsRuns || 0) + 1;
  profile.barrows = { kills: [], tunnel: null, looted: false, puzzleSolved: false };
  save(key);
  sess.barrowsPuzzle = null; sess.barrowsHp = null;
  sess.area = 'barrows';
  sess.x = AREAS.barrows.spawn.x; sess.y = AREAS.barrows.spawn.y;
  loot.rares.forEach((piece, i) => {
    const pileId = crypto.randomBytes(6).toString('hex');
    piles.set(pileId, { id: pileId, item: piece, qty: 1, x: sess.x + i * 15, y: sess.y, area: 'barrows', owner: profile.username, bornAt: Date.now(), rare: true });
    recordClog(key, piece);
    announce(`⚰️ ${profile.username} just looted ${itemDef(piece).name} from Barrows!`);
  });
  bot.moved = true;
  broadcastState();
  botSay(bot, 'Chest looted — Barrows pays out again.');
  botPvmEnd(bot);
  return true;
}
// A Barrows fight in progress (crypt or tunnel ambush): close
// to my style's reach of the brother — he walks toward me too —
// and run the shared upkeep against his attack type.
function botBarrowsFightDrive(bot, fight) {
  const sess = bot.sess, profile = bot.profile;
  const def = BARROWS_BROTHERS[fight.brother];
  const style = attackStyleOf(profile);
  const d = Math.hypot(sess.x - fight.bx, sess.y - fight.by);
  if (d > styleRange(style) * 0.85) {
    const ap = approachPoint(sess.x, sess.y, fight.bx, fight.by);
    botStepToward(bot, ap.x, ap.y, true);
  }
  botPvmUpkeep(bot, fight.hpYou, fight.maxHpYou, def ? def.attackType : null);
  return true;
}
// The Barrows drive: one think of a run. State lives where the
// game keeps it — kills/tunnel/puzzle on the profile, the crypt
// and the tunnel pool on the session — so the drive is mostly
// "where am I, and what does a player do here next".
function botBarrowsDrive(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key, pvm = bot.pvm;
  const fight = sess.barrowsFightId ? barrowsFights.get(sess.barrowsFightId) : null;
  if (fight) { botBarrowsFightDrive(bot, fight); return true; }
  if (!['plaza', 'barrows', 'barrows_crypt', 'barrows_tunnels'].includes(sess.area)) {
    botTravelTo(bot, 'barrows'); // decided from somewhere else in the world: go
    pvm.started = true;
    return true;
  }
  if (sess.area === 'plaza') {
    if (!pvm.plazaSeen) {
      pvm.plazaSeen = true;
      if (!pvm.started) { pvm.started = true; pvm.travel = true; }
      else {
        // I woke here: a death put me back (respawnPlayer) and
        // the run on my profile is exactly where it fell
        // (Derek's rule). Resume or abandon by nerve — every
        // death cools the ambition a little more.
        pvm.dead = (pvm.dead || 0) + 1;
        if (botScore(bot, { ambition: 0.5, risk: 0.3 }) > 52 + pvm.dead * 8) pvm.travel = true;
        else {
          botSay(bot, 'Barrows can keep its chest. For now.');
          botPvmEnd(bot);
          return false;
        }
      }
    }
    if (pvm.travel) { pvm.travel = false; botTravelTo(bot, 'barrows'); }
    return true;
  }
  pvm.plazaSeen = false;
  if (sess.area === 'barrows') {
    ensureBarrowsRun(key);
    const b = profile.barrows;
    // Non-tunnel brothers first; the tunnel brother is met in
    // his crypt (to descend) and finished in the tunnels. If he
    // is the only one left — or already dead, with the chest
    // unlooted — his crypt is still the way down.
    const next = Object.values(BARROWS_BROTHERS).find((d) => d.id !== b.tunnel && !b.kills.includes(d.id))
      || (b.tunnel ? BARROWS_BROTHERS[b.tunnel] : null);
    if (!next) { botPvmEnd(bot); return false; } // no run state to work — let go
    if (Math.hypot(sess.x - next.mound.x, sess.y - next.mound.y) > 12) { botStepToward(bot, next.mound.x, next.mound.y, true); return true; }
    botBarrowsEnter(bot, next);
    return true;
  }
  if (sess.area === 'barrows_crypt') {
    const def = sess.barrowsCrypt ? BARROWS_BROTHERS[sess.barrowsCrypt] : null;
    if (!def) { botBarrowsLeaveCrypt(bot); return true; }
    if (def.id === profile.barrows.tunnel) { botBarrowsDescend(bot); return true; }
    if (profile.barrows.kills.includes(def.id)) { botBarrowsLeaveCrypt(bot); return true; }
    const stand = { x: CRYPT_SARCO.x, y: CRYPT_SARCO.y + CRYPT_SARCO.hy + 30 }; // just south of the coffin, well inside search range
    if (Math.hypot(sess.x - stand.x, sess.y - stand.y) > 12) { botStepToward(bot, stand.x, stand.y, false); return true; }
    botBarrowsSearch(bot);
    return true;
  }
  // barrows_tunnels
  const b = profile.barrows;
  if (!b.puzzleSolved) {
    const doorSpot = { x: 800, y: TUNNEL_DOOR.y1 + 40 }; // the door's south side, where a player's puzzle is presented
    if (Math.hypot(sess.x - doorSpot.x, sess.y - doorSpot.y) > 12) {
      botStepToward(bot, doorSpot.x, doorSpot.y, false);
      botBarrowsTunnelTriggers(bot);
      return true;
    }
    botBarrowsAnswerPuzzle(bot);
    return true;
  }
  const chestStand = { x: BARROWS_CHEST.x, y: BARROWS_CHEST.y + 60 };
  if (Math.hypot(sess.x - chestStand.x, sess.y - chestStand.y) > 12) {
    botStepToward(bot, chestStand.x, chestStand.y, false);
    botBarrowsTunnelTriggers(bot); // crossing into the chest room springs the ambush, as it does for a player
    return true;
  }
  if (b.tunnel && !b.kills.includes(b.tunnel)) { startBarrowsAmbush(key); return true; } // the loot backstop, reached early
  botBarrowsLoot(bot);
  return true;
}

// ----- Fight Caves: the drive -----
// Target choice, re-made when the current target dies (the
// fc_attack handler's only mutation is run.targetId): Jad's
// healers first while he stands, Jad himself next, otherwise
// the nearest living monster.
function botFcPickTarget(bot, run) {
  const alive = [...run.monsters.values()].filter((m) => m.alive);
  if (!alive.length) return null;
  const jad = alive.find((m) => m.kind === 'jad');
  let pool = alive;
  if (jad) {
    const healers = alive.filter((m) => m.kind === 'hurkot');
    pool = healers.length ? healers : [jad];
  }
  const sess = bot.sess;
  return pool.sort((a, b2) => Math.hypot(sess.x - a.x, sess.y - a.y) - Math.hypot(sess.x - b2.x, sess.y - b2.y))[0];
}
function botFcDrive(bot) {
  const sess = bot.sess, profile = bot.profile, key = bot.key, pvm = bot.pvm;
  const run = sess.fcRunId ? fcRuns.get(sess.fcRunId) : null;
  if (!run) {
    if (!pvm.started) {
      if (sess.area !== 'fightcaves') { botTravelTo(bot, 'fightcaves'); return true; }
      // fc_start, mirrored: the real startFcRun deals wave 1 and
      // counts the attempt on the profile at once.
      if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId) { botPvmEnd(bot); return false; }
      pvm.started = true;
      startFcRun(key);
      return true;
    }
    // The run just ended and endFcRun already settled the
    // records: death woke me in the plaza, leaving or completing
    // left me standing in the caves (walk out like a player).
    const doneKind = sess.area;
    botPvmEnd(bot);
    if (doneKind === 'fightcaves') botTravelTo(bot, 'plaza');
    return false;
  }
  if (sess.area !== 'fightcaves') { endFcRun(run, 'left'); botPvmEnd(bot); return false; } // defensive: travel ends runs itself
  // Jad's telegraph: run.jadPending is the authoritative state —
  // announced last tick, landing at the start of the next fcTick
  // against the prayer active THEN. The bot answers it like a
  // player who saw the telegraph, with persona reliability
  // rolled ONCE per telegraph: experience (tier) and a careful
  // temperament switch well; a reckless bot misses some.
  if (run.jadPending && bot.fcJadSeen !== run.jadPending) {
    bot.fcJadSeen = run.jadPending;
    const care = Math.max(0.3, Math.min(0.97,
      0.45 + bot.def.tier * 0.18
      + (50 - botTrait(profile, 'risk')) * 0.003
      + (botTrait(profile, 'ambition') - 50) * 0.001));
    if (Math.random() < care && profile.prayerPoints > 0) {
      profile.activePrayer = run.jadPending.style; // 'missiles' | 'magic' — the prayer names themselves
      save(key);
    }
  }
  // Target (fc_attack's mutation) and approach: melee monsters
  // walk to the bot; the ranged ones and Jad stay put, so the
  // bot walks to them — to its own style's reach (FC_RANGE for
  // Jad, the caves' standing exception).
  let target = run.targetId ? run.monsters.get(run.targetId) : null;
  if (!target || !target.alive) {
    target = botFcPickTarget(bot, run);
    if (target) run.targetId = target.id;
  }
  if (target && !run.betweenWaves) {
    const reach = target.kind === 'jad' ? FC_RANGE : styleRange(attackStyleOf(profile));
    if (Math.hypot(sess.x - target.x, sess.y - target.y) > reach * 0.9) {
      const ap = approachPoint(sess.x, sess.y, target.x, target.y);
      botStepToward(bot, ap.x, ap.y, true);
    }
  }
  // Upkeep: Deflect what is hitting me (Jad's prayer is the
  // telegraph's business, above — leave it alone while he lives).
  const jadAlive = [...run.monsters.values()].some((m) => m.alive && m.kind === 'jad');
  botPvmUpkeep(bot, run.hpYou, run.maxHpYou, (!jadAlive && target) ? target.attackType : null);
  // Bailing out is a persona choice, not a script: out of food,
  // badly hurt, and the caution roll says go — the fc_leave
  // handler's own call, records settled by endFcRun as always.
  if (botFoodCount(bot) === 0 && stackQty(profile.backpack, 'restore_potion') === 0
    && run.hpYou <= run.maxHpYou * 0.3
    && botScore(bot, { risk: -0.4, ambition: -0.2 }) > 50) {
    endFcRun(run, 'left');
    botPvmEnd(bot);
    botTravelTo(bot, 'plaza');
    return false;
  }
  return true;
}

// ----- friendship trickle + decay -----
// Every relations tick: pairs training/gathering in the same area
// grow a little closer (capped per hour); pairs that have not
// interacted in a long while drift one point toward strangers.
setInterval(() => {
  if (!botsReady) return;
  const now = Date.now();
  const list = [...bots.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.sess.area !== b.sess.area) continue;
      const working = (x) => x.plan && x.plan.kind === 'train';
      if (!working(a) || !working(b)) continue;
      const pk = botPairKey(a.key, b.key);
      let win = botRelGainWindow.get(pk);
      if (!win || now - win.start >= 3600000 / BOT_TIME_SCALE) { win = { start: now, total: 0 }; botRelGainWindow.set(pk, win); }
      if (win.total >= BOT_REL_TRAIN_CAP_PER_HOUR * BOT_TIME_SCALE) continue;
      win.total += BOT_REL_TRAIN_TICK;
      botBumpRelation(a, b, BOT_REL_TRAIN_TICK);
    }
  }
  for (const bot of list) {
    if (!bot.profile.relations) continue;
    for (const [name, score] of Object.entries(bot.profile.relations)) {
      if (!score) continue;
      const other = bots.get(String(name).toLowerCase());
      if (!other) continue;
      const pk = botPairKey(bot.key, other.key);
      const lastTouch = botRelLastTouch.get(pk);
      if (lastTouch === undefined) { botRelLastTouch.set(pk, now); continue; } // first sighting starts the clock — never decays on sight
      if (now - lastTouch < BOT_REL_DECAY_AFTER_MS / BOT_TIME_SCALE) continue;
      // Decay one point toward 0, applied from the higher-key side
      // only so a pair never double-decays in one tick.
      if (bot.key > other.key) botBumpRelation(bot, other, score > 0 ? -1 : 1);
    }
  }
}, 30000 / BOT_TIME_SCALE);

// ----- the brain -----
// =====================================================================
// Stage 40 — NPC community, city building, and City Idea commissions.
//
// Derek's shape (2026-11-20): the bots build the community and
// build/design the city, and an admin can hand them an idea — the
// IDEA is the admin's; whether to join it, and how to build it, is
// each bot's own choice, made through the same trait helpers as
// every other bot decision. Nothing here remote-controls a bot.
//
// Three behaviours:
//  1. Plaza social life: sociable bots take 'social' plans (loose
//     clusters by the bank/dais — see botPickPlan), greet players
//     who arrive nearby (hard throttled per bot per player), make
//     small talk drawn ONLY from their real state (runs finished,
//     grudges held, friends present, objects placed), and chime in
//     on world announcements via botCongratsHook.
//  2. City building on their own initiative: a bot with gold to
//     spare may pay the per-kind price from its OWN gold and place
//     a real Stage 7D object (persisted on its profile, aggregated
//     into placedObjectsAll exactly like a player's — and removable
//     by any admin through the existing remove_object tool).
//  3. City Idea commissions: an admin posts { text, rough area };
//     the record persists on the admin's profile and aggregates
//     into the cityIdeas registry at boot. Bots roll to join (and
//     re-roll while they stay out — joining is a standing 'in',
//     staying out is only "not yet"), then place objects of kinds
//     THEY choose inside the rough area, paid from their own gold,
//     until the idea's target count completes it and a plaza
//     announcement names the idea and its contributors.
//
// TEST HOOK: BOT_CITY_OFF=1 disables every Stage 40 bot behaviour
// (social, building, idea work, congrats) — the same pattern as
// BOT_PVM_OFF, for suites that pin a quieter world.
// =====================================================================
const CITY_PROP_PRICES = { flowers: 40, rock: 60, tree: 120, light: 150, chest: 250 }; // gold, paid by the placing bot
const BOT_OBJ_PER_BOT = 12; // a single bot may have at most this many placed objects in the world
const BOT_OBJ_WORLD_CAP = 60; // bot-placed objects across the whole world
const BOT_OBJ_SPACING = 55; // minimum distance between any two placed objects
const BOT_CITY_KEEP_GOLD = 60; // a bot never builds itself below this much gold in hand
const BOT_BUILD_EVERY_MS = 480000; // per-bot clock between own-initiative build decisions (scaled)
const BOT_IDEA_EVERY_MS = 240000; // per-bot clock between City Idea join/contribute decisions (scaled)
const BOT_GREET_COOLDOWN_MS = 2700000; // per bot per player: at most one greeting per 45 minutes (scaled)
const BOT_GREET_RANGE = 320; // a bot greets a player it can practically see
const BOT_TALK_EVERY_MS = 300000; // per-bot clock between plaza small-talk lines (scaled)
const CITY_IDEA_TARGET = 8; // objects placed toward an idea that complete it
const CITY_IDEA_MAX_OPEN = 3; // open ideas at once, so the bots' attention stays meaningful
const CITY_BUILD_AREAS = new Set(['plaza', 'gathering', 'cove', 'mine', 'training', 'magic', 'range', 'goblins', 'winter']);
// Rough areas an idea can name: the plaza as a whole or by quadrant,
// or one whole gathering/training area. { area } is the world area,
// (x, y) the rough centre, r the radius contributors build inside.
const CITY_IDEA_AREAS = {
  plaza: { label: 'Plaza — whole plaza', area: 'plaza', x: 800, y: 450, r: 340 },
  'plaza-nw': { label: 'Plaza — north-west', area: 'plaza', x: 400, y: 225, r: 300 },
  'plaza-ne': { label: 'Plaza — north-east', area: 'plaza', x: 1200, y: 225, r: 300 },
  'plaza-sw': { label: 'Plaza — south-west', area: 'plaza', x: 400, y: 675, r: 300 },
  'plaza-se': { label: 'Plaza — south-east', area: 'plaza', x: 1200, y: 675, r: 300 },
  gathering: { label: 'Gathering Cave', area: 'gathering', x: 800, y: 450, r: 380 },
  cove: { label: 'Fishing Cove', area: 'cove', x: 480, y: 450, r: 380 },
  mine: { label: 'Emberfall Mine & Smithy', area: 'mine', x: 800, y: 450, r: 380 },
  training: { label: 'Training Cave', area: 'training', x: 800, y: 450, r: 380 },
  magic: { label: 'Wizard Grounds', area: 'magic', x: 800, y: 450, r: 380 },
  range: { label: 'Ranger Camp', area: 'range', x: 800, y: 450, r: 380 },
  goblins: { label: 'Goblin Camp', area: 'goblins', x: 800, y: 450, r: 380 },
  winter: { label: 'Frostfall (Winter World)', area: 'winter', x: 800, y: 450, r: 380 },
};
const cityIdeas = new Map(); // ideaId -> { rec, ownerKey } — rec is the SAME object saved on the poster's profile
let ideaSeq = 0; // last City Idea number handed out (seeded at boot)
// Boot aggregation (called from store.init beside
// buildStage7DRegistry): pull every admin's saved City Ideas into
// the runtime registry and seed the id counter from the maximum in
// use. Ideas naming an area key the game no longer knows are left
// on the profile but never activate.
function buildCityIdeasRegistry() {
  cityIdeas.clear();
  let maxId = 0;
  for (const [k, u] of Object.entries(db.users)) {
    if (!u || !u.profile || !Array.isArray(u.profile.cityIdeas)) continue;
    for (const rec of u.profile.cityIdeas) {
      if (!rec || typeof rec.id !== 'string' || !CITY_IDEA_AREAS[rec.area]) continue;
      cityIdeas.set(rec.id, { rec, ownerKey: k });
      const n = parseInt(rec.id.slice(5), 10); // 'idea_<n>'
      if (Number.isFinite(n) && n > maxId) maxId = n;
    }
  }
  ideaSeq = maxId;
}
function cityIdeasMsg() {
  return {
    type: 'city_ideas',
    ideas: [...cityIdeas.values()].map(({ rec }) => ({
      id: rec.id, text: rec.text, area: rec.area, areaLabel: (CITY_IDEA_AREAS[rec.area] || {}).label || rec.area,
      by: rec.by, placed: rec.placed, target: rec.target, status: rec.status, contributors: rec.contributors || {},
    })),
    areas: Object.entries(CITY_IDEA_AREAS).map(([key, z]) => ({ key, label: z.label })),
  };
}
// Push the current list to every online admin/owner (the only
// viewers of the City Ideas panel section).
function pushCityIdeas() {
  const msg = cityIdeasMsg();
  for (const p of online.values()) if (isAdminOrOwner(p.profile)) send(p.ws, msg);
}

// ----- placement rules: never block gameplay -----
// Protected spots per area: the area spawn and every resource node
// always; the plaza adds its fixtures (bank chest / spawn point,
// the Duel Board, the teleport sign, the Stake Board sign, the
// dais centre, the three mods, the four shop stalls, PK Noob).
const CITY_PROTECTED_PLAZA = [
  { x: 984, y: 450, r: 85 }, // the Duel Board
  { x: 880, y: 470, r: 75 }, // the teleport sign
  { x: 180, y: 780, r: 85 }, // the Stake Board sign
  { x: 800, y: 140, r: 135 }, // the tournament dais centre
  { x: 680, y: 300, r: 75 }, { x: 800, y: 280, r: 75 }, { x: 920, y: 300, r: 75 }, // Mod Ash / Blair / Vega
  { x: 340, y: 220, r: 95 }, { x: 1260, y: 220, r: 95 }, { x: 1260, y: 680, r: 95 }, { x: 340, y: 680, r: 95 }, // the four shop stalls
  { x: 1150, y: 120, r: 75 }, // PK Noob
];
function cityProtectedSpots(area) {
  const spots = [];
  const a = AREAS[area];
  if (a) spots.push({ x: a.spawn.x, y: a.spawn.y, r: 95 }); // spawns (the plaza's is also the bank chest)
  for (const n of NODES.values()) if (n.area === area) spots.push({ x: n.x, y: n.y, r: 85 });
  if (area === 'plaza') spots.push(...CITY_PROTECTED_PLAZA);
  return spots;
}
function citySpotClear(area, x, y) {
  if (x < 70 || x > WORLD_W - 70 || y < 70 || y > WORLD_H - 70) return false; // world margins (gates live on the edges)
  if (area === 'cove' && x > 1030) return false; // the cove lake (the shore stops walkers at x = 1060)
  for (const o of placedObjectsAll) {
    if (o.area === area && Math.hypot(o.x - x, o.y - y) < BOT_OBJ_SPACING) return false;
  }
  for (const s of cityProtectedSpots(area)) {
    if (Math.hypot(s.x - x, s.y - y) < s.r) return false;
  }
  return true;
}
// Pick a buildable spot: inside the idea's rough zone when working
// an idea; otherwise near an existing object (neighbourhoods grow)
// or near the bot itself. Returns null when nothing clean turns up.
function cityPickSpot(bot, area, zone) {
  for (let i = 0; i < 10; i++) {
    let cx, cy, cr;
    if (zone) { cx = zone.x; cy = zone.y; cr = zone.r; }
    else {
      const here = placedObjectsAll.filter((o) => o.area === area);
      if (here.length && Math.random() < 0.55) {
        const o = here[Math.floor(Math.random() * here.length)];
        cx = o.x; cy = o.y; cr = 150; // beside the cluster, spacing enforced below
      } else { cx = bot.sess.x; cy = bot.sess.y; cr = 220; }
    }
    const ang = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * cr;
    const x = Math.round(cx + Math.cos(ang) * dist), y = Math.round(cy + Math.sin(ang) * dist);
    if (citySpotClear(area, x, y)) return { x, y };
  }
  return null;
}
function botWorldObjectCount() {
  let n = 0;
  for (const o of placedObjectsAll) if (BOT_KEYS.has(o.ownerKey)) n += 1;
  return n;
}
// Which kinds this bot would consider, weighted by its traits and
// filtered to what it can pay for while keeping its reserve. The
// bots design the execution: the KIND is their pick, not the
// admin's and not a script's.
function cityKindEntries(bot, maxShare) {
  const profile = bot.profile, gold = goldTotal(profile);
  const entries = [];
  for (const [kind, price] of Object.entries(CITY_PROP_PRICES)) {
    if (gold - price < BOT_CITY_KEEP_GOLD) continue;
    if (price > gold * maxShare) continue;
    let w = 10;
    if (kind === 'flowers') w += botTrait(profile, 'sociability') * 0.35;
    if (kind === 'light') w += botTrait(profile, 'sociability') * 0.2 + botTrait(profile, 'ambition') * 0.15;
    if (kind === 'tree') w += botTrait(profile, 'ambition') * 0.25;
    if (kind === 'chest') w += botTrait(profile, 'ambition') * 0.3 + botTrait(profile, 'greed') * 0.1;
    if (kind === 'rock') w += (100 - botTrait(profile, 'sociability')) * 0.15;
    entries.push({ value: kind, weight: w });
  }
  return entries;
}
// Place one object for a bot: caps, clearance and gold all
// re-validated at the moment of placement (the world may have
// changed since the plan was made). Gold moves only through
// takeGold; the object persists on the bot's profile and joins the
// world registry exactly like an admin-placed one.
function botPlaceObject(bot, kind, area, x, y, ideaEntry) {
  const profile = bot.profile;
  if (!PROP_KINDS.includes(kind)) return false;
  if (!Array.isArray(profile.placedObjects)) profile.placedObjects = [];
  if (profile.placedObjects.length >= BOT_OBJ_PER_BOT) return false;
  if (botWorldObjectCount() >= BOT_OBJ_WORLD_CAP) return false;
  if (!citySpotClear(area, x, y)) return false;
  const price = CITY_PROP_PRICES[kind];
  if (!price || !takeGold(profile, price)) return false;
  const entry = { id: `obj_${++objectSeq}`, area, kind, x: Math.round(x), y: Math.round(y) };
  profile.placedObjects.push(entry);
  placedObjectsAll.push({ ...entry, by: profile.username, ownerKey: bot.key });
  save(bot.key);
  broadcastObjects(area);
  const label = (PROP_DEFS.find((p) => p.kind === kind) || {}).label || kind;
  if (ideaEntry && ideaEntry.rec.status === 'open') {
    const rec = ideaEntry.rec;
    rec.placed += 1;
    rec.contributors[profile.username] = (rec.contributors[profile.username] || 0) + 1;
    if (rec.placed >= rec.target) {
      rec.status = 'done';
      save(ideaEntry.ownerKey);
      const names = Object.keys(rec.contributors).join(', ');
      announce(`🏗️ City Idea complete: "${rec.text}" — built by ${names}!`);
    } else {
      save(ideaEntry.ownerKey);
    }
    pushCityIdeas();
    botSay(bot, `Built a ${label.toLowerCase()} for the "${rec.text}" idea.`);
  } else if (Math.random() < 0.5) {
    botSay(bot, `Put a ${label.toLowerCase()} up in the ${AREAS[area].name}. This place is ours to build.`);
  }
  return true;
}
// The join decision for one idea: sociability and ambition pull a
// bot in, greed pulls it out, and a bot that remembers the posting
// admin kindly (trades dealt, Stage 38) leans in. Staying out is
// re-rolled on the next idea clock — minds change; joining sticks.
function botCityJoinRoll(bot, entry) {
  const cheapest = Math.min(...Object.values(CITY_PROP_PRICES));
  if (goldTotal(bot.profile) < cheapest + BOT_CITY_KEEP_GOLD) return false; // cannot afford to help at all right now
  let s = botScore(bot, { sociability: 0.35, ambition: 0.35, greed: -0.45 });
  s += Math.max(-50, Math.min(50, botRelation(bot.profile, entry.rec.by))) * 0.3;
  return s > 60;
}
// Start a build plan (own initiative when ideaEntry is null, else
// work toward that idea). Returns false when the bot cannot or
// will not build right now.
function botCityStartBuild(bot, ideaEntry) {
  const profile = bot.profile;
  if (!Array.isArray(profile.placedObjects)) profile.placedObjects = [];
  if (profile.placedObjects.length >= BOT_OBJ_PER_BOT) return false;
  if (botWorldObjectCount() >= BOT_OBJ_WORLD_CAP) return false;
  const zone = ideaEntry ? CITY_IDEA_AREAS[ideaEntry.rec.area] : null;
  if (!zone && ideaEntry) return false;
  const area = ideaEntry ? zone.area : bot.sess.area;
  if (!CITY_BUILD_AREAS.has(area)) return false;
  const kinds = cityKindEntries(bot, ideaEntry ? 1 : 0.4);
  if (!kinds.length) return false;
  const kind = botPickWeighted(bot, kinds);
  const spot = cityPickSpot(bot, area, zone);
  if (!spot) return false;
  bot.plan = {
    kind: 'build', area, x: spot.x, y: spot.y, propKind: kind,
    ideaId: ideaEntry ? ideaEntry.rec.id : null,
    until: Date.now() + 240000 / BOT_TIME_SCALE, dur: 0,
  };
  return true;
}
// The Stage 40 build habits, decided wherever the bot is standing
// (the plan system carries it to the spot). One decision per clock;
// a bot mid-anything-else is left alone, and a bot working a plan
// that matters (training, selling, banking) is not interrupted —
// building happens between jobs.
function botCityHabits(bot) {
  if (process.env.BOT_CITY_OFF) return; // test hook (BOT_PVM_OFF pattern)
  const now = Date.now(), sess = bot.sess;
  if (bot.pvm || bot.wildTrip || isWildArea(sess.area)) return;
  if (sess.area === 'waiting' || sess.area === 'arena' || sess.area === 'fightcaves'
    || sess.area === 'barrows' || sess.area === 'barrows_crypt' || sess.area === 'barrows_tunnels') return;
  if (sess.duelId || sess.modDuelId || sess.npcFightId || sess.barrowsFightId || sess.fcRunId) return;
  if (stakeMatchForKey(bot.key) || activeTradeForKey(bot.key) || pendingTradeForKey(bot.key)) return;
  if ([...challenges.values()].some((ch) => ch.from === bot.key || ch.to === bot.key)) return;
  if (bot.plan && bot.plan.kind !== 'idle' && bot.plan.kind !== 'social') return;
  // City Idea work first: it was asked for by name.
  const open = [...cityIdeas.values()].filter((e) => e.rec.status === 'open');
  for (const id of [...bot.ideaIn]) if (!open.some((e) => e.rec.id === id)) bot.ideaIn.delete(id);
  if (open.length && now - bot.lastIdeaAt >= BOT_IDEA_EVERY_MS / BOT_TIME_SCALE) {
    for (const e of open) if (!bot.ideaIn.has(e.rec.id) && botCityJoinRoll(bot, e)) bot.ideaIn.add(e.rec.id);
    const joined = open.filter((e) => bot.ideaIn.has(e.rec.id));
    if (joined.length) {
      bot.lastIdeaAt = now;
      const e = joined[Math.floor(Math.random() * joined.length)];
      botCityStartBuild(bot, e);
      return;
    }
    bot.lastIdeaAt = now; // considered the open ideas and stayed out — reconsider next cycle
  }
  // Own initiative.
  if (now - bot.lastBuildAt < BOT_BUILD_EVERY_MS / BOT_TIME_SCALE) return;
  if (!CITY_BUILD_AREAS.has(sess.area)) return;
  bot.lastBuildAt = now;
  if (botScore(bot, { ambition: 0.4, sociability: 0.25, greed: -0.5 }) <= 58) return;
  botCityStartBuild(bot, null);
}

// ----- plaza social life -----
function botGreetingLine(bot, name) {
  const profile = bot.profile;
  return botPickWeighted(bot, [
    { value: `Hey ${name}.`, weight: 10 + botTrait(profile, 'sociability') * 0.2 },
    { value: `Hey ${name}! Good to see you.`, weight: 4 + botTrait(profile, 'sociability') * 0.4 },
    { value: `Oi, ${name}. Watch yourself out there.`, weight: 2 + botTrait(profile, 'aggression') * 0.3 },
    { value: `${name}. Got anything to trade?`, weight: 2 + botTrait(profile, 'greed') * 0.3 },
    { value: `Well met, ${name}.`, weight: 6 + botTrait(profile, 'loyalty') * 0.2 },
  ]);
}
// Small talk drawn ONLY from the bot's real state: runs it has
// actually finished, waves it actually reached, a grudge it
// actually holds against someone online, a best friend standing
// nearby, objects it actually placed. Nothing is invented.
function botSmallTalkLine(bot) {
  const profile = bot.profile, opts = [];
  if ((profile.barrowsRuns || 0) > 0) opts.push({ value: 'Barrows has been paying out for me lately.', weight: 10 });
  if (profile.fc && profile.fc.completions > 0) opts.push({ value: 'Still proud of that fire cape run.', weight: 10 });
  else if (profile.fc && profile.fc.bestWave > 10) opts.push({ value: `Got to wave ${profile.fc.bestWave} in the caves last time. Still stings.`, weight: 8 });
  let grudge = null, worst = -40;
  for (const [name, score] of Object.entries(profile.relations || {})) if (score < worst) { worst = score; grudge = name; }
  if (grudge && [...bots.values()].some((b) => b.profile.username === grudge)) {
    opts.push({ value: `Don't talk to me about ${grudge}. We're not done.`, weight: 12 });
  }
  const bf = botBestFriend(profile);
  if (bf && [...online.values()].some((p) => p.profile.username === bf && p.area === 'plaza')) {
    opts.push({ value: `${bf} and I have been cleaning up lately.`, weight: 9 });
  }
  if ((profile.placedObjects || []).length) opts.push({ value: "The city's looking better with my touches in it.", weight: 7 });
  opts.push({ value: 'Quiet day in the plaza.', weight: 5 });
  opts.push({ value: 'Training never stops. Neither do I.', weight: 3 + botTrait(profile, 'ambition') * 0.15 });
  opts.push({ value: 'Everything has a price. Everything.', weight: 3 + botTrait(profile, 'greed') * 0.15 });
  return botPickWeighted(bot, opts);
}
// Greetings + small talk for bots in the plaza. Greetings are
// gated per bot per player by a long cooldown and by a sociability
// roll; botSay's per-area gap still bounds the total chat rate.
function botSocialDrive(bot) {
  if (process.env.BOT_CITY_OFF) return; // test hook (BOT_PVM_OFF pattern)
  const sess = bot.sess;
  if (sess.area !== 'plaza') return;
  const now = Date.now();
  for (const [k, p] of online) {
    if (k === bot.key || p.bot || bots.has(k) || p.area !== 'plaza') continue;
    if (Math.hypot(p.x - sess.x, p.y - sess.y) > BOT_GREET_RANGE) continue;
    if (now - (bot.greetedAt.get(k) || 0) < BOT_GREET_COOLDOWN_MS / BOT_TIME_SCALE) continue;
    if (botScore(bot, { sociability: 0.5 }) <= 55) continue;
    if (botSay(bot, botGreetingLine(bot, p.profile.username))) bot.greetedAt.set(k, now);
    break; // one greeting per bot per tick
  }
  if (now - bot.lastTalkAt < BOT_TALK_EVERY_MS / BOT_TIME_SCALE) return;
  if (!bot.plan || (bot.plan.kind !== 'social' && bot.plan.kind !== 'idle')) return;
  bot.lastTalkAt = now;
  if (botScore(bot, { sociability: 0.4 }) <= 52) return;
  botSay(bot, botSmallTalkLine(bot));
}
// Announcement reactions: when the game announces something (a 99,
// a fire cape, rare Barrows loot, a completed City Idea), one bot
// may chime in a few seconds later. Sociable bots are likelier to
// be the one; most announcements pass without comment.
function botCongratsHook(text) {
  if (process.env.BOT_CITY_OFF || !botsReady) return;
  const candidates = [...bots.values()].filter((b) => !b.sess.duelId);
  if (!candidates.length || Math.random() > 0.45) return;
  const bot = botPickWeighted(candidates[0], candidates.map((b) => ({ value: b, weight: 5 + botTrait(b.profile, 'sociability') })));
  const line = ['Nice one!', 'Huge — congrats!', 'Well earned.', 'Gz!', 'Big! Congrats.'][Math.floor(Math.random() * 5)];
  setTimeout(() => { try { botSay(bot, line); } catch (e) { /* the world moved on */ } }, botDelay(2500, 7000) / BOT_TIME_SCALE);
}

// ============================================================
// NPC BUILD (Derek, 2026-11-23) — Part A: NPC FREE TALK, and
// Part C: ASK-AND-LEARN + the Guided path toggle.
//
// Part A: the NPC players talk as their own players — they remark
// on what they're doing, answer players who speak near them or
// whisper them, banter with each other, and react to their duels
// and level-ups. Stage 40's greetings/small talk are the floor;
// this is the layer on top. Every line is a hand-written bank plus
// interpolation from the bot's REAL state (its plan, levels,
// friends, grudges, purse) — no generated text. Bots speak ONLY
// through botSay / the whisper path, so overhead bubbles (5s) and
// the chat log behave exactly as for a human. Hard limits:
// botSay's per-area gap, a per-bot reply cooldown, a per-player
// reply cooldown, one responder per player message, no replies
// while busy (duel/fight/PvM/wild), bot-to-bot pairs on a long
// per-pair clock. BOT_TALK_OFF=1 silences this whole layer (test
// isolation); production never sets it.
//
// Part C: a player who asks a help-seeking question — in public
// chat near a character, by whisper to a bot, or via the keeper
// modal's Ask button — gets a REAL next step fitted to THEIR
// levels/gold/backpack from the GUIDE_STEPS table below. Every
// character teaches its own domain first. Progress is remembered
// on profile.guide so a return visit moves on. The Guided path
// toggle (profile.guidedPath, default ON) gates only UNSOLICITED
// guidance (botGuideTipDrive); explicit asks always answer, and
// ordinary free talk is not guidance and is never gated.
// ============================================================
const BOT_TALK_OFF = process.env.BOT_TALK_OFF === '1';
function talkPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
const BOT_TALK_RANGE = 320; // the Stage 40 greeting range
const CHAT_GREETING_RE = /\b(hi|hello|hey|hiya|yo|sup|morning|afternoon|evening|greetings)\b/i;
const BOT_REPLY_COOLDOWN_MS = 30000 / BOT_TIME_SCALE; // per bot, between answers
const BOT_REPLY_PLAYER_MS = 60000 / BOT_TIME_SCALE; // per bot per player
const BOT_WHISPER_COOLDOWN_MS = 30000 / BOT_TIME_SCALE; // per bot per player
const BOT_BB_EVERY_MS = 300000 / BOT_TIME_SCALE; // per bot pair, bot-to-bot banter
const BOT_REACT_MS = 20000 / BOT_TIME_SCALE; // per bot, between activity remarks
const GUIDE_ASK_COOLDOWN_MS = 4000; // real ms, per asker (answers are not chatter)
const GUIDE_TIP_COOLDOWN_MS = 720000 / BOT_TIME_SCALE; // per bot per player, unsolicited tips
const GUIDE_TIP_RANGE = 320;

function botBusyForTalk(bot) {
  const s = bot.sess;
  return !!(s.duelId || s.modDuelId || s.npcFightId || s.fcRunId || s.barrowsFightId
    || s.area === 'wilderness' || s.area === 'purewild' || s.area === 'fightcaves'
    || s.area === 'waiting' || s.area === 'arena' || bot.pvm || bot.wildTrip);
}
// What the bot is doing right now, in words — grounded in its
// plan/session state, never invented.
function botActivityPhrase(bot) {
  const s = bot.sess, plan = bot.plan;
  if (s.duelId) return 'in a duel';
  if (bot.pvm) return bot.pvm.kind === 'barrows' ? 'running Barrows' : 'in the Fight Caves';
  if (bot.wildTrip) return 'out in the Wilderness';
  if (plan) {
    if (plan.kind === 'train') return plan.skill ? `training ${cap(plan.skill)}` : 'training';
    if (plan.kind === 'gather') return plan.skill ? `working on ${cap(plan.skill)}` : 'out gathering';
    if (plan.kind === 'sell') return 'selling up at the shops';
    if (plan.kind === 'bank') return 'sorting my bank';
    if (plan.kind === 'social') return 'taking a breather in the plaza';
    if (plan.kind === 'go') return 'on my way somewhere';
  }
  switch (s.area) {
    case 'gathering': return 'gathering in the cave';
    case 'cove': return 'fishing at the cove';
    case 'mine': return 'mining at Emberfall';
    case 'training': return 'training in the cave';
    case 'magic': return 'training Magic';
    case 'range': return 'training Ranged';
    case 'goblins': return 'fighting goblins';
    case 'barrows': case 'barrows_crypt': case 'barrows_tunnels': return 'down at Barrows';
    default: return 'around the plaza';
  }
}
// Per-bot voice banks for the five family players (Muse's
// colouring on Derek's identities; branman3's are Derek's own
// character note — a sneaky guy after a fast buck. His lines can
// boast and bait; they are chat only, never a system surface).
const BOT_VOICE_LINES = {
  'branman3': [
    'Made a tidy little profit today. Don\'t ask how.',
    'Everything\'s negotiable. EVERYTHING. Remember that.',
    'Psst — if anyone asks, I was never here.',
    'A deal\'s a deal, even when it isn\'t. Especially then.',
    'I know a guy who knows a guy. I\'m both guys.',
    'Buy low, sell high, talk fast. That\'s the whole game.',
    'That item you\'re carrying? I could move it. For a price. My price.',
    'Trust me. Would this face lie? Don\'t answer that.',
  ],
  'imatoad': [
    'Lovely day for it, isn\'t it, dear?',
    'You look like you could use a cooked trout and a sit-down.',
    'Back in my day we walked to Barrows. Uphill. Both ways.',
    'I keep a little gold aside for the family. And a little more for me.',
    'Mind your manners at the Stake Board, now.',
  ],
  'imaliltoad': [
    'One day I\'m taking Zara\'s crown. ONE DAY.',
    'Race you to the next level. Loser buys the trout.',
    'I trained ALL morning. Well. Some of the morning.',
    'What\'s the fastest way to get rich? Asking for a me.',
    'Watch this — actually wait, let me practise first.',
  ],
  'papa4life': [
    'No rush. The fish aren\'t going anywhere. Neither am I.',
    'Slow and steady banks the gold.',
    'I\'ve seen a hundred champions come and go. I\'m still here.',
    'Best seat in the plaza is the one you bring yourself.',
    'Papa\'s rule: never stake what you can\'t laugh about losing.',
  ],
  '6 d9': [
    'Played since the old days. The REAL old days.',
    'kingnally3\'s my main, you know. This is just my little alt.',
    'They don\'t make grind like they used to. Good.',
    'I remember when this plaza was two stalls and a dream.',
    'Veteran tip: the bank chest is your best friend. Use it.',
  ],
};
// Generic activity remarks, keyed loosely by what the bot is up
// to; state interpolation keeps them honest.
function botActivityLine(bot) {
  const name = bot.profile.username;
  const bank = [];
  const act = botActivityPhrase(bot);
  const plan = bot.plan;
  if (bot.def && bot.def.shady) bank.push(...BOT_VOICE_LINES['branman3']);
  if (BOT_VOICE_LINES[name]) bank.push(...BOT_VOICE_LINES[name]);
  if (plan && plan.kind === 'train' && plan.skill) {
    bank.push(`Grinding ${cap(plan.skill)} — level ${levelForXp(bot.profile.xp[plan.skill] || 0)} and counting.`,
      `This ${cap(plan.skill)} grind is the real boss fight.`,
      `Nearly dropped my weapon mid-swing. Graceful as ever.`);
  }
  if (plan && plan.kind === 'gather') {
    bank.push('Filling the pack, then it\'s sell-up time.', 'Honest work, honest gold.', 'One more haul and I\'m banking.');
  }
  if (bot.sess.area === 'cove') bank.push('The trout are biting today.', 'Nothing beats the cove when it\'s quiet like this.', 'Lost a good one just now. The lake keeps the change.');
  if (bot.sess.area === 'mine') bank.push('Rock\'s stubborn today.', 'Hear that ringing? That\'s money.', 'Emberfall dust gets everywhere. Worth it.');
  if (bot.sess.area === 'gathering') bank.push('Cave\'s peaceful today.', 'Logs, ore, gems — the cave provides.');
  if (bot.sess.area === 'goblins') bank.push('These goblins never learn.', 'Goblin gold spends the same as any gold.');
  if (bot.sess.area === 'magic') bank.push('Mind the wizards — they bite back with spells.', 'Runes in, levels out.');
  if (bot.sess.area === 'range') bank.push('Fern runs a tight camp out here.', 'Steady… breathe… loose.');
  bank.push(`Just ${act}. Living the dream.`, `Still ${act}. Someone bring snacks.`);
  return talkPick(bank);
}
// A reply to a player who just spoke near the bot. Grounded:
// greets back, says what it's doing, colours by the relationship.
function botReplyLine(bot, speakerName, text) {
  const me = bot.profile, rel = botRelation(me, speakerName);
  const friend = botBestFriend(me);
  const act = botActivityPhrase(bot);
  const bank = [];
  if (CHAT_GREETING_RE.test(text)) {
    bank.push(`Hey ${speakerName}. Just ${act} — how about you?`,
      `${speakerName}! Good to see you. I'm ${act} if you're looking for company.`,
      `Morning-ish, ${speakerName}. Mind the plaza traffic.`);
  }
  if (/thank|thanks|thx|ty\b/i.test(text)) bank.push(`Any time, ${speakerName}.`, `Don't mention it. Well — mention it a little.`);
  if (/bye|cya|see you|gtg/i.test(text)) bank.push(`See you around, ${speakerName}.`, `Later, ${speakerName}. Don't do anything I wouldn't stake on.`);
  if (/duel|fight me|stake|challenge/i.test(text)) {
    bank.push(botTrait(me, 'aggression') > 55
      ? `Careful what you wish for, ${speakerName}. Set it up on the board and I'll see you there.`
      : `Duels? I'm more of a careful type, ${speakerName} — but the dais is right there if you're feeling brave.`);
  }
  if (/gold|rich|money|poor|broke/i.test(text)) {
    bank.push(`Gold? Goblins, logs and the Exchange, ${speakerName}. That's the whole secret.`,
      `I'm sitting on ${goldTotal(me)}g myself. Earned every coin. Mostly.`);
  }
  if (rel <= BOT_GRUDGE) bank.push(`...I've not forgotten what you did, ${speakerName}.`, `Hmph. ${speakerName}.`);
  else if (rel >= FRIEND_THRESHOLD) bank.push(`${speakerName}! My favourite person in the plaza. Don't tell the others.`, `For you, ${speakerName}? Always got time.`);
  else if (friend && friend.toLowerCase() === speakerName.toLowerCase()) bank.push(`${speakerName}! There you are. I was just ${act}.`);
  if (bot.def && bot.def.shady) bank.push(
    `${speakerName}, friend — have I got a deal for you sometime. A REAL deal. Trade me and see.`,
    `Psst, ${speakerName}. Keep this between us: the best money in this plaza never touches a shop.`,
    `You look like a person of taste, ${speakerName}. Taste and gold. Let's talk business sometime.`);
  if (BOT_VOICE_LINES[me.username]) bank.push(...BOT_VOICE_LINES[me.username]);
  bank.push(`Just ${act}, ${speakerName}. What brings you by?`,
    `Can't chat long — I'm ${act}. Walk with me if you like.`,
    `That's the way of it, ${speakerName}. Anyway — back to ${act} for me.`);
  return talkPick(bank);
}
// Bot-to-bot banter: an opener addressed to the other bot, and
// the reply when it lands.
function botBbOpener(bot, other) {
  const on = other.profile.username, act = botActivityPhrase(other);
  const bank = [
    `${on} — still ${act}? You'll wear a hole in the world.`,
    `Oi, ${on}. Race you to the next level?`,
    `${on}, you owe me a trout from last time. Don't think I've forgotten.`,
    `Heard the Exchange is moving today, ${on}. Just saying.`,
    `${on}! Tell them about the time you nearly beat Jad. Go on. The SHORT version.`,
  ];
  if (bot.def && bot.def.shady) bank.push(`${on}, have I got an opportunity for you. A genuine, no-strings, only-slightly-strings opportunity.`);
  if (botRelation(bot.profile, on) <= BOT_GRUDGE) bank.push(`${on}. Still breathing, I see. Pity.`);
  return talkPick(bank);
}
function botBbReply(bot, openerName) {
  const bank = [
    `Ha! ${openerName}, you wish.`,
    `Says the one talking instead of training, ${openerName}.`,
    `Put your gold where your mouth is, ${openerName}.`,
    `Not now, ${openerName} — I'm in the zone. THE ZONE.`,
    `You always say that, ${openerName}. Always.`,
  ];
  if (BOT_VOICE_LINES[bot.profile.username]) bank.push(...BOT_VOICE_LINES[bot.profile.username]);
  return talkPick(bank);
}
// Deliver a bot line through the real chat path, retrying a
// couple of times if the area just spoke (botSay's gap) — a reply
// a player is waiting for shouldn't be eaten by the chatter gap.
function botSaySoon(bot, text, tries = 2) {
  if (botSay(bot, text)) return;
  if (tries <= 0) return;
  setTimeout(() => { try { botSaySoon(bot, text, tries - 1); } catch (e) { /* moved on */ } }, 2100 / BOT_TIME_SCALE);
}
// The free-talk drive, called from botThink beside the Stage 40
// social drive: activity remarks anywhere (Stage 40's small talk
// is plaza-only) and bot-to-bot exchanges. All voluntary lines
// share the lastTalkAt clock so a bot's total chatter stays
// bounded no matter which drive fires.
function botFreeTalkDrive(bot) {
  if (BOT_TALK_OFF || !botsReady) return;
  const sess = bot.sess, now = Date.now();
  if (botBusyForTalk(bot)) return;
  // Activity remarks: any area, any working plan — a bot living
  // its life out loud, on the shared talk clock.
  if (now - bot.lastTalkAt >= BOT_TALK_EVERY_MS && bot.plan && (bot.plan.kind === 'train' || bot.plan.kind === 'gather')) {
    if (botScore(bot, { sociability: 0.4 }) > 54) {
      bot.lastTalkAt = now;
      botSay(bot, botActivityLine(bot));
      return;
    }
    bot.lastTalkAt = now - BOT_TALK_EVERY_MS + 60000 / BOT_TIME_SCALE; // recheck soon, not every tick
  }
  // Bot-to-bot: two bots near each other in the same area trade a
  // line pair, on a long per-pair clock.
  if (now - bot.lastTalkAt < 30000 / BOT_TIME_SCALE) return;
  for (const other of bots.values()) {
    if (other === bot || other.sess.area !== sess.area || botBusyForTalk(other)) continue;
    if (Math.hypot(other.sess.x - sess.x, other.sess.y - sess.y) > 260) continue;
    const pairKey = [bot.key, other.key].sort().join('|');
    if (now - (bot.bbAt.get(pairKey) || 0) < BOT_BB_EVERY_MS) continue;
    if (botScore(bot, { sociability: 0.45 }) < 58) { bot.bbAt.set(pairKey, now - BOT_BB_EVERY_MS + 90000 / BOT_TIME_SCALE); continue; }
    bot.bbAt.set(pairKey, now);
    other.bbAt.set(pairKey, now);
    bot.lastTalkAt = now;
    if (botSay(bot, botBbOpener(bot, other))) {
      const replyBot = other, openerName = bot.profile.username;
      setTimeout(() => {
        try {
          if (botsReady && !botBusyForTalk(replyBot)) { replyBot.lastTalkAt = Date.now(); botSaySoon(replyBot, botBbReply(replyBot, openerName), 1); }
        } catch (e) { /* moved on */ }
      }, botDelay(2200, 5200) / BOT_TIME_SCALE);
    }
    return;
  }
}
// A bot's reaction when a duel it fought ends (win or lose) —
// called from endDuel after settlement. Lines by
// traits; friends and grudges colour them.
function botDuelReact(botKey, won, oppName, stake) {
  if (BOT_TALK_OFF || !botsReady) return;
  const bot = bots.get(botKey);
  if (!bot) return;
  const rel = botRelation(bot.profile, oppName);
  let bank;
  if (won) {
    bank = ['Gg. Earned every coin of that.', 'And THAT is how it\'s done.', 'Good fight. The gold softens it. For me.'];
    if (botTrait(bot.profile, 'aggression') > 65) bank.push('Too easy. Who\'s next?', 'That\'s the difference between us. Remember it.');
    if (rel >= FRIEND_THRESHOLD) bank.push(`Sorry, ${oppName} — business is business. First trout's on me.`);
    if (bot.def && bot.def.shady) bank.push('Clean win. Totally clean. Why are you looking at me like that?');
  } else {
    bank = ['Gg. Ow. But gg.', 'Rematch. Not now — but rematch.', 'The dais giveth, the dais taketh away.'];
    if (rel <= BOT_GRUDGE) bank.push(`You. ${oppName}. This isn't over.`);
    if (botTrait(bot.profile, 'risk') > 65) bank.push('Worth the gamble. It\'s only gold.');
    if (bot.def && bot.def.shady) bank.push('I meant to do that. Part of a larger plan. A secret plan.');
  }
  if (stake > 0 && Math.random() > 0.5) return; // staked losses/wins often pass quietly
  const delay = botDelay(2000, 6000) / BOT_TIME_SCALE;
  setTimeout(() => { try { if (!botBusyForTalk(bot)) botSaySoon(bot, talkPick(bank), 1); } catch (e) { /* moved on */ } }, delay);
}
// A bot's own level-up line (its gather lines already exist in
// botGatherOnce; this covers combat/PvM XP through onLevelUp),
// plus a nearby bot congratulating a HUMAN who just levelled.
function botLevelReact(key, sess, skill, level) {
  if (BOT_TALK_OFF || !botsReady) return;
  const self = bots.get(key);
  if (self) {
    const line = talkPick([
      `Level ${level} ${cap(skill)}! Took long enough.`,
      `${cap(skill)} ${level}. Write it down, history.`,
      `Ding! ${cap(skill)} level ${level}. Drinks are on… someone else.`,
    ]);
    setTimeout(() => { try { if (!botBusyForTalk(self)) botSaySoon(self, line, 1); } catch (e) { /* moved on */ } }, botDelay(1200, 3500) / BOT_TIME_SCALE);
    return;
  }
  if (!sess || sess.bot) return;
  // A human levelled: one nearby, sociable, unbusy bot may cheer.
  if (Math.random() > 0.5) return;
  const cands = [...bots.values()].filter((b) => b.sess.area === sess.area && !botBusyForTalk(b)
    && Math.hypot(b.sess.x - sess.x, b.sess.y - sess.y) <= BOT_TALK_RANGE
    && Date.now() - b.lastReplyAt >= BOT_REPLY_COOLDOWN_MS);
  if (!cands.length) return;
  const bot = botPickWeighted(cands[0], cands.map((b) => ({ value: b, weight: 5 + botTrait(b.profile, 'sociability') })));
  if (botScore(bot, { sociability: 0.4 }) < 55) return;
  bot.lastReplyAt = Date.now();
  const name = sess.profile.username;
  const line = talkPick([`Gz on ${level} ${cap(skill)}, ${name}!`, `${level} ${cap(skill)} — nice one, ${name}.`, `Look at ${name} go. ${cap(skill)} ${level}!`]);
  setTimeout(() => { try { if (!botBusyForTalk(bot)) botSaySoon(bot, line, 1); } catch (e) { /* moved on */ } }, botDelay(1500, 4000) / BOT_TIME_SCALE);
}

// ---------- Part C: ask-and-learn ----------
// Help-seeking patterns (public chat, whispers, keeper modal).
const HELP_ASK_RE = /(what (do|should|can) i do|what'?s next|what now|how (do|can) i (make|earn|get|start|train|fish|mine)|make (money|gold)|earn (money|gold)|get (rich|gold|money)|where (do|can|should) i (train|go|start|fish|mine)|i'?m (new|lost|stuck)|im (new|lost|stuck)|need help|help me|any (tips|advice)|advice)/i;
function isHelpAsk(text) {
  const t = (text || '').trim().toLowerCase();
  if (t === 'help' || t === 'help?' || t === '?') return true;
  return HELP_ASK_RE.test(text || '');
}
function guideLvl(p, skill) { return levelForXp((p.xp && p.xp[skill]) || 0); }
function guidePack(p, item) { return stackQty(p.backpack, item); }
// Runecrafting quest (2026-11-24): the Guided path's quest pointer
// retires once "Rune Crafting" is complete.
function rcQuestDone(p) { const q = p.quests && p.quests.runecrafting; return !!(q && q.status === 'done'); }
function guideWornHas(p, pred) { return Object.values(p.worn || {}).some((id) => id && pred(id)); }
function guideHasPickaxe(p) {
  return ['bronze_pickaxe', 'iron_pickaxe', 'steel_pickaxe', 'mithril_pickaxe', 'adamant_pickaxe', 'rune_pickaxe', 'dragon_pickaxe']
    .some((id) => guidePack(p, id) > 0) || guideWornHas(p, (id) => id.endsWith('_pickaxe'));
}
const GUIDE_ORES = ['copper_ore', 'tin_ore', 'iron_ore', 'silver_ore', 'coal', 'gold_ore', 'mithril_ore', 'adamantite_ore', 'runite_ore'];
const GUIDE_BARS = ['bronze_bar', 'iron_bar', 'steel_bar', 'silver_bar', 'mithril_bar', 'adamant_bar', 'rune_bar', 'bars'];
function guideMeleeAvg(p) { return (guideLvl(p, 'attack') + guideLvl(p, 'strength') + guideLvl(p, 'defence')) / 3; }
function guideBarrowsReady(p) { return ['attack', 'strength', 'defence', 'hitpoints'].every((s) => guideLvl(p, s) >= 40); }
function guideBarrowsNear(p) { return ['attack', 'strength', 'defence', 'hitpoints'].every((s) => guideLvl(p, s) >= 30); }
// The PATH TABLE: ordered journey steps. Each step says when it
// APPLIES to an asker (when), when the asker has already OUTGROWN
// it (done), the full answer (text) and a one-line version for
// unsolicited tips (tip). Resource-in-hand steps come first —
// holding the input is the strongest signal — then the beginner
// money step, the skill climbs, duelling, and Barrows. Only
// things that exist in the game today are ever recommended.
// Later builds (Runecrafting quest, the town) extend this table.
const GUIDE_STEPS = [
  { id: 'bury_bones', domains: ['farm', 'prayer', 'combat'],
    when: (p) => guidePack(p, 'animal_bones') > 0,
    done: (p) => guideLvl(p, 'prayer') >= 3,
    text: (n) => `Those bones in your pack, ${n}? Tap one and press Bury — that's free Prayer XP, and Prayer powers your Deflects when something's hitting you.`,
    tip: 'bury those bones you\'re carrying — free Prayer XP for your Deflects.' },
  { id: 'spin_wool', domains: ['farm', 'crafting'],
    when: (p) => guidePack(p, 'wool') > 0,
    done: (p) => guideLvl(p, 'crafting') >= 2 || guidePack(p, 'yarn') > 0,
    text: (n) => `That wool's worth more spun, ${n}. Take it to the spinning wheel at Nally Farm, south-west of the plaza — wool in, ball of yarn out, Crafting XP every spin. Yarn strings amulets later.`,
    tip: 'take that wool to the spinning wheel at the farm — yarn is worth more, and it\'s Crafting XP.' },
  { id: 'smelt_smith', domains: ['mining', 'smithing'],
    when: (p) => GUIDE_ORES.some((o) => guidePack(p, o) > 0),
    done: (p) => guideLvl(p, 'smithing') >= 5,
    text: (n, p) => guidePack(p, 'gold_ore') > 0
      ? `Gold ore, ${n}? Smelt it at the Emberfall furnace into gold bars — bars sell big on the Exchange, and a gold bar plus a gem makes an amulet with Crafting.`
      : `That ore wants a furnace, ${n}. Smelt it at Emberfall, north-east through the plaza's east gate, then work the bars on the anvil — Smithing XP and gear you made yourself.`,
    tip: 'smelt that ore at the Emberfall furnace — bars are where the money is.' },
  { id: 'craft_amulet', domains: ['crafting', 'farm'],
    when: (p) => guidePack(p, 'yarn') > 0 || guidePack(p, 'bars') > 0 || GEM_TIERS.some((g) => guidePack(p, g) > 0),
    done: (p) => guideLvl(p, 'crafting') >= 15,
    text: (n) => `You're holding amulet parts, ${n}. Crafting turns a gold bar and a gem into an unstrung amulet, yarn strings it, and an Enchant spell from the spellbook finishes it — worn, it makes you hit harder.`,
    tip: 'a gold bar, a gem and your yarn make an amulet — Crafting, then string it, then enchant it.' },
  { id: 'first_coins', domains: [],
    when: (p) => goldTotal(p) < 150,
    done: (p) => goldTotal(p) >= 250,
    text: (n) => `Short on gold, ${n}? Head east of the plaza to the Goblin Camp — goblins drop coins — and chop logs or pick seaweed at the Fishing Cove to sell at the plaza shops. A hundred gold stakes your first duel at Mod Ash.`,
    tip: 'goblins east of the plaza drop gold, and logs and seaweed sell at the shops — that\'s your first coins.' },
  { id: 'train_combat', domains: ['combat', 'duelling', 'attack', 'strength', 'defence', 'hitpoints'],
    when: (p) => !guideBarrowsReady(p),
    done: (p) => guideBarrowsReady(p),
    text: (n) => `Train your combat, ${n}: the Training Cave dummies are safe XP, and the Beginner Barrows Training Grounds teach the Deflects step by step. Aim for Attack, Strength, Defence and Hitpoints around 40 — that's Barrows territory.`,
    tip: 'train at the Training Cave and the Barrows Training Grounds — 40s in Attack, Strength, Defence and Hitpoints opens Barrows.' },
  { id: 'fish_trout', domains: ['fishing', 'cooking'],
    when: (p) => guideLvl(p, 'fishing') < 10,
    done: (p) => guideLvl(p, 'fishing') >= 10,
    text: (n) => `Try the Fishing Cove, west through the plaza gate, ${n}. The trout spots by the piers are level 1 — catch trout, cook them on a fire, and you've got food that heals for your fights.`,
    tip: 'the trout spots by the cove piers are level 1 — catch and cook your own fight food.' },
  { id: 'mine_basics', domains: ['mining', 'smithing'],
    when: (p) => guideLvl(p, 'mining') < 15,
    done: (p) => guideLvl(p, 'mining') >= 15,
    text: (n, p) => guideHasPickaxe(p)
      ? `Work the Emberfall Mine, ${n} — copper and tin first, iron at Mining 10. Smelt bars at the furnace, and watch for gems: they turn up in the rock now and then.`
      : `You need a pickaxe to mine, ${n} — Pickaxe Pete at the Emberfall Mine, north-east of the plaza, sells a bronze one for 60g. Then copper and tin are all yours.`,
    tip: 'Emberfall Mine, north-east — copper and tin first, and gems hide in the rock.' },
  { id: 'try_ranged_magic', domains: ['ranged', 'magic', 'fletching'],
    when: (p) => guideLvl(p, 'ranged') < 10 && guideLvl(p, 'magic') < 10,
    done: (p) => guideLvl(p, 'ranged') >= 10 || guideLvl(p, 'magic') >= 10,
    text: (n) => `Two more ways to fight, ${n}: the Ranger Camp north of the plaza for Ranged — Ranger Fern will set you straight — and the Wizard Grounds north-west for Magic. Spells burn runes; wizards drop them.`,
    tip: 'Ranger Camp north for bows, Wizard Grounds north-west for spells — both beat standing still.' },
  { id: 'stake_duel', domains: ['duelling'],
    when: (p) => guideMeleeAvg(p) >= 15 && goldTotal(p) >= 60,
    done: (p) => (p.wins || 0) >= 1,
    text: (n) => `Ready to test yourself, ${n}? Inside a duel everyone's stats are levelled, so it's fair. Start with Mod Ash on the dais — 100g stake — or post a small bid on the Stake Board, south-west corner.`,
    tip: 'duels level everyone\'s stats — Mod Ash on the dais takes a 100g stake when you\'re ready.' },
  { id: 'barrows_ready', domains: ['combat'],
    when: (p) => guideBarrowsNear(p) && !guideBarrowsReady(p) && (p.barrowsRuns || 0) < 1,
    done: (p) => guideBarrowsReady(p) || (p.barrowsRuns || 0) >= 1,
    text: (n) => `You're close to Barrows, ${n}. Push Attack, Strength, Defence and Hitpoints to about 40, stock food and prayer potions, and learn your Deflects at the Training Grounds — the brothers punish the wrong prayer.`,
    tip: 'you\'re nearly Barrows-ready — 40s across your melee stats, food, prayer potions, Deflects practised.' },
  { id: 'barrows_run', domains: ['combat'],
    when: (p) => guideBarrowsReady(p) && (p.barrowsRuns || 0) < 1,
    done: (p) => (p.barrowsRuns || 0) >= 1,
    text: (n) => `You're Barrows-ready, ${n}. Six mounds, six brothers — search the sarcophagus to wake each one, match your Deflect to their style, and the tunnels hide the chest. Bring food and prayer potions.`,
    tip: 'you\'re ready for Barrows itself — six brothers, matched Deflects, food and prayer potions.' },
  { id: 'rune_quest', domains: ['magic', 'runecrafting'],
    when: (p) => !rcQuestDone(p),
    done: (p) => rcQuestDone(p),
    text: (n) => `There's a new art to learn, ${n}: Runecrafting. Wizard Alden at the Wizard Grounds is teaching it — his quest "Rune Crafting" walks you from your first essence to casting a spell with runes you made yourself.`,
    tip: 'Wizard Alden at the Wizard Grounds teaches Runecrafting — the quest "Rune Crafting".' },
  { id: 'endgame', domains: [],
    when: () => true,
    done: () => false,
    text: (n) => `You know the roads now, ${n}. The deep goals: the Fight Caves for the fire cape — nobody's beaten Jad yet — Barrows armour from the chest, and the hiscores board. The rest is style.`,
    tip: 'the Fight Caves and the fire cape are the deep end — nobody has beaten Jad yet.' },
];
// Pick the asker's next step. Candidates = steps that apply and
// aren't outgrown, in table order. If the front candidate is the
// step this player was LAST given (profile.guide.step) and
// another candidate exists, it rotates to the back — so asking
// again moves forward to the next step instead of repeating,
// while the highest-priority unfinished step still leads on a
// fresh visit. A character's DOMAIN step wins when it is already
// at the front of the asker's path (one of the first two
// candidates) — a broke beginner asking the mining keeper still
// gets the beginner money step, while a player holding ore gets
// the smelting step from that same keeper.
function guideStepFor(profile, domain) {
  const cands = GUIDE_STEPS.filter((s) => s.when(profile) && !s.done(profile));
  if (!cands.length) return GUIDE_STEPS[GUIDE_STEPS.length - 1];
  let ordered = cands;
  const lastId = profile.guide && profile.guide.step;
  if (lastId && cands.length > 1 && cands[0].id === lastId) ordered = [...cands.slice(1), cands[0]];
  if (domain) {
    const dom = ordered.slice(0, 2).find((s) => (s.domains || []).includes(domain));
    if (dom) return dom;
  }
  return ordered[0];
}
// The named characters who teach, with their spots and domains.
// Positions are the figures' real spots (client keeper figures /
// MOD_NPCS / the plaza stalls); the Tree Guardian is resolved
// dynamically from the asker's own ally.
const GUIDE_KEEPERS = [
  { id: 'pete', name: 'Pickaxe Pete', area: 'mine', x: 1340, y: 590, domains: ['mining', 'smithing'], frame: 'Pete leans on his pick.' },
  { id: 'wren', name: 'Fisher Wren', area: 'cove', x: 640, y: 570, domains: ['fishing', 'cooking'], frame: 'Wren checks her nets.' },
  { id: 'fern', name: 'Ranger Fern', area: 'range', x: 500, y: 630, domains: ['ranged', 'fletching'], frame: 'Fern nocks an arrow, then lowers it.' },
  { id: 'alden', name: 'Wizard Alden', area: 'magic', x: 920, y: 360, domains: ['magic', 'runecrafting'], frame: 'Alden looks up from a rune floating over his palm.' },
  { id: 'frost', name: 'Warden Frost', area: 'winter', x: 880, y: 660, domains: ['woodcutting', 'mining'], frame: 'Frost stamps the snow off his boots.' },
  { id: 'bramble', name: 'Farmer Bramble', area: 'plaza', x: 620, y: 722, domains: ['farm', 'crafting'], frame: 'Bramble wipes his hands on his apron.' },
  { id: 'wrenna', name: 'Farmer Wrenna', area: 'plaza', x: 660, y: 748, domains: ['farm', 'crafting'], frame: 'Wrenna straightens up from the rows.' },
  { id: 'duelmaster', name: 'Duel Master', area: 'plaza', x: 1030, y: 506, domains: ['duelling'], frame: 'The Duel Master folds his arms.' },
  { id: 'modash', name: 'Mod Ash', area: 'plaza', x: 680, y: 300, domains: ['duelling'], frame: 'Mod Ash taps his steel sword.' },
  { id: 'modblair', name: 'Mod Blair', area: 'plaza', x: 800, y: 280, domains: ['duelling'], frame: 'Mod Blair nods toward the dais.' },
  { id: 'modvega', name: 'Mod Vega', area: 'plaza', x: 920, y: 300, domains: ['duelling'], frame: 'Mod Vega grins like a fence post with secrets.' },
  { id: 'shop_potion', name: 'Potion Stall Keeper', area: 'plaza', x: 340, y: 220, domains: ['supplies'], frame: 'The keeper rattles a crate of vials.' },
  { id: 'shop_weapon', name: 'Weapon Stall Keeper', area: 'plaza', x: 1260, y: 220, domains: ['duelling', 'gear'], frame: 'The keeper polishes a blade.' },
  { id: 'shop_armour', name: 'Armour Stall Keeper', area: 'plaza', x: 1260, y: 680, domains: ['gear'], frame: 'The keeper raps a platebody with one knuckle.' },
  { id: 'shop_food', name: 'Food Stall Keeper', area: 'plaza', x: 340, y: 680, domains: ['cooking', 'supplies'], frame: 'The keeper fans the smell of fresh rations your way.' },
];
// Compose + record a guide answer for an asker from a character
// ({ kind:'bot', bot } | { kind:'keeper', keeper } | { kind:'guardian' }).
// Records profile.guide (the progression memory) and saves.
function guideAnswerFor(askerKey, askerSess, source) {
  const p = askerSess.profile;
  ensureV2(p);
  let domain = null, whoName = 'A local';
  if (source.kind === 'bot') {
    whoName = source.bot.profile.username;
    const act = botActivityPhrase(source.bot);
    const planSkill = source.bot.plan && source.bot.plan.skill;
    if (planSkill) domain = planSkill;
    else if (/fishing/i.test(act)) domain = 'fishing';
    else if (/mining/i.test(act)) domain = 'mining';
    else if (/duel/i.test(act)) domain = 'duelling';
  } else if (source.kind === 'keeper') {
    whoName = source.keeper.name;
    domain = source.keeper.domains[0];
  } else if (source.kind === 'guardian') {
    whoName = 'Tree Guardian';
    domain = 'gathering';
  }
  const step = guideStepFor(p, domain);
  p.guide.step = step.id;
  p.guide.asks = (p.guide.asks || 0) + 1;
  p.guide.at = Date.now();
  save(askerKey);
  return { who: whoName, stepId: step.id, text: step.text(p.username, p) };
}
// A keeper speaks in public chat through the real chat path (the
// Duel Master precedent): a chat line in the log for everyone.
function keeperSay(name, text) {
  broadcast({ type: 'chat', from: name, text });
}
// Who answers this asker, standing where they stand? The nearest
// of: a bot in range, a keeper in range, the asker's own Tree
// Guardian beside them. Null when nobody is near — ask a person,
// not the wind.
function guideSourceNear(askerKey, askerSess) {
  let best = null;
  const consider = (d, src) => { if (d <= BOT_TALK_RANGE && (!best || d < best.d)) best = { d, src }; };
  for (const b of bots.values()) {
    if (b.sess.area !== askerSess.area || botBusyForTalk(b)) continue;
    consider(Math.hypot(b.sess.x - askerSess.x, b.sess.y - askerSess.y), { kind: 'bot', bot: b });
  }
  for (const k of GUIDE_KEEPERS) {
    if (k.area !== askerSess.area) continue;
    consider(Math.hypot(k.x - askerSess.x, k.y - askerSess.y), { kind: 'keeper', keeper: k });
  }
  const ally = allies.get(askerKey);
  if (ally && ally.area === askerSess.area && ally.hp > 0) {
    consider(Math.hypot(ally.x - askerSess.x, ally.y - askerSess.y), { kind: 'guardian' });
  }
  return best ? best.src : null;
}
// Public-chat hook (called from the chat handler after the
// broadcast): help asks route to Part C; everything else may draw
// ONE free-talk reply from a nearby bot.
function onPlayerChat(key, sess, text) {
  if (BOT_TALK_OFF || !botsReady || !sess || sess.bot) return;
  const now = Date.now();
  if (isHelpAsk(text)) {
    if (now - (sess.lastGuideAskAt || 0) < GUIDE_ASK_COOLDOWN_MS) return;
    sess.lastGuideAskAt = now;
    const src = guideSourceNear(key, sess);
    if (!src) return;
    const ans = guideAnswerFor(key, sess, src);
    if (src.kind === 'bot') {
      const bot = src.bot;
      bot.lastReplyAt = now;
      setTimeout(() => { try { botSaySoon(bot, ans.text, 2); } catch (e) { /* moved on */ } }, botDelay(900, 2200) / BOT_TIME_SCALE);
    } else {
      setTimeout(() => { try { keeperSay(ans.who, ans.text); } catch (e) { /* moved on */ } }, 700);
    }
    return;
  }
  // Free-talk reply: name-mentioned bots first, then greeting /
  // general chatter. Exactly one responder.
  const lower = text.toLowerCase();
  const cands = [];
  for (const b of bots.values()) {
    if (b.sess.area !== sess.area || botBusyForTalk(b)) continue;
    if (Math.hypot(b.sess.x - sess.x, b.sess.y - sess.y) > BOT_TALK_RANGE) continue;
    if (now - b.lastReplyAt < BOT_REPLY_COOLDOWN_MS) continue;
    if (now - (b.replyAtBy.get(key) || 0) < BOT_REPLY_PLAYER_MS) continue;
    const mentioned = lower.includes(b.profile.username.toLowerCase());
    cands.push({ bot: b, mentioned, d: Math.hypot(b.sess.x - sess.x, b.sess.y - sess.y) });
  }
  if (!cands.length) return;
  cands.sort((a, b2) => (b2.mentioned - a.mentioned) || (a.d - b2.d));
  const chosen = cands[0];
  const bot = chosen.bot;
  // Sociability decides whether it answers at all; being named or
  // greeted makes an answer much more likely.
  const bar = chosen.mentioned ? 30 : (CHAT_GREETING_RE.test(text) ? 42 : 62);
  if (botScore(bot, { sociability: 0.6 }) < bar) return;
  bot.lastReplyAt = now;
  bot.replyAtBy.set(key, now);
  const speakerName = sess.profile.username;
  const line = botReplyLine(bot, speakerName, text);
  setTimeout(() => { try { if (!botBusyForTalk(bot)) botSaySoon(bot, line, 2); } catch (e) { /* moved on */ } }, botDelay(1300, 3400) / BOT_TIME_SCALE);
}
// Whisper hook (called from the whisper handler when the target
// is a bot): help asks get the fitted path by whisper; other
// whispers get an in-character whisper back, on a per-player
// cooldown. A whisper is directed, so sociable bots nearly
// always answer.
function onPlayerWhisper(key, sess, targetKey, text) {
  if (BOT_TALK_OFF || !botsReady || !sess || sess.bot) return;
  const bot = bots.get(targetKey);
  if (!bot || botBusyForTalk(bot)) return;
  const now = Date.now();
  const replyWhisper = (t) => send(sess.ws, { type: 'whisper', from: bot.profile.username, text: t });
  if (isHelpAsk(text)) {
    if (now - (sess.lastGuideAskAt || 0) < GUIDE_ASK_COOLDOWN_MS) return;
    sess.lastGuideAskAt = now;
    const ans = guideAnswerFor(key, sess, { kind: 'bot', bot });
    setTimeout(() => { try { replyWhisper(ans.text); } catch (e) { /* moved on */ } }, botDelay(900, 2000) / BOT_TIME_SCALE);
    return;
  }
  if (now - (bot.whisperAtBy.get(key) || 0) < BOT_WHISPER_COOLDOWN_MS) return;
  if (botScore(bot, { sociability: 0.6 }) < 38) return;
  bot.whisperAtBy.set(key, now);
  bot.lastReplyAt = now;
  const line = botReplyLine(bot, sess.profile.username, text);
  setTimeout(() => { try { replyWhisper(line); } catch (e) { /* moved on */ } }, botDelay(1400, 3600) / BOT_TIME_SCALE);
}
// Unsolicited guidance — the ONLY thing the Guided path toggle
// gates. A bot near a player whose Guided path is ON, whose next
// step is still an early one, may offer that step as a tip, on a
// long per-player clock. OFF players are never tipped; asking
// always works regardless (see onPlayerChat / ask_guide).
function botGuideTipDrive(bot) {
  if (BOT_TALK_OFF || !botsReady) return;
  const sess = bot.sess, now = Date.now();
  if (botBusyForTalk(bot) || sess.area === 'arena') return;
  for (const [k, p] of online) {
    if (p.bot || p.area !== sess.area) continue;
    if (Math.hypot(p.x - sess.x, p.y - sess.y) > GUIDE_TIP_RANGE) continue;
    if (p.profile.guidedPath === false) continue; // the toggle, honoured
    if (now - (bot.guideTipAt.get(k) || 0) < GUIDE_TIP_COOLDOWN_MS) continue;
    // Readability: a bot that just greeted this player doesn't
    // pile a tip on top of the greeting — one approach at a time.
    if (now - (bot.greetedAt.get(k) || 0) < 240000 / BOT_TIME_SCALE) continue;
    const step = guideStepFor(p.profile, null);
    const idx = GUIDE_STEPS.indexOf(step);
    if (idx < 0 || idx > 4) continue; // tips are for the early path only
    if (botScore(bot, { sociability: 0.5 }) < 58) { bot.guideTipAt.set(k, now - GUIDE_TIP_COOLDOWN_MS + 120000 / BOT_TIME_SCALE); continue; }
    bot.guideTipAt.set(k, now);
    const line = `🧭 ${p.profile.username} — ${step.tip}`;
    setTimeout(() => { try { if (!botBusyForTalk(bot)) botSaySoon(bot, line, 1); } catch (e) { /* moved on */ } }, botDelay(800, 2500) / BOT_TIME_SCALE);
    return;
  }
}

function botThink(bot) {
  const sess = bot.sess, now = Date.now();
  // In a duel: drive the fighter, nothing else.
  if (sess.duelId) { botDuelDrive(bot); return; }
  if (bot.wasInDuel) {
    // The duel just ended (endDuel cleared the id): prayer off,
    // plans forgotten — the next think chooses fresh.
    bot.wasInDuel = false;
    if (bot.profile.activePrayer) { bot.profile.activePrayer = null; save(bot.key); }
    bot.plan = null;
  }
  // Stage 39: a Barrows / Fight Caves attempt owns the bot while
  // it runs — the drives work the real engines (crypt fights, the
  // tunnel puzzle, the chest, the caves' waves) until the run
  // settles or the bot gives it up.
  if (bot.pvm || sess.fcRunId || sess.barrowsFightId) {
    if (!bot.pvm) bot.pvm = sess.fcRunId ? { kind: 'fc', started: true } : { kind: 'barrows', started: true };
    if (botPvmDrive(bot)) return;
  }
  // Stage 38: the Wilderness owns a bot while it is out there —
  // the wild drive fights, flees, hunts, and brings it home. A
  // pending team-trip invitation launches the same way: answer the
  // leader's party invite first, then cross.
  if (isWildArea(sess.area)) { botWildDrive(bot); return; }
  if (bot.wildTrip && bot.wildTrip.state === 'enter') {
    const trip = bot.wildTrip;
    // An open trade or a stake match owns the bot until it ends —
    // the trip waits (and if it waits too long, the team simply
    // dissolves into a solo hunt under the grace rule). The trade
    // is DRIVEN from here, not just waited on: this branch sits
    // above the trade block in botThink, so a bare return would
    // stall the trade until its 120s timeout.
    const busyTrade = activeTradeForKey(bot.key);
    if (busyTrade) { botTradeDrive(bot, busyTrade); return; }
    if (stakeMatchForKey(bot.key)) return;
    if (trip.role === 'partner' && !trip.decided) {
      trip.decided = true;
      const leader = bots.get(trip.partnerKey);
      if (!leader || botScore(bot, { sociability: 0.4, loyalty: 0.3, risk: -0.2 }) <= 52) { bot.wildTrip = null; return; }
    }
    if (trip.role === 'leader' && trip.partnerKey) {
      // A team crosses together: if my partner is still finishing
      // something (a duel, most often — the pairing scheduler
      // keeps grabbing them), I wait for them up to the join
      // deadline, answering their re-invitation if the original
      // one lapsed while they were busy.
      const partner = bots.get(trip.partnerKey);
      const partnerComing = partner && partner.wildTrip && partner.wildTrip.state === 'enter' && partner.wildTrip.partnerKey === bot.key;
      const partnerBusy = partnerComing && (partner.sess.duelId || partner.sess.modDuelId || partner.sess.npcFightId || partner.sess.fcRunId
        || activeTradeForKey(partner.key) || stakeMatchForKey(partner.key));
      if (partnerBusy && now < (trip.joinBy || 0)) {
        const inv = findPartyInviteForTarget(bot.key);
        if (inv && inv.inviterKey === trip.partnerKey) botPartyAnswer(bot, inv);
        return;
      }
    }
    const inv = findPartyInviteForTarget(bot.key);
    if (inv && inv.inviterKey === trip.partnerKey) botPartyAnswer(bot, inv);
    else if (trip.role === 'partner' && trip.partnerKey) {
      // The leader's invitation lapsed while I was busy: renew it
      // from my side if they are still waiting to cross.
      const leader = bots.get(trip.partnerKey);
      if (leader && leader.wildTrip && leader.wildTrip.state === 'enter') botPartyInvite(bot, trip.partnerKey);
    }
    botEnterWild(bot);
    return;
  }
  if (bot.wildTrip) bot.wildTrip = null; // a trip that ended (death, exit, a partner who never came) leaves nothing behind
  // A stake match wants a Ready tap after a short human delay.
  const match = stakeMatchForKey(bot.key);
  if (match) {
    if (bot.stakeSeenMatch !== match.id) { bot.stakeSeenMatch = match.id; bot.stakeReadyAt = now + botDelay(1000, 3000); }
    if (now >= bot.stakeReadyAt) botStakeReady(bot, match);
    return;
  }
  bot.stakeSeenMatch = null;
  if (sess.area === 'waiting') { botTravelTo(bot, 'plaza'); return; } // a cancelled match left us standing there
  // Stage 38: an open trade owns the bot until it settles or dies.
  const myTrade = activeTradeForKey(bot.key);
  if (myTrade) { botTradeDrive(bot, myTrade); return; }
  if (bot.tradeState) { botDealIntents.delete(bot.tradeState.tradeId); bot.tradeState = null; }
  // Challenges first — they expire in 30s.
  for (const ch of [...challenges.values()]) {
    if (ch.from === bot.key || ch.to === bot.key) botChallengeDrive(bot, ch);
  }
  if ([...challenges.values()].some((ch) => ch.from === bot.key || ch.to === bot.key)) return;
  // Social answers.
  const inv = findPartyInviteForTarget(bot.key);
  if (inv) botPartyAnswer(bot, inv);
  botTradeRequestsDrive(bot); // Stage 38: trade requests are answered for real now (Stage 37 declined them all)
  botPartyMaintain(bot);
  // Habits: Stake Board business in the plaza, friend business
  // anywhere — then the day job.
  if (sess.area === 'plaza') botPlazaHabits(bot);
  botSocialDrive(bot); // Stage 40: plaza greetings + small talk (self-gates on the plaza)
  botFreeTalkDrive(bot); // NPC build: activity remarks + bot-to-bot banter
  botGuideTipDrive(bot); // NPC build: unsolicited path tips (Guided path toggle gates this)
  botDealDrive(bot); // Stage 38: skill deals, in any safe area
  botPvmHabits(bot); // Stage 39: Barrows / Fight Caves attempt decisions, made wherever the bot is standing
  botCityHabits(bot); // Stage 40: city building + City Idea work, decided wherever the bot is standing
  if (bot.pvm) { botPvmDrive(bot); return; }
  if (!isWildArea(sess.area) && sess.area !== 'waiting' && sess.area !== 'arena') botWildHabits(bot); // Stage 38: Wilderness trip decisions, made wherever the bot is standing
  botFriendHabits(bot);
  botPlanDrive(bot);
}
setInterval(() => {
  if (!botsReady) return;
  let anyMoved = false;
  for (const bot of bots.values()) {
    bot.moved = false;
    try { botThink(bot); } catch (e) { console.error('Stage 37 bot error for', bot.key, e); }
    if (bot.moved) anyMoved = true;
  }
  botPairingDrive(Date.now());
  if (anyMoved) broadcastState();
}, BOT_TICK_MS);

// Stage 34: last-resort safety net — log and keep the world up
// rather than letting one stray throw drop every player at once.
process.on('uncaughtException', (e) => { console.error('uncaughtException (kept running):', e); });

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
  buildCityIdeasRegistry(); // Stage 40: aggregate every admin's posted City Ideas the same way
  // Stage 37: the living NPC players — bot accounts are created /
  // backfilled and their sessions join the world BEFORE the server
  // listens, so a human registering a bot's name finds it taken.
  initBots();
  const mode = process.env.DATABASE_URL ? 'Postgres database' : 'local file (test mode)';
  server.listen(PORT, () => console.log(`nallystake-online listening on :${PORT} (gold-only, saving: ${mode})`));
}).catch((e) => { console.error('Could not open the saving database:', e.message); process.exit(1); });
