const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('AI Advisor gating', () => {
  it('returns 403 on GET analysis when ai_enabled is off, regardless of request payload', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 0 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(403);
  });

  it('returns 403 on POST chat when ai_enabled is off', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 0 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat`)
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(403);
  });

  it('reports configured:false when enabled but no API key is resolvable', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('returns 503 on POST analysis when unconfigured', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(503);
  });

  it('export-prompt works needing neither ai_api_key nor ANTHROPIC_API_KEY, as long as ai_enabled is on', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/export-prompt`);
    expect(res.status).toBe(200);
    expect(res.body.prompt).toEqual(expect.any(String));
  });
});

describe('POST /ai-advisor/chat validation', () => {
  function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1 });
    return { user, dossier };
  }

  it('rejects an empty messages array', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat`).send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('rejects more than 40 messages', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const messages = Array.from({ length: 41 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'hi',
    }));
    messages[messages.length - 1] = { role: 'user', content: 'hi' };
    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat`).send({ messages });
    expect(res.status).toBe(400);
  });

  it('accepts exactly 40 well-formed messages (boundary)', async () => {
    const { user, dossier } = setup();
    // No API key resolvable, so this will reach the 503 branch (Claude not configured)
    // rather than 400 — proving the message-count validation itself passed at the boundary.
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const messages = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'hi',
    }));
    messages[messages.length - 1] = { role: 'user', content: 'hi' };
    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat`).send({ messages });
    expect(res.status).toBe(503);
  });

  it('rejects a conversation that does not start with a user message', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat`)
      .send({ messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'hi' }] });
    expect(res.status).toBe(400);
  });

  it('rejects a conversation that does not end with a user message', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat`)
      .send({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hi' }] });
    expect(res.status).toBe(400);
  });

  it('rejects a message over 8000 characters', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat`)
      .send({ messages: [{ role: 'user', content: 'x'.repeat(8001) }] });
    expect(res.status).toBe(400);
  });

  it('rejects empty/whitespace-only content', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat`)
      .send({ messages: [{ role: 'user', content: '   ' }] });
    expect(res.status).toBe(400);
  });
});
