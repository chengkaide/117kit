import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

// ---------- 密码：scrypt（Node 内置，无原生依赖） ----------
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, salt, hex] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const key = crypto.scryptSync(password, salt, KEYLEN, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), key);
  } catch {
    return false;
  }
}

// ---------- 会话：token 只存哈希，Cookie 用 httpOnly ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  const expiresStr = expires.toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expiresStr);
  return { token, expires };
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies['kit_session'];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.status, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now','localtime')
  `).get(sha256(token));
  if (!row || row.status !== 'active') return null;
  return row;
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, expires) {
  return `kit_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`;
}
export const clearSessionCookie = 'kit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

// ---------- 登录限流（内存实现，按用户名+IP） ----------
const attempts = new Map(); // key -> { count, lockUntil }

export function loginBlocked(key) {
  const rec = attempts.get(key);
  return rec && rec.lockUntil > Date.now();
}

export function recordFailedLogin(key) {
  const rec = attempts.get(key) || { count: 0, lockUntil: 0 };
  rec.count += 1;
  if (rec.count >= config.loginMaxAttempts) {
    rec.lockUntil = Date.now() + config.loginLockMinutes * 60_000;
    rec.count = 0;
  }
  attempts.set(key, rec);
}

export function clearFailedLogins(key) {
  attempts.delete(key);
}
