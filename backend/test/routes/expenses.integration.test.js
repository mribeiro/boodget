const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createExpenseCycle,
  createCycleItem,
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

    await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({ year: 2026, month: 1, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
    const secondRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 2, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });

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
      .send({ year: 2026, month: 3, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
    expect(cycleRes.body.cycle_start_day).toBe(25);

    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ cycle_start_day: 1 });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleRes.body.id}`);
    expect(detail.body.cycle_start_day).toBe(25); // unaffected by the later dossier-wide change

    // A newly-created cycle, however, should pick up the new setting.
    const newCycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 4, income_lines: [{ name: 'Salary', value: 1000 }], previous_balance: 0 });
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

describe('Closed cycle read-only enforcement', () => {
  it('rejects adding, editing, and deleting items on a closed cycle', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, {
      dossierId: dossier.id, year: 2026, month: 1,
      is_closed: 1, final_real_balance: 500,
    });
    const item = createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 500, day_of_payment: 1 });

    const addRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/items`)
      .send({ section: 'expense', name: 'Groceries', type: 'Budget', value: 100 });
    expect(addRes.status).toBe(409);

    const patchRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/items/${item.id}`)
      .send({ paid: true });
    expect(patchRes.status).toBe(409);

    const deleteRes = await agent.delete(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/items/${item.id}`);
    expect(deleteRes.status).toBe(409);

    // Item is untouched
    const stillThere = db.prepare('SELECT * FROM cycle_items WHERE id = ?').get(item.id);
    expect(stillThere.paid).toBe(0);
  });

  it('allows the same operations once the cycle is open', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 0 });
    const item = createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 500, day_of_payment: 1 });

    const patchRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/items/${item.id}`)
      .send({ paid: true });
    expect(patchRes.status).toBe(200);
  });

  it('rejects pulling annual expenses and paperless-apply on a closed cycle', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, {
      dossierId: dossier.id, year: 2026, month: 1,
      is_closed: 1, final_real_balance: 500,
    });

    const pullRes = await agent.post(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/pull-annual-expenses`);
    expect(pullRes.status).toBe(409);

    const applyRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/paperless-apply`)
      .send({ items: [{ cycle_item_id: 'x', value: 10, day_of_payment: 1 }] });
    expect(applyRes.status).toBe(409);
  });

  it('rejects toggling an annual payment linked to a closed cycle', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, {
      dossierId: dossier.id, year: 2026, month: 6,
      is_closed: 1, final_real_balance: 500,
    });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, {
      yearId: year.id, name: 'Car Insurance', budgeted_value: 240,
      installments: [{ month: 6, day: 25 }],
    });
    const payment = createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: cycle.id, paid: false });

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/annual-expense-payments/${payment.id}`)
      .send({ paid: true });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /cycles/:cycleId — reopen clears final_real_balance', () => {
  it('clears final_real_balance when reopening a closed cycle', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, {
      dossierId: dossier.id, year: 2026, month: 1,
      is_closed: 1, final_real_balance: 500,
    });

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`)
      .send({ is_closed: false });
    expect(res.status).toBe(200);
    expect(res.body.is_closed).toBeFalsy();
    expect(res.body.final_real_balance).toBeNull();

    // Re-closing still requires a fresh final_real_balance
    const closeWithoutBalance = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`)
      .send({ is_closed: true });
    expect(closeWithoutBalance.status).toBe(400);

    const closeRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`)
      .send({ is_closed: true, final_real_balance: 480 });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.final_real_balance).toBe(480);
  });

  it('leaves final_real_balance untouched when closing or updating it while already closed', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 0 });

    const closeRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`)
      .send({ is_closed: true, final_real_balance: 500 });
    expect(closeRes.body.final_real_balance).toBe(500);

    // Correcting the balance of an already-closed cycle (no is_closed change) is unaffected
    const correctionRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`)
      .send({ final_real_balance: 510 });
    expect(correctionRes.status).toBe(200);
    expect(correctionRes.body.final_real_balance).toBe(510);
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

describe('PATCH /settings — ai_gemini_api_key and Gemini ai_model', () => {
  it('sets and masks the Gemini API key, never returning the raw value', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ ai_gemini_api_key: 'g-secret' });
    expect(res.status).toBe(200);
    expect(res.body.ai_gemini_api_key_set).toBe(true);
    expect(res.body.ai_gemini_api_key).toBeUndefined();

    const row = db.prepare('SELECT ai_gemini_api_key FROM dossiers WHERE id = ?').get(dossier.id);
    expect(row.ai_gemini_api_key).toBe('g-secret');
  });

  it('clears the Gemini API key when set to an empty string', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_gemini_api_key: 'g-secret' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ ai_gemini_api_key: '' });
    expect(res.status).toBe(200);
    expect(res.body.ai_gemini_api_key_set).toBe(false);
  });

  it('rejects a non-string, non-null ai_gemini_api_key', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ ai_gemini_api_key: 42 });
    expect(res.status).toBe(400);
  });

  it('accepts a Gemini model id for ai_model', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ ai_model: 'gemini-3.1-pro-preview' });
    expect(res.status).toBe(200);
    expect(res.body.ai_model).toBe('gemini-3.1-pro-preview');
  });

  it('rejects an excluded Gemini variant for ai_model', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ ai_model: 'gemini-2.5-flash-lite' });
    expect(res.status).toBe(400);
  });
});
