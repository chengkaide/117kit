import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword } from '../auth.js';
import { requireAdmin, badRequest } from '../middleware.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// 成员管理
adminRouter.get('/users', (_req, res) => {
  res.json(db.prepare(`SELECT id, username, display_name, role, status, created_at FROM users ORDER BY
    CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, id`).all());
});

adminRouter.post('/users/:id/approve', (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return next(badRequest('用户不存在'));
  if (u.status !== 'pending') return next(badRequest('该用户不在待审批状态'));
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(u.id);
  res.json({ ok: true });
});

adminRouter.post('/users/:id/disable', (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return next(badRequest('用户不存在'));
  if (u.id === req.user.id) return next(badRequest('不能停用自己'));
  if (u.role === 'admin') return next(badRequest('不能停用管理员账号'));
  db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // 立即踢下线
  res.json({ ok: true });
});

adminRouter.post('/users/:id/enable', (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return next(badRequest('用户不存在'));
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(u.id);
  res.json({ ok: true });
});

adminRouter.post('/users/:id/reset-password', (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return next(badRequest('用户不存在'));
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) return next(badRequest('新密码至少 8 位'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ ok: true, message: '密码已重置，请通知该成员重新登录' });
});

adminRouter.post('/users/:id/make-admin', (req, res) => {
  db.prepare("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
