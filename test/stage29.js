// Stage 29 tests: the interaction ports from the app version's
// 2026-11-18 updates.
//   (1) spell buttons drag back onto the 🎛️ gear / 📖 spellbook
//       button to put them away, targets glowing gold mid-drag —
//       client-only, verified by source wiring asserts.
//   (2) worn exact-spot swaps: equipping from backpack slot N puts
//       the replaced worn piece into slot N exactly; tapping a worn
//       item unequips it to an empty slot, refused when the pack
//       is full; a partial stack keeps its slot on a swap.
//   (3) RS tap-to-move trade screen: client interaction rebuilt
//       (source asserts) over the unchanged Stage 7B protocol —
//       the protocol ops the new UI sends (offer, un-offer,
//       both-confirm execute) are driven end-to-end here.
//   (4) scrollable chat history: ~100 lines kept, no yank-to-bottom
//       when scrolled up — client-only, source asserts.
//   (5) seaweed at the Fishing Cove: clumps on the shore, tap to
//       pick up, and it NEVER stacks — every piece its own qty-1
//       stack through pickup, bank round-trip, drop/pickup and
//       shop sell; a full pack refuses the pickup.
//   (6) tapping a frozen opponent attacks with your weapon: in a
//       player duel, a mod duel and against a monster, weapon
//       swings land while the target is Freeze-rooted; the frozen
//       fighter's own weapon swings still work (regression).
// Same harness style as test/stage24.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18129;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage29.json');
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
const PW = (n) => 's29-pass-' + n;
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
const stacksOf = (profile, item) => (profile.backpack || []).filter((x) => x.item === item);
const bankStacksOf = (profile, item) => (profile.bank || []).filter((x) => x.item === item);
const stackQty = (profile, item) => stacksOf(profile, item).reduce((n, s) => n + s.qty, 0);
// Run a challenge-screen duel (Stage 14 flow) into duel_start.
async function startDuelViaChallenge(challenger, target, rules, label) {
  const mC = challenger.mark(); const mT = target.mark();
  challenger.send({ type: 'challenge', target: target.name, stake: 0, items: [], rules, freePlay: true });
  const inc = (await target.waitSince(mT, (e) => e.type === 'challenge_incoming', 10000, label + ' incoming')).e;
  target.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
  challenger.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  target.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
  const startC = (await challenger.waitSince(mC, (e) => e.type === 'duel_start', 15000, label + ' duel_start (challenger)')).e;
  const startT = (await target.waitSince(mT, (e) => e.type === 'duel_start', 15000, label + ' duel_start (target)')).e;
  return { startC, startT };
}
async function castOnce(client, spell, targetKind, targetId, label) {
  const m = client.mark();
  client.send({ type: 'cast_at', spell, targetKind, targetId });
  return (await client.waitSince(m, (e) => e.type === 'cast_result', 10000, label)).e;
}
function latestPos(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? { x: p.x, y: p.y } : null;
}
function latestNpcPos(client, area, npcId) {
  const st = [...client.events].reverse().find((e) => e.type === 'npc_state' && e.area === area);
  if (!st) return null;
  const n = (st.npcs || []).find((x) => x.id === npcId);
  return n ? { x: n.x, y: n.y } : null;
}
// Cast Freeze until it connects (button-cast cooldown respected).
async function freezeUntil(client, targetKind, targetId, maxAttempts, label) {
  let attempts = 0; let res = null;
  while (attempts < maxAttempts && !res) {
    attempts++;
    const r = await castOnce(client, 'freeze', targetKind, targetId, `${label} freeze attempt ${attempts}`);
    if (r.froze) res = r;
    else await sleep(3200);
  }
  return { res, attempts };
}

