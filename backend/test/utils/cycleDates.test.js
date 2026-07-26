const {
  applyWeekendAdjustment,
  computeCycleStartDate,
  computeTheoreticalCycleEndDate,
  toIsoDate,
  fromIsoDate,
} = require('../../src/utils/cycleDates');

describe('applyWeekendAdjustment', () => {
  it('leaves a weekday date unchanged regardless of mode', () => {
    const wed = new Date(2026, 2, 25); // March 25, 2026 is a Wednesday
    expect(applyWeekendAdjustment(wed, 'previous_friday')).toEqual(wed);
    expect(applyWeekendAdjustment(wed, 'next_monday')).toEqual(wed);
  });

  it("leaves any date unchanged when mode is 'none'", () => {
    const sat = new Date(2026, 7, 1); // August 1, 2026 is a Saturday
    expect(applyWeekendAdjustment(sat, 'none')).toEqual(sat);
  });

  it('shifts a Saturday back to Friday under previous_friday', () => {
    const sat = new Date(2026, 7, 1); // Saturday
    expect(applyWeekendAdjustment(sat, 'previous_friday')).toEqual(new Date(2026, 6, 31));
  });

  it('shifts a Sunday back to Friday under previous_friday', () => {
    const sun = new Date(2026, 7, 2); // Sunday
    expect(applyWeekendAdjustment(sun, 'previous_friday')).toEqual(new Date(2026, 6, 31));
  });

  it('shifts a Saturday forward to Monday under next_monday', () => {
    const sat = new Date(2026, 7, 1); // Saturday
    expect(applyWeekendAdjustment(sat, 'next_monday')).toEqual(new Date(2026, 7, 3));
  });

  it('shifts a Sunday forward to Monday under next_monday', () => {
    const sun = new Date(2026, 7, 2); // Sunday
    expect(applyWeekendAdjustment(sun, 'next_monday')).toEqual(new Date(2026, 7, 3));
  });
});

describe('computeCycleStartDate', () => {
  it('returns the raw day-of-month when it is not a weekend', () => {
    // cycle_start_day = 25, March 2026 -> March 25, 2026 is a Wednesday
    expect(computeCycleStartDate(2026, 3, 25, 'previous_friday')).toEqual(new Date(2026, 2, 25));
  });

  it('crosses back into the previous month when the shift lands there', () => {
    // cycle_start_day = 1, August 2026 -> August 1 is a Saturday -> shifts to July 31
    const result = computeCycleStartDate(2026, 8, 1, 'previous_friday');
    expect(result).toEqual(new Date(2026, 6, 31));
  });

  it('crosses forward into the next month when the shift lands there', () => {
    // cycle_start_day = 28, February 2026 -> Feb 28 is a Saturday -> shifts to Mar 2
    const result = computeCycleStartDate(2026, 2, 28, 'next_monday');
    expect(result).toEqual(new Date(2026, 2, 2));
  });
});

describe('computeTheoreticalCycleEndDate', () => {
  it('is one day before the following cycle\'s (adjusted) start', () => {
    // cycle_start_day = 1, weekend adjustment previous_friday.
    // September 2026's cycle starts Sep 1 (Tuesday) -> no shift, so August's
    // cycle should end Aug 31.
    const end = computeTheoreticalCycleEndDate(2026, 8, 1, 'previous_friday');
    expect(end).toEqual(new Date(2026, 7, 31));
  });

  it('reflects a shift in the following cycle\'s start', () => {
    // cycle_start_day = 1, next_monday. October 2026's cycle would start Nov 1
    // (Sunday) -> shifts to Nov 2, so October's cycle end is Nov 1.
    const end = computeTheoreticalCycleEndDate(2026, 10, 1, 'next_monday');
    expect(end).toEqual(new Date(2026, 10, 1));
  });
});

describe('toIsoDate / fromIsoDate round-trip', () => {
  it('round-trips a local date through an ISO string without a timezone shift', () => {
    const original = new Date(2026, 0, 1); // January 1, 2026
    const iso = toIsoDate(original);
    expect(iso).toBe('2026-01-01');
    expect(fromIsoDate(iso)).toEqual(original);
  });
});
