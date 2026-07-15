import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPencil,
  faChevronDown,
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
import { parseDecimalInput, formatNumber } from '../utils/numbers';

function formatEur(value) {
  if (value == null || isNaN(value)) return 'Not set';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function SettingsCard({ title, description, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="card card--flat"
      style={{
        marginBottom: 'var(--space-5)',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          paddingBottom: open ? 'var(--space-3)' : 0,
          borderBottom: open ? '1px solid var(--border-default)' : 'none',
          textAlign: 'left',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
        <FontAwesomeIcon
          icon={faChevronDown}
          style={{
            color: 'var(--text-muted)',
            fontSize: 12,
            flexShrink: 0,
            marginLeft: 8,
            transition: 'transform 0.3s ease',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
      </button>
      {/* grid-template-rows animates to actual content height — no fixed max-height needed */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.3s ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div style={{ paddingTop: 'var(--space-4)' }}>
            {description && (
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 'var(--space-4)', marginTop: 0 }}>
                {description}
              </p>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmergencyFundSettings({ dossierId }) {
  const [settings, setSettings] = useState({ emergency_fund_months_multiplier: 6, emergency_fund_cycles_to_average: 6 });
  const [modal, setModal] = useState(null); // { key, label, suffix, draft }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => setSettings(s)).catch(() => {});
  }, [dossierId]);

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
      setSettings(updated);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {fields.map((field) => (
        <div key={field.key} style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>{field.label}</span>
          <strong>{settings[field.key]}</strong>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{field.suffix}</span>
          <button className="btn-secondary" onClick={() => openModal(field)} style={{ padding: '0.5rem 0.75rem' }}>
            <FontAwesomeIcon icon={faPencil} />
          </button>
        </div>
      ))}

      {modal && (
        <Modal
          title={modal.label}
          onClose={closeModal}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="number" inputMode="numeric" min={1}
              value={modal.draft}
              onChange={(e) => setModal((m) => ({ ...m, draft: e.target.value }))}
              autoFocus
              style={{ width: '5rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            {modal.suffix && <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{modal.suffix}</span>}
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function formatPct(value) {
  if (value == null || isNaN(value)) return 'Not set';
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function LoanSettings({ dossierId }) {
  const [referenceSalary, setReferenceSalary] = useState(null);
  const [maxSalaryPct, setMaxSalaryPct] = useState(null);
  const [editingField, setEditingField] = useState(null); // 'reference_salary' | 'loans_max_salary_pct' | null
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => {
      setReferenceSalary(s.reference_salary);
      setMaxSalaryPct(s.loans_max_salary_pct);
    }).catch(() => {});
  }, [dossierId]);

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
      setReferenceSalary(updated.reference_salary);
      setMaxSalaryPct(updated.loans_max_salary_pct);
      setEditingField(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>Reference monthly salary</span>
        <strong>{formatEur(referenceSalary)}</strong>
        <button className="btn-secondary" onClick={() => openEdit('reference_salary')} style={{ padding: '0.5rem 0.75rem' }}>
          <FontAwesomeIcon icon={faPencil} />
        </button>
      </div>

      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>Max % of salary assigned to loans</span>
        <strong>{formatPct(maxSalaryPct)}</strong>
        <button className="btn-secondary" onClick={() => openEdit('loans_max_salary_pct')} style={{ padding: '0.5rem 0.75rem' }}>
          <FontAwesomeIcon icon={faPencil} />
        </button>
      </div>

      {editingField && (
        <Modal
          title={editingField === 'reference_salary' ? 'Reference monthly salary' : 'Max % of salary assigned to loans'}
          onClose={() => setEditingField(null)}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
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
          {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function PaperlessSettings({ dossierId }) {
  const [settings, setSettings] = useState({
    paperless_url: null,
    paperless_token_set: false,
    paperless_date_field_id: null,
    paperless_amount_field_id: null,
  });
  // inline editing state for text/password fields
  const [editing, setEditing] = useState(null);
  const [inlineDraft, setInlineDraft] = useState('');
  const [showToken, setShowToken] = useState(false);
  // modal state for number fields
  const [modal, setModal] = useState(null); // { key, label, draft }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => setSettings(s)).catch(() => {});
  }, [dossierId]);

  // --- inline (text/password) ---
  function startInlineEdit(key) {
    setEditing(key);
    setInlineDraft(key === 'paperless_token' ? '' : String(settings[key] ?? ''));
    setError('');
  }

  function cancelInlineEdit() { setEditing(null); setInlineDraft(''); setError(''); }

  async function saveInline(key) {
    setError('');
    const val = inlineDraft.trim() || null;
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [key]: val });
      setSettings(updated);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // --- modal (number) ---
  function openModal(field) {
    setModal({ ...field, draft: String(settings[field.key] ?? '') });
    setError('');
  }

  function closeModal() { setModal(null); setError(''); }

  async function handleModalSave() {
    if (modal.draft === '') {
      // allow clearing
      setSaving(true);
      try {
        const updated = await api.updateDossierSettings(dossierId, { [modal.key]: null });
        setSettings(updated);
        closeModal();
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
      return;
    }
    const val = Number(modal.draft);
    if (!Number.isInteger(val) || val < 1) { setError('Must be a positive integer'); return; }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [modal.key]: val });
      setSettings(updated);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const textFields = [
    { key: 'paperless_url',   label: 'Paperless-ngx URL', type: 'text',     placeholder: 'https://paperless.example.com', isToken: false },
    { key: 'paperless_token', label: 'API Token',          type: 'password', placeholder: 'Token value',                   isToken: true  },
  ];

  const numberFields = [
    { key: 'paperless_date_field_id',   label: 'Payment date custom field ID' },
    { key: 'paperless_amount_field_id', label: 'Amount custom field ID' },
  ];

  function displayValue(key) {
    if (key === 'paperless_token') return settings.paperless_token_set ? '••••••••' : <em style={{ color: 'var(--text-muted)' }}>Not set</em>;
    const v = settings[key];
    if (v == null || v === '') return <em style={{ color: 'var(--text-muted)' }}>Not set</em>;
    return String(v);
  }

  return (
    <div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0, marginBottom: '1rem' }}>
        All four fields must be set for the integration to be active.
      </p>

      {/* Text / password fields — inline editing, icon-only button */}
      {textFields.map(({ key, label, type, placeholder, isToken }) => (
        <div key={key} style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>{label}</span>
            {editing === key ? (
              <>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={isToken && !showToken ? 'password' : 'text'}
                    value={inlineDraft}
                    onChange={(e) => setInlineDraft(e.target.value)}
                    placeholder={placeholder}
                    autoFocus
                    style={{ width: isToken ? '16rem' : '20rem', paddingRight: isToken ? '2rem' : undefined }}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveInline(key); if (e.key === 'Escape') cancelInlineEdit(); }}
                  />
                  {isToken && (
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      style={{ position: 'absolute', right: '0.4rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 12 }}
                    >
                      <FontAwesomeIcon icon={showToken ? faEyeSlash : faEye} />
                    </button>
                  )}
                </div>
                <button className="btn-primary" onClick={() => saveInline(key)} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-secondary" onClick={cancelInlineEdit}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{displayValue(key)}</span>
                <button className="btn-secondary" onClick={() => startInlineEdit(key)} style={{ padding: '0.5rem 0.75rem' }}>
                  <FontAwesomeIcon icon={faPencil} />
                </button>
              </>
            )}
          </div>
          {editing === key && error && (
            <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>
          )}
        </div>
      ))}

      {/* Number fields — modal editing */}
      {numberFields.map((field) => (
        <div key={field.key} style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>{field.label}</span>
          <strong>{displayValue(field.key)}</strong>
          <button className="btn-secondary" onClick={() => openModal(field)} style={{ padding: '0.5rem 0.75rem' }}>
            <FontAwesomeIcon icon={faPencil} />
          </button>
        </div>
      ))}

      {modal && (
        <Modal
          title={modal.label}
          onClose={closeModal}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleModalSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <input
            type="number" inputMode="numeric" min={1}
            value={modal.draft}
            onChange={(e) => setModal((m) => ({ ...m, draft: e.target.value }))}
            autoFocus
            style={{ width: '8rem' }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleModalSave(); }}
            placeholder="Leave blank to clear"
          />
          {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function NotificationDossierSettings({ dossierId }) {
  const [value, setValue] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => {
      setValue(s.expense_notification_days_before ?? 1);
    }).catch(() => {});
  }, [dossierId]);

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
      setValue(updated.expense_notification_days_before ?? v);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>Notify me</span>
        <strong>{value}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>day(s) before a fixed expense is due</span>
        <button className="btn-secondary" onClick={openModal} style={{ padding: '0.5rem 0.75rem' }}>
          <FontAwesomeIcon icon={faPencil} />
        </button>
      </div>

      {modalOpen && (
        <Modal
          title="Notification timing"
          onClose={closeModal}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="number" inputMode="numeric" min={0} max={7}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{ width: '5rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>day(s) before a fixed expense is due</span>
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
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
      <SettingsCard title="Cycle Settings">
        <DossierSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Monthly Expense Template"
        description="Template entries are copied into each new cycle. Changes here do not affect existing cycles. Use the Classification column to set Must/Want for Workbench calculations."
      >
        <ExpenseTemplate dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Annual Expense Template"
        description="Annual expenses are used in the Workbench (as monthly averages). They are not copied into cycles."
      >
        <AnnualExpenseTemplate dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Emergency Fund Settings"
        description="Configure how the emergency fund target is calculated. The target = multiplier × average monthly expense (computed from recent cycles)."
      >
        <EmergencyFundSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Loan Settings"
        description="A manually-set reference salary used to prefill new loans and to compute the Loans tab's total % of salary — set this deliberately rather than relying on a cycle's salary, which can include one-off bonuses. The max % sets the threshold the Loans tab warns against as your loan payments approach it."
      >
        <LoanSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Notifications"
        description="Configure how many days before a fixed expense is due you receive a push notification reminder."
      >
        <NotificationDossierSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Paperless-ngx Integration"
        description="Link fixed expenses to Paperless-ngx document tags to auto-fill values and payment days from scanned documents."
      >
        <PaperlessSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard title="Accounts" description="Add, reorder, and archive accounts tracked in this dossier.">
        <AccountManager dossierId={dossierId} inline />
      </SettingsCard>

      {dossier?.is_creator && (
        <SettingsCard title="Sharing" description="Share this dossier with other users. Shared users have full edit rights.">
          <ShareManager dossierId={dossierId} inline />
        </SettingsCard>
      )}

      <SettingsCard title="Dossier">
        {actionError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{actionError}</div>}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            <FontAwesomeIcon icon={faFileExport} style={{ marginRight: '0.4rem' }} />
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          {dossier?.is_creator && (
            <button className="btn-danger" onClick={handleDelete}>
              <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.4rem' }} />Delete dossier
            </button>
          )}
        </div>
      </SettingsCard>
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