async function main() {
  // ---------- source-level checks ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/ITEMS\.seaweed = \{[^}]*noStack: true/.test(src) && /ITEMS\.seaweed = \{[^}]*sellOnly: 2/.test(src), 'source: seaweed def (resource, sellOnly 2, noStack)');
  assert(/function isNoStack/.test(src) && /if \(isNoStack\(item\)\) \{\s*let n = 0;/.test(src) && (src.match(/isNoStack\(item\)/g) || []).length >= 3, 'source: stackQty / addStacks / removeStacks are all no-stack aware');
  assert(/SEAWEED_RESPAWN_MS = 30000/.test(src) && /seaweed_pickup/.test(src) && /function seaweedMsg/.test(src), 'source: cove seaweed patches + pickup handler');
  assert(/const slotIdx =/.test(src) && /the exact spot it came from/.test(src), 'source: equip validates the client-named backpack slot for the exact-spot swap');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  // (1) spell drag-back
  assert(/\.spelldroptarget\{/.test(clientSrc) && /function spellDropTargets/.test(clientSrc) && /function overSpellDropTarget/.test(clientSrc) && /Spell button put away/.test(clientSrc), '(1) client: spell buttons drag back onto the gear / spellbook button (gold highlight, drop removes + persists)');
  assert(/setSpellDropHighlight\(true\)/.test(clientSrc) && /setSpellDropHighlight\(false\)/.test(clientSrc), '(1) client: drop targets light up while dragging and clear on drop');
  assert(/function openSpellPop/.test(clientSrc) && /Remove button/.test(clientSrc), '(1) client: the long-press remove popup is still there');
  // (2) exact-spot + tap-unequip wiring
  assert(/function bpPrimaryTap\(item,idx\)/.test(clientSrc) && /type:'equip',item,slot:/.test(clientSrc), '(2) client: backpack taps equip with the tapped slot index');
  assert(/slot:\$\{sIdx\}/.test(clientSrc) && /selIdx/.test(clientSrc), '(2) client: the detail sheet equips from the exact selected stack');
  assert(/Tap to take off/.test(clientSrc) && /type:'unequip',slot:/.test(clientSrc), '(2) client: tapping a worn item unequips it in one tap');
  // (3) trade interaction
  assert(/tradeTapAdd=function/.test(clientSrc) && /tradeTapBack=function/.test(clientSrc) && /id="tradebp"/.test(clientSrc), '(3) client: trade screen is tap-to-move (backpack tap offers, offer tap takes back)');
  assert(!/pickerHTML\('trp'\)/.test(clientSrc) && !/tradeupdate/.test(clientSrc), '(3) client: the old number-picker trade form is gone');
  assert(/kind==='note'/.test(clientSrc) && /personal/.test(clientSrc), '(3) client: notes are shown locked in the trade backpack (the only exclusion besides the gold stack)');
  // (4) chat history
  assert(/function logLine\(t\)\{[^}]*nearBottom/.test(clientSrc) && /lines\.length>101/.test(clientSrc), '(4) client: chat keeps ~100 lines and only auto-scrolls when already near the bottom');
  // (5) seaweed client
  assert(/function rebuildSeaweed/.test(clientSrc) && /type:'seaweed_pickup'/.test(clientSrc) && /m\.type==='seaweed'/.test(clientSrc), '(5) client: seaweed clumps render from server state and tap to pick up');
  // (6) frozen taps route to weapon attacks (no frozen check gates them)
  assert(/if\(duel&&best===duel\.opponent\)\{/.test(clientSrc) && /type:'duel_attack'/.test(clientSrc), '(6) client: a tap on the duel opponent sends duel_attack (frozen or not — cast precedence is the armedCastAt check above it)');
  const clientJs = [...clientSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  new Function(clientJs); // throws on a syntax error
  console.log('PASS source: client inline script parses');

  // ---------- register everyone, then seed ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    const names = ['S29Swap', 'S29Partial', 'S29Full', 'S29FullSwap', 'S29Weed', 'S29TraderA', 'S29TraderB', 'S29Ice', 'S29Victim', 'S29Mage', 'S29Mod'];
    for (const n of names) { const c = await register(n); clients.push(c); c.close(); }
    await stopServer();
    const G = (qty) => ({ item: 'gold', qty });
    const fullPack = (swordQty) => [G(100), { item: 'bronze_sword', qty: swordQty }, { item: 'iron_sword', qty: 1 }, { item: 'steel_sword', qty: 1 }, { item: 'mithril_sword', qty: 1 },
      { item: 'bronze_helm', qty: 1 }, { item: 'bronze_platebody', qty: 1 }, { item: 'bronze_platelegs', qty: 1 }, { item: 'bronze_shield', qty: 1 },
      { item: 'steel_helm', qty: 1 }, { item: 'steel_platebody', qty: 1 }, { item: 'steel_platelegs', qty: 1 }, { item: 'steel_shield', qty: 1 },
      { item: 'dragon_helm', qty: 1 }, { item: 'dragon_platebody', qty: 1 }, { item: 'dragon_platelegs', qty: 1 }, { item: 'dragon_shield', qty: 1 },
      { item: 'bronze_partyhat', qty: 1 }, { item: 'logs', qty: 1 }, { item: 'oak_logs', qty: 1 }, { item: 'copper_ore', qty: 1 }, { item: 'tin_ore', qty: 1 },
      { item: 'iron_ore', qty: 1 }, { item: 'coal', qty: 1 }, { item: 'uncut_gem', qty: 1 }, { item: 'raw_shrimps', qty: 1 }, { item: 'raw_trout', qty: 1 }, { item: 'bones', qty: 1 }];
    seedDb((data) => {
      const set = (name, mut) => { const u = data.users[name.toLowerCase()]; if (!u) throw new Error('seed: no user ' + name); mut(u.profile); };
      set('S29Swap', (p) => { p.backpack = [G(100), { item: 'bronze_sword', qty: 1 }, { item: 'steel_sword', qty: 1 }, { item: 'logs', qty: 5 }]; p.worn.weapon = 'mithril_sword'; });
      set('S29Partial', (p) => { p.backpack = [G(100), { item: 'bronze_sword', qty: 3 }]; p.worn.weapon = 'iron_sword'; });
      set('S29Full', (p) => { p.backpack = fullPack(1); p.worn.weapon = 'dragon_sword'; });
      set('S29FullSwap', (p) => { p.backpack = fullPack(2); p.worn.weapon = 'dragon_sword'; });
      set('S29TraderA', (p) => { p.backpack = [G(100), { item: 'logs', qty: 5 }]; });
      set('S29TraderB', (p) => { p.backpack = [G(100), { item: 'ration', qty: 2 }]; });
      set('S29Ice', (p) => { p.xp.magic = 13034431; p.xp.hitpoints = 13034431; p.worn.weapon = 'bronze_sword'; p.backpack = [G(100), { item: 'water_rune', qty: 90 }]; });
      set('S29Victim', (p) => { p.worn.weapon = 'bronze_sword'; });
      set('S29Mage', (p) => { p.xp.magic = 13034431; p.xp.hitpoints = 13034431; p.worn.weapon = 'bronze_sword'; p.backpack = [G(100), { item: 'water_rune', qty: 60 }]; });
      set('S29Mod', (p) => { p.xp.magic = 13034431; p.xp.hitpoints = 13034431; p.worn.weapon = 'bronze_sword'; p.backpack = [G(500), { item: 'water_rune', qty: 90 }]; });
    });
    await startServer();

    // ---------- (2) exact-spot swaps + unequip ----------
    const Swap = await loginClient('S29Swap'); clients.push(Swap);
    Swap.send({ type: 'equip', item: 'steel_sword', slot: 2 });
    await Swap.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'steel_sword', 10000, 'swap 1 profile');
    let sp = await prof('S29Swap');
    assert(sp.worn.weapon === 'steel_sword', '(2) steel sword worn after equipping from slot 2');
    assert(sp.backpack.length === 4 && sp.backpack[2].item === 'mithril_sword' && sp.backpack[2].qty === 1, `(2) the replaced mithril sword landed in slot 2 EXACTLY (pack: ${JSON.stringify(sp.backpack.map((s) => s.item))})`);
    assert(sp.backpack[1].item === 'bronze_sword' && sp.backpack[3].item === 'logs', '(2) the other slots are untouched');
    Swap.send({ type: 'equip', item: 'bronze_sword', slot: 1 });
    await Swap.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'bronze_sword', 10000, 'swap 2 profile');
    sp = await prof('S29Swap');
    assert(sp.backpack[1].item === 'steel_sword' && sp.backpack[1].qty === 1, '(2) the second swap also lands exactly (steel sword in slot 1)');
    Swap.send({ type: 'unequip', slot: 'weapon' });
    await Swap.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === null, 10000, 'unequip profile');
    sp = await prof('S29Swap');
    assert(sp.worn.weapon === null && stackQty(sp, 'bronze_sword') === 1, '(2) tap-unequip: the sword is back in the backpack, slot empty');

    const Partial = await loginClient('S29Partial'); clients.push(Partial);
    Partial.send({ type: 'equip', item: 'bronze_sword', slot: 1 });
    await Partial.waitFor((e) => e.type === 'profile' && e.profile.worn.weapon === 'bronze_sword', 10000, 'partial swap profile');
    const pp = await prof('S29Partial');
    assert(pp.backpack.length === 3 && pp.backpack[1].item === 'bronze_sword' && pp.backpack[1].qty === 2, '(2) a partial stack keeps its slot (3 -> 2 bronze swords stay in slot 1)');
    assert(pp.backpack[2].item === 'iron_sword' && pp.backpack[2].qty === 1, '(2) the replaced iron sword takes a free slot when its own stack is absent');

    const Full = await loginClient('S29Full'); clients.push(Full);
    const errFull = await expectError(Full, { type: 'unequip', slot: 'weapon' }, 'unequip full pack (2)');
    assert(/Backpack full/.test(errFull.message), `(2) unequip into a full pack is refused ("${errFull.message}")`);
    const fp = await prof('S29Full');
    assert(fp.worn.weapon === 'dragon_sword' && fp.backpack.length === 28, '(2) the refused unequip changed nothing');

    const FullSwap = await loginClient('S29FullSwap'); clients.push(FullSwap);
    const errSwap = await expectError(FullSwap, { type: 'equip', item: 'bronze_sword', slot: 1 }, 'swap full pack (2)');
    assert(/Backpack full/.test(errSwap.message), `(2) a swap that cannot fit is refused up front ("${errSwap.message}")`);
    const fsp = await prof('S29FullSwap');
    assert(fsp.worn.weapon === 'dragon_sword' && fsp.backpack[1].item === 'bronze_sword' && fsp.backpack[1].qty === 2, '(2) the refused swap changed nothing');
    console.log('PASS (2) exact-spot swaps, partial-stack swap, tap-unequip + full-pack refusals');

    // ---------- (5) seaweed ----------
    const Weed = await loginClient('S29Weed'); clients.push(Weed);
    Weed.send({ type: 'travel', to: 'cove' });
    const weedMsg = await Weed.waitFor((e) => e.type === 'seaweed' && e.area === 'cove', 10000, 'seaweed state (5)');
    assert(Array.isArray(weedMsg.patches) && weedMsg.patches.length === 7 && weedMsg.patches.every((p) => p.present), `(5) the cove starts with 7 seaweed clumps, all present (got ${weedMsg.patches && weedMsg.patches.length})`);
    const w1 = weedMsg.patches.find((p) => p.id === 'weed1');
    const errFar = await expectError(Weed, { type: 'seaweed_pickup', id: 'weed2' }, 'pickup too far (5)');
    assert(/Too far away/.test(errFar.message), `(5) picking up from across the cove is refused ("${errFar.message}")`);
    Weed.send({ type: 'move', x: w1.x, y: w1.y });
    await sleep(400);
    Weed.send({ type: 'seaweed_pickup', id: 'weed1' });
    await Weed.waitFor((e) => e.type === 'profile' && stacksOf(e.profile, 'seaweed').length === 1, 10000, 'first seaweed profile (5)');
    let wp = await prof('S29Weed');
    assert(stacksOf(wp, 'seaweed').length === 1 && stacksOf(wp, 'seaweed')[0].qty === 1, '(5) one pickup = one qty-1 seaweed stack');
    const weedAfter = [...Weed.events].reverse().find((e) => e.type === 'seaweed');
    assert(weedAfter && weedAfter.patches.find((p) => p.id === 'weed1').present === false, '(5) the picked clump is gone from the shore state');
    const errGone = await expectError(Weed, { type: 'seaweed_pickup', id: 'weed1' }, 'pickup gone clump (5)');
    assert(/gone/.test(errGone.message), `(5) re-picking a picked clump is refused ("${errGone.message}")`);
    const w2 = weedMsg.patches.find((p) => p.id === 'weed2');
    Weed.send({ type: 'move', x: w2.x, y: w2.y });
    await sleep(400);
    Weed.send({ type: 'seaweed_pickup', id: 'weed2' });
    await Weed.waitFor((e) => e.type === 'profile' && stacksOf(e.profile, 'seaweed').length === 2, 10000, 'second seaweed profile (5)');
    wp = await prof('S29Weed');
    assert(stacksOf(wp, 'seaweed').length === 2 && stacksOf(wp, 'seaweed').every((s) => s.qty === 1), '(5) two pieces = TWO separate qty-1 stacks — seaweed never stacks');
    // Bank round-trip keeps them separate.
    Weed.send({ type: 'travel', to: 'plaza' });
    await sleep(300);
    Weed.send({ type: 'bank_deposit', item: 'seaweed', qty: 2 });
    await Weed.waitFor((e) => e.type === 'profile' && stacksOf(e.profile, 'seaweed').length === 0, 10000, 'seaweed deposited (5)');
    wp = await prof('S29Weed');
    assert(bankStacksOf(wp, 'seaweed').length === 2 && bankStacksOf(wp, 'seaweed').every((s) => s.qty === 1), '(5) the bank holds the two pieces as two separate stacks');
    Weed.send({ type: 'bank_withdraw', item: 'seaweed', qty: 2 });
    await Weed.waitFor((e) => e.type === 'profile' && stacksOf(e.profile, 'seaweed').length === 2, 10000, 'seaweed withdrawn (5)');
    wp = await prof('S29Weed');
    assert(stacksOf(wp, 'seaweed').length === 2 && stacksOf(wp, 'seaweed').every((s) => s.qty === 1), '(5) the withdraw round-trip keeps them separate');
    // Drop / pickup keeps them separate.
    Weed.send({ type: 'drop', item: 'seaweed', qty: 1 });
    const pileEv = await Weed.waitFor((e) => e.type === 'piles' && (e.piles || []).some((p) => p.item === 'seaweed'), 10000, 'seaweed pile (5)');
    const pile = pileEv.piles.find((p) => p.item === 'seaweed');
    wp = await prof('S29Weed');
    assert(stacksOf(wp, 'seaweed').length === 1, '(5) dropping one piece leaves the other in its own stack');
    Weed.send({ type: 'pickup', pileId: pile.id });
    await Weed.waitFor((e) => e.type === 'profile' && stacksOf(e.profile, 'seaweed').length === 2, 10000, 'seaweed re-picked (5)');
    // Shop sell pays the fixed 2g and takes a whole piece.
    const goldBefore = (await prof('S29Weed')).gold;
    Weed.send({ type: 'shop_sell', item: 'seaweed', qty: 1 });
    await Weed.waitFor((e) => e.type === 'profile' && stacksOf(e.profile, 'seaweed').length === 1, 10000, 'seaweed sold (5)');
    wp = await prof('S29Weed');
    assert(wp.gold === goldBefore + 2, `(5) selling one seaweed pays exactly 2g (${goldBefore} -> ${wp.gold})`);
    console.log('PASS (5) seaweed: shore clumps, no-stack through pickup / bank / drop / sell');

    // ---------- (3) trade protocol (the ops the tap-to-move UI sends) ----------
    const A = await loginClient('S29TraderA'); clients.push(A);
    const B = await loginClient('S29TraderB'); clients.push(B);
    const mB = B.mark();
    A.send({ type: 'trade_request', target: 'S29TraderB' });
    const inc = (await B.waitSince(mB, (e) => e.type === 'trade_incoming', 10000, 'trade incoming (3)')).e;
    B.send({ type: 'trade_response', tradeId: inc.tradeId, accept: true });
    const openA = await A.waitFor((e) => e.type === 'trade_open', 10000, 'trade open A (3)');
    const tid = openA.tradeId;
    // Offer, then take back (the tap-to-move round trip).
    A.send({ type: 'trade_offer', tradeId: tid, gold: 0, items: [{ item: 'logs', qty: 2 }] });
    let upd = await B.waitFor((e) => e.type === 'trade_update' && e.tradeId === tid, 10000, 'offer seen by B (3)');
    assert(upd.them.items.length === 1 && upd.them.items[0].item === 'logs' && upd.them.items[0].qty === 2, '(3) the offer reaches the other side live');
    A.send({ type: 'trade_offer', tradeId: tid, gold: 0, items: [] });
    upd = await B.waitFor((e) => e.type === 'trade_update' && e.tradeId === tid && (e.them.items || []).length === 0, 10000, 'un-offer seen by B (3)');
    assert(upd.them.gold === 0 && upd.them.items.length === 0, '(3) tapping the item back empties the offer');
    // Real offers + both-confirm execute.
    A.send({ type: 'trade_offer', tradeId: tid, gold: 10, items: [{ item: 'logs', qty: 2 }] });
    B.send({ type: 'trade_offer', tradeId: tid, gold: 0, items: [{ item: 'ration', qty: 1 }] });
    await sleep(300);
    A.send({ type: 'trade_confirm', tradeId: tid });
    B.send({ type: 'trade_confirm', tradeId: tid });
    const doneA = await A.waitFor((e) => e.type === 'trade_done' && e.tradeId === tid, 10000, 'trade done A (3)');
    assert(doneA.ok === true, '(3) the both-confirmed trade executes');
    const pa = await prof('S29TraderA'); const pb = await prof('S29TraderB');
    assert(stackQty(pa, 'logs') === 3 && stackQty(pa, 'ration') === 1 && pa.gold === 90, `(3) A gave 2 logs + 10g, got 1 ration (logs ${stackQty(pa, 'logs')}, gold ${pa.gold})`);
    assert(stackQty(pb, 'ration') === 1 && stackQty(pb, 'logs') === 2 && pb.gold === 110, `(3) B gave 1 ration, got 2 logs + 10g (ration ${stackQty(pb, 'ration')}, gold ${pb.gold})`);
    console.log('PASS (3) trade protocol round-trip: offer, un-offer, both-confirm execute');

    // ---------- (6a) frozen duel opponent: weapon attacks land ----------
    const Ice = await loginClient('S29Ice'); clients.push(Ice);
    const Victim = await loginClient('S29Victim'); clients.push(Victim);
    await startDuelViaChallenge(Ice, Victim, {}, '(6a)');
    const mIce0 = Ice.mark();
    await Ice.waitSince(mIce0, (e) => e.type === 'duel_tick' && e.countdownLeft === 0, 15000, 'countdown over (6a)');
    const fz = await freezeUntil(Ice, 'duel', 'S29Victim', 10, '(6a)');
    assert(fz.res, `(6a) Freeze connected on the duel opponent (${fz.attempts} attempts)`);
    const frozenUntil = fz.res.frozenUntil;
    // (6d) regression: the FROZEN player's own weapon swings work.
    const mVic = Victim.mark();
    Victim.send({ type: 'duel_attack' });
    const vicSwing = (await Victim.waitSince(mVic, (e) => e.type === 'duel_tick' && typeof e.youHit === 'number', 8000, 'frozen victim swing (6d)')).e;
    assert(Date.now() < frozenUntil, '(6d) the frozen player swung their weapon while still frozen');
    assert(typeof vicSwing.youHit === 'number', '(6d) frozen players can still attack — only movement is rooted');
    // (6a) the attacker taps the frozen opponent: weapon engages.
    const mIce = Ice.mark();
    Ice.send({ type: 'duel_attack' });
    const iceSwing = (await Ice.waitSince(mIce, (e) => e.type === 'duel_tick' && typeof e.youHit === 'number', 8000, 'attacker swing at frozen opponent (6a)')).e;
    assert(iceSwing, '(6a) tapping the frozen opponent engaged weapon attacks');
    assert(Date.now() < frozenUntil, '(6a) the weapon swing landed while the opponent was still frozen');
    // …and the damage actually arrives over the next seconds.
    let dmgSeen = (typeof iceSwing.youHit === 'number' && iceSwing.youHit > 0) || (typeof iceSwing.hpOpponent === 'number' && iceSwing.hpOpponent < 99);
    const dmgDeadline = Date.now() + 10000;
    let scanFrom = mIce;
    while (!dmgSeen && Date.now() < dmgDeadline) {
      const r = await Ice.waitSince(scanFrom, (e) => e.type === 'duel_tick', 3000, 'duel tick scan (6a)').catch(() => null);
      if (!r) break;
      scanFrom = r.idx + 1;
      const t = r.e;
      if ((typeof t.youHit === 'number' && t.youHit > 0) || (typeof t.youBonus === 'number' && t.youBonus > 0) || (typeof t.hpOpponent === 'number' && t.hpOpponent < 99)) dmgSeen = true;
    }
    assert(dmgSeen, '(6a) weapon damage lands on the frozen opponent');
    const vPos = latestPos(Ice, 'S29Victim');
    assert(vPos && vPos.x === 820 && vPos.y === 450, `(6a) the frozen opponent never moved (at ${vPos && vPos.x},${vPos && vPos.y})`);
    const mVf = Victim.mark();
    Ice.close();
    await Victim.waitSince(mVf, (e) => e.type === 'duel_end', 20000, 'duel_end after Ice left (6a)');
    console.log('PASS (6a/6d) frozen duel: attacker\'s weapon lands, frozen player can still swing');

    // ---------- (6b) frozen monster: weapon fight lands ----------
    const Mage = await loginClient('S29Mage'); clients.push(Mage);
    Mage.send({ type: 'travel', to: 'goblins' });
    await Mage.waitFor((e) => e.type === 'npc_state' && e.area === 'goblins', 10000, 'mage npc_state (6b)');
    let fAttempts = 0; let frozeRes = null;
    while (fAttempts < 6 && !frozeRes) {
      fAttempts++;
      const gp = latestNpcPos(Mage, 'goblins', 'goblin2') || { x: 640, y: 320 };
      const py = gp.y + 150 <= 900 ? gp.y + 150 : gp.y - 150;
      Mage.send({ type: 'move', x: gp.x, y: py });
      await sleep(250);
      const res = await castOnce(Mage, 'freeze', 'npc', 'goblin2', `(6b) freeze attempt ${fAttempts}`);
      if (res.froze) frozeRes = res;
      else await sleep(2900);
    }
    assert(frozeRes, `(6b) Freeze connected on the goblin (${fAttempts} attempts)`);
    const gPos = latestNpcPos(Mage, 'goblins', 'goblin2');
    Mage.send({ type: 'move', x: gPos.x, y: gPos.y }); // walk onto the frozen goblin — the tap's walk-to
    const mMg = Mage.mark();
    const swingTick = (await Mage.waitSince(mMg, (e) => e.type === 'npc_fight' && e.phase === 'tick' && typeof e.youHit === 'number', 9000, 'weapon swing at frozen goblin (6b)')).e;
    assert(swingTick.npcFrozenUntil > Date.now(), '(6b) the weapon swing landed while the goblin was still frozen');
    const gPos2 = latestNpcPos(Mage, 'goblins', 'goblin2');
    assert(gPos2 && gPos2.x === gPos.x && gPos2.y === gPos.y, '(6b) the frozen goblin held its spot while being attacked');
    const mMg2 = Mage.mark();
    Mage.send({ type: 'flee' });
    await Mage.waitSince(mMg2, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'mage flee (6b)');
    console.log('PASS (6b) frozen monster: walking in and swinging lands during the root');

    // ---------- (6c) frozen mod opponent: weapon attacks land ----------
    const Mod = await loginClient('S29Mod'); clients.push(Mod);
    Mod.send({ type: 'move', x: 780, y: 300 }); // 100 from Mod Ash (680,300) — inside cast range, outside his melee reach
    await sleep(400);
    Mod.send({ type: 'mod_duel_start', id: 'mod1' });
    const mMod0 = Mod.mark();
    await Mod.waitSince(mMod0, (e) => e.type === 'mod_duel' && e.phase === 'tick' && e.countdownLeft === 0, 15000, 'mod countdown over (6c)');
    const mfz = await freezeUntil(Mod, 'duel', 'mod1', 10, '(6c)');
    assert(mfz.res && mfz.res.context === 'modduel', `(6c) Freeze connected on the mod (${mfz.attempts} attempts)`);
    Mod.send({ type: 'move', x: 680, y: 300 });
    await sleep(300);
    const mMod = Mod.mark();
    Mod.send({ type: 'mod_duel_attack' });
    const modSwing = (await Mod.waitSince(mMod, (e) => e.type === 'mod_duel' && e.phase === 'tick' && typeof e.youHit === 'number', 8000, 'weapon swing at frozen mod (6c)')).e;
    assert(modSwing.npcFrozenUntil > Date.now(), '(6c) the weapon swing landed while the mod was still frozen');
    console.log('PASS (6c) frozen mod opponent: tap-to-engage weapon swings land');

    console.log('ALL STAGE 29 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.stack || e.message); process.exit(1); });
