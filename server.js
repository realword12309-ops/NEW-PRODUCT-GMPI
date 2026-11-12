const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const storage = require('./lib/storage');
const { hashPassword, verifyPassword, signSession, verifySession } = require('./lib/auth');
const { parseSpreadsheet, validateRows, buildTemplate } = require('./lib/imports');
const { generateMemo, RECIPIENTS } = require('./lib/pdf');
const JSZip = require('jszip');

const PORT = Number(process.env.PORT) || 3100;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : crypto.randomBytes(32).toString('hex'));
const SESSION_COOKIE = 'gmpi_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (IS_PRODUCTION && !SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}
if (IS_PRODUCTION && !db.IS_PG) {
  console.error('FATAL: DATABASE_URL (PostgreSQL) must be set in production.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_EXTS.has(ext)) return cb(null, true);
    cb(Object.assign(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'), { status: 400 }));
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 300 },
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.csv') return cb(null, true);
    cb(Object.assign(new Error('Only .xlsx or .csv files are allowed.'), { status: 400 }));
  },
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (msg = 'Not found') => Object.assign(new Error(msg), { status: 404 });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function publicUrl(req, slug) {
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/view/${slug}`;
}

// ---------- Auth ----------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const userId = verifySession(token, SESSION_SECRET);
  if (!userId) return null;
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
}

function setSessionCookie(req, res, userId) {
  const token = signSession(userId, SESSION_SECRET, SESSION_TTL_MS);
  const secure = req.protocol === 'https';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
}

const requireAuth = asyncRoute(async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
});

// Basic per-IP login rate limit.
const loginAttempts = new Map();
function rateLimitLogin(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= 10) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  if (!entry || entry.resetAt <= now) loginAttempts.set(ip, { count: 0, resetAt: now + 15 * 60 * 1000 });
  next();
}
function noteLoginFailure(req) {
  const entry = loginAttempts.get(req.ip || 'unknown');
  if (entry) entry.count += 1;
}

async function userCount() {
  return (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
}

app.get('/api/health', asyncRoute(async (req, res) => {
  await db.prepare('SELECT 1 AS ok').get();
  res.json({ ok: true, db: db.IS_PG ? 'postgresql' : 'sqlite', time: new Date().toISOString() });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    const setupNeeded = !IS_PRODUCTION && (await userCount()) === 0;
    return res.status(401).json({ error: 'Authentication required.', setupNeeded });
  }
  res.json({ user: { id: user.id, username: user.username } });
}));

app.post('/api/auth/setup', rateLimitLogin, asyncRoute(async (req, res) => {
  if (IS_PRODUCTION) throw badRequest('First-run setup is disabled in production. Set ADMIN_USERNAME and ADMIN_PASSWORD.');
  if ((await userCount()) > 0) throw badRequest('An administrator account already exists.');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3 || username.length > 64) throw badRequest('Username must be 3-64 characters.');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters.');
  const r = await db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  setSessionCookie(req, res, r.lastInsertRowid);
  res.status(201).json({ ok: true, user: { id: Number(r.lastInsertRowid), username } });
}));

app.post('/api/auth/login', rateLimitLogin, asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) throw badRequest('Username and password are required.');
  const user = await db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
  const ok = user ? verifyPassword(password, user.password_hash) : verifyPassword(password, '00000000000000000000000000000000:' + '0'.repeat(128));
  if (!user || !ok) {
    noteLoginFailure(req);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  loginAttempts.delete(req.ip || 'unknown');
  setSessionCookie(req, res, user.id);
  res.json({ ok: true, user: { id: user.id, username: user.username } });
}));

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- Page gating (admin SPA requires login; store view stays public) ----------
app.get(['/', '/index.html'], asyncRoute(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
}));

app.get('/login', asyncRoute(async (req, res) => {
  const user = await getSessionUser(req);
  if (user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
}));

app.get('/view/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- Protected API boundary ----------
// Everything under /api except health, auth, and the public store endpoints requires login.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path.startsWith('/public/') || req.path === '/health') return next();
  return requireAuth(req, res, next);
});

// ---------- Uploaded images (DB-backed in production, filesystem in dev) ----------
app.get('/uploads/:filename', asyncRoute(async (req, res, next) => {
  const name = req.params.filename;
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return next(notFound());
  const img = await storage.read(name);
  if (!img) return next(notFound());
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(img.buffer);
}));

// ---------- Data helpers ----------
async function getAnnouncement(id) {
  return db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
}

async function getProducts(announcementId) {
  return db.prepare('SELECT * FROM products WHERE announcement_id = ? ORDER BY sort_order, id').all(announcementId);
}

async function getTargets(announcementId) {
  return db.prepare(`
    SELECT ast.id, ast.store_id, s.name AS store_name, s.code AS store_code,
           ast.acknowledged_at, ast.acknowledged_by
    FROM announcement_stores ast JOIN stores s ON s.id = ast.store_id
    WHERE ast.announcement_id = ? ORDER BY s.name
  `).all(announcementId);
}

function validateAnnouncement(body) {
  const title = String(body.title || '').trim();
  if (!title) throw badRequest('Announcement title is required.');
  const products = Array.isArray(body.products) ? body.products : [];
  if (products.length === 0) throw badRequest('Add at least one product before saving.');
  const seen = new Set();
  const clean = products.map((p, i) => {
    const item_code = String(p.item_code || '').trim();
    const item_description = String(p.item_description || '').trim();
    const short_description = String(p.short_description || '').trim();
    if (!item_code) throw badRequest(`Product #${i + 1}: Item Code is required.`);
    if (!item_description) throw badRequest(`Product #${i + 1}: Item Description is required.`);
    if (!short_description) throw badRequest(`Product #${i + 1}: Short Description is required.`);
    const key = item_code.toLowerCase();
    if (seen.has(key)) throw badRequest(`Duplicate Item Code "${item_code}" in this announcement.`);
    seen.add(key);
    let image_path = p.image_path || null;
    if (image_path !== null) {
      image_path = String(image_path);
      if (!/^\/uploads\/[a-f0-9-]+\.(jpg|jpeg|png|webp|gif)$/i.test(image_path)) {
        throw badRequest(`Product #${i + 1}: invalid image reference.`);
      }
    }
    return {
      item_code, item_description, short_description, image_path, sort_order: i,
      principal: String(p.principal || '').trim(),
      item_category: String(p.item_category || '').trim(),
      packaging: String(p.packaging || '').trim(),
      srp: String(p.srp || '').trim(),
      discount: String(p.discount || '').trim(),
      trade_price: String(p.trade_price || '').trim(),
      price3: String(p.price3 || '').trim(),
      uom_group_name: String(p.uom_group_name || '').trim(),
      retail_price: String(p.retail_price || '').trim(),
    };
  });
  return {
    title,
    memo_no: String(body.memo_no || '').trim(),
    effective_date: String(body.effective_date || '').trim(),
    intro: String(body.intro || '').trim(),
    prepared_by: String(body.prepared_by || '').trim(),
    approved_by: String(body.approved_by || '').trim(),
    to_recipient: String(body.to_recipient || '').trim(),
    from_sender: String(body.from_sender || '').trim() || 'Grand Majesty Pharmaceutical Inc.',
    products: clean,
  };
}

