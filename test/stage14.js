// Stage 14 tests: the duel challenge configuration screen — Derek's
// reference photo as ONE sheet both duelists edit until BOTH
// confirm. Rules (No Prayer / No Potions / No Food / No Special
// Attacks) ride the challenge, reset both confirms on any terms
// change, and are enforced server-side during the duel.
//   (a) full flow: challenge with noFood+noSpecial, item stakes on
//       both sides (the target's arrives inside its confirm — which
//       resets the challenger's confirm, per the change rule), both
//       confirm, duel starts, escrow settles exactly as before.
//   (b) a terms change after one confirm resets BOTH confirms; the
//       duel cannot start until both re-confirm.
//   (c) enforcement: in an all-rules duel, food / potions (incl.
//       prayer potions) / special / prayer activation are all
//       rejected with the 🚫 lines and nothing is consumed.
//   (d) a no-rules duel behaves exactly as before: prayer, special,
//       food and potions all work.
//   (e) cancel and decline end the configuration cleanly with no
//       escrow taken.
// Same harness style as test/stage12.js.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18097;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage14.json');
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
  await sleep(400);
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
  profile() {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].profile) return this.events[i].profile;
    return null;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
async function register(name, password) {
  const d = await api('/api/register', { username: name, password });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome');
  return c;
}
async function login(name, password) {
  const d = await api('/api/login', { username: name, password });
  const c = new Client(name);
  await c.connect(d.token);
  await c.waitFor((e) => e.type === 'welcome', 10000, 'welcome (login)');
  return c;
}
const qty = (profile, item) => {
  const s = (profile.backpack || []).find((x) => x.item === item);
  return s ? s.qty : 0;
};
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  const e = (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
  return e;
}

