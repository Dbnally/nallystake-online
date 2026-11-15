// nallystake-online — Phase 1 multiplayer server (gold-only, no real money)
// Built-in Node HTTP for the test client + `ws` for real-time play.
// The SERVER is authoritative: it holds gold, holds stakes in escrow,
// rolls every hit on the 0.6s tick, and saves every profile. Clients
// can ask — they cannot decide outcomes. That is what stops cheating.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const TICK_MS = 600;
const START_GOLD = 100;

// ---------- saving (see store.js) ----------
// DATABASE_URL set -> Postgres (Neon free in production): profiles live
// outside this server, so host sleep/restarts/redeploys can't wipe them.
// No DATABASE_URL -> local JSON file, for testing on your own machine only.
const { createStore } = require('./store');
const store = createStore(DB_PATH);
let db = { users: {} };
let saveTimer = null;
function save(key) {
  if (process.env.DATABASE_URL) {
    if (key && db.users[key]) store.putUser(key, db.users[key]).catch((e) => console.error('save failed:', e.message));
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.flush().catch((e) => console.error('save failed:', e.message)), 50);
}
function hashPass(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}
function newProfile(username) {
  return {
    username, gold: START_GOLD, rating: 1000, wins: 0, losses: 0,
    style: 'accurate', createdAt: new Date().toISOString(),
  };
}
function publicProfile(p) {
  return { username: p.username, gold: p.gold, rating: p.rating, wins: p.wins, losses: p.losses, style: p.style };
}

// ---------- HTTP: static client + account APIs ----------
const tokens = new Map(); // token -> username (in-memory sessions)
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const { username, password } = await readBody(req);
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_ ]{3,16}$/.test(name)) return json(res, 400, { error: 'Name: 3-16 letters/numbers.' });
    if (String(password || '').length < 6) return json(res, 400, { error: 'Password: 6+ characters.' });
    const key = name.toLowerCase();
    if (db.users[key]) return json(res, 409, { error: 'That name is taken.' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[key] = { salt, passHash: hashPass(password, salt), profile: newProfile(name) };
    save(key);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, key);
    return json(res, 200, { token, profile: publicProfile(db.users[key].profile) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { username, password } = await readBody(req);
    const key = String(username || '').trim().toLowerCase();
    const u = db.users[key];
    if (!u || u.passHash !== hashPass(String(password || ''), u.salt)) return json(res, 401, { error: 'Wrong name or password.' });
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, key);
    return json(res, 200, { token, profile: publicProfile(u.profile) });
  }
  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const rows = Object.values(db.users).map((u) => publicProfile(u.profile))
      .sort((a, b) => b.rating - a.rating).slice(0, 20);
    return json(res, 200, { leaderboard: rows });
  }
  // static files
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) { res.writeHead(404); return res.end('not found'); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'text/plain' });
  fs.createReadStream(full).pipe(res);
});

// ---------- Real-time play ----------
const wss = new WebSocketServer({ server, path: '/ws' });
const online = new Map(); // usernameKey -> { ws, profile, x, y, duelId }
const challenges = new Map(); // id -> { from, to, stake, expires }
const duels = new Map(); // id -> duel

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, exceptKey) {
  for (const [k, p] of online) if (k !== exceptKey) send(p.ws, obj);
}
function playersSnapshot() {
  return [...online.values()].map((p) => ({ username: p.profile.username, x: Math.round(p.x), y: Math.round(p.y), inDuel: !!p.duelId }));
}
function broadcastState() { broadcast({ type: 'state', players: playersSnapshot() }); }

const STYLES = {
  accurate:   { acc: 0.85, max: 11 }, // +accuracy
  aggressive: { acc: 0.70, max: 15 }, // +power
  defensive:  { acc: 0.75, max: 11, block: 0.35 }, // chance to fully block
  controlled: { acc: 0.78, max: 13 }, // a bit of all three
};
function rollHit(attackerProfile, defenderProfile) {
  const s = STYLES[attackerProfile.style] || STYLES.accurate;
  const d = STYLES[defenderProfile.style] || STYLES.accurate;
  if (d.block && Math.random() < d.block) return 0;
  if (Math.random() > s.acc) return 0;
  return 1 + Math.floor(Math.random() * s.max);
}

function endDuel(duel, winnerKey, reason) {
  if (duel.done) return;
  duel.done = true;
  clearInterval(duel.timer);
  duels.delete(duel.id);
  const winner = db.users[winnerKey].profile;
  const loserKey = duel.a === winnerKey ? duel.b : duel.a;
  const loser = db.users[loserKey].profile;
  winner.gold += duel.pot; // escrow pays out — server held both stakes
  winner.wins += 1; loser.losses += 1;
  winner.rating += 11; loser.rating = Math.max(0, loser.rating - 11);
  save(winnerKey); save(loserKey);
  for (const k of [duel.a, duel.b]) {
    const p = online.get(k);
    if (p) { p.duelId = null; send(p.ws, { type: 'duel_end', winner: winner.username, reason, pot: duel.pot, profile: publicProfile(db.users[k].profile) }); }
  }
  broadcast({ type: 'chat', from: 'Duel Master', text: `${winner.username} beat ${loser.username} for ${duel.pot}g (${reason}).` });
  broadcastState();
}

