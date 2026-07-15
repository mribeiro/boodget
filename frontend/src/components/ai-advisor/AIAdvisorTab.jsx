import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWandMagicSparkles, faKey, faCopy, faFileExport, faCheck } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import AnalysisPanel from './AnalysisPanel';
import ChatPanel from './ChatPanel';

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest & cheapest ($1/$5 per MTok)' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — balanced ($3/$15 per MTok)' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8 — best for financial analysis ($5/$25 per MTok)' },
  { value: 'claude-fable-5', label: 'Fable 5 — most capable ($10/$50 per MTok)' },
];

export default function AIAdvisorTab({ dossierId, dossierName }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [aiModel, setAiModel] = useState('claude-opus-4-8');
  const [analyzing, setAnalyzing] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [exportingPrompt, setExportingPrompt] = useState(false);
  const [exportError, setExportError] = useState('');
  const [justCopied, setJustCopied] = useState(false);

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

  async function handleCopyPrompt() {
    setExportError('');
    setExportingPrompt(true);
    try {
      const { prompt } = await api.getAiExportPrompt(dossierId);
      await navigator.clipboard.writeText(prompt);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 2500);
    } catch (err) {
      setExportError(err.message || 'Could not copy the prompt to the clipboard');
    } finally {
      setExportingPrompt(false);
    }
  }

  async function handleDownloadPrompt() {
    setExportError('');
    setExportingPrompt(true);
    try {
      const { prompt } = await api.getAiExportPrompt(dossierId);
      const blob = new Blob([prompt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(dossierName || 'dossier').replace(/[^a-z0-9]/gi, '_')}_ai_prompt.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message || 'Could not download the prompt');
    } finally {
      setExportingPrompt(false);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Use your Claude subscription instead</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Copy or download a ready-to-paste prompt with this dossier's full context and the same
          instructions used by "Analyze dossier" below (health score, summary, highlights,
          improvements, risks). Paste it into claude.ai chat — no API key needed, billed to your
          Claude subscription instead of API usage — then keep chatting under the same context.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleCopyPrompt} disabled={exportingPrompt}>
            <FontAwesomeIcon icon={justCopied ? faCheck : faCopy} style={{ marginRight: '0.4rem' }} />
            {exportingPrompt ? 'Preparing…' : justCopied ? 'Copied!' : 'Copy to clipboard'}
          </button>
          <button className="btn-secondary" onClick={handleDownloadPrompt} disabled={exportingPrompt}>
            <FontAwesomeIcon icon={faFileExport} style={{ marginRight: '0.4rem' }} />
            Download as text file
          </button>
        </div>
        {exportError && <div className="alert alert-error" style={{ marginTop: 10 }}>{exportError}</div>}
      </div>

      {!configured && (
        <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FontAwesomeIcon icon={faKey} style={{ color: 'var(--color-warning)' }} />
            AI Advisor is not configured
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Set an API key for this dossier in Settings → AI Settings, or set{' '}
            <code>ANTHROPIC_API_KEY</code> in your <code>.env</code> file (referenced by{' '}
            <code>docker-compose.yml</code>) and restart the app. You can create an API key at{' '}
            console.anthropic.com. Costs are billed to your own Anthropic account; each response
            shows an estimate of what it cost. Alternatively, use the section above to run the same
            analysis in claude.ai chat instead, using your Claude subscription — no key required.
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
