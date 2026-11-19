# nallystake — Feature Inventory for the Online Move
_Gold-only. No real-money buy, sell, or cash-out. Compiled 2026-11-13 from Derek's current nallystake so nothing is lost in the move outside Muse._

## Phase 1 — Online core (building now)
- [x] Accounts: register / sign in, password hashed on the server
- [x] One shared plaza: real players see each other move in real time
- [x] Server-side saving per player: gold, rating, wins/losses (restores on sign-in)
- [x] Overhead / plaza chat between real players
- [x] Challenge a real player for a gold stake
- [x] Server-run duels on the 0.6s tick — server rolls the hits, holds both stakes in escrow, pays the winner (stops cheating)
- [x] Leaderboard from real player ratings

## Phase 2 — Port from current nallystake
- Plaza hub in 3D, red dragon-plate player look, tap-to-move / joystick, tap-and-drag camera + pinch zoom
- 4 attack styles (Accurate / Aggressive / Defensive / Controlled) with the style boosts already in game
- Dragon Slash special, potions + food, Quick Use slot, minimap + HP / Prayer / Special orbs
- Shops: Potion, Weapon, Armour, Food & Supplies (Cook Rosa), Duel Board + Duel Master
- Backpack (28-slot style): tap-to-wear equipping (worn item trades spots), slimmer panel, toggle off, better-item glow
- Worn Items panel (10 slots), Skills panel + OSRS XP curve / Combat Level
- Bank of Gielinor (stone window, tabs, search, 1/5/10/X/All, total value)
- Staking items as well as coins (potion 15g, ration 8g), drop items as piles in the plaza
- Gold Exchange (6 goods, drifting prices, 97% sell-back)
- Tiers as teams of 3 (low / mid / high)

## Phase 3 — Areas
- North gate: Fight Caves — full 63-wave table, TzTok-Jad, prayer switching, fire cape, saved records
- South gate: Barrows — six original brothers (Dharok, Guthan, Ahrim, Torag, Verac, Karil), tunnel crypt randomised per run, puzzle door, reward chest; leaving mid-run keeps kills until the round is finished. Brother mechanics per Derek's 2026-11-13 spec: Dharok's 2h axe hits harder as his HP falls (max ~20→49, rage warnings at 75/50/25%), Guthan randomly heals for his hit (green swirl splat), Karil Ranged, Ahrim Magic, Verac Melee with no prayer bypass, Torag two hammers, faster cycle, two hits per swing; matching Protect prayer fully prevents that brother's damage
- East: goblins dropping prayer-potion supplies
- South-east: Training Cave (safe, per-skill stations)
- South-west: Gathering Cave (Mining / Fishing / Woodcutting, sellable resources)
- West gate (added 2026-11-13): Fishing Cove — path out the west gate, Fisher Wren, lake with dock and three fishing spots, six cuttable trees; chop logs (Woodcutting XP), light a fire with a log (Firemaking XP, ~1 min burn), fish raw trout (Fishing XP), cook trout on the fire (Cooking XP, burn chance falls with level); cooked trout heals 15 HP, eats from Backpack or Quick Use; logs/raw/cooked trout save and bank. New skills: Woodcutting, Firemaking, Fishing, Cooking
- North-east corner (added 2026-11-13): Emberfall Mine & Smithy — mine gate in the plaza's north-east corner; 22 rocks covering all nine ores (Copper/Tin 1, Iron 10, Silver 20, Coal 30, Gold 40, Mithril 55, Adamantite 70, Runite 85), each with own look, level gate, progress bar, auto-repeat mining, regrow timer; pickaxes Bronze → Dragon (faster), from Pickaxe Pete's stall or the anvil; furnace smelts all eight bars with Derek's exact recipes, live pack + metal-bank counts, 1 / 5 / All; anvil has twelve categories across six metals, RS3 loop (unfinished item, progress bar, heat fades and slows work, reheat at forge, upgrades +1 to +4); smithed gear is wearable with real stats; ores/bars bank as ore box / metal bank, Pete buys stock for gold. New skills: Mining, Smithing (OSRS XP curve to 99)

## Visuals (added 2026-11-13)
- Textures + soft shadows pass across plaza, pits, caves, camp and Barrows: stone/grass/wood/rock/sand surfaces with bump relief, dragon-scale bump on knight armour (recolouring unchanged), sun follows the player, underground lighting dims to torch/lava

## Prayers — rule locked by Derek's spec
- Protect from Melee / Protect from Missiles / Protect from Magic — OSRS style: one active at a time, tap on/off, switching turns the previous off, active one lit gold and shown above the head, stacked vertically above the analog stick
- Prayer potions: doses on a quick-drink button, restore prayer points
- NOTE: the earlier "Deflect" delivery in Muse nallystake is marked unverified / naming-unresolved. The online version uses Protect, block-only, per Derek's pasted OSRS spec — do not carry Deflect over.

## Live-check status (2026-11-13 evening)
- Fishing Cove and Emberfall Mine & Smithy were built the same day and code-reviewed, but their full loops (chop → fire → fish → cook; mine → smelt → smith a full heat cycle) were not driven live end-to-end — Derek's phone check is the verification. Port them as specified, but re-verify against his live check before treating them as settled.

## Not in scope
- Real-money gold buy/sell or cash-out — OFF until a lawyer gives a written yes with conditions
- Simulated rivals as "real" players — in the online version, fighters are real accounts; simulated rivals, if kept for practice, must be labelled as simulated
