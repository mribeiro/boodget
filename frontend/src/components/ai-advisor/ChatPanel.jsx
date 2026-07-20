import { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faComments } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import CostLabel from './CostLabel';
import { MODEL_LABELS, isAiDisabledError } from '../../utils/aiModels';

// Chat about the dossier. History is client-side only (ephemeral by design):
// the full conversation is re-sent to the backend on every turn. `onDisabled` lets the parent
// switch to its friendly disabled view if ai_enabled was toggled off mid-session.
export default function ChatPanel({ dossierId, disabled, onDisabled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending || disabled) return;
    setError('');
    setInput('');
    const history = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setPending(true);
    try {
      const resp = await api.sendAiChatMessage(dossierId, {
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: resp.reply,
          model: resp.model,
          cost_usd: resp.cost_usd,
          input_tokens: resp.input_tokens,
          output_tokens: resp.output_tokens,
        },
      ]);
    } catch (err) {
      if (isAiDisabledError(err)) {
        onDisabled?.();
      } else {
        setError(err.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card card--flat" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FontAwesomeIcon icon={faComments} style={{ color: 'var(--color-brand)' }} />
          Chat about this dossier
        </h3>
        {messages.length > 0 && (
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { setMessages([]); setError(''); }}>
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
          <div className="ai-chat-bubble ai-chat-bubble--assistant" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Thinking…
          </div>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}

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
