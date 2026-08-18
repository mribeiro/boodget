const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier } = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

// Polls fn() until it returns a truthy value, or throws once timeout elapses. Used to wait for a
// job (started fire-and-forget by a /start endpoint) to reach a terminal state without hardcoding
// a fixed sleep.
async function waitFor(fn, { timeout = 1000, interval = 5 } = {}) {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Mocks global.fetch to resolve immediately with a single-chunk SSE body — enough for
// callClaudeStream's frame parser to process every event in one pass. Only good for tests that
// don't need fine-grained control over when the stream "arrives" (see the dedup test below for a
// stalled-reader variant).
function mockInstantSse(fullText) {
  const encoder = new TextEncoder();
  let sent = false;
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        async read() {
          if (!sent) {
            sent = true;
            return { done: false, value: encoder.encode(fullText) };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  });
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

  it('returns 403 on POST chat/start when ai_enabled is off', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 0 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
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

  it('returns 503 on POST analysis/start when unconfigured, without creating a job', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis/start`);
    expect(res.status).toBe(503);
    expect(res.body.job_id).toBeUndefined();

    const active = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/jobs/active`);
    expect(active.body.analysis).toBeNull();
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

describe('POST /ai-advisor/chat/start validation', () => {
  function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1 });
    return { user, dossier };
  }

  it('rejects an empty messages array', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`).send({ messages: [] });
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
    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`).send({ messages });
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
    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`).send({ messages });
    expect(res.status).toBe(503);
  });

  it('rejects a conversation that does not start with a user message', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'hi' }] });
    expect(res.status).toBe(400);
  });

  it('rejects a conversation that does not end with a user message', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hi' }] });
    expect(res.status).toBe(400);
  });

  it('rejects a message over 8000 characters', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'user', content: 'x'.repeat(8001) }] });
    expect(res.status).toBe(400);
  });

  it('rejects empty/whitespace-only content', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'user', content: '   ' }] });
    expect(res.status).toBe(400);
  });
});

describe('AI Advisor job-based analysis/chat streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'test-key' });
    return { user, dossier };
  }

  const ANALYSIS_TEXT = JSON.stringify({
    health_score: 80,
    health_summary: 'Looking solid.',
    highlights: [],
    improvements: [],
    risks: [],
  });

  it('POST analysis/start returns 202 + job_id; the stream ends in a done event with the persisted analysis', async () => {
    const { user, dossier } = setup();
    mockInstantSse(
      sseFrame('message_start', { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 500 } } }) +
        sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ANALYSIS_TEXT } }) +
        sseFrame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } }) +
        sseFrame('message_stop', { type: 'message_stop' })
    );
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const start = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis/start`);
    expect(start.status).toBe(202);
    expect(start.body.job_id).toEqual(expect.any(String));

    await waitFor(() => db.prepare('SELECT 1 FROM ai_analyses WHERE dossier_id = ?').get(dossier.id));

    const stream = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/analysis/stream/${start.body.job_id}`);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/text\/event-stream/);
    expect(stream.text).toContain('event: sync');
    expect(stream.text).toContain('event: done');
    expect(stream.text).toContain('"health_score":80');

    // The job registry's active pointer clears once the run finishes.
    const active = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/jobs/active`);
    expect(active.body.analysis).toBeNull();
  });

  it('a second analysis/start while one is running reattaches to the same job instead of starting a duplicate', async () => {
    const { user, dossier } = setup();
    // A reader whose first read() never resolves on its own keeps the job in 'running' status
    // indefinitely, so the dedup check can be observed deterministically.
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const first = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis/start`);
    expect(first.status).toBe(202);

    const second = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis/start`);
    expect(second.status).toBe(202);
    expect(second.body.job_id).toBe(first.body.job_id);

    const active = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/jobs/active`);
    expect(active.body.analysis).toBe(first.body.job_id);
    // The job is left permanently 'running' (its read() never resolves) — harmless, this test's
    // in-memory app/db is discarded with the rest of this file's isolated worker process.
  });

  it('POST chat/start returns 202 + job_id; the stream ends in a done event with the reply', async () => {
    const { user, dossier } = setup();
    mockInstantSse(
      sseFrame('message_start', { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 300 } } }) +
        sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'You are in decent shape.' } }) +
        sseFrame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }) +
        sseFrame('message_stop', { type: 'message_stop' })
    );
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const start = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'user', content: 'How am I doing?' }] });
    expect(start.status).toBe(202);

    await waitFor(async () => {
      const active = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/jobs/active`);
      return active.body.chat === null;
    });

    const stream = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/chat/stream/${start.body.job_id}`);
    expect(stream.status).toBe(200);
    expect(stream.text).toContain('event: done');
    expect(stream.text).toContain('You are in decent shape.');
  });

  it('a valid model override is used for the outgoing Claude API call instead of the dossier default', async () => {
    const { user, dossier } = setup();
    mockInstantSse(
      sseFrame('message_start', { type: 'message_start', message: { model: 'claude-sonnet-5', usage: { input_tokens: 200 } } }) +
        sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
        sseFrame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) +
        sseFrame('message_stop', { type: 'message_stop' })
    );
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const start = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-5' });
    expect(start.status).toBe(202);

    await waitFor(async () => {
      const active = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/jobs/active`);
      return active.body.chat === null;
    });

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(JSON.parse(requestInit.body).model).toBe('claude-sonnet-5');
  });

  it('rejects an unsupported model override', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4' });
    expect(res.status).toBe(400);
  });

  it('splices page_context onto the last message only, leaving the cached system prompt untouched', async () => {
    const { user, dossier } = setup();
    mockInstantSse(
      sseFrame('message_start', { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 200 } } }) +
        sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
        sseFrame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) +
        sseFrame('message_stop', { type: 'message_stop' })
    );
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const start = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({
        messages: [{ role: 'user', content: 'Why is this loan expensive?' }],
        page_context: { name: 'Car Loan', total_interest: 4200 },
      });
    expect(start.status).toBe(202);

    await waitFor(async () => {
      const active = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/jobs/active`);
      return active.body.chat === null;
    });

    const [, requestInit] = global.fetch.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toContain('Why is this loan expensive?');
    expect(body.messages[0].content).toContain('"total_interest":4200');
    // The system block is the dossier context alone — page_context never touches it, so it
    // stays identical (and thus cacheable) across turns regardless of what page the user is on.
    expect(body.system[0].text).not.toContain('total_interest');
  });

  it('rejects a page_context over the size cap', async () => {
    const { user, dossier } = setup();
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/ai-advisor/chat/start`)
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        page_context: { blob: 'x'.repeat(7000) },
      });
    expect(res.status).toBe(400);
  });

  it('enforces dossier access on both /start and /stream/:jobId', async () => {
    const { dossier } = setup();
    const outsider = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, outsider);

    const start = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/analysis/start`);
    expect(start.status).toBe(404);

    const stream = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/analysis/stream/some-fake-job-id`);
    expect(stream.status).toBe(404);
  });
});
