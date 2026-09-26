const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, createExpenseCycle, createCycleItem, createExpenseTemplateItem, loginAs } = require('../fixtures/builders');
const { paperlessDayOfPayment } = require('../../src/routes/expenses');
const supertest = require('supertest');

async function setup() {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id });
  const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
  const agent = supertest.agent(buildTestApp());
  await loginAs(agent, user);
  return { dossier, cycle, agent, base: `/api/dossiers/${dossier.id}` };
}

describe('cycle and cycle-item validation (#336)', () => {
  it('rejects an out-of-range or non-numeric period on create and on move', async () => {
    const { cycle, agent, base } = await setup();
    const create = (body) => agent.post(`${base}/cycles`).send({ income_lines: [], previous_balance: 0, ...body });

    expect((await create({ year: 2026, month: 13 })).status).toBe(400);
    expect((await create({ year: 2026, month: 0 })).status).toBe(400);
    expect((await create({ year: 'abc', month: 2 })).body.error).toMatch(/year must be an integer/);
    expect((await agent.patch(`${base}/cycles/${cycle.id}`).send({ month: 13 })).status).toBe(400);
    expect((await agent.patch(`${base}/cycles/${cycle.id}`).send({ year: '20x6' })).status).toBe(400);
    expect(db.prepare('SELECT year, month FROM expense_cycles WHERE id = ?').get(cycle.id)).toEqual({ year: 2026, month: 1 });
  });

  it("rejects an invalid day_of_payment on a cycle item and on a template item", async () => {
    const { dossier, cycle, agent, base } = await setup();
    const item = createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 800, day_of_payment: 1 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Rent', day_of_payment: 1 });

    for (const bad of [99, 0, 'x', 1.5]) {
      expect((await agent.patch(`${base}/cycles/${cycle.id}/items/${item.id}`).send({ day_of_payment: bad })).status).toBe(400);
      expect((await agent.put(`${base}/expense-template/${tmpl.id}`).send({ day_of_payment: bad })).status).toBe(400);
    }
    expect((await agent.patch(`${base}/cycles/${cycle.id}/items/${item.id}`).send({ day_of_payment: '15' })).body.day_of_payment).toBe(15);
  });

  it('answers a non-string name with a JSON 400, not a 500', async () => {
    const { dossier, cycle, agent, base } = await setup();
    const item = createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 800, day_of_payment: 1 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Rent', day_of_payment: 1 });

    const results = [
      await agent.patch(`${base}/cycles/${cycle.id}/items/${item.id}`).send({ name: 42 }),
      await agent.put(`${base}/expense-template/${tmpl.id}`).send({ name: { x: 1 } }),
      await agent.post(`${base}/cycles/${cycle.id}/items`).send({ section: 'distribution', name: 7, value: 1 }),
      await agent.post(`${base}/expense-template`).send({ section: 'distribution', name: [], value: 1 }),
    ];
    for (const res of results) {
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
  });

  it("refuses to lower a Budget item's maximum below what's already spent", async () => {
    const { cycle, agent, base } = await setup();
    const budget = createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Budget', name: 'Food', value: 300, spent: 250 });

    const res = await agent.patch(`${base}/cycles/${cycle.id}/items/${budget.id}`).send({ value: 200 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed the budget maximum/);
    expect((await agent.patch(`${base}/cycles/${cycle.id}/items/${budget.id}`).send({ value: 260 })).status).toBe(200);
  });
});

describe('paperlessDayOfPayment (#337)', () => {
  it('reads the day from the string, independent of the server time zone', () => {
    expect(paperlessDayOfPayment('2026-09-05')).toBe(5);
    expect(paperlessDayOfPayment('2026-09-01T00:00:00')).toBe(1);
  });

  it('returns null for anything that is not an ISO date', () => {
    expect(paperlessDayOfPayment(null)).toBeNull();
    expect(paperlessDayOfPayment('05/09/2026')).toBeNull();
    expect(paperlessDayOfPayment('2026-09-00')).toBeNull();
  });
});
