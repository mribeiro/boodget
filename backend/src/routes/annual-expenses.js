const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { idsNotInDossier } = require('../utils/ownedIds');
const { v4: uuidv4 } = require('uuid');
const { computeCycleStartDate, fromIsoDate } = require('../utils/cycleDates');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// Returns the 1-based display months (1–12) of `calendarYear` whose cycle start date
// (cycleStartDay of the *previous* calendar month, weekend-adjusted per the dossier's
// live setting) is still in the future. Mirrors the frontend's cyclesRemainingInYear
// helper in AnnualExpensesTab.jsx. This is a genuinely forward-looking prediction (the
// cycle may not exist yet), so it uses the dossier's *live* settings, not a stored cycle.
function remainingCycleMonthsInYear(calendarYear, cycleStartDay, weekendAdjustment) {
  const today = new Date();
  const months = [];
  for (let displayMonth = 0; displayMonth < 12; displayMonth++) {
    const cycleStart = computeCycleStartDate(calendarYear, displayMonth, cycleStartDay, weekendAdjustment);
    if (cycleStart > today) months.push(displayMonth + 1);
  }
  return months;
}

// Payments of an installment that are recorded history — paid, or in a closed cycle — and so
// must never be moved or deleted as a side effect of editing the installment's schedule.
function lockedPayments(installmentId) {
  return db
    .prepare(
      `SELECT p.id FROM annual_expense_payments p
       JOIN expense_cycles c ON c.id = p.cycle_id
       WHERE p.installment_id = ? AND (p.paid = 1 OR c.is_closed = 1)`
    )
    .all(installmentId);
}

// When an installment has payments in several cycles, the one the year view shows: the payment
// in the cycle whose window contains the installment's date, else a paid one, else the one in
// the earliest cycle.
function pickInstallmentPayment(payments, instDate) {
  if (payments.length <= 1) return payments[0] ?? null;
  const covering = payments.find(
    (p) => p.actual_start_date && p.actual_end_date &&
      instDate >= fromIsoDate(p.actual_start_date) && instDate <= fromIsoDate(p.actual_end_date)
  );
  if (covering) return covering;
  const byCycle = [...payments].sort((a, b) => a.cycle_year - b.cycle_year || a.cycle_month - b.cycle_month);
  return byCycle.find((p) => p.paid) ?? byCycle[0];
}

// Build the full year status object
function computeYearStatus(yearId, dossierId) {
  const year = db.prepare('SELECT * FROM annual_expense_years WHERE id = ?').get(yearId);
  if (!year) return null;

  const dossierRow = db.prepare('SELECT cycle_start_day, cycle_start_weekend_adjustment FROM dossiers WHERE id = ?').get(dossierId);
  const startDay = dossierRow?.cycle_start_day ?? 25;
  const weekendAdjustment = dossierRow?.cycle_start_weekend_adjustment ?? 'none';

  const items = db.prepare(`
    SELECT ayi.*,
           COALESCE((
             SELECT SUM(p.real_value)
             FROM annual_expense_payments p
             JOIN annual_expense_year_installments inst2 ON inst2.id = p.installment_id
             WHERE inst2.year_item_id = ayi.id AND p.paid = 1
           ), 0) as total_paid
    FROM annual_expense_year_items ayi
    WHERE ayi.year_id = ?
    ORDER BY ayi.position
  `).all(yearId);

  const totalBudgeted = items.reduce((s, i) => s + (i.budgeted_value || 0), 0);
  const totalPaid = items.reduce((s, i) => s + (i.total_paid || 0), 0);

  const paymentsForInstallment = db.prepare(`
    SELECT p.id, p.cycle_id, p.real_value, p.paid, c.actual_start_date, c.actual_end_date, c.year AS cycle_year, c.month AS cycle_month
    FROM annual_expense_payments p JOIN expense_cycles c ON c.id = p.cycle_id
    WHERE p.installment_id = ?
  `);

  // Get installments and payments for each item
  const itemsWithInstallments = items.map((item) => {
    const installments = db.prepare(`
      SELECT * FROM annual_expense_year_installments
      WHERE year_item_id = ?
      ORDER BY installment_number
    `).all(item.id).map((inst) => {
      // An installment can have payments in more than one cycle (overlapping cycles); joining
      // them in listed the installment once per payment. Show one row, with one payment picked
      // deterministically (see pickInstallmentPayment).
      const payments = paymentsForInstallment.all(inst.id);
      const payment = pickInstallmentPayment(payments, new Date(year.year, inst.month - 1, inst.day));
      return {
        ...inst,
        payment_id: payment?.id ?? null,
        cycle_id: payment?.cycle_id ?? null,
        payment_real_value: payment?.real_value ?? null,
        payment_paid: payment?.paid ?? 0,
      };
    });

    return {
      ...item,
      difference: (item.total_paid || 0) - (item.budgeted_value || 0),
      installments: installments.map((inst) => ({
        id: inst.id,
        installment_number: inst.installment_number,
        month: inst.month,
        day: inst.day,
        expected_value: (item.budgeted_value || 0) / (item.num_installments || 1),
        payment: inst.payment_id ? {
          id: inst.payment_id,
          cycle_id: inst.cycle_id,
          real_value: inst.payment_real_value,
          paid: !!inst.payment_paid,
        } : null,
      })),
    };
  });

  // Sort by first installment date (month × 100 + day); items with no installments go last
  itemsWithInstallments.sort((a, b) => {
    const firstA = a.installments[0];
    const firstB = b.installments[0];
    const keyA = firstA ? firstA.month * 100 + firstA.day : Infinity;
    const keyB = firstB ? firstB.month * 100 + firstB.day : Infinity;
    return keyA - keyB;
  });

  // Contributing accounts: sum from most recent filled capital snapshot
  const selectedAccountIds = db
    .prepare('SELECT account_id FROM annual_expense_accounts WHERE dossier_id = ?')
    .all(dossierId).map((r) => r.account_id);

  let accumulatedAccounts = 0;
  const contributingAccountDetails = [];

  if (selectedAccountIds.length > 0) {
    const lastFilledMonth = db
      .prepare("SELECT id FROM months WHERE dossier_id = ? AND filled = 1 ORDER BY year DESC, month DESC LIMIT 1")
      .get(dossierId);

    if (lastFilledMonth) {
      for (const accId of selectedAccountIds) {
        const entry = db
          .prepare('SELECT me.value, a.name, a.group_name FROM month_entries me JOIN accounts a ON a.id = me.account_id WHERE me.month_id = ? AND me.account_id = ? AND a.archived = 0')
          .get(lastFilledMonth.id, accId);
        if (entry && entry.value != null) {
          accumulatedAccounts += entry.value;
          contributingAccountDetails.push({ id: accId, name: entry.name, group_name: entry.group_name, current_value: entry.value });
        }
      }
    }
  }

  // Contributing distributions: sum done distributions from cycles in this calendar year.
  // Only ids that are this dossier's own distribution template items count — a link to
  // another dossier's item (stored before PUT /annual-expenses/distributions validated ids)
  // would otherwise leak that item's value and name into this year's figures.
  const selectedDistIds = db
    .prepare(
      `SELECT aed.distribution_template_id FROM annual_expense_distributions aed
       JOIN expense_template_items eti ON eti.id = aed.distribution_template_id AND eti.dossier_id = aed.dossier_id
       WHERE aed.dossier_id = ?`
    )
    .all(dossierId).map((r) => r.distribution_template_id);

  const totalRaiseNeeded = Math.max(0, totalBudgeted - (year.carryover || 0));
  const cyclesLeftInYear = remainingCycleMonthsInYear(year.year, startDay, weekendAdjustment).length;

  let contributedDistributions = 0;
  let monthlyDistProjected = 0;
  let distributionsChartData = null;

  if (selectedDistIds.length > 0) {
    const ph = selectedDistIds.map(() => '?').join(',');
    const projRow = db
      .prepare(`SELECT COALESCE(SUM(value), 0) as total FROM expense_template_items WHERE id IN (${ph})`)
      .get(...selectedDistIds);
    monthlyDistProjected = projRow.total || 0;

    // Find cycles whose end date falls within this calendar year. Each cycle's own
    // stored actual_end_date is used (not the dossier's current setting) so a later
    // change to the setting doesn't retroactively reshape an already-created cycle.
    const cycles = db
      .prepare('SELECT id, year, month, cycle_start_day, actual_end_date FROM expense_cycles WHERE dossier_id = ? ORDER BY year ASC, month ASC')
      .all(dossierId);

    const cyclesInYear = cycles.filter((c) => {
      const endDate = c.actual_end_date ? fromIsoDate(c.actual_end_date) : new Date(c.year, c.month, (c.cycle_start_day ?? startDay) - 1);
      return endDate.getFullYear() === year.year;
    });

    if (cyclesInYear.length > 0) {
      distributionsChartData = [];
      let expectedCumulative = 0;
      let realCumulative = 0;

      for (const cycle of cyclesInYear) {
        let cycleAmount = 0;
        for (const distId of selectedDistIds) {
          // Match by template_item_id (primary) OR by name for cycle items whose
          // template_item_id was orphaned by a bulk-replace of the expense template.
          const doneItems = db.prepare(`
            SELECT ci.value FROM cycle_items ci
            WHERE ci.cycle_id = ?
              AND ci.section = 'distribution'
              AND ci.done = 1
              AND (
                ci.template_item_id = ?
                OR (
                  ci.name = (SELECT name FROM expense_template_items WHERE id = ?)
                  AND (
                    ci.template_item_id IS NULL
                    OR NOT EXISTS (SELECT 1 FROM expense_template_items WHERE id = ci.template_item_id)
                  )
                )
              )
          `).all(cycle.id, distId, distId);
          cycleAmount += doneItems.reduce((s, i) => s + (i.value || 0), 0);
        }
        contributedDistributions += cycleAmount;

        expectedCumulative += monthlyDistProjected;
        realCumulative += cycleAmount;
        distributionsChartData.push({
          cycle_id: cycle.id, year: cycle.year, month: cycle.month,
          expected_cumulative: expectedCumulative, real_cumulative: realCumulative,
        });
      }

      // Projected tail: extrapolate from the current cumulative through the remaining
      // calendar-year cycles at the same monthly pace. No anchoring step is needed here
      // (unlike goals.js) — real_cumulative already IS the running total of done
      // distributions, with no separate live snapshot to reconcile it against.
      const existingMonths = new Set(cyclesInYear.map((c) => c.month));
      const futureMonths = remainingCycleMonthsInYear(year.year, startDay, weekendAdjustment).filter((m) => !existingMonths.has(m));
      if (monthlyDistProjected > 0 && futureMonths.length > 0) {
        let projectedCumulative = realCumulative;
        distributionsChartData[distributionsChartData.length - 1].projected_cumulative = projectedCumulative;
        for (const m of futureMonths) {
          projectedCumulative += monthlyDistProjected;
          distributionsChartData.push({
            cycle_id: null, year: year.year, month: m,
            expected_cumulative: null, real_cumulative: null, projected_cumulative: projectedCumulative,
          });
        }
      }
    }
  }

  // Anticipated fully-funded date: mirrors goals.js's anticipated_completion_date logic,
  // scoped to the distributions contribution channel (target = amount that needs to be
  // raised beyond the starting carryover; progress = actual distributions contributed so far).
  const remainingViaDistributions = Math.max(0, totalRaiseNeeded - contributedDistributions);
  let anticipatedFullyFundedDate = null;
  if (monthlyDistProjected > 0 && remainingViaDistributions > 0) {
    const cyclesNeeded = Math.max(0, Math.ceil(remainingViaDistributions / monthlyDistProjected));
    if (cyclesNeeded < cyclesLeftInYear) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth() + cyclesNeeded, 1);
      anticipatedFullyFundedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  // Compute "needed this cycle": unpaid installments assigned to the currently active cycle
  const allCycles = db.prepare('SELECT id, year, month, cycle_start_day, actual_start_date, actual_end_date FROM expense_cycles WHERE dossier_id = ?').all(dossierId);
  const today = new Date();
  let currentCycleId = null;
  for (const cycle of allCycles) {
    const cStartDay = cycle.cycle_start_day ?? startDay;
    const cycleStart = cycle.actual_start_date ? fromIsoDate(cycle.actual_start_date) : new Date(cycle.year, cycle.month - 1, cStartDay);
    const cycleEnd = cycle.actual_end_date ? fromIsoDate(cycle.actual_end_date) : new Date(cycle.year, cycle.month, cStartDay - 1);
    if (today >= cycleStart && today <= cycleEnd) {
      currentCycleId = cycle.id;
      break;
    }
  }

  let neededThisCycle = 0;
  if (currentCycleId) {
    for (const item of itemsWithInstallments) {
      const expectedPerInst = (item.budgeted_value || 0) / (item.num_installments || 1);
      for (const inst of item.installments) {
        if (inst.payment && inst.payment.cycle_id === currentCycleId && !inst.payment.paid) {
          neededThisCycle += expectedPerInst;
        }
      }
    }
  }

  return {
    year: year.year,
    carryover: year.carryover,
    accumulated_accounts: accumulatedAccounts,
    contributed_distributions: contributedDistributions,
    monthly_dist_projected: monthlyDistProjected,
    total_raise_needed: totalRaiseNeeded,
    cycles_left_in_year: cyclesLeftInYear,
    anticipated_fully_funded_date: anticipatedFullyFundedDate,
    distributions_chart_data: distributionsChartData,
    total_budgeted: totalBudgeted,
    total_paid: totalPaid,
    total_remaining: totalBudgeted - totalPaid,
    needed_this_cycle: neededThisCycle,
    balance: accumulatedAccounts - totalPaid,
    items: itemsWithInstallments,
    contributing_accounts: contributingAccountDetails,
  };
}

