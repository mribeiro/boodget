import { useState } from 'react';
import { api } from '../../services/api';
import Modal from '../ui/Modal';
import SettingsSkeleton from '../ui/SettingsSkeleton';
import SettingRow from '../ui/SettingRow';

const CYCLE_FIELD = { key: 'cycle_start_day', label: 'Cycle starts on day', suffix: null };

const WEEKEND_ADJUSTMENT_OPTIONS = [
  { value: 'none', label: 'No adjustment' },
  { value: 'previous_friday', label: 'Shift to the Friday before' },
  { value: 'next_monday', label: 'Shift to the Monday after' },
];

const WARNING_FIELDS = [
  { key: 'capital_snapshot_warning_day',      label: 'Warn about missing capital snapshot from day', suffix: 'of the month' },
  { key: 'next_cycle_warning_day',            label: 'Warn about next cycle not opened from day',    suffix: 'of the month' },
  { key: 'previous_cycle_close_warning_day',  label: 'Warn about previous cycle not closed from day', suffix: 'of the month' },
];

export default function DossierSettings({ dossierId, settings, onChange, showToast }) {
  const [modal, setModal] = useState(null); // { key, label, suffix, draft }
  const [saving, setSaving] = useState(false);
  const [savingWeekendAdjustment, setSavingWeekendAdjustment] = useState(false);
  const [error, setError] = useState('');

  async function handleWeekendAdjustmentChange(e) {
    const value = e.target.value;
    setSavingWeekendAdjustment(true);
    try {
      const updated = await api.updateDossierSettings(dossierId, { cycle_start_weekend_adjustment: value });
      onChange(updated);
      const label = WEEKEND_ADJUSTMENT_OPTIONS.find((o) => o.value === value)?.label ?? value;
      showToast(`Weekend adjustment set to "${label}"`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingWeekendAdjustment(false);
    }
  }

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
      onChange(updated);
      showToast(`${modal.label} saved`);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function renderRow(field) {
    return (
      <SettingRow
        key={field.key}
        label={field.label}
        value={settings[field.key]}
        suffix={field.suffix}
        onEdit={() => openModal(field)}
      />
    );
  }

  if (!settings) return <SettingsSkeleton rows={4} />;

  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      {renderRow(CYCLE_FIELD)}

      <SettingRow label="If the start day falls on a weekend">
        <select
          value={settings.cycle_start_weekend_adjustment ?? 'none'}
          onChange={handleWeekendAdjustmentChange}
          disabled={savingWeekendAdjustment}
        >
          {WEEKEND_ADJUSTMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </SettingRow>
      <p className="hint" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
        This only affects cycles opened from now on. When a new cycle's start actually
        shifts off a weekend, the previous cycle's end is adjusted to match so the two
        don't overlap or leave a gap — existing cycles are otherwise left untouched.
      </p>

      <div className="settings-subsection">
        <div className="settings-subsection__title">Glances warning thresholds</div>
        {WARNING_FIELDS.map(renderRow)}
      </div>

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
              type="number" inputMode="numeric" min={1} max={28}
              value={modal.draft}
              onChange={(e) => setModal((m) => ({ ...m, draft: e.target.value }))}
              autoFocus
              style={{ width: '5rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            {modal.suffix && <span className="setting-row__suffix">{modal.suffix}</span>}
          </div>
          {modal.key === 'cycle_start_day' && (
            <p className="hint" style={{ marginBottom: 0 }}>
              This only affects cycles opened from now on — existing cycles (open or closed) keep the date range, ordering, and payment-day logic they were created with.
            </p>
          )}
          {error && <div className="alert alert-error alert--modal">{error}</div>}
        </Modal>
      )}
    </div>
  );
}
