import { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faXmark, faThumbtack, faLocationDot, faKey } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ChatPanel from './ChatPanel';
import { clearChat } from '../../utils/aiAdvisorSession';
import { subscribePageContext } from '../../utils/pageContext';
import { useAiAvailableModels, modelSelectOptions } from '../../utils/aiModels';

// The closed FAB's position is user-draggable (it otherwise sits in a fixed bottom-right
// corner that sometimes overlaps other fixed-position UI, e.g. a page's bottom toolbar on
// mobile or Edit/Delete buttons on a detail page). Persisted per-viewer in localStorage —
// same convention as ct-chat-pinned/ct-sidebar-collapsed — as offsets from the bottom-right
// corner, so it stays put relative to the same corner across window resizes.
const FAB_POSITION_KEY = 'ct-chat-fab-position';
const FAB_SIZE = 56;
const FAB_EDGE_MARGIN = 8;
const DRAG_THRESHOLD = 4;

function loadFabPosition() {
  try {
    const raw = localStorage.getItem(FAB_POSITION_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos?.right === 'number' && typeof pos?.bottom === 'number') return pos;
  } catch {
    // ignore — private browsing, cleared storage, etc.
  }
  return null;
}

function saveFabPosition(pos) {
  try {
    localStorage.setItem(FAB_POSITION_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function clampFabPosition(pos) {
  const maxRight = Math.max(FAB_EDGE_MARGIN, window.innerWidth - FAB_SIZE - FAB_EDGE_MARGIN);
  const maxBottom = Math.max(FAB_EDGE_MARGIN, window.innerHeight - FAB_SIZE - FAB_EDGE_MARGIN);
  return {
    right: Math.min(Math.max(pos.right, FAB_EDGE_MARGIN), maxRight),
    bottom: Math.min(Math.max(pos.bottom, FAB_EDGE_MARGIN), maxBottom),
  };
}

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

  const [fabPosition, setFabPosition] = useState(null); // null = default CSS position (24px/24px)
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null); // { startX, startY, startRight, startBottom, moved }
  // Separate from dragRef because pointerup clears dragRef before the click event that follows
  // it fires — this flag survives into handleFabClick so a drag doesn't also open the chat.
  const draggedRef = useRef(false);

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

  useEffect(() => {
    const saved = loadFabPosition();
    if (saved) setFabPosition(clampFabPosition(saved));
  }, []);

  useEffect(() => {
    function handleResize() {
      setFabPosition((pos) => (pos ? clampFabPosition(pos) : pos));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function handleFabPointerDown(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: window.innerWidth - rect.right,
      startBottom: window.innerHeight - rect.bottom,
      moved: false,
    };
    draggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleFabPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    draggedRef.current = true;
    setDragging(true);
    setFabPosition(clampFabPosition({ right: drag.startRight - dx, bottom: drag.startBottom - dy }));
  }

  function handleFabPointerUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag?.moved) {
      setFabPosition((pos) => {
        if (pos) saveFabPosition(pos);
        return pos;
      });
    }
  }

  function handleFabClick() {
    // A drag that actually moved the button shouldn't also open the chat — the click event
    // still fires after pointerup regardless of movement, so swallow it here instead of
    // trying to suppress it earlier (which isn't reliable across browsers).
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpenChange(true);
  }

  if (!open) {
    const fabStyle = fabPosition ? { right: `${fabPosition.right}px`, bottom: `${fabPosition.bottom}px` } : undefined;
    return (
      <button
        className={`ai-chat-fab${dragging ? ' dragging' : ''}`}
        style={fabStyle}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerUp}
        onClick={handleFabClick}
        aria-label="Open AI chat (drag to move)"
      >
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
