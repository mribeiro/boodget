import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput } from '../../utils/numbers';
import Toggle from '../ui/Toggle';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function CarAdhocExpenseFormModal({ dossierId, car, expense, onSave, onClose }) {
  const isEdit = !!expense;
  const now = new Date();

  const [name, setName] = useState(expense?.name ?? '');
  const [value, setValue] = useState(expense?.value != null ? String(expense.value) : '');
  const [recurrence, setRecurrence] = useState(expense?.recurrence ?? 'monthly');
  const [status, setStatus] = useState(expense?.status ?? 'active');
  const [year, setYear] = useState(expense?.year ?? now.getFullYear());
  const [month, setMonth] = useState(expense?.month ?? now.getMonth() + 1);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 5 + i);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) { setError('Name is required'); return; }
    const parsedValue = parseDecimalInput(value);
    if (isNaN(parsedValue) || parsedValue < 0) { setError('Value must be a non-negative number'); return; }

    const payload = { name: trimmedName, value: parsedValue };
    if (recurrence === 'monthly') {
      payload.status = status;
    }
    if (!isEdit) {
      payload.recurrence = recurrence;
      if (recurrence === 'one_off') {
        payload.year = year;
        payload.month = month;
      }
    }

    setSaving(true);
    try {
      const result = isEdit
        ? await api.updateCarAdhocExpense(dossierId, car.id, expense.id, payload)
        : await api.createCarAdhocExpense(dossierId, car.id, payload);
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '480px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Ad-hoc Expense' : 'New Ad-hoc Expense'}</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && <div className="alert alert-error">{error}</div>}

            {!isEdit && (
              <div className="form-group">
                <label>Type</label>
                <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                  <option value="monthly">Recurring monthly amount</option>
                  <option value="one_off">One-off, for a specific month</option>
                </select>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {recurrence === 'monthly'
                    ? 'Applies to every month while active — e.g. an insurance premium your spouse pays.'
                    : 'Applies only to the month you pick — e.g. a one-time road tax payment.'}
                </div>
              </div>
            )}
            {isEdit && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {recurrence === 'monthly' ? 'Recurring monthly amount.' : `One-off, for ${MONTH_NAMES[month - 1]} ${year}.`}
                {' '}The type can't be changed — delete and recreate instead.
              </div>
            )}

            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Insurance (wife pays)" />
            </div>

            <div className="form-group">
              <label>{recurrence === 'monthly' ? 'Monthly amount (€)' : 'Amount (€)'}</label>
              <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 45" />
            </div>

            {recurrence === 'one_off' && (
              <div className="form-group">
                <label>Month</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={isEdit} style={{ flex: '1 1 auto', minWidth: 0 }}>
                    {MONTH_NAMES.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={isEdit} style={{ flex: '0 0 100px', minWidth: 0 }}>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {recurrence === 'monthly' && (
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ marginBottom: 0 }}>Active</label>
                <Toggle checked={status === 'active'} onChange={() => setStatus((s) => (s === 'active' ? 'cancelled' : 'active'))} />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
