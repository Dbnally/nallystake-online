// Stage 16 tests: GOLD IS AN ITEM. A player's money is a `gold`
// stack in the backpack and/or the bank; profile.gold is only a
// synced mirror of the stack total (goldTotal). Every gold
// mutation routes through addGold / takeGold on the server.
//   (a) migration: a legacy profile (gold number 250, no stacks,
//       no goldV) boots into a 250-coin backpack stack, mirror
//       250; a restart changes nothing (no duplication).
//   (b) a new account starts with a 100-coin backpack stack.
//   (c) earning/spending: a goblin kill's gold drop grows the
//       stack; a shop sale grows it; a shop buy shrinks it
//       (takeGold); an unaffordable buy is refused, stack intact.
//   (d) staking: challenge validation reads the TOTAL (backpack +
//       bank) — a stake above the backpack stack but within the
//       total is allowed; escrow draws from the stacks and the
//       winner's stack grows by the whole pot.
//   (e) full backpack: (i) migration with 28 full stacks puts the
//       coins in the bank; (ii) earning with no stack anywhere and
//       a full pack lands in the bank (addGold fallback); (iii)
//       takeGold spends across backpack + bank stacks.
//   (f) refusals: the gold item can't be sold to a shop, can't be
//       sold on the Exchange, and can't be staked as an item
//       (create + update paths) — GOLD_STAKE_MSG.
//   (g) drop/pickup: dropped coins form a pile; another player
//       picking it up gains exactly that many coins.
// Same harness style as test/stage15.js.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18116;
const DB_FILE = path.join(os.tmpdir(), 'nally-test-stage16.json');
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
const PW = (n) => 's16-pass-' + n;
async function prof(name) { return (await api('/api/login', { username: name, password: PW(name) })).profile; }
const packGold = (p) => { const s = (p.backpack || []).find((x) => x.item === 'gold'); return s ? s.qty : 0; };
const bankGold = (p) => { const s = (p.bank || []).find((x) => x.item === 'gold'); return s ? s.qty : 0; };
const totalGold = (p) => packGold(p) + bankGold(p);
function assertMoney(p, total, label) {
  assert(totalGold(p) === total, `${label}: coin stacks total ${total} (backpack ${packGold(p)} + bank ${bankGold(p)})`);
  assert(p.gold === total, `${label}: mirror profile.gold === ${total} (got ${p.gold})`);
}
async function expectError(c, msg, label) {
  const m = c.mark();
  c.send(msg);
  return (await c.waitSince(m, (x) => x.type === 'error', 10000, label)).e;
}
function latestNpcState(client) {
  for (let i = client.events.length - 1; i >= 0; i--) if (client.events[i].type === 'npc_state') return client.events[i];
  return null;
}
// Walk onto a live goblin and fight it to the end (Stage 1 pattern).
async function fightGoblin(client, label) {
  const ns = latestNpcState(client);
  const g = ns && ns.npcs.find((n) => n.hp > 0);
  assert(g, `${label}: a live goblin is listed in npc_state`);
  client.send({ type: 'move', x: g.x, y: g.y });
  const startIdx = client.events.length;
  client.send({ type: 'attack_npc', id: g.id });
  const end = (await client.waitSince(startIdx, (e) => e.type === 'npc_fight' && e.phase === 'end', 90000, label + ' npc_fight end')).e;
  return end;
}

