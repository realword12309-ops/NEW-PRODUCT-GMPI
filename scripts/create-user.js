// Create an authorized user (or reset an existing user's password).
// Usage:  USER_PASSWORD="their-password" node scripts/create-user.js <username>
// Works against the online DB when DATABASE_URL is set, otherwise the local SQLite DB.
const db = require('../db');
const { hashPassword } = require('../lib/auth');

async function main() {
  const username = String(process.argv[2] || '').trim();
  const password = process.env.USER_PASSWORD || '';
  if (username.length < 3 || username.length > 64) {
    console.error('Usage: USER_PASSWORD="their-password" node scripts/create-user.js <username> (3-64 chars)');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('USER_PASSWORD must be set to a password of at least 8 characters.');
    process.exit(1);
  }
  await db.init();
  await db.prepare(`
    INSERT INTO users (username, password_hash) VALUES (?, ?)
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `).run(username, hashPassword(password));
  console.log(`User "${username}" is ready (created or password reset).`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });