import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import { computeMonthlyPayment } from '../../utils/loanMath';

function formatEur(value) {
  if (value == null || isNaN(value)) return '—';
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

export default function LoanFormModal({ dossierId, loan, onSave, onClose }) {
  const isEdit = !!loan;

  const [name, setName] = useState(loan?.name ?? '');
  const [status, setStatus] = useState(loan?.status ?? 'draft');
  const [interestRate, setInterestRate] = useState(loan?.interest_rate != null ? String(loan.interest_rate) : '0');
  const [salary, setSalary] = useState(loan?.salary != null ? String(loan.salary) : '');
  const [principal, setPrincipal] = useState(loan?.principal != null ? String(loan.principal) : '');
  const [termMonths, setTermMonths] = useState(loan?.term_months != null ? String(loan.term_months) : '');
  const [remainingBalance, setRemainingBalance] = useState(loan?.remaining_balance != null ? String(loan.remaining_balance) : '');
  const [monthsLeft, setMonthsLeft] = useState(loan?.months_left != null ? String(loan.months_left) : '');
  const [expenseTemplateItemId, setExpenseTemplateItemId] = useState(loan?.expense_template_item_id ?? '');

  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [latestCycleSalary, setLatestCycleSalary] = useState(loan?.latest_cycle_salary ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getExpenseTemplate(dossierId)
      .then((items) => setFixedExpenses(items.filter((i) => i.section === 'expense' && i.type === 'Fixed')))
      .catch(() => {});

    if (!isEdit) {
      api.getCycles(dossierId)
        .then((cycles) => {
          if (cycles.length > 0) {
            const latest = cycles[cycles.length - 1];
            setLatestCycleSalary(latest.salary);
            setSalary((prev) => (prev === '' ? String(latest.salary) : prev));
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const previewPayment = status === 'draft'
    ? computeMonthlyPayment(parseDecimalInput(principal), parseDecimalInput(interestRate), Number(termMonths))
    : computeMonthlyPayment(parseDecimalInput(remainingBalance), parseDecimalInput(interestRate), Number(monthsLeft));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }

    const rate = parseDecimalInput(interestRate);
    if (isNaN(rate) || rate < 0 || rate > 100) { setError('Interest rate must be between 0 and 100'); return; }

    const salaryValue = salary === '' ? null : parseDecimalInput(salary);
    if (salaryValue != null && (isNaN(salaryValue) || salaryValue < 0)) { setError('Salary must be a non-negative number'); return; }

    const payload = {
      name: name.trim(),
      status,
      interest_rate: rate,
      salary: salaryValue,
    };

    if (status === 'draft') {
      const p = parseDecimalInput(principal);
      const t = Number(termMonths);
      if (isNaN(p) || p <= 0) { setError('Principal must be a positive number'); return; }
      if (!Number.isInteger(t) || t < 1) { setError('Term must be a whole number of months (≥ 1)'); return; }
      payload.principal = p;
      payload.term_months = t;
      payload.expense_template_item_id = null;
    } else {
      const b = parseDecimalInput(remainingBalance);
      const m = Number(monthsLeft);
      if (isNaN(b) || b <= 0) { setError('Remaining balance must be a positive number'); return; }
      if (!Number.isInteger(m) || m < 1) { setError('Months left must be a whole number (≥ 1)'); return; }
      payload.remaining_balance = b;
      payload.months_left = m;
      payload.expense_template_item_id = expenseTemplateItemId || null;
    }

    setSaving(true);
    try {
      let result;
      if (isEdit) {
        result = await api.updateLoan(dossierId, loan.id, payload);
      } else {
        result = await api.createLoan(dossierId, payload);
      }
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '560px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Loan' : 'New Loan'}</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car loan" />
            </div>

            <div className="form-group">
              <label>Status</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[
                  { value: 'draft', label: 'Draft (what-if)' },
                  { value: 'active', label: 'Active (real loan)' },
                ].map((opt) => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontWeight: 'normal' }}>
                    <input
                      type="radio"
                      name="status"
                      value={opt.value}
                      checked={status === opt.value}
                      onChange={() => setStatus(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Interest rate (annual, %)</label>
                <input type="text" inputMode="decimal" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="3,5" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Salary (€)</label>
                <input type="text" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0.00" />
                {latestCycleSalary != null && String(latestCycleSalary) !== salary && (
                  <button
                    type="button"
                    onClick={() => setSalary(String(latestCycleSalary))}
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: '0.25rem', fontSize: '0.78rem', color: 'var(--color-brand)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    Use latest ({formatEur(latestCycleSalary)})
                  </button>
                )}
              </div>
            </div>

            {status === 'draft' ? (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Principal (€)</label>
                  <input type="text" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="0.00" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Term (months)</label>
                  <input type="number" inputMode="numeric" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} placeholder="300" min="1" />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Remaining balance (€)</label>
                  <input type="text" inputMode="decimal" value={remainingBalance} onChange={(e) => setRemainingBalance(e.target.value)} placeholder="0.00" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Months left</label>
                  <input type="number" inputMode="numeric" value={monthsLeft} onChange={(e) => setMonthsLeft(e.target.value)} placeholder="120" min="1" />
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Linked fixed expense {status === 'draft' ? '(active loans only)' : '(optional)'}</label>
              <select
                value={expenseTemplateItemId || ''}
                onChange={(e) => setExpenseTemplateItemId(e.target.value)}
                disabled={status === 'draft'}
              >
                <option value="">— None —</option>
                {fixedExpenses.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              {status === 'draft' && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Draft loans cannot be linked to an expense — switch to Active to link one.
                </div>
              )}
            </div>

            <div className="card card--flat" style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Estimated monthly payment</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatEur(previewPayment)}</div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create loan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
