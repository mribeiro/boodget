const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier } = require('../fixtures/builders');
const supertest = require('supertest');
const {
  isAllowedAiModel,
  modelFamily,
  modelProvider,
  computeCostUsd,
  getAvailableModels,
  toGeminiSchema,
} = require('../../src/routes/ai-advisor');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

function clearAvailableModelsCache() {
  db.prepare("DELETE FROM app_settings WHERE key = 'ai_available_models'").run();
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
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

describe('isAllowedAiModel / modelFamily / modelProvider — Gemini families', () => {
  it('accepts gemini-{version}-{pro,flash} ids, with or without a suffix tail', () => {
    expect(isAllowedAiModel('gemini-3.7-pro')).toBe(true);
    expect(isAllowedAiModel('gemini-3.1-flash')).toBe(true);
    expect(isAllowedAiModel('gemini-2.5-pro')).toBe(true);
    expect(isAllowedAiModel('gemini-3-pro-preview')).toBe(true);
    expect(isAllowedAiModel('gemini-2.5-flash-001')).toBe(true);
    expect(isAllowedAiModel('gemini-2.5-flash-preview-05-20')).toBe(true);
  });

  it('rejects non-pro/flash Gemini variants and versionless -latest aliases', () => {
    expect(isAllowedAiModel('gemini-2.5-flash-lite')).toBe(false);
    expect(isAllowedAiModel('gemini-2.0-flash-8b')).toBe(false);
    expect(isAllowedAiModel('gemini-2.5-flash-image')).toBe(false);
    expect(isAllowedAiModel('gemini-2.5-flash-preview-tts')).toBe(false);
    expect(isAllowedAiModel('gemini-embedding-001')).toBe(false);
    expect(isAllowedAiModel('gemini-pro-latest')).toBe(false);
    expect(isAllowedAiModel('gemini-flash-latest')).toBe(false);
    expect(isAllowedAiModel('gemini')).toBe(false);
  });

  it('extracts self-describing gemini-pro/gemini-flash family tokens', () => {
    expect(modelFamily('gemini-3.7-pro')).toBe('gemini-pro');
    expect(modelFamily('gemini-3.1-flash')).toBe('gemini-flash');
  });

  it('derives the provider from the model id, never a stored field', () => {
    expect(modelProvider('claude-opus-5')).toBe('anthropic');
    expect(modelProvider('claude-haiku-4-5')).toBe('anthropic');
    expect(modelProvider('gemini-3.7-pro')).toBe('google');
    expect(modelProvider('gemini-3.1-flash')).toBe('google');
    expect(modelProvider('not-a-model')).toBeNull();
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

  it('prices two Gemini Pro versions identically, and differently from Flash', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(computeCostUsd('gemini-2.5-pro', usage)).toBeCloseTo(computeCostUsd('gemini-3.7-pro', usage), 6);
    expect(computeCostUsd('gemini-3.7-pro', usage)).not.toBeCloseTo(computeCostUsd('gemini-3.1-flash', usage), 6);
  });

  it('returns null for an excluded Gemini variant', () => {
    expect(computeCostUsd('gemini-2.5-flash-lite', { input_tokens: 100 })).toBeNull();
  });
});

describe('toGeminiSchema — JSON-Schema to Gemini OpenAPI-subset adapter', () => {
  const analysisLikeSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['health_score', 'highlights'],
    properties: {
      health_score: { type: 'integer' },
      highlights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'detail'],
          properties: { title: { type: 'string' }, detail: { type: 'string' } },
        },
      },
    },
  };

  it('drops additionalProperties at every nesting level', () => {
    const out = toGeminiSchema(analysisLikeSchema);
    expect(out.additionalProperties).toBeUndefined();
    expect(out.properties.highlights.items.additionalProperties).toBeUndefined();
  });

  it('uppercases type values', () => {
    const out = toGeminiSchema(analysisLikeSchema);
    expect(out.type).toBe('OBJECT');
    expect(out.properties.health_score.type).toBe('INTEGER');
    expect(out.properties.highlights.type).toBe('ARRAY');
    expect(out.properties.highlights.items.type).toBe('OBJECT');
  });

  it('preserves required/items/properties and adds propertyOrdering', () => {
    const out = toGeminiSchema(analysisLikeSchema);
    expect(out.required).toEqual(['health_score', 'highlights']);
    expect(out.propertyOrdering).toEqual(['health_score', 'highlights']);
    expect(out.properties.highlights.items.propertyOrdering).toEqual(['title', 'detail']);
  });
});