const INSERT_PRODUCT_SQL = `
    INSERT INTO products (announcement_id, principal, item_category, item_code, item_description, short_description, image_path, sort_order, packaging, srp, discount, trade_price, price3, uom_group_name, retail_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

async function insertProducts(tx, announcementId, products) {
  const stmt = tx.prepare(INSERT_PRODUCT_SQL);
  for (const p of products) {
    await stmt.run(announcementId, p.principal, p.item_category, p.item_code, p.item_description, p.short_description, p.image_path, p.sort_order, p.packaging, p.srp, p.discount, p.trade_price, p.price3, p.uom_group_name, p.retail_price);
  }
}

// ---------- Stores ----------
app.get('/api/stores', asyncRoute(async (req, res) => {
  res.json(await db.prepare('SELECT * FROM stores ORDER BY name').all());
}));

app.post('/api/stores', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim();
  if (!name) throw badRequest('Store name is required.');
  const exists = await db.prepare('SELECT id FROM stores WHERE lower(name) = lower(?)').get(name);
  if (exists) throw badRequest(`Store "${name}" already exists.`);
  const r = await db.prepare('INSERT INTO stores (name, code) VALUES (?, ?)').run(name, code);
  res.status(201).json(await db.prepare('SELECT * FROM stores WHERE id = ?').get(r.lastInsertRowid));
}));

app.put('/api/stores/:id', asyncRoute(async (req, res, next) => {
  const store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!store) return next(notFound('Store not found.'));
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim();
  if (!name) throw badRequest('Store name is required.');
  const dup = await db.prepare('SELECT id FROM stores WHERE lower(name) = lower(?) AND id != ?').get(name, store.id);
  if (dup) throw badRequest(`Store "${name}" already exists.`);
  await db.prepare('UPDATE stores SET name = ?, code = ? WHERE id = ?').run(name, code, store.id);
  res.json(await db.prepare('SELECT * FROM stores WHERE id = ?').get(store.id));
}));

app.delete('/api/stores/:id', asyncRoute(async (req, res, next) => {
  const store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!store) return next(notFound('Store not found.'));
  await db.prepare('DELETE FROM stores WHERE id = ?').run(store.id);
  res.json({ ok: true });
}));

// ---------- Announcements ----------
app.get('/api/announcements', asyncRoute(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const search = String(req.query.search || '').trim();
  const where = search ? 'WHERE a.title LIKE ? OR a.memo_no LIKE ?' : '';
  const params = search ? [`%${search}%`, `%${search}%`] : [];
  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM announcements a ${where}`).get(...params)).c;
  const rows = await db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM products p WHERE p.announcement_id = a.id) AS product_count,
      (SELECT COUNT(*) FROM announcement_stores t WHERE t.announcement_id = a.id) AS target_count,
      (SELECT COUNT(*) FROM announcement_stores t WHERE t.announcement_id = a.id AND t.acknowledged_at IS NOT NULL) AS ack_count
    FROM announcements a ${where}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, items: rows });
}));

