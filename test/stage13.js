// Stage 13 tests: the world doubled — every area is 1600x900 server
// units (was 800x450), every world position moved to its x2 spot,
// gameplay distances/sizes unchanged. Covers:
//  (a) spawns + travel land at the new-scale destinations
//      (plaza spawn (800,450); goblins spawn (200,450);
//      training spawn (800,720)).
//  (b) place_object clamps at 1600/900, not 800/450 — and a legit
//      new-scale spot beyond the old bounds is stored unclamped.
//  (c) the worldV migration: a seeded old-shape profile (no worldV)
//      with a placed object at (100,60) loads at (200,120) with
//      worldV 2 saved to disk, and a second boot does NOT scale it
//      again.
//  (d) a shop interaction works for a player standing at a new-scale
//      shop spot (Potion shop at (340,220)).
//
// Same harness style as test/stage7d.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., a fresh disposable DB file
// so the literal owner name 'nally' can register.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18097;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage13.json');
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
async function waitSnapshot(c, name, area, fromIdx = 0) {
  const st = (await c.waitSince(fromIdx, (e) => e.type === 'state' && e.players.some((p) => p.username === name && (!area || p.area === area)),
    10000, `state snapshot for ${name}`)).e;
  return st.players.find((p) => p.username === name);
}

async function main() {
  const clients = [];
  try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  try {
    // ---------- (c) seed an OLD-shape profile before the first boot ----------
    // No worldV field at all (the pre-Stage-13 shape), one placed
    // object at the old-scale spot (100, 60).
    const salt = 's13salt';
    const seedProfile = {
      username: 'S13Old', gold: 100, rating: 1000, wins: 0, losses: 0,
      style: 'accurate', createdAt: new Date().toISOString(),
      placedObjects: [{ id: 'obj_1', kind: 'tree', x: 100, y: 60, area: 'plaza', by: 'S13Old' }],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: { s13old: { salt, passHash: crypto.scryptSync('s13-old-pass', salt, 32).toString('hex'), profile: seedProfile } },
    }));

    await startServer();

    // ---------- (c) migration on first load ----------
    const old = await login('S13Old', 's13-old-pass');
    clients.push(old);
    const objLogin = await old.waitFor((e) => e.type === 'objects' && e.area === 'plaza', 10000, 'objects on login');
    const mig = objLogin.objects.find((o) => o.id === 'obj_1');
    assert(!!mig && mig.x === 200 && mig.y === 120,
      `migration: the seeded object at (100,60) is broadcast at (200,120) after load (got ${mig && mig.x},${mig && mig.y})`);
    old.close();
    await stopServer();
    const disk1 = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const rec1 = disk1.users.s13old.profile;
    assert(rec1.worldV === 2, `migration: worldV 2 was saved to disk (got ${rec1.worldV})`);
    assert(rec1.placedObjects[0].x === 200 && rec1.placedObjects[0].y === 120,
      `migration: the saved object sits at (200,120) (got ${rec1.placedObjects[0].x},${rec1.placedObjects[0].y})`);

    // ---------- (c) second boot: no double scaling ----------
    await startServer();
    const old2 = await login('S13Old', 's13-old-pass');
    clients.push(old2);
    const objLogin2 = await old2.waitFor((e) => e.type === 'objects' && e.area === 'plaza', 10000, 'objects on login (2nd boot)');
    const mig2 = objLogin2.objects.find((o) => o.id === 'obj_1');
    assert(!!mig2 && mig2.x === 200 && mig2.y === 120,
      `migration: second boot did NOT scale again — still (200,120) (got ${mig2 && mig2.x},${mig2 && mig2.y})`);

    // ---------- (a) travel landings at the new scale ----------
    // (Login itself scatters randomly across the plaza by design, so
    // the spawn points are proven through travel landings instead.)
    const walker = await register('S13Walker', 's13-walk-pass');
    clients.push(walker);
    let mW = walker.mark();
    walker.send({ type: 'travel', to: 'goblins' });
    const gobSnap = await waitSnapshot(walker, 'S13Walker', 'goblins', mW);
    assert(gobSnap.x === 200 && gobSnap.y === 450,
      `travel: plaza -> goblins lands at the new-scale spawn (200,450) (got ${gobSnap.x},${gobSnap.y})`);
    mW = walker.mark();
    walker.send({ type: 'travel', to: 'plaza' });
    const plazaSnap = await waitSnapshot(walker, 'S13Walker', 'plaza', mW);
    assert(plazaSnap.x === 800 && plazaSnap.y === 450,
      `travel: goblins -> plaza lands at the doubled plaza spawn (800,450) (got ${plazaSnap.x},${plazaSnap.y})`);
    mW = walker.mark();
    walker.send({ type: 'travel', to: 'training' });
    const trSnap = await waitSnapshot(walker, 'S13Walker', 'training', mW);
    assert(trSnap.x === 800 && trSnap.y === 720,
      `travel: plaza -> training lands at the new-scale spawn (800,720) (got ${trSnap.x},${trSnap.y})`);

    // ---------- (b) place_object clamps at 1600/900 ----------
    const nally = await register('nally', 's13-owner-pass');
    clients.push(nally);
    const mN = nally.mark();
    nally.send({ type: 'place_object', kind: 'rock', x: 9999, y: 9999 });
    const clamped = (await nally.waitSince(mN, (e) => e.type === 'objects' && e.area === 'plaza'
      && e.objects.some((o) => o.kind === 'rock' && o.by === 'nally'), 10000, 'objects broadcast (clamped rock)')).e;
    const rockObj = clamped.objects.find((o) => o.kind === 'rock' && o.by === 'nally');
    assert(rockObj.x === 1600 && rockObj.y === 900,
      `place_object: (9999,9999) clamped to the new bounds (1600,900) (got ${rockObj.x},${rockObj.y})`);
    const mN2 = nally.mark();
    nally.send({ type: 'place_object', kind: 'flowers', x: 1200, y: 700 });
    const legit = (await nally.waitSince(mN2, (e) => e.type === 'objects' && e.area === 'plaza'
      && e.objects.some((o) => o.kind === 'flowers'), 10000, 'objects broadcast (flowers)')).e;
    const flowerObj = legit.objects.find((o) => o.kind === 'flowers');
    assert(flowerObj.x === 1200 && flowerObj.y === 700,
      `place_object: a legit new-scale spot (1200,700) — beyond the OLD 800x450 bounds — is stored unclamped (got ${flowerObj.x},${flowerObj.y})`);

    // ---------- (d) shop interaction at a new-scale shop spot ----------
    const shopper = await register('S13Shopper', 's13-shop-pass');
    clients.push(shopper);
    const mShop = shopper.mark();
    shopper.send({ type: 'move', x: 340, y: 220 }); // Potion shop spot (server + client SHOP_SPOTS)
    const shopSnap = await waitSnapshot(shopper, 'S13Shopper', 'plaza', mShop);
    assert(shopSnap.x === 340 && shopSnap.y === 220,
      `shop: the shopper is standing at the new-scale Potion shop spot (340,220) (got ${shopSnap.x},${shopSnap.y})`);
    const goldBefore = shopper.profile().gold;
    const mS = shopper.mark();
    shopper.send({ type: 'shop_buy', item: 'prayer_potion', qty: 1 });
    const bought = (await shopper.waitSince(mS, (e) => e.type === 'shop' && e.action === 'buy' && e.item === 'prayer_potion', 10000, 'shop buy reply')).e;
    assert(bought.total === 15, `shop: bought a Prayer potion for 15g at the new-scale spot (total ${bought.total})`);
    const profAfter = await shopper.waitSince(mS, (e) => e.profile && qty(e.profile, 'prayer_potion') === 1, 10000, 'profile after buy').then((r) => r.e.profile);
    assert(profAfter.gold === goldBefore - 15, `shop: gold went ${goldBefore} -> ${profAfter.gold} and the potion is in the backpack`);

    for (const c of clients) c.close();
    console.log('ALL STAGE 13 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
