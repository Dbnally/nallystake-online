// Stage 21 tests: PARTY HATS — Derek's design. One hat per metal
// tier, in the tier's colour, prices doubling from Bronze 500,000g
// to Dragon 32,000,000g. Pure flex: head-slot armour with no combat
// stats, sold at the Armour shop, standard 60% sell-back.
//   (a) catalog: all seven hats ride the catalog with the exact
//       prices, shop 'Armour', slot 'head', kind 'armour', the tier
//       colours, and sell = 60% of buy.
//   (b) a rich account buys the Bronze hat: the coin stack drops by
//       exactly 500,000 and the hat lands in the backpack. No
//       announcement fires for a Bronze hat.
//   (c) wearing it puts it in the head slot (backpack stack gone),
//       and the state snapshot carries wornHead so other clients can
//       put the hat on the knight's head.
//   (d) a poor account's buy is refused ('Not enough gold') with
//       gold and backpack untouched.
//   (e) buying the Dragon hat broadcasts the exact announcement
//       "🎉 <name> just bought a Dragon party hat!" to a second
//       online client; the Rune hat announces too.
//   (f) sell-back is the standard rate: the Dragon hat sells for
//       exactly 19,200,000 (60% of 32,000,000).
// Same harness style as test/stage16.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18121;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage21.json');
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
      const url = 'ws://127.0.0.1:' + PORT + '/ws?token=' + encodeURIComponent(token);
      this.ws = new WebSocket(url);
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
const PW = (n) => 's21-pass-' + n;
async function prof(name) { return (await api('/api/login', { username: name, password: PW(name) })).profile; }
const packGold = (p) => { const s = (p.backpack || []).find((x) => x.item === 'gold'); return s ? s.qty : 0; };
const bankGold = (p) => { const s = (p.bank || []).find((x) => x.item === 'gold'); return s ? s.qty : 0; };
const totalGold = (p) => packGold(p) + bankGold(p);
const packQty = (p, item) => { const s = (p.backpack || []).find((x) => x.item === item); return s ? s.qty : 0; };

