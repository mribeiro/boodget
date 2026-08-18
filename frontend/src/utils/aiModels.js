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
};

// Exact message every ai-advisor endpoint returns when ai_enabled is false, so a mid-session
// disable (toggled in Settings while the tab is already open) can be told apart from other errors.
const AI_DISABLED_ERROR = 'AI Advisor is disabled for this dossier';

export function isAiDisabledError(err) {
  return err?.message === AI_DISABLED_ERROR;
}

// Loads the AI Advisor's model catalog (latest known model per haiku/sonnet/opus family) and
// exposes a refresh() that re-fetches the live list from the Claude API, keeping only the newest
// version per family. Shared by the AI Advisor tab's picker, the Settings → AI Settings picker,
// and the floating chat widget's model switcher — the last of which may call this with a
// falsy dossierId while outside any dossier, so both load()/refresh() no-op in that case rather
// than requesting `/dossiers/undefined/...` (the hook itself is always called unconditionally,
// per the Rules of Hooks, even when the widget has nothing to show yet).
export function useAiAvailableModels(dossierId) {
  const [models, setModels] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!dossierId) { setLoading(false); return; }
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
    if (!dossierId) return;
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
