import {
  computeMonthlyPayment,
  computeMonthsLeft,
  endDateFromMonthsLeft,
  scenarioDownpayment,
  scenarioTargetPayment,
  scenarioRateChange,
  computeAmortizationSchedule,
  groupScheduleByYear,
} from './loanMath';

describe('computeMonthlyPayment', () => {
  it('uses the linear principal/months branch when the rate is 0', () => {
    expect(computeMonthlyPayment(1200, 0, 12)).toBe(100);
  });

  it('uses the annuity formula when the rate is > 0', () => {
    // 10000 @ 12%/yr over 12 months
    const payment = computeMonthlyPayment(10000, 12, 12);
    expect(payment).toBeCloseTo(888.49, 2);
  });

  it('returns 0 when principal is not positive', () => {
    expect(computeMonthlyPayment(0, 5, 12)).toBe(0);
    expect(computeMonthlyPayment(-100, 5, 12)).toBe(0);
  });

  it('returns 0 when months is not positive', () => {
    expect(computeMonthlyPayment(1000, 5, 0)).toBe(0);
  });
});

describe('computeMonthsLeft (local-time clock source)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the current month when its payment day has not passed yet', () => {
    vi.setSystemTime(new Date(2026, 2, 10)); // March 10, 2026 local time
    // day_of_payment is the 15th — hasn't happened yet, so March itself still counts.
    expect(computeMonthsLeft('2026-03', 15)).toBe(1);
  });

  it('rolls into next month once the payment day has passed (boundary: exactly on the day)', () => {
    vi.setSystemTime(new Date(2026, 2, 15)); // March 15 — exactly on day_of_payment
    // "today's day >= dayOfPayment" is true at exact equality, so March is already paid.
    expect(computeMonthsLeft('2026-03', 15)).toBe(0);
    expect(computeMonthsLeft('2026-04', 15)).toBe(1);
  });

  it('clamps day_of_payment to the current month length (e.g. 31 in a 30-day month)', () => {
    vi.setSystemTime(new Date(2026, 3, 30)); // April 30, 2026 (April has 30 days)
    // effectiveDay = min(31, 30) = 30; today's date (30) >= 30 → already paid, rolls to May.
    expect(computeMonthsLeft('2026-04', 31)).toBe(0);
  });

  it('rolls over the calendar year boundary (December -> January)', () => {
    vi.setSystemTime(new Date(2026, 11, 20)); // December 20, 2026
    // Payment day 15 has passed, so counting starts from January 2027.
    expect(computeMonthsLeft('2027-01', 15)).toBe(1);
  });

  it('returns null when there is no end date', () => {
    expect(computeMonthsLeft(null, 15)).toBeNull();
  });

  it('never returns a negative number for an end date already in the past', () => {
    vi.setSystemTime(new Date(2026, 5, 1));
    expect(computeMonthsLeft('2020-01', 15)).toBe(0);
  });
});

describe('endDateFromMonthsLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10)); // March 10, 2026 — day_of_payment 15 not yet passed
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips with computeMonthsLeft', () => {
    const endDate = endDateFromMonthsLeft(6, 15);
    expect(computeMonthsLeft(endDate, 15)).toBe(6);
  });
});

describe('scenarioDownpayment', () => {
  it('flags paidOff when the downpayment covers the whole balance', () => {
    const result = scenarioDownpayment(5000, 5, 12, 5000);
    expect(result.paidOff).toBe(true);
    expect(result.newPaymentSameTerm).toBe(0);
    expect(result.newTermSamePayment).toBe(0);
  });

  it('flags paidOff at the exact boundary where downpayment equals balance', () => {
    const result = scenarioDownpayment(1000, 5, 12, 1000);
    expect(result.paidOff).toBe(true);
  });

  it('uses the linear branch for newTermSamePayment when the rate is 0', () => {
    const result = scenarioDownpayment(1200, 0, 12, 600);
    // currentPayment = 1200/12 = 100; newBalance = 600; newTermExact = 600/100 = 6
    expect(result.paidOff).toBe(false);
    expect(result.newTermSamePayment).toBe(6);
  });

  it('uses the log-based term formula when the rate is > 0', () => {
    const result = scenarioDownpayment(10000, 12, 24, 3000);
    expect(result.paidOff).toBe(false);
    expect(result.newTermSamePayment).toBeGreaterThan(0);
    expect(result.newTermSamePayment).toBeLessThan(24);
    expect(result.interestSaved).toBeGreaterThan(0);
  });
});

