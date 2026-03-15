import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPencil,
  faChevronDown,
  faChevronRight,
  faFileExport,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import DossierSettings from './expenses/DossierSettings';
import ExpenseTemplate from './expenses/ExpenseTemplate';
import AnnualExpenseTemplate from './expenses/AnnualExpenseTemplate';
import AccountManager from './AccountManager';
import ShareManager from './ShareManager';
import { api } from '../services/api';

function SettingsCard({ title, description, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
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
          marginBottom: open ? 'var(--space-4)' : 0,
          textAlign: 'left',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h2>
        <FontAwesomeIcon
          icon={open ? faChevronDown : faChevronRight}
          style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0, marginLeft: 8 }}
        />
      </button>
      {open && (
        <>
          {description && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 'var(--space-4)' }}>
              {description}
            </p>
          )}
          {children}
        </>
      )}
    </div>
  );
}

function EmergencyFundSettings({ dossierId }) {
  const [settings, setSettings] = useState({ emergency_fund_months_multiplier: 6, emergency_fund_cycles_to_average: 6 });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => setSettings(s)).catch(() => {});
  }, [dossierId]);

  function startEdit(key) {
    setEditing(key);
    setDraft(String(settings[key] ?? ''));
    setError('');
  }

  function cancelEdit() { setEditing(null); setDraft(''); setError(''); }

  async function handleSave(key) {
    setError('');
    const v = Number(draft);
    if (!Number.isInteger(v) || v < 1) { setError('Must be an integer ≥ 1'); return; }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [key]: v });
      setSettings(updated);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const fields = [
    { key: 'emergency_fund_months_multiplier', label: 'Emergency fund should cover', suffix: 'months of expenses' },
    { key: 'emergency_fund_cycles_to_average', label: 'Calculate average expenses from the last', suffix: 'cycles' },
  ];

  return (
    <div>
      {fields.map(({ key, label, suffix }) => (
        <div key={key} style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{label}</span>
            {editing === key ? (
              <>
                <input
                  type="number"
                  min={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  style={{ width: '4rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
                />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{suffix}</span>
                <button className="btn-primary" onClick={() => handleSave(key)} disabled={saving} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-secondary" onClick={cancelEdit} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>Cancel</button>
              </>
            ) : (
              <>
                <strong>{settings[key]}</strong>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{suffix}</span>
                <button className="btn-secondary" onClick={() => startEdit(key)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}><FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit</button>
              </>
            )}
          </div>
          {editing === key && error && (
            <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DossierSettingsTab({ dossierId, dossier }) {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState('');

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

  async function handleDelete() {
    if (!confirm(`Delete dossier "${dossier.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteDossier(dossierId);
      navigate('/');
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <div>
      <SettingsCard title="Cycle Settings">
        <DossierSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Monthly Expense Template"
        description="Template entries are copied into each new cycle. Changes here do not affect existing cycles. Use the Classification column to set Must/Want for Workbench calculations."
        defaultOpen={false}
      >
        <ExpenseTemplate dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Annual Expense Template"
        description="Annual expenses are used in the Workbench (as monthly averages). They are not copied into cycles."
        defaultOpen={false}
      >
        <AnnualExpenseTemplate dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Emergency Fund Settings"
        description="Configure how the emergency fund target is calculated. The target = multiplier × average monthly expense (computed from recent cycles)."
      >
        <EmergencyFundSettings dossierId={dossierId} />
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
    </div>
  );
}
