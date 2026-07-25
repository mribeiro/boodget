import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronDown,
  faChevronRight,
  faFileExport,
  faTrash,
  faEye,
  faEyeSlash,
} from '@fortawesome/free-solid-svg-icons';
import DossierSettings from './expenses/DossierSettings';
import ExpenseTemplate from './expenses/ExpenseTemplate';
import AnnualExpenseTemplate from './expenses/AnnualExpenseTemplate';
import AccountManager from './AccountManager';
import ShareManager from './ShareManager';
import { api } from '../services/api';
import ConfirmModal from './ConfirmModal';
import Modal from './ui/Modal';
import Checkbox from './ui/Checkbox';
import SettingsSkeleton from './ui/SettingsSkeleton';
import SettingRow from './ui/SettingRow';
import Toast from './ui/Toast';
import useToast from './ui/useToast';
import { parseDecimalInput, formatNumber } from '../utils/numbers';

const AI_MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest & cheapest' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8 — best for financial analysis' },
  { value: 'claude-fable-5', label: 'Fable 5 — most capable' },
];

function formatEur(value) {
  if (value == null || isNaN(value)) return 'Not set';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function SettingsCard({ title, description, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
      <button
        type="button"
        className={`settings-card-header${open ? ' open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <h2>{title}</h2>
        <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="collapsible-chevron" />
      </button>
      <div className={`collapsible-body${open ? ' open' : ''}`}>
        <div>
          <div style={{ paddingTop: 'var(--space-4)' }}>
            {description && <p className="hint" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>{description}</p>}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmergencyFundSettings({ dossierId, settings, onChange, showToast }) {
  const [modal, setModal] = useState(null); // { key, label, suffix, draft }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fields = [
    { key: 'emergency_fund_months_multiplier', label: 'Emergency fund should cover', suffix: 'months of expenses' },
    { key: 'emergency_fund_cycles_to_average', label: 'Calculate average expenses from the last', suffix: 'cycles' },
  ];

  function openModal(field) {
    setModal({ ...field, draft: String(settings[field.key] ?? '') });
    setError('');
  }

  function closeModal() { setModal(null); setError(''); }

  async function handleSave() {
    const v = Number(modal.draft);
    if (!Number.isInteger(v) || v < 1) { setError('Must be an integer ≥ 1'); return; }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [modal.key]: v });
      onChange(updated);
      showToast(`${modal.label} saved`);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <SettingsSkeleton rows={2} />;

  return (
    <div>
      {fields.map((field) => (
        <SettingRow
          key={field.key}
          label={field.label}
          value={settings[field.key]}
          suffix={field.suffix}
          onEdit={() => openModal(field)}
        />
      ))}

      {modal && (
        <Modal
          title={modal.label}
          onClose={closeModal}
          footer={
            <div className="form-actions">
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="modal-field-row">
            <input
              type="number" inputMode="numeric" min={1}
              value={modal.draft}
              onChange={(e) => setModal((m) => ({ ...m, draft: e.target.value }))}
              autoFocus
              style={{ width: '5rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            {modal.suffix && <span className="setting-row__suffix">{modal.suffix}</span>}
          </div>
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function formatPct(value) {
  if (value == null || isNaN(value)) return 'Not set';
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

const LOAN_FIELD_LABELS = {
  reference_salary: 'Reference monthly salary',
  loans_max_salary_pct: 'Max % of salary assigned to loans',
};

function LoanSettings({ dossierId, settings, onChange, showToast }) {
  const [editingField, setEditingField] = useState(null); // 'reference_salary' | 'loans_max_salary_pct' | null
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const referenceSalary = settings?.reference_salary ?? null;
  const maxSalaryPct = settings?.loans_max_salary_pct ?? null;

  function openEdit(field) {
    const current = field === 'reference_salary' ? referenceSalary : maxSalaryPct;
    setDraft(current != null ? String(current) : '');
    setEditingField(field);
    setError('');
  }

  async function handleSave() {
    const v = draft.trim() === '' ? null : parseDecimalInput(draft);
    if (editingField === 'loans_max_salary_pct' && v != null && (isNaN(v) || v < 0 || v > 100)) {
      setError('Must be empty or a number between 0 and 100');
      return;
    }
    if (editingField === 'reference_salary' && v != null && (isNaN(v) || v < 0)) {
      setError('Must be empty or a non-negative number');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [editingField]: v });
      onChange(updated);
      showToast(`${LOAN_FIELD_LABELS[editingField]} ${v == null ? 'cleared' : 'saved'}`);
      setEditingField(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <SettingsSkeleton rows={2} />;

  return (
    <div>
      <SettingRow
        label={LOAN_FIELD_LABELS.reference_salary}
        value={referenceSalary == null ? null : formatEur(referenceSalary)}
        onEdit={() => openEdit('reference_salary')}
      />

      <SettingRow
        label={LOAN_FIELD_LABELS.loans_max_salary_pct}
        value={maxSalaryPct == null ? null : formatPct(maxSalaryPct)}
        onEdit={() => openEdit('loans_max_salary_pct')}
      />

      {editingField && (
        <Modal
          title={LOAN_FIELD_LABELS[editingField]}
          onClose={() => setEditingField(null)}
          footer={
            <div className="form-actions">
              <button className="btn-secondary" onClick={() => setEditingField(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="form-group">
            <input
              type="text" inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={editingField === 'reference_salary' ? '0.00' : 'e.g. 30'}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

const PAPERLESS_FIELDS = [
  { key: 'paperless_url',             label: 'Paperless-ngx URL',            kind: 'text',     placeholder: 'https://paperless.example.com' },
  { key: 'paperless_token',           label: 'API Token',                    kind: 'password', placeholder: 'Token value' },
  { key: 'paperless_date_field_id',   label: 'Payment date custom field ID', kind: 'number',   placeholder: 'Leave blank to clear' },
  { key: 'paperless_amount_field_id', label: 'Amount custom field ID',       kind: 'number',   placeholder: 'Leave blank to clear' },
];

function PaperlessSettings({ dossierId, settings, onChange, showToast }) {
  // One editing model for all four fields. This card used to mix two: inline
  // edit-in-place for the text/password pair and a modal for the numbers, so
  // which affordance you got depended on which row you clicked.
  const [modal, setModal] = useState(null); // { ...field, draft }
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openModal(field) {
    // A stored token is never returned by the API, so editing it always starts blank.
    setModal({ ...field, draft: field.kind === 'password' ? '' : String(settings[field.key] ?? '') });
    setShowSecret(false);
    setError('');
  }

  function closeModal() { setModal(null); setError(''); }

  async function handleSave() {
    const raw = modal.draft.trim();
    let value;
    if (raw === '') {
      value = null; // blank clears the field
    } else if (modal.kind === 'number') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) { setError('Must be a positive integer'); return; }
      value = n;
    } else {
      value = raw;
    }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [modal.key]: value });
      onChange(updated);
      showToast(raw === '' ? `${modal.label} cleared` : `${modal.label} saved`);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Returns null when unset — SettingRow renders the shared "Not set" empty treatment.
  function displayValue(key) {
    if (key === 'paperless_token') return settings.paperless_token_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : null;
    const v = settings[key];
    if (v == null || v === '') return null;
    return String(v);
  }

  if (!settings) return <SettingsSkeleton rows={4} />;

  return (
    <div>
      {PAPERLESS_FIELDS.map((field) => (
        <SettingRow
          key={field.key}
          label={field.label}
          value={displayValue(field.key)}
          onEdit={() => openModal(field)}
        />
      ))}

      {modal && (
        <Modal
          title={modal.label}
          onClose={closeModal}
          footer={
            <div className="form-actions">
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
          }
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={modal.kind === 'number' ? 'number' : (modal.kind === 'password' && !showSecret ? 'password' : 'text')}
              inputMode={modal.kind === 'number' ? 'numeric' : undefined}
              min={modal.kind === 'number' ? 1 : undefined}
              value={modal.draft}
              onChange={(e) => setModal((m) => ({ ...m, draft: e.target.value }))}
              placeholder={modal.placeholder}
              autoFocus
              style={{ paddingRight: modal.kind === 'password' ? '2rem' : undefined }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            {modal.kind === 'password' && (
              <button
                type="button"
                className="input-reveal-btn"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? 'Hide token' : 'Show token'}
              >
                <FontAwesomeIcon icon={showSecret ? faEyeSlash : faEye} />
              </button>
            )}
          </div>
          <p className="hint">Leave blank to clear this field.</p>
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function AISettings({ dossierId, settings, onChange, showToast }) {
  // The API key edits in a modal like every other scalar setting; only the
  // enable toggle and the model select auto-save, and both confirm with a toast.
  const [modalOpen, setModalOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function updateField(fields, toastMessage) {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateDossierSettings(dossierId, fields);
      onChange(updated);
      if (toastMessage) showToast(toastMessage);
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function toggleEnabled() {
    const next = !settings.ai_enabled;
    updateField({ ai_enabled: next }, next ? 'AI features enabled' : 'AI features disabled').catch(() => {});
  }

  function handleModelChange(e) {
    const value = e.target.value;
    const label = AI_MODEL_OPTIONS.find((o) => o.value === value)?.label ?? value;
    updateField({ ai_model: value }, `Model set to ${label.split(' \u2014 ')[0]}`).catch(() => {});
  }

  function openModal() {
    // The stored key is never returned by the API, so editing always starts blank.
    setKeyDraft('');
    setShowKey(false);
    setError('');
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); setKeyDraft(''); setError(''); }

  async function handleSave() {
    const raw = keyDraft.trim();
    try {
      await updateField({ ai_api_key: raw || null }, raw ? 'API key saved' : 'API key cleared');
      closeModal();
    } catch {
      // error already surfaced via updateField
    }
  }

  if (!settings) return <SettingsSkeleton rows={3} />;

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center' }}>
        <Checkbox
          label="Enable AI features for this dossier"
          checked={settings.ai_enabled}
          onChange={toggleEnabled}
          disabled={saving}
        />
      </div>

      <SettingRow label="Default model">
        <select value={settings.ai_model} onChange={handleModelChange} disabled={saving}>
          {AI_MODEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Claude API key"
        value={settings.ai_api_key_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : null}
        onEdit={openModal}
      />
      <p className="hint" style={{ textAlign: 'right' }}>
        {settings.ai_api_key_set
          ? "Overrides the server's ANTHROPIC_API_KEY for this dossier."
          : "Falls back to the server's ANTHROPIC_API_KEY."}
      </p>

      {modalOpen && (
        <Modal
          title="Claude API key"
          onClose={closeModal}
          footer={
            <div className="form-actions">
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
          }
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-ant-\u2026"
              autoFocus
              style={{ paddingRight: '2rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <button
              type="button"
              className="input-reveal-btn"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              <FontAwesomeIcon icon={showKey ? faEyeSlash : faEye} />
            </button>
          </div>
          <p className="hint">Leave blank to clear the key and fall back to the server's ANTHROPIC_API_KEY.</p>
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}

      {error && !modalOpen && <div className="alert alert-error alert--modal">{error}</div>}
    </div>
  );
}

const DAYS_BEFORE_SUFFIX = 'day(s) before a fixed expense is due';

function NotificationDossierSettings({ dossierId, settings, onChange, showToast }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const value = settings?.expense_notification_days_before ?? 1;

  function openModal() {
    setDraft(String(value));
    setError('');
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); setError(''); }

  async function handleSave() {
    const v = Number(draft);
    if (!Number.isInteger(v) || v < 0 || v > 7) { setError('Must be an integer between 0 and 7'); return; }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { expense_notification_days_before: v });
      onChange(updated);
      showToast('Notification timing saved');
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <SettingsSkeleton rows={1} />;

  return (
    <div>
      <SettingRow
        label="Notify me"
        value={value}
        suffix={DAYS_BEFORE_SUFFIX}
        onEdit={openModal}
      />

      {modalOpen && (
        <Modal
          title="Notification timing"
          onClose={closeModal}
          footer={
            <div className="form-actions">
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="modal-field-row">
            <input
              type="number" inputMode="numeric" min={0} max={7}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{ width: '5rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <span className="setting-row__suffix">{DAYS_BEFORE_SUFFIX}</span>
          </div>
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

export default function DossierSettingsTab({ dossierId, dossier }) {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirmState, setConfirmState] = useState(null);

  // One fetch for the whole tab. Every section below reads from this and reports
  // its saved result back via onSettingsChange — previously each of them fetched
  // the same payload independently on mount (seven identical calls, all firing
  // immediately because SettingsCard never unmounts its collapsed children).
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setSettingsError('');
    api
      .getDossierSettings(dossierId)
      .then((s) => { if (!cancelled) setSettings(s); })
      .catch((err) => { if (!cancelled) setSettingsError(err.message || 'Failed to load dossier settings'); });
    return () => { cancelled = true; };
  }, [dossierId]);

  const { toast, showToast } = useToast();
  const settingsProps = { dossierId, settings, onChange: setSettings, showToast };

  async function handleExport() {
    setExporting(true);
    setActionError('');
    try {
      const data = await api.exportDossier(dossierId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dossier.name.replace(/[^a-z0-9]/gi, '_')}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function handleDelete() {
    setConfirmState({
      title: 'Delete dossier',
      message: `Delete dossier "${dossier.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteDossier(dossierId);
          navigate('/');
        } catch (err) {
          setActionError(err.message);
        }
      },
    });
  }

  return (
    <div>
      {settingsError && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>
          {settingsError}
        </div>
      )}

      <SettingsCard
        title="Cycles"
        description="When each monthly cycle starts, and how early the Glances panel warns you about a missing snapshot or an unopened/unclosed cycle."
        defaultOpen
      >
        <DossierSettings {...settingsProps} />
      </SettingsCard>

      <SettingsCard
        title="Monthly Expense Template"
        description="Template entries are copied into each new cycle. Changes here do not affect existing cycles. Use the Classification column to set Must/Want for Workbench calculations."
      >
        <ExpenseTemplate dossierId={dossierId} settings={settings} showToast={showToast} />
      </SettingsCard>

      <SettingsCard
        title="Annual Expense Template"
        description="Annual expenses are used in the Workbench (as monthly averages). They are not copied into cycles."
      >
        <AnnualExpenseTemplate dossierId={dossierId} showToast={showToast} />
      </SettingsCard>

      <SettingsCard
        title="Emergency Fund"
        description="Configure how the emergency fund target is calculated. The target = multiplier × average monthly expense (computed from recent cycles)."
      >
        <EmergencyFundSettings {...settingsProps} />
      </SettingsCard>

      <SettingsCard
        title="Loans"
        description="A manually-set reference salary used to prefill new loans and to compute the Loans tab's total % of salary — set this deliberately rather than relying on a cycle's salary, which can include one-off bonuses. The max % sets the threshold the Loans tab warns against as your loan payments approach it."
      >
        <LoanSettings {...settingsProps} />
      </SettingsCard>

      <SettingsCard
        title="Notifications"
        description="Configure how many days before a fixed expense is due you receive a push notification reminder."
      >
        <NotificationDossierSettings {...settingsProps} />
      </SettingsCard>

      <SettingsCard
        title="Paperless-ngx Integration"
        description="Link fixed expenses to Paperless-ngx document tags to auto-fill values and payment days from scanned documents. All four fields must be set for the integration to be active."
      >
        <PaperlessSettings {...settingsProps} />
      </SettingsCard>

      <SettingsCard
        title="AI Advisor"
        description="Control the AI Advisor for this dossier. When disabled, the AI Advisor tab and all AI references are hidden. The API key is optional — if left unset, the server's ANTHROPIC_API_KEY environment variable is used instead."
      >
        <AISettings {...settingsProps} />
      </SettingsCard>

      <SettingsCard title="Accounts" description="Add, reorder, and archive accounts tracked in this dossier.">
        <AccountManager dossierId={dossierId} inline showToast={showToast} />
      </SettingsCard>

      {dossier?.is_creator && (
        <SettingsCard title="Sharing" description="Share this dossier with other users. Shared users have full edit rights.">
          <ShareManager dossierId={dossierId} inline showToast={showToast} />
        </SettingsCard>
      )}

      <SettingsCard title="Dossier" description="Export this dossier as a JSON file, or delete it permanently.">
        {actionError && <div className="alert alert-error">{actionError}</div>}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            <FontAwesomeIcon icon={faFileExport} style={{ marginRight: 'var(--space-2)' }} />
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          {dossier?.is_creator && (
            <button className="btn-danger" onClick={handleDelete}>
              <FontAwesomeIcon icon={faTrash} style={{ marginRight: 'var(--space-2)' }} />Delete dossier
            </button>
          )}
        </div>
      </SettingsCard>
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <Toast {...toast} />
    </div>
  );
}
