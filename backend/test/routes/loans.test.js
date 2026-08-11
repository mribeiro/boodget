const { db } = require('../../src/db');
const {
  computeMonthlyPayment,
  computeMonthsLeft,
  computeLoanValues,
  validateLoanFields,
  computeTermFromAnchor,
  computePaymentsMade,
  projectBalance,
} = require('../../src/routes/loans');
const { createUser, createDossier, createExpenseTemplateItem } = require('../fixtures/builders');

describe('computeMonthlyPayment', () => {
  it('uses the linear principal/months branch when the rate is 0', () => {
    expect(computeMonthlyPayment(1200, 0, 12)).toBe(100);
  });

  it('uses the annuity formula when the rate is > 0', () => {
    expect(computeMonthlyPayment(10000, 12, 12)).toBeCloseTo(888.49, 2);
  });

  it('returns 0 when principal is not positive', () => {
    expect(computeMonthlyPayment(0, 5, 12)).toBe(0);
    expect(computeMonthlyPayment(-1, 5, 12)).toBe(0);
  });

  it('returns 0 when months is not positive', () => {
    expect(computeMonthlyPayment(1000, 5, 0)).toBe(0);
  });
});

describe('computeMonthsLeft (UTC clock source)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the current month when its payment day has not passed yet (UTC)', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 10))); // March 10, 2026 UTC
    expect(computeMonthsLeft('2026-03', 15)).toBe(1);
  });

  it('rolls to next month at the exact boundary where today == day_of_payment', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 15))); // March 15 UTC, exactly on day 15
    expect(computeMonthsLeft('2026-03', 15)).toBe(0);
    expect(computeMonthsLeft('2026-04', 15)).toBe(1);
  });

  it('clamps day_of_payment to the current UTC month length', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 30))); // April 30 UTC (30-day month)
    expect(computeMonthsLeft('2026-04', 31)).toBe(0);
  });

  it('rolls over the calendar year boundary (December -> January)', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 20)));
    expect(computeMonthsLeft('2027-01', 15)).toBe(1);
  });

  it('returns null when there is no end date', () => {
    expect(computeMonthsLeft(null, 15)).toBeNull();
  });

  it('never goes negative for a long-past end date', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 1)));
    expect(computeMonthsLeft('2020-01', 15)).toBe(0);
  });
});

