import { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import CostLabel from './CostLabel';
import { MODEL_LABELS, isAiDisabledError } from '../../utils/aiModels';
import { subscribeChat, sendChatMessage } from '../../utils/aiAdvisorSession';

// The conversation body (message list + compose form) — no card wrapper, no header, no Clear
// button; those live in the floating AiChatWidget shell that embeds this. History lives in the
// module-level aiAdvisorSession store (not local React state), so an in-flight turn survives
// switching dossier tabs and back instead of being silently discarded — see aiAdvisorSession.js.
// It still resets on a full page reload or leaving the dossier, matching the "conversation is not
// stored and resets when you leave" copy below. `onDisabled` lets the parent switch to its
// friendly disabled view if ai_enabled was toggled off mid-session. `model` (ephemeral override)
// and `pageContext` (attached only when the widget's toggle is on) are forwarded to
// sendChatMessage as-is — `null`/undefined omits them.
export default function ChatPanel({ dossierId, disabled, onDisabled, model, pageContext }) {
  const [messages, setMessages] = useState([]);
  const [chatJob, setChatJob] = useState(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(
    () =>
      subscribeChat(dossierId, (state) => {
        setMessages(state.messages);
        setChatJob(state.job);
        setError(state.error || '');
      }),
    [dossierId]
  );

  useEffect(() => {
    if (error && isAiDisabledError({ message: error })) onDisabled?.();
  }, [error, onDisabled]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, chatJob]);

  const pending = !!chatJob;

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending || disabled) return;
    setInput('');
    await sendChatMessage(dossierId, text, { model, pageContext });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div ref={scrollRef} className="ai-chat-messages">
        {messages.length === 0 && !pending && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 1rem' }}>
            Ask anything about this dossier — spending patterns, goal feasibility, where to save…
            <br />
            The conversation is not stored and resets when you leave.
          </div>
        )}
        {messages.map((m, i) => {
          const prevAssistant = messages.slice(0, i).reverse().find((pm) => pm.role === 'assistant' && pm.model);
          const showModelBadge = m.role === 'assistant' && m.model && (!prevAssistant || prevAssistant.model !== m.model);
          return (
            <div key={i} className={`ai-chat-bubble ai-chat-bubble--${m.role}`}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
              {m.role === 'assistant' && (m.cost_usd != null || showModelBadge) && (
                <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {showModelBadge && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                      {MODEL_LABELS[m.model] || m.model}
                    </span>
                  )}
                  <CostLabel costUsd={m.cost_usd} inputTokens={m.input_tokens} outputTokens={m.output_tokens} />
                </div>
              )}
            </div>
          );
        })}
        {pending && (
          <div className="ai-chat-bubble ai-chat-bubble--assistant">
            {chatJob.text ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{chatJob.text}</div>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Thinking…</span>
            )}
          </div>
        )}
      </div>

      {error && !isAiDisabledError({ message: error }) && (
        <div className="alert alert-error" style={{ margin: '0 var(--space-3) 8px' }}>{error}</div>
      )}

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, padding: 'var(--space-3)', paddingTop: 0 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? 'AI Advisor is not configured' : 'Ask about your finances…'}
          disabled={disabled || pending}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn-primary" disabled={disabled || pending || !input.trim()}>
          <FontAwesomeIcon icon={faPaperPlane} />
        </button>
      </form>
    </div>
  );
}
