// One-time migration: local SQLite (data/app.db + uploads/) -> online PostgreSQL.
// Usage:  DATABASE_URL="postgres://..." node scripts/migrate-to-postgres.js
// Optional: DB_PATH / UPLOADS_DIR to override local source locations.
// Idempotent: existing rows (same ids) are skipped, never overwritten.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy the EXTERNAL Database URL from your Render PostgreSQL dashboard.');
  process.exit(1);
}

const db = require('../db'); // IS_PG = true because DATABASE_URL is set
const storage = require('../lib/storage');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

async function copyTable(src, table, columns) {
  const rows = src.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT (id) DO NOTHING`;
  const stmt = db.prepare(sql);
  let inserted = 0;
  for (const row of rows) {
    const r = await stmt.run(...columns.map((c) => row[c]));
    if (r.changes > 0) inserted += 1;
  }
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  if (max > 0) await db.prepare(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), ?)`).get(max);
  console.log(`${table}: ${rows.length} row(s) found, ${inserted} inserted, ${rows.length - inserted} already present`);
  return rows;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Local SQLite database not found: ${DB_PATH}`);
    process.exit(1);
  }
  const src = new DatabaseSync(DB_PATH, { readOnly: true });
  await db.init();

  await copyTable(src, 'stores', ['id', 'name', 'code', 'created_at']);
  await copyTable(src, 'announcements', ['id', 'slug', 'title', 'memo_no', 'effective_date', 'intro', 'prepared_by', 'approved_by', 'to_recipient', 'from_sender', 'status', 'created_at', 'updated_at']);
  await copyTable(src, 'products', ['id', 'announcement_id', 'item_code', 'item_description', 'short_description', 'image_path', 'sort_order', 'packaging', 'srp', 'discount', 'trade_price', 'price3', 'uom_group_name', 'retail_price']);
  await copyTable(src, 'announcement_stores', ['id', 'announcement_id', 'store_id', 'acknowledged_at', 'acknowledged_by']);

  // User accounts (password hashes) — table may not exist in older local DBs.
  const hasUsers = src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasUsers) await copyTable(src, 'users', ['id', 'username', 'password_hash', 'created_at']);
  else console.log('users: no local accounts (create the online admin via ADMIN_USERNAME / ADMIN_PASSWORD)');

  // Product images -> image_blobs
  const paths = src.prepare('SELECT DISTINCT image_path FROM products WHERE image_path IS NOT NULL').all();
  let copied = 0, missing = 0;
  for (const { image_path } of paths) {
    const name = path.basename(image_path);
    const file = path.join(UPLOADS_DIR, name);
    if (!fs.existsSync(file)) { console.warn(`  image missing on disk, skipped: ${name}`); missing += 1; continue; }
    const ext = path.extname(name).toLowerCase();
    const mime = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
    await storage.write(name, fs.readFileSync(file), mime);
    copied += 1;
  }
  console.log(`images: ${copied} copied into PostgreSQL, ${missing} missing`);

  src.close();
  await db.close();
  console.log('Migration complete. All existing records are now in the online database.');
}

main().catch((e) => { console.error('Migration failed:', e); process.exit(1); });