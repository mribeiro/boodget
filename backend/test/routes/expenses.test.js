const { db } = require('../../src/db');
const { computeSummary } = require('../../src/routes/expenses');
const {
  createUser,
  createDossier,
  createAccount,
  createExpenseTemplateItem,
} = require('../fixtures/builders');
const { buildTestApp } = require('../helpers/app');
const supertest = require('supertest');

function setup() {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id });
  return { user, dossier };
}

describe('computeSummary', () => {
  it('sums Fixed (paid) and Budget (spent) toward total_expenses_paid, and totals value for total_expenses', () => {
    const cycle = { salary: 2000, previous_balance: 100, is_closed: 0 };
    const items = [
      { section: 'expense', type: 'Fixed', value: 500, paid: 1 },
      { section: 'expense', type: 'Fixed', value: 200, paid: 0 },
      { section: 'expense', type: 'Budget', value: 300, spent: 250 },
      { section: 'distribution', value: 400, done: 1, account_id: 'acc-1' },
      { section: 'distribution', value: 100, done: 0, account_id: null },
    ];
    const summary = computeSummary(cycle, items);
    expect(summary.total_expenses).toBe(500 + 200 + 300);
    expect(summary.total_expenses_paid).toBe(500 + 250);
    expect(summary.total_expenses_unpaid).toBe(500 + 200 + 300 - (500 + 250));
    expect(summary.total_distributions).toBe(500);
    expect(summary.total_distributions_done).toBe(400);
    expect(summary.expected_balance).toBe(2000 + 100 - 1000 - 500);
  });

  it('groups distributions_by_account, using null for unassigned', () => {
    const cycle = { salary: 0, previous_balance: 0, is_closed: 0 };
    const items = [
      { section: 'distribution', value: 100, account_id: 'acc-1' },
      { section: 'distribution', value: 50, account_id: 'acc-1' },
      { section: 'distribution', value: 30, account_id: null },
    ];
    const summary = computeSummary(cycle, items);
    const unassigned = summary.distributions_by_account.find((d) => d.account_id === null);
    const assigned = summary.distributions_by_account.find((d) => d.account_id === 'acc-1');
    expect(assigned.total).toBe(150);
    expect(unassigned.total).toBe(30);
  });

  it('only includes balance_difference/final_real_balance on a closed cycle', () => {
    const openCycle = { salary: 1000, previous_balance: 0, is_closed: 0 };
    const summaryOpen = computeSummary(openCycle, []);
    expect(summaryOpen.balance_difference).toBeUndefined();

    const closedCycle = { salary: 1000, previous_balance: 0, is_closed: 1, final_real_balance: 950 };
    const summaryClosed = computeSummary(closedCycle, []);
    expect(summaryClosed.balance_difference).toBe(950 - 1000);
  });
});

describe('POST /cycles — template copy behavior', () => {
  it('clamps a template day_of_payment to the last day of the cycle month (e.g. 30 -> 28 in Feb)', async () => {
    const { user, dossier } = setup();
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 500, day_of_payment: 30 });

    const app = buildTestApp();
    const agent = supertest.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: user.password });

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 2, salary: 2000, previous_balance: 0 }); // February 2026 (28 days)
    expect(res.status).toBe(201);

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${res.body.id}`);
    const rentItem = detail.body.items.find((i) => i.name === 'Rent');
    expect(rentItem.day_of_payment).toBe(28);
  });

  it('only copies the funding account link if it can still receive transfers at copy time', async () => {
    const { user, dossier } = setup();
    const account = createAccount(db, { dossierId: dossier.id, can_receive_transfers: 1 });
    const distItem = createExpenseTemplateItem(db, {
      dossierId: dossier.id,
      section: 'distribution',
      name: 'Savings',
      value: 100,
      account_id: account.id,
    });
    // Disable transfers on the account before creating the cycle.
    db.prepare('UPDATE accounts SET can_receive_transfers = 0 WHERE id = ?').run(account.id);

    const app = buildTestApp();
    const agent = supertest.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 3, salary: 2000, previous_balance: 0 });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${res.body.id}`);
    const savingsItem = detail.body.items.find((i) => i.name === 'Savings');
    expect(savingsItem.account_id).toBeNull();
    void distItem;
  });

  it('does not retroactively change an already-created cycle when the template later changes', async () => {
    const { user, dossier } = setup();
    const templateItem = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Internet', value: 40 });

    const app = buildTestApp();
    const agent = supertest.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
    const cycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 4, salary: 2000, previous_balance: 0 });

    // Change the template value after the cycle exists.
    await agent.put(`/api/dossiers/${dossier.id}/expense-template/${templateItem.id}`).send({ value: 999 });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleRes.body.id}`);
    const internetItem = detail.body.items.find((i) => i.name === 'Internet');
    expect(internetItem.value).toBe(40); // unaffected by the later template change
  });

  it('propagates exclude_from_emergency_fund from the template to already-created cycle items', async () => {
    const { user, dossier } = setup();
    const templateItem = createExpenseTemplateItem(db, {
      dossierId: dossier.id,
      section: 'expense',
      type: 'Fixed',
      name: 'Insurance',
      value: 40,
      exclude_from_emergency_fund: false,
    });

    const app = buildTestApp();
    const agent = supertest.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
    const cycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 5, salary: 2000, previous_balance: 0 });

    await agent.put(`/api/dossiers/${dossier.id}/expense-template/${templateItem.id}`).send({ exclude_from_emergency_fund: true });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleRes.body.id}`);
    const insuranceItem = detail.body.items.find((i) => i.name === 'Insurance');
    expect(!!insuranceItem.exclude_from_emergency_fund).toBe(true); // DOES propagate, unlike other fields
  });
});
