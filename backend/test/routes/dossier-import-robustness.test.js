const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createAccount,
  createMonth,
  createExpenseTemplateItem,
  createExpenseCycle,
  createCycleItem,
  createGoal,
  loginAs,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function agentFor(user) {
  const agent = supertest.agent(buildTestApp());
  await loginAs(agent, user);
  return agent;
}

describe('dossier import robustness (#330)', () => {
  it('re-links references to the right account when two accounts share a name', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    // Link the *first* duplicate: the old name map kept the last one, so it re-linked to Bank B.
    const first = createAccount(db, { dossierId: dossier.id, group_name: 'Bank A', name: 'Savings', position: 0 });
    createAccount(db, { dossierId: dossier.id, group_name: 'Bank B', name: 'Savings', position: 1 });
    createGoal(db, { dossierId: dossier.id, name: 'House', contribution_mode: 'ad_hoc', accountIds: [first.id] });
    db.prepare('INSERT INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)').run(dossier.id, first.id);
    const agent = await agentFor(user);
    const exported = (await agent.get(`/api/dossiers/${dossier.id}/export`)).body;

    const res = await agent.post('/api/dossiers/import').send(exported);

    expect(res.status).toBe(201);
    const linkedGroup = (table, where) =>
      db.prepare(`SELECT a.group_name FROM ${table} x JOIN accounts a ON a.id = x.account_id WHERE ${where}`).get(res.body.id).group_name;
    expect(linkedGroup('goal_accounts', 'x.goal_id = (SELECT id FROM goals WHERE dossier_id = ?)')).toBe('Bank A');
    expect(linkedGroup('emergency_fund_accounts', 'x.dossier_id = ?')).toBe('Bank A');
  });

  it('re-links cycle items to the right template item when two share a name', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const first = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', name: 'Savings', value: 100, position: 0 });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', name: 'Savings', value: 200, position: 1 });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    createCycleItem(db, { cycleId: cycle.id, section: 'distribution', name: 'Savings', value: 100, template_item_id: first.id });
    const agent = await agentFor(user);
    const exported = (await agent.get(`/api/dossiers/${dossier.id}/export`)).body;

    const res = await agent.post('/api/dossiers/import').send(exported);

    const linked = db.prepare(
      `SELECT eti.value FROM cycle_items ci
         JOIN expense_cycles c ON c.id = ci.cycle_id
         JOIN expense_template_items eti ON eti.id = ci.template_item_id
        WHERE c.dossier_id = ?`
    ).get(res.body.id);
    expect(linked.value).toBe(100);
  });

  it("keeps a month's snapshot account that has no entry", async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const acc = createAccount(db, { dossierId: dossier.id, name: 'Current' });
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, accountIds: [acc.id] });
    db.prepare('DELETE FROM month_entries WHERE month_id = ?').run(month.id);
    const agent = await agentFor(user);
    const exported = (await agent.get(`/api/dossiers/${dossier.id}/export`)).body;
    expect(exported.months[0].snapshot_account_ids).toEqual([acc.id]);

    const res = await agent.post('/api/dossiers/import').send(exported);

    const n = db.prepare(
      'SELECT COUNT(*) AS n FROM month_account_snapshot s JOIN months m ON m.id = s.month_id WHERE m.dossier_id = ?'
    ).get(res.body.id).n;
    expect(n).toBe(1);
  });

  it('refuses an invalid enum with a 400 naming the entry, and creates nothing', async () => {
    const user = createUser(db);
    const agent = await agentFor(user);
    const before = db.prepare('SELECT COUNT(*) AS n FROM dossiers').get().n;

    const res = await agent.post('/api/dossiers/import').send({
      version: 18,
      dossier: { name: 'Broken' },
      cars: [{ name: 'Van', fuel_type: 'diesel', initial_mileage_km: 0 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cars "Van": invalid fuel_type "diesel"/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM dossiers').get().n).toBe(before);
  });

  it('turns other constraint failures into a 400 instead of a 500', async () => {
    const user = createUser(db);
    const agent = await agentFor(user);

    const res = await agent.post('/api/dossiers/import').send({
      version: 18,
      dossier: { name: 'Broken' },
      goals: [{ name: 'No target', contribution_mode: 'manual', target_date: null }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Invalid export:/);
  });

  it('accepts an import larger than the general 4MB body limit', async () => {
    const user = createUser(db);
    const agent = await agentFor(user);
    const bigSnapshot = { note: 'x'.repeat(5 * 1024 * 1024) };

    const res = await agent.post('/api/dossiers/import').send({
      version: 18,
      dossier: { name: 'Big' },
      workbench_snapshots: [{ name: 'Big', data: bigSnapshot }],
    });

    expect(res.status).toBe(201);
  });

  it('answers an oversized request elsewhere with a JSON 413', async () => {
    const user = createUser(db);
    const agent = await agentFor(user);

    const res = await agent.post('/api/auth/avatar').send({ image: 'x'.repeat(5 * 1024 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large \(limit 4MB\)/);
  });
});
