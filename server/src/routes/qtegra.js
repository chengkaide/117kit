import { Router } from 'express';
import fs from 'node:fs';
import { db } from '../db.js';
import { requireAuth, notFound, badRequest } from '../middleware.js';
import { handleUpload } from '../upload.js';
import { importQtegraBuffer } from '../qtegra.js';

export const qtegraRouter = Router();
qtegraRouter.use(requireAuth);

// 已导入文件列表（全室可见，原始信号数据）
qtegraRouter.get('/files', (_req, res) => {
  res.json(db.prepare(`
    SELECT id, source, orig_name, sample_name, run_time, isotopes, n_sweeps, created_at
    FROM qtegra_files ORDER BY id DESC LIMIT 300
  `).all().map((r) => ({ ...r, isotopes: JSON.parse(r.isotopes) })));
});

// 单个文件完整数据（含每个 sweep 的 cps，供画图/核对）
qtegraRouter.get('/files/:id', (req, res, next) => {
  const row = db.prepare('SELECT * FROM qtegra_files WHERE id = ?').get(req.params.id);
  if (!row) return next(notFound('文件不存在'));
  res.json({
    id: row.id, sample_name: row.sample_name, run_time: row.run_time,
    isotopes: JSON.parse(row.isotopes), n_sweeps: row.n_sweeps, data: JSON.parse(row.data_json),
  });
});

// 手动导入（一次一个 CSV）
qtegraRouter.post('/import', async (req, res, next) => {
  try {
    const { file } = await handleUpload(req, 'qtegra');
    const buf = fs.readFileSync(file.storePath);
    const result = importQtegraBuffer(buf, 'upload', file.origName, req.user.id);
    fs.rmSync(file.storePath, { force: true }); // 数据已入库，不留临时文件
    if (!result.ok) return next(badRequest(result.reason));
    res.json(result);
  } catch (e) { next(e); }
});

// 删除（仅管理员）
qtegraRouter.delete('/files/:id', (req, res, next) => {
  if (req.user.role !== 'admin') return next(badRequest('仅管理员可删除'));
  db.prepare('DELETE FROM qtegra_files WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
