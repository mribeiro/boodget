import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDays } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';
import { formatNumber } from '../../utils/numbers';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatEur(value) {
  return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}

// Returns the display name for a cycle stored as (year, month), using the end month.
function cycleDisplayName(year, month, startDay) {
  const end = new Date(year, month, startDay - 1);
  return `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

// "Cycle of " is dropped on mobile (narrower two-column card grid) so the
// title fits on a single line; desktop/tablet has room to keep it.
function cycleTitle(name) {
  return (
    <>
      <span className="cycle-title-prefix">Cycle of </span>
      {name}
    </>
  );
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

export default function CycleGlance({ dossierId, cyclesList, currentCycleDetail, settings, today, onClick }) {
  const navigate = useNavigate();
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
      <GlanceCard title={cycleTitle(cycleDisplayName(prev.year, prev.month, cycleStartDay))} icon={faCalendarDays} color="red" onClick={() => navigate(`/dossiers/${dossierId}/cycles/${prevCycle.id}`)}>
        <p style={msgStyle}>Previous cycle has not been closed yet</p>
      </GlanceCard>
    );
  }

  // Amber: next cycle not opened — only warn once we're in the same calendar month
  // as the current cycle's end date (i.e. not from day 1 of the start month).
  const cycleEndDate = new Date(current.year, current.month, cycleStartDay - 1);
  const inCycleEndMonth =
    today.getFullYear() === cycleEndDate.getFullYear() &&
    today.getMonth() === cycleEndDate.getMonth();
  if (!nextCycle && inCycleEndMonth && todayDay >= nextCycleWarningDay) {
    return (
      <GlanceCard title={cycleTitle(cycleDisplayName(next.year, next.month, cycleStartDay))} icon={faCalendarDays} color="amber" onClick={onClick}>
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

  const title = cycleTitle(cycleDisplayName(current.year, current.month, cycleStartDay));

  if (!currentCycleDetail) {
    return (
      <GlanceCard title={title} icon={faCalendarDays} color="neutral" onClick={() => navigate(`/dossiers/${dossierId}/cycles/${currentCycleMeta.id}`)}>
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

  // Days elapsed in the current cycle, for the progress bar below.
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const cycleStart = new Date(current.year, current.month - 1, cycleStartDay);
  const cycleEnd = new Date(current.year, current.month, cycleStartDay - 1);
  const totalCycleDays = Math.round((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24)) + 1;
  const elapsedDays = Math.min(totalCycleDays, Math.max(1, Math.round((todayMidnight - cycleStart) / (1000 * 60 * 60 * 24)) + 1));
  const cyclePercent = Math.min(100, Math.max(0, (elapsedDays / totalCycleDays) * 100));

  return (
    <GlanceCard title={title} icon={faCalendarDays} color="neutral" onClick={() => navigate(`/dossiers/${dossierId}/cycles/${currentCycleMeta.id}`)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>Balance</span>
        <span className="text-md tabular" style={{ color: balanceColor, whiteSpace: 'nowrap' }}>{formatEur(currentBalance)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>Expected</span>
        <span className="text-sm tabular" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatEur(expectedLeftover)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <div className="progress-track" style={{ flex: 1 }}>
          <div className="progress-fill" style={{ width: `${cyclePercent}%` }} />
        </div>
        <span className="text-xs tabular" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Day {elapsedDays}/{totalCycleDays}</span>
      </div>
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