// ── Annual Expense Years ─────────────────────────────────────────────────────

// GET /annual-years
router.get('/annual-years', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const years = db
    .prepare('SELECT * FROM annual_expense_years WHERE dossier_id = ? ORDER BY year DESC')
    .all(req.params.id);

  const result = years.map((y) => {
    const totalBudgeted = db
      .prepare('SELECT COALESCE(SUM(budgeted_value), 0) as total FROM annual_expense_year_items WHERE year_id = ?')
      .get(y.id).total;
    const totalPaid = db.prepare(`
      SELECT COALESCE(SUM(p.real_value), 0) as total
      FROM annual_expense_payments p
      JOIN annual_expense_year_installments ayii ON ayii.id = p.installment_id
      JOIN annual_expense_year_items ayi ON ayi.id = ayii.year_item_id
      WHERE ayi.year_id = ? AND p.paid = 1
    `).get(y.id).total;
    return { ...y, total_budgeted: totalBudgeted, total_paid: totalPaid, total_remaining: totalBudgeted - totalPaid };
  });

  res.json(result);
});

// POST /annual-years
router.post('/annual-years', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { year } = req.body;
  if (!year || !Number.isInteger(Number(year))) return res.status(400).json({ error: 'year is required' });
  const calYear = Number(year);

  const existing = db
    .prepare('SELECT id FROM annual_expense_years WHERE dossier_id = ? AND year = ?')
    .get(req.params.id, calYear);
  if (existing) return res.status(409).json({ error: `An annual expense year for ${calYear} already exists` });

  const createYear = db.transaction(() => {
    const yearId = uuidv4();
    db.prepare('INSERT INTO annual_expense_years (id, dossier_id, year, carryover) VALUES (?, ?, ?, 0)')
      .run(yearId, req.params.id, calYear);

    const templateItems = db
      .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
      .all(req.params.id);
    const insertItem = db.prepare(
      'INSERT INTO annual_expense_year_items (id, year_id, name, budgeted_value, classification, num_installments, from_template, position) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    );
    const insertInst = db.prepare(
      'INSERT INTO annual_expense_year_installments (id, year_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
    );

    for (const ti of templateItems) {
      const itemId = uuidv4();
      const numInst = ti.num_installments ?? 1;
      insertItem.run(itemId, yearId, ti.name, ti.value, ti.classification, numInst, ti.position ?? 0);

      const tInsts = db
        .prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number')
        .all(ti.id);
      if (tInsts.length > 0) {
        for (const inst of tInsts) {
          insertInst.run(uuidv4(), itemId, inst.installment_number, inst.month, inst.day);
        }
      } else if (ti.day_of_payment != null && ti.month_of_payment != null) {
        insertInst.run(uuidv4(), itemId, 1, ti.month_of_payment, ti.day_of_payment);
      }
    }

    return yearId;
  });

  const yearId = createYear();
  const status = computeYearStatus(yearId, req.params.id);
  res.status(201).json(status);
});

