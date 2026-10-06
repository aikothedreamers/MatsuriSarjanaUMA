const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const MIDTRANS_ENV = (process.env.MIDTRANS_ENV || (IS_PRODUCTION ? 'production' : 'sandbox')).toLowerCase();
const REGISTRATION_FEE_IDR = Math.max(0, Number(process.env.REGISTRATION_FEE_IDR || 0));
const ADMIN_WHATSAPP_TO = process.env.ADMIN_WHATSAPP_TO || '';
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || '';
const DATA_DIR = path.join(__dirname, 'data');
const REGISTRATIONS_FILE = path.join(DATA_DIR, 'registrations.json');

if (!ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
  console.error('Missing ADMIN_PASSWORD_HASH or SESSION_SECRET. Copy .env.example to .env and configure them.');
  process.exit(1);
}

if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must contain at least 32 characters of entropy.');
  process.exit(1);
}

const sessions = new Map();
const loginAttempts = new Map();
const publicRoot = __dirname;

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

function cookieName(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = IS_PRODUCTION || proto === 'https' || !!req.socket.encrypted;
  return secure ? '__Host-ml_admin' : 'ml_admin';
}

function setCookie(res, req, token, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = IS_PRODUCTION || proto === 'https' || !!req.socket.encrypted;
  const parts = [
    `${cookieName(req)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, req) {
  const names = [cookieName(req), 'ml_admin', '__Host-ml_admin'];
  res.setHeader('Set-Cookie', names.map(name => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`).join(', '));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[cookieName(req)] || cookies.ml_admin || cookies['__Host-ml_admin'];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function isAuthenticated(req) {
  return !!getSession(req);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimitOk(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + 10 * 60 * 1000;
  }
  current.count += 1;
  loginAttempts.set(ip, current);
  return current.count <= 8;
}

function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 16 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function securityHeaders(res, req) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (IS_PRODUCTION || proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.statusCode = 400; return res.end('Bad request'); }
  if (decoded.includes('\\') || decoded.includes('..')) { res.statusCode = 400; return res.end('Bad request'); }
  let filePath = path.join(publicRoot, decoded === '/' ? 'index.html' : decoded.replace(/^\//, ''));
  if (!filePath.startsWith(publicRoot)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) { res.statusCode = 404; return res.end('Not found'); }
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
      if (path.basename(filePath) === 'admin.html') res.setHeader('Cache-Control', 'no-store');
      res.end(data);
    });
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  for (const [ip, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(ip);
}, 10 * 60 * 1000).unref();


const skillCache = { data: null, fetchedAt: 0 };
const skillIconCache = new Map();

async function getGameToraSkills() {
  const now = Date.now();
  if (skillCache.data && now - skillCache.fetchedAt < 6 * 60 * 60 * 1000) return skillCache.data;
  const response = await fetch('https://gametora.com/loc/umamusume/skills.json', {
    headers: { 'User-Agent': 'Matsuri-Light/1.0' }
  });
  if (!response.ok) throw new Error(`GameTora skills HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Invalid GameTora skills payload');
  skillCache.data = data;
  skillCache.fetchedAt = now;
  return data;
}

function skillIdCandidates(id) {
  const key = String(id || '');
  const out = [];
  const add = v => { if (v && !out.includes(String(v))) out.push(String(v)); };
  add(key);
  if (/^9\d{5}$/.test(key)) add('1' + key.slice(1));
  if (/^91\d{5}$/.test(key)) add('1' + key.slice(2));
  return out;
}

async function getSkillIconId(id) {
  for (const candidate of skillIdCandidates(id)) {
    if (skillIconCache.has(candidate)) return skillIconCache.get(candidate);
    try {
      const response = await fetch(`https://umamusu.wiki/Game:Skills/${encodeURIComponent(candidate)}`, {
        headers: { 'User-Agent': 'Matsuri-Light/1.0' }
      });
      if (!response.ok) continue;
      const html = await response.text();
      const match = html.match(/Game[_ ]Skill[_ ]Icon[_ ](\d+)\.png/i);
      if (match) {
        skillIconCache.set(candidate, match[1]);
        return match[1];
      }
    } catch {}
  }
  return null;
}



function ensureDataStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRATIONS_FILE)) fs.writeFileSync(REGISTRATIONS_FILE, '[]\n', 'utf8');
}
function readRegistrations() {
  ensureDataStore();
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRATIONS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
let registrationWriteQueue = Promise.resolve();
function writeRegistrations(data) {
  registrationWriteQueue = registrationWriteQueue.then(async () => {
    ensureDataStore();
    const tmp = `${REGISTRATIONS_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await fs.promises.rename(tmp, REGISTRATIONS_FILE);
  });
  return registrationWriteQueue;
}
function registrationPublicView(r) {
  return {
    orderId: r.orderId, teamName: r.teamName, captainName: r.captainName,
    whatsapp: r.whatsapp, members: r.members, paymentStatus: r.paymentStatus,
    createdAt: r.createdAt, paidAt: r.paidAt || null
  };
}
function normalizeWhatsapp(value) {
  const raw = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw.slice(1);
  if (raw.startsWith('08')) return '62' + raw.slice(1);
  return raw;
}
function makeOrderId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/\D/g, '').slice(0, 14);
  return `ML-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function midtransBase() {
  return MIDTRANS_ENV === 'production' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
}
function midtransAuthHeader() {
  return 'Basic ' + Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64');
}
function verifyMidtransSignature(payload) {
  if (!MIDTRANS_SERVER_KEY) return false;
  const raw = `${payload.order_id || ''}${payload.status_code || ''}${payload.gross_amount || ''}${MIDTRANS_SERVER_KEY}`;
  const expected = crypto.createHash('sha512').update(raw).digest('hex');
  return timingSafeEqualText(expected, String(payload.signature_key || ''));
}
function paymentStatusFromNotification(payload) {
  const status = String(payload.transaction_status || '').toLowerCase();
  const fraud = String(payload.fraud_status || '').toLowerCase();
  if (status === 'settlement') return 'PAID';
  if (status === 'capture' && (!fraud || fraud === 'accept')) return 'PAID';
  if (status === 'pending') return 'PENDING';
  if (['deny', 'cancel', 'expire', 'failure'].includes(status)) return 'FAILED';
  return 'PENDING';
}
async function sendAdminWhatsApp(registration) {
  if (!FONNTE_TOKEN || !ADMIN_WHATSAPP_TO) return { skipped: true };
  const message = [
    '🏁 *MATSURI LIGHT — PAYMENT CONFIRMED*',
    '',
    `Team: ${registration.teamName}`,
    `Captain: ${registration.captainName}`,
    `WhatsApp: ${registration.whatsapp}`,
    `Order ID: ${registration.orderId}`,
    `Amount: Rp ${Number(registration.amount || 0).toLocaleString('id-ID')}`,
    `Roster: ${registration.members.map((m, i) => `${i + 1}. ${m.name}`).join(' | ')}`,
    '', 'Status: PAID / REGISTERED'
  ].join('\n');
  const form = new FormData();
  form.set('target', ADMIN_WHATSAPP_TO);
  form.set('message', message);
  form.set('countryCode', '62');
  const response = await fetch('https://api.fonnte.com/send', {
    method: 'POST', headers: { Authorization: FONNTE_TOKEN }, body: form
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data.status !== false, data };
}
async function createMidtransSnap(registration) {
  if (!MIDTRANS_SERVER_KEY) throw new Error('Midtrans server key belum dikonfigurasi.');
  const body = {
    transaction_details: { order_id: registration.orderId, gross_amount: registration.amount },
    item_details: [{ id: 'ML-REGISTRATION', price: registration.amount, quantity: 1, name: 'Matsuri Light Team Registration' }],
    customer_details: { first_name: registration.captainName, phone: registration.whatsapp },
    enabled_payments: ['gopay'],
    expiry: { unit: 'minutes', duration: 15 }
  };
  const response = await fetch(`${midtransBase()}/snap/v1/transactions`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: midtransAuthHeader() },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error_messages?.join(', ') || 'Gagal membuat pembayaran Midtrans.');
  return data;
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res, req);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;


  if (pathname === '/api/skills' && req.method === 'GET') {
    try {
      const skills = await getGameToraSkills();
      return sendJson(res, 200, skills);
    } catch (err) {
      return sendJson(res, 502, { ok: false, error: 'Unable to load the GameTora global skill database.' });
    }
  }

  if (pathname === '/api/skill-icon' && req.method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    if (!/^\d{4,12}$/.test(id)) return sendJson(res, 400, { ok: false, error: 'Invalid skill id.' });
    try {
      const iconId = await getSkillIconId(id);
      if (!iconId) return sendJson(res, 404, { ok: false, error: 'Skill icon not found.' });
      res.statusCode = 302;
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Location', `https://media.gametora.com/umamusume/skills/icon/${iconId}.png`);
      return res.end();
    } catch {
      return sendJson(res, 502, { ok: false, error: 'Unable to resolve skill icon.' });
    }
  }


  if (pathname === '/api/payment/config' && req.method === 'GET') {
    return sendJson(res, 200, { enabled: Boolean(MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY && REGISTRATION_FEE_IDR > 0), clientKey: MIDTRANS_CLIENT_KEY, amount: REGISTRATION_FEE_IDR, paymentMethod: 'gopay', environment: MIDTRANS_ENV });
  }

  if (pathname === '/api/registrations' && req.method === 'POST') {
    if (!MIDTRANS_SERVER_KEY || REGISTRATION_FEE_IDR <= 0) return sendJson(res, 503, { ok: false, error: 'Registrasi pembayaran belum dikonfigurasi oleh admin.' });
    try {
      const body = await readJson(req);
      const teamName = String(body.teamName || '').trim();
      const captainName = String(body.captainName || '').trim();
      const whatsapp = normalizeWhatsapp(body.whatsapp);
      const members = Array.isArray(body.members) ? body.members.map(m => ({ name: String(m?.name || '').trim() })).filter(m => m.name) : [];
      if (teamName.length < 2 || teamName.length > 40) throw new Error('Nama team harus 2–40 karakter.');
      if (captainName.length < 2 || captainName.length > 60) throw new Error('Nama captain harus 2–60 karakter.');
      if (!/^62\d{8,15}$/.test(whatsapp)) throw new Error('Nomor WhatsApp tidak valid. Gunakan 08xx atau 62xx.');
      if (members.length < 3 || members.length > 5) throw new Error('Roster wajib berisi 3–5 Uma.');
      const registrations = readRegistrations();
      const duplicate = registrations.find(r => r.teamName.toLowerCase() === teamName.toLowerCase() && ['PENDING','PAID'].includes(r.paymentStatus));
      if (duplicate) return sendJson(res, 409, { ok: false, error: 'Nama team sudah memiliki registrasi aktif.', orderId: duplicate.orderId });
      const registration = { orderId: makeOrderId(), accessToken: randomToken(24), teamName, captainName, whatsapp, members, amount: REGISTRATION_FEE_IDR, paymentStatus: 'PENDING', createdAt: new Date().toISOString(), paidAt: null, paymentType: null, paymentReference: null, waNotifiedAt: null };
      const snap = await createMidtransSnap(registration);
      registration.snapToken = snap.token;
      registration.redirectUrl = snap.redirect_url || null;
      registrations.push(registration);
      await writeRegistrations(registrations);
      return sendJson(res, 201, { ok: true, orderId: registration.orderId, accessToken: registration.accessToken, snapToken: snap.token, redirectUrl: snap.redirect_url || null, amount: registration.amount });
    } catch (err) { return sendJson(res, 400, { ok: false, error: err.message || 'Registrasi gagal.' }); }
  }

  if (pathname === '/api/registrations/public' && req.method === 'GET') {
    const paid = readRegistrations().filter(r => r.paymentStatus === 'PAID');
    return sendJson(res, 200, paid.map(registrationPublicView));
  }

  if (pathname.startsWith('/api/registrations/') && req.method === 'GET') {
    const orderId = decodeURIComponent(pathname.slice('/api/registrations/'.length));
    const accessToken = String(url.searchParams.get('accessToken') || '');
    const registration = readRegistrations().find(r => r.orderId === orderId && r.accessToken === accessToken);
    if (!registration) return sendJson(res, 404, { ok: false, error: 'Registration not found.' });
    return sendJson(res, 200, registrationPublicView(registration));
  }

  if (pathname === '/api/registrations/admin' && req.method === 'GET') {
    if (!isAuthenticated(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
    const data = readRegistrations().map(r => ({ ...r, snapToken: undefined, accessToken: undefined }));
    return sendJson(res, 200, data);
  }

  if (pathname === '/api/midtrans/notification' && req.method === 'POST') {
    try {
      const payload = await readJson(req);
      if (!verifyMidtransSignature(payload)) return sendJson(res, 401, { ok: false, error: 'Invalid Midtrans signature.' });
      const registrations = readRegistrations();
      const index = registrations.findIndex(r => r.orderId === String(payload.order_id || ''));
      if (index < 0) return sendJson(res, 404, { ok: false, error: 'Unknown order.' });
      const registration = registrations[index];
      if (Number(payload.gross_amount) !== Number(registration.amount)) return sendJson(res, 400, { ok: false, error: 'Amount mismatch.' });
      const nextStatus = paymentStatusFromNotification(payload);
      const wasPaid = registration.paymentStatus === 'PAID';
      registration.paymentStatus = nextStatus;
      registration.paymentType = payload.payment_type || registration.paymentType || null;
      registration.paymentReference = payload.transaction_id || registration.paymentReference || null;
      if (nextStatus === 'PAID' && !registration.paidAt) registration.paidAt = new Date().toISOString();
      registrations[index] = registration;
      await writeRegistrations(registrations);
      if (nextStatus === 'PAID' && !wasPaid && !registration.waNotifiedAt) {
        try { const wa = await sendAdminWhatsApp(registration); if (wa.ok) { registration.waNotifiedAt = new Date().toISOString(); registrations[index] = registration; await writeRegistrations(registrations); } } catch (waErr) { console.error('Fonnte notification failed:', waErr.message); }
      }
      return sendJson(res, 200, { ok: true });
    } catch (err) { return sendJson(res, 400, { ok: false, error: err.message || 'Invalid notification.' }); }
  }

  if (pathname === '/api/auth/status' && req.method === 'GET') {
    return sendJson(res, 200, { authenticated: isAuthenticated(req) });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!rateLimitOk(ip)) return sendJson(res, 429, { ok: false, error: 'Too many login attempts. Try again later.' });
    try {
      const body = await readJson(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password || password.length > 256 || !verifyPassword(password, ADMIN_PASSWORD_HASH)) {
        return sendJson(res, 401, { ok: false, error: 'Invalid credentials.' });
      }
      clearRateLimit(ip);
      const token = randomToken(32);
      sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
      setCookie(res, req, token);
      return sendJson(res, 200, { ok: true, authenticated: true });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || 'Invalid request.' });
    }
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const session = getSession(req);
    if (session) sessions.delete(session.token);
    clearCookie(res, req);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/admin.html') {
    if (!isAuthenticated(req)) {
      res.statusCode = 302;
      res.setHeader('Location', '/?admin=login');
      return res.end();
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end('Method Not Allowed');
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Matsuri Light running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
