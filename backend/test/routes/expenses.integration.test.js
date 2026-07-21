const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('PATCH /cycles/:cycleId (year/month conflict)', () => {
  it('returns 409 when moving a cycle onto a period another cycle already occupies', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    await agent.post(`/api/dossiers/${dossier.id}/cycles`).send({ year: 2026, month: 1, salary: 1000, previous_balance: 0 });
    const secondRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 2, salary: 1000, previous_balance: 0 });

    const conflictRes = await agent
      .patch(`/api/dossiers/${dossier.id}/cycles/${secondRes.body.id}`)
      .send({ year: 2026, month: 1 });
    expect(conflictRes.status).toBe(409);
  });
});

describe('cycle_start_day snapshotting', () => {
  it('keeps an already-created cycle on its own cycle_start_day after the dossier setting changes', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 25 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const cycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 3, salary: 1000, previous_balance: 0 });
    expect(cycleRes.body.cycle_start_day).toBe(25);

    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ cycle_start_day: 1 });

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cycles/${cycleRes.body.id}`);
    expect(detail.body.cycle_start_day).toBe(25); // unaffected by the later dossier-wide change

    // A newly-created cycle, however, should pick up the new setting.
    const newCycleRes = await agent
      .post(`/api/dossiers/${dossier.id}/cycles`)
      .send({ year: 2026, month: 4, salary: 1000, previous_balance: 0 });
    expect(newCycleRes.body.cycle_start_day).toBe(1);
  });
});

describe('PATCH /settings — ai_user_context length cap', () => {
  it('rejects ai_user_context over 4000 characters', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/settings`)
      .send({ ai_user_context: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  it('accepts ai_user_context at exactly 4000 characters', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/settings`)
      .send({ ai_user_context: 'x'.repeat(4000) });
    expect(res.status).toBe(200);
  });
});
