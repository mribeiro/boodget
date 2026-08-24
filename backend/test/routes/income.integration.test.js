const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createExpenseCycle,
  createIncomeTemplateItem,
  createCycleIncomeItem,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

function setup() {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id });
  return { user, dossier };
}

describe('Income template CRUD', () => {
  it('creates, lists, updates, and deletes income template items', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const createRes = await agent
      .post(`/api/dossiers/${dossier.id}/income-template`)
      .send({ name: 'Company salary', default_value: 2500 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Company salary');
    expect(createRes.body.default_value).toBe(2500);

    const listRes = await agent.get(`/api/dossiers/${dossier.id}/income-template`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const patchRes = await agent
      .patch(`/api/dossiers/${dossier.id}/income-template/${createRes.body.id}`)
      .send({ default_value: 2600 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.default_value).toBe(2600);

    const deleteRes = await agent.delete(`/api/dossiers/${dossier.id}/income-template/${createRes.body.id}`);
    expect(deleteRes.status).toBe(204);
    const listAfter = await agent.get(`/api/dossiers/${dossier.id}/income-template`);
    expect(listAfter.body).toHaveLength(0);
  });

  it('rejects a negative default_value', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/income-template`)
      .send({ name: 'Bad line', default_value: -5 });
    expect(res.status).toBe(400);
  });
});

describe('POST /cycles — income_lines', () => {
  it('creates cycle_income_items for both template-linked and ad-hoc lines', async () => {
    const { user, dossier } = setup();
    const templateItem = createIncomeTemplateItem(db, { dossierId: dossier.id, name: 'Company salary', default_value: 2000 });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({
      year: 2026,
      month: 1,
      income_lines: [
        { template_item_id: templateItem.id, name: 'Company salary', value: 2000 },
        { template_item_id: null, name: 'One-off bonus', value: 300 },
      ],
      previous_balance: 0,
    });
    expect(res.status).toBe(201);

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${res.body.id}`);
    expect(detail.body.income_items).toHaveLength(2);
    expect(detail.body.income_total).toBe(2300);
    expect(detail.body.summary.total_available).toBe(2300);
    const adhoc = detail.body.income_items.find((i) => i.name === 'One-off bonus');
    expect(adhoc.template_item_id).toBeNull();
    const linked = detail.body.income_items.find((i) => i.name === 'Company salary');
    expect(linked.template_item_id).toBe(templateItem.id);
  });

  it('400s when income_lines is not an array', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 1, previous_balance: 0 });
    expect(res.status).toBe(400);
  });

  it('400s when a line has a negative value', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({
      year: 2026,
      month: 1,
      income_lines: [{ name: 'Bad', value: -100 }],
      previous_balance: 0,
    });
    expect(res.status).toBe(400);
  });

  it('400s when template_item_id belongs to a different dossier', async () => {
    const { user, dossier } = setup();
    const otherUser = createUser(db);
    const otherDossier = createDossier(db, { creatorId: otherUser.id });
    const foreignTemplateItem = createIncomeTemplateItem(db, { dossierId: otherDossier.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({
      year: 2026,
      month: 1,
      income_lines: [{ template_item_id: foreignTemplateItem.id, name: 'X', value: 100 }],
      previous_balance: 0,
    });
    expect(res.status).toBe(400);
  });
});

describe('Cycle income-item CRUD', () => {
  it('creates an ad-hoc line, edits it, and deletes it on an open cycle', async () => {
    const { user, dossier } = setup();
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 0 });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const createRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items`)
      .send({ name: 'Extras', value: 150 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.template_item_id).toBeNull();

    const patchRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items/${createRes.body.id}`)
      .send({ value: 200 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.value).toBe(200);

    const deleteRes = await agent.delete(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items/${createRes.body.id}`);
    expect(deleteRes.status).toBe(204);
  });

  it('409s all mutations on a closed cycle', async () => {
    const { user, dossier } = setup();
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1, is_closed: 1, final_real_balance: 0 });
    const line = createCycleIncomeItem(db, { cycleId: cycle.id, name: 'Salary', value: 2000 });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const createRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items`)
      .send({ name: 'Extras', value: 150 });
    expect(createRes.status).toBe(409);

    const patchRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items/${line.id}`)
      .send({ value: 999 });
    expect(patchRes.status).toBe(409);

    const deleteRes = await agent.delete(`/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items/${line.id}`);
    expect(deleteRes.status).toBe(409);
  });
});

describe('Import backward-compat — pre-v14 exports (flat salary)', () => {
  it('synthesizes a single ad-hoc "Salary" income line from a legacy cycle.salary field', async () => {
    const { user } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const legacyExport = {
      version: 13,
      dossier: { name: 'Legacy Salary Dossier', currency: 'EUR', cycle_start_day: 1 },
      accounts: [],
      months: [],
      expense_template: [],
      annual_expense_template: [],
      workbench_snapshots: [],
      cycles: [{ year: 2026, month: 1, salary: 1500, previous_balance: 0, is_closed: false, final_real_balance: null, cycle_start_day: 1, items: [] }],
      goals: [],
      emergency_fund_accounts: [],
      emergency_fund_extra_values: [],
      annual_expense_years: [],
    };

    const importRes = await agent.post('/api/dossiers/import').send(legacyExport);
    expect(importRes.status).toBe(201);

    const cycles = await agent.get(`/api/dossiers/${importRes.body.id}/cycles`);
    expect(cycles.body).toHaveLength(1);
    const detail = await agent.get(`/api/dossiers/${importRes.body.id}/cycles/${cycles.body[0].id}`);
    expect(detail.body.income_total).toBe(1500);
    expect(detail.body.income_items).toHaveLength(1);
    expect(detail.body.income_items[0].name).toBe('Salary');
  });
});

describe('Export/import round-trip — income lines', () => {
  it('round-trips income_template and per-cycle income_items', async () => {
    const { user, dossier } = setup();
    const templateItem = createIncomeTemplateItem(db, { dossierId: dossier.id, name: 'Stock savings', default_value: 400 });
    createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    const cycle = db.prepare('SELECT * FROM expense_cycles WHERE dossier_id = ?').get(dossier.id);
    createCycleIncomeItem(db, { cycleId: cycle.id, template_item_id: templateItem.id, name: 'Stock savings', value: 400 });
    createCycleIncomeItem(db, { cycleId: cycle.id, template_item_id: null, name: 'Bonus', value: 100 });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const exportRes = await agent.get(`/api/dossiers/${dossier.id}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.version).toBe(17);
    expect(exportRes.body.income_template).toHaveLength(1);
    expect(exportRes.body.cycles[0].income_items).toHaveLength(2);
    expect(exportRes.body.cycles[0].salary).toBeUndefined();

    const importRes = await agent.post('/api/dossiers/import').send(exportRes.body);
    expect(importRes.status).toBe(201);

    const importedCycles = await agent.get(`/api/dossiers/${importRes.body.id}/cycles`);
    const importedDetail = await agent.get(`/api/dossiers/${importRes.body.id}/cycles/${importedCycles.body[0].id}`);
    expect(importedDetail.body.income_total).toBe(500);
    const importedTemplate = await agent.get(`/api/dossiers/${importRes.body.id}/income-template`);
    expect(importedTemplate.body).toHaveLength(1);
    expect(importedTemplate.body[0].name).toBe('Stock savings');
  });
});
