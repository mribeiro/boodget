// Cycle start/end date math — mirrors backend/src/utils/cycleDates.js. Centralizes what
// used to be duplicated `cycleLabel`/`cycleDateRange`/`cycleYearMonth` implementations
// across CycleList.jsx, CycleEditor.jsx, GlancesPanel.jsx, and CycleGlance.jsx.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Shifts a date off a weekend per the configured mode. Weekdays (and 'none') are
// returned unchanged.
export function applyWeekendAdjustment(date, mode) {
  if (mode !== 'previous_friday' && mode !== 'next_monday') return date;
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  if (day !== 0 && day !== 6) return date;

  if (mode === 'previous_friday') {
    return addDays(date, day === 6 ? -1 : -2);
  }
  return addDays(date, day === 6 ? 2 : 1);
}

export function computeCycleStartDate(year, month, startDay, mode) {
  return applyWeekendAdjustment(new Date(year, month - 1, startDay), mode);
}

// Best-effort prediction of a cycle's end date, before any real next-cycle exists to
// sync against — one day before what the following cycle's (weekend-adjusted) start
// would be under the same settings.
export function computeTheoreticalCycleEndDate(year, month, startDay, mode) {
  const nextStart = computeCycleStartDate(year, month + 1, startDay, mode);
  return addDays(nextStart, -1);
}

// Which (year, month) cycle "today" belongs to, given the dossier's live settings.
// Forward-looking — the cycle may not exist yet — so it always uses live settings,
// never a specific cycle's own stored/snapshotted values.
export function cycleYearMonth(today, cycleStartDay, weekendAdjustment) {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const thisMonthStart = computeCycleStartDate(year, month, cycleStartDay, weekendAdjustment);
  if (today >= thisMonthStart) return { year, month };
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextYearMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function prevYearMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// Display name is the month/year of the cycle's END date.
export function formatCycleLabel(endDate) {
  return `${MONTH_NAMES[endDate.getMonth()]} ${endDate.getFullYear()}`;
}

export function formatDateRange(startDate, endDate) {
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Parses a 'YYYY-MM-DD' string into a local-midnight Date, avoiding the UTC
// interpretation `new Date('YYYY-MM-DD')` would otherwise apply.
export function fromIsoDate(isoString) {
  const [y, m, d] = isoString.split('-').map(Number);
  return new Date(y, m - 1, d);
}
