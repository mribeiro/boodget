// Shared helpers for computing a cycle's actual (weekend-adjusted) start/end
// dates. All dates are plain JS Date objects constructed from local
// year/month/day components, matching the rest of the codebase's convention
// (new Date(year, month - 1, day)).

const WEEKEND_ADJUSTMENTS = ['none', 'previous_friday', 'next_monday'];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Shifts a date off a weekend per the configured mode. Weekdays (and 'none')
// are returned unchanged.
function applyWeekendAdjustment(date, mode) {
  if (mode !== 'previous_friday' && mode !== 'next_monday') return date;
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  if (day !== 0 && day !== 6) return date;

  if (mode === 'previous_friday') {
    return addDays(date, day === 6 ? -1 : -2);
  }
  // next_monday
  return addDays(date, day === 6 ? 2 : 1);
}

function computeCycleStartDate(year, month, startDay, mode) {
  return applyWeekendAdjustment(new Date(year, month - 1, startDay), mode);
}

// Best-effort prediction of a cycle's end date, before any actual next-cycle
// row exists to sync against: one day before what the following cycle's
// (weekend-adjusted) start would be under the same settings.
function computeTheoreticalCycleEndDate(year, month, startDay, mode) {
  const nextStart = computeCycleStartDate(year, month + 1, startDay, mode);
  return addDays(nextStart, -1);
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Parses a 'YYYY-MM-DD' string into a local-midnight Date, avoiding the UTC
// interpretation `new Date('YYYY-MM-DD')` would otherwise apply.
function fromIsoDate(isoString) {
  const [y, m, d] = isoString.split('-').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = {
  WEEKEND_ADJUSTMENTS,
  addDays,
  applyWeekendAdjustment,
  computeCycleStartDate,
  computeTheoreticalCycleEndDate,
  toIsoDate,
  fromIsoDate,
};
