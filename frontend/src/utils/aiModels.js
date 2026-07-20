// Shared display labels for the AI Advisor's whitelisted models (see CLAUDE.md's ai_model whitelist).
export const MODEL_LABELS = {
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-fable-5': 'Fable 5',
};

// Exact message every ai-advisor endpoint returns when ai_enabled is false, so a mid-session
// disable (toggled in Settings while the tab is already open) can be told apart from other errors.
const AI_DISABLED_ERROR = 'AI Advisor is disabled for this dossier';

export function isAiDisabledError(err) {
  return err?.message === AI_DISABLED_ERROR;
}