describe('computeLoanValues', () => {
  let dossierId;
  beforeEach(() => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    dossierId = dossier.id;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes purchase_price as principal + down_payment when down_payment is set', () => {
    const loan = { status: 'draft', principal: 20000, down_payment: 5000, term_months: 24, interest_rate: 5 };
    expect(computeLoanValues(loan, dossierId).purchase_price).toBe(25000);
  });

  it('leaves purchase_price null when down_payment is not set', () => {
    const loan = { status: 'draft', principal: 20000, down_payment: null, term_months: 24, interest_rate: 5 };
    expect(computeLoanValues(loan, dossierId).purchase_price).toBeNull();
  });

  it('nulls remaining_interest instead of going negative once a loan is matured', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15)));
    const loan = {
      status: 'active',
      remaining_balance: 5000,
      interest_rate: 5,
      end_date: '2020-01', // long past
      day_of_payment: 10,
      principal: null,
      term_months: null,
      down_payment: null,
      opening_fee: null,
    };
    const computed = computeLoanValues(loan, dossierId);
    expect(computed.months_left).toBe(0);
    expect(computed.is_matured).toBe(true);
    expect(computed.remaining_interest).toBeNull();
    expect(computed.monthly_payment).toBe(0);
  });

  it('computes a positive remaining_interest for a non-matured active loan', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    const loan = {
      status: 'active',
      remaining_balance: 5000,
      interest_rate: 5,
      end_date: '2027-01',
      day_of_payment: 10,
      principal: null,
      term_months: null,
      down_payment: null,
      opening_fee: null,
    };
    const computed = computeLoanValues(loan, dossierId);
    expect(computed.is_matured).toBe(false);
    expect(computed.remaining_interest).toBeGreaterThan(0);
  });

  it('guards salary_pct against a 0 or null salary', () => {
    const base = { status: 'draft', principal: 10000, term_months: 12, interest_rate: 5 };
    expect(computeLoanValues({ ...base, salary: 0 }, dossierId).salary_pct).toBeNull();
    expect(computeLoanValues({ ...base, salary: null }, dossierId).salary_pct).toBeNull();
    expect(computeLoanValues({ ...base, salary: 2000 }, dossierId).salary_pct).toBeGreaterThan(0);
  });

  it('computes total_interest and total_amount_payable from the original origination values', () => {
    const loan = {
      status: 'draft',
      principal: 10000,
      term_months: 12,
      interest_rate: 0,
      opening_fee: 100,
    };
    const computed = computeLoanValues(loan, dossierId);
    // r=0 branch: monthly payment = 10000/12; total_interest = payment*12 - principal = 0
    expect(computed.total_interest).toBeCloseTo(0, 6);
    expect(computed.total_amount_payable).toBeCloseTo(10000 + 100, 6);
  });

  it('leaves total_interest/total_amount_payable null when principal or term_months is missing', () => {
    const loan = { status: 'draft', principal: null, term_months: 12, interest_rate: 5 };
    const computed = computeLoanValues(loan, dossierId);
    expect(computed.total_interest).toBeNull();
    expect(computed.total_amount_payable).toBeNull();
  });

  it('marks a linked Fixed expense as covered at the exact 0.005 epsilon boundary', () => {
    const item = createExpenseTemplateItem(db, {
      dossierId,
      section: 'expense',
      type: 'Fixed',
      name: 'Car Payment',
      value: 100,
    });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    // With r=0 and months_left=1, monthly_payment == remaining_balance exactly.
    const loan = {
      status: 'active',
      remaining_balance: 100.005,
      interest_rate: 0,
      end_date: '2026-01',
      day_of_payment: 31,
      expense_template_item_id: item.id,
    };
    const computed = computeLoanValues(loan, dossierId);
    expect(computed.monthly_payment).toBeCloseTo(100.005, 6);
    expect(computed.covered).toBe(true); // 100 >= 100.005 - 0.005 = 100.0 exactly
  });

  it('marks a linked Fixed expense as not covered just outside the epsilon', () => {
    const item = createExpenseTemplateItem(db, {
      dossierId,
      section: 'expense',
      type: 'Fixed',
      name: 'Car Payment',
      value: 100,
    });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    const loan = {
      status: 'active',
      remaining_balance: 100.0051,
      interest_rate: 0,
      end_date: '2026-01',
      day_of_payment: 31,
      expense_template_item_id: item.id,
    };
    const computed = computeLoanValues(loan, dossierId);
    expect(computed.covered).toBe(false);
  });
});

