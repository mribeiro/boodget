import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faThumbsUp, faArrowTrendUp, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import CostLabel from './CostLabel';

const MODEL_LABELS = {
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-fable-5': 'Fable 5',
};

function scoreColor(score) {
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function formatDate(isoish) {
  if (!isoish) return '';
  // SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"
  const d = new Date(isoish.includes('T') ? isoish : isoish.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return isoish;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Section({ icon, iconColor, title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
      <h3 style={{ fontSize: 14, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FontAwesomeIcon icon={icon} style={{ color: iconColor }} />
        {title}
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, i) => (
          <li key={i}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{item.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalysisPanel({ analysis }) {
  if (!analysis) return null;

  const score = analysis.health_score;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {score != null && (
            <div
              className="ai-score-badge"
              style={{ borderColor: scoreColor(score), color: scoreColor(score) }}
              title="Financial health score (0–100)"
            >
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{score}</span>
              <span style={{ fontSize: 10, letterSpacing: '0.05em' }}>/ 100</span>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Financial health</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap' }}>
              {analysis.health_summary}
            </p>
          </div>
        </div>
      </div>

      <Section icon={faThumbsUp} iconColor="var(--color-success)" title="Highlights" items={analysis.highlights} />
      <Section icon={faArrowTrendUp} iconColor="var(--color-brand)" title="What can be improved" items={analysis.improvements} />
      <Section icon={faTriangleExclamation} iconColor="var(--color-warning)" title="Risks to watch" items={analysis.risks} />

      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Analysed on {formatDate(analysis.created_at)} · {MODEL_LABELS[analysis.model] || analysis.model}</span>
        <CostLabel costUsd={analysis.cost_usd} inputTokens={analysis.input_tokens} outputTokens={analysis.output_tokens} />
      </div>
    </div>
  );
}
