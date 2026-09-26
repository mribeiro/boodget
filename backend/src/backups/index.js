const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { db, DB_PATH } = require('../db');
// Called as push.sendPush (not destructured) so tests can stub it.
const push = require('../notifications/push');

// Scheduled whole-database backups: a consistent online copy of the SQLite file (users, sessions,
// settings, every dossier), integrity-checked before it gets its final name, with the oldest
// copies pruned past the retention count. Getting copies off the machine is left to the
// operator's own tooling (Kopia, restic, a NAS mount...) pointed at BACKUP_DIR.

const FILE_RE = /^boodget-\d{4}-\d{2}-\d{2}_\d{6}\.db$/;
const PARTIAL_RE = /^\.boodget-.*\.partial$/;
const LAST_RUN_KEY = 'backup_last_run';
const DEFAULT_CRON = '0 3 * * 0'; // Sundays at 03:00, server time

function getConfig(env = process.env) {
  const keep = parseInt(env.BACKUP_KEEP, 10);
  return {
    // Off by default only in ephemeral previews, whose DB is wiped on every restart anyway.
    enabled: env.BACKUP_ENABLED ? env.BACKUP_ENABLED === 'true' : env.NODE_ENV !== 'ephemeral',
    dir: env.BACKUP_DIR || path.join(path.dirname(path.resolve(DB_PATH)), 'backups'),
    cron: env.BACKUP_CRON || DEFAULT_CRON,
    keep: Number.isInteger(keep) && keep >= 1 ? keep : 12,
  };
}

function stampFor(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}_${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

// Backups in `dir`, newest first. File names carry a UTC timestamp, so name order is age order.
function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => FILE_RE.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, created_at: stat.mtime.toISOString() };
    });
}

// Deletes all but the `keep` newest backups, plus any leftover partial file from an
// interrupted run. Returns the names removed.
function pruneBackups(dir, keep) {
  const removed = [];
  for (const { name } of listBackups(dir).slice(keep)) {
    fs.unlinkSync(path.join(dir, name));
    removed.push(name);
  }
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).filter((n) => PARTIAL_RE.test(n))) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
  return removed;
}

function getLastRun() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(LAST_RUN_KEY);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function recordLastRun(result) {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(LAST_RUN_KEY, JSON.stringify(result));
}

let running = false;

function isRunning() {
  return running;
}

// Takes one backup now. `trigger` is 'scheduled' or 'manual' (with the admin's username), for
// the log and the recorded last run. Throws on failure after recording it; a partial file is
// never left behind under a final name.
async function runBackup({ trigger = 'scheduled', by = null, now = new Date(), config = getConfig() } = {}) {
  if (running) {
    const err = new Error('A backup is already in progress');
    err.status = 409;
    throw err;
  }
  running = true;
  const name = `boodget-${stampFor(now)}.db`;
  const tmp = path.join(config.dir, `.${name}.partial`);
  try {
    fs.mkdirSync(config.dir, { recursive: true, mode: 0o700 });
    await db.backup(tmp);
    const copy = new Database(tmp, { readonly: true, fileMustExist: true });
    let check;
    try {
      check = copy.pragma('integrity_check', { simple: true });
    } finally {
      copy.close();
    }
    if (check !== 'ok') throw new Error(`Integrity check failed: ${check}`);
    // Holds password hashes, sessions and API keys: readable by the server's user only.
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, path.join(config.dir, name));
    const { size } = fs.statSync(path.join(config.dir, name));
    const pruned = pruneBackups(config.dir, config.keep);
    const result = { ok: true, at: now.toISOString(), trigger, by, file: name, size, error: null };
    recordLastRun(result);
    console.log(`[backup] Created ${name} (${size} bytes, ${trigger}${by ? ` by ${by}` : ''})${pruned.length ? `; pruned ${pruned.length}` : ''}`);
    return result;
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    recordLastRun({ ok: false, at: now.toISOString(), trigger, by, file: null, size: null, error: err.message });
    console.error(`[backup] Failed (${trigger}): ${err.message}`);
    throw err;
  } finally {
    running = false;
  }
}

// Push to every admin's devices, so a failing weekly backup doesn't go unnoticed for weeks.
async function notifyAdminsOfFailure(message) {
  const subs = db
    .prepare('SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE u.is_admin = 1')
    .all();
  for (const sub of subs) {
    await push.sendPush(sub, {
      type: 'backup_failed',
      title: 'Backup failed',
      body: `The scheduled database backup failed: ${message}`,
      url: '/backups',
    });
  }
}

async function runScheduledBackup(now = new Date()) {
  try {
    return await runBackup({ trigger: 'scheduled', now });
  } catch (err) {
    if (err.status === 409) return null; // a manual backup is already running
    await notifyAdminsOfFailure(err.message).catch((e) => console.error('[backup] Failure notification error:', e.message));
    return null;
  }
}

function startBackupScheduler(cron = require('node-cron')) {
  const config = getConfig();
  if (!config.enabled) {
    console.log('[backup] Scheduled backups disabled');
    return false;
  }
  if (!cron.validate(config.cron)) {
    console.error(`[backup] Invalid BACKUP_CRON "${config.cron}" — scheduled backups disabled`);
    return false;
  }
  cron.schedule(config.cron, () => { runScheduledBackup(); });
  console.log(`[backup] Scheduled "${config.cron}" into ${config.dir}, keeping ${config.keep}`);
  return true;
}

module.exports = {
  FILE_RE,
  getConfig,
  listBackups,
  pruneBackups,
  getLastRun,
  isRunning,
  runBackup,
  runScheduledBackup,
  startBackupScheduler,
};
