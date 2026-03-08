import { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function DossierSettings({ dossierId }) {
  const [cycleStartDay, setCycleStartDay] = useState(25);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(25);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => {
      setCycleStartDay(s.cycle_start_day);
      setDraft(s.cycle_start_day);
    });
  }, [dossierId]);

  async function handleSave() {
    setError('');
    const day = Number(draft);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setError('Day must be between 1 and 28');
      return;
    }
    setSaving(true);
    try {
      const s = await api.updateDossierSettings(dossierId, { cycle_start_day: day });
      setCycleStartDay(s.cycle_start_day);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          Cycle starts on day
        </span>
        {editing ? (
          <>
            <input
              type="number"
              min={1}
              max={28}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: '4rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
            />
            <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary" onClick={() => { setEditing(false); setDraft(cycleStartDay); setError(''); }} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <strong>{cycleStartDay}</strong>
            <button className="btn-secondary" onClick={() => setEditing(true)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>
              Edit
            </button>
          </>
        )}
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
    </div>
  );
}