describe('scenarioTargetPayment', () => {
  it('computes a 0 lump sum via the linear branch when the rate is 0 and the target already matches', () => {
    const result = scenarioTargetPayment(1200, 0, 12, 100);
    expect(result.lumpSumNeeded).toBe(0);
    expect(result.alreadyMet).toBe(true);
  });

  it('flags alreadyMet at the exact boundary where target equals the current payment', () => {
    const currentPayment = computeMonthlyPayment(10000, 12, 24);
    const result = scenarioTargetPayment(10000, 12, 24, currentPayment);
    expect(result.alreadyMet).toBe(true);
    expect(result.lumpSumNeeded).toBe(0);
  });

  it('computes a positive lump sum for a target payment below the current one', () => {
    const result = scenarioTargetPayment(10000, 12, 24, 200);
    expect(result.alreadyMet).toBe(false);
    expect(result.lumpSumNeeded).toBeGreaterThan(0);
  });

  it('never returns a negative lump sum (clamped to 0)', () => {
    const result = scenarioTargetPayment(1000, 5, 12, 100000);
    expect(result.lumpSumNeeded).toBe(0);
  });
});

describe('scenarioRateChange', () => {
  it('reports zero difference when the new rate equals the current rate', () => {
    const result = scenarioRateChange(10000, 5, 24, 5);
    expect(result.paymentDifference).toBeCloseTo(0, 9);
    expect(result.interestDifference).toBeCloseTo(0, 9);
  });

  it('reports a lower payment and less interest for a rate decrease', () => {
    const result = scenarioRateChange(10000, 10, 24, 5);
    expect(result.paymentDifference).toBeLessThan(0);
    expect(result.interestDifference).toBeLessThan(0);
  });

  it('reports a higher payment and more interest for a rate increase', () => {
    const result = scenarioRateChange(10000, 5, 24, 10);
    expect(result.paymentDifference).toBeGreaterThan(0);
    expect(result.interestDifference).toBeGreaterThan(0);
  });

  it('handles a 0% new rate hypothetical', () => {
    const result = scenarioRateChange(10000, 5, 24, 0);
    expect(result.newPayment).toBeCloseTo(10000 / 24, 6);
  });
});

describe('computeAmortizationSchedule', () => {
  it('clamps the final row so the balance ends at exactly 0 (absorbs float drift)', () => {
    const payment = computeMonthlyPayment(10000, 7, 36);
    const schedule = computeAmortizationSchedule(10000, 7, 36, payment, null);
    expect(schedule).toHaveLength(36);
    expect(schedule[schedule.length - 1].balance).toBe(0);
  });

  it('produces a single-row schedule when only one month is left', () => {
    const payment = computeMonthlyPayment(500, 5, 1);
    const schedule = computeAmortizationSchedule(500, 5, 1, payment, null);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].balance).toBe(0);
  });
});

describe('groupScheduleByYear', () => {
  it('rolls up interest/principal per year and keeps the last month as endBalance, not a sum', () => {
    const schedule = [
      { year: 2026, month: 11, interest: 10, principal: 90, balance: 910 },
      { year: 2026, month: 12, interest: 9, principal: 91, balance: 819 },
      { year: 2027, month: 1, interest: 8, principal: 92, balance: 727 },
    ];
    const grouped = groupScheduleByYear(schedule);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].year).toBe(2026);
    expect(grouped[0].interest).toBe(19);
    expect(grouped[0].principal).toBe(181);
    expect(grouped[0].endBalance).toBe(819); // last month of 2026, not interest+principal sum
    expect(grouped[1].year).toBe(2027);
    expect(grouped[1].endBalance).toBe(727);
  });
});
