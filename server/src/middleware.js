import crypto from 'node:crypto';
import { getSessionUser } from './auth.js';

// 类型化错误
export class HttpError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const badRequest = (msg) => new HttpError(400, msg, 'BAD_REQUEST');
export const unauthorized = (msg = '请先登录') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = '没有权限') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = '资源不存在') => new HttpError(404, msg, 'NOT_FOUND');

export function requireAuth(req, _res, next) {
  req.user = getSessionUser(req);
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  req.user = getSessionUser(req);
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('仅管理员可操作'));
  next();
}

// 结构化 JSON 日志 + request id
export function requestLogger(req, res, next) {
  const id = crypto.randomBytes(4).toString('hex');
  req.requestId = id;
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    console.log(JSON.stringify({
      ts: new Date().toISOString(), id, method: req.method, path: req.originalUrl.split('?')[0],
      status: res.statusCode, ms: Date.now() - start, user: req.user?.username ?? null,
    }));
  });
  next();
}

// 全局错误处理
export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error(JSON.stringify({ ts: new Date().toISOString(), id: req.requestId, err: err.stack || String(err) }));
  res.status(status).json({ error: err.code || 'ERROR', message: status >= 500 ? '服务器内部错误' : err.message });
}