describe('validateLoanFields', () => {
  it('requires a positive principal and integer term_months >= 1 for draft loans', () => {
    expect(validateLoanFields({ name: 'x', status: 'draft', principal: 0, term_months: 12 }, null, 'd').error).toMatch(/principal/);
    expect(validateLoanFields({ name: 'x', status: 'draft', principal: 100, term_months: 0 }, null, 'd').error).toMatch(/term_months/);
    expect(validateLoanFields({ name: 'x', status: 'draft', principal: 100, term_months: 1.5 }, null, 'd').error).toMatch(/term_months/);
    expect(validateLoanFields({ name: 'x', status: 'draft', principal: 100, term_months: 12 }, null, 'd').error).toBeUndefined();
  });

  it('rejects setting down_payment/taeg/opening_fee on an active loan', () => {
    const body = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2099-01', day_of_payment: 5, down_payment: 500 };
    const result = validateLoanFields(body, null, 'd');
    expect(result.error).toMatch(/down_payment can only be set on draft/);
  });

  it('allows an active PUT that omits down_payment to carry the existing value forward', () => {
    const existing = { status: 'active', down_payment: 500, principal: null, term_months: null, taeg: null, opening_fee: null };
    const body = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2099-01', day_of_payment: 5 };
    const result = validateLoanFields(body, existing, 'd');
    expect(result.error).toBeUndefined();
    expect(result.down_payment).toBe(500);
  });

  it('rejects an explicit null for down_payment on a non-draft loan that already has a value', () => {
    const existing = { status: 'active', down_payment: 500, principal: null, term_months: null, taeg: null, opening_fee: null };
    const body = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2099-01', day_of_payment: 5, down_payment: null };
    const result = validateLoanFields(body, existing, 'd');
    expect(result.error).toMatch(/cannot be cleared/);
  });

  it('allows an explicit null for down_payment on a non-draft loan with no existing value', () => {
    const existing = { status: 'active', down_payment: null, principal: null, term_months: null, taeg: null, opening_fee: null };
    const body = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2099-01', day_of_payment: 5, down_payment: null };
    const result = validateLoanFields(body, existing, 'd');
    expect(result.error).toBeUndefined();
    expect(result.down_payment).toBeNull();
  });

  it('demoting active -> draft clears end_date, day_of_payment, and expense_template_item_id', () => {
    const existing = {
      name: 'Existing Loan',
      status: 'active',
      remaining_balance: 1000,
      end_date: '2099-01',
      day_of_payment: 5,
      expense_template_item_id: 'some-item',
      principal: 20000,
      term_months: 24,
      down_payment: null,
      taeg: null,
      opening_fee: null,
    };
    const body = { status: 'draft' };
    const result = validateLoanFields(body, existing, 'd');
    expect(result.error).toBeUndefined();
    expect(result.end_date).toBeNull();
    expect(result.day_of_payment).toBeNull();
    expect(result.expense_template_item_id).toBeNull();
  });

  it('demoting to draft does not clear historical origination fields (principal/term_months/down_payment/taeg/opening_fee)', () => {
    const existing = {
      name: 'Existing Loan',
      status: 'active',
      remaining_balance: 1000,
      end_date: '2099-01',
      day_of_payment: 5,
      principal: 20000,
      term_months: 24,
      down_payment: 5000,
      taeg: 7,
      opening_fee: 100,
    };
    const body = { status: 'draft' };
    const result = validateLoanFields(body, existing, 'd');
    expect(result.error).toBeUndefined();
    expect(result.principal).toBe(20000);
    expect(result.term_months).toBe(24);
    expect(result.down_payment).toBe(5000);
    expect(result.taeg).toBe(7);
    expect(result.opening_fee).toBe(100);
  });

  it('requires end_date to resolve to at least 1 month left for active loans', () => {
    const body = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2000-01', day_of_payment: 5 };
    const result = validateLoanFields(body, null, 'd');
    expect(result.error).toMatch(/end_date must be the current month or later/);
  });

  it('rejects day_of_payment outside 1-31', () => {
    const body = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2099-01', day_of_payment: 32 };
    expect(validateLoanFields(body, null, 'd').error).toMatch(/day_of_payment/);
  });
});

// ── Balance anchoring ────────────────────────────────────────────────────────

describe('computeTermFromAnchor', () => {
  it('counts both the anchor and the end month, so a same-month anchor schedules 1 payment', () => {
    expect(computeTermFromAnchor('2026-03', '2026-03')).toBe(1);
  });

  it('counts a full year inclusively', () => {
    expect(computeTermFromAnchor('2026-01', '2026-12')).toBe(12);
  });

  it('spans year boundaries', () => {
    expect(computeTermFromAnchor('2025-11', '2026-02')).toBe(4);
  });

  it('goes non-positive when the anchor is past the end date', () => {
    expect(computeTermFromAnchor('2026-05', '2026-03')).toBeLessThan(1);
  });

  it('is null when either side is missing', () => {
    expect(computeTermFromAnchor(null, '2026-03')).toBeNull();
    expect(computeTermFromAnchor('2026-03', null)).toBeNull();
  });
});

describe('computePaymentsMade', () => {
  afterEach(() => vi.useRealTimers());

  it('is 0 when the anchor is the current effective period', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z')); // day 3 < day_of_payment 8
    expect(computePaymentsMade('2026-03', 8, 48)).toBe(0);
  });

  it('counts the months elapsed since the anchor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    expect(computePaymentsMade('2026-03', 8, 48)).toBe(3);
  });

  it('counts this month as made once day_of_payment has passed, same as months_left', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z')); // day 20 >= day_of_payment 8
    expect(computePaymentsMade('2026-03', 8, 48)).toBe(4);
  });

  it('clamps to 0 for an anchor in the future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    expect(computePaymentsMade('2026-09', 8, 48)).toBe(0);
  });

  it('clamps to the full term for a loan left far past its end date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-06-03T12:00:00Z'));
    expect(computePaymentsMade('2026-03', 8, 12)).toBe(12);
  });
});

