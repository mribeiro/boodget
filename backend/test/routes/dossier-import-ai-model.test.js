const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

function minimalExport(overrides) {
  return {
    version: 13,
    dossier: { name: 'Imported Dossier', currency: 'EUR', cycle_start_day: 1, ...overrides },
    accounts: [],
    months: [],
    expense_template: [],
    annual_expense_template: [],
    workbench_snapshots: [],
    cycles: [],
    goals: [],
    emergency_fund_accounts: [],
    emergency_fund_extra_values: [],
    annual_expense_years: [],
  };
}

describe('POST /dossiers/import — ai_model whitelist enforcement', () => {
  it('coerces an ai_model outside the whitelist to the default', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({ ai_model: 'gpt-4' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-4-8');
  });

  it('preserves a valid whitelisted ai_model', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({ ai_model: 'claude-sonnet-5' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-sonnet-5');
  });

  it('defaults ai_model when missing, as with pre-v10 exports', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({}));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-4-8');
  });
});