app.post('/api/announcements', asyncRoute(async (req, res) => {
  const data = validateAnnouncement(req.body);
  const slug = crypto.randomBytes(6).toString('base64url');
  const id = await db.transaction(async (tx) => {
    const r = await tx.prepare(`
      INSERT INTO announcements (slug, title, memo_no, effective_date, intro, prepared_by, approved_by, to_recipient, from_sender)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, data.title, data.memo_no, data.effective_date, data.intro, data.prepared_by, data.approved_by, data.to_recipient, data.from_sender);
    await insertProducts(tx, r.lastInsertRowid, data.products);
    return Number(r.lastInsertRowid);
  });
  res.status(201).json({ id, slug });
}));

app.get('/api/announcements/:id', asyncRoute(async (req, res, next) => {
  const a = await getAnnouncement(req.params.id);
  if (!a) return next(notFound('Announcement not found.'));
  res.json({
    ...a,
    products: await getProducts(a.id),
    targets: await getTargets(a.id),
    public_url: publicUrl(req, a.slug),
  });
}));

app.put('/api/announcements/:id', asyncRoute(async (req, res, next) => {
  const a = await getAnnouncement(req.params.id);
  if (!a) return next(notFound('Announcement not found.'));
  const data = validateAnnouncement(req.body);
  await db.transaction(async (tx) => {
    await tx.prepare(`
      UPDATE announcements SET title=?, memo_no=?, effective_date=?, intro=?, prepared_by=?, approved_by=?, to_recipient=?, from_sender=?, updated_at=datetime('now')
      WHERE id=?
    `).run(data.title, data.memo_no, data.effective_date, data.intro, data.prepared_by, data.approved_by, data.to_recipient, data.from_sender, a.id);
    await tx.prepare('DELETE FROM products WHERE announcement_id = ?').run(a.id);
    await insertProducts(tx, a.id, data.products);
  });
  res.json({ ok: true });
}));

app.delete('/api/announcements/:id', asyncRoute(async (req, res, next) => {
  const a = await getAnnouncement(req.params.id);
  if (!a) return next(notFound('Announcement not found.'));
  const images = await db.prepare('SELECT image_path FROM products WHERE announcement_id = ? AND image_path IS NOT NULL').all(a.id);
  await db.prepare('DELETE FROM announcements WHERE id = ?').run(a.id);
  for (const { image_path } of images) {
    const stillUsed = (await db.prepare('SELECT COUNT(*) AS c FROM products WHERE image_path = ?').get(image_path)).c;
    if (!stillUsed) await storage.remove(path.basename(image_path));
  }
  res.json({ ok: true });
}));

// ---------- Cascading ----------
app.post('/api/announcements/:id/cascade', asyncRoute(async (req, res) => {
  const a = await getAnnouncement(req.params.id);
  if (!a) throw notFound('Announcement not found.');
  const all = req.body.all === true;
  let storeIds;
  if (all) {
    storeIds = (await db.prepare('SELECT id FROM stores').all()).map((s) => s.id);
    if (storeIds.length === 0) throw badRequest('No stores registered. Add stores first.');
  } else {
    storeIds = Array.isArray(req.body.storeIds) ? req.body.storeIds.map(Number).filter(Boolean) : [];
    if (storeIds.length === 0) throw badRequest('Select at least one store, or choose All Stores.');
    const valid = new Set((await db.prepare('SELECT id FROM stores').all()).map((s) => s.id));
    if (storeIds.some((id) => !valid.has(id))) throw badRequest('One or more selected stores do not exist.');
  }
  await db.transaction(async (tx) => {
    const stmt = tx.prepare('INSERT OR IGNORE INTO announcement_stores (announcement_id, store_id) VALUES (?, ?)');
    for (const id of storeIds) await stmt.run(a.id, id);
    await tx.prepare("UPDATE announcements SET status='sent', updated_at=datetime('now') WHERE id=?").run(a.id);
  });
  res.json({ ok: true, public_url: publicUrl(req, a.slug), targets: await getTargets(a.id) });
}));

// ---------- PDF ----------
function memoBaseName(a) {
  return `memo-${a.memo_no ? a.memo_no.replace(/[^a-z0-9_-]+/gi, '_') : a.id}`;
}

// In production, preload product images from PostgreSQL into a Map for pdfkit.
async function collectImages(products) {
  if (!db.IS_PG) return storage.UPLOADS_DIR;
  const map = new Map();
  for (const p of products) {
    if (!p.image_path) continue;
    const name = path.basename(p.image_path);
    if (map.has(name)) continue;
    const img = await storage.read(name);
    if (img) map.set(name, img.buffer);
  }
  return map;
}

function pdfBuffer(a, products, images, recipient) {
  return new Promise((resolve, reject) => {
    const doc = generateMemo(a, products, images, recipient);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

app.get('/api/announcements/:id/pdf', asyncRoute(async (req, res) => {
  const a = await getAnnouncement(req.params.id);
  if (!a) throw notFound('Announcement not found.');
  const recipient = String(req.query.recipient || 'sales');
  if (!RECIPIENTS[recipient]) throw badRequest('Unknown recipient. Use sales, stores, or customers.');
  const products = await getProducts(a.id);
  const images = await collectImages(products);
  const filename = `${memoBaseName(a)}-${RECIPIENTS[recipient].filename}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = generateMemo(a, products, images, recipient);
  doc.pipe(res);
}));

app.get('/api/announcements/:id/pdf-all', asyncRoute(async (req, res) => {
  const a = await getAnnouncement(req.params.id);
  if (!a) throw notFound('Announcement not found.');
  const products = await getProducts(a.id);
  const images = await collectImages(products);
  const zip = new JSZip();
  for (const key of Object.keys(RECIPIENTS)) {
    zip.file(`${memoBaseName(a)}-${RECIPIENTS[key].filename}.pdf`, await pdfBuffer(a, products, images, key));
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${memoBaseName(a)}-all-recipients.zip"`);
  res.send(buffer);
}));

// ---------- Bulk import ----------
app.get('/api/import/template', asyncRoute(async (req, res) => {
  const buffer = await buildTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
  res.send(Buffer.from(buffer));
}));

app.post('/api/import', importUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded.');
  const { headers, rows } = await parseSpreadsheet(req.file.buffer, req.file.originalname);
  if (headers.length === 0) throw badRequest('The file is empty.');
  const { missingColumns, items } = validateRows(headers, rows);
  res.json({
    filename: req.file.originalname,
    total: items.length,
    validCount: items.filter((i) => i.valid).length,
    missingColumns,
    items,
  });
}));

// ---------- Image upload (single per product, or bulk matched by Item Code) ----------
// pdfkit only renders JPEG/PNG, so every upload is normalized to a baseline JPEG
// (EXIF auto-rotated, transparency flattened to white, capped at 1600px).
async function normalizeImage(file) {
  const outName = `${crypto.randomUUID()}.jpg`;
  const buffer = await sharp(file.buffer)
    .rotate()
    .flatten({ background: '#FFFFFF' })
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  await storage.write(outName, buffer, 'image/jpeg');
  return outName;
}

app.post('/api/upload/images', imageUpload.array('images', 300), asyncRoute(async (req, res) => {
  if (!req.files || req.files.length === 0) throw badRequest('No images uploaded.');
  const explicitCode = String(req.body.itemCode || '').trim();
  const files = [];
  try {
    for (const f of req.files) {
      let outName;
      try {
        outName = await normalizeImage(f);
      } catch {
        throw badRequest(`"${f.originalname}" is not a readable image file.`);
      }
      files.push({
        url: `/uploads/${outName}`,
        itemCode: explicitCode || path.parse(f.originalname).name.trim(),
        originalName: f.originalname,
      });
    }
  } catch (e) {
    for (const done of files) await storage.remove(path.basename(done.url));
    throw e;
  }
  res.json({ files });
}));

// ---------- Product records ----------
app.get('/api/products', asyncRoute(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const search = String(req.query.search || '').trim();
  const where = search ? 'WHERE p.item_code LIKE ? OR p.item_description LIKE ? OR p.principal LIKE ? OR p.item_category LIKE ?' : '';
  const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];
  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM products p ${where}`).get(...params)).c;
  const items = await db.prepare(`
    SELECT p.*, a.title AS announcement_title, a.memo_no, a.created_at AS announced_at, a.status
    FROM products p JOIN announcements a ON a.id = p.announcement_id
    ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, items });
}));

