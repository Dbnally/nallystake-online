// Stage 7C proof: (1) the challenge '!' broadcasts — when a challenge
// goes out, EVERYONE hears {type:'challenging', from, to, area} so
// clients can badge the CHALLENGER (not the target), and every
// resolution (decline / accept here) broadcasts {type:'challenge_clear'};
// (2) the `act` field in state snapshots — null when idle, 'fight'
// during a goblin fight, the skill name ('mining') for ~4s after a
// successful gather, then back to null once the window lapses.
// File mode, temp DB, same harness style as stage1/stage2.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18090;
const DB = path.join(os.tmpdir(), `nallystake-stage7c-${Date.now()}.json`);
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
    const client = { ws, events: [] };
    ws.on('message', (raw) => client.events.push(JSON.parse(raw)));
    client.send = (obj) => ws.send(JSON.stringify(obj));
    client.profile = () => {
      for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].profile) return client.events[i].profile;
      return null;
    };
    client.waitSince = (startIdx, pred, timeout = 30000, label = 'event') => new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (let i = startIdx; i < client.events.length; i++) {
          if (pred(client.events[i])) { clearInterval(iv); return res(client.events[i]); }
        }
        if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('timeout waiting ' + label)); }
      }, 25);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
function waitAny(client, startIdx, preds, timeout = 15000, label = 'event') {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (let i = startIdx; i < client.events.length; i++) {
        const e = client.events[i];
        for (const [name, pred] of Object.entries(preds)) if (pred(e)) { clearInterval(iv); return res({ name, e }); }
      }
      if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('timeout waiting ' + label)); }
    }, 25);
  });
}
function latestNpcState(client) {
  for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].type === 'npc_state') return client.events[i];
  return null;
}
function entryOf(stateMsg, username) {
  return (stateMsg.players || []).find((p) => p.username === username) || null;
}
// Keep test actions >=1.55s apart so the server's 1.4s action cooldown
// is never the reason an expected success fails (stage2 pattern).
let lastActAt = 0;
async function pace() {
  const wait = 1550 - (Date.now() - lastActAt);
  if (wait > 0) await sleep(wait);
  lastActAt = Date.now();
}
// Walk onto a node and gather until one attempt succeeds (bounded).
async function gatherUntil(client, node, tries = 30) {
  for (let i = 0; i < tries; i++) {
    await pace();
    const mark = client.events.length;
    client.send({ type: 'move', x: node.x, y: node.y });
    client.send({ type: 'gather', nodeId: node.id });
    const r = await waitAny(client, mark, {
      result: (e) => e.type === 'gather_result' && e.nodeId === node.id,
      error: (e) => e.type === 'error',
    }, 10000, 'gather ' + node.id);
    if (r.name === 'result' && r.e.ok) { await sleep(250); return r.e; }
    if (r.name === 'error' && !/Too fast/.test(r.e.message || '')) throw new Error(`gather ${node.id} errored: ${r.e.message}`);
  }
  throw new Error(`gather ${node.id}: no success in ${tries} tries`);
}
// Force a fresh state broadcast (any move re-broadcasts state) and
// return the first snapshot for `area` seen from `mark`.
async function freshState(client, mark, area, label) {
  client.send({ type: 'move', x: 401, y: 226 });
  return client.waitSince(mark, (e) => e.type === 'state' && e.area === area, 10000, label);
}

