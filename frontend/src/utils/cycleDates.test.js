import {
  applyWeekendAdjustment,
  computeCycleStartDate,
  computeTheoreticalCycleEndDate,
  cycleYearMonth,
  currentCycleYearMonth,
  dayInCycleWindow,
  formatCycleLabel,
  toIsoDate,
  fromIsoDate,
} from './cycleDates';

describe('applyWeekendAdjustment', () => {
  it('leaves a weekday date unchanged', () => {
    const wed = new Date(2026, 2, 25); // March 25, 2026 is a Wednesday
    expect(applyWeekendAdjustment(wed, 'previous_friday')).toEqual(wed);
    expect(applyWeekendAdjustment(wed, 'next_monday')).toEqual(wed);
  });

  it('shifts a Saturday back to Friday under previous_friday', () => {
    const sat = new Date(2026, 7, 1); // Saturday
    expect(applyWeekendAdjustment(sat, 'previous_friday')).toEqual(new Date(2026, 6, 31));
  });

  it('shifts a Sunday forward to Monday under next_monday', () => {
    const sun = new Date(2026, 7, 2); // Sunday
    expect(applyWeekendAdjustment(sun, 'next_monday')).toEqual(new Date(2026, 7, 3));
  });
});

describe('computeCycleStartDate', () => {
  it('crosses back into the previous month when the shift lands there', () => {
    // cycle_start_day = 1, August 2026 -> August 1 is a Saturday -> shifts to July 31
    expect(computeCycleStartDate(2026, 8, 1, 'previous_friday')).toEqual(new Date(2026, 6, 31));
  });
});

describe('computeTheoreticalCycleEndDate', () => {
  it('reflects a shift in the following cycle\'s start', () => {
    const end = computeTheoreticalCycleEndDate(2026, 10, 1, 'next_monday');
    expect(end).toEqual(new Date(2026, 10, 1));
  });
});

describe('cycleYearMonth', () => {
  it('returns the previous month while today is before the (adjusted) start', () => {
    // cycle_start_day = 25, previous_friday. June 25, 2026 is a Thursday (no shift).
    const today = new Date(2026, 5, 15); // June 15, before the June 25 start
    expect(cycleYearMonth(today, 25, 'previous_friday')).toEqual({ year: 2026, month: 5 });
  });

  it('returns the current month once today reaches the (adjusted) start', () => {
    const today = new Date(2026, 5, 25);
    expect(cycleYearMonth(today, 25, 'previous_friday')).toEqual({ year: 2026, month: 6 });
  });
});

describe('formatCycleLabel', () => {
  it('formats the month/year of the given end date', () => {
    expect(formatCycleLabel(new Date(2026, 3, 24))).toBe('April 2026');
  });
});

describe('toIsoDate / fromIsoDate round-trip', () => {
  it('round-trips without a timezone shift', () => {
    const original = new Date(2026, 0, 1);
    const iso = toIsoDate(original);
    expect(iso).toBe('2026-01-01');
    expect(fromIsoDate(iso)).toEqual(original);
  });
});

describe('currentCycleYearMonth (#362)', () => {
  const june = { year: 2026, month: 6, actual_start_date: '2026-06-25', actual_end_date: '2026-07-24' };

  it('picks the stored cycle covering today, whatever the live start day says', () => {
    // Start day since changed to 1: the formula alone would say July.
    expect(currentCycleYearMonth(new Date(2026, 6, 10), [june], 1, 'none')).toEqual({ year: 2026, month: 6 });
    expect(currentCycleYearMonth(new Date(2026, 6, 24, 18), [june], 1, 'none')).toEqual({ year: 2026, month: 6 });
  });

  it('falls back to the live-settings prediction when no stored cycle covers today', () => {
    expect(currentCycleYearMonth(new Date(2026, 6, 25), [june], 25, 'none')).toEqual({ year: 2026, month: 7 });
    expect(currentCycleYearMonth(new Date(2026, 6, 10), [], 25, 'none')).toEqual({ year: 2026, month: 6 });
  });

  it('rebuilds a missing stored window from the cycle’s own start day (default 25), not the live one', () => {
    const legacy = { year: 2026, month: 6, cycle_start_day: 25 };
    expect(currentCycleYearMonth(new Date(2026, 6, 10), [legacy], 1, 'none')).toEqual({ year: 2026, month: 6 });
    const bare = { year: 2026, month: 6 };
    expect(currentCycleYearMonth(new Date(2026, 6, 10), [bare], 1, 'none')).toEqual({ year: 2026, month: 6 });
  });

  it('prefers the earliest cycle when two overlap', () => {
    const july = { year: 2026, month: 7, actual_start_date: '2026-07-20', actual_end_date: '2026-08-24' };
    expect(currentCycleYearMonth(new Date(2026, 6, 22), [july, june], 25, 'none')).toEqual({ year: 2026, month: 6 });
  });
});

describe('dayInCycleWindow (#364)', () => {
  // Nominal start Sun 25 Jan 2026, shifted to Fri 23 Jan; ends Tue 24 Feb.
  const start = new Date(2026, 0, 23);
  const end = new Date(2026, 1, 24);

  it('places the shifted-in 23rd and 24th at the start of the cycle', () => {
    expect(dayInCycleWindow(23, start, end, 25)).toEqual(new Date(2026, 0, 23));
    expect(dayInCycleWindow(24, start, end, 25)).toEqual(new Date(2026, 0, 24));
  });

  it('places early days in the following month', () => {
    expect(dayInCycleWindow(5, start, end, 25)).toEqual(new Date(2026, 1, 5));
  });

  it('sorts a weekend-shifted cycle by its real dates', () => {
    const days = [5, 23, 28, 24];
    const sorted = [...days].sort((a, b) => dayInCycleWindow(a, start, end, 25) - dayInCycleWindow(b, start, end, 25));
    expect(sorted).toEqual([23, 24, 28, 5]);
  });

  it('clamps a day past the month end to its last day', () => {
    const s = new Date(2026, 0, 31);
    const e = new Date(2026, 1, 27);
    expect(dayInCycleWindow(31, s, e, 31)).toEqual(new Date(2026, 0, 31));
    expect(dayInCycleWindow(29, new Date(2026, 1, 1), new Date(2026, 1, 28), 1)).toEqual(new Date(2026, 1, 28));
  });

  it('falls back to the day-of-month split when no occurrence is in the window', () => {
    const s = new Date(2026, 0, 25);
    const e = new Date(2026, 0, 26);
    expect(dayInCycleWindow(27, s, e, 25)).toEqual(new Date(2026, 0, 27));
    expect(dayInCycleWindow(3, s, e, 25)).toEqual(new Date(2026, 1, 3));
  });
});
