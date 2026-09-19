import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, badRequest, notFound, forbidden } from '../middleware.js';
import { handleUpload } from '../upload.js';

export const expRouter = Router();
expRouter.use(requireAuth);

// 实验数据与结果：仅本人和管理员可见 —— 所有查询按角色过滤
const visibleWhere = (user, alias = 'e') => (user.role === 'admin' ? '' : ` AND ${alias}.user_id = ${Number(user.id)}`);

expRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, u.display_name,
      (SELECT COUNT(*) FROM files f WHERE f.experiment_id = e.id AND f.kind = 'experiment_data') AS data_count,
      (SELECT COUNT(*) FROM files f WHERE f.experiment_id = e.id AND f.kind = 'result') AS result_count
    FROM experiments e JOIN users u ON u.id = e.user_id
    WHERE 1=1 ${visibleWhere(req.user)}
    ORDER BY e.created_at DESC LIMIT 200
  `).all();
  res.json(rows);
});

expRouter.post('/', (req, res, next) => {
  const { title, sampleInfo } = req.body || {};
  if (!title || !String(title).trim()) return next(badRequest('请填写实验标题'));
  const r = db.prepare(`INSERT INTO experiments (user_id, title, sample_info) VALUES (?, ?, ?)`)
    .run(req.user.id, String(title).trim().slice(0, 100), String(sampleInfo || '').slice(0, 500));
  res.json({ ok: true, id: r.lastInsertRowid });
});

// ---------- 文件下载（统一鉴权出口，绝不走公开静态目录） ----------
// 注意：必须注册在 GET /:id 之前，否则路由会被遮蔽
expRouter.get('/files/:fileId/download', (req, res, next) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
  if (!f) return next(notFound('文件不存在'));

  // 权限：记录本照片所有人（同实验室）可见；实验相关文件仅本人+管理员
  if (f.kind !== 'logbook' && f.owner_id !== req.user.id && req.user.role !== 'admin') {
    return next(forbidden('该文件仅本人和管理员可见'));
  }
  const storePath = path.join(config.uploadDir, f.stored_name);
  if (!fs.existsSync(storePath)) return next(notFound('文件已丢失，请联系管理员'));
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.orig_name)}`);
  fs.createReadStream(storePath).pipe(res);
});

function getVisibleExperiment(req, next) {
  const row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(req.params.id);
  if (!row) { next(notFound('实验不存在')); return null; }
  if (row.user_id !== req.user.id && req.user.role !== 'admin') { next(forbidden('实验数据仅本人和管理员可见')); return null; }
  return row;
}

expRouter.get('/:id', (req, res, next) => {
  const row = getVisibleExperiment(req, next);
  if (!row) return;
  const owner = db.prepare('SELECT display_name FROM users WHERE id = ?').get(row.user_id);
  const files = db.prepare(`SELECT id, kind, orig_name, size, created_at FROM files WHERE experiment_id = ? ORDER BY id`).all(row.id);
  res.json({ ...row, display_name: owner.display_name, files });
});

// 上传实验数据文件（挂到某个实验）
expRouter.post('/:id/files', async (req, res, next) => {
  const exp = getVisibleExperiment(req, next);
  if (!exp) return;
  try {
    const { file } = await handleUpload(req, ['experiment_data', 'result']);
    const r = db.prepare(`
      INSERT INTO files (owner_id, experiment_id, kind, orig_name, stored_name, size, mime)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, exp.id, file.kind, file.origName, file.storedName, file.size, file.mime);
    res.json({ ok: true, fileId: r.lastInsertRowid });
  } catch (e) { next(e); }
});

// 提交最终结果（提交后状态变为 submitted，仍仅本人+管理员可见）
expRouter.post('/:id/submit', (req, res, next) => {
  const exp = getVisibleExperiment(req, next);
  if (!exp) return;
  const { resultSummary, resultFileId } = req.body || {};
  if (!resultSummary || !String(resultSummary).trim()) return next(badRequest('请填写结果说明'));
  if (resultFileId) {
    const f = db.prepare(`SELECT id FROM files WHERE id = ? AND experiment_id = ? AND kind = 'result'`).get(resultFileId, exp.id);
    if (!f) return next(badRequest('结果文件不存在或未上传到该实验'));
  }
  db.prepare(`UPDATE experiments SET status = 'submitted', result_summary = ?, result_file_id = ?,
      submitted_at = datetime('now','localtime') WHERE id = ?`)
    .run(String(resultSummary).trim().slice(0, 2000), resultFileId || null, exp.id);
  res.json({ ok: true });
});
