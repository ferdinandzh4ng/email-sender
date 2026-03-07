import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SQLITE_PATH || join(__dirname, '..', 'data', 'email_sender.db');

let db;
let SQL;

function persist() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  } catch (e) {
    console.error('DB persist error:', e.message);
  }
}

// sql.js rejects undefined in bind(); use null instead
function normalizeParams(params) {
  return params.map((p) => (p === undefined ? null : p));
}

function wrapDb(database) {
  return {
    prepare(sql) {
      return {
        run(...params) {
          database.run(sql, normalizeParams(params));
          persist();
        },
        get(...params) {
          const stmt = database.prepare(sql);
          stmt.bind(normalizeParams(params));
          const row = stmt.step() ? stmt.getAsObject() : null;
          stmt.free();
          return row;
        },
        all(...params) {
          const stmt = database.prepare(sql);
          stmt.bind(normalizeParams(params));
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
      };
    },
  };
}

function runMigrations(database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      success_redirect TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      send_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      subject_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      csv_rows TEXT NOT NULL,
      attachment_storage_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS sent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      gmail_message_id TEXT,
      sent_at TEXT,
      error TEXT,
      FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_jobs_send_at ON scheduled_jobs(send_at)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_status ON scheduled_jobs(status)',
    'CREATE INDEX IF NOT EXISTS idx_sent_log_job ON sent_log(job_id)',
  ];
  for (const sql of statements) {
    database.run(sql);
  }
  persist();
}

export function getDb() {
  if (!db) throw new Error('DB not initialized. Call await initDb() first.');
  return wrapDb(db);
}

export async function initDb() {
  if (db) return wrapDb(db);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  SQL = await initSqlJs();
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  runMigrations(db);
  return wrapDb(db);
}
