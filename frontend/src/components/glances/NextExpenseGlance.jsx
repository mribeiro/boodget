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

// Returns actual Date for a day_of_payment within a given cycle (year M, month M).
// Cycle for month M: cycleStartDay of M-1 → cycleStartDay-1 of M.
function getExpenseDate(cycleYear, cycleMonth, dayOfPayment, cycleStartDay) {
  if (dayOfPayment >= cycleStartDay) {
    // Falls in month M-1 (previous calendar month)
    return new Date(cycleYear, cycleMonth - 2, dayOfPayment);
  }
  // Falls in month M
  return new Date(cycleYear, cycleMonth - 1, dayOfPayment);
}

// Sort fixed expenses by cycle day: days >= cycleStartDay first (asc), then < cycleStartDay (asc)
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
      <GlanceCard title="Next Expense" color="neutral" onClick={onClick}>
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
      <GlanceCard title="Next Expense" color="neutral" onClick={onClick}>
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

  if (expenseDate) {
    const diffDays = Math.round((expenseDate - todayMidnight) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      whenLabel = `Today (day ${next.day_of_payment})`;
    } else if (diffDays < 0) {
      whenLabel = `Overdue (day ${next.day_of_payment})`;
      color = 'amber';
    } else {
      whenLabel = `in ${diffDays} day${diffDays === 1 ? '' : 's'} (day ${next.day_of_payment})`;
    }
  }

  return (
    <GlanceCard title="Next Expense" color={color} onClick={onClick}>
      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {next.name}
      </div>
      <div style={{ fontSize: '0.8rem', marginBottom: '0.1rem' }}>
        {formatEur(next.value || 0)}
      </div>
      {whenLabel && (
        <div style={{ fontSize: '0.75rem', color: color === 'amber' ? '#b45309' : 'var(--color-text-muted)' }}>
          {whenLabel}
        </div>
      )}
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' };
