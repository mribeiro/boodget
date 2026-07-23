const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createExpenseCycle,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('PATCH /cycles/:cycleId (year/month conflict)', () => {
  it('returns 409 when moving a cycle onto a period another cycle already occupies', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({ year: 2026, month: 1, salary: 1000, previous_balance: 0 });
    const secondRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 2, salary: 1000, previous_balance: 0 });

    const conflictRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${secondRes.body.id}`)
      .send({ year: 2026, month: 1 });
    expect(conflictRes.status).toBe(409);
  });
});

describe('cycle_start_day snapshotting', () => {
  it('keeps an already-created cycle on its own cycle_start_day after the dossier setting changes', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 25 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 3, salary: 1000, previous_balance: 0 });
    expect(cycleRes.body.cycle_start_day).toBe(25);

    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ cycle_start_day: 1 });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleRes.body.id}`);
    expect(detail.body.cycle_start_day).toBe(25); // unaffected by the later dossier-wide change

    // A newly-created cycle, however, should pick up the new setting.
    const newCycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 4, salary: 1000, previous_balance: 0 });
    expect(newCycleRes.body.cycle_start_day).toBe(1);
  });
});

describe('GET /cycles/:cycleId — annual_payments payload', () => {
  it('includes both budgeted_value and real_value for each annual payment row', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 6 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, {
      yearId: year.id,
      name: 'Car Insurance',
      budgeted_value: 240,
      installments: [{ month: 6, day: 25 }],
    });
    createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: cycle.id, paid: false });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.annual_payments).toHaveLength(1);
    const payment = detail.body.annual_payments[0];
    expect(payment.budgeted_value).toBe(240);
    expect(payment.real_value).toBe(0); // unpaid — real_value defaults to 0, not meaningful yet
    expect(payment.paid).toBe(0);
  });
});

describe('PATCH /settings — ai_user_context length cap', () => {
  it('rejects ai_user_context over 4000 characters', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/settings`)
      .send({ ai_user_context: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  it('accepts ai_user_context at exactly 4000 characters', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/settings`)
      .send({ ai_user_context: 'x'.repeat(4000) });
    expect(res.status).toBe(200);
  });
});
