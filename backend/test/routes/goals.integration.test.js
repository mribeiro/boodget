const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createExpenseTemplateItem,
  createExpenseCycle,
  createCycleItem,
  createGoal,
  loginAs,
} = require('../fixtures/builders');
const supertest = require('supertest');

describe('goal chart after an expense-template bulk-replace', () => {
  it('still counts done distributions from cycles created before the bulk-replace', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const dist = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', name: 'Holiday fund', value: 200 });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    createCycleItem(db, { cycleId: cycle.id, section: 'distribution', name: 'Holiday fund', value: 200, done: true, template_item_id: dist.id });
    const goal = createGoal(db, {
      dossierId: dossier.id, name: 'Holiday', contribution_mode: 'via_distributions',
      target_value: 5000, target_date: '2099-01', distributionTemplateIds: [dist.id],
    });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, user);

    // What the Workbench's "Sync to template" does: every item is reinserted with a fresh id.
    const replaced = await agent
      .post(`/api/dossiers/${dossier.id}/expense-template/bulk-replace`)
      .send({ section: 'distribution', items: [{ name: 'Holiday fund', value: 200 }] });
    expect(replaced.status).toBe(200);
    const newDistId = db.prepare('SELECT id FROM expense_template_items WHERE dossier_id = ?').get(dossier.id).id;
    expect(newDistId).not.toBe(dist.id);

    const res = await agent.get(`/api/dossiers/${dossier.id}/goals/${goal.id}`);

    expect(res.status).toBe(200);
    const point = res.body.chart_data.find((p) => p.cycle_id === cycle.id);
    expect(point.real_contribution).toBe(200);
  });
});
