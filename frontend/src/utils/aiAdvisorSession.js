import { api, streamAiJob } from '../services/api';

// Module-level (not React state) so it survives the `key={activeTab}` remount that happens on
// every dossier tab switch (see CLAUDE.md "Animations" — `.tab-content` is remounted on purpose).
// Without this, an in-flight AI Advisor analysis or chat turn would be silently discarded any
// time the user switched to another tab and back — a completely normal in-app action. Scoped per
// dossier; naturally resets on a full page reload since module state doesn't survive that
// (Analysis separately reconnects via the backend's job registry on reload — see AIAdvisorTab;
// chat intentionally stays "resets when you leave" per the in-app-only recovery scope).
const sessions = new Map(); // dossierId -> session

function getSession(dossierId) {
  let s = sessions.get(dossierId);
  if (!s) {
    s = {
      chatMessages: [],
      chatJob: null, // { jobId, text } while a turn is streaming
      chatError: null,
      analysisJob: null, // { jobId, text, status: 'running'|'done'|'error', result?, error? }
      chatSubs: new Set(),
      analysisSubs: new Set(),
    };
    sessions.set(dossierId, s);
  }
  return s;
}

function notifyAnalysis(dossierId) {
  const s = getSession(dossierId);
  for (const cb of s.analysisSubs) cb({ job: s.analysisJob });
}

function notifyChat(dossierId) {
  const s = getSession(dossierId);
  for (const cb of s.chatSubs) cb({ messages: s.chatMessages, job: s.chatJob, error: s.chatError });
}

// Components subscribe in a useEffect; the callback fires immediately with whatever's already
// buffered (covers a remount mid-stream), then again on every update. Returns an unsubscribe fn.
export function subscribeAnalysis(dossierId, cb) {
  const s = getSession(dossierId);
  s.analysisSubs.add(cb);
  cb({ job: s.analysisJob });
  return () => s.analysisSubs.delete(cb);
}

export function subscribeChat(dossierId, cb) {
  const s = getSession(dossierId);
  s.chatSubs.add(cb);
  cb({ messages: s.chatMessages, job: s.chatJob, error: s.chatError });
  return () => s.chatSubs.delete(cb);
}

function attachAnalysisStream(dossierId, jobId) {
  const s = getSession(dossierId);
  s.analysisJob = { jobId, text: '', status: 'running' };
  notifyAnalysis(dossierId);
  streamAiJob(dossierId, 'analysis', jobId, {
    onSync: ({ text, status }) => {
      s.analysisJob = { ...s.analysisJob, text, status };
      notifyAnalysis(dossierId);
    },
    onDelta: (text) => {
      s.analysisJob = { ...s.analysisJob, text: s.analysisJob.text + text };
      notifyAnalysis(dossierId);
    },
    onDone: (result) => {
      s.analysisJob = { ...s.analysisJob, status: 'done', result };
      notifyAnalysis(dossierId);
    },
    onError: (message) => {
      s.analysisJob = { ...s.analysisJob, status: 'error', error: message };
      notifyAnalysis(dossierId);
    },
  });
}

export async function startAnalysis(dossierId) {
  const { job_id } = await api.startAiAnalysis(dossierId);
  attachAnalysisStream(dossierId, job_id);
}

// Called on mount when GET /ai-advisor/jobs/active reports a run already in progress — covers
// both a same-session remount (tab switch) and a genuine page reload, since the backend is the
// source of truth either way. No-op if this session is already attached to that job.
export function reconnectAnalysis(dossierId, jobId) {
  const s = getSession(dossierId);
  if (s.analysisJob?.jobId === jobId) return;
  attachAnalysisStream(dossierId, jobId);
}

export function clearAnalysisJob(dossierId) {
  const s = getSession(dossierId);
  s.analysisJob = null;
  notifyAnalysis(dossierId);
}

function attachChatStream(dossierId, jobId) {
  const s = getSession(dossierId);
  s.chatJob = { jobId, text: '' };
  notifyChat(dossierId);
  streamAiJob(dossierId, 'chat', jobId, {
    onSync: ({ text }) => {
      s.chatJob = { ...s.chatJob, text };
      notifyChat(dossierId);
    },
    onDelta: (text) => {
      s.chatJob = { ...s.chatJob, text: s.chatJob.text + text };
      notifyChat(dossierId);
    },
    onDone: (result) => {
      s.chatMessages = [
        ...s.chatMessages,
        {
          role: 'assistant',
          content: result.reply,
          model: result.model,
          cost_usd: result.cost_usd,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
        },
      ];
      s.chatJob = null;
      notifyChat(dossierId);
    },
    onError: (message) => {
      s.chatJob = null;
      s.chatError = message;
      notifyChat(dossierId);
    },
  });
}

// `model` (ephemeral per-call override, from the floating widget's model switcher — never
// persisted to the dossier's ai_model setting) and `pageContext` (whatever pageContext.js
// currently holds, attached only when the widget's toggle for it is on) are both optional.
export async function sendChatMessage(dossierId, text, { model, pageContext } = {}) {
  const s = getSession(dossierId);
  if (s.chatJob) return; // a turn is already in flight
  s.chatError = null;
  s.chatMessages = [...s.chatMessages, { role: 'user', content: text }];
  notifyChat(dossierId);
  try {
    const { job_id } = await api.startAiChat(dossierId, {
      messages: s.chatMessages.map((m) => ({ role: m.role, content: m.content })),
      ...(model ? { model } : {}),
      ...(pageContext ? { page_context: pageContext } : {}),
    });
    attachChatStream(dossierId, job_id);
  } catch (err) {
    s.chatError = err.message;
    notifyChat(dossierId);
  }
}

export function clearChat(dossierId) {
  const s = getSession(dossierId);
  s.chatMessages = [];
  s.chatError = null;
  notifyChat(dossierId);
}
