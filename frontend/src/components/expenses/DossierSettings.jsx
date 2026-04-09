import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';

const WARNING_FIELDS = [
  {
    key: 'capital_snapshot_warning_day',
    label: 'Warn about missing capital snapshot from day',
    default: 7,
  },
  {
    key: 'next_cycle_warning_day',
    label: 'Warn about next cycle not opened from day',
    default: 22,
  },
  {
    key: 'previous_cycle_close_warning_day',
    label: 'Warn about previous cycle not closed from day',
    default: 25,
  },
];

export default function DossierSettings({ dossierId }) {
  const [settings, setSettings] = useState({
    cycle_start_day: 25,
    capital_snapshot_warning_day: 7,
    next_cycle_warning_day: 22,
    previous_cycle_close_warning_day: 25,
  });
  const [editing, setEditing] = useState(null); // key of the field being edited
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => setSettings(s));
  }, [dossierId]);

  function startEdit(key) {
    setEditing(key);
    setDraft(String(settings[key] ?? ''));
    setError('');
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
    setError('');
  }

  async function handleSave(key) {
    setError('');
    const day = Number(draft);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setError('Day must be between 1 and 28');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [key]: day });
      setSettings(updated);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function renderField(key, label) {
    const value = settings[key] ?? '';
    const isEditing = editing === key;
    return (
      <div key={key} style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            {label}
          </span>
          {isEditing ? (
            <>
              <input
                type="number" inputMode="numeric"
                min={1}
                max={28}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={{ width: '4rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
              />
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>of the month</span>
              <button className="btn-primary" onClick={() => handleSave(key)} disabled={saving} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-secondary" onClick={cancelEdit} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <strong>{value}</strong>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>of the month</span>
              <button className="btn-secondary" onClick={() => startEdit(key)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit
              </button>
            </>
          )}
        </div>
        {isEditing && error && (
          <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Cycle start day */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Cycle starts on day
          </span>
          {editing === 'cycle_start_day' ? (
            <>
              <input
                type="number" inputMode="numeric"
                min={1}
                max={28}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={{ width: '4rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
              />
              <button className="btn-primary" onClick={() => handleSave('cycle_start_day')} disabled={saving} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-secondary" onClick={cancelEdit} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <strong>{settings.cycle_start_day}</strong>
              <button className="btn-secondary" onClick={() => startEdit('cycle_start_day')} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
                <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit
              </button>
            </>
          )}
        </div>
        {editing === 'cycle_start_day' && error && (
          <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>
        )}
      </div>

      {/* Warning day fields */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
          Glances warning thresholds
        </div>
        {WARNING_FIELDS.map((f) => renderField(f.key, f.label))}
      </div>
    </div>
  );
}
