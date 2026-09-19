import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  sessionCookie, clearSessionCookie, loginBlocked, recordFailedLogin, clearFailedLogins,
} from '../auth.js';
import { requireAuth, badRequest, unauthorized } from '../middleware.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 注册：新用户为 pending，需管理员审批后才能登录
authRouter.post('/register', (req, res, next) => {
  const { username, password, displayName } = req.body || {};
  if (!USERNAME_RE.test(username || '')) return next(badRequest('用户名须为 3-30 位字母/数字/下划线'));
  if (typeof password !== 'string' || password.length < 8) return next(badRequest('密码至少 8 位'));
  if (!displayName || String(displayName).trim().length === 0 || String(displayName).length > 30) return next(badRequest('请填写姓名（30 字以内）'));
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return next(badRequest('用户名已被注册'));

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  // 第一个注册的用户自动成为管理员（部署后立刻注册即拥有管理权）
  const role = count === 0 ? 'admin' : 'user';
  const status = count === 0 ? 'active' : 'pending';
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), String(displayName).trim(), role, status);
  res.json({ ok: true, message: role === 'admin' ? '注册成功，你已是管理员' : '注册成功，请等待管理员审批' });
});

authRouter.post('/login', (req, res, next) => {
  const { username, password } = req.body || {};
  const key = `${(username || '').slice(0, 40)}@${req.socket.remoteAddress}`;
  if (loginBlocked(key)) return next(unauthorized(`尝试次数过多，请 ${config.loginLockMinutes} 分钟后再试`));

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    recordFailedLogin(key);
    return next(unauthorized('用户名或密码错误'));
  }
  if (user.status === 'pending') return next(unauthorized('账号待管理员审批，请耐心等待'));
  if (user.status === 'disabled') return next(unauthorized('账号已被停用，请联系管理员'));
  clearFailedLogins(key);

  const { token, expires } = createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(token, expires));
  res.json({ ok: true, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
});

authRouter.post('/logout', (req, res) => {
  const token = (req.headers.cookie || '').match(/kit_session=([^;]+)/)?.[1];
  destroySession(token ? decodeURIComponent(token) : null);
  res.setHeader('Set-Cookie', clearSessionCookie);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const { id, username, display_name, role } = req.user;
  res.json({ id, username, displayName: display_name, role });
});

authRouter.post('/change-password', requireAuth, (req, res, next) => {
  const { oldPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !verifyPassword(oldPassword || '', user.password_hash)) return next(badRequest('原密码错误'));
  if (typeof newPassword !== 'string' || newPassword.length < 8) return next(badRequest('新密码至少 8 位'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  // 改密后吊销所有会话
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  res.setHeader('Set-Cookie', clearSessionCookie);
  res.json({ ok: true, message: '密码已修改，请重新登录' });
});

export { DATE_RE };
