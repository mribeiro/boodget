import { describeSchedule, formatBytes, backupHealth } from './backups';

describe('describeSchedule', () => {
  it('reads weekly, daily and monthly shapes', () => {
    expect(describeSchedule('0 3 * * 0')).toBe('Weekly on Sunday at 03:00');
    expect(describeSchedule('30 1 * * *')).toBe('Daily at 01:30');
    expect(describeSchedule('0 4 1 * *')).toBe('Monthly on day 1 at 04:00');
  });

  it('falls back to the raw expression', () => {
    expect(describeSchedule('*/15 * * * *')).toBe('*/15 * * * *');
  });
});

describe('formatBytes', () => {
  it('uses a decimal comma', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3,0 MB');
  });
});

describe('backupHealth', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  const recent = [{ created_at: '2026-09-27T03:00:00Z' }];

  it('flags a failed last run first', () => {
    expect(backupHealth({ enabled: true, last_run: { ok: false }, backups: recent }, now)).toBe('failed');
  });

  it('flags a missed weekly run only while scheduling is on', () => {
    const old = [{ created_at: '2026-09-10T03:00:00Z' }];
    expect(backupHealth({ enabled: true, last_run: { ok: true }, backups: old }, now)).toBe('stale');
    expect(backupHealth({ enabled: false, last_run: { ok: true }, backups: old }, now)).toBe('ok');
  });

  it('reports none and ok', () => {
    expect(backupHealth({ enabled: true, last_run: null, backups: [] }, now)).toBe('none');
    expect(backupHealth({ enabled: true, last_run: { ok: true }, backups: recent }, now)).toBe('ok');
  });
});
