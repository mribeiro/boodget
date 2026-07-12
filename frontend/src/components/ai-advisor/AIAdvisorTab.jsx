import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWandMagicSparkles, faKey } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import AnalysisPanel from './AnalysisPanel';
import ChatPanel from './ChatPanel';

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest & cheapest ($1/$5 per MTok)' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — balanced ($3/$15 per MTok)' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8 — best for financial analysis ($5/$25 per MTok)' },
  { value: 'claude-fable-5', label: 'Fable 5 — most capable ($10/$50 per MTok)' },
];

export default function AIAdvisorTab({ dossierId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [aiModel, setAiModel] = useState('claude-opus-4-8');
  const [analyzing, setAnalyzing] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [analysisResp, settings] = await Promise.all([
        api.getAiAnalysis(dossierId),
        api.getDossierSettings(dossierId),
      ]);
      setConfigured(analysisResp.configured);
      setAnalysis(analysisResp.analysis);
      setAiModel(settings.ai_model || 'claude-opus-4-8');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleModelChange(e) {
    const value = e.target.value;
    const previous = aiModel;
    setAiModel(value);
    setSavingModel(true);
    try {
      await api.updateDossierSettings(dossierId, { ai_model: value });
    } catch (err) {
      setAiModel(previous);
      setError(err.message);
    } finally {
      setSavingModel(false);
    }
  }

  async function handleAnalyze() {
    setError('');
    setAnalyzing(true);
    try {
      const resp = await api.runAiAnalysis(dossierId);
      setAnalysis(resp.analysis);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <div className="alert alert-error">{error}</div>}

      {!configured && (
        <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FontAwesomeIcon icon={faKey} style={{ color: 'var(--color-warning)' }} />
            AI Advisor is not configured
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Set <code>ANTHROPIC_API_KEY</code> in your <code>.env</code> file (referenced by{' '}
            <code>docker-compose.yml</code>) and restart the app. You can create an API key at{' '}
            console.anthropic.com. Costs are billed to your own Anthropic account; each response
            shows an estimate of what it cost.
          </p>
        </div>
      )}

      <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label style={{ fontSize: 12 }}>Model{savingModel ? ' (saving…)' : ''}</label>
            <select value={aiModel} onChange={handleModelChange} disabled={savingModel || analyzing}>
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-primary"
            onClick={handleAnalyze}
            disabled={!configured || analyzing}
            style={{ whiteSpace: 'nowrap' }}
          >
            <FontAwesomeIcon icon={faWandMagicSparkles} style={{ marginRight: '0.4rem' }} />
            {analyzing ? 'Analyzing…' : analysis ? 'Re-analyze dossier' : 'Analyze dossier'}
          </button>
        </div>
        {analyzing && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            Gathering the dossier data and asking the model — this can take a minute or two on larger models.
          </p>
        )}
      </div>

      {analysis ? (
        <AnalysisPanel analysis={analysis} />
      ) : (
        configured && (
          <div className="card card--flat" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              No analysis yet. Run one to get a financial health score, highlights, and improvement
              suggestions based on this dossier's accounts, capital history, expenses, goals, and
              emergency fund.
            </p>
          </div>
        )
      )}

      <ChatPanel dossierId={dossierId} disabled={!configured} />
    </div>
  );
}
