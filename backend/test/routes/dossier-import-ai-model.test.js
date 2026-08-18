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

describe('POST /dossiers/import — ai_model family whitelist enforcement', () => {
  it('coerces an ai_model outside the haiku/sonnet/opus families to the default', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({ ai_model: 'gpt-4' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-5');
  });

  it('coerces a fable/mythos model — no longer an allowed family — to the default', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({ ai_model: 'claude-fable-5' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-5');
  });

  it('preserves a valid family member regardless of version', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({ ai_model: 'claude-sonnet-5' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-sonnet-5');
  });

  it('preserves an older-but-still-valid version of a family (e.g. from before a "Refresh models" run)', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({ ai_model: 'claude-opus-4-8' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-4-8');
  });

  it('defaults ai_model when missing, as with pre-v10 exports', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent.post('/api/dossiers/import').send(minimalExport({}));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-5');
  });

  it('preserves a Gemini model id from a version-15 export', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent
      .post('/api/dossiers/import')
      .send(minimalExport({ ai_model: 'gemini-3.1-pro-preview' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('gemini-3.1-pro-preview');
  });

  it('coerces a versionless Gemini -latest alias to the default (not a real, refresh-resolved id)', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent
      .post('/api/dossiers/import')
      .send(minimalExport({ ai_model: 'gemini-pro-latest' }));
    expect(importRes.status).toBe(201);

    const settingsRes = await agent.get(`/api/dossiers/${importRes.body.id}/settings`);
    expect(settingsRes.body.ai_model).toBe('claude-opus-5');
  });

  it('never exports ai_gemini_api_key, the same secret treatment as ai_api_key', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const importRes = await agent
      .post('/api/dossiers/import')
      .send(minimalExport({ ai_model: 'gemini-3.1-pro-preview' }));
    expect(importRes.status).toBe(201);

    await agent
      .patch(`/api/dossiers/${importRes.body.id}/settings`)
      .send({ ai_gemini_api_key: 'g-secret' });

    const exportRes = await agent.get(`/api/dossiers/${importRes.body.id}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.dossier.ai_gemini_api_key).toBeUndefined();
    expect(exportRes.body.dossier.ai_api_key).toBeUndefined();
  });
});
