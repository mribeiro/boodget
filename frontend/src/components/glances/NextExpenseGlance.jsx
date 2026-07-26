import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';
import { formatNumber } from '../../utils/numbers';
import { fromIsoDate } from '../../utils/cycleDates';

function formatEur(value) {
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// A payment day-of-month can fall in the cycle's start month or the following month —
// pick whichever calendar date actually lands inside the cycle's (possibly
// weekend-shifted) real window, falling back to the day-of-month threshold heuristic
// when neither candidate lands inside it (e.g. no actual_start_date/end_date yet).
function getExpenseDate(cycleYear, cycleMonth, dayOfPayment, cycleStartDay, cycleWindowStart, cycleWindowEnd) {
  const candidateThisMonth = new Date(cycleYear, cycleMonth - 1, dayOfPayment);
  const candidateNextMonth = new Date(cycleYear, cycleMonth, dayOfPayment);
  if (cycleWindowStart && cycleWindowEnd) {
    if (candidateThisMonth >= cycleWindowStart && candidateThisMonth <= cycleWindowEnd) return candidateThisMonth;
    if (candidateNextMonth >= cycleWindowStart && candidateNextMonth <= cycleWindowEnd) return candidateNextMonth;
  }
  return dayOfPayment >= cycleStartDay ? candidateThisMonth : candidateNextMonth;
}

function getAnnualPaymentDate(payment) {
  // annual payments have expense_year, month, day as the installment's calendar date
  return new Date(payment.expense_year, payment.month - 1, payment.day);
}

function relativeDayLabel(diffDays) {
  if (diffDays === 0) return 'Today';
  if (diffDays < 0) return 'Overdue';
  return `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

export default function NextExpenseGlance({ currentCycleDetail, settings, today, onClick, onMarkPaid }) {
  const cycleStartDay = settings.cycle_start_day ?? 25;

  if (!currentCycleDetail) {
    return (
      <GlanceCard title="Next Expense" icon={faClock} color="neutral" onClick={onClick}>
        <p style={msgStyle}>No cycle in progress</p>
      </GlanceCard>
    );
  }

  // The cycle's own stored dates are used for its date math (not the dossier's
  // current setting), so a later change to that setting doesn't reshape this cycle.
  const activeCycleStartDay = currentCycleDetail.cycle_start_day ?? cycleStartDay;
  const cycleWindowStart = currentCycleDetail.actual_start_date ? fromIsoDate(currentCycleDetail.actual_start_date) : null;
  const cycleWindowEnd = currentCycleDetail.actual_end_date ? fromIsoDate(currentCycleDetail.actual_end_date) : null;
  const current = { year: currentCycleDetail.year, month: currentCycleDetail.month };
  const items = currentCycleDetail.items ?? [];
  const annualPayments = currentCycleDetail.annual_payments ?? [];

  const fixedExpenses = items.filter((i) => i.section === 'expense' && i.type === 'Fixed');
  const unpaidFixed = fixedExpenses.filter((i) => !i.paid);
  const unpaidAnnual = annualPayments.filter((p) => !p.paid);

  const allPaid = unpaidFixed.length === 0 && unpaidAnnual.length === 0;
  if (allPaid) {
    return (
      <GlanceCard title="Next Expense" icon={faCircleCheck} color="neutral" onClick={onClick}>
        <p style={msgStyle}>All fixed expenses paid</p>
      </GlanceCard>
    );
  }

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Build unified list of unpaid items with their dates
  const candidates = [];

  for (const exp of unpaidFixed) {
    if (exp.day_of_payment != null) {
      candidates.push({
        type: 'monthly',
        name: exp.name,
        value: exp.value || 0,
        date: getExpenseDate(current.year, current.month, exp.day_of_payment, activeCycleStartDay, cycleWindowStart, cycleWindowEnd),
        day: exp.day_of_payment,
        item: exp,
      });
    }
  }

  for (const p of unpaidAnnual) {
    candidates.push({
      type: 'annual',
      name: p.name,
      // unpaidAnnual is filtered to `!p.paid` above, so real_value (only meaningful once paid) is
      // never the right figure here — always show the budgeted amount for a still-unpaid installment.
      value: p.budgeted_value,
      date: getAnnualPaymentDate(p),
      day: p.day,
      installmentNumber: p.installment_number,
      numInstallments: p.num_installments,
      item: p,
    });
  }

  if (candidates.length === 0) {
    return (
      <GlanceCard title="Next Expense" icon={faCircleCheck} color="neutral" onClick={onClick}>
        <p style={msgStyle}>All fixed expenses paid</p>
      </GlanceCard>
    );
  }

  // Sort by date chronologically
  candidates.sort((a, b) => a.date - b.date);
  const next = candidates[0];

  const diffDays = Math.round((next.date - todayMidnight) / (1000 * 60 * 60 * 24));
  let whenLabel = '';
  let dateSuffix = null; // only set for the upcoming case; hidden on mobile (CSS) to avoid overflow
  let color = 'neutral';
  let whenColor = 'var(--text-secondary)';

  const monthName = next.date.toLocaleString('default', { month: 'short' });
  const dayLabel = `${monthName} ${next.day}`;

  if (diffDays === 0) {
    whenLabel = `Today (${dayLabel})`;
  } else if (diffDays < 0) {
    whenLabel = dayLabel;
    color = 'amber';
    whenColor = 'var(--color-warning-text)';
  } else {
    whenLabel = `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
    dateSuffix = ` (${dayLabel})`;
  }

  const isOverdue = diffDays < 0;
  const next2 = candidates[1] ?? null;
  const next2Diff = next2 ? Math.round((next2.date - todayMidnight) / (1000 * 60 * 60 * 24)) : null;
  const [marking, setMarking] = useState(false);

  async function handleMarkPaid(e) {
    e.stopPropagation();
    if (!onMarkPaid || marking) return;
    setMarking(true);
    try {
      await onMarkPaid(next);
    } finally {
      setMarking(false);
    }
  }

  return (
    <GlanceCard title="Next Expense" icon={faClock} color={color} onClick={onClick}>
      <div className="text-base" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {next.name}
        {next.type === 'annual' && (
          <>
            <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--text-muted)' }}>
              ({next.installmentNumber}/{next.numInstallments})
            </span>
            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-full)', background: 'var(--surface-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border-default)', verticalAlign: 'middle' }}>
              Annual
            </span>
          </>
        )}
      </div>
      <div className="text-sm tabular" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', marginTop: 2 }}>
        <span style={{ whiteSpace: 'nowrap' }}>{formatEur(next.value)}</span>
        {whenLabel && (
          <span style={{ color: whenColor, whiteSpace: 'nowrap' }}>
            · {whenLabel}
            {dateSuffix && <span className="next-expense-date-suffix">{dateSuffix}</span>}
          </span>
        )}
      </div>
      {!isOverdue && next2 && (
        <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {next2.name} · {relativeDayLabel(next2Diff)}
        </div>
      )}
      {isOverdue && onMarkPaid && (
        <button
          onClick={handleMarkPaid}
          disabled={marking}
          style={{
            alignSelf: 'flex-start',
            padding: '1px 7px',
            fontSize: 11,
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-default)',
            background: 'var(--surface-secondary)',
            color: 'var(--text-secondary)',
            cursor: marking ? 'default' : 'pointer',
            opacity: marking ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {marking ? 'Marking…' : 'Mark as paid'}
        </button>
      )}
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
