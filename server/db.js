// 数据库连接与表结构（SQLite，文件持久化）
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'neonatal.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('nurse','family','doctor')),
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_user_id INTEGER REFERENCES users(id),
  mother_name TEXT NOT NULL,
  baby_name TEXT NOT NULL,
  baby_gender TEXT DEFAULT '女',
  birth_date TEXT NOT NULL,            -- 出生日期时间 ISO
  birth_weight REAL NOT NULL,          -- 出生体重 g
  delivery_mode TEXT NOT NULL,         -- 顺产/剖宫产/产钳助产
  feeding_type TEXT NOT NULL,          -- 母乳喂养/配方奶喂养/混合喂养
  jaundice_risk TEXT DEFAULT '低',     -- 黄疸风险 低/中/高
  maternal_wound TEXT DEFAULT '愈合良好', -- 产妇伤口
  address TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  discharge_date TEXT,                 -- 出院日期
  care_ability TEXT DEFAULT '良好',    -- 家庭照护能力 良好/一般/薄弱
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  nurse_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL DEFAULT '初访',    -- 初访/复查/加访
  scheduled_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待访视', -- 待访视/已完成/已改约/未开门/已取消
  reason TEXT DEFAULT '',              -- 改约/未开门等原因
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE,               -- 离线草稿幂等键
  appointment_id INTEGER REFERENCES appointments(id),
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  nurse_id INTEGER REFERENCES users(id),
  visit_time TEXT NOT NULL,
  weight REAL,                         -- 婴儿体重 g
  bilirubin REAL,                      -- 经皮黄疸值 µmol/L
  bilirubin_site TEXT DEFAULT '额头',
  cord TEXT DEFAULT '干燥',            -- 脐带情况
  stool_count INTEGER DEFAULT 0,
  stool_color TEXT DEFAULT '黄色',
  urine_count INTEGER DEFAULT 0,
  feeding_type TEXT DEFAULT '',
  feeding_freq INTEGER DEFAULT 0,      -- 喂养频次 次/日
  spit_up TEXT DEFAULT '无',           -- 吐奶
  sleep TEXT DEFAULT '正常',           -- 睡眠
  breast TEXT DEFAULT '正常',          -- 产妇乳房
  mood TEXT DEFAULT '平稳',            -- 产妇情绪
  wound_check TEXT DEFAULT '愈合良好', -- 产妇伤口复查
  care_ability TEXT DEFAULT '良好',    -- 家庭照护能力（现场评估）
  device_issue INTEGER DEFAULT 0,      -- 社区设备故障，手工记录
  photos TEXT DEFAULT '[]',            -- JSON [dataUrl]
  advice TEXT DEFAULT '',              -- 护理建议（家属可见）
  risk_level TEXT DEFAULT '低',        -- 低/中/高/危急
  flags TEXT DEFAULT '[]',             -- JSON 风险标记
  need_recheck INTEGER DEFAULT 0,
  need_referral INTEGER DEFAULT 0,
  need_lactation INTEGER DEFAULT 0,
  need_phone INTEGER DEFAULT 0,
  created_offline INTEGER DEFAULT 0,   -- 是否离线草稿补录
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  visit_id INTEGER REFERENCES visits(id),
  type TEXT NOT NULL,                  -- 复查/转诊/母乳指导/电话随访/线上咨询/再次预约
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '待处理', -- 待处理/进行中/已闭环
  due_date TEXT,
  created_by TEXT DEFAULT '系统',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  closed_by TEXT,
  close_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  uploader_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,                  -- 出生证明/出院小结/喂养记录/其他
  filename TEXT NOT NULL,
  data_url TEXT DEFAULT '',            -- base64（演示环境小文件）
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS consults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  user_id INTEGER REFERENCES users(id),
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待回复', -- 待回复/已回复
  reply TEXT DEFAULT '',
  replied_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  replied_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  kind TEXT NOT NULL,                  -- 预约/改约/未开门/访视/复查/转诊/指导/材料/咨询/决策/闭环
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 产妇情绪关怀（敏感）：量表、家属支持、自伤想法、风险来源；双来源（护士访视·产妇自述 / 家属代填）
CREATE TABLE IF NOT EXISTS mood_cares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  visit_id INTEGER REFERENCES visits(id),
  source TEXT NOT NULL,                -- nurse_visit(护士访视·产妇自述) / family_report(家属代填)
  persistent_crying TEXT DEFAULT '无',  -- 持续哭泣 无/偶尔/持续
  sleep_quality TEXT DEFAULT '正常',    -- 睡眠 正常/入睡困难/易醒/严重失眠
  epds_score INTEGER,                  -- 爱丁堡产后抑郁量表 0~30（敏感，家属代填为空）
  family_support TEXT DEFAULT '',       -- 家属支持 良好/一般/不足（护士评估）
  care_hands TEXT DEFAULT '',           -- 照护人手 充足/紧张/不足（家属代填）
  self_harm TEXT DEFAULT '无',          -- 自伤想法 无/偶有/持续（高敏感）
  risk_factors TEXT DEFAULT '[]',       -- JSON 风险来源 [照护压力/睡眠不足/家庭支持不足]
  mood_text TEXT DEFAULT '',            -- 家属代填的情绪描述 平稳/烦躁/低落/经常哭泣
  advice TEXT DEFAULT '',               -- 关怀建议（敏感）
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '关怀中', -- 关怀中/已闭环
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  closed_by TEXT,
  close_note TEXT DEFAULT ''
);

-- 情绪关怀过程记录：社区安排（心理咨询/增加电话回访/转妇保门诊）与回访追踪（情绪变化/是否接受帮助）
CREATE TABLE IF NOT EXISTS mood_care_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  care_id INTEGER NOT NULL REFERENCES mood_cares(id),
  kind TEXT NOT NULL,            -- 安排 / 回访
  action TEXT DEFAULT '',        -- 心理咨询/增加电话回访/转妇保门诊（kind=安排）
  mood_change TEXT DEFAULT '',   -- 情绪变化 好转/平稳/加重（kind=回访）
  help_accepted TEXT DEFAULT '', -- 是否接受帮助 已接受/部分接受/未接受（kind=回访）
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_appt_archive ON appointments(archive_id);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_visit_archive ON visits(archive_id);
CREATE INDEX IF NOT EXISTS idx_followup_status ON followups(status);
CREATE INDEX IF NOT EXISTS idx_events_archive ON events(archive_id);
CREATE INDEX IF NOT EXISTS idx_moodcare_archive ON mood_cares(archive_id);
CREATE INDEX IF NOT EXISTS idx_moodcarelog_care ON mood_care_logs(care_id);
`)

// 轻量迁移：旧库补充 followups.sensitive（敏感随访事项，家属端不可见）
{
  const cols = db.prepare(`PRAGMA table_info(followups)`).all().map((c) => c.name)
  if (!cols.includes('sensitive')) {
    db.exec(`ALTER TABLE followups ADD COLUMN sensitive INTEGER DEFAULT 0`)
  }
}

export function addEvent(archiveId, kind, title, detail = '', actor = '') {
  db.prepare('INSERT INTO events (archive_id, kind, title, detail, actor) VALUES (?,?,?,?,?)')
    .run(archiveId, kind, title, detail, actor)
}

export default db
