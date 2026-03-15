import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
}

function cycleYearMonth(today, cycleStartDay) {
  const d = today.getDate();
  if (d < cycleStartDay) {
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { year: next.getFullYear(), month: next.getMonth() + 1 };
}

function getExpenseDate(cycleYear, cycleMonth, dayOfPayment, cycleStartDay) {
  if (dayOfPayment >= cycleStartDay) {
    return new Date(cycleYear, cycleMonth - 2, dayOfPayment);
  }
  return new Date(cycleYear, cycleMonth - 1, dayOfPayment);
}

function sortByCycleDay(items, cycleStartDay) {
  return [...items].sort((a, b) => {
    const aDay = a.day_of_payment ?? 0;
    const bDay = b.day_of_payment ?? 0;
    const aLate = aDay < cycleStartDay ? 1 : 0;
    const bLate = bDay < cycleStartDay ? 1 : 0;
    if (aLate !== bLate) return aLate - bLate;
    return aDay - bDay;
  });
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
  const fixedExpenses = items.filter((i) => i.section === 'expense' && i.type === 'Fixed');
  const unpaid = fixedExpenses.filter((i) => !i.paid);

  if (unpaid.length === 0) {
    return (
      <GlanceCard title="Next Expense" icon={faCircleCheck} color="neutral" onClick={onClick}>
        <p style={msgStyle}>All fixed expenses paid</p>
      </GlanceCard>
    );
  }

  const sorted = sortByCycleDay(unpaid, cycleStartDay);
  const next = sorted[0];

  const expenseDate = next.day_of_payment != null
    ? getExpenseDate(current.year, current.month, next.day_of_payment, cycleStartDay)
    : null;

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let whenLabel = '';
  let color = 'neutral';
  let whenColor = 'var(--text-secondary)';

  if (expenseDate) {
    const diffDays = Math.round((expenseDate - todayMidnight) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      whenLabel = `Today (day ${next.day_of_payment})`;
    } else if (diffDays < 0) {
      whenLabel = `Overdue (day ${next.day_of_payment})`;
      color = 'amber';
      whenColor = 'var(--color-warning-text)';
    } else {
      whenLabel = `in ${diffDays} day${diffDays === 1 ? '' : 's'} (day ${next.day_of_payment})`;
    }
  }

  return (
    <GlanceCard title="Next Expense" icon={faClock} color={color} onClick={onClick}>
      <div className="text-base" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {next.name}
      </div>
      <div className="text-sm tabular" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
        {formatEur(next.value || 0)}
        {whenLabel && (
          <span style={{ color: whenColor, marginLeft: 6 }}>· {whenLabel}</span>
        )}
      </div>
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
