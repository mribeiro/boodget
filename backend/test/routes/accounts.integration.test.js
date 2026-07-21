const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, createAccount, createExpenseCycle, createCycleItem, createExpenseTemplateItem } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('DELETE /accounts/:accountId (archive guard)', () => {
  it('blocks archiving with 409 when linked as a template distribution funding account', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', account_id: account.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.delete(`/api/dossiers/${dossier.id}/accounts/${account.id}`);
    expect(res.status).toBe(409);
  });

  it('blocks archiving with 409 when linked only via a past, closed cycle (not just current/future)', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const oldCycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2020, month: 1, is_closed: 1 });
    createCycleItem(db, { cycleId: oldCycle.id, section: 'distribution', account_id: account.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.delete(`/api/dossiers/${dossier.id}/accounts/${account.id}`);
    expect(res.status).toBe(409);
  });

  it('archives successfully (204) when there is no funding-account link', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.delete(`/api/dossiers/${dossier.id}/accounts/${account.id}`);
    expect(res.status).toBe(204);
    const row = db.prepare('SELECT archived FROM accounts WHERE id = ?').get(account.id);
    expect(row.archived).toBe(1);
  });
});
