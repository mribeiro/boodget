const Database = require('better-sqlite3');
const path = require('path');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/capital-tracker.db');
console.log(`[db] Opening database at ${DB_PATH}`);

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
    money_category TEXT NOT NULL DEFAULT 'active' CHECK(money_category IN ('idle', 'active', 'stocks')),
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
  {
    id: '019_annual_expenses_tracking',
    up() {
      // 1. Add num_installments to annual_expense_template_items
      const annualTemplateCols = db.prepare('PRAGMA table_info(annual_expense_template_items)').all();
      if (!annualTemplateCols.find((c) => c.name === 'num_installments')) {
        db.exec('ALTER TABLE annual_expense_template_items ADD COLUMN num_installments INTEGER DEFAULT 1');
      }

      // 2. Create annual_expense_template_installments
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_template_installments (
          id TEXT PRIMARY KEY,
          template_item_id TEXT NOT NULL REFERENCES annual_expense_template_items(id) ON DELETE CASCADE,
          installment_number INTEGER NOT NULL,
          month INTEGER NOT NULL,
          day INTEGER NOT NULL
        )
      `);

      // 3. Migrate existing template data: convert day_of_payment + month_of_payment → one installment row
      const existingItems = db.prepare(
        'SELECT id, day_of_payment, month_of_payment FROM annual_expense_template_items WHERE day_of_payment IS NOT NULL AND month_of_payment IS NOT NULL'
      ).all();
      const checkInst = db.prepare('SELECT id FROM annual_expense_template_installments WHERE template_item_id = ?');
      const insertInst = db.prepare(
        'INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, 1, ?, ?)'
      );
      for (const item of existingItems) {
        if (!checkInst.get(item.id)) {
          insertInst.run(uuidv4(), item.id, item.month_of_payment, item.day_of_payment);
        }
      }

      // 4. Create annual_expense_years
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_years (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          year INTEGER NOT NULL,
          carryover REAL NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(dossier_id, year)
        )
      `);

      // 5. Create annual_expense_year_items
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_year_items (
          id TEXT PRIMARY KEY,
          year_id TEXT NOT NULL REFERENCES annual_expense_years(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          budgeted_value REAL NOT NULL DEFAULT 0,
          classification TEXT,
          num_installments INTEGER NOT NULL DEFAULT 1,
          from_template INTEGER NOT NULL DEFAULT 0,
          position INTEGER DEFAULT 0
        )
      `);

      // 6. Create annual_expense_year_installments
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_year_installments (
          id TEXT PRIMARY KEY,
          year_item_id TEXT NOT NULL REFERENCES annual_expense_year_items(id) ON DELETE CASCADE,
          installment_number INTEGER NOT NULL,
          month INTEGER NOT NULL,
          day INTEGER NOT NULL
        )
      `);

      // 7. Create annual_expense_payments
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_payments (
          id TEXT PRIMARY KEY,
          installment_id TEXT NOT NULL REFERENCES annual_expense_year_installments(id) ON DELETE CASCADE,
          cycle_id TEXT NOT NULL REFERENCES expense_cycles(id) ON DELETE CASCADE,
          real_value REAL NOT NULL DEFAULT 0,
          paid INTEGER NOT NULL DEFAULT 0,
          UNIQUE(installment_id, cycle_id)
        )
      `);

      // 8. Create annual_expense_accounts
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_accounts (
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          PRIMARY KEY (dossier_id, account_id)
        )
      `);

      // 9. Create annual_expense_distributions
      db.exec(`
        CREATE TABLE IF NOT EXISTS annual_expense_distributions (
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          distribution_template_id TEXT NOT NULL REFERENCES expense_template_items(id) ON DELETE CASCADE,
          PRIMARY KEY (dossier_id, distribution_template_id)
        )
      `);
    },
  },
  {
    id: '018_paperless_integration',
    up() {
      const dossierCols = db.prepare('PRAGMA table_info(dossiers)').all();
      if (!dossierCols.find((c) => c.name === 'paperless_url')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN paperless_url TEXT');
      }
      if (!dossierCols.find((c) => c.name === 'paperless_token')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN paperless_token TEXT');
      }
      if (!dossierCols.find((c) => c.name === 'paperless_date_field_id')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN paperless_date_field_id INTEGER');
      }
      if (!dossierCols.find((c) => c.name === 'paperless_amount_field_id')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN paperless_amount_field_id INTEGER');
      }
      const templateCols = db.prepare('PRAGMA table_info(expense_template_items)').all();
      if (!templateCols.find((c) => c.name === 'paperless_tag_id')) {
        db.exec('ALTER TABLE expense_template_items ADD COLUMN paperless_tag_id INTEGER');
      }
      const cycleCols = db.prepare('PRAGMA table_info(cycle_items)').all();
      if (!cycleCols.find((c) => c.name === 'paperless_tag_id')) {
        db.exec('ALTER TABLE cycle_items ADD COLUMN paperless_tag_id INTEGER');
      }
    },
  },
  {
    id: '020_pwa_push_notifications',
    up() {
      // app_settings — stores VAPID keys and other app-wide config
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // push_subscriptions — browser push subscriptions per user
      db.exec(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint    TEXT NOT NULL UNIQUE,
          keys_p256dh TEXT NOT NULL,
          keys_auth   TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // user_notification_settings — per-user delivery preferences
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_notification_settings (
          user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          enabled              INTEGER NOT NULL DEFAULT 1,
          send_hour            INTEGER NOT NULL DEFAULT 9,
          send_minute          INTEGER NOT NULL DEFAULT 0,
          repeat_enabled       INTEGER NOT NULL DEFAULT 0,
          repeat_interval_days INTEGER NOT NULL DEFAULT 1
        )
      `);

      // dossier_notification_subscriptions — which dossiers a user opted into
      db.exec(`
        CREATE TABLE IF NOT EXISTS dossier_notification_subscriptions (
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, dossier_id)
        )
      `);

      // notification_log — deduplication and repetition tracking
      db.exec(`
        CREATE TABLE IF NOT EXISTS notification_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_key  TEXT NOT NULL,
          sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notification_log_lookup
          ON notification_log(user_id, dossier_id, event_type, event_key)
      `);

      // dossiers.expense_notification_days_before
      const dossierCols = db.prepare('PRAGMA table_info(dossiers)').all();
      if (!dossierCols.find((c) => c.name === 'expense_notification_days_before')) {
        db.exec('ALTER TABLE dossiers ADD COLUMN expense_notification_days_before INTEGER NOT NULL DEFAULT 1');
      }
    },
  },
  {
    id: '021_add_exclude_from_emergency_fund',
    up() {
      const tplCols = db.prepare('PRAGMA table_info(expense_template_items)').all();
      if (!tplCols.find((c) => c.name === 'exclude_from_emergency_fund')) {
        db.exec('ALTER TABLE expense_template_items ADD COLUMN exclude_from_emergency_fund INTEGER NOT NULL DEFAULT 0');
      }
      const ciCols = db.prepare('PRAGMA table_info(cycle_items)').all();
      if (!ciCols.find((c) => c.name === 'exclude_from_emergency_fund')) {
        db.exec('ALTER TABLE cycle_items ADD COLUMN exclude_from_emergency_fund INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
  {
    id: '022_backfill_cycle_item_template_links',
    up() {
      // Older imports left template_item_id NULL on every cycle item. Re-link items to
      // their matching template item (by dossier + section + name) so the emergency
      // fund average correctly recognizes them as template-derived rather than ad-hoc.
      db.exec(`
        UPDATE cycle_items
        SET template_item_id = (
          SELECT eti.id FROM expense_template_items eti
          JOIN expense_cycles ec ON ec.id = cycle_items.cycle_id
          WHERE eti.dossier_id = ec.dossier_id
            AND eti.section = cycle_items.section
            AND eti.name = cycle_items.name
        )
        WHERE template_item_id IS NULL
          AND EXISTS (
            SELECT 1 FROM expense_template_items eti
            JOIN expense_cycles ec ON ec.id = cycle_items.cycle_id
            WHERE eti.dossier_id = ec.dossier_id
              AND eti.section = cycle_items.section
              AND eti.name = cycle_items.name
          )
      `);
    },
  },
  {
    id: '023_add_account_id_to_distributions',
    up() {
      const tplCols = db.prepare('PRAGMA table_info(expense_template_items)').all();
      if (!tplCols.find((c) => c.name === 'account_id')) {
        db.exec('ALTER TABLE expense_template_items ADD COLUMN account_id TEXT');
      }
      const ciCols = db.prepare('PRAGMA table_info(cycle_items)').all();
      if (!ciCols.find((c) => c.name === 'account_id')) {
        db.exec('ALTER TABLE cycle_items ADD COLUMN account_id TEXT');
      }
    },
  },
  {
    id: '024_add_can_receive_transfers_to_accounts',
    up() {
      const cols = db.prepare('PRAGMA table_info(accounts)').all();
      if (!cols.find((c) => c.name === 'can_receive_transfers')) {
        db.exec('ALTER TABLE accounts ADD COLUMN can_receive_transfers INTEGER DEFAULT 1');
      }
    },
  },
  {
    id: '025_add_money_category_to_accounts',
    up() {
      const cols = db.prepare('PRAGMA table_info(accounts)').all();
      if (!cols.find((c) => c.name === 'money_category')) {
        db.exec(
          "ALTER TABLE accounts ADD COLUMN money_category TEXT DEFAULT 'active' CHECK(money_category IN ('idle', 'active', 'stocks'))"
        );
        db.exec(
          "UPDATE accounts SET money_category = CASE WHEN is_idle_money = 1 THEN 'idle' ELSE 'active' END"
        );
      }
      const colsAfterAdd = db.prepare('PRAGMA table_info(accounts)').all();
      if (colsAfterAdd.find((c) => c.name === 'is_idle_money')) {
        db.exec('ALTER TABLE accounts DROP COLUMN is_idle_money');
      }
    },
  },
  {
    id: '026_create_loans',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS loans (
          id TEXT PRIMARY KEY,
          dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active')),
          interest_rate REAL NOT NULL DEFAULT 0,
          salary REAL,
          principal REAL,
          term_months INTEGER,
          remaining_balance REAL,
          months_left INTEGER,
          expense_template_item_id TEXT REFERENCES expense_template_items(id) ON DELETE SET NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: '027_add_down_payment_to_loans',
    up() {
      const cols = db.prepare('PRAGMA table_info(loans)').all();
      if (!cols.find((c) => c.name === 'down_payment')) {
        db.exec('ALTER TABLE loans ADD COLUMN down_payment REAL');
      }
    },
  },
];

for (const migration of migrations) {
  const applied = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(migration.id);
  if (!applied) {
    console.log(`[db] Running migration: ${migration.id}`);
    migration.up();
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
    console.log(`[db] Migration applied: ${migration.id}`);
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
  const result = db.prepare('DELETE FROM sessions WHERE expired <= ?').run(Date.now());
  if (result.changes > 0) {
    console.log(`[db] Cleaned up ${result.changes} expired session(s)`);
  }
}, 60 * 60 * 1000);

module.exports = { db, SQLiteSessionStore };
