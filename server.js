/**
 * Kote's Studio — Server
 * ─────────────────────────────────────────────────────
 * Portfolio: http://localhost:3001
 * Admin:     http://localhost:3001/admin  (pw: studio2024)
 */
require('dotenv').config();
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3001;

// Ensure upload dir exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

// ── Database + auto-migrations ─────────────────────────────
const db = new Database(process.env.DB_PATH || 'studio.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS paintings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    medium         TEXT    DEFAULT '',
    dimensions     TEXT    DEFAULT '',
    price          REAL    NOT NULL DEFAULT 0,
    year           TEXT    DEFAULT '',
    description    TEXT    DEFAULT '',
    image_file     TEXT    NOT NULL,
    image_url      TEXT    NOT NULL,
    status         TEXT    DEFAULT 'draft'
                   CHECK(status IN ('draft','live','sold')),
    shopify_id     TEXT,
    shopify_url    TEXT,
    shopify_handle TEXT,
    sort_order     INTEGER DEFAULT 0,
    featured       INTEGER DEFAULT 0,
    created_at     TEXT    DEFAULT (datetime('now')),
    updated_at     TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_paintings_status ON paintings(status);
  CREATE INDEX IF NOT EXISTS idx_paintings_sort   ON paintings(sort_order, created_at);
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
`);

// Additive migrations (idempotent) — safe to run on every startup
const addColumn = (table, col, def) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
  catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
};
addColumn('paintings', 'shopify_variant_id', 'TEXT');

const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
[
  ['studio_name',    'Imani'],
  ['artist_name',    'Imani'],
  ['tagline',        'Original paintings, made with intention.'],
  ['hero_subtitle',  'Each piece is a singular conversation between light, texture, and time — painted in my studio and shipped worldwide, ready to hang.'],
  ['bio_intro',      'A painter working at the intersection of memory, light, and landscape.'],
  ['bio_body',       'I work primarily in oil and acrylic, drawn to the way light transforms the familiar into something profound. My practice explores mood, atmosphere, and the emotional weight of place — from the dense quiet of forests to the luminous expanse of open sky.\n\nI exhibit internationally and accept a small number of commissions each year. Each original arrives with a certificate of authenticity and ships free across the UK and Europe.'],
  ['location',       'London, UK'],
  ['email',          'hello@imani.art'],
  ['instagram',      '@imani'],
  ['instagram_url',  'https://instagram.com/imani'],
  ['tiktok',         '@imani'],
  ['tiktok_url',     'https://tiktok.com/@imani'],
  ['pinterest',      'imani'],
  ['pinterest_url',  'https://pinterest.com/imani'],
  ['medium_primary', 'Oil & Acrylic'],
  ['originals_sold', '140+'],
  ['commissions',    'Open for 2025'],
  ['shipping_info',  'Free UK & Europe · Worldwide available'],
].forEach(([k, v]) => seedSetting.run(k, v));

function getSettings() {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])
  );
}

// ── Auth ───────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'studio2024';
const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

function signToken() {
  const ts  = Date.now().toString();
  const sig = crypto.createHmac('sha256', SECRET).update(ts).digest('hex');
  return Buffer.from(`${ts}.${sig}`).toString('base64url');
}

function verifyToken(raw) {
  if (!raw) return false;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString();
    const [ts, sig] = decoded.split('.');
    const exp = crypto.createHmac('sha256', SECRET).update(ts).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(exp, 'hex'))) return false;
    return (Date.now() - parseInt(ts, 10)) < 24 * 60 * 60 * 1000;
  } catch { return false; }
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'))
);

// ── Image upload ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    const uid = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, uid + path.extname(file.originalname).toLowerCase());
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /jpe?g|png|webp/i.test(file.mimetype)),
});

// ── Shopify helper ─────────────────────────────────────────
async function shopifyFetch(method, endpoint, body = null) {
  const { SHOPIFY_STORE_DOMAIN: d, SHOPIFY_ADMIN_ACCESS_TOKEN: t } = process.env;
  if (!d || !t) throw new Error('Shopify not configured in .env');
  const res = await fetch(`https://${d}/admin/api/2023-10${endpoint}`, {
    method,
    headers: { 'X-Shopify-Access-Token': t, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  if (method === 'DELETE') return null;
  return res.json();
}

// ── Auth routes ────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Incorrect password' });
  res.json({ token: signToken() });
});
app.get('/api/auth/verify', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  res.json({ valid: verifyToken(token) });
});

// ── Settings ───────────────────────────────────────────────
app.get('/api/settings', (_, res) => res.json(getSettings()));

// Public Shopify info (domain only — needed for cart checkout URLs)
app.get('/api/shop-info', (_, res) => {
  res.json({
    shopify_configured: !!(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN),
    shopify_domain:     process.env.SHOPIFY_STORE_DOMAIN || null,
  });
});
app.put('/api/settings', requireAuth, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  db.transaction(data => {
    for (const [k, v] of Object.entries(data)) upsert.run(k, String(v ?? ''));
  })(req.body);
  res.json(getSettings());
});

