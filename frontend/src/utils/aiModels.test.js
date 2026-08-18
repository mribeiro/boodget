import { isAiDisabledError, modelSelectOptions, modelSelectGroups, modelProvider, MODEL_LABELS } from './aiModels';

describe('isAiDisabledError', () => {
  it('matches the exact ai-advisor "disabled" error message', () => {
    expect(isAiDisabledError({ message: 'AI Advisor is disabled for this dossier' })).toBe(true);
  });

  it('does not match other errors', () => {
    expect(isAiDisabledError({ message: 'Something else went wrong' })).toBe(false);
    expect(isAiDisabledError(null)).toBe(false);
    expect(isAiDisabledError(undefined)).toBe(false);
  });
});

describe('modelSelectOptions', () => {
  const models = [
    { id: 'claude-haiku-4-5', family: 'haiku', display_name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-5', family: 'sonnet', display_name: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', family: 'opus', display_name: 'Claude Opus 5' },
  ];

  it('maps the resolved catalog to value/label pairs', () => {
    const options = modelSelectOptions(models, 'claude-opus-5');
    expect(options).toEqual([
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { value: 'claude-opus-5', label: 'Claude Opus 5' },
    ]);
  });

  it('appends the current value as an extra option when the catalog no longer includes it', () => {
    const options = modelSelectOptions(models, 'claude-opus-4-8');
    expect(options).toHaveLength(4);
    expect(options[3]).toEqual({ value: 'claude-opus-4-8', label: MODEL_LABELS['claude-opus-4-8'] });
  });

  it('falls back to the raw id when the current value has no known display label', () => {
    const options = modelSelectOptions(models, 'claude-opus-1-0');
    expect(options[3]).toEqual({ value: 'claude-opus-1-0', label: 'claude-opus-1-0' });
  });

  it('does not duplicate an entry already present in the catalog', () => {
    const options = modelSelectOptions(models, 'claude-sonnet-5');
    expect(options).toHaveLength(3);
  });

  it('handles an empty/missing catalog without throwing', () => {
    expect(modelSelectOptions(undefined, 'claude-opus-5')).toEqual([
      { value: 'claude-opus-5', label: MODEL_LABELS['claude-opus-5'] },
    ]);
    expect(modelSelectOptions([], '')).toEqual([]);
  });
});

describe('modelProvider', () => {
  it('resolves claude-* ids to anthropic', () => {
    expect(modelProvider('claude-opus-5')).toBe('anthropic');
    expect(modelProvider('claude-haiku-4-5')).toBe('anthropic');
  });

  it('resolves gemini-* ids to google', () => {
    expect(modelProvider('gemini-3.1-pro-preview')).toBe('google');
    expect(modelProvider('gemini-3.7-flash')).toBe('google');
  });

  it('returns null for unknown or missing ids', () => {
    expect(modelProvider('fable-5')).toBeNull();
    expect(modelProvider('')).toBeNull();
    expect(modelProvider(null)).toBeNull();
    expect(modelProvider(undefined)).toBeNull();
  });
});

describe('modelSelectGroups', () => {
  const mixedModels = [
    { id: 'claude-haiku-4-5', family: 'haiku', display_name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-5', family: 'opus', display_name: 'Claude Opus 5' },
    { id: 'gemini-3.1-pro-preview', family: 'gemini-pro', display_name: 'Gemini 3.7 Pro' },
    { id: 'gemini-3.7-flash', family: 'gemini-flash', display_name: 'Gemini 3.1 Flash' },
  ];

  it('groups a mixed catalog by provider, Claude first then Gemini', () => {
    const groups = modelSelectGroups(mixedModels, 'claude-opus-5');
    expect(groups.map((g) => g.label)).toEqual(['Claude', 'Gemini']);
    expect(groups[0].options.map((o) => o.value)).toEqual(['claude-haiku-4-5', 'claude-opus-5']);
    expect(groups[1].options.map((o) => o.value)).toEqual(['gemini-3.1-pro-preview', 'gemini-3.7-flash']);
  });

  it('yields a single group for a single-provider catalog', () => {
    const claudeOnly = mixedModels.filter((m) => m.id.startsWith('claude-'));
    const groups = modelSelectGroups(claudeOnly, 'claude-opus-5');
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Claude');
  });

  it('places a current value not in the catalog into its own provider group', () => {
    const groups = modelSelectGroups(mixedModels, 'claude-opus-4-8');
    const claudeGroup = groups.find((g) => g.label === 'Claude');
    expect(claudeGroup.options.map((o) => o.value)).toContain('claude-opus-4-8');
  });

  it('handles an empty/missing catalog without throwing', () => {
    expect(modelSelectGroups(undefined, '')).toEqual([]);
    expect(modelSelectGroups([], '')).toEqual([]);
  });
});
