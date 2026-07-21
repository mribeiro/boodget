const { db } = require('../../src/db');
const { computeEmergencyFundStatus } = require('../../src/routes/emergency-fund');
const {
  createUser,
  createDossier,
  createAccount,
  createMonth,
  createExpenseCycle,
  createCycleItem,
  createAnnualExpenseTemplateItem,
} = require('../fixtures/builders');

function setup(overrides = {}) {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id, ...overrides });
  return { user, dossier };
}

describe('computeEmergencyFundStatus', () => {
  it('returns no_data with a 0 target when there are no cycles and no extra values', () => {
    const { dossier } = setup();
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.status).toBe('no_data');
    expect(status.target_value).toBe(0);
    expect(status.average_monthly_expense).toBe(0);
  });

  it('stays no_data even when a meaningful target is computable from extra values alone', () => {
    const { dossier } = setup({ emergency_fund_months_multiplier: 6 });
    db.prepare(
      'INSERT INTO emergency_fund_extra_values (id, dossier_id, name, value, position) VALUES (?, ?, ?, ?, ?)'
    ).run('extra-1', dossier.id, 'Rent', 500, 0);
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.status).toBe('no_data');
    expect(status.effective_monthly_base).toBe(500);
    expect(status.target_value).toBe(3000); // 6 * 500 — a real, non-zero target
  });

  it('excludes ad-hoc (no template link) items and exclude_from_emergency_fund items from the average', () => {
    const { dossier } = setup();
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 1 });
    // Counted: a Fixed expense linked to a template item.
    createCycleItem(db, {
      cycleId: cycle.id,
      section: 'expense',
      type: 'Fixed',
      value: 100,
      template_item_id: 'some-template-item',
    });
    // Excluded: ad-hoc (no template_item_id).
    createCycleItem(db, {
      cycleId: cycle.id,
      section: 'expense',
      type: 'Fixed',
      value: 9999,
      template_item_id: null,
    });
    // Excluded: explicitly flagged.
    createCycleItem(db, {
      cycleId: cycle.id,
      section: 'expense',
      type: 'Fixed',
      value: 9999,
      template_item_id: 'another-template-item',
      exclude_from_emergency_fund: true,
    });
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.average_monthly_expense).toBe(100);
  });

  it('uses spent for Budget items on a closed cycle and value (max) on an open cycle', () => {
    const { dossier } = setup();
    const closedCycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 1 });
    createCycleItem(db, {
      cycleId: closedCycle.id,
      section: 'expense',
      type: 'Budget',
      value: 300,
      spent: 250,
      template_item_id: 'tmpl-budget',
    });
    const openCycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 2, is_closed: 0 });
    createCycleItem(db, {
      cycleId: openCycle.id,
      section: 'expense',
      type: 'Budget',
      value: 300,
      spent: 250,
      template_item_id: 'tmpl-budget',
    });
    const status = computeEmergencyFundStatus(dossier.id);
    // closed cycle contributes spent (250), open cycle contributes value (300)
    expect(status.average_monthly_expense).toBe((250 + 300) / 2);
    expect(status.cycles_considered).toBe(2);
  });

  it('uses at most Y most recent cycles and reports cycles_considered < cycles_requested when fewer exist', () => {
    const { dossier } = setup({ emergency_fund_cycles_to_average: 6 });
    createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 1 });
    createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 2, is_closed: 1 });
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.cycles_considered).toBe(2);
    expect(status.cycles_requested).toBe(6);
  });

  it('folds the annual expense template total / 12 into the effective monthly base', () => {
    const { dossier } = setup();
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, value: 1200 });
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.annual_expenses_monthly_avg).toBe(100);
  });

  it('excludes archived accounts from current_value even if still linked', () => {
    const { dossier } = setup();
    const account = createAccount(db, { dossierId: dossier.id, archived: 1 });
    db.prepare('INSERT INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)').run(dossier.id, account.id);
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [account.id], values: { [account.id]: 5000 } });
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.current_value).toBe(0);
    void month;
  });

  it('is healthy exactly at the boundary where current_value equals target_value', () => {
    const { dossier } = setup({ emergency_fund_months_multiplier: 1 });
    const account = createAccount(db, { dossierId: dossier.id });
    db.prepare('INSERT INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)').run(dossier.id, account.id);
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [account.id], values: { [account.id]: 100 } });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 1 });
    createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', value: 100, template_item_id: 'tmpl-x' });
    const status = computeEmergencyFundStatus(dossier.id);
    // target = 1 * 100 = 100; current = 100 → healthy (>=), not underfunded
    expect(status.target_value).toBe(100);
    expect(status.current_value).toBe(100);
    expect(status.status).toBe('healthy');
  });

  it('is underfunded just below the target boundary', () => {
    const { dossier } = setup({ emergency_fund_months_multiplier: 1 });
    const account = createAccount(db, { dossierId: dossier.id });
    db.prepare('INSERT INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)').run(dossier.id, account.id);
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [account.id], values: { [account.id]: 99 } });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 1 });
    createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', value: 100, template_item_id: 'tmpl-x' });
    const status = computeEmergencyFundStatus(dossier.id);
    expect(status.status).toBe('underfunded');
  });
});