// GET /annual-years/:yearId
router.get('/annual-years/:yearId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const year = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!year) return res.status(404).json({ error: 'Annual expense year not found' });

  res.json(computeYearStatus(req.params.yearId, req.params.id));
});

// PATCH /annual-years/:yearId
router.patch('/annual-years/:yearId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const year = db
    .prepare('SELECT * FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!year) return res.status(404).json({ error: 'Annual expense year not found' });

  const { carryover } = req.body;
  if (carryover !== undefined) {
    if (isNaN(Number(carryover))) return res.status(400).json({ error: 'carryover must be a number' });
    db.prepare('UPDATE annual_expense_years SET carryover = ? WHERE id = ?').run(Number(carryover), req.params.yearId);
  }

  res.json(computeYearStatus(req.params.yearId, req.params.id));
});

// DELETE /annual-years/:yearId
router.delete('/annual-years/:yearId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const year = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!year) return res.status(404).json({ error: 'Annual expense year not found' });

  db.prepare('DELETE FROM annual_expense_years WHERE id = ?').run(req.params.yearId);
  res.status(204).end();
});

// ── Year Items ───────────────────────────────────────────────────────────────

// POST /annual-years/:yearId/items
router.post('/annual-years/:yearId/items', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const year = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!year) return res.status(404).json({ error: 'Annual expense year not found' });

  const { name, budgeted_value, classification, num_installments, installments } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (budgeted_value == null || isNaN(Number(budgeted_value)) || Number(budgeted_value) < 0) {
    return res.status(400).json({ error: 'budgeted_value must be a non-negative number' });
  }
  if (classification && !['must', 'want'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be "must" or "want"' });
  }

  const maxPos = db
    .prepare('SELECT MAX(position) as mp FROM annual_expense_year_items WHERE year_id = ?')
    .get(req.params.yearId);
  const position = (maxPos.mp ?? -1) + 1;
  const numInst = num_installments != null ? Math.max(1, Number(num_installments)) : 1;

  const create = db.transaction(() => {
    const itemId = uuidv4();
    db.prepare(
      'INSERT INTO annual_expense_year_items (id, year_id, name, budgeted_value, classification, num_installments, from_template, position) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).run(itemId, req.params.yearId, String(name).trim(), Number(budgeted_value), classification || null, numInst, position);

    if (Array.isArray(installments)) {
      const insertInst = db.prepare('INSERT INTO annual_expense_year_installments (id, year_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)');
      installments.forEach((inst, idx) => {
        insertInst.run(uuidv4(), itemId, inst.installment_number ?? (idx + 1), inst.month, inst.day);
      });
    }
    return itemId;
  });

  create();
  res.status(201).json(computeYearStatus(req.params.yearId, req.params.id));
});

