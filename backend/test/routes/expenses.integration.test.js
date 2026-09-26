const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createAccount,
  createExpenseCycle,
  createCycleItem,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
  createGoal,
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

describe('PATCH /settings — paperless_url change clears the stored token', () => {
  function setup() {
    const owner = createUser(db);
    const dossier = createDossier(db, { creatorId: owner.id });
    db.prepare("UPDATE dossiers SET paperless_url = 'https://paperless.example', paperless_token = 'SECRET' WHERE id = ?").run(dossier.id);
    return { owner, dossier };
  }
  const tokenOf = (id) => db.prepare('SELECT paperless_token FROM dossiers WHERE id = ?').get(id).paperless_token;

  it('clears the token when a shared user repoints the URL, so the secret is never sent to the new host', async () => {
    const { dossier } = setup();
    const guest = createUser(db);
    db.prepare('INSERT INTO dossier_access (dossier_id, user_id) VALUES (?, ?)').run(dossier.id, guest.id);
    const agent = await loggedInAgent(buildTestApp(), guest);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ paperless_url: 'https://attacker.example' });

    expect(res.status).toBe(200);
    expect(res.body.paperless_token_set).toBe(false);
    expect(tokenOf(dossier.id)).toBeNull();
  });

  it('keeps the token when the URL is re-saved unchanged or the token is sent alongside the new URL', async () => {
    const { owner, dossier } = setup();
    const agent = await loggedInAgent(buildTestApp(), owner);

    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ paperless_url: 'https://paperless.example' });
    expect(tokenOf(dossier.id)).toBe('SECRET');

    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ paperless_url: 'https://new.example', paperless_token: 'NEW' });
    expect(tokenOf(dossier.id)).toBe('NEW');
  });

  it('keeps the token when an unrelated setting changes', async () => {
    const { owner, dossier } = setup();
    const agent = await loggedInAgent(buildTestApp(), owner);

    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ paperless_date_field_id: 3 });
    expect(tokenOf(dossier.id)).toBe('SECRET');
  });
});

