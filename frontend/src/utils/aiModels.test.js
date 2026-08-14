import { isAiDisabledError, modelSelectOptions, MODEL_LABELS } from './aiModels';

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
