import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faPencil, faTrash, faCheck, faTriangleExclamation,
  faWallet, faCoins, faBullseye, faPercent, faReceipt, faArrowUp,
  faTable, faChevronDown, faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import {
  scenarioDownpayment, scenarioTargetPayment, scenarioRateChange, endDateFromMonthsLeft,
  computeAmortizationSchedule, groupScheduleByYear,
} from '../../utils/loanMath';
import LoanFormModal from './LoanFormModal';
import PromoteLoanModal from './PromoteLoanModal';
import ConfirmModal from '../ConfirmModal';
import CollapsibleSection from '../ui/CollapsibleSection';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatEur(value) {
  if (value == null || isNaN(value)) return '—';
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

function formatEndDate(ym) {
  if (!ym) return '—';
  const [year, month] = ym.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function yearsBreakdown(months) {
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rem > 0) parts.push(`${rem} month${rem === 1 ? '' : 's'}`);
  return parts;
}

function formatDuration(months) {
  if (!months || months <= 0) return '—';
  return yearsBreakdown(months).join(' ') + ' sooner';
}

// Appends a "(N years [and M months])" breakdown alongside a raw month count, once it's
// long enough for years to be a more readable unit — e.g. 300 -> "300 (25 years)".
function formatMonthsWithYears(months) {
  if (months == null) return '—';
  if (months < 12) return String(months);
  return `${months} (${yearsBreakdown(months).join(' and ')})`;
}

function formatSignedEur(value) {
  if (value == null || isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return sign + formatNumber(Math.abs(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: 13.5 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, ...valueStyle }}>{value}</span>
    </div>
  );
}

export default function LoanDetail() {
  const { id: dossierId, loanId } = useParams();
  const navigate = useNavigate();

  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  const [downpayment, setDownpayment] = useState('');
  const [targetPayment, setTargetPayment] = useState('');
  const [newInterestRate, setNewInterestRate] = useState('');

  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [coverageCollapsed, setCoverageCollapsed] = useState(false);
  const [downpaymentCollapsed, setDownpaymentCollapsed] = useState(false);
  const [targetCollapsed, setTargetCollapsed] = useState(false);
  const [rateCollapsed, setRateCollapsed] = useState(false);
  const [scheduleCollapsed, setScheduleCollapsed] = useState(true);
  const [expandedYears, setExpandedYears] = useState(new Set());

  function toggleYear(year) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  }

  useEffect(() => {
    load();
  }, [dossierId, loanId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const l = await api.getLoan(dossierId, loanId);
      setLoan(l);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDelete() {
    setConfirmState({
      title: 'Delete loan',
      message: `Delete loan "${loan.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteLoan(dossierId, loan.id);
          navigate(`/dossiers/${dossierId}`, { state: { tab: 'loans' } });
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!loan) return null;

  const isActive = loan.status === 'active';
  // Scenarios work identically for a draft's (principal, term_months) as for an active
  // loan's (remaining_balance, months_left) — a study you haven't signed yet is just as
  // worth fine-tuning as a real one, so both statuses get the same what-if tools.
  const simBalance = isActive ? loan.remaining_balance : loan.principal;
  const simMonthsLeft = isActive ? loan.months_left : loan.term_months;

  const downpaymentValue = parseDecimalInput(downpayment);
  const targetPaymentValue = parseDecimalInput(targetPayment);

  const downpaymentScenario =
    !isNaN(downpaymentValue) && downpaymentValue > 0
      ? scenarioDownpayment(simBalance, loan.interest_rate, simMonthsLeft, downpaymentValue)
      : null;

  const newEndDate = downpaymentScenario && !downpaymentScenario.paidOff
    ? endDateFromMonthsLeft(downpaymentScenario.newTermSamePayment)
    : null;
  const monthsSaved = downpaymentScenario && !downpaymentScenario.paidOff
    ? simMonthsLeft - downpaymentScenario.newTermSamePayment
    : null;

  const targetPaymentScenario =
    !isNaN(targetPaymentValue) && targetPaymentValue > 0
      ? scenarioTargetPayment(simBalance, loan.interest_rate, simMonthsLeft, targetPaymentValue)
      : null;

  const newInterestRateValue = parseDecimalInput(newInterestRate);
  const rateChangeScenario =
    !isNaN(newInterestRateValue) && newInterestRateValue >= 0
      ? scenarioRateChange(simBalance, loan.interest_rate, simMonthsLeft, newInterestRateValue)
      : null;

  // Amortization schedule — how each future payment splits into interest vs. principal —
  // only makes sense for active loans, since it walks forward from a real remaining_balance.
  const amortizationYears =
    isActive && loan.remaining_balance > 0 && loan.months_left > 0
      ? groupScheduleByYear(computeAmortizationSchedule(loan.remaining_balance, loan.interest_rate, loan.months_left, loan.monthly_payment))
      : null;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'loans' } })}><FontAwesomeIcon icon={faArrowLeft} /></button>
        <h1 style={{ flex: 1, margin: 0 }}>{loan.name}</h1>
      </div>

      <div className="cycle-toolbar">
        <div className="cycle-toolbar-group" />
        <div className="cycle-toolbar-group">
          <button className="cycle-toolbar-btn btn-secondary" onClick={() => setShowEdit(true)}>
            <FontAwesomeIcon icon={faPencil} /><span className="cycle-toolbar-label">Edit</span>
          </button>
          {!isActive && (
            <button className="cycle-toolbar-btn btn-secondary" onClick={() => setShowPromote(true)}>
              <FontAwesomeIcon icon={faArrowUp} /><span className="cycle-toolbar-label">Promote</span>
            </button>
          )}
          <button className="cycle-toolbar-btn btn-danger" onClick={handleDelete}>
            <FontAwesomeIcon icon={faTrash} /><span className="cycle-toolbar-label">Delete</span>
          </button>
        </div>
      </div>

      {/* Hero: status + rate + monthly payment. Total interest / MTIC are historical
          (from origination) and show for any loan with that data, draft or active.
          Remaining interest is the forward-looking counterpart, active only. */}
      <div className="card card--flat" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span className={`badge badge-${isActive ? 'brand' : 'neutral'}`}>{isActive ? 'Active' : 'Draft'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loan.interest_rate}% {isActive ? 'APR' : 'TAN'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          {loan.total_interest != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total interest (full term)</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-danger-text)' }}>{formatEur(loan.total_interest)}</div>
            </div>
          )}
          {loan.total_amount_payable != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total payable (MTIC)</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{formatEur(loan.total_amount_payable)}</div>
            </div>
          )}
          {isActive && loan.remaining_interest != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remaining interest</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-danger-text)' }}>{formatEur(loan.remaining_interest)}</div>
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Monthly payment</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{formatEur(loan.monthly_payment)}</div>
          </div>
        </div>
      </div>

      {(() => {
        const details = (
          <CollapsibleSection
            title="Loan details"
            icon={faWallet}
            accent="var(--text-muted)"
            collapsed={detailsCollapsed}
            onToggle={() => setDetailsCollapsed((v) => !v)}
          >
            {loan.down_payment != null && (
              <>
                <StatRow label="Purchase price" value={formatEur(loan.purchase_price)} />
                <StatRow label="Down payment" value={formatEur(loan.down_payment)} />
              </>
            )}
            {isActive && loan.principal != null && (
              <StatRow label="Original principal" value={formatEur(loan.principal)} />
            )}
            <StatRow label={isActive ? 'Remaining balance' : 'Principal'} value={formatEur(isActive ? loan.remaining_balance : loan.principal)} />
            {isActive && <StatRow label="End date" value={formatEndDate(loan.end_date)} />}
            <StatRow label={isActive ? 'Months left' : 'Term (months)'} value={formatMonthsWithYears(isActive ? loan.months_left : loan.term_months)} />
            {isActive && loan.term_months != null && (
              <StatRow label="Original term (months)" value={formatMonthsWithYears(loan.term_months)} />
            )}
            {loan.taeg != null && (
              <StatRow label="TAEG (reference only)" value={`${loan.taeg}%`} />
            )}
            {loan.opening_fee != null && (
              <StatRow label="Opening fee" value={formatEur(loan.opening_fee)} />
            )}
            <StatRow label="Salary" value={formatEur(loan.salary)} />
            <StatRow
              label="% of salary"
              value={loan.salary_pct != null ? `${loan.salary_pct.toFixed(1)}%` : '—'}
              valueStyle={{ color: loan.salary_pct != null && loan.salary_pct > 50 ? 'var(--color-danger-text)' : undefined }}
            />
          </CollapsibleSection>
        );

        const scenarios = (
          <>
            <CollapsibleSection
              title="Downpayment scenario"
              icon={faCoins}
              accent="var(--color-brand)"
              collapsed={downpaymentCollapsed}
              onToggle={() => setDownpaymentCollapsed((v) => !v)}
            >
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                See what a lump-sum payment now would do to your loan — either a lower monthly payment for the same term, or the same payment for a shorter term.
              </p>
              <div className="form-group" style={{ maxWidth: 240 }}>
                <label>Downpayment amount (€)</label>
                <input type="text" inputMode="decimal" value={downpayment} onChange={(e) => setDownpayment(e.target.value)} placeholder="0.00" />
              </div>
              {downpaymentScenario && (
                downpaymentScenario.paidOff ? (
                  <div style={{ fontSize: 13.5, marginTop: '0.5rem' }}>
                    This downpayment would pay off the loan entirely — all remaining interest ({formatEur(downpaymentScenario.interestSaved)}) would be saved.
                  </div>
                ) : (
                  <div style={{ marginTop: '0.5rem' }}>
                    <StatRow label="New payment (same term)" value={formatEur(downpaymentScenario.newPaymentSameTerm)} />
                    <StatRow label="New payoff date (same payment)" value={formatEndDate(newEndDate)} />
                    <StatRow
                      label="Time saved"
                      value={formatDuration(monthsSaved)}
                      valueStyle={{ color: 'var(--color-success-text)' }}
                    />
                    <StatRow
                      label="Interest saved (shorter term)"
                      value={formatEur(downpaymentScenario.interestSaved)}
                      valueStyle={{ color: 'var(--color-success-text)' }}
                    />
                  </div>
                )
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Target payment scenario"
              icon={faBullseye}
              accent="var(--color-brand)"
              collapsed={targetCollapsed}
              onToggle={() => setTargetCollapsed((v) => !v)}
            >
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                See how large a lump sum you'd need to bring the monthly payment down to a specific target, over the same remaining term.
              </p>
              <div className="form-group" style={{ maxWidth: 240 }}>
                <label>Target monthly payment (€)</label>
                <input type="text" inputMode="decimal" value={targetPayment} onChange={(e) => setTargetPayment(e.target.value)} placeholder="0.00" />
              </div>
              {targetPaymentScenario && (
                targetPaymentScenario.alreadyMet ? (
                  <div style={{ fontSize: 13.5, marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                    Your current payment already meets or beats this target — no lump sum needed.
                  </div>
                ) : (
                  <div style={{ marginTop: '0.5rem' }}>
                    <StatRow label="Lump sum needed" value={formatEur(targetPaymentScenario.lumpSumNeeded)} />
                  </div>
                )
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Interest rate scenario"
              icon={faPercent}
              accent="var(--color-brand)"
              collapsed={rateCollapsed}
              onToggle={() => setRateCollapsed((v) => !v)}
            >
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                See what a different rate — refinancing, or a variable-rate reset — would do to your payment, keeping the balance and remaining term unchanged.
              </p>
              <div className="form-group" style={{ maxWidth: 240 }}>
                <label>New interest rate (%)</label>
                <input type="text" inputMode="decimal" value={newInterestRate} onChange={(e) => setNewInterestRate(e.target.value)} placeholder="e.g. 2,5" />
              </div>
              {rateChangeScenario && (
                <div style={{ marginTop: '0.5rem' }}>
                  <StatRow label="New payment" value={formatEur(rateChangeScenario.newPayment)} />
                  <StatRow
                    label="Payment change"
                    value={formatSignedEur(rateChangeScenario.paymentDifference)}
                    valueStyle={{ color: rateChangeScenario.paymentDifference > 0 ? 'var(--color-danger-text)' : rateChangeScenario.paymentDifference < 0 ? 'var(--color-success-text)' : undefined }}
                  />
                  <StatRow
                    label="Interest change (remaining term)"
                    value={formatSignedEur(rateChangeScenario.interestDifference)}
                    valueStyle={{ color: rateChangeScenario.interestDifference > 0 ? 'var(--color-danger-text)' : rateChangeScenario.interestDifference < 0 ? 'var(--color-success-text)' : undefined }}
                  />
                </div>
              )}
            </CollapsibleSection>
          </>
        );

        // CycleEditor two-column treatment for every loan, draft or active: scenarios (the
        // primary, most-interacted-with content) take the wider left column; loan facts —
        // plus expense coverage, active only — sit alongside in the right column. Mobile
        // collapses to a single stacked column via the existing .cycle-editor-columns rule.
        return (
          <div className="cycle-editor-columns">
            <div className="cycle-editor-left">
              {scenarios}
            </div>
            <div className="cycle-editor-right">
              {details}
              {isActive && (
                <CollapsibleSection
                  title="Expense coverage"
                  icon={faReceipt}
                  accent={!loan.linked_item ? 'var(--text-muted)' : loan.covered ? 'var(--color-success)' : 'var(--color-danger)'}
                  collapsed={coverageCollapsed}
                  onToggle={() => setCoverageCollapsed((v) => !v)}
                >
                  {!loan.linked_item ? (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                      Not linked to any expense. Edit this loan to link it to a Fixed expense in the monthly template and see whether it's budgeted for.
                    </p>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '4px 12px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: 12,
                          fontWeight: 600,
                          marginBottom: 'var(--space-3)',
                          background: loan.covered ? 'var(--color-success-light)' : 'var(--color-danger-light)',
                          color: loan.covered ? 'var(--color-success-text)' : 'var(--color-danger-text)',
                          border: `1px solid ${loan.covered ? 'var(--color-success-border)' : 'var(--color-danger-border)'}`,
                        }}
                      >
                        {loan.covered
                          ? <><FontAwesomeIcon icon={faCheck} style={{ marginRight: '0.35rem' }} />Covered</>
                          : <><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.35rem' }} />Underbudgeted</>}
                      </div>
                      <StatRow label="Loan payment" value={formatEur(loan.monthly_payment)} />
                      <StatRow label={`Budgeted (${loan.linked_item.name})`} value={formatEur(loan.linked_item.value)} />
                      {!loan.covered && (
                        <StatRow
                          label="Difference"
                          value={formatEur(loan.coverage_difference)}
                          valueStyle={{ color: 'var(--color-danger-text)' }}
                        />
                      )}
                    </>
                  )}
                </CollapsibleSection>
              )}
            </div>
          </div>
        );
      })()}

      {amortizationYears && amortizationYears.length > 0 && (
        <CollapsibleSection
          title="Amortization schedule"
          icon={faTable}
          accent="var(--text-muted)"
          collapsed={scheduleCollapsed}
          onToggle={() => setScheduleCollapsed((v) => !v)}
        >
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            How each future payment splits between interest and principal, grouped by year — click a year to see its individual months.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid var(--border-default)' }}>
            <span style={{ width: 14 }} />
            <span style={{ flex: 1 }}>Year</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Interest</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Principal</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Balance</span>
          </div>
          {amortizationYears.map((y) => {
            const expanded = expandedYears.has(y.year);
            return (
              <div key={y.year} style={{ borderBottom: '1px solid var(--border-default)' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', cursor: 'pointer', fontSize: 13.5 }}
                  onClick={() => toggleYear(y.year)}
                >
                  <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} style={{ fontSize: 11, color: 'var(--text-muted)', width: 14 }} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{y.year}</span>
                  <span style={{ flex: 1, textAlign: 'right', color: 'var(--color-danger-text)', fontVariantNumeric: 'tabular-nums' }}>{formatEur(y.interest)}</span>
                  <span style={{ flex: 1, textAlign: 'right', color: 'var(--color-success-text)', fontVariantNumeric: 'tabular-nums' }}>{formatEur(y.principal)}</span>
                  <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(y.endBalance)}</span>
                </div>
                {expanded && (
                  <div style={{ marginLeft: 22, paddingBottom: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)' }}>
                          <th style={{ textAlign: 'left', fontWeight: 500, padding: '2px 6px' }}>Month</th>
                          <th style={{ textAlign: 'right', fontWeight: 500, padding: '2px 6px' }}>Interest</th>
                          <th style={{ textAlign: 'right', fontWeight: 500, padding: '2px 6px' }}>Principal</th>
                          <th style={{ textAlign: 'right', fontWeight: 500, padding: '2px 6px' }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {y.months.map((m) => (
                          <tr key={`${m.year}-${m.month}`}>
                            <td style={{ padding: '2px 6px' }}>{MONTH_NAMES[m.month - 1]}</td>
                            <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--color-danger-text)', fontVariantNumeric: 'tabular-nums' }}>{formatEur(m.interest)}</td>
                            <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--color-success-text)', fontVariantNumeric: 'tabular-nums' }}>{formatEur(m.principal)}</td>
                            <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(m.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </CollapsibleSection>
      )}

      {showEdit && (
        <LoanFormModal
          dossierId={dossierId}
          loan={loan}
          onSave={(updated) => {
            setLoan(updated);
            setShowEdit(false);
            load();
          }}
          onClose={() => setShowEdit(false)}
        />
      )}
      {showPromote && (
        <PromoteLoanModal
          dossierId={dossierId}
          loan={loan}
          onSave={(updated) => {
            setLoan(updated);
            setShowPromote(false);
            load();
          }}
          onClose={() => setShowPromote(false)}
        />
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <div className="cycle-toolbar-spacer" />
    </div>
  );
}
