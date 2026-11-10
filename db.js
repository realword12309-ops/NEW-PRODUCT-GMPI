// Data layer: PostgreSQL when DATABASE_URL is set (production), SQLite otherwise (local dev).
// Both modes expose the same async API: prepare(sql).get/all/run, transaction(fn), exec(sql).
const path = require('node:path');
const fs = require('node:fs');

const DATABASE_URL = process.env.DATABASE_URL || '';
const IS_PG = Boolean(DATABASE_URL);

const UTC_NOW = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

// Translate the app's SQLite-flavored SQL to PostgreSQL.
function translate(sql) {
  let i = 0;
  let out = sql.replace(/\?/g, () => `$${++i}`);
  out = out.replace(/datetime\('now'\)/gi, UTC_NOW);
  out = out.replace(/\bLIKE\b/g, 'ILIKE');
  out = out.replace(/COUNT\(\*\)/gi, 'COUNT(*)::int');
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').replace(/;\s*$/, '');
    // run() may have appended RETURNING already; ON CONFLICT must precede it.
    out = /\bRETURNING\b/i.test(out)
      ? out.replace(/\s+RETURNING\b/i, ' ON CONFLICT DO NOTHING RETURNING')
      : out + ' ON CONFLICT DO NOTHING';
  }
  return out;
}

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  memo_no TEXT NOT NULL DEFAULT '',
  effective_date TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  to_recipient TEXT NOT NULL DEFAULT '',
  from_sender TEXT NOT NULL DEFAULT 'Grand Majesty Pharmaceutical Inc.',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  item_description TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  packaging TEXT NOT NULL DEFAULT '',
  srp TEXT NOT NULL DEFAULT '',
  discount TEXT NOT NULL DEFAULT '',
  trade_price TEXT NOT NULL DEFAULT '',
  price3 TEXT NOT NULL DEFAULT '',
  uom_group_name TEXT NOT NULL DEFAULT '',
  retail_price TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_products_announcement ON products(announcement_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_item_code ON products(item_code);

CREATE TABLE IF NOT EXISTS announcement_stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  acknowledged_at TEXT,
  acknowledged_by TEXT NOT NULL DEFAULT '',
  UNIQUE(announcement_id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_ann_stores_ann ON announcement_stores(announcement_id);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${UTC_NOW})
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_name_lower ON stores (lower(name));

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  memo_no TEXT NOT NULL DEFAULT '',
  effective_date TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  to_recipient TEXT NOT NULL DEFAULT '',
  from_sender TEXT NOT NULL DEFAULT 'Grand Majesty Pharmaceutical Inc.',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  created_at TEXT NOT NULL DEFAULT (${UTC_NOW}),
  updated_at TEXT NOT NULL DEFAULT (${UTC_NOW})
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  item_description TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  packaging TEXT NOT NULL DEFAULT '',
  srp TEXT NOT NULL DEFAULT '',
  discount TEXT NOT NULL DEFAULT '',
  trade_price TEXT NOT NULL DEFAULT '',
  price3 TEXT NOT NULL DEFAULT '',
  uom_group_name TEXT NOT NULL DEFAULT '',
  retail_price TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_products_announcement ON products(announcement_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_item_code ON products(item_code);

CREATE TABLE IF NOT EXISTS announcement_stores (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  acknowledged_at TEXT,
  acknowledged_by TEXT NOT NULL DEFAULT '',
  UNIQUE(announcement_id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_ann_stores_ann ON announcement_stores(announcement_id);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${UTC_NOW})
);

CREATE TABLE IF NOT EXISTS image_blobs (
  filename TEXT PRIMARY KEY,
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${UTC_NOW})
);
`;

let sqlite = null;
let pgClient = null;
let pgEnded = true;
let connecting = null;
let queue = Promise.resolve();

function enqueue(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

async function getPg() {
  if (pgClient && !pgEnded) return pgClient;
  if (!connecting) {
    connecting = (async () => {
      const { Client } = require('pg');
      const url = new URL(DATABASE_URL);
      let ssl;
      if (process.env.PGSSL === 'require') ssl = { rejectUnauthorized: false };
      else if (process.env.PGSSL === 'disable') ssl = undefined;
      else if (/\.render\.com$/i.test(url.hostname) || url.searchParams.get('sslmode') === 'require') ssl = { rejectUnauthorized: false };
      const c = new Client({ connectionString: DATABASE_URL, ssl, connectionTimeoutMillis: 15000 });
      c.on('error', (e) => { console.error('Database connection error:', e.message); pgEnded = true; });
      c.on('end', () => { pgEnded = true; });
      await c.connect();
      pgClient = c;
      pgEnded = false;
      return c;
    })().finally(() => { connecting = null; });
  }
  return connecting;
}

async function rawQuery(sql, params = []) {
  const c = await getPg();
  return c.query(translate(sql), params);
}

function queuedQuery(sql, params = []) {
  return enqueue(() => rawQuery(sql, params));
}

function pgStmt(sql, executor) {
  return {
    async get(...params) { return (await executor(sql, params)).rows[0]; },
    async all(...params) { return (await executor(sql, params)).rows; },
    async run(...params) {
      let s = sql.trim();
      if (/^INSERT/i.test(s) && !/RETURNING/i.test(s)) s = s.replace(/;\s*$/, '') + ' RETURNING id';
      const r = await executor(s, params);
      return { lastInsertRowid: r.rows[0] ? r.rows[0].id : null, changes: r.rowCount };
    },
  };
}

function sqliteStmt(sql) {
  return {
    async get(...params) { return sqlite.prepare(sql).get(...params); },
    async all(...params) { return sqlite.prepare(sql).all(...params); },
    async run(...params) {
      const r = sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
    },
  };
}

function prepare(sql) {
  return IS_PG ? pgStmt(sql, queuedQuery) : sqliteStmt(sql);
}

async function exec(sql) {
  if (IS_PG) return enqueue(async () => { const c = await getPg(); return c.query(sql); });
  return sqlite.exec(sql);
}

// Transactions are serialized: in PostgreSQL mode the whole transaction holds the
// single connection queue, so concurrent requests can never interleave statements.
async function transaction(fn) {
  if (!IS_PG) {
    sqlite.exec('BEGIN');
    try {
      const r = await fn({ prepare: sqliteStmt, exec: async (s) => sqlite.exec(s) });
      sqlite.exec('COMMIT');
      return r;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  }
  return enqueue(async () => {
    const c = await getPg();
    await c.query('BEGIN');
    const tx = {
      prepare: (sql) => pgStmt(sql, rawQuery),
      exec: async (s) => c.query(s),
    };
    try {
      const r = await fn(tx);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

async function init() {
  if (IS_PG) {
    await enqueue(async () => { const c = await getPg(); await c.query(SCHEMA_PG); });
    return;
  }
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  sqlite = new DatabaseSync(DB_PATH);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(SCHEMA_SQLITE);

  // Migrate older local databases: add columns without touching existing rows.
  const productCols = sqlite.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  for (const col of ['packaging', 'srp', 'discount', 'trade_price', 'price3', 'uom_group_name', 'retail_price']) {
    if (!productCols.includes(col)) sqlite.exec(`ALTER TABLE products ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  const annCols = sqlite.prepare('PRAGMA table_info(announcements)').all().map((c) => c.name);
  if (!annCols.includes('to_recipient')) sqlite.exec("ALTER TABLE announcements ADD COLUMN to_recipient TEXT NOT NULL DEFAULT ''");
  if (!annCols.includes('from_sender')) sqlite.exec("ALTER TABLE announcements ADD COLUMN from_sender TEXT NOT NULL DEFAULT 'Grand Majesty Pharmaceutical Inc.'");
}

async function close() {
  if (IS_PG && pgClient && !pgEnded) { const c = pgClient; pgEnded = true; await c.end(); }
  if (sqlite) sqlite.close();
}

module.exports = { init, prepare, transaction, exec, close, IS_PG };