(async () => {
  let server = await startServer();
  try {
    const a = await api('/api/register', { username: 'S7cAlpha', password: 'secret1' });
    const b = await api('/api/register', { username: 'S7cBeta', password: 'secret2' });
    const c = await api('/api/register', { username: 'S7cGamma', password: 'secret3' });
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    const cc = await connect(c.token);
    await ca.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome A');
    await cb.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome B');
    await cc.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome C');

    // --- (a1) Decline path: C sees the '!' go up over A, then clear ---
    {
      const markC = cc.events.length;
      ca.send({ type: 'challenge', target: 'S7cBeta', stake: 5 });
      const ch = await cc.waitSince(markC, (e) => e.type === 'challenging', 10000, 'C sees challenging');
      assert(ch.from === 'S7cAlpha' && ch.to === 'S7cBeta', `challenging names challenger + target (got from=${ch.from}, to=${ch.to})`);
      assert(ch.area === 'plaza', `challenging carries the challenger's area (got ${ch.area})`);
      console.log('PASS challenging broadcast: C saw {challenging, from: S7cAlpha, to: S7cBeta, area: plaza}');

      const inc = await cb.waitSince(0, (e) => e.type === 'challenge_incoming' && e.from === 'S7cAlpha', 10000, 'B challenge_incoming');
      const markC2 = cc.events.length;
      cb.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: false });
      const clr = await cc.waitSince(markC2, (e) => e.type === 'challenge_clear', 10000, 'C sees clear after decline');
      assert(clr.from === 'S7cAlpha', `clear names the challenger (got from=${clr.from})`);
      assert(clr.area === 'plaza', `clear carries the challenger's area while online (got ${clr.area})`);
      console.log('PASS challenge_clear on decline: C saw {challenge_clear, from: S7cAlpha, area: plaza}');
    }

    // --- (a2) Accept path: the '!' also clears when the duel starts ---
    {
      const markC = cc.events.length;
      const markB = cb.events.length;
      ca.send({ type: 'challenge', target: 'S7cBeta', stake: 5 });
      const ch = await cc.waitSince(markC, (e) => e.type === 'challenging', 10000, 'C sees challenging #2');
      assert(ch.from === 'S7cAlpha' && ch.to === 'S7cBeta', 'second challenging broadcast matches');
      const inc = await cb.waitSince(markB, (e) => e.type === 'challenge_incoming' && e.from === 'S7cAlpha', 10000, 'B challenge_incoming #2');
      const markC2 = cc.events.length;
      const markA = ca.events.length;
      cb.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      // Stage 14: acceptance joins the configuration; the '!' now
      // clears when the SECOND confirm starts the duel.
      ca.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      cb.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const clr = await cc.waitSince(markC2, (e) => e.type === 'challenge_clear', 10000, 'C sees clear after accept');
      assert(clr.from === 'S7cAlpha', 'clear after accept names the challenger');
      await ca.waitSince(markA, (e) => e.type === 'duel_start', 10000, 'A duel_start (the duel really began)');
      console.log('PASS challenge_clear on accept: marker cleared as the duel started');

      // End the duel: B leaves mid-duel -> forfeit, A is returned to
      // the plaza with duel_end. B is not needed again after this.
      cb.ws.close();
      const end = await ca.waitSince(markA, (e) => e.type === 'duel_end', 15000, 'A duel_end after B left');
      assert(end.winner === 'S7cAlpha', `A won by forfeit when B left (winner=${end.winner})`);
      console.log('PASS duel cleanup: B leaving mid-duel forfeited to A');
    }

    // --- (b1) Fresh players: act is present and null ---
    {
      const st = await freshState(cc, cc.events.length, 'plaza', 'plaza state (fresh act)');
      const eC = entryOf(st, 'S7cGamma');
      const eA = entryOf(st, 'S7cAlpha');
      assert(eC && 'act' in eC && eC.act === null, `fresh player's act is null (got ${eC && eC.act})`);
      assert(eA && eA.act === null, `idle player's act is null (got ${eA && eA.act})`);
      console.log('PASS act null: fresh + idle players show act: null in the snapshot');
    }

    // --- (b2) Fighting a goblin: the observer sees act 'fight' ---
    {
      ca.send({ type: 'travel', to: 'goblins' });
      await ca.waitSince(0, (e) => e.type === 'area' && e.area === 'goblins', 10000, 'A area goblins');
      cc.send({ type: 'travel', to: 'goblins' });
      await cc.waitSince(0, (e) => e.type === 'area' && e.area === 'goblins', 10000, 'C area goblins');
      const ns = latestNpcState(ca);
      const g = ns.npcs[0];
      ca.send({ type: 'move', x: g.x, y: g.y });
      const fightMark = ca.events.length;
      ca.send({ type: 'attack_npc', id: g.id });
      await ca.waitSince(fightMark, (e) => e.type === 'npc_fight' && e.phase === 'tick', 10000, 'goblin fight first tick');
      // The fight is running: C forces a snapshot and must see 'fight'.
      const markC = cc.events.length;
      cc.send({ type: 'move', x: 401, y: 226 });
      const st = await cc.waitSince(markC, (e) => e.type === 'state' && e.area === 'goblins' && entryOf(e, 'S7cAlpha') && entryOf(e, 'S7cAlpha').act === 'fight', 10000, 'C state: A act=fight');
      assert(entryOf(st, 'S7cAlpha').act === 'fight', 'observer snapshot shows the fighter as act: fight');
      console.log('PASS act fight: observer sees act: \'fight\' while A fights a goblin');
      ca.send({ type: 'flee' });
      const endF = await ca.waitSince(fightMark, (e) => e.type === 'npc_fight' && e.phase === 'end', 10000, 'goblin fight end');
      assert(endF.reason === 'fled', `flee ended the fight (reason=${endF.reason})`);
      console.log('PASS flee: fight ended cleanly after the act check');
    }

    // --- (b3) A successful gather stamps act with the skill ---
    let gatherDoneAt = 0;
    {
      ca.send({ type: 'travel', to: 'gathering' });
      await ca.waitSince(0, (e) => e.type === 'area' && e.area === 'gathering', 10000, 'A area gathering');
      cc.send({ type: 'travel', to: 'gathering' });
      await cc.waitSince(0, (e) => e.type === 'area' && e.area === 'gathering', 10000, 'C area gathering');
      const nodesMsg = await ca.waitSince(0, (e) => e.type === 'nodes' && e.area === 'gathering', 10000, 'gathering nodes');
      const copper = nodesMsg.nodes.find((n) => n.id === 'copper_rock');
      assert(copper && copper.skill === 'mining' && copper.levelReq === 1, 'copper_rock is a level-1 mining node');
      await gatherUntil(ca, copper);
      gatherDoneAt = Date.now();
      const markC = cc.events.length;
      cc.send({ type: 'move', x: 401, y: 226 });
      const st = await cc.waitSince(markC, (e) => e.type === 'state' && e.area === 'gathering' && entryOf(e, 'S7cAlpha') && entryOf(e, 'S7cAlpha').act === 'mining', 10000, 'C state: A act=mining');
      assert(entryOf(st, 'S7cAlpha').act === 'mining', 'observer snapshot shows the gatherer as act: mining');
      console.log('PASS act mining: observer sees act: \'mining\' right after a successful copper gather');
    }

    // --- (b4) The window lapses: ~4.5s idle and act is null again ---
    {
      const wait = 4600 - (Date.now() - gatherDoneAt);
      if (wait > 0) await sleep(wait);
      const st = await freshState(cc, cc.events.length, 'gathering', 'gathering state (act lapsed)');
      const eA = entryOf(st, 'S7cAlpha');
      assert(eA && eA.act === null, `act returns to null after the 4s window (got ${eA && eA.act})`);
      console.log('PASS act expiry: after ~4.5s idle the snapshot shows act: null again');
    }

    console.log('ALL STAGE 7C TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
