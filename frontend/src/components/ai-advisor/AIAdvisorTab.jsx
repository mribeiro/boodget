import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWandMagicSparkles, faKey, faCopy, faFileExport, faCheck, faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import AnalysisPanel from './AnalysisPanel';
import ChatPanel from './ChatPanel';
import { isAiDisabledError, useAiAvailableModels, modelSelectOptions } from '../../utils/aiModels';
import { subscribeAnalysis, startAnalysis as startAnalysisSession, reconnectAnalysis, clearAnalysisJob } from '../../utils/aiAdvisorSession';

export default function AIAdvisorTab({ dossierId, dossierName }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiDisabled, setAiDisabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [aiModel, setAiModel] = useState('');
  const [analysisJob, setAnalysisJob] = useState(null);
  const [savingModel, setSavingModel] = useState(false);
  const [exportingPrompt, setExportingPrompt] = useState(false);
  const [exportError, setExportError] = useState('');
  const [justCopied, setJustCopied] = useState(false);
  const [userNotes, setUserNotes] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const { models: availableModels, refreshing, refresh: refreshModels } = useAiAvailableModels(dossierId);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const settings = await api.getDossierSettings(dossierId);
      setAiModel(settings.ai_model || '');
      setUserNotes(settings.ai_user_context || '');
      setNotesDraft(settings.ai_user_context || '');
      if (settings.ai_enabled === false) {
        setAiDisabled(true);
        setConfigured(false);
        setAnalysis(null);
        return;
      }
      setAiDisabled(false);
      const analysisResp = await api.getAiAnalysis(dossierId);
      setConfigured(analysisResp.configured);
      setAnalysis(analysisResp.analysis);
      // Reconnect to an analysis already in progress — covers both a same-session tab-switch
      // remount and a genuine page reload, since the backend job registry is the source of truth.
      const jobs = await api.getAiActiveJobs(dossierId).catch(() => null);
      if (jobs?.analysis) reconnectAnalysis(dossierId, jobs.analysis);
    } catch (e) {
      if (isAiDisabledError(e)) {
        setAiDisabled(true);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => subscribeAnalysis(dossierId, ({ job }) => setAnalysisJob(job)), [dossierId]);

  useEffect(() => {
    if (!analysisJob) return;
    if (analysisJob.status === 'done') {
      setAnalysis(analysisJob.result);
      clearAnalysisJob(dossierId);
    } else if (analysisJob.status === 'error') {
      setError(analysisJob.error);
      clearAnalysisJob(dossierId);
    }
  }, [analysisJob, dossierId]);

  const analyzing = analysisJob?.status === 'running';

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

  async function handleRefreshModels() {
    setError('');
    try {
      await refreshModels();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveNotes() {
    setError('');
    setSavingNotes(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { ai_user_context: notesDraft });
      setUserNotes(updated.ai_user_context || '');
      setNotesDraft(updated.ai_user_context || '');
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleAnalyze() {
    setError('');
    try {
      await startAnalysisSession(dossierId);
    } catch (err) {
      if (isAiDisabledError(err)) {
        setAiDisabled(true);
      } else {
        setError(err.message);
      }
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
      if (isAiDisabledError(err)) {
        setAiDisabled(true);
      } else {
        setExportError(err.message || 'Could not copy the prompt to the clipboard');
      }
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
      if (isAiDisabledError(err)) {
        setAiDisabled(true);
      } else {
        setExportError(err.message || 'Could not download the prompt');
      }
    } finally {
      setExportingPrompt(false);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;

  if (aiDisabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FontAwesomeIcon icon={faKey} style={{ color: 'var(--color-warning)' }} />
            AI Advisor is disabled for this dossier
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            This feature was turned off in Settings → AI Settings, most likely from another tab or
            session. Re-enable it there to keep using the AI Advisor — this tab will disappear on
            its own the next time the page loads while it's off.
          </p>
        </div>
      </div>
    );
  }

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
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Additional context</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
          Add anything the numbers alone don't capture — e.g. "the July spike was a one-off vet
          bill" or "I'm deliberately not rebalancing stocks yet". This is included in every
          analysis, chat reply, and exported prompt, so the AI can factor it in instead of flagging
          something you've already explained.
        </p>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Add context for the AI to consider…"
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{notesDraft.length} / 4000</span>
          <button
            className="btn-secondary"
            onClick={handleSaveNotes}
            disabled={savingNotes || notesDraft === userNotes}
          >
            {savingNotes ? 'Saving…' : notesSaved ? 'Saved!' : 'Save notes'}
          </button>
        </div>
      </div>

      <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label style={{ fontSize: 12 }}>Model{savingModel ? ' (saving…)' : ''}</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={aiModel} onChange={handleModelChange} disabled={savingModel || analyzing} style={{ flex: 1 }}>
                {modelSelectOptions(availableModels, aiModel).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRefreshModels}
                disabled={refreshing}
                title="Check the Claude API for the latest Haiku/Sonnet/Opus model versions"
                style={{ padding: '0.4rem 0.6rem' }}
              >
                <FontAwesomeIcon icon={faArrowsRotate} spin={refreshing} />
              </button>
            </div>
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
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              {analysisJob?.text ? 'Streaming the response…' : 'Gathering the dossier data and asking the model…'}
            </p>
            {analysisJob?.text && (
              <pre
                style={{
                  margin: 0,
                  padding: 'var(--space-3)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 220,
                  overflowY: 'auto',
                  fontFamily: 'inherit',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                {analysisJob.text}
              </pre>
            )}
          </div>
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

      <ChatPanel dossierId={dossierId} disabled={!configured} onDisabled={() => setAiDisabled(true)} />
    </div>
  );
}
