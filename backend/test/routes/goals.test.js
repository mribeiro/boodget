const { db } = require('../../src/db');
const { computeGoalValues, buildChartData } = require('../../src/routes/goals');
const {
  createUser,
  createDossier,
  createAccount,
  createMonth,
  createExpenseTemplateItem,
  createExpenseCycle,
  createGoal,
} = require('../fixtures/builders');

function setup() {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id });
  return { user, dossier };
}

describe('computeGoalValues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // Jan 15, 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes archived linked accounts from progress but does not double-count extra_value', () => {
    const { dossier } = setup();
    const activeAcc = createAccount(db, { dossierId: dossier.id });
    const archivedAcc = createAccount(db, { dossierId: dossier.id, archived: 1 });
    createMonth(db, {
      dossierId: dossier.id,
      year: 2026,
      month: 1,
      filled: 1,
      accountIds: [activeAcc.id, archivedAcc.id],
      values: { [activeAcc.id]: 1000, [archivedAcc.id]: 5000 },
    });
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 10000,
      target_date: '2099-01',
      contribution_mode: 'ad_hoc',
      extra_value: 200,
      accountIds: [activeAcc.id, archivedAcc.id],
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.current_accumulated_value).toBe(1000); // archived excluded
    expect(computed.total_current_progress).toBe(1000); // extra_value NOT added again
    expect(computed.archived_linked_accounts).toHaveLength(1);
  });

  it('clamps remaining_amount to 0 when progress overshoots the target', () => {
    const { dossier } = setup();
    const acc = createAccount(db, { dossierId: dossier.id });
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [acc.id], values: { [acc.id]: 20000 } });
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 10000,
      target_date: '2099-01',
      contribution_mode: 'ad_hoc',
      accountIds: [acc.id],
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.remaining_amount).toBe(0);
  });

  it('reduce_monthly_amount subtracts extra_value from remaining before dividing', () => {
    const { dossier } = setup();
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 12000,
      target_date: '2027-01', // 12 months from Jan 2026
      contribution_mode: 'ad_hoc',
      extra_value: 2000,
      extra_value_impact_mode: 'reduce_monthly_amount',
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.months_remaining).toBe(12);
    expect(computed.monthly_value_needed).toBeCloseTo((12000 - 2000) / 12, 6);
  });

  it('default mode (no extra or ad_hoc) divides remaining by months without subtracting extra', () => {
    const { dossier } = setup();
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 12000,
      target_date: '2027-01',
      contribution_mode: 'ad_hoc',
      extra_value: 2000,
      extra_value_impact_mode: 'anticipate_end_date',
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.monthly_value_needed).toBeCloseTo(12000 / 12, 6);
  });

  it('anticipated_completion_date is null when the extra-accelerated finish only ties the target date (strictly-earlier gate)', () => {
    const { dossier } = setup();
    const item = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', value: 1000 });
    // remaining=12000, expected=1000/mo, target_date 12 months out -> exactly matches, no extra
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 12000,
      target_date: '2027-01',
      contribution_mode: 'via_distributions',
      extra_value: 0,
      extra_value_impact_mode: 'anticipate_end_date',
      distributionTemplateIds: [item.id],
    });
    const computed = computeGoalValues(goal, dossier.id);
    // monthsNeeded = ceil(12000/1000) = 12, monthsRemaining = 12 -> 12 < 12 is false -> null
    expect(computed.anticipated_completion_date).toBeNull();
  });

  it('anticipated_completion_date is set when extra value pushes the finish strictly earlier', () => {
    const { dossier } = setup();
    const item = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', value: 1000 });
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 12000,
      target_date: '2027-01',
      contribution_mode: 'via_distributions',
      extra_value: 3000,
      extra_value_impact_mode: 'anticipate_end_date',
      distributionTemplateIds: [item.id],
    });
    const computed = computeGoalValues(goal, dossier.id);
    // monthsNeeded = ceil((12000-3000)/1000) = 9 < 12 -> set
    expect(computed.anticipated_completion_date).toBe('2026-10');
  });

  it('feasible uses a non-strict boundary: exactly meeting the target is feasible', () => {
    const { dossier } = setup();
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 12000,
      target_date: '2027-01',
      contribution_mode: 'manual',
      manual_monthly_value: 1000, // 12 * 1000 = 12000, exactly meets target
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.feasible).toBe(true);
  });

  it('feasible is never computed (null) for ad_hoc goals', () => {
    const { dossier } = setup();
    const goal = createGoal(db, { dossierId: dossier.id, target_value: 12000, target_date: '2027-01', contribution_mode: 'ad_hoc' });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.feasible).toBeNull();
  });

  it('state is completed when progress meets the target even exactly on the target date', () => {
    const { dossier } = setup();
    const acc = createAccount(db, { dossierId: dossier.id });
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [acc.id], values: { [acc.id]: 10000 } });
    // target_date is "now" (Jan 2026) exactly
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 10000,
      target_date: '2026-01',
      contribution_mode: 'ad_hoc',
      accountIds: [acc.id],
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.state).toBe('completed');
  });

  it('state is failed once the target date has passed without reaching the target', () => {
    const { dossier } = setup();
    const acc = createAccount(db, { dossierId: dossier.id });
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: 1, accountIds: [acc.id], values: { [acc.id]: 500 } });
    const goal = createGoal(db, {
      dossierId: dossier.id,
      target_value: 10000,
      target_date: '2025-12',
      contribution_mode: 'ad_hoc',
      accountIds: [acc.id],
    });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.state).toBe('failed');
  });

  it('state is active when neither completed nor past the target date', () => {
    const { dossier } = setup();
    const goal = createGoal(db, { dossierId: dossier.id, target_value: 10000, target_date: '2099-01', contribution_mode: 'ad_hoc' });
    const computed = computeGoalValues(goal, dossier.id);
    expect(computed.state).toBe('active');
  });
});

describe('buildChartData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for ad_hoc goals', () => {
    const { dossier } = setup();
    const goal = createGoal(db, { dossierId: dossier.id, contribution_mode: 'ad_hoc', target_value: 1000, target_date: '2099-01' });
    expect(buildChartData(goal, dossier.id, 0)).toBeNull();
  });

  it('anchors the last real point to the current accumulated value via a constant offset', () => {
    const { dossier } = setup();
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    const goal = createGoal(db, {
      dossierId: dossier.id,
      contribution_mode: 'manual',
      manual_monthly_value: 100,
      target_value: 5000,
      target_date: '2027-01',
    });
    db.prepare('INSERT INTO goal_cycle_contributions (goal_id, cycle_id, real_contribution) VALUES (?, ?, ?)').run(
      goal.id,
      cycle.id,
      100
    );
    const currentAccumulatedValue = 250; // true balance differs from the tracked 100 contribution
    const chart = buildChartData(goal, dossier.id, currentAccumulatedValue);
    const lastRealPoint = [...chart].reverse().find((p) => p.real_cumulative != null && !p.is_projected);
    expect(lastRealPoint.real_cumulative).toBe(currentAccumulatedValue);
  });
});
