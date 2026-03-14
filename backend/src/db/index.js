const Database = require('better-sqlite3');
const path = require('path');
const session = require('express-session');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/capital-tracker.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

// Migration tracking
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )
`);

const migrations = [
  {
    id: '001_add_position_to_accounts',
    up() {
      const cols = db.prepare('PRAGMA table_info(accounts)').all();
      if (!cols.find((c) => c.name === 'position')) {
        db.exec('ALTER TABLE accounts ADD COLUMN position INTEGER DEFAULT 0');
        db.exec('UPDATE accounts SET position = rowid');
      }
    },
  },
  {
    id: '002_add_filled_at_to_months',
    up() {
      const cols = db.prepare('PRAGMA table_info(months)').all();
      if (!cols.find((c) => c.name === 'filled_at')) {
        db.exec('ALTER TABLE months ADD COLUMN filled_at TEXT');
      }
    },
  },
  {
    id: '003_add_cycle_start_day_to_dossiers',
    up() {
      const cols = db.prepare('PRAGMA table_info(dossiers)').all();
      if (!cols.find((c) => c.name === 'cycle_start_day')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN cycle_start_day INTEGER DEFAULT 25');
      }
    },
  },
  {
    id: '004_create_expense_template_items',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expense_template_items (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          section TEXT NOT NULL CHECK(section IN ('expense', 'distribution')),
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('Fixed', 'Budget')),
          value REAL NOT NULL DEFAULT 0,
          day_of_payment INTEGER,
          position INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: '005_create_expense_cycles',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expense_cycles (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          salary REAL NOT NULL DEFAULT 0,
          previous_balance REAL NOT NULL DEFAULT 0,
          is_closed INTEGER DEFAULT 0,
          final_real_balance REAL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(dossier_id, year, month)
        )
      `);
    },
  },
  {
    id: '006_create_cycle_items',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cycle_items (
          id TEXT PRIMARY KEY,
          cycle_id TEXT NOT NULL REFERENCES expense_cycles(id) ON DELETE CASCADE,
          template_item_id TEXT,
          section TEXT NOT NULL CHECK(section IN ('expense', 'distribution')),
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('Fixed', 'Budget')),
          value REAL NOT NULL DEFAULT 0,
          day_of_payment INTEGER,
          paid INTEGER DEFAULT 0,
          spent REAL DEFAULT 0,
          done INTEGER DEFAULT 0,
          position INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: '007_add_classification_to_expense_template_items',
    up() {
      const cols = db.prepare('PRAGMA table_info(expense_template_items)').all();
      if (!cols.find((c) => c.name === 'classification')) {
        db.exec(`ALTER TABLE expense_template_items ADD COLUMN classification TEXT CHECK(classification IN ('must', 'want'))`);
      }
    },
  },
  {
    id: '008_add_decomposition_to_expense_template_items',
    up() {
      const cols = db.prepare('PRAGMA table_info(expense_template_items)').all();
      if (!cols.find((c) => c.name === 'must_amount')) {
        db.exec('ALTER TABLE expense_template_items ADD COLUMN must_amount REAL');
      }
      if (!cols.find((c) => c.name === 'want_amount')) {
        db.exec('ALTER TABLE expense_template_items ADD COLUMN want_amount REAL');
      }
      if (!cols.find((c) => c.name === 'save_amount')) {
        db.exec('ALTER TABLE expense_template_items ADD COLUMN save_amount REAL');
      }
    },
  },
  {
    id: '009_create_annual_expense_template_items',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_template_items (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          day_of_payment INTEGER,
          month_of_payment INTEGER,
          classification TEXT CHECK(classification IN ('must', 'want')),
          position INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: '010_create_workbench_snapshots',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workbench_snapshots (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: '011_create_goals',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goals (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          target_value REAL NOT NULL,
          target_date TEXT NOT NULL,
          extra_value REAL,
          extra_value_impact_mode TEXT CHECK(extra_value_impact_mode IN ('reduce_monthly_amount', 'anticipate_end_date')),
          contribution_mode TEXT NOT NULL CHECK(contribution_mode IN ('via_distributions', 'manual', 'ad_hoc')),
          manual_monthly_value REAL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: '012_create_goal_accounts',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_accounts (
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          PRIMARY KEY (goal_id, account_id)
        )
      `);
    },
  },
  {
    id: '013_create_goal_distributions',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_distributions (
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          distribution_template_id TEXT NOT NULL REFERENCES expense_template_items(id) ON DELETE CASCADE,
          PRIMARY KEY (goal_id, distribution_template_id)
        )
      `);
    },
  },
  {
    id: '014_create_goal_cycle_contributions',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_cycle_contributions (
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          cycle_id TEXT NOT NULL REFERENCES expense_cycles(id) ON DELETE CASCADE,
          real_contribution REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (goal_id, cycle_id)
        )
      `);
    },
  },
  {
    id: '015_create_goal_historical_contributions',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_historical_contributions (
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          year    INTEGER NOT NULL,
          month   INTEGER NOT NULL,
          amount  REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (goal_id, year, month)
        )
      `);
    },
  },
  {
    id: '016_add_glance_warning_days',
    up() {
      const cols = db.prepare('PRAGMA table_info(dossiers)').all();
      if (!cols.find((c) => c.name === 'capital_snapshot_warning_day')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN capital_snapshot_warning_day INTEGER DEFAULT 7');
      }
      if (!cols.find((c) => c.name === 'next_cycle_warning_day')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN next_cycle_warning_day INTEGER DEFAULT 22');
      }
      if (!cols.find((c) => c.name === 'previous_cycle_close_warning_day')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN previous_cycle_close_warning_day INTEGER DEFAULT 25');
      }
    },
  },
  {
    id: '017_emergency_fund',
    up() {
      const cols = db.prepare('PRAGMA table_info(dossiers)').all();
      if (!cols.find((c) => c.name === 'emergency_fund_months_multiplier')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN emergency_fund_months_multiplier INTEGER DEFAULT 6');
      }
      if (!cols.find((c) => c.name === 'emergency_fund_cycles_to_average')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN emergency_fund_cycles_to_average INTEGER DEFAULT 6');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS emergency_fund_accounts (
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          PRIMARY KEY (dossier_id, account_id)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS emergency_fund_extra_values (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          position INTEGER DEFAULT 0
        )
      `);
    },
  },
];

for (const migration of migrations) {
  const applied = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(migration.id);
  if (!applied) {
    migration.up();
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
  }
}

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