const HATS = [
  ['bronze', 500000, '#8a5a2b'],
  ['iron', 1000000, '#7f7f7f'],
  ['steel', 2000000, '#b9bfc7'],
  ['mithril', 4000000, '#6a5fd8'],
  ['adamant', 8000000, '#3a9e4f'],
  ['rune', 16000000, '#4a90d9'],
  ['dragon', 32000000, '#c22f2f'],
];

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/_partyhat/.test(src) && /rune_partyhat/.test(src) && /dragon_partyhat/.test(src), 'source: party hat defs exist in server.js');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  // Stage 32: party hats wear as CROWNS now — the icon assertion moved
  // from 🥳 to 👑 with the look (ids, prices, stats unchanged).
  assert(/dragon_partyhat:'👑'/.test(clientSrc) && /function syncPartyHat/.test(clientSrc), 'source: client has the crown icons + the worn-crown renderer');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    for (const n of ['S21Rich', 'S21Poor', 'S21Watch']) {
      const c = await register(n, PW(n));
      clients.push(c); c.close();
    }
    await stopServer();
    clients.length = 0;
    // Stage 16 style seed: the rich account's money is a coin stack.
    seedDb((data) => {
      const p = data.users.s21rich.profile;
      p.backpack = [{ item: 'gold', qty: 50000000 }];
      p.gold = 50000000;
    });
    await startServer();

    const rich = await login('S21Rich', PW('S21Rich')); clients.push(rich);
    const poor = await login('S21Poor', PW('S21Poor')); clients.push(poor);
    const watch = await login('S21Watch', PW('S21Watch')); clients.push(watch);

    // ---------- (a) catalog ----------
    const cat = await rich.waitFor((e) => e.type === 'catalog', 10000, 'catalog');
    for (const [tier, price, color] of HATS) {
      const d = cat.items.find((i) => i.id === `${tier}_partyhat`);
      assert(!!d, `(a) ${tier}_partyhat is in the catalog`);
      assert(d.buy === price, `(a) ${tier} party hat costs exactly ${price}g (got ${d.buy})`);
      assert(d.shop === 'Armour' && d.slot === 'head' && d.kind === 'armour', `(a) ${tier} party hat: Armour shop, head slot, armour kind`);
      assert(d.color === color, `(a) ${tier} party hat carries its tier colour ${color} (got ${d.color})`);
      assert(d.sell === Math.floor(price * 0.6), `(a) ${tier} party hat sell-back is 60% (${d.sell})`);
      assert(!d.reduction && !d.accBonus && !d.maxBonus, `(a) ${tier} party hat has no combat stats`);
    }
    console.log('PASS (a) catalog: seven party hats, exact prices, colours, Armour shop');

    // ---------- (b) rich buys Bronze: exact stack drop, hat in pack, no announcement ----------
    {
      const m = rich.mark();
      rich.send({ type: 'shop_buy', item: 'bronze_partyhat', qty: 1 });
      const bought = (await rich.waitSince(m, (e) => e.type === 'shop' && e.action === 'buy', 10000, 'bronze hat buy')).e;
      assert(bought.item === 'bronze_partyhat' && bought.total === 500000, `(b) bronze hat bought for 500,000g (total ${bought.total})`);
      await sleep(300);
      const p = await prof('S21Rich');
      assert(totalGold(p) === 49500000, `(b) coin stacks dropped by exactly 500,000 to 49,500,000 (got ${totalGold(p)})`);
      assert(p.gold === 49500000, '(b) mirror profile.gold matches the stacks');
      assert(packQty(p, 'bronze_partyhat') === 1, '(b) the Bronze party hat is in the backpack');
      await sleep(700); // give any stray broadcast time to land
      assert(!watch.events.some((e) => e.type === 'announce'), '(b) no announcement fired for a Bronze hat');
    }
    console.log('PASS (b) bronze buy: -500,000 exactly, hat in backpack, silent');

    // ---------- (c) wear it: head slot + snapshot wornHead ----------
    {
      rich.send({ type: 'equip', item: 'bronze_partyhat' });
      await sleep(400);
      const p = await prof('S21Rich');
      assert(p.worn && p.worn.head === 'bronze_partyhat', `(c) worn head slot holds the bronze party hat (got ${p.worn && p.worn.head})`);
      assert(packQty(p, 'bronze_partyhat') === 0, '(c) the hat left the backpack when worn');
      rich.send({ type: 'move', x: 810, y: 460 }); // state broadcasts ride movement — nudge one out
      const st = await watch.waitFor((e) => e.type === 'state' && (e.players || []).some((pl) => pl.username === 'S21Rich' && pl.wornHead === 'bronze_partyhat'), 10000, 'state with wornHead');
      assert(!!st, '(c) state snapshot carries wornHead=bronze_partyhat for other clients');
    }
    console.log('PASS (c) equip: head slot + wornHead in the snapshot');

    // ---------- (d) poor buy refused, nothing changes ----------
    {
      const m = poor.mark();
      poor.send({ type: 'shop_buy', item: 'bronze_partyhat', qty: 1 });
      const err = (await poor.waitSince(m, (e) => e.type === 'error', 10000, 'poor buy refusal')).e;
      assert(/Not enough gold/.test(err.message), `(d) refusal names the reason (got: ${err.message})`);
      const p = await prof('S21Poor');
      assert(totalGold(p) === 100 && p.gold === 100, `(d) poor gold unchanged at 100 (got ${totalGold(p)})`);
      assert(packQty(p, 'bronze_partyhat') === 0, '(d) no hat appeared in the poor backpack');
    }
    console.log('PASS (d) poor buy refused, gold untouched');

    // ---------- (e) Dragon + Rune buys announce to the watcher ----------
    {
      const m = rich.mark();
      rich.send({ type: 'shop_buy', item: 'dragon_partyhat', qty: 1 });
      const bought = (await rich.waitSince(m, (e) => e.type === 'shop' && e.action === 'buy' && e.item === 'dragon_partyhat', 10000, 'dragon hat buy')).e;
      assert(bought.total === 32000000, `(e) dragon hat bought for 32,000,000g (total ${bought.total})`);
      const ann = (await watch.waitSince(0, (e) => e.type === 'announce' && /Dragon party hat/.test(e.text || ''), 10000, 'dragon announcement')).e;
      assert(ann.text === '🎉 S21Rich just bought a Dragon party hat!', `(e) exact announcement text (got: ${ann.text})`);
      await sleep(300);
      let p = await prof('S21Rich');
      assert(totalGold(p) === 17500000, `(e) stacks at 17,500,000 after the dragon hat (got ${totalGold(p)})`);
      assert(packQty(p, 'dragon_partyhat') === 1, '(e) the Dragon party hat is in the backpack');

      const wm = watch.mark();
      rich.send({ type: 'shop_buy', item: 'rune_partyhat', qty: 1 });
      const ann2 = (await watch.waitSince(wm, (e) => e.type === 'announce', 10000, 'rune announcement')).e;
      assert(ann2.text === '🎉 S21Rich just bought a Rune party hat!', `(e) rune announcement text (got: ${ann2.text})`);
      await sleep(300);
      p = await prof('S21Rich');
      assert(totalGold(p) === 1500000, `(e) stacks at 1,500,000 after the rune hat (got ${totalGold(p)})`);
    }
    console.log('PASS (e) dragon + rune announcements broadcast exactly');

    // ---------- (f) standard sell-back on the Dragon hat ----------
    {
      const m = rich.mark();
      rich.send({ type: 'shop_sell', item: 'dragon_partyhat', qty: 1 });
      const sold = (await rich.waitSince(m, (e) => e.type === 'shop' && e.action === 'sell', 10000, 'dragon hat sell')).e;
      assert(sold.total === 19200000, `(f) dragon hat sells back for exactly 19,200,000 (60%) (got ${sold.total})`);
      await sleep(300);
      const p = await prof('S21Rich');
      assert(totalGold(p) === 20700000, `(f) stacks at 20,700,000 after the sale (got ${totalGold(p)})`);
      assert(packQty(p, 'dragon_partyhat') === 0, '(f) the sold hat left the backpack');
    }
    console.log('PASS (f) sell-back: standard 60% rate applies to party hats');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
  }
  console.log('ALL STAGE 21 TESTS PASSED');
}

main().catch(async (e) => {
  console.error(e.message || e);
  await stopServer();
  process.exit(1);
});