// ---------- Public (store-facing, no login required) ----------
app.get('/api/public/:slug', asyncRoute(async (req, res) => {
  const a = await db.prepare("SELECT * FROM announcements WHERE slug = ? AND status = 'sent'").get(req.params.slug);
  if (!a) throw notFound('Announcement not found or not yet cascaded.');
  res.json({
    title: a.title,
    memo_no: a.memo_no,
    effective_date: a.effective_date,
    intro: a.intro,
    prepared_by: a.prepared_by,
    from_sender: a.from_sender,
    created_at: a.created_at,
    products: (await getProducts(a.id)).map((p) => ({
      item_code: p.item_code,
      item_description: p.item_description,
      short_description: p.short_description,
      image_path: p.image_path,
      sort_order: p.sort_order,
      packaging: p.packaging,
      uom_group_name: p.uom_group_name,
      retail_price: p.retail_price,
    })),
    stores: (await getTargets(a.id)).map((t) => ({
      store_id: t.store_id,
      store_name: t.store_name,
      store_code: t.store_code,
      acknowledged_at: t.acknowledged_at,
    })),
  });
}));

app.post('/api/public/:slug/ack', asyncRoute(async (req, res) => {
  const a = await db.prepare("SELECT * FROM announcements WHERE slug = ? AND status = 'sent'").get(req.params.slug);
  if (!a) throw notFound('Announcement not found or not yet cascaded.');
  const storeId = Number(req.body.storeId);
  const name = String(req.body.name || '').trim();
  if (!name) throw badRequest('Your name is required to acknowledge.');
  const target = await db.prepare('SELECT * FROM announcement_stores WHERE announcement_id = ? AND store_id = ?').get(a.id, storeId);
  if (!target) throw badRequest('This store is not a recipient of the announcement.');
  if (target.acknowledged_at) {
    return res.status(409).json({ error: `Already acknowledged on ${target.acknowledged_at} UTC by ${target.acknowledged_by}.` });
  }
  await db.prepare("UPDATE announcement_stores SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ?").run(name, target.id);
  res.json({ ok: true });
}));

// ---------- Errors ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (limit 10 MB per image, 15 MB per import).'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Too many files in one upload (max 300).'
      : `Upload error: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : err.message });
});

// ---------- Startup ----------
async function seedAdmin() {
  if ((await userCount()) > 0) return;
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (username && password) {
    if (password.length < 8) { console.error('FATAL: ADMIN_PASSWORD must be at least 8 characters.'); process.exit(1); }
    await db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
    console.log(`Admin account "${username}" created from ADMIN_USERNAME / ADMIN_PASSWORD.`);
  } else if (IS_PRODUCTION) {
    console.warn('WARNING: No admin account exists. Set ADMIN_USERNAME and ADMIN_PASSWORD, then redeploy.');
  } else {
    console.log('No admin account yet. Open the app to create one on the login screen (first-run setup).');
  }
}

async function start() {
  await db.init();
  await seedAdmin();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`New Product Cascading System listening on 0.0.0.0:${PORT} (${db.IS_PG ? 'PostgreSQL' : 'SQLite'} mode)`);
  });
}

start().catch((e) => { console.error('Startup failed:', e); process.exit(1); });