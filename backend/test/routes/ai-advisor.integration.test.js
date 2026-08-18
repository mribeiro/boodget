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

describe('AI Advisor — provider-aware configured', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports configured:false for a Gemini-selected model with only a Claude key on file', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'gemini-3.7-pro',
      ai_api_key: 'claude-key',
      ai_gemini_api_key: null,
    });
    delete process.env.GEMINI_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('reports configured:false for a Claude-selected model with only a Gemini key on file', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'claude-opus-5',
      ai_api_key: null,
      ai_gemini_api_key: 'gemini-key',
    });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});

function geminiAnalysisPayload() {
  return JSON.stringify({
    health_score: 82,
    health_summary: 'Healthy overall.',
    highlights: [{ title: 'Good savings rate', detail: 'Saving 20% of income.' }],
    improvements: [{ title: 'Diversify', detail: 'Consider more index funds.' }],
    risks: [],
  });
}

describe('AI Advisor — Gemini analysis happy path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs an analysis via the Gemini API, translating the request and normalizing usage', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'gemini-3.7-pro',
      ai_gemini_api_key: 'g-key',
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: geminiAnalysisPayload() }] },
          },
        ],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50 },
      }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(200);
    expect(res.body.analysis.health_score).toBe(82);
    expect(res.body.analysis.model).toBe('gemini-3.7-pro');
    expect(res.body.analysis.input_tokens).toBe(1000);
    // thoughtsTokenCount folds into output_tokens alongside candidatesTokenCount
    expect(res.body.analysis.output_tokens).toBe(250);
    expect(res.body.analysis.cost_usd).toBeGreaterThan(0);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain(':generateContent');
    expect(options.headers['x-goog-api-key']).toBe('g-key');
    const body = JSON.parse(options.body);
    expect(body.systemInstruction.parts[0].text).toEqual(expect.any(String));
    expect(body.generationConfig.responseMimeType).toBe('application/json');

    const row = db.prepare('SELECT * FROM ai_analyses WHERE dossier_id = ?').get(dossier.id);
    expect(row.output_tokens).toBe(250);
  });

  it('translates assistant turns to Gemini\'s "model" role in chat', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'gemini-3.1-flash',
      ai_gemini_api_key: 'g-key',
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Here is your answer.' }] } }],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50 },
      }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat`).send({
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first reply' },
        { role: 'user', content: 'second question' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Here is your answer.');
    expect(res.body.model).toBe('gemini-3.1-flash');

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('maps a MAX_TOKENS finishReason to the same "cut short" message as Claude', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'gemini-3.7-pro',
      ai_gemini_api_key: 'g-key',
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/cut short/i);
  });

  it('maps a SAFETY finishReason to a refusal message', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'gemini-3.7-pro',
      ai_gemini_api_key: 'g-key',
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/declined/i);
  });

  it('maps a prompt-level blockReason (no candidates) to a refusal message', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      ai_enabled: 1,
      ai_model: 'gemini-3.7-pro',
      ai_gemini_api_key: 'g-key',
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/declined/i);
  });
});