function startDuel(aKey, bKey, stake) {
  const a = db.users[aKey].profile, b = db.users[bKey].profile;
  // Escrow: both stakes leave both purses before the first tick.
  a.gold -= stake; b.gold -= stake; save(aKey); save(bKey);
  const id = crypto.randomBytes(6).toString('hex');
  const duel = { id, a: aKey, b: bKey, stake, pot: stake * 2, hp: { [aKey]: 99, [bKey]: 99 }, done: false, timer: null };
  duels.set(id, duel);
  online.get(aKey).duelId = id; online.get(bKey).duelId = id;
  for (const k of [aKey, bKey]) {
    const p = online.get(k);
    send(p.ws, { type: 'duel_start', duelId: id, stake, pot: duel.pot, you: db.users[k].profile.username, opponent: db.users[k === aKey ? bKey : aKey].profile.username, profile: publicProfile(db.users[k].profile) });
  }
  broadcastState();
  duel.timer = setInterval(() => {
    // Both attacks due this tick resolve, then deaths are checked (OSRS tick rule).
    const dmgToB = rollHit(a, b);
    const dmgToA = rollHit(b, a);
    duel.hp[bKey] = Math.max(0, duel.hp[bKey] - dmgToB);
    duel.hp[aKey] = Math.max(0, duel.hp[aKey] - dmgToA);
    for (const k of [aKey, bKey]) {
      const p = online.get(k);
      if (p) send(p.ws, { type: 'duel_tick', hpYou: duel.hp[k], hpOpponent: duel.hp[k === aKey ? bKey : aKey], youHit: k === aKey ? dmgToB : dmgToA, oppHit: k === aKey ? dmgToA : dmgToB });
    }
    if (duel.hp[aKey] <= 0 && duel.hp[bKey] <= 0) endDuel(duel, Math.random() < 0.5 ? aKey : bKey, 'double KO — coin flip');
    else if (duel.hp[bKey] <= 0) endDuel(duel, aKey, 'KO');
    else if (duel.hp[aKey] <= 0) endDuel(duel, bKey, 'KO');
  }, TICK_MS);
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const key = tokens.get(token);
  if (!key) { ws.close(4001, 'bad token'); return; }
  if (online.has(key)) { send(ws, { type: 'error', message: 'Already signed in somewhere else.' }); ws.close(); return; }
  const profile = db.users[key].profile;
  online.set(key, { ws, profile, x: 100 + Math.random() * 500, y: 100 + Math.random() * 250, duelId: null });
  send(ws, { type: 'welcome', profile: publicProfile(profile), players: playersSnapshot() });
  broadcast({ type: 'chat', from: 'Game', text: `${profile.username} entered the plaza.` }, key);
  broadcastState();

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = online.get(key); if (!me) return;
    if (m.type === 'move') {
      me.x = Math.max(0, Math.min(800, +m.x || 0));
      me.y = Math.max(0, Math.min(450, +m.y || 0));
      broadcastState();
    }
    if (m.type === 'chat') {
      const text = String(m.text || '').slice(0, 140).trim();
      if (text) broadcast({ type: 'chat', from: profile.username, text });
    }
    if (m.type === 'style') {
      if (STYLES[m.style]) { profile.style = m.style; save(key); send(ws, { type: 'profile', profile: publicProfile(profile) }); }
    }
    if (m.type === 'challenge') {
      const targetKey = String(m.target || '').toLowerCase();
      const stake = Math.floor(+m.stake || 0);
      const target = online.get(targetKey);
      if (!target || targetKey === key) return send(ws, { type: 'error', message: 'Pick another online player.' });
      if (me.duelId || target.duelId) return send(ws, { type: 'error', message: 'One of you is already in a duel.' });
      if (stake < 1 || stake > profile.gold || stake > target.profile.gold) return send(ws, { type: 'error', message: 'Stake must be 1g up to what you both have.' });
      const id = crypto.randomBytes(6).toString('hex');
      challenges.set(id, { from: key, to: targetKey, stake, expires: Date.now() + 30000 });
      send(target.ws, { type: 'challenge_incoming', challengeId: id, from: profile.username, stake, seconds: 30 });
      send(ws, { type: 'chat', from: 'Game', text: `Challenge sent to ${target.profile.username} for ${stake}g.` });
    }
    if (m.type === 'challenge_response') {
      const ch = challenges.get(m.challengeId);
      if (!ch || ch.to !== key || ch.expires < Date.now()) { challenges.delete(m.challengeId); return send(ws, { type: 'error', message: 'That challenge is gone.' }); }
      challenges.delete(m.challengeId);
      const fromP = online.get(ch.from);
      if (!fromP) return;
      if (!m.accept) { send(fromP.ws, { type: 'chat', from: 'Game', text: `${profile.username} declined. No gold was taken.` }); return; }
      // Re-check purses at accept time — escrow only happens now.
      if (db.users[ch.from].profile.gold < ch.stake || profile.gold < ch.stake) return send(ws, { type: 'error', message: 'Someone no longer has the gold.' });
      startDuel(ch.from, key, ch.stake);
    }
  });

  ws.on('close', () => {
    const me = online.get(key);
    if (me && me.duelId) {
      const duel = duels.get(me.duelId);
      if (duel) endDuel(duel, duel.a === key ? duel.b : duel.a, 'forfeit — left mid-duel');
    }
    online.delete(key);
    broadcast({ type: 'chat', from: 'Game', text: `${profile.username} left the plaza.` });
    broadcastState();
  });
});

store.init().then((users) => {
  db.users = users;
  const mode = process.env.DATABASE_URL ? 'Postgres database' : 'local file (test mode)';
  server.listen(PORT, () => console.log(`nallystake-online listening on :${PORT} (gold-only, saving: ${mode})`));
}).catch((e) => { console.error('Could not open the saving database:', e.message); process.exit(1); });
