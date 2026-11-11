// Product image persistence: PostgreSQL bytea in production (survives restarts and
// redeploys on ephemeral hosts), local uploads/ directory in SQLite dev mode.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

async function write(filename, buffer, mime = 'image/jpeg') {
  if (db.IS_PG) {
    await db.prepare(`
      INSERT INTO image_blobs (filename, mime, data) VALUES (?, ?, ?)
      ON CONFLICT (filename) DO UPDATE SET data = EXCLUDED.data, mime = EXCLUDED.mime
      RETURNING filename
    `).run(filename, mime, buffer);
    return;
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
}

async function read(filename) {
  if (db.IS_PG) {
    const row = await db.prepare('SELECT data, mime FROM image_blobs WHERE filename = ?').get(filename);
    return row ? { buffer: row.data, mime: row.mime } : null;
  }
  const p = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(filename).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'application/octet-stream';
  return { buffer: fs.readFileSync(p), mime };
}

async function remove(filename) {
  if (db.IS_PG) {
    await db.prepare('DELETE FROM image_blobs WHERE filename = ?').run(filename);
    return;
  }
  try { fs.rmSync(path.join(UPLOADS_DIR, filename), { force: true }); } catch {}
}

module.exports = { write, read, remove, UPLOADS_DIR };