// PATCH /annual-years/:yearId/items/:itemId
router.patch('/annual-years/:yearId/items/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db.prepare(`
    SELECT ayi.* FROM annual_expense_year_items ayi
    JOIN annual_expense_years aey ON aey.id = ayi.year_id
    WHERE ayi.id = ? AND aey.id = ? AND aey.dossier_id = ?
  `).get(req.params.itemId, req.params.yearId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { name, budgeted_value, classification, num_installments, installments } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
  if (budgeted_value !== undefined && (isNaN(Number(budgeted_value)) || Number(budgeted_value) < 0)) {
    return res.status(400).json({ error: 'budgeted_value must be a non-negative number' });
  }
  if (classification !== undefined && classification !== null && !['must', 'want'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be "must" or "want"' });
  }

  const newName = name !== undefined ? String(name).trim() : item.name;
  const newBv = budgeted_value !== undefined ? Number(budgeted_value) : item.budgeted_value;
  const newClass = classification !== undefined ? classification : item.classification;
  const newNumInst = num_installments !== undefined ? Math.max(1, Number(num_installments)) : item.num_installments;

  // Payments left where they were because they're recorded history (see below).
  let keptInPlace = 0;
  const doUpdate = db.transaction(() => {
    db.prepare(
      'UPDATE annual_expense_year_items SET name = ?, budgeted_value = ?, classification = ?, num_installments = ? WHERE id = ?'
    ).run(newName, newBv, newClass, newNumInst, req.params.itemId);

    // Unpaid payments still hold the per-installment estimate as their real_value, so refresh
    // it when the estimate changes. Paid ones hold the amount actually paid — left alone.
    if (newBv !== item.budgeted_value || newNumInst !== item.num_installments) {
      db.prepare(
        `UPDATE annual_expense_payments SET real_value = ?
          WHERE paid = 0 AND installment_id IN (SELECT id FROM annual_expense_year_installments WHERE year_item_id = ?)`
      ).run(newBv / (newNumInst || 1), req.params.itemId);
    }

    if (Array.isArray(installments)) {
      // Update installments in-place by installment_number to preserve IDs and cascade payments.
      // Only delete installments that are no longer in the new list.
      const existingInsts = db
        .prepare('SELECT * FROM annual_expense_year_installments WHERE year_item_id = ?')
        .all(req.params.itemId);
      const existingByNum = {};
      for (const e of existingInsts) existingByNum[e.installment_number] = e;

      const newNumbers = new Set(installments.map((inst, idx) => inst.installment_number ?? (idx + 1)));
      const removed = existingInsts.filter((e) => !newNumbers.has(e.installment_number));
      // Removing an installment cascades its payments, so refuse while one of them is recorded
      // history: paid, or in a closed (read-only) cycle.
      const lockedRemoved = removed.filter((e) => lockedPayments(e.id).length > 0);
      if (lockedRemoved.length > 0) {
        const err = new Error(
          `Installment${lockedRemoved.length === 1 ? '' : 's'} ${lockedRemoved.map((e) => e.installment_number).join(', ')} ` +
            `can't be removed: ${lockedRemoved.length === 1 ? 'it has' : 'they have'} a paid payment or one in a closed cycle. ` +
            'Untick the payment (reopening its cycle if needed) first.'
        );
        err.status = 409;
        throw err;
      }
      for (const e of removed) {
        db.prepare('DELETE FROM annual_expense_year_installments WHERE id = ?').run(e.id);
      }

      const updateInst = db.prepare('UPDATE annual_expense_year_installments SET month = ?, day = ? WHERE id = ?');
      const insertInst = db.prepare('INSERT INTO annual_expense_year_installments (id, year_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)');
      installments.forEach((inst, idx) => {
        const num = inst.installment_number ?? (idx + 1);
        if (existingByNum[num]) {
          updateInst.run(inst.month, inst.day, existingByNum[num].id);
        } else {
          insertInst.run(uuidv4(), req.params.itemId, num, inst.month, inst.day);
        }
      });

      // Re-assign payments to the correct cycle after date changes. Each cycle's own
      // stored actual_start_date/actual_end_date is used, not the dossier's current
      // setting, so existing cycles aren't reshaped by a later change to that setting.
      const yearRow = db.prepare('SELECT year FROM annual_expense_years WHERE id = ?').get(req.params.yearId);
      const dossierRow = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
      const startDay = dossierRow?.cycle_start_day ?? 25;
      const allCycles = db.prepare('SELECT id, year, month, is_closed, cycle_start_day, actual_start_date, actual_end_date FROM expense_cycles WHERE dossier_id = ?').all(req.params.id);

      const updatedInsts = db.prepare('SELECT * FROM annual_expense_year_installments WHERE year_item_id = ?').all(req.params.itemId);
      const closedCycleIds = new Set(allCycles.filter((c) => c.is_closed).map((c) => c.id));
      for (const inst of updatedInsts) {
        const instDate = new Date(yearRow.year, inst.month - 1, inst.day);
        let targetCycle = null;
        for (const cycle of allCycles) {
          const cStartDay = cycle.cycle_start_day ?? startDay;
          const cycleStart = cycle.actual_start_date ? fromIsoDate(cycle.actual_start_date) : new Date(cycle.year, cycle.month - 1, cStartDay);
          const cycleEnd = cycle.actual_end_date ? fromIsoDate(cycle.actual_end_date) : new Date(cycle.year, cycle.month, cStartDay - 1);
          if (instDate >= cycleStart && instDate <= cycleEnd) {
            targetCycle = cycle;
            break;
          }
        }

        // An installment can hold payments in more than one cycle (overlapping cycles), so
        // handle each one rather than just the first.
        const payments = db.prepare('SELECT * FROM annual_expense_payments WHERE installment_id = ?').all(inst.id);
        for (const payment of payments) {
          if (targetCycle && targetCycle.id === payment.cycle_id) continue;

          // Recorded history stays put: a paid payment, or any payment in a closed cycle, is
          // never moved or deleted, and nothing is moved *into* a closed cycle — closed cycles
          // are read-only, and shifting a payment would silently change their reconciled figures.
          const locked = payment.paid || closedCycleIds.has(payment.cycle_id);
          const targetClosed = targetCycle && closedCycleIds.has(targetCycle.id);
          const targetTaken = targetCycle && payments.some((p) => p.id !== payment.id && p.cycle_id === targetCycle.id);
          if (locked || targetClosed || targetTaken) {
            keptInPlace += 1;
          } else if (targetCycle) {
            db.prepare('UPDATE annual_expense_payments SET cycle_id = ? WHERE id = ?').run(targetCycle.id, payment.id);
          } else {
            // No cycle covers the new date yet; drop the unpaid placeholder (recreated when that
            // cycle is opened).
            db.prepare('DELETE FROM annual_expense_payments WHERE id = ?').run(payment.id);
          }
        }
      }
    }
  });
  try {
    doUpdate();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  res.json({ ...computeYearStatus(req.params.yearId, req.params.id), payments_kept_in_place: keptInPlace });
});

