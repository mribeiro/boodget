const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, createLoan } = require('../fixtures/builders');
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
