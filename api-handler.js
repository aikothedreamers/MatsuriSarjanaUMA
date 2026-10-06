const crypto = require('crypto');
const { URL } = require('url');
const { neon } = require('@neondatabase/serverless');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const MIDTRANS_ENV = (process.env.MIDTRANS_ENV || 'sandbox').toLowerCase();
const REGISTRATION_FEE_IDR = Math.max(0, Number(process.env.REGISTRATION_FEE_IDR || 0));
const ADMIN_WHATSAPP_TO = process.env.ADMIN_WHATSAPP_TO || '';
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || '';
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

let sql;
let dbInit;
const skillCache = { data: null, fetchedAt: 0 };
const skillIconCache = new Map();
const loginAttempts = new Map();

function getDb() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL belum dikonfigurasi. Hubungkan Neon/Postgres ke Vercel.');
  if (!sql) sql = neon(DATABASE_URL);
  return sql;
}

async function initDb() {
  if (dbInit) return dbInit;
  dbInit = (async () => {
    const db = getDb();
    await db`CREATE TABLE IF NOT EXISTS ml_registrations (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      access_token TEXT UNIQUE NOT NULL,
      team_name TEXT NOT NULL,
      captain_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      members JSONB NOT NULL,
      amount INTEGER NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      payment_type TEXT,
      payment_reference TEXT,
      snap_token TEXT,
      redirect_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      wa_notified_at TIMESTAMPTZ
    )`;
    await db`CREATE INDEX IF NOT EXISTS ml_reg_team_name_idx ON ml_registrations (LOWER(team_name))`;
    await db`CREATE TABLE IF NOT EXISTS ml_sessions (
      token TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )`;
  })();
  return dbInit;
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 32 * 1024) return reject(new Error('Request too large'));
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('='); if (idx < 0) continue;
    const key = part.slice(0, idx).trim(); const value = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}
function cookieName() { return '__Host-ml_admin'; }
function setCookie(res, token, maxAge = SESSION_TTL_MS / 1000) {
  res.setHeader('Set-Cookie', `${cookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAge)}`);
}
function clearCookie(res) { res.setHeader('Set-Cookie', `${cookieName()}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`); }
async function getSession(req) {
  const token = parseCookies(req)[cookieName()];
  if (!token) return null;
  const db = getDb();
  const rows = await db`SELECT token, expires_at FROM ml_sessions WHERE token=${token} AND expires_at > NOW() LIMIT 1`;
  return rows[0] || null;
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim(); }
function rateLimitOk(ip) {
  const now = Date.now();
  let x = loginAttempts.get(ip);
  if (!x || x.resetAt <= now) x = { count: 0, resetAt: now + 10 * 60 * 1000 };
  x.count++; loginAttempts.set(ip, x);
  return x.count <= 8;
}
function clearRateLimit(ip) { loginAttempts.delete(ip); }

function normalizeWhatsapp(value) {
  const raw = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw.slice(1);
  if (raw.startsWith('08')) return '62' + raw.slice(1);
  return raw;
}
function makeOrderId() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `ML-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function midtransBase() { return MIDTRANS_ENV === 'production' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com'; }
function midtransAuthHeader() { return 'Basic ' + Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64'); }
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
  const message = ['🏁 *MATSURI LIGHT — PAYMENT CONFIRMED*','',`Team: ${registration.teamName}`,`Captain: ${registration.captainName}`,`WhatsApp: ${registration.whatsapp}`,`Order ID: ${registration.orderId}`,`Amount: Rp ${Number(registration.amount || 0).toLocaleString('id-ID')}`,`Roster: ${registration.members.map((m,i)=>`${i+1}. ${m.name}`).join(' | ')}`,'','Status: PAID / REGISTERED'].join('\n');
  const form = new FormData(); form.set('target', ADMIN_WHATSAPP_TO); form.set('message', message); form.set('countryCode', '62');
  const response = await fetch('https://api.fonnte.com/send', { method:'POST', headers:{Authorization:FONNTE_TOKEN}, body:form });
  const data = await response.json().catch(()=>({}));
  return { ok: response.ok && data.status !== false, data };
}
async function createMidtransSnap(registration) {
  if (!MIDTRANS_SERVER_KEY) throw new Error('Midtrans server key belum dikonfigurasi.');
  const body = { transaction_details:{order_id:registration.orderId,gross_amount:registration.amount}, item_details:[{id:'ML-REGISTRATION',price:registration.amount,quantity:1,name:'Matsuri Light Team Registration'}], customer_details:{first_name:registration.captainName,phone:registration.whatsapp}, enabled_payments:['gopay'], expiry:{unit:'minutes',duration:15} };
  const response = await fetch(`${midtransBase()}/snap/v1/transactions`, {method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:midtransAuthHeader()},body:JSON.stringify(body)});
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.token) throw new Error(data.error_messages?.join(', ') || 'Gagal membuat pembayaran Midtrans.');
  return data;
}
function publicView(r) {
  return {orderId:r.order_id,teamName:r.team_name,captainName:r.captain_name,whatsapp:r.whatsapp,members:r.members,paymentStatus:r.payment_status,createdAt:r.created_at,paidAt:r.paid_at || null};
}

async function getGameToraSkills() {
  const now = Date.now();
  if (skillCache.data && now - skillCache.fetchedAt < 6 * 60 * 60 * 1000) return skillCache.data;
  const response = await fetch('https://gametora.com/loc/umamusume/skills.json', {headers:{'User-Agent':'Matsuri-Light/1.0'}});
  if (!response.ok) throw new Error(`GameTora skills HTTP ${response.status}`);
  const data = await response.json(); if (!Array.isArray(data)) throw new Error('Invalid GameTora skills payload');
  skillCache.data = data; skillCache.fetchedAt = now; return data;
}
function skillIdCandidates(id) {
  const key = String(id || ''), out=[]; const add=v=>{if(v&&!out.includes(String(v)))out.push(String(v));};
  add(key); if(/^9\d{5}$/.test(key))add('1'+key.slice(1)); if(/^91\d{5}$/.test(key))add('1'+key.slice(2)); return out;
}
async function getSkillIconId(id) {
  for (const candidate of skillIdCandidates(id)) {
    if (skillIconCache.has(candidate)) return skillIconCache.get(candidate);
    try {
      const response = await fetch(`https://umamusu.wiki/Game:Skills/${encodeURIComponent(candidate)}`, {headers:{'User-Agent':'Matsuri-Light/1.0'}});
      if (!response.ok) continue;
      const html = await response.text(); const match=html.match(/Game[_ ]Skill[_ ]Icon[_ ](\d+)\.png/i);
      if(match){skillIconCache.set(candidate,match[1]);return match[1];}
    } catch {}
  }
  return null;
}

