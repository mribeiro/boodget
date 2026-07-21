const { db } = require('../../src/db');
const { computeYearStatus, remainingCycleMonthsInYear } = require('../../src/routes/annual-expenses');
const { createAnnualPaymentsForCycle } = require('../../src/routes/expenses');
const {
  createUser,
  createDossier,
  createExpenseCycle,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
  createAccount,
  createMonth,
  createExpenseTemplateItem,
} = require('../fixtures/builders');

function setup(overrides = {}) {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id, ...overrides });
  return { user, dossier };
}

describe('remainingCycleMonthsInYear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes a month whose cycle start date has already passed', () => {
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026
    const months = remainingCycleMonthsInYear(2026, 25);
    // June's cycle starts May 25 (already passed); July's cycle starts June 25 (future)
    expect(months).not.toContain(6);
    expect(months).toContain(7);
  });
});

describe('computeYearStatus', () => {
  it('sorts items by first installment date and puts no-installment items last', () => {
    const { dossier } = setup();
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    createAnnualExpenseYearItem(db, { yearId: year.id, name: 'March Bill', budgeted_value: 120, installments: [{ month: 3, day: 1 }] });
    createAnnualExpenseYearItem(db, { yearId: year.id, name: 'January Bill', budgeted_value: 60, installments: [{ month: 1, day: 1 }] });
    createAnnualExpenseYearItem(db, { yearId: year.id, name: 'No Installments', budgeted_value: 10, installments: [] });
    const status = computeYearStatus(year.id, dossier.id);
    expect(status.items.map((i) => i.name)).toEqual(['January Bill', 'March Bill', 'No Installments']);
  });

  it('computes expected_value_per_installment as budgeted_value / num_installments', () => {
    const { dossier } = setup();
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    createAnnualExpenseYearItem(db, {
      yearId: year.id,
      budgeted_value: 300,
      num_installments: 3,
      installments: [{ month: 1, day: 1 }, { month: 5, day: 1 }, { month: 9, day: 1 }],
    });
    const status = computeYearStatus(year.id, dossier.id);
    expect(status.items[0].installments[0].expected_value).toBe(100);
  });

  it('clamps total_raise_needed to 0 when carryover exceeds total_budgeted', () => {
    const { dossier } = setup();
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026, carryover: 5000 });
    createAnnualExpenseYearItem(db, { yearId: year.id, budgeted_value: 100 });
    const status = computeYearStatus(year.id, dossier.id);
    expect(status.total_raise_needed).toBe(0);
  });

  it('matches an installment on the exact start-boundary date of a cycle', () => {
    const { dossier } = setup({ cycle_start_day: 25 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, {
      yearId: year.id,
      budgeted_value: 120,
      installments: [{ month: 3, day: 25 }], // exactly cycle_start_day of March
    });
    // Cycle stored as (year=2026, month=3) with start_day=25 runs Mar 25 - Apr 24.
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3, cycle_start_day: 25 });
    createAnnualPaymentsForCycle(dossier.id, cycle.id, 2026, 3, 25);
    const payments = db
      .prepare('SELECT * FROM annual_expense_payments WHERE installment_id = ?')
      .all(item.installmentIds[0]);
    expect(payments).toHaveLength(1);
    expect(payments[0].cycle_id).toBe(cycle.id);
  });

  it('does not match an installment one day before the cycle start boundary', () => {
    const { dossier } = setup({ cycle_start_day: 25 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, {
      yearId: year.id,
      budgeted_value: 120,
      installments: [{ month: 3, day: 24 }], // one day before cycle_start_day
    });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3, cycle_start_day: 25 });
    createAnnualPaymentsForCycle(dossier.id, cycle.id, 2026, 3, 25);
    const payments = db
      .prepare('SELECT * FROM annual_expense_payments WHERE installment_id = ?')
      .all(item.installmentIds[0]);
    expect(payments).toHaveLength(0);
  });

  it('is idempotent: pulling annual expenses into the same cycle twice does not duplicate payments', () => {
    const { dossier } = setup({ cycle_start_day: 25 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    createAnnualExpenseYearItem(db, { yearId: year.id, budgeted_value: 120, installments: [{ month: 3, day: 25 }] });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3, cycle_start_day: 25 });
    createAnnualPaymentsForCycle(dossier.id, cycle.id, 2026, 3, 25);
    createAnnualPaymentsForCycle(dossier.id, cycle.id, 2026, 3, 25);
    const payments = db.prepare('SELECT * FROM annual_expense_payments WHERE cycle_id = ?').all(cycle.id);
    expect(payments).toHaveLength(1);
  });

  it('raised_to_date-equivalent (accumulated_accounts + total_paid) does not regress when a bill is paid', () => {
    const { dossier } = setup();
    const acc = createAccount(db, { dossierId: dossier.id });
    db.prepare('INSERT INTO annual_expense_accounts (dossier_id, account_id) VALUES (?, ?)').run(dossier.id, acc.id);
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [acc.id], values: { [acc.id]: 1000 } });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, { yearId: year.id, budgeted_value: 120, installments: [{ month: 3, day: 1 }] });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3 });
    const before = computeYearStatus(year.id, dossier.id);
    const raisedBefore = before.accumulated_accounts + before.total_paid;

    // Marking the installment paid must only ever add to the combined "raised to date"
    // figure (accumulated_accounts + total_paid) — it must never regress it, since the
    // account balance snapshot is independent of whether a bill has since been paid out.
    createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: cycle.id, real_value: 100, paid: 1 });

    const after = computeYearStatus(year.id, dossier.id);
    const raisedAfter = after.accumulated_accounts + after.total_paid;
    expect(raisedAfter).toBe(raisedBefore + 100);
    expect(after.accumulated_accounts).toBe(before.accumulated_accounts); // unaffected by paying
  });

  it('total_remaining and total_paid reflect only paid installments', () => {
    const { dossier } = setup();
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, {
      yearId: year.id,
      budgeted_value: 200,
      num_installments: 2,
      installments: [{ month: 1, day: 1 }, { month: 7, day: 1 }],
    });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: cycle.id, real_value: 100, paid: 1 });
    const status = computeYearStatus(year.id, dossier.id);
    expect(status.total_paid).toBe(100);
    expect(status.total_remaining).toBe(100); // 200 budgeted - 100 paid
  });

  it('sums contributed_distributions from done distribution cycle items within the calendar year', () => {
    const { dossier } = setup({ cycle_start_day: 25 });
    const distItem = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', value: 200 });
    db.prepare('INSERT INTO annual_expense_distributions (dossier_id, distribution_template_id) VALUES (?, ?)').run(
      dossier.id,
      distItem.id
    );
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3, cycle_start_day: 25 }); // ends Apr 24, 2026 -> year 2026
    const { createCycleItem } = require('../fixtures/builders');
    createCycleItem(db, {
      cycleId: cycle.id,
      section: 'distribution',
      value: 200,
      done: true,
      template_item_id: distItem.id,
    });
    const status = computeYearStatus(year.id, dossier.id);
    expect(status.contributed_distributions).toBe(200);
  });
});
