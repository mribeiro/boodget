import {
  applyWeekendAdjustment,
  computeCycleStartDate,
  computeTheoreticalCycleEndDate,
  cycleYearMonth,
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
