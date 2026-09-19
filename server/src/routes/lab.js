import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, badRequest, notFound } from '../middleware.js';
import { DATE_RE } from './auth.js';
import { handleUpload } from '../upload.js';

export const labRouter = Router();
labRouter.use(requireAuth);

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- 打卡 ----------
labRouter.get('/checkin/today', (req, res) => {
  const row = db.prepare('SELECT * FROM checkins WHERE user_id = ? AND work_date = ?').get(req.user.id, todayStr());
  res.json({ today: row || null });
});

labRouter.get('/checkin/list', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = db.prepare(`
    SELECT c.*, u.display_name FROM checkins c JOIN users u ON u.id = c.user_id
    ${req.user.role === 'admin' ? '' : 'WHERE c.user_id = ?'}
    ORDER BY c.work_date DESC, c.checkin_at DESC LIMIT ?
  `).all(...(req.user.role === 'admin' ? [] : [req.user.id]), limit);
  res.json(rows);
});

labRouter.post('/checkin', (req, res, next) => {
  const date = todayStr();
  const exists = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND work_date = ?').get(req.user.id, date);
  if (exists) return next(badRequest('今天已打过卡'));
  db.prepare('INSERT INTO checkins (user_id, work_date, checkin_at, note) VALUES (?, ?, datetime(\'now\',\'localtime\'), ?)')
    .run(req.user.id, date, String(req.body?.note || '').slice(0, 200));
  res.json({ ok: true });
});

