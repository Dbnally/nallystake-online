// Stage 34 tests: the four gear charts ported from the app version.
//   (1) catalogue completeness — every chart cell exists with the
//       app def's slot / style / shop / price / stats: melee plate
//       9 tiers x helm/body/legs/boots, d'hide 8 tiers x
//       coif/body/chaps/boots (the Karil's rung is the existing
//       Barrows loot), robes 9 tiers x hat/top/skirt/boots, and
//       weapons 9 tiers x 1h / 2h / ranged / magic. The expectation
//       tables below are written from the APP version's defs.
//   (2) buy + equip representative pieces from each armour line
//       and each weapon row, at the app's prices.
//   (3) two-handed semantics: equipping a 2h sends a worn shield
//       back to the backpack; equipping a shield sends a wielded
//       2h back; a full pack refuses the displacement; the area
//       snapshot shows no shield alongside a wielded 2h.
//   (4) the Steel crossbow fires ordinary arrows (one per shot).
//   (5) magic tiers: a Necro staff's casts break the Bronze staff's
//       max-hit cap in a live duel (cap = spell 17 + level term 13
//       + weapon bonus: bronze 31, necro 42 at the duel level).
// Same harness style as test/stage29.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18134;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage34.json');
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
  await sleep(400);
  await new Promise((resolve) => { p.once('exit', resolve); p.kill('SIGTERM'); setTimeout(resolve, 5000); });
  await sleep(300);
}
function seedDb(mutator) {
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  mutator(data);
  fs.writeFileSync(DB_FILE, JSON.stringify(data));
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
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
const PW = (n) => 's34-pass-' + n;
async function register(name) {
  const d = await api('/api/register', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function loginClient(name) {
  const d = await api('/api/login', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function prof(name) { return (await api('/api/login', { username: name, password: PW(name) })).profile; }
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  return (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
}
const stackQty = (profile, item) => (profile.backpack || []).filter((x) => x.item === item).reduce((n, s) => n + s.qty, 0);
// Run a challenge-screen duel (Stage 14 flow) into duel_start.
async function startDuelViaChallenge(challenger, target, label) {
  const mC = challenger.mark(); const mT = target.mark();
  challenger.send({ type: 'challenge', target: target.name, stake: 0, items: [], rules: {}, freePlay: true });
  const inc = (await target.waitSince(mT, (e) => e.type === 'challenge_incoming', 10000, label + ' incoming')).e;
  target.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  challenger.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  target.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  await challenger.waitSince(mC, (e) => e.type === 'duel_start', 15000, label + ' duel_start (challenger)');
  await target.waitSince(mT, (e) => e.type === 'duel_start', 15000, label + ' duel_start (target)');
}

// ---------- (1) the chart, as the app version defines it ----------
// [id, slot, buy, accBonus, maxBonus, reduction, strBonus, ticks, twoHanded]
const METALS = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune', 'dragon', 'torva', 'necro'];
const PLATE = { // per tier: helm [block,buy,hit], body [block,buy], legs [block,buy], boots [block,buy,acc]
  bronze: { helm: [0.01, 90, 0], body: [0.04, 140], legs: [0.01, 80], boots: [0.01, 70, 0] },
  iron: { helm: [0.02, 150, 0], body: [0.08, 280], legs: [0.02, 200], boots: [0.02, 130, 0] },
  steel: { helm: [0.03, 350, 0], body: [0.12, 560], legs: [0.03, 380], boots: [0.03, 320, 0] },
  mithril: { helm: [0.04, 520, 0], body: [0.16, 1120], legs: [0.04, 500], boots: [0.03, 480, 1] },
  adamant: { helm: [0.05, 640, 0], body: [0.20, 2240], legs: [0.05, 620], boots: [0.04, 600, 1] },
  rune: { helm: [0.06, 720, 0], body: [0.24, 4480], legs: [0.06, 700], boots: [0.05, 680, 1] },
  dragon: { helm: [0.07, 800, 1], body: [0.32, 8960], legs: [0.07, 850], boots: [0.05, 700, 2] },
  torva: { helm: [0.08, 1600, 1], body: [0.36, 17920], legs: [0.08, 1500], boots: [0.06, 1400, 2] },
  necro: { helm: [0.09, 2800, 2], body: [0.40, 35840], legs: [0.09, 2600], boots: [0.07, 2400, 3] },
};
const DHIDE_T = ['leather', 'studded', 'snakeskin', 'green', 'blue', 'red', 'black', 'armadyl'];
const DHIDE = { // acc pts per tier (same all slots), block + buy per slot
  acc: [1, 2, 3, 4, 5, 6, 7, 10],
  coif: { slot: 'head', block: [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05], buy: [60, 120, 240, 400, 560, 720, 900, 2000] },
  body: { slot: 'body', block: [0.02, 0.04, 0.06, 0.09, 0.12, 0.15, 0.18, 0.25], buy: [120, 240, 480, 960, 1920, 3840, 7680, 15360] },
  chaps: { slot: 'legs', block: [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05], buy: [55, 110, 220, 380, 540, 700, 880, 1900] },
  boots: { slot: 'feet', block: [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05], buy: [50, 100, 200, 350, 500, 650, 820, 1800] },
};
const ROBE = {
  wizard_hat: { slot: 'head', acc: [2, 3, 4, 6, 7, 8, 10, 12, 14], block: [0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05], buy: [70, 140, 300, 550, 700, 850, 1000, 1800, 3000] },
  robe_top: { slot: 'body', acc: [2, 3, 4, 6, 7, 8, 10, 12, 14], block: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12], buy: [130, 260, 520, 1040, 2080, 4160, 8320, 16640, 33280] },
  robe_skirt: { slot: 'legs', acc: [2, 3, 4, 6, 7, 8, 10, 12, 14], block: [0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05], buy: [65, 130, 280, 520, 680, 820, 980, 1700, 2900] },
  wizard_boots: { slot: 'feet', acc: [2, 3, 4, 5, 6, 7, 9, 11, 13], block: [0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05], buy: [55, 110, 240, 450, 600, 750, 900, 1600, 2700] },
};
const W1H = [ // [id, buy, accBonus, maxBonus]
  ['bronze_sword', 90, 0.02, 1], ['iron_sword', 180, 0.04, 2], ['steel_sword', 360, 0.06, 4],
  ['mithril_sword', 720, 0.08, 5], ['adamant_sword', 1440, 0.10, 6], ['rune_scimitar', 2880, 0.11, 7],
  ['dragon_sword', 5760, 0.12, 9], ['torva_sword', 11520, 0.14, 11], ['necro_blade', 23040, 0.16, 13],
];
const W2H = [
  ['bronze_greatsword', 150, 0.02, 5], ['iron_battleaxe', 300, 0.04, 6], ['steel_war_hammer', 600, 0.06, 8],
  ['mithril_battleaxe', 1200, 0.08, 9], ['adamant_greatsword', 2400, 0.10, 10], ['rune_battleaxe', 4800, 0.11, 11],
  ['dragon_greatsword', 9600, 0.12, 13], ['torva_maul', 19200, 0.14, 15], ['necro_scythe', 38400, 0.16, 17],
];
const WRANGED = [ // [id, buy, accPts, strBonus, ticks]
  ['bronze_bow', 80, 1, 1, 0], ['iron_bow', 160, 2, 2, 0], ['steel_crossbow', 320, 3, 4, 5],
  ['mithril_bow', 640, 4, 5, 0], ['adamant_bow', 1280, 5, 6, 0], ['rune_bow', 2560, 6, 7, 0],
  ['dragon_bow', 5120, 8, 9, 0], ['torva_bow', 10240, 10, 11, 0], ['necro_bow', 20480, 12, 13, 0],
];
const WMAGIC = [ // [id, buy, accPts, maxBonus]
  ['bronze_staff', 70, 2, 1], ['iron_wand', 140, 3, 2], ['steel_wand', 280, 5, 3],
  ['mithril_staff', 560, 6, 4], ['adamant_staff', 1120, 8, 5], ['rune_staff', 2240, 9, 6],
  ['dragon_staff', 4480, 11, 8], ['torva_staff', 8960, 14, 10], ['necro_staff', 17920, 17, 12],
];

async function main() {
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh */ }
  await startServer();
  const clients = [];
  try {
    const names = ['S34Cat', 'S34Rich', 'S34TwoH', 'S34TwoH2', 'S34Stuck', 'S34Observ', 'S34Cross', 'S34Mage', 'S34Victim'];
    for (const n of names) { const c = await register(n); clients.push(c); c.close(); }
    await stopServer();
    const G = (qty) => ({ item: 'gold', qty });
    seedDb((data) => {
      const set = (name, mut) => { const u = data.users[name.toLowerCase()]; if (!u) throw new Error('seed: no user ' + name); mut(u.profile); };
      set('S34Rich', (p) => { p.backpack = [G(500000)]; });
      set('S34TwoH', (p) => { p.backpack = [G(100), { item: 'steel_war_hammer', qty: 1 }]; p.worn.shield = 'dragon_shield'; });
      set('S34TwoH2', (p) => { p.backpack = [G(100), { item: 'iron_battleaxe', qty: 1 }, { item: 'logs', qty: 3 }]; p.worn.shield = 'steel_shield'; });
      set('S34Stuck', (p) => {
        const fillers = ['logs', 'oak_logs', 'copper_ore', 'tin_ore', 'iron_ore', 'coal', 'uncut_gem', 'raw_shrimps', 'raw_trout', 'burnt_fish',
          'silver_ore', 'gold_ore', 'mithril_ore', 'adamantite_ore', 'runite_ore', 'bronze_bar', 'iron_bar', 'silver_bar', 'steel_bar',
          'mithril_bar', 'adamant_bar', 'rune_bar', 'bones', 'herbs', 'gems', 'charms'];
        p.backpack = [G(100), ...fillers.map((f) => ({ item: f, qty: 1 })), { item: 'steel_war_hammer', qty: 2 }];
        p.worn.shield = 'bronze_shield';
      });
      set('S34Cross', (p) => { p.backpack = [G(100), { item: 'steel_crossbow', qty: 1 }, { item: 'bronze_arrow', qty: 40 }]; });
      set('S34Mage', (p) => { p.xp.magic = 13034431; p.xp.hitpoints = 13034431; p.backpack = [G(100), { item: 'fire_rune', qty: 300 }]; p.worn.weapon = 'necro_staff'; });
      set('S34Victim', (p) => { p.xp.hitpoints = 13034431; p.backpack = [G(100), { item: 'ration', qty: 500 }]; });
    });
    await startServer();

    // ---------- (1) catalogue completeness ----------
    const Cat = await loginClient('S34Cat'); clients.push(Cat);
    const catEv = await Cat.waitFor((e) => e.type === 'catalog', 10000, 'catalog');
    const byId = {};
    for (const it of catEv.items) byId[it.id] = it;
    const eq = (a, b) => Math.abs((a || 0) - (b || 0)) < 1e-9;
    const checkGear = (id, want) => {
      const d = byId[id];
      assert(!!d, `(1) catalog has ${id}`);
      assert(d.slot === want.slot, `(1) ${id} slot ${want.slot} (got ${d.slot})`);
      assert(d.shop === want.shop, `(1) ${id} sold at ${want.shop} (got ${d.shop})`);
      assert(d.buy === want.buy, `(1) ${id} price ${want.buy}g (got ${d.buy})`);
      if (want.style) assert(d.style === want.style, `(1) ${id} style ${want.style} (got ${d.style})`);
      assert(eq(d.accBonus, want.acc || 0), `(1) ${id} accBonus ${want.acc || 0} (got ${d.accBonus})`);
      assert(eq(d.maxBonus, want.max || 0), `(1) ${id} maxBonus ${want.max || 0} (got ${d.maxBonus})`);
      assert(eq(d.reduction, want.red || 0), `(1) ${id} reduction ${want.red || 0} (got ${d.reduction})`);
      assert(eq(d.strBonus, want.str || 0), `(1) ${id} strBonus ${want.str || 0} (got ${d.strBonus})`);
      assert((d.ticks || 0) === (want.ticks || 0), `(1) ${id} ticks ${want.ticks || 0} (got ${d.ticks})`);
      assert(!!d.twoHanded === !!want.two, `(1) ${id} twoHanded ${!!want.two} (got ${!!d.twoHanded})`);
    };
    const slotOf = { helm: 'head', body: 'body', legs: 'legs', boots: 'feet' };
    const suffixOf = { helm: 'helm', body: 'platebody', legs: 'platelegs', boots: 'boots' };
    for (const t of METALS) {
      for (const part of ['helm', 'body', 'legs', 'boots']) {
        const st = PLATE[t][part];
        checkGear(`${t}_${suffixOf[part]}`, { slot: slotOf[part], shop: 'Armour', buy: st[1], red: st[0], max: part === 'helm' ? st[2] || 0 : 0, acc: part === 'boots' ? (st[2] || 0) / 40 : 0 });
      }
    }
    console.log('PASS (1) melee plate chart: 9 tiers x 4 slots, app stats + prices');
    for (let i = 0; i < DHIDE_T.length; i += 1) {
      for (const part of ['coif', 'body', 'chaps', 'boots']) {
        const st = DHIDE[part];
        const id = DHIDE_T[i] === 'armadyl' && part === 'body' ? 'armadyl_platebody' : `${DHIDE_T[i]}_${part}`;
        checkGear(id, { slot: st.slot, shop: 'Armour', buy: st.buy[i], red: st.block[i], acc: DHIDE.acc[i] / 40 });
      }
    }
    console.log("PASS (1) d'hide chart: 8 tiers x 4 slots, app stats + prices");
    for (const part of Object.keys(ROBE)) {
      const st = ROBE[part];
      for (let i = 0; i < METALS.length; i += 1) {
        checkGear(`${METALS[i]}_${part}`, { slot: st.slot, shop: 'Armour', buy: st.buy[i], red: st.block[i], acc: st.acc[i] / 40 });
      }
    }
    console.log('PASS (1) robe chart: 9 tiers x 4 slots, app stats + prices');
    for (const [id, buy, acc, max] of W1H) checkGear(id, { slot: 'weapon', style: 'melee', shop: 'Weapon', buy, acc, max });
    for (const [id, buy, acc, max] of W2H) checkGear(id, { slot: 'weapon', style: 'melee', shop: 'Weapon', buy, acc, max, ticks: 6, two: true });
    for (const [id, buy, accPts, str, ticks] of WRANGED) checkGear(id, { slot: 'weapon', style: 'ranged', shop: 'Weapon', buy, acc: accPts / 40, str, ticks });
    for (const [id, buy, accPts, max] of WMAGIC) checkGear(id, { slot: 'weapon', style: 'magic', shop: 'Weapon', buy, acc: accPts / 40, max });
    console.log('PASS (1) weapons chart: 9 tiers x 4 rows, app stats + prices');
    // Pre-existing pieces the port must NOT have bent out of shape:
    assert(byId.karils_top && eq(byId.karils_top.reduction, 0.21) && eq(byId.karils_top.accBonus, 0.20), '(1) karils_top unchanged (the chart\'s Karil\'s rung is the Barrows piece)');
    assert(byId.karils_crossbow && byId.karils_crossbow.style === 'ranged' && eq(byId.karils_crossbow.accBonus, 0.11), '(1) karils_crossbow unchanged');
    assert(byId.magic_shortbow && eq(byId.magic_shortbow.accBonus, 0.16) && byId.magic_shortbow.buy === 4800, '(1) the wooden bow line is untouched');
    assert(byId.staff && byId.staff.buy === 150 && eq(byId.staff.accBonus, 0.04), '(1) the plain Staff is untouched (Bronze staff is a separate chart piece)');
    assert(byId.bronze_shield && eq(byId.bronze_shield.reduction, 0.03) && byId.bronze_shield.buy === 60, '(1) bronze_shield keeps its non-chart stats');
    assert(!byId.barrows_necro_platebody && !byId.barrows_bronze_helm, '(1) the Barrows tier line stays chest-only — it is NOT in the shop catalogue at all');

    // ---------- (2) buy + equip representatives ----------
    const Rich = await loginClient('S34Rich'); clients.push(Rich);
    for (const item of ['leather_coif', 'bronze_robe_top', 'armadyl_platebody', 'torva_platebody', 'necro_staff', 'bronze_bow']) {
      Rich.send({ type: 'shop_buy', item, qty: 1 });
      await Rich.waitFor((e) => e.type === 'shop' && e.action === 'buy' && e.item === item, 10000, 'buy ' + item);
    }
    let rp = await prof('S34Rich');
    assert(rp.gold === 500000 - (60 + 130 + 15360 + 17920 + 17920 + 80), `(2) the six buys cost the app prices exactly (gold now ${rp.gold})`);
    Rich.send({ type: 'equip', item: 'leather_coif' });
    await Rich.waitFor((e) => e.type === 'profile' && e.profile.worn.head === 'leather_coif', 10000, 'equip coif');
    Rich.send({ type: 'equip', item: 'bronze_robe_top' });
    await Rich.waitFor((e) => e.type === 'profile' && e.profile.worn.body === 'bronze_robe_top', 10000, 'equip robe top');
    Rich.send({ type: 'equip', item: 'necro_staff' });
    await Rich.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'necro_staff', 10000, 'equip necro staff');
    rp = await prof('S34Rich');
    assert(rp.worn.head === 'leather_coif' && rp.worn.body === 'bronze_robe_top' && rp.worn.weapon === 'necro_staff', '(2) d\'hide coif, robe top and necro staff all worn');
    console.log('PASS (2) buy + equip across the lines');

    // ---------- (3) two-handed semantics ----------
    const Observ = await loginClient('S34Observ'); clients.push(Observ);
    const TwoH = await loginClient('S34TwoH'); clients.push(TwoH);
    TwoH.send({ type: 'equip', item: 'steel_war_hammer' });
    await TwoH.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'steel_war_hammer', 10000, 'equip 2h');
    let tp = await prof('S34TwoH');
    assert(tp.worn.weapon === 'steel_war_hammer' && tp.worn.shield === null, '(3) the 2h is wielded and the shield slot is EMPTY');
    assert(stackQty(tp, 'dragon_shield') === 1 && stackQty(tp, 'steel_war_hammer') === 0, '(3) the displaced dragon shield is back in the backpack');
    TwoH.send({ type: 'move', x: 812, y: 462 }); // state broadcasts ride movement — nudge one out
    const st = await Observ.waitFor((e) => e.type === 'state' && (e.players || []).some((p) => p.username === 'S34TwoH' && p.worn && p.worn.weapon === 'steel_war_hammer' && p.worn.shield === null), 15000, 'observer snapshot: 2h, no shield');
    assert(!!st, '(3) the area snapshot shows the 2h wielded with NO shield');
    TwoH.send({ type: 'equip', item: 'dragon_shield' });
    await TwoH.waitFor((e) => e.type === 'profile' && e.profile.worn.shield === 'dragon_shield', 10000, 'equip shield over 2h');
    tp = await prof('S34TwoH');
    assert(tp.worn.shield === 'dragon_shield' && tp.worn.weapon === null && stackQty(tp, 'steel_war_hammer') === 1, '(3) equipping the shield sent the 2h back to the backpack');
    // exact-spot path: equip the battleaxe from slot 1 with a shield worn
    const TwoH2 = await loginClient('S34TwoH2'); clients.push(TwoH2);
    TwoH2.send({ type: 'equip', item: 'iron_battleaxe', slot: 1 });
    await TwoH2.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'iron_battleaxe', 10000, 'equip 2h exact-spot');
    const tp2 = await prof('S34TwoH2');
    assert(tp2.worn.weapon === 'iron_battleaxe' && tp2.worn.shield === null && stackQty(tp2, 'steel_shield') === 1, '(3) exact-spot equip of a 2h also displaces the shield to the pack');
    // full pack: the displaced shield has nowhere to go -> refused, nothing moves
    const Stuck = await loginClient('S34Stuck'); clients.push(Stuck);
    const err = await expectError(Stuck, { type: 'equip', item: 'steel_war_hammer' }, 'full-pack 2h equip (3)');
    assert(/no room for your shield/.test(err.message), `(3) full-pack 2h equip refuses over the shield ("${err.message}")`);
    const sp2 = await prof('S34Stuck');
    assert(sp2.worn.shield === 'bronze_shield' && sp2.worn.weapon === null && stackQty(sp2, 'steel_war_hammer') === 2, '(3) the refused equip changed nothing');
    console.log('PASS (3) two-handed displacement semantics');

    // ---------- (4) the Steel crossbow fires arrows ----------
    const Cross = await loginClient('S34Cross'); clients.push(Cross);
    Cross.send({ type: 'equip', item: 'steel_crossbow' });
    await Cross.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'steel_crossbow', 10000, 'equip crossbow');
    Cross.send({ type: 'travel', to: 'goblins' });
    const ns = await Cross.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins' && (e.npcs || []).length > 0, 10000, 'goblin npc_state (4)');
    const gob = ns.npcs.find((n) => n.alive !== false) || ns.npcs[0];
    Cross.send({ type: 'move', x: gob.x, y: gob.y });
    await sleep(1800);
    const before = await prof('S34Cross');
    const mFight = Cross.mark();
    Cross.send({ type: 'attack_npc', id: gob.id });
    await Cross.waitSince(mFight, (e) => e.type === 'npc_fight' && e.phase === 'start', 10000, 'crossbow fight start (4)');
    await Cross.waitSince(mFight, (e) => e.type === 'npc_fight' && e.phase === 'tick' && typeof e.youHit === 'number', 20000, 'crossbow swing tick (4)');
    const after = await prof('S34Cross');
    assert(stackQty(before, 'bronze_arrow') - stackQty(after, 'bronze_arrow') >= 1, `(4) the crossbow consumed arrows (${stackQty(before, 'bronze_arrow')} -> ${stackQty(after, 'bronze_arrow')})`);
    console.log('PASS (4) steel crossbow consumes ordinary arrows per shot');

    // ---------- (5) magic tiers in a live duel ----------
    const Mage = await loginClient('S34Mage'); clients.push(Mage);
    const Victim = await loginClient('S34Victim'); clients.push(Victim);
    Mage.send({ type: 'set_spell', spell: 'fire_blast' });
    await sleep(300);
    await startDuelViaChallenge(Mage, Victim, 'magic duel');
    let mDuel = Mage.mark();
    Mage.send({ type: 'duel_attack' });
    // The victim eats whenever hurt so the duel lasts long enough
    // for a top-end cast to land; the caster's hits are capped at
    // 17 (Fire Blast) + 13 (duel level term) + 12 (Necro bonus) =
    // 42 — anything above 31 is impossible with a Bronze staff (+1).
    let best = 0; let hits = 0;
    const deadline = Date.now() + 150000;
    let vIdx = Victim.mark();
    while (Date.now() < deadline && best <= 31) {
      for (let i = mDuel; i < Mage.events.length; i++) {
        const e = Mage.events[i];
        if (e.type === 'duel_tick' && typeof e.youHit === 'number') { hits += 1; if (e.youHit > best) best = e.youHit; }
      }
      mDuel = Mage.events.length;
      let hp = null;
      for (let i = vIdx; i < Victim.events.length; i++) {
        const e = Victim.events[i];
        if (e.type === 'duel_tick' && typeof e.hpYou === 'number') hp = e.hpYou;
      }
      vIdx = Victim.events.length;
      if (hp !== null && hp < 85) { Victim.send({ type: 'use', item: 'ration' }); Victim.send({ type: 'use', item: 'ration' }); }
      if (Victim.events.some((e) => e.type === 'duel_end')) break;
      await sleep(250);
    }
    assert(hits >= 5, `(5) the necro caster landed casts in the duel (${hits} swings seen)`);
    assert(best > 31 && best <= 42, `(5) a Necro staff cast broke the Bronze cap: best hit ${best} (bronze cap 31, necro cap 42)`);
    console.log('PASS (5) magic tier bonus flows through live casts');

    console.log('STAGE 34 ALL PASS');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
  }
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
