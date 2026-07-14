import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput } from '../../utils/numbers';
import { computeMonthsLeft, endDateFromMonthsLeft } from '../../utils/loanMath';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseYM(ym) {
  const [y, m] = ym.split('-');
  return { year: parseInt(y, 10), month: parseInt(m, 10) };
}

// Draft loans don't carry the two fields an active loan needs — remaining_balance and
// end_date — so promoting asks for just those, prefilled with reasonable defaults derived
// from the draft's own principal/term_months. Everything else (principal, term_months,
// down_payment, taeg, opening_fee, interest_rate) carries over untouched as history.
export default function PromoteLoanModal({ dossierId, loan, onSave, onClose }) {
  const now = new Date();
  const suggestedEndDate = loan.term_months ? endDateFromMonthsLeft(loan.term_months) : null;
  const initialEndYM = suggestedEndDate ? parseYM(suggestedEndDate) : { year: now.getFullYear(), month: now.getMonth() + 1 };

  const [remainingBalance, setRemainingBalance] = useState(loan.principal != null ? String(loan.principal) : '');
  const [endYear, setEndYear] = useState(initialEndYM.year);
  const [endMonth, setEndMonth] = useState(initialEndYM.month);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}`;
  const previewMonthsLeft = computeMonthsLeft(endDate);

  async function handleConfirm() {
    setError('');
    const balance = parseDecimalInput(remainingBalance);
    if (isNaN(balance) || balance <= 0) { setError('Remaining balance must be a positive number'); return; }
    if (computeMonthsLeft(endDate) < 1) { setError('End date must be the current month or later'); return; }

    setSaving(true);
    try {
      const result = await api.updateLoan(dossierId, loan.id, {
        status: 'active',
        remaining_balance: balance,
        end_date: endDate,
      });
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Promote to Active</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && <div className="alert alert-error">{error}</div>}
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            This marks "{loan.name}" as a real, ongoing loan. Principal, term, rate, TAEG, and opening fee carry over as-is. An active loan just also needs the two things below, which a draft doesn't track.
          </p>
          <div className="form-group">
            <label>Remaining balance (€)</label>
            <input type="text" inputMode="decimal" value={remainingBalance} onChange={(e) => setRemainingBalance(e.target.value)} placeholder="0.00" />
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Prefilled from the draft's principal — adjust if anything has already been paid down.
            </div>
          </div>
          <div className="form-group">
            <label>Loan end date</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))} style={{ flex: '1 1 auto', minWidth: 0 }}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number" inputMode="decimal"
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                min="2020"
                max="2100"
                style={{ flex: '0 0 70px', minWidth: 0 }}
              />
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {previewMonthsLeft != null && previewMonthsLeft >= 1
                ? `${previewMonthsLeft} month${previewMonthsLeft === 1 ? '' : 's'} left — suggested from the draft's term, adjust if needed.`
                : 'Must be the current month or later.'}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Promoting…' : 'Promote to Active'}
          </button>
        </div>
      </div>
    </div>
  );
}
