const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// Build the full year status object
function computeYearStatus(yearId, dossierId) {
  const year = db.prepare('SELECT * FROM annual_expense_years WHERE id = ?').get(yearId);
  if (!year) return null;

  const items = db.prepare(`
    SELECT ayi.*,
           COALESCE((
             SELECT COUNT(p.id) * 1.0 * ayi.budgeted_value / NULLIF(ayi.num_installments, 0)
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

  // Get installments and payments for each item
  const itemsWithInstallments = items.map((item) => {
    const installments = db.prepare(`
      SELECT ayii.*, p.id as payment_id, p.cycle_id, p.real_value as payment_real_value, p.paid as payment_paid
      FROM annual_expense_year_installments ayii
      LEFT JOIN annual_expense_payments p ON p.installment_id = ayii.id
      WHERE ayii.year_item_id = ?
      ORDER BY ayii.installment_number
    `).all(item.id);

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

  // Contributing distributions: sum done distributions from cycles in this calendar year
  const selectedDistIds = db
    .prepare('SELECT distribution_template_id FROM annual_expense_distributions WHERE dossier_id = ?')
    .all(dossierId).map((r) => r.distribution_template_id);

  let contributedDistributions = 0;

  if (selectedDistIds.length > 0) {
    // Find cycles whose end date falls within this calendar year
    const dossier = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(dossierId);
    const startDay = dossier?.cycle_start_day ?? 25;
    const cycles = db
      .prepare('SELECT id, year, month FROM expense_cycles WHERE dossier_id = ?')
      .all(dossierId);

    const cyclesInYear = cycles.filter((c) => {
      const endDate = new Date(c.year, c.month, startDay - 1);
      return endDate.getFullYear() === year.year;
    });

    for (const cycle of cyclesInYear) {
      for (const distId of selectedDistIds) {
        // Find cycle items matching this template distribution (by template_item_id)
        const doneItems = db.prepare(
          "SELECT value FROM cycle_items WHERE cycle_id = ? AND template_item_id = ? AND section = 'distribution' AND done = 1"
        ).all(cycle.id, distId);
        contributedDistributions += doneItems.reduce((s, i) => s + (i.value || 0), 0);
      }
    }
  }

  // Compute "needed this cycle": unpaid installments assigned to the currently active cycle
  const dossierRow2 = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(dossierId);
  const cycleStartDay = dossierRow2?.cycle_start_day ?? 25;
  const allCycles = db.prepare('SELECT id, year, month FROM expense_cycles WHERE dossier_id = ?').all(dossierId);
  const today = new Date();
  let currentCycleId = null;
  for (const cycle of allCycles) {
    const cycleStart = new Date(cycle.year, cycle.month - 1, cycleStartDay);
    const cycleEnd = new Date(cycle.year, cycle.month, cycleStartDay - 1);
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

  const doUpdate = db.transaction(() => {
    db.prepare(
      'UPDATE annual_expense_year_items SET name = ?, budgeted_value = ?, classification = ?, num_installments = ? WHERE id = ?'
    ).run(newName, newBv, newClass, newNumInst, req.params.itemId);

    if (Array.isArray(installments)) {
      // Update installments in-place by installment_number to preserve IDs and cascade payments.
      // Only delete installments that are no longer in the new list.
      const existingInsts = db
        .prepare('SELECT * FROM annual_expense_year_installments WHERE year_item_id = ?')
        .all(req.params.itemId);
      const existingByNum = {};
      for (const e of existingInsts) existingByNum[e.installment_number] = e;

      const newNumbers = new Set(installments.map((inst, idx) => inst.installment_number ?? (idx + 1)));
      for (const e of existingInsts) {
        if (!newNumbers.has(e.installment_number)) {
          db.prepare('DELETE FROM annual_expense_year_installments WHERE id = ?').run(e.id);
        }
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

      // Re-assign payments to the correct cycle after date changes.
      const yearRow = db.prepare('SELECT year FROM annual_expense_years WHERE id = ?').get(req.params.yearId);
      const dossierRow = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
      const startDay = dossierRow?.cycle_start_day ?? 25;
      const allCycles = db.prepare('SELECT id, year, month FROM expense_cycles WHERE dossier_id = ?').all(req.params.id);

      const updatedInsts = db.prepare('SELECT * FROM annual_expense_year_installments WHERE year_item_id = ?').all(req.params.itemId);
      for (const inst of updatedInsts) {
        const payment = db.prepare('SELECT * FROM annual_expense_payments WHERE installment_id = ?').get(inst.id);
        if (!payment) continue;

        const instDate = new Date(yearRow.year, inst.month - 1, inst.day);
        let targetCycle = null;
        for (const cycle of allCycles) {
          const cycleStart = new Date(cycle.year, cycle.month - 1, startDay);
          const cycleEnd = new Date(cycle.year, cycle.month, startDay - 1);
          if (instDate >= cycleStart && instDate <= cycleEnd) {
            targetCycle = cycle;
            break;
          }
        }

        if (targetCycle && targetCycle.id !== payment.cycle_id) {
          db.prepare('UPDATE annual_expense_payments SET cycle_id = ? WHERE id = ?').run(targetCycle.id, payment.id);
        } else if (!targetCycle) {
          // No open cycle covers the new date; remove the payment (recreated when cycle is opened)
          db.prepare('DELETE FROM annual_expense_payments WHERE id = ?').run(payment.id);
        }
      }
    }
  });
  doUpdate();

  res.json(computeYearStatus(req.params.yearId, req.params.id));
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

// POST /annual-years/:yearId/sync-from-template
router.post('/annual-years/:yearId/sync-from-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const yearRow = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!yearRow) return res.status(404).json({ error: 'Annual expense year not found' });

  const doSync = db.transaction(() => {
    // Delete template-derived items (cascade deletes installments and payments)
    db.prepare("DELETE FROM annual_expense_year_items WHERE year_id = ? AND from_template = 1").run(req.params.yearId);

    // Add all current template items
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
      insertItem.run(itemId, req.params.yearId, ti.name, ti.value, ti.classification, numInst, ti.position ?? 0);

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
  });

  doSync();
  res.json(computeYearStatus(req.params.yearId, req.params.id));
});

// POST /annual-years/:yearId/sync-to-template
router.post('/annual-years/:yearId/sync-to-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const yearRow = db
    .prepare('SELECT id FROM annual_expense_years WHERE id = ? AND dossier_id = ?')
    .get(req.params.yearId, req.params.id);
  if (!yearRow) return res.status(404).json({ error: 'Annual expense year not found' });

  const doSync = db.transaction(() => {
    db.prepare('DELETE FROM annual_expense_template_items WHERE dossier_id = ?').run(req.params.id);

    const yearItems = db
      .prepare('SELECT * FROM annual_expense_year_items WHERE year_id = ? ORDER BY position')
      .all(req.params.yearId);
    const insertTi = db.prepare(
      'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, classification, position, num_installments) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertTiInst = db.prepare(
      'INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
    );

    for (const yi of yearItems) {
      const tiId = uuidv4();
      insertTi.run(tiId, req.params.id, yi.name, yi.budgeted_value, yi.classification, yi.position, yi.num_installments);

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

  const { paid } = req.body;
  if (paid === undefined) return res.status(400).json({ error: 'paid is required' });

  db.prepare('UPDATE annual_expense_payments SET paid = ? WHERE id = ?')
    .run(paid ? 1 : 0, req.params.paymentId);

  const updated = db.prepare('SELECT * FROM annual_expense_payments WHERE id = ?').get(req.params.paymentId);
  res.json({ id: updated.id, paid: !!updated.paid });
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
