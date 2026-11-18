// Takeover + heartbeat test:
// 1) A second connection with the SAME token replaces the first
//    (welcome, not "Already signed in"), the old socket is closed
//    by the server, and the replacement can chat.
// 2) A raw socket that completes the WS handshake but never pongs
//    is reaped by the heartbeat (HEARTBEAT_MS=400) and the account
//    can immediately sign in again.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = 18098;
const DB = path.join(os.tmpdir(), `nallystake-take-${Date.now()}.json`);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DB_PATH: DB, HEARTBEAT_MS: '400' }, stdio: 'pipe' });
  p.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  return new Promise((resolve) => {
    p.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(p); });
    setTimeout(() => resolve(p), 3000);
  });
}
async function api(pathName, body) {
  const r = await fetch(BASE + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(pathName + ': ' + d.error);
  return d;
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    const client = { ws, events: [], waiters: [], closed: false };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      client.events.push(m);
      client.waiters = client.waiters.filter((w) => !w(m));
    });
    ws.on('close', () => { client.closed = true; });
    client.waitFor = (pred, label, timeout = 8000) => new Promise((res, rej) => {
      const found = client.events.find(pred);
      if (found) return res(found);
      const w = (m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; };
      const t = setTimeout(() => rej(new Error('timeout waiting ' + label)), timeout);
      client.waiters.push(w);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

(async () => {
  const server = await startServer();
  try {
    const a = await api('/api/register', { username: 'TakeA', password: 'secret1' });
    const b = await api('/api/register', { username: 'TakeB', password: 'secret2' });
    const cb = await connect(b.token);
    await cb.waitFor((m) => m.type === 'welcome', 'welcome B');

    // --- Takeover ---
    const a1 = await connect(a.token);
    await a1.waitFor((m) => m.type === 'welcome', 'welcome A1');
    const a2 = await connect(a.token); // same token: "phone came back"
    const w2 = await a2.waitFor((m) => m.type === 'welcome', 'welcome A2 (takeover)', 8000);
    if (!w2) throw new Error('no welcome on takeover');
    if (a2.events.some((e) => e.type === 'error' && /Already signed in/.test(e.message || ''))) throw new Error('takeover still rejected');
    await sleep(600);
    if (!a1.closed) throw new Error('old socket was not closed by the server on takeover');
    console.log('PASS takeover: second sign-in welcomed, old socket closed, no rejection');
    // A2 fully works: chat reaches B, and B sees exactly one TakeA
    a2.ws.send(JSON.stringify({ type: 'chat', text: 'back again' }));
    await cb.waitFor((m) => m.type === 'chat' && m.from === 'TakeA' && m.text === 'back again', 'B hears A2');
    await sleep(300);
    const st = cb.events.filter((e) => e.type === 'state').pop();
    const count = (st ? st.players : []).filter((p) => p.username === 'TakeA').length;
    if (count !== 1) throw new Error('TakeA appears ' + count + ' times in state');
    console.log('PASS takeover session is live and unique in state');

    // --- Zombie reaping: raw socket, handshake, never pong ---
    const z = await api('/api/register', { username: 'ZombZ', password: 'secret3' });
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1');
    await new Promise((res) => sock.on('connect', res));
    sock.write(
      `GET /ws?token=${z.token} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
    let got101 = false;
    const closedP = new Promise((res) => sock.on('close', () => res(true)));
    sock.on('data', (d) => { if (String(d).includes('101')) got101 = true; /* never pong: swallow pings */ });
    await sleep(700);
    if (!got101) throw new Error('raw handshake failed');
    // B should have seen ZombZ in some state snapshot while it lived...
    await sleep(300);
    const sawZ = cb.events.some((e) => e.type === 'state' && e.players.some((p) => p.username === 'ZombZ'));
    if (!sawZ) throw new Error('zombie never appeared in state');
    // ...and gone within a few heartbeat cycles (400ms interval, 2 misses)
    const reaped = await Promise.race([closedP, sleep(6000).then(() => false)]);
    if (!reaped) throw new Error('zombie socket was not terminated by heartbeat');
    console.log('PASS heartbeat reaped the silent zombie socket');
    await sleep(400);
    const stZ2 = cb.events.filter((e) => e.type === 'state').pop();
    if (stZ2 && stZ2.players.some((p) => p.username === 'ZombZ')) throw new Error('zombie still in state after reap');
    // And the account can sign straight back in
    const z2 = await connect(z.token);
    await z2.waitFor((m) => m.type === 'welcome', 'zombie account re-login');
    console.log('PASS zombie account could sign straight back in');
    console.log('ALL TAKEOVER TESTS PASSED');
    a2.ws.close(); cb.ws.close(); z2.ws.close();
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
