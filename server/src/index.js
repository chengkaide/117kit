import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { requestLogger, errorHandler } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { labRouter } from './routes/lab.js';
import { expRouter } from './routes/experiments.js';
import { recordRouter } from './routes/records.js';
import { qtegraRouter } from './routes/qtegra.js';
import { adminRouter } from './routes/admin.js';
import { startWatcher } from './qtegra.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// 安全响应头（手动 helmet 精简版）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// 显式 CORS（默认同源部署不需要；配置 CORS_ORIGINS 才放开）
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, name: '117kit', time: new Date().toISOString() }));
app.use('/api/auth', authRouter);
app.use('/api/lab', labRouter);
app.use('/api/exp', expRouter);
app.use('/api/record', recordRouter);
app.use('/api/qtegra', qtegraRouter);
app.use('/api/admin', adminRouter);

// 前端静态资源（PWA 构建产物）
const dist = config.clientDist;
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get(/^\/(?!api|health).*/, (_req, res, next) => {
  const indexFile = path.join(dist, 'index.html');
  if (!fs.existsSync(indexFile)) return next(new Error('前端未构建：请先在 client 目录执行 npm run build'));
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexFile);
});

// 404 与全局错误
app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' }));
app.use(errorHandler);

// 优雅关闭
const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: `117kit 已启动: http://localhost:${config.port}`, port: config.port }));
});
// Qtegra 自动导出目录监视（QTEGRA_WATCH_DIR 可改，默认 server/qtegra-inbox）
const qt = startWatcher();
process.on('SIGTERM', () => { qt.close(); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { qt.close(); server.close(() => process.exit(0)); });