// DELETE /annual-years/:yearId/items/:itemId
router.delete('/annual-years/:yearId/items/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db.prepare(`
    SELECT ayi.id FROM annual_expense_year_items ayi
    JOIN annual_expense_years aey ON aey.id = ayi.year_id
    WHERE ayi.id = ? AND aey.id = ? AND aey.dossier_id = ?
  `).get(req.params.itemId, req.params.yearId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  db.prepare('DELETE FROM annual_expense_year_items WHERE id = ?').run(req.params.itemId);
  res.json(computeYearStatus(req.params.yearId, req.params.id));
});

// ── Sync Operations ──────────────────────────────────────────────────────────

// Merges the current template into an existing annual expense year. A template-derived
// item with at least one paid installment is "locked" and left completely untouched —
// its payment history must never be silently discarded. An unlocked item (no paid
// installments yet) is replaced with a fresh copy of the matching template item, and a
// template item with no matching year item (by name) is added. Year items no longer
// present in the template are left as-is rather than deleted, so removing something from
// the template can't destroy a year's recorded data either. Ad-hoc items are untouched.
function mergeYearFromTemplate(yearId, dossierId) {
  const existingItems = db.prepare(`
    SELECT ayi.id, ayi.name,
           EXISTS(
             SELECT 1 FROM annual_expense_year_installments ayii
             JOIN annual_expense_payments aep ON aep.installment_id = ayii.id
             WHERE ayii.year_item_id = ayi.id AND aep.paid = 1
           ) as locked
    FROM annual_expense_year_items ayi
    WHERE ayi.year_id = ? AND ayi.from_template = 1
  `).all(yearId);
  const existingByName = new Map(existingItems.map((i) => [i.name, i]));

  const templateItems = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(dossierId);

  const deleteItem = db.prepare('DELETE FROM annual_expense_year_items WHERE id = ?');
  const insertItem = db.prepare(
    'INSERT INTO annual_expense_year_items (id, year_id, name, budgeted_value, classification, num_installments, from_template, position) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
  );
  const insertInst = db.prepare(
    'INSERT INTO annual_expense_year_installments (id, year_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
  );

  const summary = { added: [], refreshed: [], skipped_locked: [] };

  for (const ti of templateItems) {
    const existing = existingByName.get(ti.name);
    if (existing?.locked) {
      summary.skipped_locked.push(ti.name);
      continue;
    }
    if (existing) {
      // Cascade-deletes its installments and (unpaid, since it's unlocked) payments.
      deleteItem.run(existing.id);
      summary.refreshed.push(ti.name);
    } else {
      summary.added.push(ti.name);
    }

    const itemId = uuidv4();
    const numInst = ti.num_installments ?? 1;
    insertItem.run(itemId, yearId, ti.name, ti.value, ti.classification, numInst, ti.position ?? 0);

    const tInsts = db
      .prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number')
      .all(ti.id);
    if (tInsts.length > 0) {
      for (const inst of tInsts) {
        insertInst.run(uuidv4(), itemId, inst.installment_number, inst.month, inst.day);
      }
    } else if (ti.day_of_payment != null && ti.month_of_payment != null) {
      insertInst.run(uuidv4(), itemId, 1, ti.month_of_payment, ti.day_of_payment);
    }
  }

  return summary;
}

// POST /annual-years/:yearId/sync-from-template
router.post('/annual-years/:yearId/sync-from-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const yearRow = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!yearRow) return res.status(404).json({ error: 'Annual expense year not found' });

  const doMerge = db.transaction(() => mergeYearFromTemplate(req.params.yearId, req.params.id));
  const merge_summary = doMerge();

  res.json({ ...computeYearStatus(req.params.yearId, req.params.id), merge_summary });
});

// POST /annual-years/:yearId/sync-to-template
router.post('/annual-years/:yearId/sync-to-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const yearRow = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!yearRow) return res.status(404).json({ error: 'Annual expense year not found' });

  const doSync = db.transaction(() => {
    // Year items carry no car tag or legacy single-date fields, so capture them from the
    // current template by name before it's wiped and re-apply them to the same-name item —
    // same capture-by-name mechanism as POST /annual-expense-template/bulk-replace.
    const previousByName = new Map();
    for (const row of db
      .prepare('SELECT name, car_id, day_of_payment, month_of_payment FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
      .all(req.params.id)) {
      if (!previousByName.has(row.name)) previousByName.set(row.name, row);
    }

    db.prepare('DELETE FROM annual_expense_template_items WHERE dossier_id = ?').run(req.params.id);

    const yearItems = db
      .prepare('SELECT * FROM annual_expense_year_items WHERE year_id = ? ORDER BY position')
      .all(req.params.yearId);
    const insertTi = db.prepare(
      `INSERT INTO annual_expense_template_items
         (id, dossier_id, name, value, classification, position, num_installments, car_id, day_of_payment, month_of_payment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertTiInst = db.prepare(
      'INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
    );

    for (const yi of yearItems) {
      const tiId = uuidv4();
      const previous = previousByName.get(yi.name);
      insertTi.run(
        tiId, req.params.id, yi.name, yi.budgeted_value, yi.classification, yi.position, yi.num_installments,
        previous?.car_id ?? null, previous?.day_of_payment ?? null, previous?.month_of_payment ?? null
      );

      const yearInsts = db
        .prepare('SELECT * FROM annual_expense_year_installments WHERE year_item_id = ? ORDER BY installment_number')
        .all(yi.id);
      for (const inst of yearInsts) {
        insertTiInst.run(uuidv4(), tiId, inst.installment_number, inst.month, inst.day);
      }
    }
  });

  doSync();
  const newTemplate = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(req.params.id);

  res.json(newTemplate.map((item) => ({
    ...item,
    installments: db.prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number').all(item.id),
  })));
});

