const { db } = require('../../src/db');
const {
  computeMonthlyPayment,
  computeMonthsLeft,
  computeLoanValues,
  validateLoanFields,
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
