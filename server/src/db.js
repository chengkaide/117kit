import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',        -- user | admin
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | disabled
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,                  -- YYYY-MM-DD
  checkin_at TEXT NOT NULL,
  checkout_at TEXT,
  note TEXT DEFAULT '',
  UNIQUE(user_id, work_date)
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,                  -- YYYY-MM-DD（周六周日也可预约）
  start_time TEXT NOT NULL,                 -- HH:MM
  end_time TEXT NOT NULL,                   -- HH:MM
  instrument TEXT DEFAULT 'LA-ICP-MS',
  purpose TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  sample_info TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | submitted
  result_summary TEXT,
  result_file_id INTEGER,
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  experiment_id INTEGER REFERENCES experiments(id),
  kind TEXT NOT NULL,                       -- experiment_data | result | logbook | equipment
  work_date TEXT,                           -- 记录本照片对应的日期
  orig_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS gas_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,                -- YYYY-MM-DD（含周六周日）
  gas_name TEXT NOT NULL,                   -- 氮气 | 氩气 | 高纯氦 | 高纯氮
  pressure TEXT DEFAULT '',                 -- 压力表读数
  level TEXT NOT NULL,                      -- 充足 | 一半 | 偏低 | 已用完
  note TEXT DEFAULT '',
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(report_date, gas_name)
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  room TEXT DEFAULT '',
  cabinet TEXT DEFAULT '',
  position TEXT DEFAULT '',
  photo_file_id INTEGER,
  description TEXT DEFAULT '',
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  instrument TEXT DEFAULT 'LA-ICP-MS',
  temp_c TEXT DEFAULT '',
  humidity_pct TEXT DEFAULT '',
  signal_params TEXT DEFAULT '',
  signal_intensity TEXT DEFAULT '',
  data_points INTEGER,
  std_points INTEGER,
  sample_points INTEGER,
  incidents TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS duty_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS qtegra_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash TEXT NOT NULL UNIQUE,           -- sha256，防重复导入
  source TEXT NOT NULL,                     -- watch | upload
  orig_name TEXT NOT NULL,
  sample_name TEXT DEFAULT '',
  run_time TEXT DEFAULT '',
  isotopes TEXT DEFAULT '[]',               -- JSON 数组
  n_sweeps INTEGER DEFAULT 0,
  data_json TEXT NOT NULL,                  -- 完整解析结果 {time:[], isotopes:{...}}
  imported_by INTEGER REFERENCES users(id), -- watch 导入为 NULL
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_files_experiment ON files(experiment_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(work_date);
`);

// 每天清理过期会话（惰性清理即可）
const stmt = db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now','localtime')`);
stmt.run();