async function handler(req, res) {
  securityHeaders(res);
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/skills' && req.method === 'GET') {
      try { return sendJson(res,200,await getGameToraSkills()); } catch { return sendJson(res,502,{ok:false,error:'Unable to load the GameTora global skill database.'}); }
    }
    if (pathname === '/api/skill-icon' && req.method === 'GET') {
      const id=String(url.searchParams.get('id')||''); if(!/^\d{4,12}$/.test(id))return sendJson(res,400,{ok:false,error:'Invalid skill id.'});
      try { const iconId=await getSkillIconId(id); if(!iconId)return sendJson(res,404,{ok:false,error:'Skill icon not found.'}); res.statusCode=302;res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('Location',`https://media.gametora.com/umamusume/skills/icon/${iconId}.png`);return res.end(); } catch { return sendJson(res,502,{ok:false,error:'Unable to resolve skill icon.'}); }
    }
    if (pathname === '/api/payment/config' && req.method === 'GET') {
      return sendJson(res,200,{enabled:Boolean(MIDTRANS_SERVER_KEY&&MIDTRANS_CLIENT_KEY&&REGISTRATION_FEE_IDR>0&&DATABASE_URL),clientKey:MIDTRANS_CLIENT_KEY,amount:REGISTRATION_FEE_IDR,paymentMethod:'gopay',environment:MIDTRANS_ENV});
    }

    if (pathname === '/api/registrations' && req.method === 'POST') {
      if (!MIDTRANS_SERVER_KEY || REGISTRATION_FEE_IDR <= 0) return sendJson(res,503,{ok:false,error:'Registrasi pembayaran belum dikonfigurasi oleh admin.'});
      await initDb(); const db=getDb(); const body=await readJson(req);
      const teamName=String(body.teamName||'').trim(), captainName=String(body.captainName||'').trim(), whatsapp=normalizeWhatsapp(body.whatsapp);
      const members=Array.isArray(body.members)?body.members.map(m=>({name:String(m?.name||'').trim()})).filter(m=>m.name):[];
      if(teamName.length<2||teamName.length>40)throw new Error('Nama team harus 2–40 karakter.');
      if(captainName.length<2||captainName.length>60)throw new Error('Nama captain harus 2–60 karakter.');
      if(!/^62\d{8,15}$/.test(whatsapp))throw new Error('Nomor WhatsApp tidak valid. Gunakan 08xx atau 62xx.');
      if(members.length<3||members.length>5)throw new Error('Roster wajib berisi 3–5 Uma.');
      const dup=await db`SELECT order_id FROM ml_registrations WHERE LOWER(team_name)=LOWER(${teamName}) AND payment_status IN ('PENDING','PAID') LIMIT 1`;
      if(dup.length)return sendJson(res,409,{ok:false,error:'Nama team sudah memiliki registrasi aktif.',orderId:dup[0].order_id});
      const registration={orderId:makeOrderId(),accessToken:randomToken(24),teamName,captainName,whatsapp,members,amount:REGISTRATION_FEE_IDR};
      const snap=await createMidtransSnap(registration);
      await db`INSERT INTO ml_registrations (order_id,access_token,team_name,captain_name,whatsapp,members,amount,payment_status,snap_token,redirect_url) VALUES (${registration.orderId},${registration.accessToken},${teamName},${captainName},${whatsapp},${JSON.stringify(members)}::jsonb,${REGISTRATION_FEE_IDR},'PENDING',${snap.token},${snap.redirect_url||null})`;
      return sendJson(res,201,{ok:true,orderId:registration.orderId,accessToken:registration.accessToken,snapToken:snap.token,redirectUrl:snap.redirect_url||null,amount:registration.amount});
    }

    if (pathname === '/api/registrations/public' && req.method === 'GET') {
      await initDb(); const db=getDb(); const rows=await db`SELECT order_id,team_name,captain_name,whatsapp,members,payment_status,created_at,paid_at FROM ml_registrations WHERE payment_status='PAID' ORDER BY created_at ASC`;
      return sendJson(res,200,rows.map(publicView));
    }
    if (pathname.startsWith('/api/registrations/') && req.method === 'GET') {
      await initDb(); const db=getDb(); const orderId=decodeURIComponent(pathname.slice('/api/registrations/'.length)); const accessToken=String(url.searchParams.get('accessToken')||'');
      const rows=await db`SELECT order_id,team_name,captain_name,whatsapp,members,payment_status,created_at,paid_at FROM ml_registrations WHERE order_id=${orderId} AND access_token=${accessToken} LIMIT 1`;
      if(!rows.length)return sendJson(res,404,{ok:false,error:'Registration not found.'}); return sendJson(res,200,publicView(rows[0]));
    }
    if (pathname === '/api/registrations/admin' && req.method === 'GET') {
      if(!await getSession(req))return sendJson(res,401,{ok:false,error:'Unauthorized.'});
      await initDb(); const db=getDb(); const rows=await db`SELECT id,order_id,team_name,captain_name,whatsapp,members,amount,payment_status,payment_type,payment_reference,redirect_url,created_at,paid_at,wa_notified_at FROM ml_registrations ORDER BY created_at DESC`;
      return sendJson(res,200,rows);
    }

    if (pathname === '/api/midtrans/notification' && req.method === 'POST') {
      await initDb(); const db=getDb(); const payload=await readJson(req);
      if(!verifyMidtransSignature(payload))return sendJson(res,401,{ok:false,error:'Invalid Midtrans signature.'});
      const rows=await db`SELECT * FROM ml_registrations WHERE order_id=${String(payload.order_id||'')} LIMIT 1`;
      if(!rows.length)return sendJson(res,404,{ok:false,error:'Unknown order.'});
      const r=rows[0]; if(Number(payload.gross_amount)!==Number(r.amount))return sendJson(res,400,{ok:false,error:'Amount mismatch.'});
      const nextStatus=paymentStatusFromNotification(payload); const wasPaid=r.payment_status==='PAID';
      await db`UPDATE ml_registrations SET payment_status=${nextStatus},payment_type=${payload.payment_type||r.payment_type||null},payment_reference=${payload.transaction_id||r.payment_reference||null},paid_at=CASE WHEN ${nextStatus}='PAID' AND paid_at IS NULL THEN NOW() ELSE paid_at END WHERE order_id=${r.order_id}`;
      if(nextStatus==='PAID'&&!wasPaid&&!r.wa_notified_at){
        const registration={orderId:r.order_id,teamName:r.team_name,captainName:r.captain_name,whatsapp:r.whatsapp,members:r.members,amount:r.amount};
        try{const wa=await sendAdminWhatsApp(registration);if(wa.ok)await db`UPDATE ml_registrations SET wa_notified_at=NOW() WHERE order_id=${r.order_id}`;}catch(e){console.error('Fonnte notification failed:',e.message);}
      }
      return sendJson(res,200,{ok:true});
    }

    if (pathname === '/api/auth/status' && req.method === 'GET') {
      await initDb(); return sendJson(res,200,{authenticated:Boolean(await getSession(req))});
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if(!ADMIN_PASSWORD_HASH||!SESSION_SECRET)return sendJson(res,503,{ok:false,error:'Admin authentication belum dikonfigurasi.'});
      const ip=clientIp(req);if(!rateLimitOk(ip))return sendJson(res,429,{ok:false,error:'Too many login attempts. Try again later.'});
      const body=await readJson(req);const password=typeof body.password==='string'?body.password:'';
      if(!password||password.length>256||!verifyPassword(password,ADMIN_PASSWORD_HASH))return sendJson(res,401,{ok:false,error:'Invalid credentials.'});
      clearRateLimit(ip); await initDb(); const db=getDb(); const token=randomToken(32); await db`INSERT INTO ml_sessions(token,expires_at) VALUES (${token},NOW()+INTERVAL '8 hours')`; setCookie(res,token); return sendJson(res,200,{ok:true,authenticated:true});
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      await initDb(); const token=parseCookies(req)[cookieName()]; if(token){ const db=getDb(); await db`DELETE FROM ml_sessions WHERE token=${token}`; } clearCookie(res); return sendJson(res,200,{ok:true});
    }
    return sendJson(res,404,{ok:false,error:'API route not found.'});
  } catch (err) {
    console.error(err);
    return sendJson(res,500,{ok:false,error:err.message||'Server error.'});
  }
}

module.exports = handler;