const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
const PW = (n) => 's14-pass-' + n;

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/function cleanDuelRules/.test(src), 'source: cleanDuelRules exists');
  assert(/challenge_confirm/.test(src) && /challenge_update/.test(src) && /challenge_cancel/.test(src), 'source: challenge_update / challenge_confirm / challenge_cancel handlers exist');

  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  await startServer();
  const clients = [];
  try {
    for (const n of ['S14Ann', 'S14Bob', 'S14Cid', 'S14Dee', 'S14Eli', 'S14Fay', 'S14Gil', 'S14Hal']) {
      const c = await register(n, PW(n));
      clients.push(c); c.close();
    }
    await stopServer();
    seedDb((data) => {
      const P = (n) => data.users[n.toLowerCase()].profile;
      // Stage 16 (flagged seed fix): seeded backpacks keep each
      // player's 100 starter coins AS their gold stack — gold is
      // an item now, and stake validation reads the stacks
      // (goldTotal), not the old pouch number these seeds left at
      // 100 while wiping the stack.
      P('S14Ann').backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }];
      P('S14Bob').backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }];
      for (const n of ['S14Cid', 'S14Dee', 'S14Eli', 'S14Fay']) {
        const p = P(n);
        p.worn = { ...STEEL };
        p.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 3 }, { item: 'restore_potion', qty: 3 }, { item: 'prayer_potion', qty: 2 }];
        p.specialEnergy = 100;
      }
      P('S14Eli').prayerPoints = 0;
    });
    await startServer();

    // ---------- (a) full flow with rules + item stakes ----------
    let Ann = await login('S14Ann', PW('S14Ann')); clients.push(Ann);
    let Bob = await login('S14Bob', PW('S14Bob')); clients.push(Bob);
    {
      const mB = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S14Bob', stake: 10, items: [{ item: 'ration', qty: 1 }], rules: { noFood: true, noSpecial: true } });
      const inc = (await Bob.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (a)')).e;
      assert(inc.rules && inc.rules.noFood === true && inc.rules.noSpecial === true && inc.rules.noPrayer === false, '(a) challenge_incoming carries the offered rules');
      const terms0 = (await Bob.waitSince(mB, (e) => e.type === 'challenge_terms', 10000, 'challenge_terms (a)')).e;
      assert(terms0.stake === 10 && terms0.items.length === 1 && terms0.confirm.from === false && terms0.confirm.to === false, '(a) both screens open on the shared terms');
      // Target joins with no items yet; challenger confirms.
      Bob.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Ann.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const tA = (await Bob.waitSince(mB, (e) => e.type === 'challenge_terms' && e.confirm.from === true, 10000, 'terms: challenger confirmed')).e;
      assert(tA.confirm.to === false, '(a) one confirm is not enough — no duel yet');
      // The target's confirm CARRIES its item stake: a terms change,
      // so the challenger's confirm resets and must be given again.
      Bob.send({ type: 'challenge_confirm', challengeId: inc.challengeId, items: [{ item: 'ration', qty: 1 }] });
      const tB = (await Ann.waitSince(0, (e) => e.type === 'challenge_terms' && e.confirm.to === true, 10000, 'terms: target confirmed with items')).e;
      assert(tB.confirm.from === false && tB.itemsTo.length === 1 && tB.itemsTo[0].item === 'ration', '(a) items inside a confirm update the terms and reset the other confirm');
      Ann.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startA = (await Ann.waitSince(0, (e) => e.type === 'duel_start', 10000, 'duel_start (a)')).e;
      const startB = (await Bob.waitSince(mB, (e) => e.type === 'duel_start', 10000, 'duel_start (a) target')).e;
      assert(startA.rules && startA.rules.noFood === true && startA.rules.noSpecial === true, '(a) duel_start carries the agreed rules');
      assert(startA.profile.gold === 90 && startB.profile.gold === 90, `(a) escrow took 10g from each (A=${startA.profile.gold}, B=${startB.profile.gold})`);
      assert(startA.pot === 20, '(a) pot is the matched stakes');
      Bob.close();
      const endA = (await Ann.waitSince(0, (e) => e.type === 'duel_end', 20000, 'duel_end (a)')).e;
      // Stage 20 (flagged fix): 110g pot + the one-time +25g
      // "Win a duel" starter-goal reward on Ann's first win.
      assert(endA.winner === 'S14Ann' && endA.profile.gold === 135, `(a) winner takes the pot + starter reward (gold=${endA.profile.gold})`);
      assert(qty(endA.profile, 'ration') === 3, `(a) winner takes both staked rations (has ${qty(endA.profile, 'ration')})`);
      console.log('PASS (a) full configuration flow with rules, item stakes and escrow');
    }

    // ---------- (b) terms change resets both confirms ----------
    Bob = await login('S14Bob', PW('S14Bob')); clients.push(Bob);
    {
      const mB = Bob.mark(), mA = Ann.mark();
      Ann.send({ type: 'challenge', target: 'S14Bob', stake: 5 });
      const inc = (await Bob.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (b)')).e;
      Bob.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Ann.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      await Bob.waitSince(mB, (e) => e.type === 'challenge_terms' && e.confirm.from === true, 10000, 'terms: challenger confirmed (b)');
      Bob.send({ type: 'challenge_update', challengeId: inc.challengeId, stake: 7 });
      const tReset = (await Ann.waitSince(mA, (e) => e.type === 'challenge_terms' && e.stake === 7, 10000, 'terms: stake changed to 7')).e;
      assert(tReset.confirm.from === false && tReset.confirm.to === false, '(b) a terms change reset BOTH confirms');
      await sleep(1500);
      assert(!Ann.events.slice(mA).some((e) => e.type === 'duel_start') && !Bob.events.slice(mB).some((e) => e.type === 'duel_start'), '(b) no duel started on a single confirm');
      Ann.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Bob.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startA = (await Ann.waitSince(mA, (e) => e.type === 'duel_start', 10000, 'duel_start (b)')).e;
      assert(startA.stake === 7 && startA.pot === 14, '(b) duel started on the changed terms after both re-confirmed');
      Bob.close();
      await Ann.waitSince(mA, (e) => e.type === 'duel_end', 20000, 'duel_end (b)');
      console.log('PASS (b) terms change resets both confirms; re-confirm starts the duel');
    }

    // ---------- (e) cancel + decline take nothing ----------
    Bob = await login('S14Bob', PW('S14Bob')); clients.push(Bob);
    {
      const goldA0 = (await api('/api/login', { username: 'S14Ann', password: PW('S14Ann') })).profile.gold;
      const goldB0 = (await api('/api/login', { username: 'S14Bob', password: PW('S14Bob') })).profile.gold;
      const mB = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S14Bob', stake: 25 });
      const inc = (await Bob.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (e)')).e;
      Ann.send({ type: 'challenge_cancel', challengeId: inc.challengeId });
      await Bob.waitSince(mB, (e) => e.type === 'challenge_closed', 10000, 'challenge_closed on cancel');
      const mB2 = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S14Bob', stake: 25 });
      const inc2 = (await Bob.waitSince(mB2, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (e2)')).e;
      const mA = Ann.mark();
      Bob.send({ type: 'challenge_response', challengeId: inc2.challengeId, accept: false });
      await Ann.waitSince(mA, (e) => e.type === 'challenge_closed', 10000, 'challenge_closed on decline');
      const goldA1 = (await api('/api/login', { username: 'S14Ann', password: PW('S14Ann') })).profile.gold;
      const goldB1 = (await api('/api/login', { username: 'S14Bob', password: PW('S14Bob') })).profile.gold;
      assert(goldA1 === goldA0 && goldB1 === goldB0, `(e) cancel + decline took no escrow (A ${goldA0}->${goldA1}, B ${goldB0}->${goldB1})`);
      console.log('PASS (e) cancel and decline are clean, no escrow');
    }

    // ---------- (c) all-rules duel: everything rejected ----------
    const Cid = await login('S14Cid', PW('S14Cid')); clients.push(Cid);
    const Dee = await login('S14Dee', PW('S14Dee')); clients.push(Dee);
    {
      const mD = Dee.mark();
      Cid.send({ type: 'challenge', target: 'S14Dee', stake: 1, rules: { noPrayer: true, noPotions: true, noFood: true, noSpecial: true } });
      const inc = (await Dee.waitSince(mD, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (c)')).e;
      Dee.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Cid.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Dee.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startC = (await Cid.waitSince(0, (e) => e.type === 'duel_start', 10000, 'duel_start (c)')).e;
      const R = startC.rules || {};
      assert(R.noPrayer && R.noPotions && R.noFood && R.noSpecial, '(c) duel_start carries all four rules');
      let err = await expectError(Cid, { type: 'prayer', prayer: 'melee' }, 'prayer rejection');
      assert(err.message === '🚫 No Prayer in this duel.', `(c) prayer activation rejected ("${err.message}")`);
      const mP = Cid.mark();
      Cid.send({ type: 'prayer', prayer: null });
      const prof = (await Cid.waitSince(mP, (e) => e.profile, 10000, 'profile after prayer-off')).e;
      assert(prof.profile.activePrayer === null, '(c) no prayer is active in a No Prayer duel');
      err = await expectError(Cid, { type: 'use', item: 'ration' }, 'food rejection');
      assert(err.message === '🚫 No Food in this duel.', `(c) food rejected ("${err.message}")`);
      err = await expectError(Cid, { type: 'use', item: 'restore_potion' }, 'potion rejection');
      assert(err.message === '🚫 No Potions in this duel.', `(c) restore potion rejected ("${err.message}")`);
      err = await expectError(Cid, { type: 'use', item: 'prayer_potion' }, 'prayer potion rejection');
      assert(err.message === '🚫 No Potions in this duel.', `(c) prayer potion rejected as a potion ("${err.message}")`);
      err = await expectError(Cid, { type: 'special' }, 'special rejection');
      assert(err.message === '🚫 No Special Attacks in this duel.', `(c) special rejected ("${err.message}")`);
      // Fight a few ticks: no "used ..." heal note may ever appear.
      const mFight = Cid.mark();
      Cid.send({ type: 'duel_attack' }); Dee.send({ type: 'duel_attack' });
      await sleep(7000);
      const usedNotes = Cid.events.slice(mFight).filter((e) => e.note && /used .+ \(\+\d+ HP\)/.test(e.note));
      assert(usedNotes.length === 0, '(c) no consumable ever fired during the rules duel');
      Dee.close();
      const endC = (await Cid.waitSince(0, (e) => e.type === 'duel_end', 20000, 'duel_end (c)')).e;
      assert(qty(endC.profile, 'ration') === 3 && qty(endC.profile, 'restore_potion') === 3 && qty(endC.profile, 'prayer_potion') === 2,
        `(c) nothing was consumed (ration=${qty(endC.profile, 'ration')}, restore=${qty(endC.profile, 'restore_potion')}, prayer=${qty(endC.profile, 'prayer_potion')})`);
      console.log('PASS (c) all four rules enforced server-side');
    }

    // ---------- (d) no-rules duel: everything works as before ----
    const Eli = await login('S14Eli', PW('S14Eli')); clients.push(Eli);
    const Fay = await login('S14Fay', PW('S14Fay')); clients.push(Fay);
    {
      // A potion outside the duel first (prayer points seeded to 0).
      const mPre = Eli.mark();
      Eli.send({ type: 'use', item: 'prayer_potion' });
      const preProf = (await Eli.waitSince(mPre, (e) => e.profile && e.profile.prayerPoints > 0, 10000, 'prayer potion works')).e;
      assert(preProf.profile.prayerPoints > 0, '(d) prayer potion restores points (no rules anywhere near)');
      const mF = Fay.mark();
      Eli.send({ type: 'challenge', target: 'S14Fay', stake: 1 });
      const inc = (await Fay.waitSince(mF, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming (d)')).e;
      assert(!inc.rules || (!inc.rules.noPrayer && !inc.rules.noPotions && !inc.rules.noFood && !inc.rules.noSpecial), '(d) a plain challenge carries no rules');
      Fay.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      Eli.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      Fay.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      const startE = (await Eli.waitSince(0, (e) => e.type === 'duel_start', 10000, 'duel_start (d)')).e;
      assert(startE.rules && !startE.rules.noPrayer && !startE.rules.noPotions && !startE.rules.noFood && !startE.rules.noSpecial, '(d) duel_start rules are all off');
      const mPray = Eli.mark();
      Eli.send({ type: 'prayer', prayer: 'melee' });
      const prayProf = (await Eli.waitSince(mPray, (e) => e.profile && e.profile.activePrayer === 'melee', 10000, 'prayer activates')).e;
      assert(prayProf.profile.activePrayer === 'melee', '(d) prayer activation works in a no-rules duel');
      Eli.send({ type: 'prayer', prayer: 'melee' }); // toggle back off
      const mSpec = Eli.mark();
      Eli.send({ type: 'special' });
      await Eli.waitSince(mSpec, (e) => e.type === 'chat' && /Dragon Slash queued/.test(e.text || ''), 10000, 'special queues');
      Eli.send({ type: 'duel_attack' }); Fay.send({ type: 'duel_attack' });
      await Eli.waitSince(mSpec, (e) => e.type === 'duel_tick' && e.youSpecial === true, 120000, 'special fires');
      assert(true, '(d) Dragon Slash fires in a no-rules duel');
      // Food: wait until hurt, then eat — the heal note must appear.
      const mEat = Eli.mark();
      await Eli.waitSince(mEat, (e) => e.type === 'duel_tick' && typeof e.hpYou === 'number' && e.hpYou < 99, 120000, 'Eli takes damage');
      Eli.send({ type: 'use', item: 'ration' });
      await Eli.waitSince(mEat, (e) => e.type === 'duel_tick' && e.note && /used Cooked ration \(\+15 HP\)/.test(e.note), 30000, 'food heal note');
      assert(true, '(d) food heals in a no-rules duel');
      const mPot = Eli.mark();
      await Eli.waitSince(mPot, (e) => e.type === 'duel_tick' && typeof e.hpYou === 'number' && e.hpYou < 99, 120000, 'Eli takes damage again');
      Eli.send({ type: 'use', item: 'restore_potion' });
      await Eli.waitSince(mPot, (e) => e.type === 'duel_tick' && e.note && /used Restore potion \(\+30 HP\)/.test(e.note), 30000, 'potion heal note');
      assert(true, '(d) potions heal in a no-rules duel');
      Fay.close();
      await Eli.waitSince(0, (e) => e.type === 'duel_end', 20000, 'duel_end (d)');
      console.log('PASS (d) no-rules duel behaves exactly as before');
    }

    console.log('ALL STAGE 14 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
