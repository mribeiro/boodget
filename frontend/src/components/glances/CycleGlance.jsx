import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDays } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

function prevYearMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function nextYearMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export default function CycleGlance({ cyclesList, currentCycleDetail, settings, today, onClick }) {
  const cycleStartDay = settings.cycle_start_day ?? 25;
  const nextCycleWarningDay = settings.next_cycle_warning_day ?? 22;
  const prevCloseWarningDay = settings.previous_cycle_close_warning_day ?? 25;
  const todayDay = today.getDate();

  const current = cycleYearMonth(today, cycleStartDay);
  const prev = prevYearMonth(current.year, current.month);
  const next = nextYearMonth(current.year, current.month);

  const currentCycleMeta = cyclesList.find((c) => c.year === current.year && c.month === current.month);
  const prevCycle = cyclesList.find((c) => c.year === prev.year && c.month === prev.month);
  const nextCycle = cyclesList.find((c) => c.year === next.year && c.month === next.month);

  // Red: previous cycle not closed
  if (prevCycle && !prevCycle.is_closed && todayDay >= prevCloseWarningDay) {
    return (
      <GlanceCard title={`Cycle of ${MONTH_NAMES[prev.month - 1]} ${prev.year}`} icon={faCalendarDays} color="red" onClick={onClick}>
        <p style={msgStyle}>Previous cycle has not been closed yet</p>
      </GlanceCard>
    );
  }

  // Amber: next cycle not opened
  if (!nextCycle && todayDay >= nextCycleWarningDay) {
    return (
      <GlanceCard title={`Cycle of ${MONTH_NAMES[next.month - 1]} ${next.year}`} icon={faCalendarDays} color="amber" onClick={onClick}>
        <p style={msgStyle}>Next cycle has not been opened yet</p>
      </GlanceCard>
    );
  }

  // No current cycle
  if (!currentCycleMeta) {
    return (
      <GlanceCard title="Current Cycle" icon={faCalendarDays} color="amber" onClick={onClick}>
        <p style={msgStyle}>No cycle is currently open</p>
      </GlanceCard>
    );
  }

  const title = `Cycle of ${MONTH_NAMES[current.month - 1]} ${current.year}`;

  if (!currentCycleDetail) {
    return (
      <GlanceCard title={title} icon={faCalendarDays} color="neutral" onClick={onClick}>
        <p style={{ ...msgStyle, fontStyle: 'italic' }}>Loading…</p>
      </GlanceCard>
    );
  }

  const items = currentCycleDetail.items ?? [];
  const expenses = items.filter((i) => i.section === 'expense');
  const distributions = items.filter((i) => i.section === 'distribution');
  const fixedExpenses = expenses.filter((i) => i.type === 'Fixed');
  const budgetExpenses = expenses.filter((i) => i.type === 'Budget');

  const totalAvailable = (currentCycleDetail.salary || 0) + (currentCycleDetail.previous_balance || 0);
  const totalExpenses =
    fixedExpenses.reduce((s, i) => s + (i.value || 0), 0) +
    budgetExpenses.reduce((s, i) => s + (i.value || 0), 0);
  const totalDistributions = distributions.reduce((s, i) => s + (i.value || 0), 0);
  const expectedLeftover = totalAvailable - totalExpenses - totalDistributions;

  const paidExpenses =
    fixedExpenses.filter((i) => i.paid).reduce((s, i) => s + (i.value || 0), 0) +
    budgetExpenses.reduce((s, i) => s + (i.spent || 0), 0);
  const doneDistributions = distributions.filter((i) => i.done).reduce((s, i) => s + (i.value || 0), 0);
  const currentBalance = totalAvailable - paidExpenses - doneDistributions;

  const balanceColor = currentBalance < 0 ? 'var(--color-value-negative)' : 'var(--text-primary)';

  return (
    <GlanceCard title={title} icon={faCalendarDays} color="neutral" onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Balance</span>
        <span className="text-md tabular" style={{ color: balanceColor }}>{formatEur(currentBalance)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Expected</span>
        <span className="text-sm tabular" style={{ color: 'var(--text-secondary)' }}>{formatEur(expectedLeftover)}</span>
      </div>
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