const STEEL = { weapon: 'steel_sword', shield: null, head: null, body: null, legs: null, cape: null, amulet: null, hands: null, feet: null, ring: null };
// 28 distinct non-gold stacks — a completely full backpack.
const FULL_PACK = ['restore_potion', 'prayer_potion', 'ration', 'bronze_sword', 'iron_sword', 'steel_sword', 'mithril_sword', 'dragon_sword',
  'bronze_helm', 'steel_helm', 'dragon_helm', 'bronze_platebody', 'steel_platebody', 'dragon_platebody', 'bronze_platelegs', 'steel_platelegs',
  'dragon_platelegs', 'bronze_shield', 'steel_shield', 'dragon_shield', 'bones', 'herbs', 'gems', 'bars', 'runes', 'charms', 'copper_ore', 'tin_ore']
  .map((item) => ({ item, qty: 2 }));

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/ITEMS\.gold = /.test(src) && /function addGold/.test(src) && /function takeGold/.test(src) && /function goldTotal/.test(src), 'source: gold item + helpers exist in server.js');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert(/goldPileHTML/.test(clientSrc), 'source: client renders the coin pile');
  assert(!/hudgold/.test(clientSrc), 'source: the top gold pouch counter is gone from the client');

  // ---------- (a) migration: seed a legacy profile BEFORE first boot ----------
  try { fs.unlinkSync(DB_FILE); } catch { /* fresh run */ }
  {
    const salt = crypto.randomBytes(16).toString('hex');
    const passHash = crypto.scryptSync(PW('S16Legacy'), salt, 32).toString('hex');
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: {
        s16legacy: { salt, passHash, profile: { username: 'S16Legacy', gold: 250, rating: 1000, wins: 0, losses: 0, style: 'accurate', createdAt: new Date().toISOString() } },
      },
    }));
  }
  await startServer();
  const clients = [];
  try {
    {
      const p = await prof('S16Legacy');
      assert(packGold(p) === 250 && bankGold(p) === 0, `(a) legacy 250g became a 250-coin backpack stack (backpack ${packGold(p)}, bank ${bankGold(p)})`);
      assertMoney(p, 250, '(a) migrated profile');
      await sleep(600); // let the FileStore flush land
      const saved = readDb().users.s16legacy.profile;
      assert(saved.goldV === 2, '(a) goldV 2 was saved by the boot sweep');
      assert((saved.backpack || []).filter((s) => s.item === 'gold').length === 1 && packGold(saved) === 250, '(a) saved profile holds exactly one 250 gold stack');
      console.log('PASS (a) migration: legacy pouch number -> coin stack, saved with goldV 2');
    }
    await stopServer();
    await startServer();
    {
      const p = await prof('S16Legacy');
      assert((p.backpack || []).filter((s) => s.item === 'gold').length === 1, '(a) restart: still exactly one gold stack (no duplication)');
      assertMoney(p, 250, '(a) after restart');
      console.log('PASS (a) migration is idempotent across a restart');
    }

    // ---------- (b) new account starter stack ----------
    {
      const d = await api('/api/register', { username: 'S16New', password: PW('S16New') });
      const p = d.profile;
      assert(p.backpack.length === 1 && p.backpack[0].item === 'gold' && p.backpack[0].qty === 100, `(b) new account backpack is a single 100-coin stack (got ${JSON.stringify(p.backpack)})`);
      assertMoney(p, 100, '(b) new account');
      console.log('PASS (b) new account starts with a 100-coin stack');
    }

    // ---------- (c) earning + spending move the stack ----------
    const Earner = await register('S16Earner', PW('S16Earner')); clients.push(Earner);
    {
      Earner.send({ type: 'travel', to: 'goblins' });
      await Earner.waitFor((e) => e.type === 'area' && e.area === 'goblins', 10000, 'earner area');
      const end = await fightGoblin(Earner, '(c)');
      assert(end.reason === 'kill', `(c) goblin died (reason=${end.reason})`);
      const drop = end.drops && end.drops.gold;
      assert(drop >= 2 && drop <= 8, `(c) goblin dropped ${drop}g (2-8)`);
      let p = await prof('S16Earner');
      // Stage 20 (flagged fix): +50 more — the one-time starter-goal
      // rewards for the trip to the camp (visit_area) and the first
      // kill (kill_monster), 25g each, ride the same coin stack.
      assertMoney(p, 100 + drop + 50, `(c) after goblin kill (+${drop}g drop + 50g starter rewards)`);
      // Shop buy: a ration costs 8 — paid from the stack.
      let m = Earner.mark();
      Earner.send({ type: 'shop_buy', item: 'ration', qty: 1 });
      await Earner.waitSince(m, (e) => e.type === 'shop' && e.action === 'buy', 10000, 'shop buy (c)');
      p = await prof('S16Earner');
      assertMoney(p, 100 + drop + 50 - 8, '(c) after buying a ration (-8g)'); // Stage 20: +50 starter rewards, as above
      // Shop sale: the ration sells back at 4 — lands on the stack.
      m = Earner.mark();
      Earner.send({ type: 'shop_sell', item: 'ration', qty: 1 });
      await Earner.waitSince(m, (e) => e.type === 'shop' && e.action === 'sell', 10000, 'shop sell (c)');
      p = await prof('S16Earner');
      assertMoney(p, 100 + drop + 50 - 8 + 4, '(c) after selling the ration back (+4g)'); // Stage 20: +50 starter rewards, as above
      // Insufficient total refuses and moves nothing.
      const err = await expectError(Earner, { type: 'shop_buy', item: 'dragon_sword', qty: 1 }, 'unaffordable buy (c)');
      assert(/Not enough gold/.test(err.message), `(c) unaffordable buy refused ("${err.message}")`);
      p = await prof('S16Earner');
      assertMoney(p, 100 + drop + 50 - 8 + 4, '(c) after the refused buy'); // Stage 20: +50 starter rewards, as above
      console.log('PASS (c) goblin drop / shop buy / shop sell all move the coin stack');
    }

    // ---------- (f) refusals (uses S16New's fresh stack) ----------
    const New = await login('S16New', PW('S16New')); clients.push(New);
    {
      const err1 = await expectError(New, { type: 'shop_sell', item: 'gold', qty: 1 }, 'shop_sell gold (f)');
      assert(err1.message === "That can't be sold.", `(f) shops refuse to buy gold ("${err1.message}")`);
      const err2 = await expectError(New, { type: 'exchange_sell', good: 'gold', qty: 1 }, 'exchange_sell gold (f)');
      assert(err2.message === "That can't be sold.", `(f) the Exchange refuses gold ("${err2.message}")`);
      const err3 = await expectError(New, { type: 'exchange_buy', good: 'gold', qty: 1 }, 'exchange_buy gold (f)');
      assert(err3.message === "That can't be sold.", `(f) the Exchange never sells gold either ("${err3.message}")`);
      assertMoney(await prof('S16New'), 100, '(f) after the refusals');
      console.log('PASS (f) gold refuses shop sale and the Exchange');
    }

    // ---------- (g) drop / pickup of a coin pile ----------
    {
      const mN = New.mark();
      New.send({ type: 'drop', item: 'gold', qty: 40 });
      const after = (await New.waitSince(mN, (e) => e.type === 'profile', 10000, 'profile after drop (g)')).e.profile;
      assert(after && packGold(after) === 60, `(g) dropping 40 coins leaves a 60 stack (got ${after && packGold(after)})`);
      assertMoney(await prof('S16New'), 60, '(g) dropper after the drop');
      const pileMsg = await New.waitFor((e) => e.type === 'piles' && (e.piles || []).some((x) => x.item === 'gold' && x.qty === 40), 10000, 'gold pile broadcast (g)');
      const pile = pileMsg.piles.find((x) => x.item === 'gold' && x.qty === 40);
      // The Earner walks over and picks the pile up.
      Earner.send({ type: 'travel', to: 'plaza' });
      await Earner.waitFor((e) => e.type === 'area' && e.area === 'plaza', 10000, 'earner back in plaza (g)');
      const before = await prof('S16Earner');
      Earner.send({ type: 'move', x: pile.x, y: pile.y });
      await sleep(300);
      const mE = Earner.mark();
      Earner.send({ type: 'pickup', pileId: pile.id });
      await Earner.waitSince(mE, (e) => e.type === 'profile', 10000, 'profile after pickup (g)');
      const pAfter = await prof('S16Earner');
      assertMoney(pAfter, totalGold(before) + 40, '(g) picker gained exactly the 40 dropped coins');
      assertMoney(await prof('S16New'), 60, '(g) dropper unchanged by the pickup');
      console.log('PASS (g) dropped coins form a pile and pick up whole');
    }

    // ---------- seed the duelists + full-pack users, restart ----------
    for (const n of ['S16Ann', 'S16Bob']) { const c = await register(n, PW(n)); clients.push(c); c.close(); }
    for (const n of ['S16FullA', 'S16FullB', 'S16FullC']) { const c = await register(n, PW(n)); clients.push(c); c.close(); }
    await stopServer();
    seedDb((data) => {
      const P = (n) => data.users[n.toLowerCase()].profile;
      // Duelists: steel swords; Ann's coins all in her backpack,
      // Bob's split 40 backpack / 60 bank (total still 100).
      const ann = P('S16Ann'); ann.worn = { ...STEEL }; ann.backpack = [{ item: 'gold', qty: 100 }, { item: 'ration', qty: 2 }]; ann.gold = 100; ann.goldV = 2;
      const bob = P('S16Bob'); bob.worn = { ...STEEL }; bob.backpack = [{ item: 'gold', qty: 40 }, { item: 'ration', qty: 2 }]; bob.bank = [{ item: 'gold', qty: 60 }]; bob.gold = 100; bob.goldV = 2;
      // (e)(i): legacy-shaped, 28 full stacks, 75 loose gold, no
      // goldV — migration must bank the coins (no backpack room).
      const fa = P('S16FullA'); fa.backpack = FULL_PACK.map((s) => ({ ...s })); fa.bank = []; fa.gold = 75; delete fa.goldV;
      // (e)(ii): already migrated, zero gold, full pack, no stacks —
      // earning must open a BANK stack via the addGold fallback.
      const fb = P('S16FullB'); fb.backpack = FULL_PACK.map((s) => ({ ...s })); fb.bank = []; fb.gold = 0; fb.goldV = 2;
      // (e)(iii): coins split 30 backpack / 50 bank — a 50g buy
      // must drain the backpack stack and take 20 from the bank.
      const fc = P('S16FullC'); fc.backpack = [{ item: 'gold', qty: 30 }, { item: 'ration', qty: 2 }]; fc.bank = [{ item: 'gold', qty: 50 }]; fc.gold = 80; fc.goldV = 2;
    });
    await startServer();

    // ---------- (e) full backpack behaviour ----------
    {
      const pa = await prof('S16FullA');
      assert(pa.backpack.length === 28 && packGold(pa) === 0, '(e)(i) full pack holds no gold stack');
      assert(bankGold(pa) === 75, `(e)(i) migration banked the 75 coins (bank ${bankGold(pa)})`);
      assertMoney(pa, 75, '(e)(i) migrated full-pack profile');

      const FullB = await login('S16FullB', PW('S16FullB')); clients.push(FullB);
      const mB = FullB.mark();
      FullB.send({ type: 'shop_sell', item: 'ration', qty: 1 }); // +4g, pack still 28 stacks
      await FullB.waitSince(mB, (e) => e.type === 'shop' && e.action === 'sell', 10000, 'full-pack sale (e)(ii)');
      const pb = await prof('S16FullB');
      assert(pb.backpack.length === 28 && packGold(pb) === 0, '(e)(ii) pack still full, still no backpack gold stack');
      assert(bankGold(pb) === 4, `(e)(ii) the 4g sale landed in the bank (bank ${bankGold(pb)})`);
      assertMoney(pb, 4, '(e)(ii) after the sale');

      const FullC = await login('S16FullC', PW('S16FullC')); clients.push(FullC);
      const mC = FullC.mark();
      FullC.send({ type: 'shop_buy', item: 'bronze_sword', qty: 1 }); // 50g: 30 backpack + 20 bank
      await FullC.waitSince(mC, (e) => e.type === 'shop' && e.action === 'buy', 10000, 'cross-stack buy (e)(iii)');
      const pc = await prof('S16FullC');
      assert(packGold(pc) === 0, `(e)(iii) backpack coin stack fully drained (got ${packGold(pc)})`);
      assert(bankGold(pc) === 30, `(e)(iii) bank stack paid the remaining 20 (bank ${bankGold(pc)})`);
      assertMoney(pc, 30, '(e)(iii) after the cross-stack buy');
      const err = await expectError(FullC, { type: 'shop_buy', item: 'dragon_sword', qty: 1 }, 'unaffordable cross-stack buy (e)(iii)');
      assert(/Not enough gold/.test(err.message), '(e)(iii) a buy above the combined total is refused');
      assertMoney(await prof('S16FullC'), 30, '(e)(iii) after the refused buy');
      console.log('PASS (e) full backpack: migration banks coins, addGold falls back to bank, takeGold spends across stacks');
    }

    // ---------- (d) staking draws from the stacks; validation uses the total ----------
    const Ann = await login('S16Ann', PW('S16Ann')); clients.push(Ann);
    const Bob = await login('S16Bob', PW('S16Bob')); clients.push(Bob);
    {
      // Above Ann's total entirely -> refused at creation.
      const err = await expectError(Ann, { type: 'challenge', target: 'S16Bob', stake: 150 }, 'over-total challenge (d)');
      assert(/up to what you both have/.test(err.message), `(d) a 150g stake on a 100g total is refused ("${err.message}")`);
      // (f) gold can't be staked as an ITEM — creation path.
      const errG = await expectError(Ann, { type: 'challenge', target: 'S16Bob', stake: 0, items: [{ item: 'gold', qty: 5 }] }, 'gold item stake (f)');
      assert(errG.message === "Gold can't be staked as an item — use the gold amount.", `(f) staking the coin stack as an item is refused ("${errG.message}")`);
      // 50g: more than Bob's BACKPACK stack (40) but within his
      // total (100) — creation must accept it.
      const mB = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S16Bob', stake: 50 });
      const inc = (await Bob.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming 50g (d)')).e;
      assert(inc.stake === 50, '(d) a stake above the backpack stack but within the total is allowed');
      // (f) gold as an item via the UPDATE path is refused too.
      const errU = await expectError(Bob, { type: 'challenge_update', challengeId: inc.challengeId, items: [{ item: 'gold', qty: 5 }] }, 'gold item stake via update (f)');
      assert(errU.message === "Gold can't be staked as an item — use the gold amount.", `(f) update-path gold item stake refused ("${errU.message}")`);
      // Decline the 50g challenge — nothing moves.
      Bob.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: false });
      await sleep(300);
      assertMoney(await prof('S16Ann'), 100, '(d) Ann after the decline');
      const bobAfterDecline = await prof('S16Bob');
      assertMoney(bobAfterDecline, 100, '(d) Bob after the decline');
      assert(packGold(bobAfterDecline) === 40 && bankGold(bobAfterDecline) === 60, '(d) Bob\'s split stacks untouched by the decline');

      // The real staked duel: 30g each.
      const mB2 = Bob.mark();
      Ann.send({ type: 'challenge', target: 'S16Bob', stake: 30 });
      const inc2 = (await Bob.waitSince(mB2, (e) => e.type === 'challenge_incoming', 10000, 'challenge_incoming 30g (d)')).e;
      Bob.send({ type: 'challenge_response', challengeId: inc2.challengeId, accept: true });
      Ann.send({ type: 'challenge_confirm', challengeId: inc2.challengeId });
      Bob.send({ type: 'challenge_confirm', challengeId: inc2.challengeId });
      const startA = (await Ann.waitSince(0, (e) => e.type === 'duel_start', 10000, 'duel_start (d)')).e;
      assert(startA.profile.gold === 70 && packGold(startA.profile) === 70, `(d) Ann's escrow came out of her backpack stack (gold ${startA.profile.gold}, stack ${packGold(startA.profile)})`);
      const startB = (await Bob.waitSince(mB2, (e) => e.type === 'duel_start', 10000, 'duel_start Bob (d)')).e;
      assert(startB.profile.gold === 70 && packGold(startB.profile) === 10 && bankGold(startB.profile) === 60, `(d) Bob's escrow drained his backpack stack first (pack ${packGold(startB.profile)}, bank ${bankGold(startB.profile)})`);
      Ann.send({ type: 'duel_attack' }); Bob.send({ type: 'duel_attack' });
      const endA = (await Ann.waitSince(0, (e) => e.type === 'duel_end', 240000, 'duel_end (d)')).e;
      assert(endA.pot === 60, `(d) the pot is the two 30g stakes (got ${endA.pot})`);
      const pAnn = await prof('S16Ann'); const pBob = await prof('S16Bob');
      const annWon = endA.winner === 'S16Ann';
      // Stage 20 (flagged fix): the winner also banks the one-time
      // +25g "Win a duel" starter-goal reward on top of the pot.
      assertMoney(annWon ? pAnn : pBob, 155, '(d) winner after the pot (+25g starter reward)');
      assertMoney(annWon ? pBob : pAnn, 70, '(d) loser after the pot');
      console.log(`PASS (d) staking: total-based validation, stack escrow, winner's stack +${60} (winner ${endA.winner})`);
    }

    console.log('ALL STAGE 16 TESTS PASSED');
  } finally {
    for (const c of clients) c.close();
    await stopServer();
    try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
