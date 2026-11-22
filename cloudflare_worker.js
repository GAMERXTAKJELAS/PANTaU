/* PANTaU — Cloudflare Worker
   Serves the API under /api/* (D1 database) and the static pages through the ASSETS binding. */

const COOKIE_NAME = 'pantau_session';
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers allows at most 100,000
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DUMMY_SALT = '00'.repeat(16);

// Same limits as the form on the dashboard.
const READING_FIELDS = [
  { key: 'systolic', min: 50, max: 300 },
  { key: 'diastolic', min: 30, max: 200 },
  { key: 'bp_bpm', min: 20, max: 250 },
  { key: 'spo2', min: 50, max: 100 },
  { key: 'oximeter_bpm', min: 20, max: 250 }
];

class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/* ---------- Small helpers ---------- */
function sqlTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' '); // UTC, same format as datetime('now')
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  for (const [name, value] of Object.entries(extraHeaders)) headers.append(name, value);
  return new Response(JSON.stringify(data), { status, headers });
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toHex(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Same rules as the front end: the two-digit year is read as 19xx when later than the current year.
function parseIC(ic, now = new Date()) {
  if (!/^\d{12}$/.test(ic)) return null;
  const yy = Number(ic.slice(0, 2));
  const mm = Number(ic.slice(2, 4));
  const dd = Number(ic.slice(4, 6));
  const year = yy > now.getUTCFullYear() % 100 ? 1900 + yy : 2000 + yy;

  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) return null;
  if (dob > now) return null;

  const birthDate = year + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  return { birthDate, gender: Number(ic[11]) % 2 === 1 ? 'Male' : 'Female' };
}

function ageFrom(birthDate, now = new Date()) {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  const month = now.getUTCMonth() + 1;
  if (month < m || (month === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

function cookieHeader(token, expires, secure) {
  return COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Expires=' + expires.toUTCString() + (secure ? '; Secure' : '');
}

function clearCookieHeader(secure) {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 4096) throw new ApiError('invalid_input', 413);
  let data;
  try {
    data = await request.json();
  } catch (e) {
    throw new ApiError('invalid_input', 400);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('invalid_input', 400);
  return data;
}

function requireMethod(request, method) {
  if (request.method !== method) throw new ApiError('method_not_allowed', 405);
}

// Blocks requests that come from another website.
function checkOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw new ApiError('forbidden', 403);
}

/* ---------- Sessions ---------- */
async function getSession(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([0-9a-f]{64})'));
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1]);
  return env.DB.prepare(
    'SELECT u.id, u.ic, u.name, u.role, u.birth_date, u.gender ' +
    'FROM sessions s JOIN users u ON u.id = s.user_id ' +
    'WHERE s.token_hash = ?1 AND s.expires_at > ?2'
  ).bind(tokenHash, sqlTime(new Date())).first();
}

async function requireSession(request, env) {
  const session = await getSession(request, env);
  if (!session) throw new ApiError('unauthorized', 401);
  return session;
}

/* ---------- Endpoints ---------- */
async function signup(request, env) {
  requireMethod(request, 'POST');
  const body = await readJson(request);

  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const ic = typeof body.ic === 'string' ? body.ic.replace(/\D/g, '') : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';

  if (name.length < 2 || name.length > 100 || !/^\d{4,6}$/.test(pin)) throw new ApiError('invalid_input', 400);
  const info = parseIC(ic);
  if (!info) throw new ApiError('invalid_ic', 400);

  const salt = randomHex(16);
  const pinHash = await hashPin(pin, salt);

  try {
    await env.DB.prepare(
      'INSERT INTO users (ic, name, pin_hash, pin_salt, birth_date, gender) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    ).bind(ic, name, pinHash, salt, info.birthDate, info.gender).run();
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) throw new ApiError('already_registered', 409);
    throw err;
  }
  return json({ ok: true }, 201);
}

