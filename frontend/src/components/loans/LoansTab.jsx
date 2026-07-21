import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faCheck, faTriangleExclamation, faCoins } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { formatNumber } from '../../utils/numbers';
import LoanFormModal from './LoanFormModal';
import KpiStrip from '../ui/KpiStrip';

function formatEur(value) {
  if (value == null) return '—';
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

function CoveragePill({ loan }) {
  if (loan.status !== 'active' || !loan.linked_item) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '2px 10px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11,
        fontWeight: 600,
        background: loan.covered ? 'var(--color-success-light)' : 'var(--color-danger-light)',
        color: loan.covered ? 'var(--color-success-text)' : 'var(--color-danger-text)',
        border: `1px solid ${loan.covered ? 'var(--color-success-border)' : 'var(--color-danger-border)'}`,
      }}
    >
      {loan.covered ? (
        <><FontAwesomeIcon icon={faCheck} style={{ fontSize: 9 }} />Covered</>
      ) : (
        <><FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize: 9 }} />Underbudgeted −{formatEur(Math.abs(loan.coverage_difference))}</>
      )}
    </span>
  );
}

export default function LoansTab({ dossierId }) {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [maxSalaryPct, setMaxSalaryPct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    loadLoans();
    api.getDossierSettings(dossierId).then((s) => setMaxSalaryPct(s.loans_max_salary_pct)).catch(() => {});
  }, [dossierId]);

  async function loadLoans() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getLoans(dossierId);
      setLoans(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLoanCreated(newLoan) {
    setLoans((prev) => [...prev, newLoan]);
    setShowCreate(false);
    navigate(`/dossiers/${dossierId}/loans/${newLoan.id}`);
  }

  if (loading) return <div className="loading">Loading…</div>;

  const activeLoans = loans.filter((l) => l.status === 'active');
  const totalMonthlyAmount = activeLoans.reduce((sum, l) => sum + (l.monthly_payment || 0), 0);
  const totalAmountDue = activeLoans.reduce((sum, l) => sum + (l.remaining_balance || 0), 0);
  const referenceSalary = loans.find((l) => l.reference_salary != null)?.reference_salary ?? null;
  const totalSalaryPct = referenceSalary > 0 ? (totalMonthlyAmount / referenceSalary) * 100 : null;

  // Traffic-light against the configured max % of salary for loans: red once at or over the
  // max, yellow within the last 2 percentage points below it, green otherwise. No highlight
  // if the max hasn't been configured (Dossier Settings → Loan Settings) — nothing to compare against.
  const maxSalaryAbsolute = maxSalaryPct != null && referenceSalary > 0 ? (maxSalaryPct / 100) * referenceSalary : null;
  const pctHighlight =
    maxSalaryPct == null || totalSalaryPct == null
      ? 'neutral'
      : totalSalaryPct >= maxSalaryPct
        ? 'danger'
        : totalSalaryPct >= maxSalaryPct - 2
          ? 'warning'
          : 'success';
  const freeRoom = maxSalaryAbsolute != null ? maxSalaryAbsolute - totalMonthlyAmount : null;
  const pctNote =
    maxSalaryPct != null && totalSalaryPct != null
      ? `${formatEur(totalMonthlyAmount)} of ${formatEur(maxSalaryAbsolute)} max · ${
          freeRoom >= 0 ? `${formatEur(freeRoom)} free` : `${formatEur(Math.abs(freeRoom))} over`
        }`
      : undefined;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

      <div className="section-header" style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ margin: 0 }}>Loans</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />New loan
        </button>
      </div>

      {loans.length > 0 && (
        <KpiStrip defaultOpen style={{ marginBottom: 'var(--space-5)' }} items={[
          { label: 'Monthly total', value: formatEur(totalMonthlyAmount), large: true },
          { label: 'Total amount due', value: formatEur(totalAmountDue) },
          { label: 'Loans ongoing', value: String(activeLoans.length) },
          {
            label: '% of salary',
            value: totalSalaryPct != null ? `${totalSalaryPct.toFixed(1)}%` : '—',
            highlight: pctHighlight,
            note: pctNote,
          },
        ]} />
      )}

      {loans.length === 0 ? (
        <div className="empty-state">
          <p>No loans yet. Add a draft to study a what-if, or an active loan to track a real one.</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            New loan
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {loans.map((loan) => (
            <div
              key={loan.id}
              className="card card--clickable"
              style={{ padding: 'var(--space-4)' }}
              onClick={() => navigate(`/dossiers/${dossierId}/loans/${loan.id}`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{loan.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {loan.interest_rate}% {loan.status === 'active' ? 'APR' : 'TAN'}
                </span>
                <span style={{ flex: 1 }} />
                <span className={`badge badge-${loan.status === 'active' ? 'brand' : 'neutral'}`}>
                  {loan.status === 'active' ? 'Active' : 'Draft'}
                </span>
                {loan.is_matured && (
                  <span className="badge badge-danger">
                    <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.3rem' }} />Matured
                  </span>
                )}
                <CoveragePill loan={loan} />
              </div>

              {/* Fixed-height stats row: nowrap + horizontal scroll instead of wrapping, so
                  a wide value (e.g. a 5-digit down payment) never grows the card — it scrolls
                  sideways on narrow viewports instead. Interest rate lives next to the name
                  above, so this row rarely needs to scroll in practice. */}
              <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'nowrap', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                <span className="tabular" style={{ flexShrink: 0 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatEur(loan.monthly_payment)}</strong>/mo
                </span>
                {loan.down_payment != null && (
                  <span className="tabular" title="Down payment" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <FontAwesomeIcon icon={faCoins} style={{ fontSize: 10, color: 'var(--text-muted)' }} />
                    <strong style={{ color: 'var(--text-primary)' }}>{formatEur(loan.down_payment)}</strong>
                  </span>
                )}
                <span className="tabular" style={{ flexShrink: 0 }}>
                  % of salary: {loan.salary_pct != null ? `${loan.salary_pct.toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <LoanFormModal
          dossierId={dossierId}
          loan={null}
          onSave={handleLoanCreated}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
