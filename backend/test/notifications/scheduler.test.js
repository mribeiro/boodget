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

const { isDueToday, localClock, runNotificationScheduler, carSnapshotNotifications } = require('../../src/notifications/scheduler');

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

describe('carSnapshotNotifications', () => {
  const { db } = require('../../src/db');
  const { createUser, createDossier, createCar, createCarMonth } = require('../fixtures/builders');

  function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, name: 'Home' });
    return dossier;
  }

  it("asks for last month's snapshot of every car still missing one", () => {
    const dossier = setup();
    const a = createCar(db, { dossierId: dossier.id, name: 'Daily' });
    const b = createCar(db, { dossierId: dossier.id, name: 'EV' });
    db.prepare("UPDATE cars SET created_at = '2026-05-10 10:00:00' WHERE id IN (?, ?)").run(a.id, b.id);
    createCarMonth(db, { carId: b.id, year: 2026, month: 6 });

    const notes = carSnapshotNotifications(dossier, '2026-07-01');
    expect(notes).toEqual([{
      type: 'car_snapshot_missing',
      key: `car_snapshot:${a.id}:2026-06`,
      title: 'Car snapshot missing',
      body: "Home — record Daily's June snapshot",
      url: `/dossiers/${dossier.id}/cars/${a.id}`,
    }]);
  });

  it('wraps January back to December of the previous year', () => {
    const dossier = setup();
    const car = createCar(db, { dossierId: dossier.id });
    db.prepare("UPDATE cars SET created_at = '2025-12-02 10:00:00' WHERE id = ?").run(car.id);
    expect(carSnapshotNotifications(dossier, '2026-01-01').map((n) => n.key)).toEqual([`car_snapshot:${car.id}:2025-12`]);
    createCarMonth(db, { carId: car.id, year: 2025, month: 12 });
    expect(carSnapshotNotifications(dossier, '2026-01-03')).toEqual([]);
  });

  it("skips a car created this month, since it didn't exist last month", () => {
    const dossier = setup();
    const car = createCar(db, { dossierId: dossier.id });
    db.prepare("UPDATE cars SET created_at = '2026-07-01 00:00:05' WHERE id = ?").run(car.id);
    expect(carSnapshotNotifications(dossier, '2026-07-01')).toEqual([]);
  });

  it('is sent by the scheduler on the 1st, deep-linking to the car', async () => {
    const push = require('../../src/notifications/push');
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, name: 'Garage' });
    const car = createCar(db, { dossierId: dossier.id, name: 'Wagon' });
    db.prepare("UPDATE cars SET created_at = '2026-01-01 10:00:00' WHERE id = ?").run(car.id);
    db.prepare(
      `INSERT INTO user_notification_settings (user_id, enabled, send_hour, send_minute, timezone, repeat_enabled, repeat_interval_days)
       VALUES (?, 1, 9, 0, 'Europe/Lisbon', 0, 1)`
    ).run(user.id);
    db.prepare('INSERT INTO dossier_notification_subscriptions (user_id, dossier_id) VALUES (?, ?)').run(user.id, dossier.id);
    db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, 'https://push.example/car', 'k', 'a')").run(user.id);
    const send = vi.spyOn(push, 'sendPush').mockResolvedValue({ success: true });

    // 08:00Z on Oct 1 is 09:00 in Lisbon.
    await runNotificationScheduler(new Date('2026-10-01T08:00:00Z'));
    const carPushes = send.mock.calls.filter(([sub, payload]) => sub.user_id === user.id && payload.type === 'car_snapshot_missing');
    expect(carPushes).toHaveLength(1);
    expect(carPushes[0][1]).toMatchObject({ body: "Garage — record Wagon's September snapshot", url: `/dossiers/${dossier.id}/cars/${car.id}` });
    send.mockRestore();
  });
});
