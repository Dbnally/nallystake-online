// Database-mode proof — the Render-free scenario:
// a real Postgres (Neon free in production; any Postgres works for the test)
// stays up while the game server is killed and restarted, exactly like
// Render free sleeping or redeploying. Accounts and gold must survive,
// because they live in the database, not on the game server's disk.
//
// Run with:  DATABASE_URL_TEST=postgres://user:pass@host:port/db npm run test:db
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const DATABASE_URL = process.env.DATABASE_URL_TEST;
if (!DATABASE_URL) { console.error('Set DATABASE_URL_TEST to a throwaway Postgres database first.'); process.exit(1); }
const PORT = 18081;
const BASE = `http://127.0.0.1:${PORT}`;
const stamp = Date.now().toString(36);
const NAME_A = 'DbA' + stamp, NAME_B = 'DbB' + stamp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startGameServer() {
  const p = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, DATABASE_URL },
    stdio: 'pipe',
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('game server did not start')), 20000);
    p.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(p); } });
    p.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
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
    const client = { ws, events: [], waiters: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      client.events.push(m);
      client.waiters = client.waiters.filter((w) => !w(m));
    });
    client.waitFor = (type, timeout = 90000) => new Promise((res, rej) => {
      const found = client.events.find((e) => e.type === type);
      if (found) return res(found);
      const w = (m) => { if (m.type === type) { clearTimeout(t); res(m); return true; } return false; };
      const t = setTimeout(() => rej(new Error('timeout waiting ' + type)), timeout);
      client.waiters.push(w);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

(async () => {
  let server;
  try {
    server = await startGameServer();
    console.log('game server up in database mode');
    const a = await api('/api/register', { username: NAME_A, password: 'secret1' });
    const b = await api('/api/register', { username: NAME_B, password: 'secret2' });
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    await ca.waitFor('welcome'); await cb.waitFor('welcome');
    const incomingP = cb.waitFor('challenge_incoming');
    ca.ws.send(JSON.stringify({ type: 'challenge', target: NAME_B, stake: 25 }));
    const incoming = await incomingP;
    const endAP = ca.waitFor('duel_end');
    const endBP = cb.waitFor('duel_end');
    cb.ws.send(JSON.stringify({ type: 'challenge_response', challengeId: incoming.challengeId, accept: true }));
    const [endA, endB] = await Promise.all([endAP, endBP]);
    console.log('duel done. Winner:', endA.winner, '| A gold:', endA.profile.gold, '| B gold:', endB.profile.gold);
    const golds = [endA.profile.gold, endB.profile.gold].sort((x, y) => x - y);
    if (golds[0] !== 75 || golds[1] !== 125) throw new Error('settlement wrong: ' + golds);
    console.log('PASS escrow settlement in database mode: 75g / 125g');
    ca.ws.close(); cb.ws.close();
    await sleep(800); // let the final saves land in Postgres

    // Kill and restart ONLY the game server — the Render-free sleep/restart moment.
    server.kill(); await sleep(600);
    server = await startGameServer();
    console.log('game server restarted (database never stopped)');
    const a2 = await api('/api/login', { username: NAME_A, password: 'secret1' });
    const expected = endA.winner === NAME_A ? 125 : 75;
    if (a2.profile.gold !== expected || a2.profile.wins + a2.profile.losses !== 1) {
      throw new Error(`persistence wrong after restart: ${JSON.stringify(a2.profile)}`);
    }
    console.log(`PASS saving survived the restart: ${NAME_A} still has ${a2.profile.gold}g, record ${a2.profile.wins}W/${a2.profile.losses}L`);
    console.log('ALL DATABASE-MODE TESTS PASSED');
  } finally {
    if (server) server.kill();
  }
})().catch((e) => { console.error('DB TEST FAILED:', e.message); process.exit(1); });