labRouter.post('/checkin/checkout', (req, res, next) => {
  const row = db.prepare('SELECT * FROM checkins WHERE user_id = ? AND work_date = ?').get(req.user.id, todayStr());
  if (!row) return next(badRequest('今天还没有签到'));
  if (row.checkout_at) return next(badRequest('今天已签退'));
  db.prepare('UPDATE checkins SET checkout_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ---------- 实验预约（周一至周五工作日可约，周六周日也开放预约） ----------
function validTime(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ''); }

labRouter.get('/reservations', (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : '2100-01-01';
  const mine = req.query.scope === 'mine';
  const rows = db.prepare(`
    SELECT r.*, u.display_name FROM reservations r JOIN users u ON u.id = r.user_id
    WHERE r.work_date BETWEEN ? AND ? AND r.status = 'confirmed'
    ${mine ? 'AND r.user_id = ?' : ''}
    ORDER BY r.work_date, r.start_time
  `).all(from, to, ...(mine ? [req.user.id] : []));
  res.json(rows);
});

labRouter.post('/reservations', (req, res, next) => {
  const { workDate, startTime, endTime, instrument, purpose } = req.body || {};
  if (!DATE_RE.test(workDate || '')) return next(badRequest('日期格式应为 YYYY-MM-DD'));
  if (!validTime(startTime) || !validTime(endTime)) return next(badRequest('时间格式应为 HH:MM'));
  if (startTime >= endTime) return next(badRequest('结束时间必须晚于开始时间'));
  // 不能预约过去的日期
  if (workDate < todayStr()) return next(badRequest('不能预约过去的日期'));
  // 冲突检测：同一仪器同一时段不能与已确认预约重叠
  const conflict = db.prepare(`
    SELECT r.id, u.display_name FROM reservations r JOIN users u ON u.id = r.user_id
    WHERE r.work_date = ? AND r.status = 'confirmed' AND r.instrument = ?
      AND r.start_time < ? AND r.end_time > ?
  `).get(workDate, String(instrument || 'LA-ICP-MS'), endTime, startTime);
  if (conflict) return next(badRequest(`该时段 ${conflict.display_name} 已预约此仪器，请换时间`));

  db.prepare(`INSERT INTO reservations (user_id, work_date, start_time, end_time, instrument, purpose)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, workDate, startTime, endTime,
      String(instrument || 'LA-ICP-MS').slice(0, 50), String(purpose || '').slice(0, 300));
  res.json({ ok: true });
});

labRouter.post('/reservations/:id/cancel', (req, res, next) => {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!row) return next(notFound('预约不存在'));
  if (row.user_id !== req.user.id && req.user.role !== 'admin') return next(badRequest('只能取消自己的预约'));
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// ---------- 气体状态日报（氮气、氩气、高纯氦、高纯氮；含周末） ----------
export const GASES = ['氮气', '氩气', '高纯氦', '高纯氮'];
const LEVELS = ['充足', '一半', '偏低', '已用完'];

labRouter.get('/gas', (req, res) => {
  const date = DATE_RE.test(req.query.date || '') ? req.query.date : todayStr();
  const rows = db.prepare(`
    SELECT g.*, u.display_name FROM gas_reports g JOIN users u ON u.id = g.recorded_by
    WHERE g.report_date = ? ORDER BY g.id
  `).all(date);
  res.json({ date, gases: GASES.map((name) => rows.find((r) => r.gas_name === name) || { gas_name: name }) });
});

labRouter.post('/gas', (req, res, next) => {
  const { reportDate, gasName, pressure, level, note } = req.body || {};
  if (!DATE_RE.test(reportDate || '')) return next(badRequest('日期格式应为 YYYY-MM-DD'));
  if (reportDate > todayStr()) return next(badRequest('不能登记未来日期'));
  if (!GASES.includes(gasName)) return next(badRequest(`气体名称必须是：${GASES.join('、')}`));
  if (!LEVELS.includes(level)) return next(badRequest(`余量状态必须是：${LEVELS.join('/')}`));
  db.prepare(`
    INSERT INTO gas_reports (report_date, gas_name, pressure, level, note, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_date, gas_name) DO UPDATE SET pressure = excluded.pressure, level = excluded.level,
      note = excluded.note, recorded_by = excluded.recorded_by, created_at = datetime('now','localtime')
  `).run(reportDate, gasName, String(pressure || '').slice(0, 50), level, String(note || '').slice(0, 200), req.user.id);
  res.json({ ok: true });
});

// ---------- 实验室记录本拍照上传 ----------
labRouter.post('/logbook', async (req, res, next) => {
  try {
    const { file } = await handleUpload(req, 'logbook');
    const workDate = DATE_RE.test(req.body.work_date || '') ? req.body.work_date : todayStr();
    const r = db.prepare(`
      INSERT INTO files (owner_id, kind, work_date, orig_name, stored_name, size, mime, note)
      VALUES (?, 'logbook', ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, workDate, file.origName, file.storedName, file.size, file.mime, String(req.body.note || '').slice(0, 200));
    res.json({ ok: true, fileId: r.lastInsertRowid });
  } catch (e) { next(e); }
});

labRouter.get('/logbook', (req, res) => {
  const rows = db.prepare(`
    SELECT f.id, f.work_date, f.orig_name, f.note, f.created_at, f.owner_id, u.display_name
    FROM files f JOIN users u ON u.id = f.owner_id
    WHERE f.kind = 'logbook' ${req.user.role === 'admin' ? '' : 'AND f.owner_id = ?'}
    ORDER BY f.work_date DESC, f.id DESC LIMIT 200
  `).all(...(req.user.role === 'admin' ? [] : [req.user.id]));
  res.json(rows);
});

// ---------- 配件位置台账 ----------
labRouter.get('/equipment', (req, res) => {
  res.json(db.prepare('SELECT * FROM equipment ORDER BY category, name').all());
});

labRouter.post('/equipment', (req, res, next) => {
  const { name, category, room, cabinet, position, description } = req.body || {};
  if (!name || !String(name).trim()) return next(badRequest('请填写配件名称'));
  const r = db.prepare(`
    INSERT INTO equipment (name, category, room, cabinet, position, description, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(String(name).trim().slice(0, 100), String(category || '').slice(0, 50), String(room || '').slice(0, 50),
    String(cabinet || '').slice(0, 50), String(position || '').slice(0, 100), String(description || '').slice(0, 500), req.user.id);
  res.json({ ok: true, id: r.lastInsertRowid });
});

labRouter.put('/equipment/:id', (req, res, next) => {
  const row = db.prepare('SELECT id FROM equipment WHERE id = ?').get(req.params.id);
  if (!row) return next(notFound('配件不存在'));
  const { name, category, room, cabinet, position, description } = req.body || {};
  if (!name || !String(name).trim()) return next(badRequest('请填写配件名称'));
  db.prepare(`
    UPDATE equipment SET name = ?, category = ?, room = ?, cabinet = ?, position = ?, description = ?,
      updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `).run(String(name).trim().slice(0, 100), String(category || '').slice(0, 50), String(room || '').slice(0, 50),
    String(cabinet || '').slice(0, 50), String(position || '').slice(0, 100), String(description || '').slice(0, 500),
    req.user.id, row.id);
  res.json({ ok: true });
});

labRouter.delete('/equipment/:id', (req, res) => {
  db.prepare('DELETE FROM equipment WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