// ── Paintings — GET (public) ───────────────────────────────
app.get('/api/paintings', (req, res) => {
  const { status, limit, featured } = req.query;
  let sql = 'SELECT * FROM paintings WHERE 1=1';
  const params = [];
  if (status === 'shop')            sql += " AND status='live'";
  else if (status === 'portfolio')  sql += " AND status IN ('live','sold')";
  else if (status)                  { sql += ' AND status=?'; params.push(status); }
  if (featured === '1')             sql += ' AND featured=1';
  sql += ' ORDER BY sort_order ASC, created_at DESC';
  if (limit) sql += ` LIMIT ${Math.min(parseInt(limit)||20, 200)}`;
  res.json({ paintings: db.prepare(sql).all(...params) });
});

app.get('/api/paintings/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM paintings WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ painting: p });
});

// ── Paintings — CREATE ─────────────────────────────────────
app.post('/api/paintings', requireAuth, upload.single('image'), (req, res) => {
  const { title, medium, dimensions, price, description, year } = req.body;
  if (!title?.trim())          return res.status(400).json({ error: 'Title required' });
  if (!price||isNaN(+price))   return res.status(400).json({ error: 'Valid price required' });
  if (!req.file)                return res.status(400).json({ error: 'Image required' });

  const result = db.prepare(`
    INSERT INTO paintings (title,medium,dimensions,price,description,year,image_file,image_url)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    title.trim(), medium||'', dimensions||'', parseFloat(price),
    description||'', year||String(new Date().getFullYear()),
    req.file.filename, `/uploads/${req.file.filename}`
  );
  res.status(201).json({
    painting: db.prepare('SELECT * FROM paintings WHERE id=?').get(result.lastInsertRowid),
  });
});

// ── Paintings — UPDATE ─────────────────────────────────────
app.put('/api/paintings/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM paintings WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const allowed = ['title','medium','dimensions','price','description','year','sort_order','featured'];
  const sets = [], vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  }
  if (!sets.length) return res.json({ painting: p });
  sets.push("updated_at=datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE paintings SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ painting: db.prepare('SELECT * FROM paintings WHERE id=?').get(req.params.id) });
});

// ── Paintings — PUBLISH ────────────────────────────────────
app.post('/api/paintings/:id/publish', requireAuth, async (req, res) => {
  const p = db.prepare('SELECT * FROM paintings WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status === 'live') return res.status(400).json({ error: 'Already live' });

  const hasShopify = !!(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);

  if (hasShopify) {
    try {
      const imageBase64 = fs.readFileSync(path.join(__dirname,'uploads',p.image_file)).toString('base64');
      const s = getSettings();
      const { product } = await shopifyFetch('POST', '/products.json', {
        product: {
          title:        p.title,
          body_html:    `<p>${p.description}</p><p><em>${[p.medium,p.dimensions,p.year].filter(Boolean).join(' · ')}</em></p>`,
          vendor:       s.artist_name || 'Artist Studio',
          product_type: 'Original Painting',
          status:       'active',
          tags:         [p.medium,p.year,'original','painting'].filter(Boolean).join(', '),
          variants: [{
            price: parseFloat(p.price).toFixed(2),
            inventory_policy: 'deny', inventory_quantity: 1,
            fulfillment_service: 'manual', requires_shipping: true,
          }],
          images: [{ attachment: imageBase64, filename: p.image_file, alt: p.title }],
        },
      });
      db.prepare(`
        UPDATE paintings SET status='live',shopify_id=?,shopify_variant_id=?,shopify_url=?,shopify_handle=?,updated_at=datetime('now') WHERE id=?
      `).run(
        String(product.id),
        String(product.variants[0].id),
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${product.handle}`,
        product.handle,
        p.id
      );
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  } else {
    db.prepare("UPDATE paintings SET status='live',updated_at=datetime('now') WHERE id=?").run(p.id);
  }
  res.json({ painting: db.prepare('SELECT * FROM paintings WHERE id=?').get(p.id), shopify: hasShopify });
});

// ── Paintings — SOLD ───────────────────────────────────────
app.post('/api/paintings/:id/sold', requireAuth, async (req, res) => {
  const p = db.prepare('SELECT * FROM paintings WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.shopify_id && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    try {
      const { product } = await shopifyFetch('GET', `/products/${p.shopify_id}.json`);
      const vid = product.variants[0].id;
      await shopifyFetch('PUT', `/variants/${vid}.json`, { variant: { id: vid, inventory_quantity: 0 } });
    } catch (e) { console.warn('Shopify sold-sync failed:', e.message); }
  }
  db.prepare("UPDATE paintings SET status='sold',updated_at=datetime('now') WHERE id=?").run(p.id);
  res.json({ painting: db.prepare('SELECT * FROM paintings WHERE id=?').get(p.id) });
});

// ── Paintings — DELETE ─────────────────────────────────────
app.delete('/api/paintings/:id', requireAuth, async (req, res) => {
  const p = db.prepare('SELECT * FROM paintings WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.shopify_id && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    try { await shopifyFetch('DELETE', `/products/${p.shopify_id}.json`); }
    catch (e) { console.warn('Shopify delete failed:', e.message); }
  }
  const fp = path.join(__dirname, 'uploads', p.image_file);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM paintings WHERE id=?').run(p.id);
  res.json({ success: true });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🎨  Artist Studio\n');
  console.log(`   Portfolio  →  http://localhost:${PORT}`);
  console.log(`   Admin      →  http://localhost:${PORT}/admin`);
  console.log(`   Password   →  ${ADMIN_PASSWORD}`);
  if (!process.env.SHOPIFY_STORE_DOMAIN)
    console.log('\n   Shopify not configured — paintings go live locally.\n   Add SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN to .env to enable.');
  console.log('');
});
