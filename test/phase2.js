// Phase 2 proof: shops, equip, bank, Gold Exchange, prayers, item staking
// and Dragon Slash specials — all server-authoritative, all saved.
// Boots the server in file mode on a test port with a temp DB_PATH.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18081;
const DB = path.join(os.tmpdir(), `nallystake-phase2-${Date.now()}.json`);
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
    client.waitProfile = (label = 'profile') => client.waitSince(client.events.length, (e) => e.type === 'profile', 15000, label).then(() => client.profile());
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qty = (profile, item) => { const s = (profile.backpack || []).find((x) => x.item === item); return s ? s.qty : 0; };
const bankQty = (profile, item) => { const s = (profile.bank || []).find((x) => x.item === item); return s ? s.qty : 0; };
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

(async () => {
  let server = await startServer();
  try {
    const a = await api('/api/register', { username: 'P2Alpha', password: 'secret1' });
    const b = await api('/api/register', { username: 'P2Beta', password: 'secret2' });
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    await ca.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome A');
    await cb.waitSince(0, (e) => e.type === 'welcome', 10000, 'welcome B');
    const cat = await ca.waitSince(0, (e) => e.type === 'catalog', 10000, 'catalog');
    assert(cat.items.some((i) => i.id === 'bronze_sword' && i.buy === 50), 'catalog lists bronze_sword at 50g');
    console.log('PASS catalog delivered:', cat.items.length, 'shop items, shops:', cat.shops.join(' / '));

    // --- Shops: buy ---
    ca.send({ type: 'shop_buy', item: 'prayer_potion', qty: 1 });
    let prof = await ca.waitProfile('buy prayer potion');
    assert(prof.gold === 85 && qty(prof, 'prayer_potion') === 1, `after potion buy gold=85 & 1 potion (got gold=${prof.gold})`);
    console.log('PASS shop buy: prayer potion 15g -> gold 100->85, item in backpack');

    ca.send({ type: 'shop_buy', item: 'bronze_sword', qty: 1 });
    prof = await ca.waitProfile('buy sword');
    assert(prof.gold === 35 && qty(prof, 'bronze_sword') === 1, `after sword buy gold=35 (got ${prof.gold})`);
    console.log('PASS shop buy: bronze sword 50g -> gold 85->35');

    // --- Equip (tap-to-wear) ---
    ca.send({ type: 'equip', item: 'bronze_sword' });
    prof = await ca.waitProfile('equip sword');
    assert(prof.worn.weapon === 'bronze_sword' && qty(prof, 'bronze_sword') === 0, 'sword moved backpack -> worn.weapon');
    console.log('PASS equip: bronze_sword worn, backpack stack gone');

    ca.send({ type: 'shop_buy', item: 'ration', qty: 2 });
    prof = await ca.waitProfile('buy rations A');
    assert(prof.gold === 19 && qty(prof, 'ration') === 2, `A rations: gold=19, ration x2 (got gold=${prof.gold})`);

    // --- Shops: sell back at 60% ---
    cb.send({ type: 'shop_buy', item: 'ration', qty: 2 });
    prof = await cb.waitProfile('buy rations B');
    assert(prof.gold === 84 && qty(prof, 'ration') === 2, `B rations: gold=84 (got ${prof.gold})`);
    cb.send({ type: 'shop_sell', item: 'ration', qty: 1 });
    prof = await cb.waitProfile('sell ration B');
    assert(prof.gold === 88 && qty(prof, 'ration') === 1, `B sell-back: gold=88 (ration 8g -> 4g at 60%), ration x1 (got gold=${prof.gold})`);
    console.log('PASS shop sell-back at 60%: ration bought 8g, sold 4g');

    // --- Bank roundtrip ---
    ca.send({ type: 'bank_deposit', item: 'ration', qty: 1 });
    prof = await ca.waitProfile('bank deposit');
    assert(qty(prof, 'ration') === 1 && bankQty(prof, 'ration') === 1, 'deposit: backpack 1, bank 1');
    ca.send({ type: 'bank_withdraw', item: 'ration', qty: 1 });
    prof = await ca.waitProfile('bank withdraw');
    assert(qty(prof, 'ration') === 2 && bankQty(prof, 'ration') === 0, 'withdraw: backpack 2, bank 0');
    console.log('PASS bank: deposit + withdraw roundtrip exact');

    // --- Gold Exchange: buy then sell, ~conserved minus the 3% ---
    const goldBeforeEx = cb.profile().gold;
    let mark = cb.events.length;
    cb.send({ type: 'exchange_buy', good: 'bones', qty: 1 });
    const buyR = await cb.waitSince(mark, (e) => e.type === 'exchange' && e.action === 'buy', 10000, 'exchange buy receipt');
    prof = cb.profile();
    assert(prof.gold === goldBeforeEx - buyR.total && qty(prof, 'bones') === 1, 'exchange buy moved gold -> bones at receipt price');
    mark = cb.events.length;
    cb.send({ type: 'exchange_sell', good: 'bones', qty: 1 });
    const sellR = await cb.waitSince(mark, (e) => e.type === 'exchange' && e.action === 'sell', 10000, 'exchange sell receipt');
    prof = cb.profile();
    assert(qty(prof, 'bones') === 0 && prof.gold === goldBeforeEx - buyR.total + sellR.total, 'exchange sell returned gold per receipt');
    assert(sellR.total === Math.floor(sellR.price * 0.97), 'sell-back is exactly 97% of the sell-time price');
    assert(sellR.total <= buyR.total * 1.06, `roundtrip roughly conserved minus 3% (bought ${buyR.total}, sold ${sellR.total})`);
    console.log(`PASS exchange: bones bought ${buyR.total}g, sold back ${sellR.total}g (97% sell-back, small drift allowed)`);

    // --- Prayers: one at a time, switching replaces, drain runs ---
    ca.send({ type: 'prayer', prayer: 'melee' });
    prof = await ca.waitProfile('prayer melee');
    assert(prof.activePrayer === 'melee', 'Deflect from Melee active');
    ca.send({ type: 'prayer', prayer: 'magic' });
    prof = await ca.waitProfile('prayer magic');
    assert(prof.activePrayer === 'magic', 'switching to Magic turned Melee off (only one active)');
    const stateForB = await cb.waitSince(0, (e) => e.type === 'state' && e.players.some((p) => p.username === 'P2Alpha' && p.activePrayer === 'magic'), 10000, 'state badge');
    assert(stateForB, 'players snapshot badges P2Alpha with activePrayer=magic');
    console.log('PASS prayer: melee -> magic (previous off), overhead badge in state snapshot');
    await sleep(3600);
    ca.send({ type: 'style', style: 'accurate' }); // any profile reply shows the drain
    prof = await ca.waitProfile('prayer drain check');
    assert(prof.prayerPoints < prof.prayerMax, `prayer drained while active (${prof.prayerPoints}/${prof.prayerMax})`);
    console.log(`PASS prayer drain: points fell to ${prof.prayerPoints}/${prof.prayerMax} while active`);
    ca.send({ type: 'prayer', prayer: null });
    prof = await ca.waitProfile('prayer off');
    assert(prof.activePrayer === null, 'prayer null turns prayer off');

    // --- Item-stake duel ---
    const preA = ca.profile(), preB = cb.profile();
    assert(qty(preA, 'ration') === 2 && qty(preB, 'ration') === 1, 'pre-duel ration counts (A2/B1)');
    mark = cb.events.length;
    ca.send({ type: 'challenge', target: 'P2Beta', stake: 5, items: [{ item: 'ration', qty: 1 }] });
    const incoming = await cb.waitSince(mark, (e) => e.type === 'challenge_incoming', 10000, 'item challenge');
    assert(incoming.stake === 5 && incoming.items && incoming.items[0].item === 'ration' && incoming.items[0].qty === 1, 'incoming challenge shows gold + item stake');
    const endMarkA = ca.events.length, endMarkB = cb.events.length;
    cb.send({ type: 'challenge_response', challengeId: incoming.challengeId, accept: true, items: [{ item: 'ration', qty: 1 }] });
    // Stage 14: acceptance joins the configuration — both sides
    // confirm before the duel starts.
    ca.send({ type: 'challenge_confirm', challengeId: incoming.challengeId });
    cb.send({ type: 'challenge_confirm', challengeId: incoming.challengeId });
    // Stage 12: duel fighters start un-engaged — both tap to attack.
    await ca.waitSince(endMarkA, (e) => e.type === 'duel_start', 10000, 'item duel_start');
    ca.send({ type: 'duel_attack' }); cb.send({ type: 'duel_attack' });
    // Stage 12: the waits rise 90s -> 300s — OSRS swing timers land
    // one swing per fighter per 4 ticks, so the duel takes ~4x as
    // many ticks to finish.
    const [endA, endB] = await Promise.all([
      ca.waitSince(endMarkA, (e) => e.type === 'duel_end', 300000, 'duel_end A'),
      cb.waitSince(endMarkB, (e) => e.type === 'duel_end', 300000, 'duel_end B'),
    ]);
    const winnerIsA = endA.winner === 'P2Alpha';
    const wProf = winnerIsA ? endA.profile : endB.profile;
    const lProf = winnerIsA ? endB.profile : endA.profile;
    const wPre = winnerIsA ? preA : preB, lPre = winnerIsA ? preB : preA;
    // Stage 20 (flagged fix): +25 more on the winner — the one-time
    // "Win a duel" starter-goal reward lands on their first win.
    assert(wProf.gold === wPre.gold + 5 + 25 && lProf.gold === lPre.gold - 5, 'item duel gold escrow settled (+5 pot, +25 starter reward / -5)');
    assert(qty(wProf, 'ration') === qty(wPre, 'ration') + 1, 'winner gained the loser\'s staked ration (net +1 after own stake returned via escrow)');
    assert(qty(lProf, 'ration') === qty(lPre, 'ration') - 1, 'loser lost their staked ration');
    assert(endA.itemsWon && endA.itemsWon.some((s) => s.item === 'ration' && s.qty === 2), 'duel_end reports both staked rations as itemsWon');
    console.log(`PASS item staking: ${endA.winner} won 5g + both rations; gold and items conserved`);

    // --- Special: charge by landing hits, queue Dragon Slash, see it fire ---
    let specialFired = false;
    for (let attempt = 1; attempt <= 3 && !specialFired; attempt++) {
      const mB = cb.events.length;
      ca.send({ type: 'challenge', target: 'P2Beta', stake: 1 });
      const inc = await cb.waitSince(mB, (e) => e.type === 'challenge_incoming', 10000, 'special duel challenge');
      const startIdxA = ca.events.length, startIdxB = cb.events.length;
      cb.send({ type: 'challenge_response', challengeId: inc.challengeId, accept: true });
      // Stage 14: both sides confirm the configuration.
      ca.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      cb.send({ type: 'challenge_confirm', challengeId: inc.challengeId });
      // Stage 12: duel fighters start un-engaged — both tap to
      // attack, or no hits land and the special can never charge.
      await ca.waitSince(startIdxA, (e) => e.type === 'duel_start', 10000, 'special duel_start');
      ca.send({ type: 'duel_attack' }); cb.send({ type: 'duel_attack' });
      let queuedBy = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        const ticksA = ca.events.slice(startIdxA).filter((e) => e.type === 'duel_tick');
        const ticksB = cb.events.slice(startIdxB).filter((e) => e.type === 'duel_tick');
        if (!queuedBy) {
          const eA = ticksA.length ? ticksA[ticksA.length - 1].energyYou : ca.profile().specialEnergy;
          const eB = ticksB.length ? ticksB[ticksB.length - 1].energyYou : cb.profile().specialEnergy;
          if (eA >= 50) { ca.send({ type: 'special' }); queuedBy = 'A'; }
          else if (eB >= 50) { cb.send({ type: 'special' }); queuedBy = 'B'; }
        } else {
          const all = [...ticksA, ...ticksB];
          if (all.some((t) => t.youSpecial || t.oppSpecial)) { specialFired = true; break; }
        }
        if (ca.events.slice(startIdxA).some((e) => e.type === 'duel_end')) break;
        await sleep(120);
      }
      // make sure this duel is over before any retry
      // (Stage 12: 90s -> 300s, same swing-timer reasoning as above.)
      await ca.waitSince(startIdxA, (e) => e.type === 'duel_end', 300000, 'special duel end').catch(() => {});
      if (specialFired) console.log(`PASS special: Dragon Slash charged by landed hits, queued by P2${queuedBy === 'A' ? 'Alpha' : 'Beta'}, fired on a later tick (attempt ${attempt})`);
    }
    assert(specialFired, 'Dragon Slash fired within 3 duels');

    // --- Restart persistence ---
    const lastA = ca.profile(), lastB = cb.profile();
    ca.ws.close(); cb.ws.close();
    await sleep(300);
    server.kill(); await sleep(500);
    server = await startServer();
    const a2 = await api('/api/login', { username: 'P2Alpha', password: 'secret1' });
    assert(a2.profile.worn.weapon === 'bronze_sword', 'after restart: bronze_sword still worn');
    assert(qty(a2.profile, 'prayer_potion') === 1, 'after restart: bought prayer potion still in backpack');
    assert(a2.profile.gold === lastA.gold, `after restart: gold persisted (${a2.profile.gold}g)`);
    const b2 = await api('/api/login', { username: 'P2Beta', password: 'secret2' });
    assert(b2.profile.gold === lastB.gold, `after restart: P2Beta gold persisted (${b2.profile.gold}g)`);
    console.log(`PASS saving: restart kept worn weapon, backpack items and gold (A ${a2.profile.gold}g, B ${b2.profile.gold}g)`);
    console.log('ALL PHASE 2 TESTS PASSED');
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch {}
  }
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