// ── Year Status ──────────────────────────────────────────────────────────────

// GET /annual-years/:yearId/status
router.get('/annual-years/:yearId/status', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const year = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!year) return res.status(404).json({ error: 'Annual expense year not found' });

  res.json(computeYearStatus(req.params.yearId, req.params.id));
});

// ── Payments ─────────────────────────────────────────────────────────────────

// PATCH /annual-expense-payments/:paymentId
router.patch('/annual-expense-payments/:paymentId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  // Verify payment belongs to this dossier
  const payment = db.prepare(`
    SELECT p.*, aey.dossier_id FROM annual_expense_payments p
    JOIN annual_expense_year_installments ayii ON ayii.id = p.installment_id
    JOIN annual_expense_year_items ayi ON ayi.id = ayii.year_item_id
    JOIN annual_expense_years aey ON aey.id = ayi.year_id
    WHERE p.id = ? AND aey.dossier_id = ?
  `).get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (payment.cycle_id) {
    const cycle = db.prepare('SELECT is_closed FROM expense_cycles WHERE id = ?').get(payment.cycle_id);
    if (cycle?.is_closed) return res.status(409).json({ error: 'Cycle is closed. Reopen it to make changes.' });
  }

  const { paid, real_value } = req.body;
  if (paid === undefined && real_value === undefined) {
    return res.status(400).json({ error: 'paid or real_value is required' });
  }
  if (real_value !== undefined) {
    const n = Number(real_value);
    if (real_value === null || real_value === '' || !Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: 'real_value must be a non-negative number' });
    }
  }

  db.transaction(() => {
    if (paid !== undefined) {
      db.prepare('UPDATE annual_expense_payments SET paid = ? WHERE id = ?').run(paid ? 1 : 0, req.params.paymentId);
    }
    if (real_value !== undefined) {
      db.prepare('UPDATE annual_expense_payments SET real_value = ? WHERE id = ?').run(Number(real_value), req.params.paymentId);
    }
  })();

  const updated = db.prepare('SELECT * FROM annual_expense_payments WHERE id = ?').get(req.params.paymentId);
  res.json({ id: updated.id, paid: !!updated.paid, real_value: updated.real_value });
});

