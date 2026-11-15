// Saving for nallystake-online.
//
// Two modes:
//  - DATABASE_URL set  -> Postgres (Neon free in production). Player rows live
//    OUTSIDE the web server, so Render free sleeping / restarting / redeploying
//    can never wipe gold, accounts, or records. This is the production mode.
//  - No DATABASE_URL   -> a local JSON file. Local testing on your own machine
//    only — a host with an ephemeral disk (Render free) would lose it.
const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(filePath) { this.path = filePath; this.users = {}; }
  async init() {
    try { this.users = JSON.parse(fs.readFileSync(this.path, 'utf8')).users || {}; }
    catch { this.users = {}; }
    return this.users;
  }
  async putUser(/* key, record */) { this.flushSync(); }
  async flush() { this.flushSync(); }
  flushSync() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify({ users: this.users }, null, 2));
  }
}

class PgStore {
  constructor(connectionString) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString });
    this.users = {};
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS players (
      username TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await this.pool.query('SELECT username, data FROM players');
    this.users = {};
    for (const r of rows) this.users[r.username] = r.data;
    return this.users;
  }
  async putUser(key, record) {
    await this.pool.query(
      `INSERT INTO players (username, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [key, JSON.stringify(record)]
    );
  }
  async flush() { /* putUser already writes through */ }
  async close() { await this.pool.end(); }
}

function createStore(dbPath) {
  if (process.env.DATABASE_URL) return new PgStore(process.env.DATABASE_URL);
  return new FileStore(dbPath);
}
module.exports = { createStore, FileStore, PgStore };
