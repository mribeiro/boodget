const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createLoan,
  createExpenseTemplateItem,
  createExpenseCycle,
  createCycleItem,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('POST /loans — draft/active field-locking at the HTTP layer', () => {
  it('rejects creating a draft loan with down_payment left unset but principal missing (400)', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/loans`)
      .send({ name: 'Car', status: 'draft', interest_rate: 5, term_months: 24 });
    expect(res.status).toBe(400);
  });

  it('rejects creating an active loan with down_payment set (draft-only field)', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/loans`).send({
      name: 'Car',
      status: 'active',
      interest_rate: 5,
      remaining_balance: 10000,
      end_date: '2099-01',
      day_of_payment: 5,
      down_payment: 1000,
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /loans/:loanId — promote/demote via HTTP', () => {
  it('promoting draft -> active via a minimal payload preserves principal/term_months', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const loan = createLoan(db, { dossierId: dossier.id, status: 'draft', principal: 20000, term_months: 36, down_payment: 5000 });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.put(`/api/dossiers/${dossier.id}/loans/${loan.id}`).send({
      status: 'active',
      remaining_balance: 20000,
      end_date: '2099-01',
      day_of_payment: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.principal).toBe(20000);
    expect(res.body.term_months).toBe(36);
    expect(res.body.down_payment).toBe(5000);
  });

  it('demoting active -> draft clears end_date/day_of_payment', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const loan = createLoan(db, {
      dossierId: dossier.id,
      status: 'active',
      remaining_balance: 10000,
      end_date: '2099-01',
      day_of_payment: 10,
      principal: 20000,
      term_months: 24,
    });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.put(`/api/dossiers/${dossier.id}/loans/${loan.id}`).send({ status: 'draft' });
    expect(res.status).toBe(200);
    expect(res.body.end_date).toBeNull();
    expect(res.body.day_of_payment).toBeNull();
    expect(res.body.principal).toBe(20000); // origination history preserved
  });
});

describe('create_expense_template_item — building the funding expense with the loan', () => {
  async function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    return { user, dossier, agent: await loggedInAgent(app, user) };
  }

  const activeBody = {
    name: 'Car Loan', status: 'active', interest_rate: 4.2,
    remaining_balance: 18000, end_date: '2099-12', day_of_payment: 8,
  };

  it('creates a Fixed "must" expense and links the loan to it in one request', async () => {
    const { dossier, agent } = await setup();
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/loans`)
      .send({ ...activeBody, create_expense_template_item: true });

    expect(res.status).toBe(201);
    expect(res.body.expense_template_item_id).toBeTruthy();
    expect(res.body.linked_item.name).toBe('Car Loan');
    // Defaulted to the loan's own stable payment, so coverage starts out green.
    expect(res.body.covered).toBe(true);

    const template = await agent.get(`/api/dossiers/${dossier.id}/expense-template`);
    const item = template.body.find((i) => i.id === res.body.expense_template_item_id);
    expect(item.section).toBe('expense');
    expect(item.type).toBe('Fixed');
    expect(item.classification).toBe('must');
    expect(item.day_of_payment).toBe(8);
  });

  it('honours name/value/day overrides', async () => {
    const { dossier, agent } = await setup();
    const res = await agent.post(`/api/dossiers/${dossier.id}/loans`).send({
      ...activeBody,
      create_expense_template_item: { name: 'Car direct debit', value: 1, day_of_payment: 12 },
    });
    expect(res.status).toBe(201);
    expect(res.body.linked_item).toMatchObject({ name: 'Car direct debit', value: 1 });
    // A deliberately under-budgeted override: 1 € can't cover any real payment, so the
    // coverage check must report it regardless of what the term works out to.
    expect(res.body.covered).toBe(false);
  });

  it('rejects it on a draft loan and creates nothing (the transaction never commits)', async () => {
    const { dossier, agent } = await setup();
    const res = await agent.post(`/api/dossiers/${dossier.id}/loans`).send({
      name: 'Study', status: 'draft', interest_rate: 3, principal: 1000, term_months: 12,
      create_expense_template_item: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only be used on active loans/);

    const template = await agent.get(`/api/dossiers/${dossier.id}/expense-template`);
    expect(template.body).toHaveLength(0);
  });

  it('refuses to guess when combined with an explicit expense_template_item_id', async () => {
    const { dossier, agent } = await setup();
    const existing = createExpenseTemplateItem(db, {
      dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Existing', value: 500, day_of_payment: 8,
    });
    const res = await agent.post(`/api/dossiers/${dossier.id}/loans`).send({
      ...activeBody, expense_template_item_id: existing.id, create_expense_template_item: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not both/);
  });

  it('can add and link an expense to an existing unlinked loan via PUT', async () => {
    const { dossier, agent } = await setup();
    const created = await agent.post(`/api/dossiers/${dossier.id}/loans`).send(activeBody);
    expect(created.body.linked_item).toBeNull();

    const res = await agent
      .put(`/api/dossiers/${dossier.id}/loans/${created.body.id}`)
      .send({ create_expense_template_item: true });
    expect(res.status).toBe(200);
    expect(res.body.linked_item.name).toBe('Car Loan');
  });
});

describe('GET /loans/:loanId/payment-status', () => {
  function setupDossier() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    return { user, dossier };
  }

  it('reports unlinked for a loan with no monthly expense assigned', async () => {
    const { user, dossier } = setupDossier();
    const loan = createLoan(db, {
      dossierId: dossier.id, status: 'active', remaining_balance: 18000,
      end_date: '2099-12', day_of_payment: 8, balance_as_of: '2026-03',
    });
    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tracking: 'unlinked', linked_item: null, periods: [] });
  });

  it('reports unlinked for a draft loan', async () => {
    const { user, dossier } = setupDossier();
    const loan = createLoan(db, { dossierId: dossier.id, status: 'draft' });
    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);
    expect(res.body.tracking).toBe('unlinked');
  });

  it('marks a period paid from the linked expense\'s cycle item, and null where no cycle covers it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z')); // day 3 < day_of_payment 8 → current period is 2026-05

    const { user, dossier } = setupDossier();
    const item = createExpenseTemplateItem(db, {
      dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8,
    });
    const loan = createLoan(db, {
      dossierId: dossier.id, status: 'active', remaining_balance: 18000,
      end_date: '2099-12', day_of_payment: 8, balance_as_of: '2026-03',
      expense_template_item_id: item.id,
    });
    // Cycle stored as (2026, 3) with start day 25 runs 25 Mar – 24 Apr, so it covers the
    // 8 Apr payment — not the 8 Mar one. That leaves March with no covering cycle.
    const aprilCycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3 });
    createCycleItem(db, {
      cycleId: aprilCycle.id, template_item_id: item.id, section: 'expense',
      type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8, paid: true,
    });

    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);

    expect(res.body.tracking).toBe('linked');
    // Anchor (2026-03) through the current period (2026-05) inclusive.
    expect(res.body.periods.map((p) => p.period)).toEqual(['2026-03', '2026-04', '2026-05']);

    const march = res.body.periods[0];
    expect(march.cycle_id).toBeNull();
    expect(march.paid).toBeNull(); // unknowable, NOT unpaid

    const april = res.body.periods[1];
    expect(april.cycle_id).toBe(aprilCycle.id);
    expect(april.paid).toBe(true);
    expect(april.matched_by).toBe('id');

    const may = res.body.periods[2];
    expect(may.paid).toBeNull(); // no cycle opened for May yet

    vi.useRealTimers();
  });

  it('reports paid:false — distinct from null — for a cycle item that exists but is unticked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));

    const { user, dossier } = setupDossier();
    const item = createExpenseTemplateItem(db, {
      dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8,
    });
    const loan = createLoan(db, {
      dossierId: dossier.id, status: 'active', remaining_balance: 18000,
      end_date: '2099-12', day_of_payment: 8, balance_as_of: '2026-04',
      expense_template_item_id: item.id,
    });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3 });
    createCycleItem(db, {
      cycleId: cycle.id, template_item_id: item.id, section: 'expense',
      type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8, paid: false,
    });

    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);
    expect(res.body.periods[0].paid).toBe(false);

    vi.useRealTimers();
  });

  it('falls back to matching by name when the template item was replaced with a new id', async () => {
    // expense-template bulk-replace reinserts every item with a fresh UUID and re-links
    // the loan by name; surviving cycle_items still point at the deleted id.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));

    const { user, dossier } = setupDossier();
    const item = createExpenseTemplateItem(db, {
      dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8,
    });
    const loan = createLoan(db, {
      dossierId: dossier.id, status: 'active', remaining_balance: 18000,
      end_date: '2099-12', day_of_payment: 8, balance_as_of: '2026-04',
      expense_template_item_id: item.id,
    });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3 });
    createCycleItem(db, {
      cycleId: cycle.id, template_item_id: 'a-since-deleted-item-id', section: 'expense',
      type: 'Fixed', name: 'Car Loan', value: 500, day_of_payment: 8, paid: true,
    });

    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);
    expect(res.body.periods[0].paid).toBe(true);
    expect(res.body.periods[0].matched_by).toBe('name');

    vi.useRealTimers();
  });

  it('names the other loans funded by the same expense', async () => {
    const { user, dossier } = setupDossier();
    const item = createExpenseTemplateItem(db, {
      dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Shared debit', value: 500, day_of_payment: 8,
    });
    const shared = { dossierId: dossier.id, status: 'active', remaining_balance: 5000, end_date: '2099-12', day_of_payment: 8, expense_template_item_id: item.id };
    const loan = createLoan(db, { ...shared, name: 'Loan A' });
    createLoan(db, { ...shared, name: 'Loan B' });

    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);
    expect(res.body.shared_with).toEqual(['Loan B']);
  });

  it('404s for a loan in another dossier', async () => {
    const { user, dossier } = setupDossier();
    const other = createDossier(db, { creatorId: createUser(db).id });
    const loan = createLoan(db, { dossierId: other.id, status: 'draft' });
    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/loans/${loan.id}/payment-status`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /loans/:loanId — balance anchoring at the HTTP layer', () => {
  it('auto-anchors an active loan created without a balance_as_of', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));

    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.post(`/api/dossiers/${dossier.id}/loans`).send({
      name: 'Car', status: 'active', interest_rate: 4, remaining_balance: 9000,
      end_date: '2029-12', day_of_payment: 8,
    });
    expect(res.status).toBe(201);
    expect(res.body.balance_as_of).toBe('2026-03');
    expect(res.body.payments_made).toBe(0);
    expect(res.body.current_balance).toBe(9000);

    vi.useRealTimers();
  });

  it('rejects an anchor past the end date', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.post(`/api/dossiers/${dossier.id}/loans`).send({
      name: 'Car', status: 'active', interest_rate: 4, remaining_balance: 9000,
      end_date: '2030-01', day_of_payment: 8, balance_as_of: '2030-06',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/balance_as_of/);
  });

  it('clears balance_as_of on demotion to draft', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const loan = createLoan(db, {
      dossierId: dossier.id, status: 'active', remaining_balance: 9000, principal: 12000,
      term_months: 60, end_date: '2099-12', day_of_payment: 8, balance_as_of: '2026-03',
    });
    const agent = await loggedInAgent(buildTestApp(), user);
    const res = await agent.put(`/api/dossiers/${dossier.id}/loans/${loan.id}`).send({ status: 'draft' });

    expect(res.status).toBe(200);
    expect(res.body.balance_as_of).toBeNull();
    expect(res.body.end_date).toBeNull();
  });
});
