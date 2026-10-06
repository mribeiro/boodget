import { formatNumber } from './numbers';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A plain-English reading of the common BACKUP_CRON shapes ("M H * * D", "M H * * *",
// "M H D * *"); anything else is shown as the raw expression.
export function describeSchedule(cron) {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && mon === '*' && /^[0-7]$/.test(dow)) return `Weekly on ${DAYS[Number(dow) % 7]} at ${time}`;
  if (dom === '*' && mon === '*' && dow === '*') return `Daily at ${time}`;
  if (/^\d+$/.test(dom) && mon === '*' && dow === '*') return `Monthly on day ${dom} at ${time}`;
  return cron;
}

// Same thousands/decimal separators as every other number in the app (#379): 1.536,0 MB.
export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const one = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, one)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), one)} MB`;
}

// Longest gap, in days, between two runs of the schedule shapes describeSchedule reads (a month
// can be 31 days). Anything else is assumed to run at least monthly.
export function scheduleIntervalDays(cron) {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length === 5 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    const [, , dom, mon, dow] = parts;
    if (dom === '*' && mon === '*' && /^[0-7]$/.test(dow)) return 7;
    if (dom === '*' && mon === '*' && dow === '*') return 1;
  }
  return 31;
}

// Overall state for the page's status banner: 'failed' when the last run failed, 'stale' when
// scheduled backups are on but the newest copy is older than the schedule's own interval plus
// a day's grace (a run was missed — a fixed 8 days flagged every monthly schedule, #379),
// 'none' when there are no backups yet, else 'ok'.
export function backupHealth({ enabled, schedule, last_run: lastRun, backups }, now = new Date()) {
  if (lastRun && !lastRun.ok) return 'failed';
  if (!backups || backups.length === 0) return 'none';
  const ageDays = (now - new Date(backups[0].created_at)) / 86400000;
  if (enabled && ageDays > scheduleIntervalDays(schedule) + 1) return 'stale';
  return 'ok';
}
