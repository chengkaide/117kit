import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

// Qtegra（Thermo iCAP RQ）导出 CSV 解析 + 文件夹监视自动导入。
// 格式规则（不要写死行号，见 TERMITE 技能经验）：
//   第 1 行: 样品名:日期 时间;
//   若干行仪器元数据
//   表头行: 第一个字段以 time 开头（忽略大小写）
//   表头下一行是 dwell time/xcal 元数据行，跳过
//   数据行: 字段数与表头一致，且第 2 个字段是数字（cps）

export function parseQtegraCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) throw new Error('文件太短，不是 Qtegra 导出格式');

  // 第 1 行：样品名:日期 时间;
  const first = lines[0];
  const ci = first.indexOf(':');
  if (ci <= 0) throw new Error('第 1 行缺少"样品名:时间"格式');
  const sampleName = first.slice(0, ci).trim();
  const runTime = first.slice(ci + 1).replace(/;+$/, '').trim();

  // 表头行：第一个字段以 time 开头
  let headerIdx = -1;
  for (let i = 1; i < Math.min(lines.length, 30); i++) {
    const firstField = lines[i].split(',')[0].trim().toLowerCase();
    if (firstField.startsWith('time')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('找不到 Time 表头行');
  const isotopes = lines[headerIdx].split(',').map((s) => s.trim()).filter(Boolean).slice(1);
  if (isotopes.length === 0) throw new Error('表头没有同位素列');

  // 数据行
  const nCols = isotopes.length + 1;
  const time = [];
  const values = Object.fromEntries(isotopes.map((iso) => [iso, []]));
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = line.split(',').map((s) => s.trim());
    if (fields.length < nCols) continue;          // 元数据行/残缺行
    const t = Number(fields[0]);
    const v0 = Number(fields[1]);
    if (Number.isNaN(t) || Number.isNaN(v0)) continue; // 不是数据行
    time.push(t);
    isotopes.forEach((iso, j) => {
      const v = Number(fields[j + 1]);
      values[iso].push(Number.isNaN(v) ? null : v);
    });
  }
  if (time.length === 0) throw new Error('没有解析到任何数据行');
  return { sampleName, runTime, isotopes, nSweeps: time.length, data: { time, isotopes: values } };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 导入一个文件：解析 → 入库（哈希去重）。返回 { ok, id?, reason? }
export function importQtegraBuffer(buf, source, origName, userId = null) {
  const hash = sha256(buf);
  if (db.prepare('SELECT id FROM qtegra_files WHERE file_hash = ?').get(hash)) {
    return { ok: false, reason: '重复文件，已导入过', duplicate: true };
  }
  let text = buf.toString('utf8');
  const parsed = parseQtegraCsv(text);
  const r = db.prepare(`
    INSERT INTO qtegra_files (file_hash, source, orig_name, sample_name, run_time, isotopes, n_sweeps, data_json, imported_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hash, source, origName, parsed.sampleName, parsed.runTime,
    JSON.stringify(parsed.isotopes), parsed.nSweeps, JSON.stringify(parsed.data), userId);
  return { ok: true, id: r.lastInsertRowid, sampleName: parsed.sampleName, nSweeps: parsed.nSweeps };
}

// ---------- 文件夹监视（Qtegra 自动导出目录） ----------
export function startWatcher(log = console.log) {
  const watchDir = process.env.QTEGRA_WATCH_DIR || path.join(config.uploadDir, '..', 'qtegra-inbox');
  fs.mkdirSync(watchDir, { recursive: true });
  fs.mkdirSync(path.join(watchDir, 'imported'), { recursive: true });
  fs.mkdirSync(path.join(watchDir, 'failed'), { recursive: true });

  const pending = new Map(); // filename -> timer

  const tryImport = async (name) => {
    if (!/\.csv$/i.test(name)) return;
    const full = path.join(watchDir, name);
    try {
      if (!fs.existsSync(full)) return;
      // 等文件写完：两次采样大小一致才处理
      const s1 = fs.statSync(full).size;
      await new Promise((r) => setTimeout(r, 800));
      if (!fs.existsSync(full)) return;
      const s2 = fs.statSync(full).size;
      if (s1 !== s2 || s2 === 0) {
        pending.set(name, setTimeout(() => tryImport(name), 1500));
        return;
      }
      const buf = fs.readFileSync(full);
      const result = importQtegraBuffer(buf, 'watch', name, null);
      const sub = result.ok ? 'imported' : 'failed';
      fs.renameSync(full, path.join(watchDir, sub, name));
      log(JSON.stringify({ msg: 'qtegra-watch', file: name, ...result }));
    } catch (e) {
      try { fs.renameSync(full, path.join(watchDir, 'failed', name)); } catch { /* 忽略 */ }
      log(JSON.stringify({ msg: 'qtegra-watch-error', file: name, err: String(e.message || e) }));
    }
  };

  const watcher = fs.watch(watchDir, { recursive: false }, (_evt, name) => {
    if (!name) return;
    if (pending.has(name)) clearTimeout(pending.get(name));
    pending.set(name, setTimeout(() => { pending.delete(name); tryImport(name); }, 600));
  });

  log(JSON.stringify({ msg: 'qtegra-watcher-started', dir: watchDir }));
  return { watchDir, close: () => watcher.close() };
}
