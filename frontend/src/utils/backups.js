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

export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// Overall state for the page's status banner: 'failed' when the last run failed, 'stale' when
// scheduled backups are on but the newest copy is more than 8 days old (a weekly run was
// missed), 'none' when there are no backups yet, else 'ok'.
export function backupHealth({ enabled, last_run: lastRun, backups }, now = new Date()) {
  if (lastRun && !lastRun.ok) return 'failed';
  if (!backups || backups.length === 0) return 'none';
  const ageDays = (now - new Date(backups[0].created_at)) / 86400000;
  if (enabled && ageDays > 8) return 'stale';
  return 'ok';
}
