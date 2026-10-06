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
    expect(exportRes.body.version).toBe(18);
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

describe('PUT /cycles/:cycleId/income-items (#368)', () => {
  async function prepare() {
    const { user, dossier } = setup();
    const agent = await loggedInAgent(buildTestApp(), user);
    const tpl = createIncomeTemplateItem(db, { dossierId: dossier.id, name: 'Salary', default_value: 2000 });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 3, previous_balance: 10 });
    const salary = createCycleIncomeItem(db, { cycleId: cycle.id, template_item_id: tpl.id, name: 'Salary', value: 2000, position: 0 });
    const bonus = createCycleIncomeItem(db, { cycleId: cycle.id, name: 'Bonus', value: 300, position: 1 });
    const url = `/api/dossiers/${dossier.id}/cycles/${cycle.id}/income-items`;
    const lines = () => db.prepare('SELECT * FROM cycle_income_items WHERE cycle_id = ? ORDER BY position').all(cycle.id);
    const prevBalance = () => db.prepare('SELECT previous_balance FROM expense_cycles WHERE id = ?').get(cycle.id).previous_balance;
    return { agent, cycle, salary, bonus, url, lines, prevBalance };
  }

  it('updates, adds and removes lines and sets the previous balance together', async () => {
    const { agent, salary, url, lines, prevBalance } = await prepare();

    const res = await agent.put(url).send({
      items: [{ id: salary.id, name: 'Salary', value: 2100 }, { name: 'Extra', value: 50 }],
      previous_balance: 99.5,
    });

    expect(res.status).toBe(200);
    expect(lines().map((l) => [l.name, l.value, l.position])).toEqual([['Salary', 2100, 0], ['Extra', 50, 1]]);
    expect(lines()[0].template_item_id).toBe(salary.template_item_id);
    expect(lines()[1].template_item_id).toBeNull();
    expect(prevBalance()).toBe(99.5);
  });

  it('changes nothing when one line is invalid', async () => {
    const { agent, salary, bonus, url, lines, prevBalance } = await prepare();

    const res = await agent.put(url).send({
      items: [{ id: salary.id, name: 'Salary', value: 2100 }, { name: 'Extra', value: 'abc' }],
      previous_balance: 99,
    });

    expect(res.status).toBe(400);
    expect(lines().map((l) => l.id)).toEqual([salary.id, bonus.id]);
    expect(lines()[0].value).toBe(2000);
    expect(prevBalance()).toBe(10);
  });

  it("refuses another cycle's line and a blank previous balance", async () => {
    const { agent, url } = await prepare();
    expect((await agent.put(url).send({ items: [{ id: 'not-mine', name: 'X', value: 1 }] })).status).toBe(400);
    expect((await agent.put(url).send({ items: [], previous_balance: null })).status).toBe(400);
  });

  it('is refused on a closed cycle', async () => {
    const { agent, cycle, url } = await prepare();
    db.prepare('UPDATE expense_cycles SET is_closed = 1, final_real_balance = 0 WHERE id = ?').run(cycle.id);
    expect((await agent.put(url).send({ items: [] })).status).toBe(409);
  });
});
