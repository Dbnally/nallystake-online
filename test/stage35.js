// Stage 35 tests: CONNECTION STABILITY (Derek, 2026-11-19 — "Fix
// the connection drops next"). Playtest on the Stage 30 build
// measured browser sockets dropping every ~20–40s, every reconnect
// respawning in the plaza, challenge panels dying with the drop,
// and a chat line sent mid-drop vanishing. (Stage numbering: the
// gear-chart port took 34 in a parallel session.)
//   * Part 1 (keepalive): the server now sends an application-level
//     {type:'ping'} DATA frame on the heartbeat tick (proxies that
//     ignore WebSocket control frames still see traffic) and
//     answers a client {type:'ping'} with {type:'pong'}.
//   * Part 2 (no-crash): a batch of malformed / edge-case messages
//     must not kill the process or any other player's socket — the
//     message handler is wrapped, and the server stays responsive.
//   * Part 3 (forced drop): a hard socket drop at the Fishing Cove
//     reconnects into the cove at the same spot (Stage 31 restore),
//     and a chat line sent right after reconnect (what the client's
//     new outbox flush does) reaches another player.
//   * Part 4 (challenge survival): a pending duel challenge is NOT
//     deleted when the challenged player drops — no challenge_clear
//     is broadcast, the challenge is re-pushed on their reconnect,
//     and it can still be accepted and fought.
//   * Part 5 (mini-soak): two active clients stay connected with
//     zero drops (the full 5-minute soak runs separately).
//   * Client pins: chat outbox (queueChat / flushChatOutbox wired
//     into the chat + whisper sends and the welcome handler), and
//     the onMsg ping→pong reply.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18135;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage35.json');
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
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, HEARTBEAT_MS: '2000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE + '/'); if (res.ok) return; } catch { /* not up */ }
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
async function api(pathName, body) {
  const r = await fetch(BASE + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(pathName + ': ' + d.error);
  return d;
}

class Client {
  constructor(name) { this.name = name; this.events = []; this.ws = null; this.closes = 0; }
  connect(token) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
      this.ws.on('message', (data) => { try { this.events.push(JSON.parse(data.toString())); } catch { /* ignore */ } });
      this.ws.on('close', () => { this.closes++; });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  sendRaw(s) { this.ws.send(s); }
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
  terminate() { try { this.ws.terminate(); } catch { /* ignore */ } }
}
const PW = (n) => 's35-pass-' + n;
async function register(name) {
  const d = await api('/api/register', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function reconnect(name) {
  const d = await api('/api/login', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  const w = await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome (reconnect)');
  return { c, welcome: w };
}
function latestPos(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? { x: p.x, y: p.y } : null;
}
async function walkTo(c, x, y, steps = 10) {
  const from = latestPos(c, c.name) || { x: 800, y: 450 };
  for (let i = 1; i <= steps; i++) {
    c.send({ type: 'move', x: Math.round(from.x + (x - from.x) * (i / steps)), y: Math.round(from.y + (y - from.y) * (i / steps)) });
    await sleep(90);
  }
  await sleep(250);
}

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/HEARTBEAT_MS \|\| 15000/.test(src), 'source: heartbeat interval is 15s by default');
  assert(/send\(p\.ws, \{ type: 'ping', t: Date\.now\(\) \}\)/.test(src), 'source: heartbeat tick sends an app-level ping data frame');
  assert(/try \{ handleMessage\(raw\); \} catch/.test(src), 'source: message handler is wrapped so one bad message cannot crash the process');
  assert(/bufferedAmount > 16 \* 1024 \* 1024/.test(src), 'source: send() has the backpressure guard');
  assert(/pending challenges involving the leaver SURVIVE/.test(src), 'source: cleanupDisconnect keeps pending challenges');
  assert(/let chatOutbox=\[\]/.test(clientSrc) && /function queueChat/.test(clientSrc) && /function flushChatOutbox/.test(clientSrc),
    'client source: chat outbox exists (queueChat / flushChatOutbox)');
  assert(/queueChat\(\{type:'chat',text:v\}\)/.test(clientSrc), 'client source: a failed public-chat send is queued');
  assert(/queueChat\(\{type:'whisper',to:name,text:v\}\)/.test(clientSrc), 'client source: a failed whisper send is queued');
  assert(/flushChatOutbox\(\);/.test(clientSrc), 'client source: the outbox flushes on welcome');
  assert(/if\(m\.type==='ping'\)\{ send\(\{type:'pong'\}\); return; \}/.test(clientSrc), 'client source: client answers the server app-ping with a pong');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh */ }
  await startServer();
  try {
    // ---------- Part 1: app-level keepalive ----------
    const K = await register('Keep35');
    const ping = await K.waitFor((e) => e.type === 'ping', 8000, 'server app-ping');
    assert(!!ping, 'Part 1: server sends an app-level {type:ping} data frame on the heartbeat tick');
    const mK = K.mark();
    K.send({ type: 'ping' });
    const pong = (await K.waitSince(mK, (e) => e.type === 'pong', 8000, 'server pong reply')).e;
    assert(!!pong, 'Part 1: server answers a client {type:ping} with {type:pong}');

    // ---------- Part 2: malformed messages cannot kill the world ----------
    const bystander = await register('Bystander35');
    K.sendRaw('this is not json');
    K.sendRaw('null');
    K.sendRaw('[1,2,3]');
    K.send({ type: 'move', x: 'abc', y: null });
    K.send({ type: 'travel', to: 'nowhere-land' });
    K.send({ type: 'challenge' });
    K.send({ type: 'whisper', to: 123, text: 'x' });
    K.send({ type: 'chat', text: 'x'.repeat(5000) });
    K.send({ type: 'duel_attack', extra: { nested: [1, 2, 3] } });
    await sleep(1200);
    const mK2 = K.mark();
    K.send({ type: 'ping' });
    const stillAlive = (await K.waitSince(mK2, (e) => e.type === 'pong', 8000, 'pong after malformed batch')).e;
    assert(!!stillAlive, 'Part 2: the offending client stays connected and the server stays responsive');
    const mB = bystander.mark();
    bystander.send({ type: 'chat', text: 'bystander still here' });
    const echo = (await bystander.waitSince(mB, (e) => e.type === 'chat' && /bystander still here/.test(e.text || ''), 8000, 'bystander chat echo')).e;
    assert(!!echo, 'Part 2: an uninvolved player is unaffected by another client\'s malformed messages');
    K.close();

    // ---------- Part 3: forced drop at the cove → restore + chat lands ----------
    const cove = await register('Cove35');
    const mT = cove.mark();
    cove.send({ type: 'travel', to: 'cove' });
    await cove.waitSince(mT, (e) => e.type === 'area' && e.area === 'cove', 10000, 'travel to Fishing Cove');
    await walkTo(cove, 300, 500);
    cove.terminate(); // hard drop — no close frame
    await sleep(1000);
    const { c: cove2, welcome } = await reconnect('Cove35');
    assert(welcome.area === 'cove', `Part 3: reconnect lands back in the cove, not the plaza (got "${welcome.area}")`);
    const meC = (welcome.players || []).find((p) => p.username === 'Cove35');
    assert(meC && Math.abs(meC.x - 300) <= 20 && Math.abs(meC.y - 500) <= 20,
      `Part 3: restored at the pre-drop position (${meC ? meC.x + ',' + meC.y : 'missing'})`);
    // What the client's outbox flush does on reconnect: the queued line goes out now.
    const mB2 = bystander.mark();
    cove2.send({ type: 'chat', text: 'queued while I was dropped' });
    const landed = (await bystander.waitSince(mB2, (e) => e.type === 'chat' && /queued while I was dropped/.test(e.text || ''), 8000, 'post-reconnect chat delivery')).e;
    assert(!!landed, 'Part 3: a chat line sent right after reconnect reaches another player');
    cove2.close();

    // ---------- Part 4: a pending challenge survives the target's drop ----------
    const A = await register('ChalA35');
    const B = await register('ChalB35');
    const mA = A.mark(), mB4 = B.mark();
    A.send({ type: 'challenge', target: 'ChalB35', stake: 1 });
    const inc = (await B.waitSince(mB4, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming')).e;
    assert(!!inc && inc.challengeId, 'Part 4: challenge delivered before the drop');
    B.terminate(); // the challenged player drops before answering
    await sleep(1500);
    const cleared = A.events.slice(mA).some((e) => e.type === 'challenge_clear');
    assert(!cleared, 'Part 4: no challenge_clear is broadcast when the challenged player drops');
    const { c: B2 } = await reconnect('ChalB35');
    const inc2 = await B2.waitFor((e) => e.type === 'challenge_incoming' && e.challengeId === inc.challengeId, 8000, 'challenge re-push on reconnect');
    assert(!!inc2, 'Part 4: the surviving challenge is re-pushed to the reconnected player');
    const mA2 = A.mark(), mB2b = B2.mark();
    B2.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
    A.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
    B2.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
    await A.waitSince(mA2, (e) => e.type === 'duel_start', 10000, 'duel_start (challenger)');
    await B2.waitSince(mB2b, (e) => e.type === 'duel_start', 10000, 'duel_start (reconnected acceptor)');
    assert(true, 'Part 4: the survived challenge can still be accepted and starts the duel');
    A.close(); B2.close();

    // ---------- Part 5: mini-soak — active clients, zero drops ----------
    const S1 = await register('SoakA35');
    const S2 = await register('SoakB35');
    const iv = setInterval(() => {
      for (const c of [S1, S2]) { try { c.send({ type: 'move', x: 700 + Math.random() * 200, y: 350 + Math.random() * 100 }); } catch { /* ignore */ } }
    }, 700);
    await sleep(20000);
    clearInterval(iv);
    assert(S1.closes === 0 && S2.closes === 0, `Part 5: zero drops across 20s of active play (closes: ${S1.closes}/${S2.closes})`);
    S1.close(); S2.close();
    bystander.close();
  } finally {
    await stopServer();
  }
  console.log('\nStage 35: ALL PASS');
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
