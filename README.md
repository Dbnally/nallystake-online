# nallystake — Online (gold-only)

The outside-Muse version of nallystake, so **real players** can play together.
Gold only — **no real-money buy, sell, or cash-out** (that stays off until a lawyer gives a written yes).

## What's built (Phase 1 — done and tested)
- **Saving fixed for free hosting:** with a database connected, accounts/gold/records save to Postgres outside the game server, so Render free sleeping, restarting, or redeploying can't wipe them (local file saving remains for testing on your own machine only)
- Accounts: create account / sign in, passwords hashed on the server
- One shared plaza: real players see each other move in real time
- Chat between real players
- Challenge any online player for a gold stake
- **Server-run duels** on the 0.6s tick: the server holds both stakes in escrow,
  rolls every hit, and pays the winner — clients can't cheat the result
- Server-side saving: gold, rating, wins/losses come back when you sign in again
- Leaderboard
- Simple 2D test client in `public/` to prove the online core

Tested 2026-11-13 with two separate accounts at once: both saw each other,
a 10g challenge was accepted, the server ran the duel, the loser ended on 90g
and the winner on 110g (total unchanged), and after a server restart the
winner still had 110g and a 1W/0L record.

Database mode tested 2026-11-13 against a real Postgres: a 25g duel settled
75g / 125g, then the game server was killed and restarted (the Render-free
sleep moment) and the winner still had 125g and a 1W/0L record — saving now
survives the server.

Run the tests yourself: `npm install && npm test` (local mode) and, with a
Postgres handy, `DATABASE_URL_TEST=... npm run test:db` (database mode).

## Run it locally
```
npm install
npm start        # http://localhost:8080
```
Open it in two different browsers (or one normal + one private window),
make two accounts, and challenge each other.

## Put it live — free route (Render + Neon), the part only Derek can do
Two free accounts, both in **your** name. The game runs on Render free; the
saving lives in a Neon free database — NOT on Render, because Render free
wipes the server's own files when it sleeps, and Render's own free database
expires after 30 days. Neon's free plan is permanent, needs no credit card,
doesn't pause your data away, and wakes in a fraction of a second when the
game asks for it.

1. **Neon (the saving):** sign up at neon.tech (free, no card) → create a
   project → copy its **connection string** (looks like
   `postgres://user:password@host/db?sslmode=require`). Keep it private —
   it's the key to the player database.
2. **GitHub (the code):** Render can't take a folder upload — it pulls the
   game from GitHub. Sign up at github.com (free), make a repo named
   `nallystake-online`, and upload the files from the deploy zip Muse
   gave you (already packed clean — no extra folders needed).
3. **Render (the game):** sign up at render.com (free) with that same
   GitHub account → New → Web Service → pick the `nallystake-online` repo
   (the `render.yaml` in it already sets the free plan, `npm install`
   build and `npm start`).
4. In Render's **Environment** tab add one variable:
   `DATABASE_URL` = the Neon connection string from step 1.
5. Deploy. Render gives you a public link (like `nallystake-online.onrender.com`)
   — that's your game online. It sleeps after 15 quiet minutes and takes
   about a minute to wake when someone opens it; accounts and gold are safe
   in Neon while it sleeps.

When you get to step 1, say the word and you'll be walked through it
tap-by-tap. Check both sites' current free terms before you rely on them —
free plans can change.

## Next phases (see FEATURE_INVENTORY.md)
- Phase 2: port the full plaza game — 3D plaza, shops, backpack/worn items,
  bank, item staking, Gold Exchange, styles/specials, prayers (Protect, per spec)
- Phase 3: Fight Caves (north), Barrows (south), goblins (east),
  Training Cave (south-east), Gathering Cave (south-west)

## Honest limits right now
- Saving uses Postgres (Neon free) in production; the local JSON file mode is for testing on your own machine only
- Sessions reset if the server restarts (players just sign in again; profiles/gold do NOT reset)
- This is not the full 3D game yet — it's the online heart the full game will run on
