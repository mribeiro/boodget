const Database = require('better-sqlite3');
const path = require('path');
const session = require('express-session');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/capital-tracker.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations
{
  const accountCols = db.prepare('PRAGMA table_info(accounts)').all();
  if (!accountCols.find((c) => c.name === 'position')) {
    db.exec('ALTER TABLE accounts ADD COLUMN position INTEGER DEFAULT 0');
    db.exec('UPDATE accounts SET position = rowid');
  }

  const monthCols = db.prepare('PRAGMA table_info(months)').all();
  if (!monthCols.find((c) => c.name === 'filled_at')) {
    db.exec('ALTER TABLE months ADD COLUMN filled_at TEXT');
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    is_oidc INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dossiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency TEXT DEFAULT 'EUR',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dossier_access (
    dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (dossier_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('Risk Investment', 'Guaranteed Investment', 'Current Account')),
    is_idle_money INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS months (
    id TEXT PRIMARY KEY,
    dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    comment TEXT,
    filled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(dossier_id, year, month)
  );

  CREATE TABLE IF NOT EXISTS month_account_snapshot (
    month_id TEXT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (month_id, account_id)
  );

  CREATE TABLE IF NOT EXISTS month_entries (
    month_id TEXT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    value REAL,
    comment TEXT,
    PRIMARY KEY (month_id, account_id)
  );
`);

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
    if (!row) return callback(null, null);
    try {
      callback(null, JSON.parse(row.sess));
    } catch (e) {
      callback(e);
    }
  }

  set(sid, sess, callback) {
    const maxAge = sess.cookie?.maxAge ?? 72 * 60 * 60 * 1000;
    const expired = Date.now() + maxAge;
    db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(
      sid,
      JSON.stringify(sess),
      expired
    );
    callback(null);
  }

  destroy(sid, callback) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    callback(null);
  }
}

// Clean up expired sessions hourly
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expired <= ?').run(Date.now());
}, 60 * 60 * 1000);

module.exports = { db, SQLiteSessionStore };
