import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

// Fallback display labels for model ids that may no longer appear in the live catalog (e.g. a
// dossier's ai_model, or a past analysis/chat reply's stored model, referencing an older version
// that a later "Refresh models" superseded). The picker itself is populated dynamically — see
// useAiAvailableModels below — this map only covers historical display.
export const MODEL_LABELS = {
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-5': 'Opus 5',
  'claude-fable-5': 'Fable 5',
  'gemini-3.7-pro': 'Gemini 3.7 Pro',
  'gemini-3.1-flash': 'Gemini 3.1 Flash',
};

// Which provider's API a model id belongs to, purely display-side (the backend is the source of
// truth for validity — see modelFamily/modelProvider in backend/src/routes/ai-advisor.js). Used
// to group the picker by provider and to pick which API-key setting explains an "unconfigured"
// state.
export function modelProvider(modelId) {
  if (!modelId) return null;
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gemini-')) return 'google';
  return null;
}

export const PROVIDER_LABELS = { anthropic: 'Claude', google: 'Gemini' };

// Exact message every ai-advisor endpoint returns when ai_enabled is false, so a mid-session
// disable (toggled in Settings while the tab is already open) can be told apart from other errors.
const AI_DISABLED_ERROR = 'AI Advisor is disabled for this dossier';

export function isAiDisabledError(err) {
  return err?.message === AI_DISABLED_ERROR;
}

// Loads the AI Advisor's model catalog (latest known model per haiku/sonnet/opus family) and
// exposes a refresh() that re-fetches the live list from the Claude API, keeping only the newest
// version per family. Shared by the AI Advisor tab's picker and the Settings → AI Settings picker.
export function useAiAvailableModels(dossierId) {
  const [models, setModels] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const resp = await api.getAiAvailableModels(dossierId);
      setModels(resp.models || []);
      setUpdatedAt(resp.updated_at ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const resp = await api.refreshAiAvailableModels(dossierId);
      setModels(resp.models || []);
      setUpdatedAt(resp.updated_at ?? null);
      return resp;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setRefreshing(false);
    }
  }, [dossierId]);

  return { models, updatedAt, loading, refreshing, refresh, error };
}

// Builds <select> options from the resolved catalog, adding the currently-saved value as an
// extra option when it's not among them (e.g. an older version a refresh has since superseded) —
// otherwise the <select> would show blank instead of the dossier's actual setting.
export function modelSelectOptions(models, currentValue) {
  const options = (models || []).map((m) => ({ value: m.id, label: m.display_name || m.id }));
  if (currentValue && !options.some((o) => o.value === currentValue)) {
    options.push({ value: currentValue, label: MODEL_LABELS[currentValue] || currentValue });
  }
  return options;
}

// Groups modelSelectOptions' flat list by provider, for a grouped <optgroup> picker — Claude
// first, then Gemini, then any option whose provider can't be determined (shouldn't happen in
// practice, but keeps the picker from silently dropping an option).
export function modelSelectGroups(models, currentValue) {
  const options = modelSelectOptions(models, currentValue);
  const order = ['anthropic', 'google'];
  const byProvider = { anthropic: [], google: [], other: [] };
  for (const option of options) {
    const provider = modelProvider(option.value);
    (byProvider[provider] || byProvider.other).push(option);
  }
  const groups = order
    .filter((provider) => byProvider[provider].length > 0)
    .map((provider) => ({ label: PROVIDER_LABELS[provider], options: byProvider[provider] }));
  if (byProvider.other.length > 0) {
    groups.push({ label: 'Other', options: byProvider.other });
  }
  return groups;
}
