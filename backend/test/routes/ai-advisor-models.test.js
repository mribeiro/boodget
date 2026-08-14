const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier } = require('../fixtures/builders');
const supertest = require('supertest');
const {
  isAllowedAiModel,
  modelFamily,
  computeCostUsd,
  getAvailableModels,
} = require('../../src/routes/ai-advisor');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

function clearAvailableModelsCache() {
  db.prepare("DELETE FROM app_settings WHERE key = 'ai_available_models'").run();
}

describe('isAllowedAiModel / modelFamily — whitelist is by family, not exact version', () => {
  it('accepts any claude-{haiku,sonnet,opus}-* id regardless of version', () => {
    expect(isAllowedAiModel('claude-haiku-4-5')).toBe(true);
    expect(isAllowedAiModel('claude-sonnet-4-6')).toBe(true);
    expect(isAllowedAiModel('claude-opus-4-8')).toBe(true);
    expect(isAllowedAiModel('claude-opus-5')).toBe(true);
  });

  it('rejects families outside haiku/sonnet/opus and non-model strings', () => {
    expect(isAllowedAiModel('claude-fable-5')).toBe(false);
    expect(isAllowedAiModel('claude-mythos-5')).toBe(false);
    expect(isAllowedAiModel('gpt-4')).toBe(false);
    expect(isAllowedAiModel(null)).toBe(false);
    expect(isAllowedAiModel(undefined)).toBe(false);
  });

  it('extracts the family from a model id', () => {
    expect(modelFamily('claude-opus-4-8')).toBe('opus');
    expect(modelFamily('claude-sonnet-5')).toBe('sonnet');
    expect(modelFamily('not-a-model')).toBeNull();
  });
});

describe('computeCostUsd — priced by family, not exact version', () => {
  it('prices an older and a newer version of the same family identically', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(computeCostUsd('claude-opus-4-8', usage)).toBeCloseTo(computeCostUsd('claude-opus-5', usage), 6);
  });

  it('returns null for a model outside the allowed families', () => {
    expect(computeCostUsd('claude-fable-5', { input_tokens: 100 })).toBeNull();
  });
});

describe('getAvailableModels — cache + fallback', () => {
  beforeEach(clearAvailableModelsCache);

  it('falls back to the baked-in defaults when nothing has been cached yet', () => {
    const { models, updated_at } = getAvailableModels();
    expect(updated_at).toBeNull();
    expect(models.map((m) => m.family).sort()).toEqual(['haiku', 'opus', 'sonnet']);
  });
});

describe('GET /ai-advisor/available-models', () => {
  beforeEach(clearAvailableModelsCache);

  it('returns the default catalog before any refresh, without requiring an API key', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/available-models`);
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(3);
    expect(res.body.models.map((m) => m.family).sort()).toEqual(['haiku', 'opus', 'sonnet']);
  });

  it('works even when ai_enabled is off, since Settings needs it to render the picker', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 0 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/ai-advisor/available-models`);
    expect(res.status).toBe(200);
  });
});

describe('POST /ai-advisor/refresh-models', () => {
  beforeEach(clearAvailableModelsCache);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when no API key is resolvable', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null });
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(503);
  });

  it('keeps only the most recently created model per family, ignoring older versions', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'test-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        has_more: false,
        data: [
          { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2025-01-01T00:00:00Z' },
          { id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-06-01T00:00:00Z' },
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2025-02-01T00:00:00Z' },
          { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-05-01T00:00:00Z' },
          { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
          { id: 'claude-fable-5', display_name: 'Claude Fable 5', created_at: '2026-07-01T00:00:00Z' },
        ],
      }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily).toEqual({
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-5',
      opus: 'claude-opus-5',
    });
    expect(res.body.updated_at).toEqual(expect.any(String));

    const cached = getAvailableModels();
    expect(cached.updated_at).toBe(res.body.updated_at);
  });

  it('keeps the previously-resolved model for a family absent from the response', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'test-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        has_more: false,
        data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-05-01T00:00:00Z' }],
      }),
    });

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily.sonnet).toBe('claude-sonnet-5');
    expect(byFamily.haiku).toBeTruthy();
    expect(byFamily.opus).toBeTruthy();
  });
});