describe('Template bulk-replace preserves fields the caller does not send (Workbench sync)', () => {
  it('expense section keeps paperless_tag_id and exclude_from_emergency_fund when omitted, but honours explicit values', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = await loggedInAgent(buildTestApp(), user);
    await agent.post(`/api/dossiers/${dossier.id}/expense-template`).send({
      section: 'expense', name: 'Electricity', type: 'Fixed', value: 60, day_of_payment: 5, paperless_tag_id: 7, exclude_from_emergency_fund: true,
    });
    await agent.post(`/api/dossiers/${dossier.id}/expense-template`).send({
      section: 'expense', name: 'Water', type: 'Fixed', value: 20, day_of_payment: 8, paperless_tag_id: 9,
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/expense-template/bulk-replace`).send({
      section: 'expense',
      items: [
        { name: 'Electricity', type: 'Fixed', value: 65, day_of_payment: 5, classification: 'must' },
        { name: 'Water', type: 'Fixed', value: 20, day_of_payment: 8, paperless_tag_id: null },
      ],
    });

    expect(res.status).toBe(200);
    const electricity = res.body.find((i) => i.name === 'Electricity');
    const water = res.body.find((i) => i.name === 'Water');
    expect(electricity.value).toBe(65);
    expect(electricity.paperless_tag_id).toBe(7);
    expect(electricity.exclude_from_emergency_fund).toBe(1);
    expect(water.paperless_tag_id).toBeNull();
  });

  it('distribution section keeps the funding account and the Annual Expenses distribution selection', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const agent = await loggedInAgent(buildTestApp(), user);
    const dist = (await agent.post(`/api/dossiers/${dossier.id}/expense-template`).send({
      section: 'distribution', name: 'Annual fund', value: 100, account_id: account.id,
    })).body;
    await agent.put(`/api/dossiers/${dossier.id}/annual-expenses/distributions`).send({ distribution_template_ids: [dist.id] });

    const res = await agent.post(`/api/dossiers/${dossier.id}/expense-template/bulk-replace`).send({
      section: 'distribution',
      items: [{ name: 'Annual fund', value: 120, must_amount: null, want_amount: null, save_amount: 120 }],
    });

    const newDist = res.body.find((i) => i.name === 'Annual fund');
    expect(newDist.account_id).toBe(account.id);
    const selected = (await agent.get(`/api/dossiers/${dossier.id}/annual-expenses/distributions`)).body;
    expect(selected).toEqual([newDist.id]);
  });

  it('annual template keeps an item\'s installment schedule when the payload carries none', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = await loggedInAgent(buildTestApp(), user);
    await agent.post(`/api/dossiers/${dossier.id}/annual-expense-template`).send({
      name: 'Insurance', value: 600, num_installments: 2, installments: [{ month: 3, day: 1 }, { month: 9, day: 15 }],
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/annual-expense-template/bulk-replace`).send({
      items: [
        { name: 'Insurance', value: 650, classification: 'must' },
        { name: 'Road tax', value: 120, classification: 'must', day_of_payment: 10, month_of_payment: 5 },
      ],
    });

    expect(res.status).toBe(200);
    const insurance = res.body.find((i) => i.name === 'Insurance');
    expect(insurance.value).toBe(650);
    expect(insurance.num_installments).toBe(2);
    expect(insurance.installments.map((i) => [i.month, i.day])).toEqual([[3, 1], [9, 15]]);
    const roadTax = res.body.find((i) => i.name === 'Road tax');
    expect(roadTax.installments.map((i) => [i.month, i.day])).toEqual([[5, 10]]);
  });

  it('annual template still honours an explicitly provided schedule for an existing item', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = await loggedInAgent(buildTestApp(), user);
    await agent.post(`/api/dossiers/${dossier.id}/annual-expense-template`).send({
      name: 'Insurance', value: 600, num_installments: 2, installments: [{ month: 3, day: 1 }, { month: 9, day: 15 }],
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/annual-expense-template/bulk-replace`).send({
      items: [{ name: 'Insurance', value: 600, num_installments: 1, installments: [{ month: 6, day: 1 }] }],
    });

    const insurance = res.body.find((i) => i.name === 'Insurance');
    expect(insurance.num_installments).toBe(1);
    expect(insurance.installments.map((i) => [i.month, i.day])).toEqual([[6, 1]]);
  });
});

describe('DELETE /cycles/:cycleId (history guard)', () => {
  async function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    createCycleItem(db, { cycleId: cycle.id, section: 'expense', name: 'Rent', type: 'Fixed', value: 800 });
    const agent = await loggedInAgent(buildTestApp(), user);
    return { dossier, cycle, agent };
  }

  function annualPayment(dossier, cycle, paid) {
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Car insurance' });
    return createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: cycle.id, real_value: 310, paid });
  }

  it('refuses to delete a cycle holding a paid annual payment, keeping everything intact', async () => {
    const { dossier, cycle, agent } = await setup();
    const payment = annualPayment(dossier, cycle, true);

    const res = await agent.delete(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 paid annual expense payment \(Car insurance\)/);
    expect(res.body.blockers.paid_annual_payments).toHaveLength(1);
    expect(db.prepare('SELECT id FROM expense_cycles WHERE id = ?').get(cycle.id)).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycle_items WHERE cycle_id = ?').get(cycle.id).n).toBe(1);
    expect(db.prepare('SELECT real_value FROM annual_expense_payments WHERE id = ?').get(payment.id).real_value).toBe(310);
  });

  it('refuses to delete a cycle holding a recorded goal contribution', async () => {
    const { dossier, cycle, agent } = await setup();
    const goal = createGoal(db, { dossierId: dossier.id, name: 'Holiday', contribution_mode: 'manual' });
    db.prepare('INSERT INTO goal_cycle_contributions (goal_id, cycle_id, real_contribution) VALUES (?, ?, ?)').run(goal.id, cycle.id, 150);

    const res = await agent.delete(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 goal \(Holiday\)/);
    expect(db.prepare('SELECT real_contribution FROM goal_cycle_contributions WHERE cycle_id = ?').get(cycle.id).real_contribution).toBe(150);
  });

  it('still deletes a cycle whose annual payments are unpaid and goal contributions are zero', async () => {
    const { dossier, cycle, agent } = await setup();
    annualPayment(dossier, cycle, false);
    const goal = createGoal(db, { dossierId: dossier.id, contribution_mode: 'manual' });
    db.prepare('INSERT INTO goal_cycle_contributions (goal_id, cycle_id, real_contribution) VALUES (?, ?, 0)').run(goal.id, cycle.id);

    const res = await agent.delete(`/api/dossiers/${dossier.id}/cycles/${cycle.id}`);

    expect(res.status).toBe(204);
    expect(db.prepare('SELECT id FROM expense_cycles WHERE id = ?').get(cycle.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycle_items WHERE cycle_id = ?').get(cycle.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM annual_expense_payments WHERE cycle_id = ?').get(cycle.id).n).toBe(0);
  });
});
