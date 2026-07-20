import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import Modal from '../ui/Modal';

const CYCLE_FIELD = { key: 'cycle_start_day', label: 'Cycle starts on day', suffix: null };

const WARNING_FIELDS = [
  { key: 'capital_snapshot_warning_day',      label: 'Warn about missing capital snapshot from day', suffix: 'of the month' },
  { key: 'next_cycle_warning_day',            label: 'Warn about next cycle not opened from day',    suffix: 'of the month' },
  { key: 'previous_cycle_close_warning_day',  label: 'Warn about previous cycle not closed from day', suffix: 'of the month' },
];

export default function DossierSettings({ dossierId }) {
  const [settings, setSettings] = useState({
    cycle_start_day: 25,
    capital_snapshot_warning_day: 7,
    next_cycle_warning_day: 22,
    previous_cycle_close_warning_day: 25,
  });
  const [modal, setModal] = useState(null); // { key, label, suffix, draft }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDossierSettings(dossierId).then((s) => setSettings(s));
  }, [dossierId]);

  function openModal(field) {
    setModal({ ...field, draft: String(settings[field.key] ?? '') });
    setError('');
  }

  function closeModal() { setModal(null); setError(''); }

  async function handleSave() {
    const day = Number(modal.draft);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setError('Must be an integer between 1 and 28');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { [modal.key]: day });
      setSettings(updated);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function renderRow(field) {
    return (
      <div key={field.key} style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: '0.875rem' }}>{field.label}</span>
        <strong>{settings[field.key] ?? ''}</strong>
        {field.suffix && <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{field.suffix}</span>}
        <button className="btn-secondary" onClick={() => openModal(field)} style={{ padding: '0.5rem 0.75rem' }}>
          <FontAwesomeIcon icon={faPencil} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {renderRow(CYCLE_FIELD)}

      <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
          Glances warning thresholds
        </div>
        {WARNING_FIELDS.map(renderRow)}
      </div>

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
              type="number" inputMode="numeric" min={1} max={28}
              value={modal.draft}
              onChange={(e) => setModal((m) => ({ ...m, draft: e.target.value }))}
              autoFocus
              style={{ width: '5rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            {modal.suffix && <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{modal.suffix}</span>}
          </div>
          {modal.key === 'cycle_start_day' && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.75rem', marginBottom: 0 }}>
              This only affects cycles opened from now on — existing cycles (open or closed) keep the date range, ordering, and payment-day logic they were created with.
            </p>
          )}
          {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}
