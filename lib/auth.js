// Password hashing (scrypt) and signed session tokens. No external dependencies.
const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const ref = Buffer.from(hash, 'hex');
  const calc = crypto.scryptSync(String(password), salt, 64);
  return ref.length === calc.length && crypto.timingSafeEqual(calc, ref);
}

function hmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function signSession(userId, secret, ttlMs) {
  const payload = `${userId}.${Date.now() + ttlMs}`;
  return `${payload}.${hmac(payload, secret)}`;
}

function verifySession(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = hmac(`${userId}.${exp}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  return Number(userId);
}

module.exports = { hashPassword, verifyPassword, signSession, verifySession };