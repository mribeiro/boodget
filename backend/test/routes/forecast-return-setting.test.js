const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, loginAs } = require('../fixtures/builders');
const supertest = require('supertest');

// The Forecast's expected annual return: a dossier setting (0–30 %, or null for none) that
// travels with the dossier's export.
describe('forecast_expected_return_pct setting', () => {
  async function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, user);
    return { dossier, agent };
  }

  it('defaults to null and can be set and cleared', async () => {
    const { dossier, agent } = await setup();
    expect((await agent.get(`/api/dossiers/${dossier.id}/settings`)).body.forecast_expected_return_pct).toBeNull();

    const set = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ forecast_expected_return_pct: 4.5 });
    expect(set.status).toBe(200);
    expect(set.body.forecast_expected_return_pct).toBe(4.5);

    const cleared = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ forecast_expected_return_pct: null });
    expect(cleared.body.forecast_expected_return_pct).toBeNull();
  });

  it('rejects values outside 0–30 or non-numbers', async () => {
    const { dossier, agent } = await setup();
    for (const v of [-1, 31, '4']) {
      const res = await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ forecast_expected_return_pct: v });
      expect(res.status).toBe(400);
    }
  });

  it('round-trips through export and import, dropping an out-of-range value', async () => {
    const { dossier, agent } = await setup();
    await agent.patch(`/api/dossiers/${dossier.id}/settings`).send({ forecast_expected_return_pct: 3 });
    const exported = (await agent.get(`/api/dossiers/${dossier.id}/export`)).body;
    expect(exported.dossier.forecast_expected_return_pct).toBe(3);

    const imported = await agent.post('/api/dossiers/import').send(exported);
    expect(imported.status).toBe(201);
    expect((await agent.get(`/api/dossiers/${imported.body.id}/settings`)).body.forecast_expected_return_pct).toBe(3);

    exported.dossier.forecast_expected_return_pct = 500;
    const bad = await agent.post('/api/dossiers/import').send(exported);
    expect((await agent.get(`/api/dossiers/${bad.body.id}/settings`)).body.forecast_expected_return_pct).toBeNull();
  });
});
