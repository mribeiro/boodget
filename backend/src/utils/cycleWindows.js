// Shared "load every cycle in a dossier and reconstruct its actual
// [start, end] window" step, used by every consumer that needs to resolve
// which existing cycle covers a given date or calendar month (Loans'
// payment-status, Annual Expenses' pull-annual-expenses, Car Expenses' cost
// computation).
//
// Deliberately separate from utils/cycleDates.js, which stays DB-free — see
// migration 042's comment on why a DB-reading helper doesn't belong there.
// This module owns only the DB-reading load step; call-site-specific
// selection logic (e.g. "the cycle whose window contains this due date" vs.
// "the cycle whose actual_end_date falls in this calendar month") stays with
// its caller as a small pure function layered on top.

const { fromIsoDate } = require('./cycleDates');

// Reconstructs a single cycle row's actual [start, end] window, falling back
// to the cycle_start_day-based formula for legacy rows without
// actual_start_date/actual_end_date populated (backfilled for every row by
// migration 039, but the fallback costs nothing and matches every existing
// call site).
function reconstructCycleWindow(cycle) {
  return {
    start: cycle.actual_start_date
      ? fromIsoDate(cycle.actual_start_date)
      : new Date(cycle.year, cycle.month - 1, cycle.cycle_start_day ?? 25),
    end: cycle.actual_end_date
      ? fromIsoDate(cycle.actual_end_date)
      : new Date(cycle.year, cycle.month, (cycle.cycle_start_day ?? 25) - 1),
  };
}

// Loads every cycle in a dossier with its reconstructed actual window
// attached as `start`/`end` Date fields, ordered by (year, month).
function loadCycleWindows(db, dossierId) {
  return db
    .prepare(
      `SELECT id, year, month, is_closed, cycle_start_day, actual_start_date, actual_end_date
       FROM expense_cycles WHERE dossier_id = ? ORDER BY year, month`
    )
    .all(dossierId)
    .map((c) => ({ ...c, ...reconstructCycleWindow(c) }));
}

// Finds the cycle whose window contains a given date. First match wins:
// cycles can genuinely overlap via PATCH /cycles { resolve_overlap: 'ignore' },
// and a date landing exactly on a cycle_start_day belongs to the cycle
// starting that day — the inclusive-start rule annual-expense installments
// also use.
function findCycleContainingDate(cycles, date) {
  return cycles.find((c) => date >= c.start && date <= c.end) ?? null;
}

module.exports = { reconstructCycleWindow, loadCycleWindows, findCycleContainingDate };
