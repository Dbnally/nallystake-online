// Stage 11 tests: character appearance (the Stage 10 server pass,
// split into its own fast suite so it doesn't need the duel
// simulation's runtime). Appearance is saved on the profile:
//   - POST /api/register accepts an optional appearance object,
//     stored sanitised with chosen=true.
//   - Garbage values are clamped / defaulted field by field — never
//     a crash, never stored raw.
//   - {type:'set_appearance'} merges a partial update over the
//     current look, persists, replies with a fresh profile, and the
//     new look reaches other players via the state snapshot.
//   - ensureV2 backfills the default on old-shaped profiles and
//     merges a partial stored appearance over the defaults.
//
// Same harness style as test/stage8.js: HTTP /api/register +
// /api/login, WebSocket at /ws?token=..., old shapes seeded by
// editing the test DB file while the server is stopped.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18095;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage11.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

const DEFAULT_APPEARANCE = { gender: 'male', hair: 1, beard: 0, skin: 1, torso: 0, arms: 0, legs: 0, feet: 0, chosen: false };

function assert(cond, label) {
  if (!cond) throw new Error('ASSERT FAILED: ' + label);
  console.log('PASS ' + label);
}
function assertAppearance(actual, expected, label) {
  const a = actual || {};
  const bad = Object.keys(expected).filter((k) => a[k] !== expected[k]);
  assert(bad.length === 0, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
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
async function login(name, password) {
  const d = await api('/api/login', { username: name, password });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome (login)');
  return c;
}

async function main() {
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    // ---------- 1) Register WITH an appearance --------------------
    const look = { gender: 'female', hair: 2, beard: 1, skin: 0, torso: 5, arms: 3, legs: 2, feet: 4 };
    const reg = await api('/api/register', { username: 'S11Look', password: 's11-look-pass', appearance: look });
    assertAppearance(reg.profile.appearance, { ...look, chosen: true },
      'register: a supplied appearance is stored sanitised with chosen=true');

    // ---------- 2) Register with garbage → clamped/defaulted ------
    const garb = await api('/api/register', {
      username: 'S11Garbage', password: 's11-garb-pass',
      appearance: { gender: 'alien', hair: 99, beard: -3, skin: 'blue', torso: 2.6, arms: null, legs: 7, feet: 0, chosen: 'yes', evil: 'key' },
    });
    assertAppearance(garb.profile.appearance,
      { gender: 'male', hair: 2, beard: 0, skin: 1, torso: 3, arms: 0, legs: 5, feet: 0, chosen: true },
      'register garbage: gender/skin fell back, hair/beard/legs clamped, torso rounded, null defaulted, stray key dropped — no crash');

    // ---------- 3) Register WITHOUT an appearance -----------------
    const plain = await api('/api/register', { username: 'S11Plain', password: 's11-plain-pass' });
    assertAppearance(plain.profile.appearance, DEFAULT_APPEARANCE,
      'register plain: the default look, chosen=false');

    // ---------- 4) set_appearance: partial merge + persistence ----
    const look1 = await login('S11Look', 's11-look-pass');
    clients.push(look1);
    const mSet = look1.mark();
    look1.send({ type: 'set_appearance', appearance: { hair: 0, torso: 2 } });
    const after = (await look1.waitSince(mSet, (e) => e.type === 'profile', 10000, 'profile after set_appearance')).e;
    assertAppearance(after.profile.appearance, { ...look, hair: 0, torso: 2, chosen: true },
      'set_appearance: partial update merged over the current look');
    const mJunk = look1.mark();
    look1.send({ type: 'set_appearance', appearance: 'junk' });
    const afterJunk = (await look1.waitSince(mJunk, (e) => e.type === 'profile', 10000, 'profile after junk set_appearance')).e;
    assertAppearance(afterJunk.profile.appearance, { ...look, hair: 0, torso: 2, chosen: true },
      'set_appearance junk: non-object appearance leaves the look unchanged, no crash');
    const relogin = await api('/api/login', { username: 'S11Look', password: 's11-look-pass' });
    assertAppearance(relogin.profile.appearance, { ...look, hair: 0, torso: 2, chosen: true },
      'set_appearance: the new look persists across re-login');

    // ---------- 5) Other players see the look in state snapshots --
    const watcher = await login('S11Plain', 's11-plain-pass');
    clients.push(watcher);
    const snap = await watcher.waitFor((e) => e.type === 'state' && (e.players || []).some((p) => p.username === 'S11Look'), 10000, 'state snapshot containing S11Look');
    const entry = snap.players.find((p) => p.username === 'S11Look');
    assertAppearance(entry.appearance, { ...look, hair: 0, torso: 2, chosen: true },
      'visibility: another client\'s state snapshot carries the player\'s appearance');

    // ---------- 6) ensureV2 backfill on old-shaped profiles -------
    await api('/api/register', { username: 'S11Old', password: 's11-old-pass' });
    await sleep(500);
    for (const c of clients) c.close();
    await stopServer();
    seedDb((data) => {
      delete data.users.s11old.profile.appearance; // pre-Stage-10 shape
      data.users.s11plain.profile.appearance = { hair: 2 }; // partial stored look
    });
    await startServer();
    const oldLogin = await api('/api/login', { username: 'S11Old', password: 's11-old-pass' });
    assertAppearance(oldLogin.profile.appearance, DEFAULT_APPEARANCE,
      'ensureV2: a profile with no appearance is backfilled with the default');
    const partialLogin = await api('/api/login', { username: 'S11Plain', password: 's11-plain-pass' });
    assertAppearance(partialLogin.profile.appearance, { ...DEFAULT_APPEARANCE, hair: 2 },
      'ensureV2: a partial stored appearance is merged over the defaults, not wiped');

    console.log('ALL STAGE 11 TESTS PASSED');
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
