import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// 配置集中管理：全部来自环境变量，启动时校验（fail fast）
function required(name, fallback) {
  const v = process.env[name] || fallback;
  if (!v) {
    console.error(`[配置错误] 缺少环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT || 3117),
  // 生产环境必须设置 SESSION_SECRET；未设置时生成随机值（重启后所有人需重新登录）
  sessionSecret: process.env.SESSION_SECRET || null,
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', '117kit.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
  clientDist: process.env.CLIENT_DIST || path.join(ROOT, '..', 'client', 'dist'),
  // 上传限制
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 200),
  maxPhotoMB: Number(process.env.MAX_PHOTO_MB || 20),
  // 登录安全
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  // 明确允许的 CORS 来源（同源部署时基本用不到，留作分离部署的口子）
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
};

for (const dir of [path.dirname(config.dbFile), config.uploadDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