// ── Contributing Accounts ────────────────────────────────────────────────────

// GET /annual-expenses/accounts
router.get('/annual-expenses/accounts', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const selected = db
    .prepare('SELECT account_id FROM annual_expense_accounts WHERE dossier_id = ?')
    .all(req.params.id).map((r) => r.account_id);
  res.json(selected);
});

// PUT /annual-expenses/accounts
router.put('/annual-expenses/accounts', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { account_ids } = req.body;
  if (!Array.isArray(account_ids)) return res.status(400).json({ error: 'account_ids must be an array' });
  const foreign = idsNotInDossier('accounts', req.params.id, account_ids);
  if (foreign.length) return res.status(400).json({ error: `Unknown account id(s) for this dossier: ${foreign.join(', ')}` });

  const doReplace = db.transaction(() => {
    db.prepare('DELETE FROM annual_expense_accounts WHERE dossier_id = ?').run(req.params.id);
    const insert = db.prepare('INSERT OR IGNORE INTO annual_expense_accounts (dossier_id, account_id) VALUES (?, ?)');
    for (const accId of account_ids) {
      insert.run(req.params.id, accId);
    }
  });
  doReplace();
  res.json(account_ids);
});

// ── Contributing Distributions ───────────────────────────────────────────────

// GET /annual-expenses/distributions
router.get('/annual-expenses/distributions', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const selected = db
    .prepare('SELECT distribution_template_id FROM annual_expense_distributions WHERE dossier_id = ?')
    .all(req.params.id).map((r) => r.distribution_template_id);
  res.json(selected);
});

// PUT /annual-expenses/distributions
router.put('/annual-expenses/distributions', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { distribution_template_ids } = req.body;
  if (!Array.isArray(distribution_template_ids)) return res.status(400).json({ error: 'distribution_template_ids must be an array' });
  const foreign = idsNotInDossier('expense_template_items', req.params.id, distribution_template_ids, "AND section = 'distribution'");
  if (foreign.length) {
    return res.status(400).json({ error: `Unknown distribution id(s) for this dossier: ${foreign.join(', ')}` });
  }

  const doReplace = db.transaction(() => {
    db.prepare('DELETE FROM annual_expense_distributions WHERE dossier_id = ?').run(req.params.id);
    const insert = db.prepare('INSERT OR IGNORE INTO annual_expense_distributions (dossier_id, distribution_template_id) VALUES (?, ?)');
    for (const distId of distribution_template_ids) {
      insert.run(req.params.id, distId);
    }
  });
  doReplace();
  res.json(distribution_template_ids);
});

module.exports = router;
module.exports.remainingCycleMonthsInYear = remainingCycleMonthsInYear;
module.exports.computeYearStatus = computeYearStatus;
module.exports.pickInstallmentPayment = pickInstallmentPayment;
module.exports.mergeYearFromTemplate = mergeYearFromTemplate;
