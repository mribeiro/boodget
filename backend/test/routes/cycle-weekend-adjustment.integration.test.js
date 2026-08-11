const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, createExpenseCycle } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('POST /cycles — weekend start-day adjustment', () => {
  it('shifts a cycle start off a weekend and syncs the previous cycle end when the shift actually happens', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 1, cycle_start_weekend_adjustment: 'none' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    // July 2026: day 1 is a Wednesday — created while the dossier setting is still 'none',
    // so its theoretical end (Jul 31) is computed with no adjustment in effect.
    const julyRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 7, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
    expect(julyRes.body.actual_start_date).toBe('2026-07-01');
    expect(julyRes.body.actual_end_date).toBe('2026-07-31');

    // Switch the dossier to shift weekend starts to the Friday before.
    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ cycle_start_weekend_adjustment: 'previous_friday' });

    // August 2026: day 1 is a Saturday — shifts back to Jul 31.
    const augustRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 8, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
    expect(augustRes.body.actual_start_date).toBe('2026-07-31');
    expect(augustRes.body.cycle_start_weekend_adjustment).toBe('previous_friday');

    // July's end must have been pulled back to the day before August's real (shifted) start.
    const julyAfter = await agent.get(`/api/dossiers/${dossier.id}/cycles/${julyRes.body.id}`);
    expect(julyAfter.body.actual_end_date).toBe('2026-07-30');
  });

  it('does not touch the previous cycle end when the new cycle does not actually shift', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 15, cycle_start_weekend_adjustment: 'previous_friday' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    // March 2026: day 15 is a Sunday -> shifts to Mar 13.
    const marchRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 3, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
    const marchEndBefore = marchRes.body.actual_end_date;

    // April 2026: day 15 is a Wednesday -> no shift.
    const aprilRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 4, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
    expect(aprilRes.body.actual_start_date).toBe('2026-04-15');

    const marchAfter = await agent.get(`/api/dossiers/${dossier.id}/cycles/${marchRes.body.id}`);
    expect(marchAfter.body.actual_end_date).toBe(marchEndBefore);
  });
});

describe('PATCH /cycles/:cycleId — overlap detection on period edit', () => {
  function setupOverlap(user) {
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 1 });
    const cycleA = createExpenseCycle(db, {
      dossierId: dossier.id, year: 2026, month: 1, cycle_start_day: 1,
      actual_start_date: '2026-01-01', actual_end_date: '2026-02-05',
    });
    const cycleB = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 6, cycle_start_day: 1 });
    return { dossier, cycleA, cycleB };
  }

  it('returns 409 with conflict details when the move would overlap an adjacent cycle', async () => {
    const user = createUser(db);
    const { dossier, cycleA, cycleB } = setupOverlap(user);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/cycles/${cycleB.id}`).send({ year: 2026, month: 2 });
    expect(res.status).toBe(409);
    expect(res.body.overlap.conflicts).toHaveLength(1);
    expect(res.body.overlap.conflicts[0]).toMatchObject({ side: 'previous', cycle_id: cycleA.id });
  });

  it('applies the move without touching the neighbor when resolve_overlap is "ignore"', async () => {
    const user = createUser(db);
    const { dossier, cycleA, cycleB } = setupOverlap(user);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycleB.id}`)
      .send({ year: 2026, month: 2, resolve_overlap: 'ignore' });
    expect(res.status).toBe(200);
    expect(res.body.actual_start_date).toBe('2026-02-01');

    const cycleAAfter = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleA.id}`);
    expect(cycleAAfter.body.actual_end_date).toBe('2026-02-05'); // unchanged, overlap accepted
  });

  it('shrinks the neighbor to resolve the overlap when resolve_overlap is "recompute"', async () => {
    const user = createUser(db);
    const { dossier, cycleA, cycleB } = setupOverlap(user);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycleB.id}`)
      .send({ year: 2026, month: 2, resolve_overlap: 'recompute' });
    expect(res.status).toBe(200);
    expect(res.body.actual_start_date).toBe('2026-02-01');

    const cycleAAfter = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleA.id}`);
    expect(cycleAAfter.body.actual_end_date).toBe('2026-01-31'); // shrunk to butt up against cycleB's new start
  });

  it('applies the move normally with no prompt when there is no overlap', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 1 });
    const cycleB = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 6, cycle_start_day: 1 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/cycles/${cycleB.id}`).send({ year: 2026, month: 2 });
    expect(res.status).toBe(200);
    expect(res.body.actual_start_date).toBe('2026-02-01');
  });
});

describe('export/import — weekend adjustment round-trip', () => {
  it('round-trips cycle_start_weekend_adjustment and actual dates through export and import', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 1, cycle_start_weekend_adjustment: 'next_monday' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    // November 2026: day 1 is a Sunday -> shifts to Nov 2.
    await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({ year: 2026, month: 11, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });

    const exportRes = await agent.get(`/api/dossiers/${dossier.id}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.version).toBe(15);
    expect(exportRes.body.dossier.cycle_start_weekend_adjustment).toBe('next_monday');
    expect(exportRes.body.cycles[0].actual_start_date).toBe('2026-11-02');

    const importRes = await agent.post('/api/dossiers/import').send(exportRes.body);
    expect(importRes.status).toBe(201);

    const importedCycles = await agent.get(`/api/dossiers/${importRes.body.id}/cycles`);
    expect(importedCycles.body[0].actual_start_date).toBe('2026-11-02');
    expect(importedCycles.body[0].cycle_start_weekend_adjustment).toBe('next_monday');
  });

  it('recomputes actual dates with no adjustment for a pre-v13 export', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const legacyExport = {
      version: 12,
      dossier: { name: 'Legacy Dossier', currency: 'EUR', cycle_start_day: 1 },
      accounts: [],
      months: [],
      expense_template: [],
      annual_expense_template: [],
      workbench_snapshots: [],
      cycles: [{ year: 2026, month: 11, salary: 1000, previous_balance: 0, is_closed: false, final_real_balance: null, cycle_start_day: 1, items: [] }],
      goals: [],
      emergency_fund_accounts: [],
      emergency_fund_extra_values: [],
      annual_expense_years: [],
    };

    const importRes = await agent.post('/api/dossiers/import').send(legacyExport);
    expect(importRes.status).toBe(201);

    const cycles = await agent.get(`/api/dossiers/${importRes.body.id}/cycles`);
    // No weekend-adjustment data in the legacy export -> defaults to 'none' -> unshifted formula.
    expect(cycles.body[0].actual_start_date).toBe('2026-11-01');
    expect(cycles.body[0].cycle_start_weekend_adjustment).toBe('none');
  });
});
