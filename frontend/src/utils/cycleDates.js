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

// The (year, month) of the cycle "today" is in: the stored cycle whose own window
// (actual_start_date–actual_end_date) covers today, so changing the dossier's start-day setting
// later can't point at the wrong cycle (#362). Only when no stored cycle covers today — the
// cycle hasn't been opened yet — does the live-settings prediction decide. Cycles can overlap
// (an "ignore" period move); like the backend, the earliest (year, month) wins.
export function currentCycleYearMonth(today, cycles, cycleStartDay, weekendAdjustment) {
  const iso = toIsoDate(today);
  // A row without stored dates (only seed data has none) falls back to its own start day —
  // never the live setting this is meant to be independent of — defaulting to 25, exactly like
  // the backend's reconstructCycleWindow and the cycle editor.
  const windowOf = (c) => {
    const startDay = c.cycle_start_day ?? 25;
    return {
      start: c.actual_start_date || toIsoDate(new Date(c.year, c.month - 1, startDay)),
      end: c.actual_end_date || toIsoDate(new Date(c.year, c.month, startDay - 1)),
    };
  };
  const covering = [...(cycles || [])]
    .filter((c) => { const w = windowOf(c); return w.start <= iso && iso <= w.end; })
    .sort((a, b) => a.year - b.year || a.month - b.month)[0];
  if (covering) return { year: covering.year, month: covering.month };
  return cycleYearMonth(today, cycleStartDay, weekendAdjustment);
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
