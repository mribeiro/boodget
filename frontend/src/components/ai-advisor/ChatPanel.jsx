import { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faComments } from '@fortawesome/free-solid-svg-icons';
import CostLabel from './CostLabel';
import { MODEL_LABELS, isAiDisabledError } from '../../utils/aiModels';
import { subscribeChat, sendChatMessage, clearChat } from '../../utils/aiAdvisorSession';

// Chat about the dossier. History lives in the module-level aiAdvisorSession store (not local
// React state), so an in-flight turn survives switching dossier tabs and back instead of being
// silently discarded — see aiAdvisorSession.js. It still resets on a full page reload or leaving
// the dossier, matching the "conversation is not stored and resets when you leave" copy below.
// `onDisabled` lets the parent switch to its friendly disabled view if ai_enabled was toggled off
// mid-session.
export default function ChatPanel({ dossierId, disabled, onDisabled }) {
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
    await sendChatMessage(dossierId, text);
  }

  return (
    <div className="card card--flat" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FontAwesomeIcon icon={faComments} style={{ color: 'var(--color-brand)' }} />
          Chat about this dossier
        </h3>
        {messages.length > 0 && (
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => clearChat(dossierId)}>
            Clear
          </button>
        )}
      </div>

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
        <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>
      )}

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8 }}>
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
