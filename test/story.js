// The Shattered Crown (2026-11-27) tests: one story across every
// area — a 📖 Story Stone read marks its chapter found, each
// chapter's activity (hooked into an existing server event)
// completes it once only with +25g and its Crown shard, the state
// persists across relogin, and the finale fires once.
//   DRIVEN by protocol: the stone read (+ unfound text hidden),
//   the plaza chapter (sign_read), a duel win (duel_bowl), a
//   Goblin Camp kill (goblins), a Training Grounds kill
//   (training_grounds), persistence across relogin, and the
//   finale (14 chapters seeded in the DB across a restart, the
//   15th — Frostfall gathering — driven live).
//   SOURCE-PINNED (the hook sits in the named existing handler):
//   the gather dispatch for training / gathering / cove / mine /
//   winter, smelt (mine's other road), rc_craft (magic), the
//   Barrows chest, spawnFcWave wave>=5 (fightcaves), the wild
//   pair death credit (wilderness), storyNpcKill on BOTH NPC kill
//   paths, and the client's stone / panel wiring.
// Same harness style as test/sign.js + test/traininggrounds.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18291;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-story.json');
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;
const CHAPTER_IDS = ['plaza', 'duel_bowl', 'goblins', 'training', 'training_grounds', 'gathering', 'cove', 'mine', 'magic', 'range', 'castle', 'barrows', 'fightcaves', 'wilderness', 'winter'];

