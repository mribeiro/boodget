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
