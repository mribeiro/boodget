const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, createAccount, createExpenseTemplateItem, createAnnualExpenseYear, loginAs } = require('../fixtures/builders');
const { computeYearStatus } = require('../../src/routes/annual-expenses');
const supertest = require('supertest');

// Selection endpoints must only accept ids that belong to the dossier (or, for notification
// opt-ins, dossiers the user can access) — never another dossier's rows (#329).
async function setup() {
  const user = createUser(db);
  const mine = createDossier(db, { creatorId: user.id });
  const stranger = createUser(db);
  const theirs = createDossier(db, { creatorId: stranger.id });
  const myAccount = createAccount(db, { dossierId: mine.id });
  const theirAccount = createAccount(db, { dossierId: theirs.id });
  const myDist = createExpenseTemplateItem(db, { dossierId: mine.id, section: 'distribution', name: 'Mine' });
  const theirDist = createExpenseTemplateItem(db, { dossierId: theirs.id, section: 'distribution', name: 'Theirs', value: 999 });
  const myExpense = createExpenseTemplateItem(db, { dossierId: mine.id, section: 'expense', name: 'Rent', day_of_payment: 1 });
  const agent = supertest.agent(buildTestApp());
  await loginAs(agent, user);
  return { mine, theirs, myAccount, theirAccount, myDist, theirDist, myExpense, agent };
}

const count = (table, dossierId) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE dossier_id = ?`).get(dossierId).n;

describe('selection endpoints reject foreign ids', () => {
  it('PUT /emergency-fund/accounts', async () => {
    const { mine, myAccount, theirAccount, agent } = await setup();
    const url = `/api/dossiers/${mine.id}/emergency-fund/accounts`;

    const bad = await agent.put(url).send({ account_ids: [myAccount.id, theirAccount.id] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain(theirAccount.id);
    expect(count('emergency_fund_accounts', mine.id)).toBe(0);

    const ok = await agent.put(url).send({ account_ids: [myAccount.id] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([myAccount.id]);
  });

  it('PUT /annual-expenses/accounts', async () => {
    const { mine, myAccount, theirAccount, agent } = await setup();
    const url = `/api/dossiers/${mine.id}/annual-expenses/accounts`;

    expect((await agent.put(url).send({ account_ids: [theirAccount.id] })).status).toBe(400);
    expect(count('annual_expense_accounts', mine.id)).toBe(0);
    expect((await agent.put(url).send({ account_ids: [myAccount.id] })).status).toBe(200);
  });

  it('PUT /annual-expenses/distributions, including a non-distribution item of the same dossier', async () => {
    const { mine, myDist, theirDist, myExpense, agent } = await setup();
    const url = `/api/dossiers/${mine.id}/annual-expenses/distributions`;

    expect((await agent.put(url).send({ distribution_template_ids: [theirDist.id] })).status).toBe(400);
    expect((await agent.put(url).send({ distribution_template_ids: [myExpense.id] })).status).toBe(400);
    expect(count('annual_expense_distributions', mine.id)).toBe(0);
    expect((await agent.put(url).send({ distribution_template_ids: [myDist.id] })).status).toBe(200);
  });

  it('PUT /api/notifications/dossiers', async () => {
    const { mine, theirs, agent } = await setup();

    const bad = await agent.put('/api/notifications/dossiers').send({ dossier_ids: [mine.id, theirs.id] });
    expect(bad.status).toBe(400);

    const ok = await agent.put('/api/notifications/dossiers').send({ dossier_ids: [mine.id] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([mine.id]);
  });

  it('ignores a foreign distribution link already stored before validation existed', async () => {
    const { mine, theirDist } = await setup();
    db.prepare('INSERT INTO annual_expense_distributions (dossier_id, distribution_template_id) VALUES (?, ?)').run(mine.id, theirDist.id);
    const year = createAnnualExpenseYear(db, { dossierId: mine.id, year: 2026 });

    const status = computeYearStatus(year.id, mine.id);

    expect(status.monthly_dist_projected).toBe(0);
  });
});

describe('GET /api/notifications/dossiers', () => {
  it('omits an opt-in for a dossier the user no longer has access to', async () => {
    const { mine, theirs, agent } = await setup();
    const me = (await agent.get('/api/auth/me')).body;
    db.prepare('INSERT INTO dossier_notification_subscriptions (user_id, dossier_id) VALUES (?, ?), (?, ?)').run(me.id, mine.id, me.id, theirs.id);

    const res = await agent.get('/api/notifications/dossiers');

    expect(res.body).toEqual([mine.id]);
  });
});
