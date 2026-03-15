import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil } from '@fortawesome/free-solid-svg-icons';
import DossierSettings from './expenses/DossierSettings';
import ExpenseTemplate from './expenses/ExpenseTemplate';
import AnnualExpenseTemplate from './expenses/AnnualExpenseTemplate';
import { api } from '../services/api';

function SettingsCard({ title, description, children }) {
  return (
    <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
      <h2 style={{
        fontSize: 16, fontWeight: 600,
        borderBottom: '1px solid var(--border-default)',
        paddingBottom: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        {title}
      </h2>
      {description && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 'var(--space-4)' }}>
          {description}
        </p>
      )}
      {children}
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

export default function DossierSettingsTab({ dossierId }) {
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
    </div>
  );
}
