import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPencil, faTrash, faCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import { scenarioDownpayment, scenarioTargetPayment } from '../../utils/loanMath';
import LoanFormModal from './LoanFormModal';
import ConfirmModal from '../ConfirmModal';

function formatEur(value) {
  if (value == null || isNaN(value)) return '—';
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
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
  const [confirmState, setConfirmState] = useState(null);

  const [downpayment, setDownpayment] = useState('');
  const [targetPayment, setTargetPayment] = useState('');

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
  const downpaymentValue = parseDecimalInput(downpayment);
  const targetPaymentValue = parseDecimalInput(targetPayment);

  const downpaymentScenario =
    isActive && !isNaN(downpaymentValue) && downpaymentValue > 0
      ? scenarioDownpayment(loan.remaining_balance, loan.interest_rate, loan.months_left, downpaymentValue)
      : null;

  const targetPaymentScenario =
    isActive && !isNaN(targetPaymentValue) && targetPaymentValue > 0
      ? scenarioTargetPayment(loan.remaining_balance, loan.interest_rate, loan.months_left, targetPaymentValue)
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
          <button className="cycle-toolbar-btn btn-danger" onClick={handleDelete}>
            <FontAwesomeIcon icon={faTrash} /><span className="cycle-toolbar-label">Delete</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: '1.5rem' }}>

        {/* Summary card */}
        <div className="card card--flat">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <span className={`badge badge-${isActive ? 'brand' : 'neutral'}`}>
              {isActive ? 'Active' : 'Draft'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loan.interest_rate}% APR</span>
          </div>
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Monthly payment</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{formatEur(loan.monthly_payment)}</div>
          </div>
          <div>
            <StatRow label={isActive ? 'Remaining balance' : 'Principal'} value={formatEur(isActive ? loan.remaining_balance : loan.principal)} />
            <StatRow label={isActive ? 'Months left' : 'Term (months)'} value={isActive ? loan.months_left : loan.term_months} />
            <StatRow label="Salary" value={formatEur(loan.salary)} />
            <StatRow
              label="% of salary"
              value={loan.salary_pct != null ? `${loan.salary_pct.toFixed(1)}%` : '—'}
              valueStyle={{ color: loan.salary_pct != null && loan.salary_pct > 50 ? 'var(--color-danger-text)' : undefined }}
            />
          </div>
        </div>

        {/* Coverage panel — active only */}
        {isActive && (
          <div className="card card--flat">
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem', fontWeight: 600 }}>Expense coverage</h3>
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
          </div>
        )}

        {/* Scenario calculators — active only */}
        {isActive && (
          <>
            <div className="card card--flat">
              <h3 style={{ marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>Downpayment scenario</h3>
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
                    <StatRow label="New term (same payment)" value={`${downpaymentScenario.newTermSamePayment} months`} />
                    <StatRow
                      label="Interest saved (shorter term)"
                      value={formatEur(downpaymentScenario.interestSaved)}
                      valueStyle={{ color: 'var(--color-success-text)' }}
                    />
                  </div>
                )
              )}
            </div>

            <div className="card card--flat">
              <h3 style={{ marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>Target payment scenario</h3>
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
            </div>
          </>
        )}
      </div>

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
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <div className="cycle-toolbar-spacer" />
    </div>
  );
}
