// Two-client proof: two REAL separate accounts connect at once,
// see each other, stake gold, the server runs the duel, escrow settles,
// and the result is still there after a server restart (saving works).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18080;
const DB = path.join(os.tmpdir(), `nallystake-test-${Date.now()}.json`);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const p = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DB_PATH: DB }, stdio: 'pipe' });
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
    const client = { ws, events: [], waiters: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      client.events.push(m);
      client.waiters = client.waiters.filter((w) => !w(m));
    });
    client.waitFor = (type, timeout = 60000) => new Promise((res, rej) => {
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let server = await startServer();
  try {
    const a = await api('/api/register', { username: 'TesterA', password: 'secret1' });
    const b = await api('/api/register', { username: 'TesterB', password: 'secret2' });
    console.log('registered:', a.profile, b.profile);
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    await ca.waitFor('welcome'); await cb.waitFor('welcome');
    await sleep(300);
    const state = ca.events.filter((e) => e.type === 'state').pop();
    const names = (state ? state.players : []).map((p) => p.username);
    if (!names.includes('TesterA') || !names.includes('TesterB')) throw new Error('players did not see each other: ' + names);
    console.log('PASS presence: both players online together ->', names.join(', '));

    const incomingP = cb.waitFor('challenge_incoming');
    ca.ws.send(JSON.stringify({ type: 'challenge', target: 'TesterB', stake: 10 }));
    const incoming = await incomingP;
    console.log('PASS challenge delivered:', incoming.from, 'for', incoming.stake + 'g');
    // Stage 12: the wait rises 90s -> 300s — OSRS swing timers land
    // one swing per fighter per 4 ticks, so a 99-HP duel between two
    // fresh unarmed fighters takes ~4x as many ticks to finish.
    const endAP = ca.waitFor('duel_end', 300000);
    const endBP = cb.waitFor('duel_end', 300000);
    cb.ws.send(JSON.stringify({ type: 'challenge_response', challengeId: incoming.challengeId, accept: true }));
    // Stage 14: acceptance joins the configuration — the duel starts
    // only when BOTH sides confirm the terms.
    ca.ws.send(JSON.stringify({ type: 'challenge_confirm', challengeId: incoming.challengeId }));
    cb.ws.send(JSON.stringify({ type: 'challenge_confirm', challengeId: incoming.challengeId }));
    await ca.waitFor('duel_start'); await cb.waitFor('duel_start');
    // Stage 12: duel fighters start un-engaged — both tap to attack
    // or nobody ever swings and the duel cannot end.
    ca.ws.send(JSON.stringify({ type: 'duel_attack' }));
    cb.ws.send(JSON.stringify({ type: 'duel_attack' }));
    const [endA, endB] = await Promise.all([endAP, endBP]);
    console.log('PASS duel finished. Winner:', endA.winner, '| pot:', endA.pot + 'g', '| reason:', endA.reason);
    const golds = [endA.profile.gold, endB.profile.gold].sort((x, y) => x - y);
    // Stage 20 (flagged fix): the winner also banks the one-time
    // +25g "Win a duel" starter-goal reward on top of the 110g pot.
    if (golds[0] !== 90 || golds[1] !== 135) throw new Error('escrow settlement wrong: ' + golds);
    console.log('PASS escrow settlement: loser 90g, winner 135g (110g pot + 25g starter-goal reward)');
    ca.ws.close(); cb.ws.close();
    await sleep(300);
    server.kill(); await sleep(500);

    // Restart — profiles must come back from the saved database file.
    server = await startServer();
    const a2 = await api('/api/login', { username: 'TesterA', password: 'secret1' });
    const winnerGold = Math.max(endA.profile.gold, endB.profile.gold);
    const aExpected = endA.winner === 'TesterA' ? winnerGold : 90;
    if (a2.profile.gold !== aExpected) throw new Error(`persistence wrong: TesterA has ${a2.profile.gold}, expected ${aExpected}`);
    console.log(`PASS saving: after restart TesterA still has ${a2.profile.gold}g, ${a2.profile.wins}W/${a2.profile.losses}L`);
    console.log('ALL TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