describe('getAvailableModels — cache + fallback', () => {
  beforeEach(clearAvailableModelsCache);

  it('falls back to the baked-in defaults when nothing has been cached yet', () => {
    const { models, updated_at } = getAvailableModels();
    expect(updated_at).toBeNull();
    expect(models.map((m) => m.family).sort()).toEqual(['gemini-flash', 'gemini-pro', 'haiku', 'opus', 'sonnet']);
  });

  it('merges an older, Gemini-less cache against the current family list (back-compat)', () => {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_available_models', ?)").run(
      JSON.stringify({
        updated_at: '2026-01-01T00:00:00Z',
        models: [
          { id: 'claude-haiku-4-5', family: 'haiku', display_name: 'Claude Haiku 4.5' },
          { id: 'claude-sonnet-5', family: 'sonnet', display_name: 'Claude Sonnet 5' },
          { id: 'claude-opus-5', family: 'opus', display_name: 'Claude Opus 5' },
        ],
      })
    );
    const { models, updated_at } = getAvailableModels();
    expect(updated_at).toBe('2026-01-01T00:00:00Z');
    expect(models.map((m) => m.family).sort()).toEqual(['gemini-flash', 'gemini-pro', 'haiku', 'opus', 'sonnet']);
    expect(models.find((m) => m.family === 'gemini-pro').id).toBe('gemini-3.7-pro');
    expect(models.find((m) => m.family === 'gemini-flash').id).toBe('gemini-3.1-flash');
    // the cached Claude entries are still honored, not silently replaced by defaults
    expect(models.find((m) => m.family === 'haiku').id).toBe('claude-haiku-4-5');
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
    expect(res.body.models).toHaveLength(5);
    expect(res.body.models.map((m) => m.family).sort()).toEqual(['gemini-flash', 'gemini-pro', 'haiku', 'opus', 'sonnet']);
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
  beforeEach(() => {
    clearAvailableModelsCache();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when no API key is resolvable for either provider', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null, ai_gemini_api_key: null });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(503);
  });

  it('keeps only the most recently created Claude model per family, ignoring older versions', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'test-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        has_more: false,
        data: [
          { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2025-01-01T00:00:00Z' },
          { id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-06-01T00:00:00Z' },
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2025-02-01T00:00:00Z' },
          { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-05-01T00:00:00Z' },
          { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
          { id: 'claude-fable-5', display_name: 'Claude Fable 5', created_at: '2026-07-01T00:00:00Z' },
        ],
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily).toMatchObject({
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-5',
      opus: 'claude-opus-5',
    });
    expect(res.body.skipped).toEqual(['google']);
    expect(res.body.updated_at).toEqual(expect.any(String));

    const cached = getAvailableModels();
    expect(cached.updated_at).toBe(res.body.updated_at);
  });

  it('keeps the previously-resolved Claude model for a family absent from the response', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'test-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        has_more: false,
        data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-05-01T00:00:00Z' }],
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily.sonnet).toBe('claude-sonnet-5');
    expect(byFamily.haiku).toBeTruthy();
    expect(byFamily.opus).toBeTruthy();
  });

  it('picks the highest-version Gemini model per family, excluding lite/embedding variants', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_gemini_api_key: 'g-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.7-pro', displayName: 'Gemini 3.7 Pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.1-flash', displayName: 'Gemini 3.1 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding', supportedGenerationMethods: ['embedContent'] },
        ],
        nextPageToken: null,
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily['gemini-pro']).toBe('gemini-3.7-pro');
    expect(byFamily['gemini-flash']).toBe('gemini-3.1-flash');
    expect(res.body.skipped).toEqual(['anthropic']);

    const [url, options] = global.fetch.mock.calls[0];
    expect(options.headers['x-goog-api-key']).toBe('g-key');
    expect(url.toString()).not.toContain('key=');
  });

  it('prefers a stable release over a preview at the same version, but a newer preview beats an older stable', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_gemini_api_key: 'g-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'models/gemini-3.7-pro', displayName: 'Gemini 3.7 Pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.7-pro-preview', displayName: 'Gemini 3.7 Pro Preview', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-4-flash-preview', displayName: 'Gemini 4 Flash Preview', supportedGenerationMethods: ['generateContent'] },
        ],
        nextPageToken: null,
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily['gemini-pro']).toBe('gemini-3.7-pro');
    expect(byFamily['gemini-flash']).toBe('gemini-4-flash-preview');
  });

  it('paginates the Gemini list via nextPageToken', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_gemini_api_key: 'g-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const spy = vi.spyOn(global, 'fetch');
    spy.mockResolvedValueOnce(
      jsonResponse({
        models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] }],
        nextPageToken: 'page2',
      })
    );
    spy.mockResolvedValueOnce(
      jsonResponse({
        models: [{ name: 'models/gemini-3.7-pro', displayName: 'Gemini 3.7 Pro', supportedGenerationMethods: ['generateContent'] }],
        nextPageToken: null,
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily['gemini-pro']).toBe('gemini-3.7-pro');
  });

  it('refreshes Claude when only a Claude key is present, leaving Gemini at defaults and reporting it skipped', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'c-key', ai_gemini_api_key: null });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        has_more: false,
        data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-06-01T00:00:00Z' }],
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual(['google']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily['gemini-pro']).toBe('gemini-3.7-pro');
  });

  it('refreshes Gemini when only a Gemini key is present, leaving Claude at defaults and reporting it skipped', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: null, ai_gemini_api_key: 'g-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        models: [{ name: 'models/gemini-3.7-pro', displayName: 'Gemini 3.7 Pro', supportedGenerationMethods: ['generateContent'] }],
        nextPageToken: null,
      })
    );

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual(['anthropic']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily.opus).toBe('claude-opus-5');
  });

  it('succeeds with the working provider when the other errors, and reports the error', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'c-key', ai_gemini_api_key: 'g-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const spy = vi.spyOn(global, 'fetch');
    spy.mockResolvedValueOnce(
      jsonResponse({
        has_more: false,
        data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-06-01T00:00:00Z' }],
      })
    );
    spy.mockResolvedValueOnce(jsonResponse({ error: { message: 'invalid API key' } }, false));

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].provider).toBe('google');
    const byFamily = Object.fromEntries(res.body.models.map((m) => [m.family, m.id]));
    expect(byFamily.opus).toBe('claude-opus-5');
  });

  it('returns 502 when both providers fail', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_enabled: 1, ai_api_key: 'c-key', ai_gemini_api_key: 'g-key' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ error: { message: 'boom' } }, false));

    const res = await agent.post(`/api/dossiers/${dossier.id}/ai-advisor/refresh-models`);
    expect(res.status).toBe(502);
  });
});
