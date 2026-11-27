// Stage 37, Addition #3 — admin "Go to" teleport.
//   {type:'admin_goto', to} moves an admin/owner to an online
//   player's side with the full per-area state push. Covered:
//   owner AND admin can go; the admin lands in the target's area
//   beside them (snapshot positions); a plain player is refused
//   and does not move; a MOD is refused (Derek: "admin" only);
//   self-goto is refused; an offline target errors cleanly; a
//   target inside a duel is refused ("in a fight right now");
//   the target receives no special alert.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18339;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `nally-stage37goto-${process.pid}.json`);
let server = null;
let failures = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg); console.log('  ok -', msg); }
function check(cond, msg) { if (cond) { console.log('  ok -', msg); } else { failures++; console.log('  FAIL -', msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: data };
}
class Client {
  constructor(name) { this.name = name; this.events = []; }
  connect(token) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
      this.ws.on('message', (raw) => { try { this.events.push(JSON.parse(raw.toString())); } catch { /* ignore */ } });
      this.ws.on('error', reject);
      const iv = setInterval(() => {
        if (this.events.find((e) => e.type === 'welcome')) { clearInterval(iv); resolve(); }
      }, 25);
      setTimeout(() => { clearInterval(iv); reject(new Error(this.name + ': no welcome')); }, 10000);
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  mark() { return this.events.length; }
  async waitSince(mark, pred, timeoutMs, label) {
    const t0 = Date.now();
    for (;;) {
      for (let i = mark; i < this.events.length; i++) if (pred(this.events[i])) return { e: this.events[i], idx: i };
      if (Date.now() - t0 > timeoutMs) throw new Error(`${this.name}: timeout waiting for ${label}`);
      await sleep(40);
    }
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}
async function registerLogin(username) {
  const reg = await api('POST', '/api/register', { username, password: 'goto-pass-37' });
  assert(reg.status === 200 || reg.status === 201, `register ${username} (got ${reg.status})`);
  const login = await api('POST', '/api/login', { username, password: 'goto-pass-37' });
  assert(login.status === 200 && login.body.token, `login ${username}`);
  const c = new Client(username);
  await c.connect(login.body.token);
  return c;
}
async function areaOf(client, username) {
  const m = client.mark();
  client.send({ type: 'online_list' });
  const r = await client.waitSince(m, (e) => e.type === 'online_list', 8000, 'online_list');
  const row = (r.e.players || []).find((p) => p.username === username);
  return row ? row.area : null;
}

(async () => {
  try { fs.unlinkSync(DB); } catch { /* fresh anyway */ }
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, BOT_TEST_FAST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await api('GET', '/api/leaderboard'); if (r.status === 200) break; } catch { /* not up */ }
      await sleep(300);
    }
    const nally = await registerLogin('nally'); // owner by name
    const admin = await registerLogin('GotoAdmin');
    const mod = await registerLogin('GotoMod');
    const target = await registerLogin('GotoTarget');
    const plain = await registerLogin('GotoPlain');
    await api('POST', '/api/register', { username: 'GotoAway', password: 'goto-pass-37' }); // never connects: the offline target
    nally.send({ type: 'set_role', target: 'GotoAdmin', role: 'admin' });
    nally.send({ type: 'set_role', target: 'GotoMod', role: 'mod' });
    await sleep(800);

    // The target waits in the Training Cave.
    target.send({ type: 'travel', to: 'training' });
    await target.waitSince(target.mark(), (e) => e.type === 'area' && e.area === 'training', 8000, 'target reaches training');
    await sleep(400);

    // 1) Owner go-to: lands in the target's area, beside them.
    let m = nally.mark();
    nally.send({ type: 'admin_goto', to: 'GotoTarget' });
    const areaMsg = (await nally.waitSince(m, (e) => e.type === 'area', 8000, 'owner area push')).e;
    check(areaMsg.area === 'training', `owner go-to pushes the target's area (got ${areaMsg.area})`);
    const st = (await nally.waitSince(m, (e) => e.type === 'state' && e.area === 'training'
      && e.players.some((p) => p.username === 'nally') && e.players.some((p) => p.username === 'GotoTarget'), 8000, 'training snapshot with owner + target')).e;
    const meRow = st.players.find((p) => p.username === 'nally');
    const tgRow = st.players.find((p) => p.username === 'GotoTarget');
    const dist = Math.hypot(meRow.x - tgRow.x, meRow.y - tgRow.y);
    check(dist > 0 && dist <= 60, `owner lands beside the target (${dist.toFixed(0)} units away)`);
    check(!target.events.some((e) => e.type === 'chat' && /Go to/.test(e.text || '')), 'the target gets no special alert (silent arrival)');

    // 2) Admin (role, not owner) can also go.
    m = admin.mark();
    admin.send({ type: 'admin_goto', to: 'GotoTarget' });
    const aArea = (await admin.waitSince(m, (e) => e.type === 'area', 8000, 'admin area push')).e;
    check(aArea.area === 'training', 'admin go-to works too');
    check((await areaOf(admin, 'GotoAdmin')) === 'training', 'online_list shows the admin in the target area');

    // 3) A mod is refused and does not move.
    m = mod.mark();
    mod.send({ type: 'admin_goto', to: 'GotoTarget' });
    const modErr = (await mod.waitSince(m, (e) => e.type === 'error', 8000, 'mod refusal')).e;
    check(/admin/i.test(modErr.message || ''), `mod refused ("${modErr.message}")`);
    check((await areaOf(mod, 'GotoMod')) === 'plaza', 'mod did not move');

    // 4) A plain player is refused and does not move.
    m = plain.mark();
    plain.send({ type: 'admin_goto', to: 'GotoTarget' });
    const plErr = (await plain.waitSince(m, (e) => e.type === 'error', 8000, 'player refusal')).e;
    check(/admin/i.test(plErr.message || ''), `plain player refused ("${plErr.message}")`);
    check((await areaOf(mod, 'GotoPlain')) === 'plaza', 'plain player did not move'); // (online_list itself is staff-only, so a staff client does the asking)

    // 5) Self go-to is refused.
    m = nally.mark();
    nally.send({ type: 'admin_goto', to: 'nally' });
    const selfErr = (await nally.waitSince(m, (e) => e.type === 'error', 8000, 'self refusal')).e;
    check(!!selfErr.message, `self go-to refused ("${selfErr.message}")`);

    // 6) Offline targets error cleanly (registered-but-away and unknown alike).
    m = nally.mark();
    nally.send({ type: 'admin_goto', to: 'GotoAway' });
    const offErr = (await nally.waitSince(m, (e) => e.type === 'error', 8000, 'offline refusal')).e;
    check(/not online/i.test(offErr.message || ''), `offline target errors cleanly ("${offErr.message}")`);
    m = nally.mark();
    nally.send({ type: 'admin_goto', to: 'NoSuchPerson' });
    const unkErr = (await nally.waitSince(m, (e) => e.type === 'error', 8000, 'unknown refusal')).e;
    check(/not online/i.test(unkErr.message || ''), `unknown target errors cleanly ("${unkErr.message}")`);

    // 6b) Same-area go-to (the 2026-11-27 live failure): the area
    // message must carry the landing coordinates, or the client's
    // local position never re-seeds and the admin stays put. At
    // this point the admin and the target are BOTH in training.
    {
      const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      check(/if\(typeof m\.x==='number'&&typeof m\.y==='number'\)\{\s*myPos=\{x:m\.x,y:m\.y\}/.test(src), 'client: onAreaMsg snaps myPos to coordinates carried by an area message');
    }
    m = admin.mark();
    admin.send({ type: 'admin_goto', to: 'GotoTarget' });
    const sameArea = (await admin.waitSince(m, (e) => e.type === 'area', 8000, 'same-area area push')).e;
    check(sameArea.area === 'training', 'same-area go-to pushes the area as before');
    check(typeof sameArea.x === 'number' && typeof sameArea.y === 'number', `same-area go-to carries landing coordinates (x=${sameArea.x}, y=${sameArea.y})`);
    const st2 = (await admin.waitSince(m, (e) => e.type === 'state' && e.area === 'training'
      && e.players.some((p) => p.username === 'GotoAdmin'), 8000, 'post-goto snapshot')).e;
    const aRow = st2.players.find((p) => p.username === 'GotoAdmin');
    const tRow = st2.players.find((p) => p.username === 'GotoTarget');
    check(Math.abs(aRow.x - sameArea.x) <= 2 && Math.abs(aRow.y - sameArea.y) <= 2, 'the landing coordinates match the admin\'s snapshot position');
    check(Math.hypot(aRow.x - tRow.x, aRow.y - tRow.y) <= 60, 'same-area go-to lands beside the target');

    // 7) A target inside a duel is refused.
    target.send({ type: 'travel', to: 'plaza' });
    await target.waitSince(target.mark(), (e) => e.type === 'area' && e.area === 'plaza', 8000, 'target back in plaza');
    const mT = target.mark(), mP = plain.mark();
    target.send({ type: 'challenge', target: 'GotoPlain', stake: 0, freePlay: true });
    const inc = (await plain.waitSince(mP, (e) => e.type === 'challenge_incoming', 8000, 'duel challenge')).e;
    plain.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
    target.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
    await target.waitSince(mT, (e) => e.type === 'duel_start', 15000, 'duel starts');
    m = nally.mark();
    nally.send({ type: 'admin_goto', to: 'GotoTarget' });
    const duelErr = (await nally.waitSince(m, (e) => e.type === 'error', 8000, 'in-duel refusal')).e;
    check(/in a fight/i.test(duelErr.message || ''), `target in a duel refused ("${duelErr.message}")`);
    check((await areaOf(nally, 'nally')) === 'training', 'the refused admin stayed put');
    target.close(); plain.close(); // forfeit-cleanup the duel
    await sleep(1500);

    for (const c of [nally, admin, mod]) c.close();
  } catch (e) {
    failures++;
    console.log('FAIL - suite error:', e.message);
  }
  if (server) { server.kill('SIGTERM'); await sleep(600); server = null; }
  try { fs.unlinkSync(DB); } catch { /* cleanup */ }
  if (failures) { console.log(`\nSTAGE 37 GOTO: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('\nSTAGE 37 GOTO: ALL PASS');
})().finally(() => { if (server) server.kill('SIGKILL'); });