describe('projectBalance', () => {
  it('returns the balance untouched for 0 periods', () => {
    expect(projectBalance(10000, 5, 500, 0)).toBe(10000);
  });

  it('subtracts the whole payment each period at a 0% rate', () => {
    // 3 rows into a 12-row plan — a partial walk, so no final-row clamp applies.
    expect(projectBalance(1200, 0, 100, 3, 12)).toBeCloseTo(900, 6);
  });

  it('lands on exactly 0 after the full term rather than a float residue', () => {
    const payment = computeMonthlyPayment(10000, 6, 24);
    expect(projectBalance(10000, 6, payment, 24, 24)).toBe(0);
  });

  it('clamps the final row to 0 when the walk covers the whole plan', () => {
    expect(projectBalance(1200, 0, 100, 12)).toBe(0);
  });

  it('clamps at 0 rather than going negative when overshooting', () => {
    expect(projectBalance(1000, 0, 400, 10, 10)).toBe(0);
  });

  it('holds the balance rather than compounding it when the payment cannot cover the interest', () => {
    // Only reachable from hand-edited data; must not run away upward.
    expect(projectBalance(10000, 24, 50, 12, 12)).toBe(10000);
  });
});

describe('computeLoanValues — balance anchoring', () => {
  afterEach(() => vi.useRealTimers());

  const anchoredLoan = {
    status: 'active',
    interest_rate: 4.2,
    remaining_balance: 18000,
    balance_as_of: '2026-03',
    end_date: '2029-12',
    day_of_payment: 8,
    salary: 2000,
  };

  it('keeps monthly_payment identical as months pass — the drift this feature exists to fix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const march = computeLoanValues(anchoredLoan, 'd').monthly_payment;

    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    const june = computeLoanValues(anchoredLoan, 'd').monthly_payment;

    expect(june).toBe(march);
  });

  it('still drifts without an anchor, pinning the legacy fallback', () => {
    vi.useFakeTimers();
    const unanchored = { ...anchoredLoan, balance_as_of: null };
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const march = computeLoanValues(unanchored, 'd').monthly_payment;

    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    const june = computeLoanValues(unanchored, 'd').monthly_payment;

    expect(june).toBeGreaterThan(march);
  });

  it('reproduces the pre-anchor figures exactly when balance_as_of is null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const unanchored = computeLoanValues({ ...anchoredLoan, balance_as_of: null }, 'd');

    expect(unanchored.monthly_payment).toBe(
      computeMonthlyPayment(18000, 4.2, computeMonthsLeft('2029-12', 8))
    );
    expect(unanchored.current_balance).toBe(18000);
    expect(unanchored.payments_made).toBeNull();
    expect(unanchored.term_from_anchor).toBeNull();
  });

  it('holds months_left === term_from_anchor − payments_made across several dates', () => {
    vi.useFakeTimers();
    for (const now of ['2026-03-03', '2026-06-20', '2027-01-09', '2029-11-30']) {
      vi.setSystemTime(new Date(`${now}T12:00:00Z`));
      const v = computeLoanValues(anchoredLoan, 'd');
      expect(v.months_left).toBe(v.term_from_anchor - v.payments_made);
      expect(v.months_left).toBe(computeMonthsLeft('2029-12', 8));
    }
  });

  it('projects current_balance down from the anchor as payments come due', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const atAnchor = computeLoanValues(anchoredLoan, 'd');
    expect(atAnchor.current_balance).toBe(18000);
    expect(atAnchor.payments_made).toBe(0);

    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const later = computeLoanValues(anchoredLoan, 'd');
    expect(later.payments_made).toBe(6);
    expect(later.current_balance).toBeLessThan(18000);
    expect(later.current_balance).toBeGreaterThan(0);
  });

  it('computes remaining_interest against the live balance, not the dated anchor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const v = computeLoanValues(anchoredLoan, 'd');
    expect(v.remaining_interest).toBeCloseTo(v.monthly_payment * v.months_left - v.current_balance, 6);
  });

  it('clamps payments_made at 0 for a future anchor, leaving the balance untouched', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const v = computeLoanValues({ ...anchoredLoan, balance_as_of: '2026-09' }, 'd');
    expect(v.payments_made).toBe(0);
    expect(v.current_balance).toBe(18000);
  });

  it('falls back to the legacy branch for an anchor past the end date rather than emitting NaN', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    // Only reachable from hand-edited data — validation rejects it on write.
    const v = computeLoanValues({ ...anchoredLoan, balance_as_of: '2030-06' }, 'd');
    expect(v.term_from_anchor).toBeNull();
    expect(Number.isNaN(v.monthly_payment)).toBe(false);
    expect(v.current_balance).toBe(18000);
  });

  it('nulls remaining_interest once matured but keeps reporting the real payment', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-06-03T12:00:00Z')); // well past end_date
    const v = computeLoanValues(anchoredLoan, 'd');
    expect(v.is_matured).toBe(true);
    expect(v.months_left).toBe(0);
    expect(v.remaining_interest).toBeNull();
    // Unlike the pre-anchor behaviour, the payment does NOT collapse to 0 — a loan past
    // its end date isn't suddenly free.
    expect(v.monthly_payment).toBeGreaterThan(0);
    expect(v.current_balance).toBe(0);
  });

  it('keeps salary_pct stable as months pass', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const march = computeLoanValues(anchoredLoan, 'd').salary_pct;
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    expect(computeLoanValues(anchoredLoan, 'd').salary_pct).toBe(march);
  });

  it('keeps a covered loan covered as months pass', () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const item = createExpenseTemplateItem(db, {
      dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8,
    });
    const loan = { ...anchoredLoan, expense_template_item_id: item.id };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    expect(computeLoanValues(loan, dossier.id).covered).toBe(true);
    // Pre-anchor, the climbing payment flipped this to false on its own after a while.
    vi.setSystemTime(new Date('2029-06-03T12:00:00Z'));
    expect(computeLoanValues(loan, dossier.id).covered).toBe(true);
  });
});

