const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, createAccount } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('POST /months (snapshot at creation time)', () => {
  it('snapshots only accounts that existed when the month was created, not ones added later', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const earlyAccount = createAccount(db, { dossierId: dossier.id, name: 'Early' });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const monthRes = await agent.post(`/api/dossiers/${dossier.id}/months`).send({ year: 2026, month: 1 });
    expect(monthRes.status).toBe(201);

    // Add a new account after the month was already created.
    const lateAccountRes = await agent
      .post(`/api/dossiers/${dossier.id}/accounts`)
      .send({ group_name: 'Group', name: 'Late', type: 'Current Account' });
    expect(lateAccountRes.status).toBe(201);

    const detail = await agent.get(`/api/dossiers/${dossier.id}/months/${monthRes.body.id}`);
    const names = detail.body.entries.map((e) => e.name);
    expect(names).toContain('Early');
    expect(names).not.toContain('Late');
    void earlyAccount;
  });
});

describe('POST /months/:monthId/reset', () => {
  it('clears filled state and entry values, returning the month to unfilled', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const monthRes = await agent.post(`/api/dossiers/${dossier.id}/months`).send({ year: 2026, month: 2 });
    await agent
      .put(`/api/dossiers/${dossier.id}/months/${monthRes.body.id}`)
      .send({ entries: [{ accountId: account.id, value: 500, comment: 'note' }], comment: 'filled in' });

    const filled = await agent.get(`/api/dossiers/${dossier.id}/months/${monthRes.body.id}`);
    expect(filled.body.filled).toBe(1);

    const resetRes = await agent.post(`/api/dossiers/${dossier.id}/months/${monthRes.body.id}/reset`);
    expect(resetRes.status).toBe(200);

    const afterReset = await agent.get(`/api/dossiers/${dossier.id}/months/${monthRes.body.id}`);
    expect(afterReset.body.filled).toBe(0);
    expect(afterReset.body.comment).toBeNull();
    const entry = afterReset.body.entries.find((e) => e.id === account.id);
    expect(entry.value).toBeNull();
    expect(entry.comment).toBeNull();
  });
});

describe('PUT /months/:monthId (entry values, #355)', () => {
  it('rejects a value that is not a number, and saves nothing', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id, name: 'Main' });
    const agent = await loggedInAgent(buildTestApp(), user);
    const month = (await agent.post(`/api/dossiers/${dossier.id}/months`).send({ year: 2026, month: 2 })).body;
    const url = `/api/dossiers/${dossier.id}/months/${month.id}`;

    const bad = await agent.put(url).send({ entries: [{ accountId: account.id, value: '50€' }] });
    expect(bad.status).toBe(400);
    expect(db.prepare('SELECT filled FROM months WHERE id = ?').get(month.id).filled).toBe(0);

    const ok = await agent.put(url).send({ entries: [{ accountId: account.id, value: 50 }, ] });
    expect(ok.status).toBe(200);
    expect(db.prepare('SELECT value FROM month_entries WHERE month_id = ? AND account_id = ?').get(month.id, account.id).value).toBe(50);
  });
});
