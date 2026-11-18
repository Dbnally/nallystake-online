// Chat reproduction test: two clients, public chat both ways, whisper both ways,
// plus presence in each other's state snapshots, plus cross-area chat.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18099;
const DB = path.join(os.tmpdir(), `nallystake-chat-${Date.now()}.json`);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

function startServer() {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DB_PATH: DB }, stdio: 'pipe' });
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
    const client = { ws, events: [], waiters: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      client.events.push(m);
      client.waiters = client.waiters.filter((w) => !w(m));
    });
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isChat = (from, text) => (m) => m.type === 'chat' && m.from === from && m.text === text;

(async () => {
  const server = await startServer();
  try {
    const a = await api('/api/register', { username: 'ChatA', password: 'secret1' });
    const b = await api('/api/register', { username: 'ChatB', password: 'secret2' });
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    await ca.waitFor((m) => m.type === 'welcome', 'welcome A');
    await cb.waitFor((m) => m.type === 'welcome', 'welcome B');
    await sleep(400);

    // Presence: each sees the other in plaza state
    const stA = ca.events.filter((e) => e.type === 'state').pop();
    const stB = cb.events.filter((e) => e.type === 'state').pop();
    const namesA = (stA ? stA.players : []).map((p) => p.username);
    const namesB = (stB ? stB.players : []).map((p) => p.username);
    console.log('A sees:', namesA.join(','), '| area:', stA && stA.area);
    console.log('B sees:', namesB.join(','), '| area:', stB && stB.area);
    if (!namesA.includes('ChatB') || !namesB.includes('ChatA')) throw new Error('PRESENCE FAIL');

    // Public chat A -> B and A echo
    ca.ws.send(JSON.stringify({ type: 'chat', text: 'hello from A' }));
    await cb.waitFor(isChat('ChatA', 'hello from A'), 'B receives A chat');
    await ca.waitFor(isChat('ChatA', 'hello from A'), 'A receives own echo');
    console.log('PASS public chat A->B (+sender echo)');

    // Public chat B -> A
    cb.ws.send(JSON.stringify({ type: 'chat', text: 'reply from B' }));
    await ca.waitFor(isChat('ChatB', 'reply from B'), 'A receives B chat');
    await cb.waitFor(isChat('ChatB', 'reply from B'), 'B receives own echo');
    console.log('PASS public chat B->A (+sender echo)');

    // Whisper A -> B
    ca.ws.send(JSON.stringify({ type: 'whisper', to: 'ChatB', text: 'psst B' }));
    const wB = await cb.waitFor((m) => m.type === 'whisper' && m.from === 'ChatA' && m.text === 'psst B', 'B receives whisper');
    const wA = await ca.waitFor((m) => m.type === 'whisper' && m.to === 'ChatB' && m.text === 'psst B', 'A whisper echo');
    console.log('PASS whisper A->B (+sender echo)');

    // Whisper B -> A
    cb.ws.send(JSON.stringify({ type: 'whisper', to: 'ChatA', text: 'psst A' }));
    await ca.waitFor((m) => m.type === 'whisper' && m.from === 'ChatB' && m.text === 'psst A', 'A receives whisper');
    console.log('PASS whisper B->A');

    // Cross-area: B travels to goblins; public chat should still be global
    cb.ws.send(JSON.stringify({ type: 'travel', to: 'goblins' }));
    await sleep(500);
    const stB2 = cb.events.filter((e) => e.type === 'state').pop();
    console.log('B area after travel:', stB2 && stB2.area, '| players there:', (stB2 ? stB2.players : []).map((p) => p.username).join(','));
    ca.ws.send(JSON.stringify({ type: 'chat', text: 'cross area ping' }));
    await cb.waitFor(isChat('ChatA', 'cross area ping'), 'B in goblins receives plaza chat');
    console.log('PASS cross-area public chat');

    console.log('ALL CHAT TESTS PASSED');
    ca.ws.close(); cb.ws.close();
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
