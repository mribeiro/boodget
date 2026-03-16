import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
}

function cycleYearMonth(today, cycleStartDay) {
  const d = today.getDate();
  if (d >= cycleStartDay) {
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
}

function getExpenseDate(cycleYear, cycleMonth, dayOfPayment, cycleStartDay) {
  if (dayOfPayment >= cycleStartDay) {
    return new Date(cycleYear, cycleMonth - 1, dayOfPayment);
  }
  return new Date(cycleYear, cycleMonth, dayOfPayment);
}

function getAnnualPaymentDate(payment) {
  // annual payments have expense_year, month, day as the installment's calendar date
  return new Date(payment.expense_year, payment.month - 1, payment.day);
}

export default function NextExpenseGlance({ currentCycleDetail, settings, today, onClick }) {
  const cycleStartDay = settings.cycle_start_day ?? 25;

  if (!currentCycleDetail) {
    return (
      <GlanceCard title="Next Expense" icon={faClock} color="neutral" onClick={onClick}>
        <p style={msgStyle}>No cycle in progress</p>
      </GlanceCard>
    );
  }

  const current = cycleYearMonth(today, cycleStartDay);
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
        date: getExpenseDate(current.year, current.month, exp.day_of_payment, cycleStartDay),
        day: exp.day_of_payment,
        item: exp,
      });
    }
  }

  for (const p of unpaidAnnual) {
    candidates.push({
      type: 'annual',
      name: p.name,
      value: p.real_value ?? (p.budgeted_value / (p.num_installments || 1)),
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
  let color = 'neutral';
  let whenColor = 'var(--text-secondary)';

  const monthName = next.date.toLocaleString('default', { month: 'short' });
  const dayLabel = `${monthName} ${next.day}`;

  if (diffDays === 0) {
    whenLabel = `Today (${dayLabel})`;
  } else if (diffDays < 0) {
    whenLabel = `Overdue (${dayLabel})`;
    color = 'amber';
    whenColor = 'var(--color-warning-text)';
  } else {
    whenLabel = `in ${diffDays} day${diffDays === 1 ? '' : 's'} (${dayLabel})`;
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
      <div className="text-sm tabular" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
        {formatEur(next.value)}
        {whenLabel && (
          <span style={{ color: whenColor, marginLeft: 6 }}>· {whenLabel}</span>
        )}
      </div>
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
