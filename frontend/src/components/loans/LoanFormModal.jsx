import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import { computeMonthlyPayment, computeMonthsLeft } from '../../utils/loanMath';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseYM(ym) {
  const [y, m] = ym.split('-');
  return { year: parseInt(y, 10), month: parseInt(m, 10) };
}

function formatEur(value) {
  if (value == null || isNaN(value)) return '—';
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

function formatDecimal(value) {
  if (value == null || isNaN(value)) return '';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LoanFormModal({ dossierId, loan, onSave, onClose }) {
  const isEdit = !!loan;
  const now = new Date();
  const initialEndYM = loan?.end_date ? parseYM(loan.end_date) : { year: now.getFullYear(), month: now.getMonth() + 1 };

  const [name, setName] = useState(loan?.name ?? '');
  const [status, setStatus] = useState(loan?.status ?? 'draft');
  const [interestRate, setInterestRate] = useState(loan?.interest_rate != null ? String(loan.interest_rate) : '0');
  const [salary, setSalary] = useState(loan?.salary != null ? String(loan.salary) : '');
  const [principal, setPrincipal] = useState(loan?.principal != null ? String(loan.principal) : '');
  const [termMonths, setTermMonths] = useState(loan?.term_months != null ? String(loan.term_months) : '');
  const [remainingBalance, setRemainingBalance] = useState(loan?.remaining_balance != null ? String(loan.remaining_balance) : '');
  const [endYear, setEndYear] = useState(initialEndYM.year);
  const [endMonth, setEndMonth] = useState(initialEndYM.month);
  const [dayOfPayment, setDayOfPayment] = useState(loan?.day_of_payment != null ? String(loan.day_of_payment) : '');
  const [expenseTemplateItemId, setExpenseTemplateItemId] = useState(loan?.expense_template_item_id ?? '');
  const [purchasePrice, setPurchasePrice] = useState(loan?.purchase_price != null ? String(loan.purchase_price) : '');
  const [downPayment, setDownPayment] = useState(loan?.down_payment != null ? String(loan.down_payment) : '');
  const [taeg, setTaeg] = useState(loan?.taeg != null ? String(loan.taeg) : '');
  const [openingFee, setOpeningFee] = useState(loan?.opening_fee != null ? String(loan.opening_fee) : '');

  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [referenceSalary, setReferenceSalary] = useState(loan?.reference_salary ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getExpenseTemplate(dossierId)
      .then((items) => setFixedExpenses(items.filter((i) => i.section === 'expense' && i.type === 'Fixed')))
      .catch(() => {});

    if (!isEdit) {
      api.getDossierSettings(dossierId)
        .then((s) => {
          if (s.reference_salary != null) {
            setReferenceSalary(s.reference_salary);
            setSalary((prev) => (prev === '' ? String(s.reference_salary) : prev));
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  // Purchase price / down payment is an optional breakdown for draft loans — when a purchase
  // price is entered, the amount financed (principal) is derived rather than typed directly.
  const usingPriceBreakdown = status === 'draft' && purchasePrice !== '';
  const parsedPurchasePrice = parseDecimalInput(purchasePrice);
  const parsedDownPayment = downPayment === '' ? 0 : parseDecimalInput(downPayment);
  const computedPrincipal = usingPriceBreakdown
    ? Math.max(0, (isNaN(parsedPurchasePrice) ? 0 : parsedPurchasePrice) - (isNaN(parsedDownPayment) ? 0 : parsedDownPayment))
    : null;

  const effectiveDraftPrincipal = usingPriceBreakdown ? computedPrincipal : parseDecimalInput(principal);

  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}`;
  const parsedDayOfPayment = dayOfPayment === '' ? null : Number(dayOfPayment);
  const previewMonthsLeft = status === 'active' ? computeMonthsLeft(endDate, parsedDayOfPayment) : null;

  const previewPayment = status === 'draft'
    ? computeMonthlyPayment(effectiveDraftPrincipal, parseDecimalInput(interestRate), Number(termMonths))
    : computeMonthlyPayment(parseDecimalInput(remainingBalance), parseDecimalInput(interestRate), previewMonthsLeft);

  const hasDraftTerm = status === 'draft' && Number.isInteger(Number(termMonths)) && Number(termMonths) > 0;

  // Total interest paid over the term (excludes the opening fee, which isn't interest).
  const previewTotalInterest = hasDraftTerm
    ? previewPayment * Number(termMonths) - effectiveDraftPrincipal
    : null;

  // Total amount payable (MTIC) — simplified estimate: principal + total interest + the
  // one modeled fee. The official legal MTIC can include untracked charges (stamp duty, insurance).
  const parsedOpeningFee = openingFee === '' ? 0 : parseDecimalInput(openingFee);
  const previewTotalAmountPayable = hasDraftTerm
    ? previewPayment * Number(termMonths) + (isNaN(parsedOpeningFee) ? 0 : parsedOpeningFee)
    : null;

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
      let p;
      if (usingPriceBreakdown) {
        if (isNaN(parsedPurchasePrice) || parsedPurchasePrice <= 0) { setError('Purchase price must be a positive number'); return; }
        if (isNaN(parsedDownPayment) || parsedDownPayment < 0) { setError('Down payment must be a non-negative number'); return; }
        if (parsedDownPayment >= parsedPurchasePrice) { setError('Down payment must be less than the purchase price'); return; }
        p = parsedPurchasePrice - parsedDownPayment;
        payload.down_payment = parsedDownPayment;
      } else {
        p = parseDecimalInput(principal);
        if (isNaN(p) || p <= 0) { setError('Principal must be a positive number'); return; }
        payload.down_payment = null;
      }
      const t = Number(termMonths);
      if (!Number.isInteger(t) || t < 1) { setError('Term must be a whole number of months (≥ 1)'); return; }

      const taegValue = taeg === '' ? null : parseDecimalInput(taeg);
      if (taegValue != null && (isNaN(taegValue) || taegValue < 0)) { setError('TAEG must be a non-negative number'); return; }

      const openingFeeValue = openingFee === '' ? null : parseDecimalInput(openingFee);
      if (openingFeeValue != null && (isNaN(openingFeeValue) || openingFeeValue < 0)) { setError('Opening fee must be a non-negative number'); return; }

      payload.principal = p;
      payload.term_months = t;
      payload.taeg = taegValue;
      payload.opening_fee = openingFeeValue;
      payload.expense_template_item_id = null;
    } else {
      const b = parseDecimalInput(remainingBalance);
      if (isNaN(b) || b <= 0) { setError('Remaining balance must be a positive number'); return; }
      if (!Number.isInteger(parsedDayOfPayment) || parsedDayOfPayment < 1 || parsedDayOfPayment > 31) {
        setError('Day of payment must be an integer between 1 and 31');
        return;
      }
      if (computeMonthsLeft(endDate, parsedDayOfPayment) < 1) { setError('End date must be the current month or later'); return; }
      payload.remaining_balance = b;
      payload.end_date = endDate;
      payload.day_of_payment = parsedDayOfPayment;
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
                <label>{status === 'draft' ? 'TAN (nominal rate, %)' : 'Interest rate (annual, %)'}</label>
                <input type="text" inputMode="decimal" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="3,5" />
                {status === 'draft' && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Use the TAN, not the TAEG — the TAEG (below) includes fees and doesn't drive the payment.
                  </div>
                )}
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Salary (€)</label>
                <input type="text" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0.00" />
                {referenceSalary != null && String(referenceSalary) !== salary && (
                  <button
                    type="button"
                    onClick={() => setSalary(String(referenceSalary))}
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: '0.25rem', fontSize: '0.78rem', color: 'var(--color-brand)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    Use reference salary ({formatEur(referenceSalary)})
                  </button>
                )}
              </div>
            </div>

            {status === 'draft' ? (
              <>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Purchase price (€) <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional)</span></label>
                    <input type="text" inputMode="decimal" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="e.g. 20000" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Down payment (€)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={downPayment}
                      onChange={(e) => setDownPayment(e.target.value)}
                      placeholder="0.00"
                      disabled={!usingPriceBreakdown}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Amount financed (€) {usingPriceBreakdown && <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(computed)</span>}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={usingPriceBreakdown ? formatDecimal(computedPrincipal) : principal}
                      onChange={(e) => setPrincipal(e.target.value)}
                      placeholder="0.00"
                      disabled={usingPriceBreakdown}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Term (months)</label>
                    <input type="number" inputMode="numeric" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} placeholder="300" min="1" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>TAEG (%) <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional, reference only)</span></label>
                    <input type="text" inputMode="decimal" value={taeg} onChange={(e) => setTaeg(e.target.value)} placeholder="e.g. 1,74" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Opening fee (€) <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional)</span></label>
                    <input type="text" inputMode="decimal" value={openingFee} onChange={(e) => setOpeningFee(e.target.value)} placeholder="e.g. 208" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Remaining balance (€)</label>
                    <input type="text" inputMode="decimal" value={remainingBalance} onChange={(e) => setRemainingBalance(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Day of payment (1–31)</label>
                    <input
                      type="number" inputMode="numeric" step="1" min={1} max={31}
                      value={dayOfPayment}
                      onChange={(e) => setDayOfPayment(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="e.g. 5"
                    />
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Once this day passes each month, that month counts as paid.
                    </div>
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
                  {previewMonthsLeft != null && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      {previewMonthsLeft} month{previewMonthsLeft === 1 ? '' : 's'} left — calculated automatically, no need to update this every month.
                    </div>
                  )}
                </div>
                {isEdit && (purchasePrice !== '' || downPayment !== '' || principal !== '' || termMonths !== '' || taeg !== '' || openingFee !== '') && (
                  <div className="card card--flat" style={{ padding: 'var(--space-3)', fontSize: '0.8rem' }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                      Original purchase structure (from when this loan was a draft — read-only, switch to Draft to edit)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      {purchasePrice !== '' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Purchase price</span><strong>{formatEur(parseDecimalInput(purchasePrice))}</strong></div>}
                      {downPayment !== '' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Down payment</span><strong>{formatEur(parseDecimalInput(downPayment))}</strong></div>}
                      {principal !== '' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Original principal</span><strong>{formatEur(parseDecimalInput(principal))}</strong></div>}
                      {termMonths !== '' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Original term (months)</span><strong>{termMonths}</strong></div>}
                      {taeg !== '' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TAEG</span><strong>{taeg}%</strong></div>}
                      {openingFee !== '' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Opening fee</span><strong>{formatEur(parseDecimalInput(openingFee))}</strong></div>}
                    </div>
                  </div>
                )}
              </>
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
              {previewTotalInterest != null && (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-default)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total interest paid</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-danger-text)' }}>{formatEur(previewTotalInterest)}</div>
                </div>
              )}
              {previewTotalAmountPayable != null && (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-default)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total amount payable (MTIC, estimate)</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{formatEur(previewTotalAmountPayable)}</div>
                </div>
              )}
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
