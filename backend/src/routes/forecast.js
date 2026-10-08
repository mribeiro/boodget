const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { computeCycleStartDate, computeTheoreticalCycleEndDate, toIsoDate } = require('../utils/cycleDates');
const { loadCycleWindows, findCycleContainingDate } = require('../utils/cycleWindows');
const { computeLoanValues, daysInMonth } = require('./loans');

// Cash-flow forecast (#349): the next N expense cycles projected forward, read-only and
// computed on the fly — nothing here is stored. Two tracks:
// - the cycle track (main account): each cycle opens with the previous one's projected
//   closing and closes at opening + income − expenses − distributions;
// - the annual fund track: the contributing accounts' latest balance, plus the
//   contributing distributions each cycle, minus the annual installments due in it.
// The current cycle (and any later one already opened) uses its real items; cycles not
// opened yet use the template, dated with the dossier's live settings (a forward-looking
// prediction, which CLAUDE.md allows for cycles that don't exist yet).

const MAX_HORIZON = 24;
const HORIZONS = [6, 12, 24];

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db.prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?').get(dossierId, userId);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const round2 = (n) => Math.round(n * 100) / 100;

// A cycle is named after the month it ends in.
function cycleName(end) {
  return `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

// The date of a loan's last scheduled payment: its end_date month, on day_of_payment
// (clamped to that month's length). null when the loan has no end date.
function loanLastDueDate(loan) {
  if (!loan.end_date) return null;
  const [y, m] = loan.end_date.split('-').map(Number);
  const day = Math.min(loan.day_of_payment || 1, daysInMonth(y, m));
  return new Date(y, m - 1, day);
}

// Budget item amount for a projected cycle: its max ("planned"), or its usual spending —
// the average `spent` over recent closed cycles — when there's history for it ("usual").
// In a cycle that's already running, never less than what's already been spent.
function budgetAmount(item, budgetMode, averages) {
  let amount = item.value || 0;
  if (budgetMode === 'usual') {
    const avg = averages[item.template_item_id ?? ''] ?? averages[`name:${item.name}`];
    if (avg != null) amount = avg;
  }
  return Math.max(amount, item.spent || 0);
}

/**
 * Pure projection — no DB. `inputs` comes from loadForecastInputs (or a test):
 * - windows[]: { start, end (Dates), stored: null | { previous_balance, income_total, items[] } },
 *   first one = the current cycle, in order; at least `horizon` of them.
 * - opening_balance: the first cycle's opening when it isn't stored (not opened yet).
 * - template: { income_total, expenses[{id,name,type,value}], distributions[{id,name,value}] }
 * - budget_averages: { [templateItemId] | ['name:'+name]: avg spent }
 * - loans[]: { id, name, status, monthly_payment, expense_template_item_id, last_due_date, is_matured }
 * - installments[]: { date, name, amount } — unpaid annual installments
 * - fund: null (not configured) | { opening, distribution_ids[] }
 */
function computeForecast(inputs, { horizon = 12, budgetMode = 'planned', includeDraftLoanIds = [] } = {}) {
  const windows = inputs.windows.slice(0, horizon);
  const loans = inputs.loans || [];
  const fundIds = new Set(inputs.fund?.distribution_ids || []);
  const linkedLoanItem = new Map(
    loans.filter((l) => l.status === 'active' && l.expense_template_item_id && l.last_due_date)
      .map((l) => [l.expense_template_item_id, l])
  );
  const untracked = loans.filter((l) => l.status === 'active' && !l.expense_template_item_id && !l.is_matured);
  const drafts = loans.filter((l) => l.status === 'draft' && includeDraftLoanIds.includes(l.id));

  const cycles = [];
  const flags = [];
  let opening = inputs.opening_balance || 0;
  let fundBalance = inputs.fund ? inputs.fund.opening : null;
  let fundShortfallFlagged = false;

  windows.forEach((w, index) => {
    const events = [];
    const stored = w.stored;
    if (stored && index === 0) opening = stored.previous_balance || 0;

    // Items: the stored cycle's own, or the template's — minus loan-linked items whose loan
    // has already ended by this cycle (they're in the template but won't be due any more).
    const items = stored
      ? stored.items
      : [
          ...inputs.template.expenses.map((t) => ({ ...t, section: 'expense', template_item_id: t.id })),
          ...inputs.template.distributions.map((t) => ({ ...t, section: 'distribution', template_item_id: t.id })),
        ].filter((it) => {
          const loan = linkedLoanItem.get(it.template_item_id);
          return !loan || w.start <= loan.last_due_date;
        });

    const income = stored ? stored.income_total || 0 : inputs.template.income_total || 0;
    let expenses = 0;
    let distributions = 0;
    let fundIn = 0;
    for (const it of items) {
      if (it.section === 'expense') {
        expenses += it.type === 'Budget' ? budgetAmount(it, budgetMode, inputs.budget_averages || {}) : it.value || 0;
      } else {
        distributions += it.value || 0;
        // A contributing distribution feeds the annual fund — unless it's already done in a
        // running cycle, in which case it's already in the accounts' balance.
        if (fundIds.has(it.template_item_id) && !it.done) fundIn += it.value || 0;
      }
    }

    // Loans that aren't in any cycle's items: an active loan with no linked expense
    // ("not tracked"), and draft loans the user chose to include as a what-if.
    for (const loan of untracked) {
      if (!loan.last_due_date || w.start <= loan.last_due_date) {
        expenses += loan.monthly_payment || 0;
        events.push({ type: 'untracked_loan_payment', loan_id: loan.id, name: loan.name, amount: round2(loan.monthly_payment || 0) });
      }
    }
    for (const loan of drafts) {
      expenses += loan.monthly_payment || 0;
      events.push({ type: 'draft_loan_payment', loan_id: loan.id, name: loan.name, amount: round2(loan.monthly_payment || 0) });
    }
    // A linked loan's last payment falls in this cycle: from the next cycle on, its expense
    // drops out of the template.
    for (const loan of linkedLoanItem.values()) {
      if (loan.last_due_date >= w.start && loan.last_due_date <= w.end) {
        events.push({ type: 'loan_ends', loan_id: loan.id, name: loan.name, amount: round2(loan.monthly_payment || 0), date: toIsoDate(loan.last_due_date) });
      }
    }
    for (const loan of untracked) {
      if (loan.last_due_date && loan.last_due_date >= w.start && loan.last_due_date <= w.end) {
        events.push({ type: 'loan_ends', loan_id: loan.id, name: loan.name, amount: round2(loan.monthly_payment || 0), date: toIsoDate(loan.last_due_date) });
      }
    }

    const closing = opening + income - expenses - distributions;

    // Annual fund: installments due inside this cycle's window are paid from it.
    const due = (inputs.installments || [])
      .filter((i) => i.date >= w.start && i.date <= w.end)
      .sort((a, b) => a.date - b.date);
    let annualFund = null;
    if (fundBalance != null) {
      const fundOpening = fundBalance;
      let running = fundOpening + fundIn;
      const out = [];
      for (const inst of due) {
        running -= inst.amount;
        out.push({ name: inst.name, amount: round2(inst.amount), date: toIsoDate(inst.date) });
        if (running < -0.005 && !fundShortfallFlagged) {
          fundShortfallFlagged = true;
          flags.push({
            type: 'fund_shortfall', cycle_index: index, cycle: cycleName(w.end),
            name: inst.name, amount: round2(inst.amount), date: toIsoDate(inst.date), short_by: round2(-running),
          });
        }
      }
      annualFund = { opening: round2(fundOpening), in: round2(fundIn), out, closing: round2(running) };
      fundBalance = running;
    }
    for (const inst of due) {
      events.push({ type: 'installment_due', name: inst.name, amount: round2(inst.amount), date: toIsoDate(inst.date) });
    }

    cycles.push({
      name: cycleName(w.end),
      start: toIsoDate(w.start),
      end: toIsoDate(w.end),
      source: stored ? 'cycle' : 'template',
      opening: round2(opening),
      income: round2(income),
      expenses: round2(expenses),
      distributions: round2(distributions),
      closing: round2(closing),
      annual_fund: annualFund,
      events,
    });
    opening = closing;
  });

  const negative = cycles.findIndex((c) => c.closing < -0.005);
  if (negative >= 0) {
    flags.unshift({ type: 'negative_cycle', cycle_index: negative, cycle: cycles[negative].name, closing: cycles[negative].closing });
  }
  for (const loan of untracked) {
    flags.push({ type: 'untracked_loan', loan_id: loan.id, name: loan.name, amount: round2(loan.monthly_payment || 0) });
  }

  const lowest = cycles.reduce((min, c, i) => (min == null || c.closing < cycles[min].closing ? i : min), null);
  return {
    horizon,
    budget_mode: budgetMode,
    cycles,
    flags,
    lowest: lowest == null ? null : { cycle_index: lowest, cycle: cycles[lowest].name, closing: cycles[lowest].closing },
    fund_configured: inputs.fund != null,
    template_fallbacks: inputs.template.fallbacks || [],
    draft_loans: loans.filter((l) => l.status === 'draft').map((l) => ({ id: l.id, name: l.name, monthly_payment: round2(l.monthly_payment || 0), included: includeDraftLoanIds.includes(l.id) })),
  };
}

// ── Inputs from the DB ───────────────────────────────────────────────────────

function loadStoredCycle(cycleRow) {
  const items = db.prepare('SELECT * FROM cycle_items WHERE cycle_id = ?').all(cycleRow.id);
  const income = db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM cycle_income_items WHERE cycle_id = ?').get(cycleRow.id).t;
  return { previous_balance: cycleRow.previous_balance, income_total: income, items };
}

function loadForecastInputs(dossierId, now = new Date()) {
  const dossier = db
    .prepare('SELECT cycle_start_day, cycle_start_weekend_adjustment, emergency_fund_cycles_to_average FROM dossiers WHERE id = ?')
    .get(dossierId);
  const startDay = dossier.cycle_start_day ?? 25;
  const adjustment = dossier.cycle_start_weekend_adjustment ?? 'none';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Windows: the stored cycle covering today (else the predicted one), then each following
  // period — a stored cycle's own dates when it's already been opened, else predicted.
  const stored = loadCycleWindows(db, dossierId);
  const current = findCycleContainingDate(stored, today);
  let year;
  let month;
  if (current) {
    year = current.year;
    month = current.month;
  } else {
    year = today.getFullYear();
    month = today.getMonth() + 1;
    if (today < computeCycleStartDate(year, month, startDay, adjustment)) {
      month -= 1;
      if (month === 0) { month = 12; year -= 1; }
    }
  }
  const byPeriod = new Map(stored.map((c) => [`${c.year}-${c.month}`, c]));
  const fullRows = new Map(
    db.prepare('SELECT * FROM expense_cycles WHERE dossier_id = ?').all(dossierId).map((c) => [c.id, c])
  );
  const windows = [];
  for (let i = 0; i < MAX_HORIZON; i++) {
    const s = byPeriod.get(`${year}-${month}`);
    const row = s ? fullRows.get(s.id) : null;
    if (row && !row.is_closed) {
      windows.push({ start: s.start, end: s.end, stored: loadStoredCycle(row) });
    } else {
      windows.push({
        start: computeCycleStartDate(year, month, startDay, adjustment),
        end: computeTheoreticalCycleEndDate(year, month, startDay, adjustment),
        stored: null,
      });
    }
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }

  // Opening balance when the first cycle isn't opened yet: the latest earlier cycle's real
  // final balance if it was closed, else its expected balance.
  let openingBalance = 0;
  if (!windows[0].stored) {
    const prev = db
      .prepare('SELECT * FROM expense_cycles WHERE dossier_id = ? ORDER BY year DESC, month DESC LIMIT 1')
      .get(dossierId);
    if (prev) {
      if (prev.is_closed && prev.final_real_balance != null) openingBalance = prev.final_real_balance;
      else {
        const { previous_balance, income_total, items } = loadStoredCycle(prev);
        const out = items.reduce((s, it) => s + (it.value || 0), 0);
        openingBalance = (previous_balance || 0) + income_total - out;
      }
    }
  }

  const templateRows = db.prepare('SELECT id, section, name, type, value FROM expense_template_items WHERE dossier_id = ?').all(dossierId);
  const incomeTemplateCount = db.prepare('SELECT COUNT(*) AS n FROM income_template_items WHERE dossier_id = ?').get(dossierId).n;
  const template = {
    income_total: db.prepare('SELECT COALESCE(SUM(default_value), 0) AS t FROM income_template_items WHERE dossier_id = ?').get(dossierId).t,
    expenses: templateRows.filter((t) => t.section === 'expense'),
    distributions: templateRows.filter((t) => t.section === 'distribution'),
    fallbacks: [],
  };
  // An empty template would project every later cycle with no income (or no expenses) — a
  // steady drain (or surplus) that says nothing about the real plan. When the income template
  // or the expense template is empty, the latest cycle's figures stand in for it, and the
  // response says so (e.g. dossiers set up before income lines existed).
  const latest = db.prepare('SELECT * FROM expense_cycles WHERE dossier_id = ? ORDER BY year DESC, month DESC LIMIT 1').get(dossierId);
  if (latest && (incomeTemplateCount === 0 || templateRows.length === 0)) {
    const { income_total: latestIncome, items } = loadStoredCycle(latest);
    const latestWindow = stored.find((c) => c.id === latest.id);
    const latestName = latestWindow ? cycleName(latestWindow.end) : `${latest.year}-${latest.month}`;
    if (incomeTemplateCount === 0) {
      template.income_total = latestIncome;
      template.fallbacks.push({ part: 'income', cycle: latestName });
    }
    if (templateRows.length === 0) {
      const asTemplate = (it) => ({ id: it.template_item_id, name: it.name, type: it.type, value: it.value });
      template.expenses = items.filter((it) => it.section === 'expense').map(asTemplate);
      template.distributions = items.filter((it) => it.section === 'distribution').map(asTemplate);
      template.fallbacks.push({ part: 'expenses', cycle: latestName });
    }
  }

  // Usual Budget spending: average `spent` per template item over the last N closed cycles
  // (the same N as the Emergency Fund average), matched by template id, or by name for items
  // orphaned by a template bulk-replace.
  const n = dossier.emergency_fund_cycles_to_average ?? 6;
  const closedIds = db
    .prepare('SELECT id FROM expense_cycles WHERE dossier_id = ? AND is_closed = 1 ORDER BY year DESC, month DESC LIMIT ?')
    .all(dossierId, n).map((r) => r.id);
  const budgetAverages = {};
  if (closedIds.length) {
    const ph = closedIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT template_item_id, name, spent FROM cycle_items WHERE cycle_id IN (${ph}) AND section = 'expense' AND type = 'Budget'`)
      .all(...closedIds);
    const groups = {};
    for (const r of rows) {
      for (const key of [r.template_item_id, `name:${r.name}`]) {
        if (!key) continue;
        (groups[key] ||= []).push(r.spent || 0);
      }
    }
    for (const [key, vals] of Object.entries(groups)) budgetAverages[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const loans = db.prepare('SELECT * FROM loans WHERE dossier_id = ?').all(dossierId).map((loan) => {
    const v = computeLoanValues(loan, dossierId);
    return {
      id: loan.id,
      name: loan.name,
      status: loan.status,
      monthly_payment: v.monthly_payment,
      expense_template_item_id: loan.status === 'active' ? loan.expense_template_item_id : null,
      last_due_date: loan.status === 'active' ? loanLastDueDate(loan) : null,
      is_matured: !!v.is_matured,
    };
  });

  // Unpaid annual installments from today to the end of the horizon: the year instances where
  // they exist, otherwise the annual template (a year not created yet).
  const horizonEnd = windows[windows.length - 1].end;
  const installments = [];
  const years = new Map(db.prepare('SELECT id, year FROM annual_expense_years WHERE dossier_id = ?').all(dossierId).map((y) => [y.year, y.id]));
  for (let y = windows[0].start.getFullYear(); y <= horizonEnd.getFullYear(); y++) {
    const rows = years.has(y)
      ? db.prepare(
          `SELECT ayi.name, ayi.budgeted_value AS value, ayi.num_installments AS n, ins.month, ins.day,
                  EXISTS (SELECT 1 FROM annual_expense_payments p WHERE p.installment_id = ins.id AND p.paid = 1) AS paid
             FROM annual_expense_year_installments ins JOIN annual_expense_year_items ayi ON ayi.id = ins.year_item_id
            WHERE ayi.year_id = ?`
        ).all(years.get(y))
      : db.prepare(
          `SELECT t.name, t.value, t.num_installments AS n, ins.month, ins.day, 0 AS paid
             FROM annual_expense_template_installments ins JOIN annual_expense_template_items t ON t.id = ins.template_item_id
            WHERE t.dossier_id = ?`
        ).all(dossierId);
    for (const r of rows) {
      if (r.paid) continue;
      const date = new Date(y, r.month - 1, Math.min(r.day, daysInMonth(y, r.month)));
      if (date < windows[0].start || date > horizonEnd) continue;
      installments.push({ date, name: r.name, amount: (r.value || 0) / (r.n || 1) });
    }
  }

  // Annual fund: contributing accounts' latest snapshot balance, fed by contributing
  // distributions — the same two sources the Annual Expenses year status uses.
  const accountIds = db.prepare('SELECT account_id FROM annual_expense_accounts WHERE dossier_id = ?').all(dossierId).map((r) => r.account_id);
  const distIds = db
    .prepare(
      `SELECT aed.distribution_template_id AS id FROM annual_expense_distributions aed
         JOIN expense_template_items eti ON eti.id = aed.distribution_template_id AND eti.dossier_id = aed.dossier_id
        WHERE aed.dossier_id = ?`
    )
    .all(dossierId).map((r) => r.id);
  let fund = null;
  if (accountIds.length || distIds.length) {
    let fundOpening = 0;
    const lastMonth = db.prepare('SELECT id FROM months WHERE dossier_id = ? AND filled = 1 ORDER BY year DESC, month DESC LIMIT 1').get(dossierId);
    if (lastMonth && accountIds.length) {
      const ph = accountIds.map(() => '?').join(',');
      fundOpening = db
        .prepare(
          `SELECT COALESCE(SUM(me.value), 0) AS t FROM month_entries me JOIN accounts a ON a.id = me.account_id
            WHERE me.month_id = ? AND a.archived = 0 AND me.account_id IN (${ph})`
        )
        .get(lastMonth.id, ...accountIds).t;
    }
    fund = { opening: fundOpening, distribution_ids: distIds };
  }

  return { windows, opening_balance: openingBalance, template, budget_averages: budgetAverages, loans, installments, fund };
}

