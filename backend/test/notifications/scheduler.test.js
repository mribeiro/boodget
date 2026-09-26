const { isRepeatDue } = require('../../src/notifications/scheduler');

describe('isRepeatDue', () => {
  it('is due at the next daily check even though slightly less than 24 h have elapsed', () => {
    // Logged a second after yesterday's 09:00 check; today's check runs at 09:00:00.4.
    expect(isRepeatDue('2026-09-25 09:00:01', new Date('2026-09-26T09:00:00.400Z'), 1)).toBe(true);
  });

  it('honours an N-day interval exactly, not N+1', () => {
    const sent = '2026-09-20 09:00:01';
    expect(isRepeatDue(sent, new Date('2026-09-22T09:00:00.400Z'), 3)).toBe(false);
    expect(isRepeatDue(sent, new Date('2026-09-23T09:00:00.400Z'), 3)).toBe(true);
  });

  it('is not due again on the same UTC day', () => {
    expect(isRepeatDue('2026-09-26 00:00:05', new Date('2026-09-26T23:59:00Z'), 1)).toBe(false);
  });

  it('accepts SQLite datetime strings with or without the T separator', () => {
    expect(isRepeatDue('2026-09-25T09:00:01', new Date('2026-09-26T09:00:00Z'), 1)).toBe(true);
  });
});

const { isDueToday, localClock, runNotificationScheduler } = require('../../src/notifications/scheduler');

describe('localClock', () => {
  it('reads the wall-clock time in the given zone, across DST', () => {
    // Lisbon is UTC+1 in summer and UTC+0 in winter.
    expect(localClock(new Date('2026-07-01T08:00:00Z'), 'Europe/Lisbon')).toEqual({ date: '2026-07-01', hour: 9, minute: 0 });
    expect(localClock(new Date('2026-12-01T09:00:00Z'), 'Europe/Lisbon')).toEqual({ date: '2026-12-01', hour: 9, minute: 0 });
  });

  it('uses UTC without a zone', () => {
    expect(localClock(new Date('2026-07-01T23:30:00Z'), null)).toEqual({ date: '2026-07-01', hour: 23, minute: 30 });
  });
});

describe('isDueToday', () => {
  const settings = { send_hour: 9, send_minute: 0, timezone: 'Europe/Lisbon', last_evaluated_date: null };

  it('fires at 09:00 local time both in summer and in winter', () => {
    expect(isDueToday(settings, new Date('2026-07-01T08:00:00Z')).due).toBe(true); // 09:00 WEST
    expect(isDueToday(settings, new Date('2026-07-01T07:59:00Z')).due).toBe(false);
    expect(isDueToday(settings, new Date('2026-12-01T09:00:00Z')).due).toBe(true); // 09:00 WET
    expect(isDueToday(settings, new Date('2026-12-01T08:59:00Z')).due).toBe(false);
  });

  it('catches up later the same day when the exact minute was missed', () => {
    expect(isDueToday(settings, new Date('2026-07-01T13:37:00Z'))).toEqual({ due: true, localDate: '2026-07-01' });
  });

  it('is not due again once evaluated today, but is due the next day', () => {
    const done = { ...settings, last_evaluated_date: '2026-07-01' };
    expect(isDueToday(done, new Date('2026-07-01T20:00:00Z')).due).toBe(false);
    expect(isDueToday(done, new Date('2026-07-02T08:00:00Z')).due).toBe(true);
  });

  it('keeps the old UTC meaning for a setting with no zone', () => {
    const legacy = { ...settings, timezone: null };
    expect(isDueToday(legacy, new Date('2026-07-01T09:00:00Z')).due).toBe(true);
    expect(isDueToday(legacy, new Date('2026-07-01T08:59:00Z')).due).toBe(false);
  });

  it('falls back to UTC for an unknown zone name instead of never sending', () => {
    expect(isDueToday({ ...settings, timezone: 'Not/AZone' }, new Date('2026-07-01T09:00:00Z')).due).toBe(true);
  });
});

describe('runNotificationScheduler', () => {
  const { db } = require('../../src/db');
  const { createUser, createDossier } = require('../fixtures/builders');
  const push = require('../../src/notifications/push');

  it('notifies a due user once even when two runs overlap, and not again that day', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    // Day 1 threshold: the "snapshot missing" notification is always applicable, giving us something to send.
    db.prepare('UPDATE dossiers SET capital_snapshot_warning_day = 1 WHERE id = ?').run(dossier.id);
    db.prepare(
      `INSERT INTO user_notification_settings (user_id, enabled, send_hour, send_minute, timezone, repeat_enabled, repeat_interval_days)
       VALUES (?, 1, 9, 0, 'Europe/Lisbon', 1, 1)`
    ).run(user.id);
    db.prepare('INSERT INTO dossier_notification_subscriptions (user_id, dossier_id) VALUES (?, ?)').run(user.id, dossier.id);
    db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, 'https://push.example/1', 'k', 'a')").run(user.id);
    let release;
    const gate = new Promise((r) => { release = r; });
    const send = vi.spyOn(push, 'sendPush').mockImplementation(async () => { await gate; return { success: true }; });

    // 13:37 local — the 09:00 minute was missed (e.g. a restart), so this run catches up.
    const now = new Date('2026-07-15T12:37:00Z');
    const first = runNotificationScheduler(now);
    const second = runNotificationScheduler(now); // overlapping tick while the first is still sending
    release();
    await Promise.all([first, second]);
    await runNotificationScheduler(new Date('2026-07-15T18:00:00Z')); // later that day

    const sentToUser = send.mock.calls.length;
    expect(sentToUser).toBeGreaterThan(0);
    const logged = db.prepare('SELECT COUNT(*) AS n FROM notification_log WHERE user_id = ?').get(user.id).n;
    expect(logged).toBe(sentToUser); // one push subscription → one send per logged notification
    expect(db.prepare('SELECT last_evaluated_date FROM user_notification_settings WHERE user_id = ?').get(user.id).last_evaluated_date).toBe('2026-07-15');
    send.mockRestore();
  });
});