function assert(cond, label) {
  if (!cond) throw new Error('ASSERT FAILED: ' + label);
  console.log('PASS ' + label);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
async function startServer() {
  serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, BOT_PVM_OFF: '1', BOT_CITY_OFF: '1' },
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
  await sleep(400);
  await new Promise((resolve) => { p.once('exit', resolve); p.kill('SIGTERM'); setTimeout(resolve, 5000); });
  await sleep(300);
}
function readDb() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
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
  waitSince(mark, pred, timeoutMs = 15000, label = 'event') {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (let i = mark; i < this.events.length; i++) {
          if (pred(this.events[i])) { clearInterval(iv); resolve({ e: this.events[i], idx: i }); return; }
        }
        if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(`${this.name}: timeout waiting for ${label}`)); }
      }, 40);
    });
  }
  waitFor(pred, timeoutMs = 15000, label = 'event') { return this.waitSince(0, pred, timeoutMs, label).then((r) => r.e); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
const PW = (n) => 'story-pass-' + n;
async function register(name) {
  const d = await api('/api/register', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function login(name) {
  const d = await api('/api/login', { username: name, password: PW(name) });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
function prof(c) {
  for (let i = c.events.length - 1; i >= 0; i--) {
    const e = c.events[i];
    if ((e.type === 'profile' || e.type === 'welcome' || (e.type === 'npc_fight' && e.phase === 'end') || e.type === 'duel_end') && e.profile) return e.profile;
  }
  return null;
}
function qty(profile, item) {
  if (!profile) return 0;
  return (profile.backpack || []).filter((s) => s.item === item).reduce((t, s) => t + s.qty, 0)
    + (profile.bank || []).filter((s) => s.item === item).reduce((t, s) => t + s.qty, 0);
}
function latestPos(client, username) {
  const st = [...client.events].reverse().find((e) => e.type === 'state' && Array.isArray(e.players));
  if (!st) return null;
  const p = st.players.find((x) => x.username === username);
  return p ? { x: p.x, y: p.y } : null;
}
async function walkTo(c, x, y, steps = 14) {
  const from = latestPos(c, c.name) || { x: 800, y: 450 };
  for (let i = 1; i <= steps; i++) {
    c.send({ type: 'move', x: Math.round(from.x + (x - from.x) * (i / steps)), y: Math.round(from.y + (y - from.y) * (i / steps)) });
    await sleep(70);
  }
  await sleep(250);
}
async function travelTo(c, to) {
  const m = c.mark();
  c.send({ type: 'travel', to });
  const a = await c.waitSince(m, (e) => e.type === 'area' && e.area === to, 10000, 'area ' + to);
  return a.e.area;
}
function roster(c, area) {
  const st = [...c.events].reverse().find((e) => e.type === 'npc_state' && e.area === area);
  return st ? (st.npcs || []) : [];
}
async function fightToEnd(c, target, timeoutMs = 150000) {
  await walkTo(c, target.x, target.y);
  const mF = c.mark();
  c.send({ type: 'attack_npc', id: target.id });
  await c.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'start', 8000, 'fight start');
  const end = await c.waitSince(mF, (e) => e.type === 'npc_fight' && e.phase === 'end', timeoutMs, 'fight end');
  return end.e;
}

async function main() {
  // ---------- Source pins first — cheap, fail fast ----------
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/const STORY_CHAPTERS = \[/.test(src), 'server pin: STORY_CHAPTERS table exists');
  for (const id of CHAPTER_IDS) assert(new RegExp(`id: '${id}', areaName:`).test(src), `server pin: chapter '${id}' defined`);
  assert((src.match(/completeStoryChapter\(key, 'plaza'\)/g) || []).length === 1 && /m\.type === 'sign_read'/.test(src), 'server pin: plaza chapter hooked in the sign_read handler');
  assert(/completeStoryChapter\(winnerKey, 'duel_bowl'\)/.test(src), 'server pin: duel win hooked in endDuel');
  assert(/storyNpcKill\(fight\.playerKey, npc\)/.test(src), 'server pin: storyNpcKill on the npcTick kill path');
  assert(/storyNpcKill\(key, npc\)/.test(src), 'server pin: storyNpcKill on the cast kill path');
  assert(/if \(node\.area === 'training'\) completeStoryChapter\(key, 'training'\)/.test(src), 'server pin: gather dispatch — training dummy (Training Cave)');
  assert(/node\.area === 'gathering' && node\.item\) completeStoryChapter\(key, 'gathering'\)/.test(src), 'server pin: gather dispatch — Gathering Cave');
  assert(/node\.area === 'cove' && node\.skill === 'fishing'\) completeStoryChapter\(key, 'cove'\)/.test(src), 'server pin: gather dispatch — cove fishing');
  assert(/node\.area === 'mine' && node\.skill === 'mining'\) completeStoryChapter\(key, 'mine'\)/.test(src), 'server pin: gather dispatch — Emberfall mining');
  assert(/node\.area === 'winter' && node\.item\) completeStoryChapter\(key, 'winter'\)/.test(src), 'server pin: gather dispatch — Frostfall nodes');
  assert(/completeStoryChapter\(key, 'mine'\); \/\/ The Shattered Crown: smelting/.test(src), 'server pin: smelt completes the mine chapter too');
  assert(/completeStoryChapter\(key, 'magic'\); \/\/ The Shattered Crown: a rune crafted/.test(src), 'server pin: rc_craft completes the magic chapter');
  assert(/completeStoryChapter\(key, 'barrows'\); \/\/ The Shattered Crown: the chest is opened/.test(src), 'server pin: Barrows chest completes the barrows chapter');
  assert(/if \(wave >= 5\) completeStoryChapter\(run\.playerKey, 'fightcaves'\)/.test(src), 'server pin: spawnFcWave wave>=5 completes the fightcaves chapter');
  assert(/if \(deadA && bC && bC\.isPlayer\) completeStoryChapter\(bC\.key, 'wilderness'\)/.test(src)
    && /if \(deadB && aC && aC\.isPlayer\) completeStoryChapter\(aC\.key, 'wilderness'\)/.test(src), 'server pin: wild pair death credit completes the wilderness chapter');
  assert(/byArea = \{ goblins: 'goblins', training_grounds: 'training_grounds', range: 'range', ratcave: 'castle', wilderness: 'wilderness', purewild: 'wilderness' \}/.test(src), 'server pin: storyNpcKill maps goblin/training/range/ratcave/wild areas to their chapters');
  assert(/m\.type === 'story_read'/.test(src) && /STORY_AREA_CHAPTER\[me\.area\]/.test(src), 'server pin: story_read answered from where the player stands');
  assert(/ITEMS\.restored_crown/.test(src) && /has restored the Crown of Nallystake!/.test(src), 'server pin: finale trophy + announcement text');
  assert(/const STORY_STONE_SPOTS=/.test(clientSrc) && /function buildStoryStones\(\)/.test(clientSrc), 'client pin: Story Stones built per chapter area');
  assert(/send\(\{type:'story_read'\}\)/.test(clientSrc), 'client pin: the stone tap sends story_read');
  assert(/function pStory\(\)/.test(clientSrc) && /story:'📖 The Shattered Crown'/.test(clientSrc), 'client pin: the 📖 Story dock panel exists');
  assert(/openPanel\('story'\)/.test(clientSrc), 'client pin: the Story panel is reachable from the Help panel');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh */ }
  await startServer();
  try {
    const hero = await register('StoryHero');
    const foe = await register('StoryFoe');

    // (1) The welcome story push: 15 chapters, nothing found,
    //     unfound chapters keep their text hidden.
    const wStory = hero.events.find((e) => e.type === 'story');
    assert(!!wStory, 'welcome pushes the story state');
    assert(wStory.chapters.length === 15 && wStory.doneCount === 0, 'story push: 15 chapters, 0 done');
    assert(wStory.chapters.every((c) => c.found === false && c.text === null), 'unfound chapters hide their story text');

    // (2) A stone read marks the chapter found and answers with it.
    let m = hero.mark();
    hero.send({ type: 'story_read' });
    const ch = (await hero.waitSince(m, (e) => e.type === 'story_chapter', 8000, 'story_chapter')).e;
    assert(ch.id === 'plaza' && ch.found === true && Array.isArray(ch.text) && ch.text.length >= 2, 'stone read: the plaza chapter, found, with its story text');
    const afterRead = [...hero.events].reverse().find((e) => e.type === 'story');
    assert(afterRead.chapters.find((c) => c.id === 'plaza').found === true && afterRead.chapters.find((c) => c.id === 'plaza').text !== null, 'story push after the read: plaza found, text revealed');

    // (3) The plaza activity — reading the Derek Nally sign —
    //     completes the chapter once: +25g, the shard, a toast.
    const gold0 = prof(hero).gold;
    m = hero.mark();
    hero.send({ type: 'sign_read' });
    const done1 = (await hero.waitSince(m, (e) => e.type === 'story_done' && e.id === 'plaza', 8000, 'story_done plaza')).e;
    assert(done1.reward === 25, 'plaza chapter pays the 25g reward');
    await sleep(300);
    assert(prof(hero).gold === gold0 + 25, `plaza completion: gold ${gold0} -> ${prof(hero).gold}`);
    assert(qty(prof(hero), 'crown_shard_plaza') === 1, 'plaza completion: Crown shard — the Plaza in the backpack');
    m = hero.mark();
    hero.send({ type: 'sign_read' });
    await sleep(1200);
    assert(hero.events.slice(m).filter((e) => e.type === 'story_done').length === 0, 'plaza chapter completes exactly once (second sign read pays nothing)');
    assert(prof(hero).gold === gold0 + 25, 'plaza completion: gold unchanged after the second read');

    // (4) A duel win completes the Duel Bowl chapter (duels are
    //     not area-restricted — the chapter text says so).
    const mA = hero.mark(), mB = foe.mark();
    hero.send({ type: 'challenge', target: 'StoryFoe', stake: 0, freePlay: true });
    const inc = (await foe.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'duel challenge')).e;
    foe.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
    hero.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
    foe.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
    await hero.waitSince(mA, (e) => e.type === 'duel_start', 15000, 'duel start');
    hero.send({ type: 'duel_attack' }); foe.send({ type: 'duel_attack' });
    const [endA, endB] = await Promise.all([
      hero.waitSince(mA, (e) => e.type === 'duel_end', 300000, 'duel_end hero'),
      foe.waitSince(mB, (e) => e.type === 'duel_end', 300000, 'duel_end foe'),
    ]);
    const winner = endA.e.winner;
    const wClient = winner === 'StoryHero' ? hero : foe;
    const lClient = winner === 'StoryHero' ? foe : hero;
    await wClient.waitSince(0, (e) => e.type === 'story_done' && e.id === 'duel_bowl', 8000, 'winner story_done duel_bowl');
    assert(true, `duel win: ${winner} completed the Duel Bowl chapter`);
    assert(qty(prof(wClient), 'crown_shard_duel_bowl') === 1, 'duel win: winner holds Crown shard — the Duel Bowl');
    assert(lClient.events.filter((e) => e.type === 'story_done' && e.id === 'duel_bowl').length === 0, 'duel win: the loser did not complete the chapter');

    // (5) A Goblin Camp kill completes the goblins chapter.
    let gobDone = false;
    for (let attempt = 1; attempt <= 4 && !gobDone; attempt++) {
      await travelTo(hero, 'goblins');
      await sleep(400);
      const g = roster(hero, 'goblins').find((n) => n.kind === 'goblin');
      assert(!!g, 'goblin camp roster has a goblin');
      const end = await fightToEnd(hero, g);
      if (end.reason === 'kill') gobDone = true;
    }
    assert(gobDone, 'goblin camp: the hero killed a goblin');
    await hero.waitSince(0, (e) => e.type === 'story_done' && e.id === 'goblins', 8000, 'story_done goblins');
    assert(qty(prof(hero), 'crown_shard_goblins') === 1, 'goblin kill: Crown shard — Goblin Camp in the backpack');

    // (6) A Training Grounds kill completes its chapter.
    await travelTo(hero, 'training_grounds');
    await sleep(400);
    const tg = roster(hero, 'training_grounds').find((n) => n.kind === 'training_goblin');
    assert(!!tg, 'training grounds roster has a training goblin');
    const tgEnd = await fightToEnd(hero, tg);
    assert(tgEnd.reason === 'kill', 'training grounds: the hero killed the training goblin');
    await hero.waitSince(0, (e) => e.type === 'story_done' && e.id === 'training_grounds', 8000, 'story_done training_grounds');
    assert(qty(prof(hero), 'crown_shard_training_grounds') === 1, 'training kill: Crown shard — the Training Grounds in the backpack');

    // (7) Persistence: the state survives a relogin (and is in
    //     the saved DB record).
    await sleep(600); // let save() flush
    const rec = Object.values(readDb().users).find((u) => u.profile && u.profile.username === 'StoryHero');
    assert(rec && rec.profile.story.done.plaza === true && rec.profile.story.done.goblins === true && rec.profile.story.done.training_grounds === true, 'DB record: story.done persisted for plaza/goblins/training_grounds');
    assert(rec.profile.story.found.plaza === true, 'DB record: story.found persisted');
    hero.close();
    await sleep(500);
    const hero2 = await login('StoryHero');
    const w2 = hero2.events.find((e) => e.type === 'story');
    assert(w2 && w2.doneCount >= 3 && w2.chapters.find((c) => c.id === 'goblins').done === true, 'relogin: the welcome story push carries the completed chapters');

    // (8) The finale: seed the other 14 chapters done in the DB
    //     across a restart, then drive the last one (Frostfall
    //     gathering) live. It must fire exactly once: the trophy,
    //     +250g, and the server-wide announcement.
    hero2.close(); foe.close();
    await stopServer();
    await sleep(400);
    const db = readDb();
    const rec2 = Object.values(db.users).find((u) => u.profile && u.profile.username === 'StoryHero');
    rec2.profile.story.done = {};
    for (const id of CHAPTER_IDS) if (id !== 'winter') rec2.profile.story.done[id] = true;
    rec2.profile.story.crowned = false;
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    await startServer();
    const hero3 = await login('StoryHero');
    const foe3 = await login('StoryFoe');
    const goldBefore = prof(hero3).gold;
    await travelTo(hero3, 'winter');
    await walkTo(hero3, 300, 250); // frost_pine1
    let gathered = false;
    for (let i = 0; i < 12 && !gathered; i++) {
      const gm = hero3.mark();
      hero3.send({ type: 'gather', nodeId: 'frost_pine1' });
      // An 'error' (e.g. the shared action cooldown) is just a
      // failed attempt — wait for either answer, then retry.
      const gr = await hero3.waitSince(gm, (e) => (e.type === 'gather_result' && e.nodeId === 'frost_pine1') || e.type === 'error', 8000, 'gather result');
      if (gr.e.type === 'gather_result' && gr.e.ok) gathered = true;
      else await sleep(1600); // action cooldown between attempts
    }
    assert(gathered, 'finale setup: a Frostfall gather succeeded');
    await hero3.waitSince(0, (e) => e.type === 'story_done' && e.id === 'winter', 8000, 'story_done winter');
    const ann = await foe3.waitSince(0, (e) => e.type === 'announce' && /has restored the Crown of Nallystake!/.test(e.text || ''), 8000, 'finale announcement');
    assert(/StoryHero/.test(ann.e.text), 'finale: the whole server heard "👑 StoryHero has restored the Crown of Nallystake!"');
    await sleep(400);
    assert(qty(prof(hero3), 'restored_crown') === 1, 'finale: the Restored Crown trophy is in the backpack');
    // +300 total: the winter chapter's 25, the finale's 250, and
    // the one-time "Gather a resource" starter goal's 25 — this
    // gather is the hero's first ever, so all three land together.
    assert(prof(hero3).gold === goldBefore + 25 + 250 + 25, `finale: gold ${goldBefore} -> ${prof(hero3).gold} (+25 chapter, +250 finale, +25 first-gather starter goal)`);
    // ...and never twice.
    const annCount = foe3.events.filter((e) => e.type === 'announce' && /restored the Crown/.test(e.text || '')).length;
    let gathered2 = false;
    for (let i = 0; i < 12 && !gathered2; i++) {
      const gm = hero3.mark();
      hero3.send({ type: 'gather', nodeId: 'frost_pine1' });
      const gr = await hero3.waitSince(gm, (e) => (e.type === 'gather_result' && e.nodeId === 'frost_pine1') || e.type === 'error', 8000, 'gather result 2');
      if (gr.e.type === 'gather_result' && gr.e.ok) gathered2 = true;
      else await sleep(1600);
    }
    assert(gathered2, 'finale repeat-check: a second Frostfall gather succeeded');
    await sleep(800);
    assert(foe3.events.filter((e) => e.type === 'announce' && /restored the Crown/.test(e.text || '')).length === annCount, 'finale fires exactly once (no second announcement)');
    assert(qty(prof(hero3), 'restored_crown') === 1, 'finale fires exactly once (still one Restored Crown)');
    hero3.close(); foe3.close();
  } finally {
    await stopServer();
  }
  console.log('\nSTORY SUITE OK');
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
