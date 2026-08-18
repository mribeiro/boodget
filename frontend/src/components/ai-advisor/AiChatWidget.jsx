import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faXmark, faThumbtack, faLocationDot, faKey } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ChatPanel from './ChatPanel';
import { clearChat } from '../../utils/aiAdvisorSession';
import { subscribePageContext } from '../../utils/pageContext';
import { useAiAvailableModels, modelSelectOptions } from '../../utils/aiModels';

// Floating chat shell — a FAB when closed, otherwise either a small popup card or (when `pinned`)
// a full-height docked panel. `open`/`pinned` are controlled by AppShell, which also owns the
// `.chat-pinned` class on `.app-shell-main` so the main column reflows around a docked panel — see
// AppShell.jsx. AppShell only ever mounts this while inside a dossier with ai_enabled, so
// `dossier` is always a real object here (no dossier-not-selected state to handle).
//
// Model switching here is deliberately ephemeral: `selectedModel` only affects this widget's own
// chat calls (via ChatPanel's `model` prop → aiAdvisorSession.sendChatMessage) and is never
// written back to the dossier's ai_model setting, unlike the picker in Settings/AIAdvisorTab.
export default function AiChatWidget({ dossier, open, onOpenChange, pinned, onPinnedChange }) {
  const dossierId = dossier.id;
  const [configured, setConfigured] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [includePageContext, setIncludePageContext] = useState(true);
  const [pageContext, setPageContext] = useState(null);

  const { models: availableModels } = useAiAvailableModels(open ? dossierId : null);

  useEffect(() => {
    let cancelled = false;
    api.getAiAnalysis(dossierId).then((resp) => {
      if (!cancelled) setConfigured(resp.configured);
    }).catch(() => {});
    api.getDossierSettings(dossierId).then((settings) => {
      if (!cancelled) setSelectedModel(settings.ai_model || '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [dossierId]);

  useEffect(() => subscribePageContext(setPageContext), []);

  if (!open) {
    return (
      <button className="ai-chat-fab" onClick={() => onOpenChange(true)} aria-label="Open AI chat">
        <FontAwesomeIcon icon={faComments} />
      </button>
    );
  }

  const canAttachContext = !!pageContext;

  return (
    <div className={`ai-chat-widget${pinned ? ' pinned' : ''}`}>
      <div className="ai-chat-widget-header">
        <FontAwesomeIcon icon={faComments} style={{ color: 'var(--color-brand)' }} />
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
          title="Model for this chat — doesn't change the dossier's Analysis model"
        >
          {modelSelectOptions(availableModels, selectedModel).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setIncludePageContext((v) => !v)}
          disabled={!canAttachContext}
          title={canAttachContext ? `Attach page: ${pageContext.label}` : 'No page context available here'}
          style={{ padding: '0.3rem 0.4rem' }}
        >
          <FontAwesomeIcon
            icon={faLocationDot}
            style={{ color: includePageContext && canAttachContext ? 'var(--color-brand)' : 'var(--text-muted)' }}
          />
        </button>
        <button
          type="button"
          className="ai-chat-pin-btn btn-ghost"
          onClick={() => onPinnedChange(!pinned)}
          title={pinned ? 'Unpin' : 'Pin as side panel'}
          style={{ padding: '0.3rem 0.4rem' }}
        >
          <FontAwesomeIcon icon={faThumbtack} style={{ color: pinned ? 'var(--color-brand)' : 'var(--text-muted)' }} />
        </button>
        <button type="button" className="btn-ghost" onClick={() => clearChat(dossierId)} style={{ fontSize: 11 }}>
          Clear
        </button>
        <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} style={{ padding: '0.3rem 0.4rem' }} aria-label="Close chat">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {includePageContext && canAttachContext && (
        <div className="ai-chat-context-chip">
          <FontAwesomeIcon icon={faLocationDot} />
          <span>{pageContext.label}</span>
        </div>
      )}

      {configured ? (
        <ChatPanel
          dossierId={dossierId}
          disabled={false}
          onDisabled={() => onOpenChange(false)}
          model={selectedModel}
          pageContext={includePageContext ? pageContext?.data : null}
        />
      ) : (
        <div style={{ padding: 'var(--space-4)', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
          <FontAwesomeIcon icon={faKey} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }} />
          <span>AI Advisor is not configured for this dossier. Set an API key in Settings → AI Settings to start chatting.</span>
        </div>
      )}
    </div>
  );
}