async function login(request, env, url) {
  requireMethod(request, 'POST');
  const body = await readJson(request);

  const ic = typeof body.ic === 'string' ? body.ic.replace(/\D/g, '') : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!/^\d{12}$/.test(ic) || !/^\d{4,6}$/.test(pin)) throw new ApiError('invalid_credentials', 401);

  const now = new Date();
  const nowText = sqlTime(now);

  const user = await env.DB.prepare(
    'SELECT id, role, pin_hash, pin_salt, failed_attempts, locked_until FROM users WHERE ic = ?1'
  ).bind(ic).first();

  if (!user) {
    await hashPin(pin, DUMMY_SALT); // keeps the response time similar for unknown IC numbers
    throw new ApiError('invalid_credentials', 401);
  }

  if (user.locked_until && user.locked_until > nowText) throw new ApiError('too_many_attempts', 429);

  const attempt = await hashPin(pin, user.pin_salt);
  if (!safeEqual(attempt, user.pin_hash)) {
    const failed = user.failed_attempts + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      const until = sqlTime(new Date(now.getTime() + LOCK_MINUTES * 60000));
      await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = ?1 WHERE id = ?2').bind(until, user.id).run();
    } else {
      await env.DB.prepare('UPDATE users SET failed_attempts = ?1 WHERE id = ?2').bind(failed, user.id).run();
    }
    throw new ApiError('invalid_credentials', 401);
  }

  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(nowText),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)').bind(tokenHash, user.id, sqlTime(expires))
  ]);

  return json({ ok: true, role: user.role }, 200, {
    'Set-Cookie': cookieHeader(token, expires, url.protocol === 'https:')
  });
}

async function logout(request, env, url) {
  requireMethod(request, 'POST');
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([0-9a-f]{64})'));
  if (match) {
    const tokenHash = await sha256Hex(match[1]);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader(url.protocol === 'https:') });
}

async function me(request, env) {
  requireMethod(request, 'GET');
  const user = await requireSession(request, env);
  return json({
    name: user.name,
    ic: user.ic,
    age: ageFrom(user.birth_date),
    gender: user.gender,
    role: user.role
  });
}

async function listReadings(request, env) {
  requireMethod(request, 'GET');
  const user = await requireSession(request, env);
  const { results } = await env.DB.prepare(
    'SELECT id, systolic, diastolic, bp_bpm, spo2, oximeter_bpm, note, created_at ' +
    'FROM readings WHERE user_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 5000'
  ).bind(user.id).all();
  return json({ readings: results });
}

async function addReading(request, env) {
  requireMethod(request, 'POST');
  const user = await requireSession(request, env);
  const body = await readJson(request);

  const values = {};
  for (const field of READING_FIELDS) {
    const value = body[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max) throw new ApiError('invalid_reading', 400);
    values[field.key] = value;
  }
  if (values.systolic <= values.diastolic) throw new ApiError('invalid_reading', 400);

  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') throw new ApiError('invalid_reading', 400);
    note = body.note.trim().slice(0, 100) || null;
  }

  // created_at is filled in by the database (UTC).
  await env.DB.prepare(
    'INSERT INTO readings (user_id, systolic, diastolic, bp_bpm, spo2, oximeter_bpm, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  ).bind(user.id, values.systolic, values.diastolic, values.bp_bpm, values.spo2, values.oximeter_bpm, note).run();

  return json({ ok: true }, 201);
}

/* ---------- Router ---------- */
async function handleApi(request, env, url) {
  if (!env.DB) {
    console.error('D1 binding "DB" is missing. Check wrangler.json.');
    throw new ApiError('database_error', 500);
  }
  if (request.method === 'POST') checkOrigin(request, url);

  const route = url.pathname.replace(/\/+$/, '');
  switch (route) {
    case '/api/signup': return signup(request, env);
    case '/api/login': return login(request, env, url);
    case '/api/logout': return logout(request, env, url);
    case '/api/me': return me(request, env);
    case '/api/readings':
      return request.method === 'POST' ? addReading(request, env) : listReadings(request, env);
    default: throw new ApiError('not_found', 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.code }, err.status);
      console.error('Unhandled error:', err);
      const isDatabase = String((err && err.message) || '').includes('D1_');
      return json({ error: isDatabase ? 'database_error' : 'server_error' }, 500);
    }
  }
};