// A short summary for the AI Advisor context: the lowest projected cycle, the first fund
// shortfall, negative cycles and loan endings over the next 12 cycles.
function summarizeForecastForAi(forecast) {
  const loanEnds = forecast.cycles.flatMap((c) =>
    c.events.filter((e) => e.type === 'loan_ends').map((e) => ({ loan: e.name, last_payment: e.date, frees_per_cycle: e.amount }))
  );
  const negative = forecast.flags.find((f) => f.type === 'negative_cycle');
  const shortfall = forecast.flags.find((f) => f.type === 'fund_shortfall');
  return {
    horizon_cycles: forecast.horizon,
    first_cycle: forecast.cycles[0]?.name ?? null,
    lowest_projected_closing: forecast.lowest ? { cycle: forecast.lowest.cycle, closing: forecast.lowest.closing } : null,
    first_negative_cycle: negative ? { cycle: negative.cycle, closing: negative.closing } : null,
    annual_fund_first_shortfall: shortfall ? { cycle: shortfall.cycle, item: shortfall.name, date: shortfall.date, short_by: shortfall.short_by } : null,
    loan_endings: loanEnds,
    untracked_loans: forecast.flags.filter((f) => f.type === 'untracked_loan').map((f) => f.name),
    closing_series: forecast.cycles.map((c) => ({ cycle: c.name, closing: c.closing, annual_fund: c.annual_fund ? c.annual_fund.closing : null })),
  };
}

// GET /forecast?horizon=6|12|24&budget=planned|usual&include_draft=<loanId>,<loanId>
router.get('/forecast', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const horizon = req.query.horizon === undefined ? 12 : Number(req.query.horizon);
  if (!HORIZONS.includes(horizon)) return res.status(400).json({ error: 'horizon must be 6, 12 or 24' });
  const budgetMode = req.query.budget === undefined ? 'planned' : req.query.budget;
  if (!['planned', 'usual'].includes(budgetMode)) return res.status(400).json({ error: 'budget must be "planned" or "usual"' });
  const includeDraftLoanIds = req.query.include_draft ? String(req.query.include_draft).split(',').filter(Boolean) : [];

  res.json(computeForecast(loadForecastInputs(req.params.id), { horizon, budgetMode, includeDraftLoanIds }));
});

module.exports = router;
module.exports.computeForecast = computeForecast;
module.exports.loadForecastInputs = loadForecastInputs;
module.exports.summarizeForecastForAi = summarizeForecastForAi;
module.exports.loanLastDueDate = loanLastDueDate;