describe('validateLoanFields — balance_as_of', () => {
  afterEach(() => vi.useRealTimers());

  const activeBody = { name: 'x', status: 'active', remaining_balance: 1000, end_date: '2099-01', day_of_payment: 5 };

  it('rejects a malformed month', () => {
    const result = validateLoanFields({ ...activeBody, balance_as_of: '2026/03' }, null, 'd');
    expect(result.error).toMatch(/balance_as_of must be in YYYY-MM format/);
  });

  it('rejects being set on a draft loan', () => {
    const body = { name: 'x', status: 'draft', principal: 1000, term_months: 12, balance_as_of: '2026-03' };
    expect(validateLoanFields(body, null, 'd').error).toMatch(/balance_as_of can only be set on active loans/);
  });

  it('rejects an anchor past the end date', () => {
    const result = validateLoanFields({ ...activeBody, end_date: '2099-01', balance_as_of: '2099-06' }, null, 'd');
    expect(result.error).toMatch(/balance_as_of must be the same month as end_date or earlier/);
  });

  it('clears it on demotion to draft, alongside the other active-only fields', () => {
    const existing = {
      name: 'x', status: 'active', interest_rate: 5, remaining_balance: 1000,
      end_date: '2099-01', day_of_payment: 5, balance_as_of: '2026-03', principal: 5000, term_months: 24,
    };
    const result = validateLoanFields({ status: 'draft' }, existing, 'd');
    expect(result.error).toBeUndefined();
    expect(result.balance_as_of).toBeNull();
    expect(result.end_date).toBeNull();
    expect(result.day_of_payment).toBeNull();
  });

  it('auto-anchors an active loan created without one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z')); // day 3 < day_of_payment 5
    const result = validateLoanFields(activeBody, null, 'd');
    expect(result.balance_as_of).toBe('2026-03');
  });

  it('re-anchors when the balance itself changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const existing = { ...activeBody, interest_rate: 5, balance_as_of: '2026-03' };
    const result = validateLoanFields({ ...activeBody, remaining_balance: 800 }, existing, 'd');
    expect(result.balance_as_of).toBe('2026-09');
  });

  it('does NOT re-anchor when the full payload is resent with an unchanged balance', () => {
    // LoanFormModal resends every field on save; a presence-only check would silently
    // wipe the recorded plan on an unrelated edit.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const existing = { ...activeBody, interest_rate: 5, balance_as_of: '2026-03' };
    const result = validateLoanFields({ ...activeBody, interest_rate: 6 }, existing, 'd');
    expect(result.balance_as_of).toBe('2026-03');
  });

  it('lets an explicit balance_as_of win over the auto-anchor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const result = validateLoanFields({ ...activeBody, balance_as_of: '2026-05' }, null, 'd');
    expect(result.balance_as_of).toBe('2026-05');
  });
});
