import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, badRequest } from '../middleware.js';
import { DATE_RE } from './auth.js';

export const recordRouter = Router();
recordRouter.use(requireAuth);

// ---------- 运行记录（数据点数/标样点/样品点/温湿度/信号参数/意外事件） ----------
const numOrNull = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? null : Number(v));

function listRunLogs(user, from, to) {
  return db.prepare(`
    SELECT r.*, u.display_name FROM run_logs r JOIN users u ON u.id = r.user_id
    WHERE r.work_date BETWEEN ? AND ? ${user.role === 'admin' ? '' : 'AND r.user_id = ?'}
    ORDER BY r.work_date DESC, r.id DESC
  `).all(from, to, ...(user.role === 'admin' ? [] : [user.id]));
}

recordRouter.get('/run-logs', (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : '2100-01-01';
  res.json(listRunLogs(req.user, from, to));
});

recordRouter.post('/run-logs', (req, res, next) => {
  const b = req.body || {};
  if (!DATE_RE.test(b.workDate || '')) return next(badRequest('日期格式应为 YYYY-MM-DD'));
  db.prepare(`INSERT INTO run_logs
    (work_date, user_id, instrument, temp_c, humidity_pct, signal_params, signal_intensity,
     data_points, std_points, sample_points, incidents, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.workDate, req.user.id, String(b.instrument || 'LA-ICP-MS').slice(0, 50),
      String(b.tempC || '').slice(0, 20), String(b.humidityPct || '').slice(0, 20),
      String(b.signalParams || '').slice(0, 300), String(b.signalIntensity || '').slice(0, 300),
      numOrNull(b.dataPoints), numOrNull(b.stdPoints), numOrNull(b.samplePoints),
      String(b.incidents || '').slice(0, 1000), String(b.notes || '').slice(0, 500));
  res.json({ ok: true });
});

// ---------- 值班日志 ----------
function listDutyLogs(user, from, to) {
  return db.prepare(`
    SELECT d.*, u.display_name FROM duty_logs d JOIN users u ON u.id = d.user_id
    WHERE d.work_date BETWEEN ? AND ? ${user.role === 'admin' ? '' : 'AND d.user_id = ?'}
    ORDER BY d.work_date DESC, d.id DESC
  `).all(from, to, ...(user.role === 'admin' ? [] : [user.id]));
}

recordRouter.get('/duty-logs', (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : '2100-01-01';
  res.json(listDutyLogs(req.user, from, to));
});

recordRouter.post('/duty-logs', (req, res, next) => {
  const b = req.body || {};
  if (!DATE_RE.test(b.workDate || '')) return next(badRequest('日期格式应为 YYYY-MM-DD'));
  if (!b.content || !String(b.content).trim()) return next(badRequest('请填写值班情况'));
  db.prepare('INSERT INTO duty_logs (work_date, user_id, content) VALUES (?, ?, ?)')
    .run(b.workDate, req.user.id, String(b.content).trim().slice(0, 2000));
  res.json({ ok: true });
});

// ---------- CSV 导出（UTF-8 带 BOM，Excel 直接打开不乱码） ----------
const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (headers, rows) =>
  '﻿' + [headers, ...rows].map((r) => r.map(csvEsc).join(',')).join('\r\n');

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
}

recordRouter.get('/run-logs/export', (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : '2100-01-01';
  const rows = listRunLogs(req.user, from, to);
  sendCsv(res, `运行记录_${from}_${to}.csv`, toCsv(
    ['日期', '记录人', '仪器', '温度℃', '湿度%', '信号参数', '信号强度', '数据点数', '标样点数', '样品点数', '意外/事件', '备注', '记录时间'],
    rows.map((r) => [r.work_date, r.display_name, r.instrument, r.temp_c, r.humidity_pct,
      r.signal_params, r.signal_intensity, r.data_points, r.std_points, r.sample_points,
      r.incidents, r.notes, r.created_at])
  ));
});

recordRouter.get('/duty-logs/export', (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : '2100-01-01';
  const rows = listDutyLogs(req.user, from, to);
  sendCsv(res, `值班日志_${from}_${to}.csv`, toCsv(
    ['日期', '值班人', '值班情况', '记录时间'],
    rows.map((r) => [r.work_date, r.display_name, r.content, r.created_at])
  ));
});
