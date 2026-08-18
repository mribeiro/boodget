import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileExport,
  faTrash,
  faEye,
  faEyeSlash,
  faPlus,
  faPencil,
  faXmark,
  faArrowsRotate,
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
import SettingsCard from './ui/SettingsCard';
import Toast from './ui/Toast';
import useToast from './ui/useToast';
import { parseDecimalInput, formatNumber } from '../utils/numbers';
import { useAiAvailableModels, modelSelectOptions, modelSelectGroups, modelProvider } from '../utils/aiModels';

function formatEur(value) {
  if (value == null || isNaN(value)) return 'Not set';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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

// Per-key config for the shared API-key edit modal in AISettings below — keyed by which
// dossier settings field is being edited.
const AI_KEY_FIELDS = {
  ai_api_key: {
    title: 'Claude API key',
    placeholder: 'sk-ant-…',
    envVar: 'ANTHROPIC_API_KEY',
  },
  ai_gemini_api_key: {
    title: 'Gemini API key',
    placeholder: 'AIza…',
    envVar: 'GEMINI_API_KEY',
  },
};

function AISettings({ dossierId, settings, onChange, showToast }) {
  // The API key edits in a modal like every other scalar setting; only the
  // enable toggle and the model select auto-save, and both confirm with a toast.
  // editingKey names which of AI_KEY_FIELDS is open, or null when the modal is closed.
  const [editingKey, setEditingKey] = useState(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { models: availableModels, refreshing, refresh: refreshModels } = useAiAvailableModels(dossierId);

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
    const label = modelSelectOptions(availableModels, value).find((o) => o.value === value)?.label ?? value;
    updateField({ ai_model: value }, `Model set to ${label}`).catch(() => {});
  }

  async function handleRefreshModels() {
    setError('');
    try {
      const { models, skipped, errors } = await refreshModels();
      const notes = [
        ...(skipped || []).map((p) => `${p === 'google' ? 'Gemini' : 'Claude'} skipped \u2014 no API key`),
        ...(errors || []).map((e) => `${e.provider === 'google' ? 'Gemini' : 'Claude'} failed \u2014 ${e.message}`),
      ];
      const suffix = notes.length ? ` (${notes.join('; ')})` : '';
      showToast(`Model catalog refreshed \u2014 ${models.map((m) => m.display_name).join(', ')}${suffix}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function openModal(field) {
    // The stored key is never returned by the API, so editing always starts blank.
    setKeyDraft('');
    setShowKey(false);
    setError('');
    setEditingKey(field);
  }

  function closeModal() { setEditingKey(null); setKeyDraft(''); setError(''); }

  async function handleSave() {
    const raw = keyDraft.trim();
    try {
      await updateField({ [editingKey]: raw || null }, raw ? 'API key saved' : 'API key cleared');
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
          {modelSelectGroups(availableModels, settings.ai_model).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary btn-icon"
          onClick={handleRefreshModels}
          disabled={refreshing}
          aria-label="Check the Claude and Gemini APIs for the latest model versions"
          title="Check the Claude and Gemini APIs for the latest model versions"
        >
          <FontAwesomeIcon icon={faArrowsRotate} spin={refreshing} />
        </button>
      </SettingRow>
      <p className="hint" style={{ textAlign: 'right' }}>
        {modelProvider(settings.ai_model) === 'google'
          ? settings.ai_gemini_api_key_set
            ? "Uses this dossier's Gemini API key."
            : "Uses the server's GEMINI_API_KEY (set the Gemini API key below to override)."
          : settings.ai_api_key_set
            ? "Uses this dossier's Claude API key."
            : "Uses the server's ANTHROPIC_API_KEY (set the Claude API key below to override)."}
      </p>

      <SettingRow
        label="Claude API key"
        value={settings.ai_api_key_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : null}
        onEdit={() => openModal('ai_api_key')}
      />
      <p className="hint" style={{ textAlign: 'right' }}>
        {settings.ai_api_key_set
          ? "Overrides the server's ANTHROPIC_API_KEY for this dossier."
          : "Falls back to the server's ANTHROPIC_API_KEY."}
      </p>

      <SettingRow
        label="Gemini API key"
        value={settings.ai_gemini_api_key_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : null}
        onEdit={() => openModal('ai_gemini_api_key')}
      />
      <p className="hint" style={{ textAlign: 'right' }}>
        {settings.ai_gemini_api_key_set
          ? "Overrides the server's GEMINI_API_KEY for this dossier."
          : "Falls back to the server's GEMINI_API_KEY."}
      </p>

      {editingKey && (
        <Modal
          title={AI_KEY_FIELDS[editingKey].title}
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
              placeholder={AI_KEY_FIELDS[editingKey].placeholder}
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
          <p className="hint">
            {`Leave blank to clear the key and fall back to the server's ${AI_KEY_FIELDS[editingKey].envVar}.`}
          </p>
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}

      {error && !editingKey && <div className="alert alert-error alert--modal">{error}</div>}
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

function IncomeSettings({ dossierId, showToast }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [formState, setFormState] = useState(null); // null = closed; { editing, name, value } = open

  useEffect(() => {
    api.getIncomeTemplate(dossierId).then(setItems).catch((e) => setError(e.message));
  }, [dossierId]);

  function openAdd() {
    setFormState({ editing: null, name: '', value: '' });
    setError('');
  }

  function openEdit(item) {
    setFormState({ editing: item, name: item.name, value: String(item.default_value) });
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    const v = parseDecimalInput(formState.value);
    if (!formState.name.trim() || isNaN(v) || v < 0) return;
    try {
      if (formState.editing) {
        const updated = await api.updateIncomeTemplateItem(dossierId, formState.editing.id, { name: formState.name.trim(), default_value: v });
        setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      } else {
        const created = await api.createIncomeTemplateItem(dossierId, { name: formState.name.trim(), default_value: v });
        setItems((prev) => [...prev, created]);
      }
      setFormState(null);
      showToast(formState.editing ? 'Income line updated' : 'Income line added');
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDelete(item) {
    setConfirmState({
      title: 'Delete income line',
      message: `Delete "${item.name}"? This won't affect any cycle already opened.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteIncomeTemplateItem(dossierId, item.id);
          setItems((prev) => prev.filter((x) => x.id !== item.id));
          showToast('Income line deleted');
        } catch (err) {
          setError(err.message);
        } finally {
          setConfirmState(null);
        }
      },
    });
  }

  if (!items) return <SettingsSkeleton rows={2} />;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-3)' }}>{error}</div>}

      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No income lines defined yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ textAlign: 'right' }}>Default value</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(item.default_value)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => openEdit(item)}><FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.3rem' }} />Edit</button>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '2px 8px', color: 'var(--color-danger)' }} onClick={() => handleDelete(item)}><FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.3rem' }} />Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button className="btn-primary" style={{ fontSize: 13, marginTop: 'var(--space-3)' }} onClick={openAdd}>
        <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add income line
      </button>

      {formState && (
        <div className="modal-overlay" onClick={() => setFormState(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{formState.editing ? 'Edit Income Line' : 'Add Income Line'}</h2>
              <button className="close-btn" onClick={() => setFormState(null)}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={formState.name}
                    onChange={(e) => setFormState((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Company salary, Stock savings, Extras"
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Default value (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formState.value}
                    onChange={(e) => setFormState((f) => ({ ...f, value: e.target.value }))}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setFormState(null)}>Cancel</button>
                <button type="submit" className="btn-primary">{formState.editing ? 'Save' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
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
        title="Income Settings"
        description="Configure the income lines (e.g. company salary, stock savings, extras) copied into every new cycle as a pre-filled, editable starting point. A cycle's total income is the sum of its own income lines."
      >
        <IncomeSettings dossierId={dossierId} showToast={showToast} />
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
        description="Control the AI Advisor for this dossier. When disabled, the AI Advisor tab and all AI references are hidden. Both API keys are optional — if left unset, the server's ANTHROPIC_API_KEY / GEMINI_API_KEY environment variables are used instead, whichever matches the selected model."
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
