const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

function computeSummary(cycle, items) {
  const expenses = items.filter((i) => i.section === 'expense');
  const distributions = items.filter((i) => i.section === 'distribution');

  const fixedExpenses = expenses.filter((i) => i.type === 'Fixed');
  const budgetExpenses = expenses.filter((i) => i.type === 'Budget');

  const totalExpenses =
    fixedExpenses.reduce((s, i) => s + (i.value || 0), 0) +
    budgetExpenses.reduce((s, i) => s + (i.value || 0), 0);

  const totalExpensesPaid =
    fixedExpenses.filter((i) => i.paid).reduce((s, i) => s + (i.value || 0), 0) +
    budgetExpenses.reduce((s, i) => s + (i.spent || 0), 0);

  const totalDistributions = distributions.reduce((s, i) => s + (i.value || 0), 0);
  const totalDistributionsDone = distributions
    .filter((i) => i.done)
    .reduce((s, i) => s + (i.value || 0), 0);

  const totalAvailable = (cycle.salary || 0) + (cycle.previous_balance || 0);
  const expectedBalance = totalAvailable - totalExpenses - totalDistributions;

  const summary = {
    total_available: totalAvailable,
    total_expenses: totalExpenses,
    total_expenses_paid: totalExpensesPaid,
    total_expenses_unpaid: totalExpenses - totalExpensesPaid,
    total_distributions: totalDistributions,
    total_distributions_done: totalDistributionsDone,
    total_distributions_not_done: totalDistributions - totalDistributionsDone,
    expected_balance: expectedBalance,
  };

  if (cycle.is_closed) {
    summary.final_real_balance = cycle.final_real_balance;
    summary.balance_difference = (cycle.final_real_balance || 0) - expectedBalance;
  }

  return summary;
}

// GET /settings
router.get('/settings', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const dossier = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
  res.json({ cycle_start_day: dossier.cycle_start_day ?? 25 });
});

// PATCH /settings
router.patch('/settings', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { cycle_start_day } = req.body;
  if (
    cycle_start_day == null ||
    !Number.isInteger(cycle_start_day) ||
    cycle_start_day < 1 ||
    cycle_start_day > 28
  ) {
    return res.status(400).json({ error: 'cycle_start_day must be an integer between 1 and 28' });
  }
  db.prepare('UPDATE dossiers SET cycle_start_day = ? WHERE id = ?').run(cycle_start_day, req.params.id);
  res.json({ cycle_start_day });
});

// GET /expense-template
router.get('/expense-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const items = db
    .prepare('SELECT * FROM expense_template_items WHERE dossier_id = ? ORDER BY section, position, created_at')
    .all(req.params.id);
  res.json(items);
});

// POST /expense-template
router.post('/expense-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { section, name, type, value, day_of_payment } = req.body;

  if (!section || !['expense', 'distribution'].includes(section)) {
    return res.status(400).json({ error: 'section must be "expense" or "distribution"' });
  }
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (value == null || isNaN(Number(value)) || Number(value) < 0) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  if (section === 'expense') {
    if (!type || !['Fixed', 'Budget'].includes(type)) {
      return res.status(400).json({ error: 'type must be "Fixed" or "Budget" for expenses' });
    }
    if (
      type === 'Fixed' &&
      (day_of_payment == null ||
        !Number.isInteger(day_of_payment) ||
        day_of_payment < 1 ||
        day_of_payment > 31)
    ) {
      return res.status(400).json({ error: 'day_of_payment is required for Fixed expenses (1-31)' });
    }
  }

  const maxPos = db
    .prepare('SELECT MAX(position) as mp FROM expense_template_items WHERE dossier_id = ? AND section = ?')
    .get(req.params.id, section);
  const position = (maxPos.mp ?? -1) + 1;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    req.params.id,
    section,
    name.trim(),
    type || null,
    Number(value),
    section === 'expense' && type === 'Fixed' ? day_of_payment : null,
    position
  );

  const item = db.prepare('SELECT * FROM expense_template_items WHERE id = ?').get(id);
  res.status(201).json(item);
});

// PUT /expense-template/:itemId
router.put('/expense-template/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT * FROM expense_template_items WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Template item not found' });

  const { name, value, day_of_payment, classification, must_amount, want_amount, save_amount } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  if (value !== undefined && (isNaN(Number(value)) || Number(value) < 0)) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  if (classification !== undefined && classification !== null && !['must', 'want'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be "must" or "want"' });
  }

  const newName = name !== undefined ? name.trim() : item.name;
  const newValue = value !== undefined ? Number(value) : item.value;
  const newDop = day_of_payment !== undefined ? day_of_payment : item.day_of_payment;
  const newClassification = classification !== undefined ? classification : item.classification;
  const newMustAmount = must_amount !== undefined ? (must_amount !== null ? Number(must_amount) : null) : item.must_amount;
  const newWantAmount = want_amount !== undefined ? (want_amount !== null ? Number(want_amount) : null) : item.want_amount;
  const newSaveAmount = save_amount !== undefined ? (save_amount !== null ? Number(save_amount) : null) : item.save_amount;

  db.prepare(
    'UPDATE expense_template_items SET name = ?, value = ?, day_of_payment = ?, classification = ?, must_amount = ?, want_amount = ?, save_amount = ? WHERE id = ?'
  ).run(newName, newValue, newDop, newClassification, newMustAmount, newWantAmount, newSaveAmount, req.params.itemId);

  const updated = db.prepare('SELECT * FROM expense_template_items WHERE id = ?').get(req.params.itemId);
  res.json(updated);
});

// POST /expense-template/bulk-replace
router.post('/expense-template/bulk-replace', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { section, items } = req.body;
  if (!section || !['expense', 'distribution'].includes(section)) {
    return res.status(400).json({ error: 'section must be "expense" or "distribution"' });
  }
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM expense_template_items WHERE dossier_id = ? AND section = ?').run(req.params.id, section);
    const insert = db.prepare(
      'INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, classification, must_amount, want_amount, save_amount, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    items.forEach((item, idx) => {
      insert.run(
        uuidv4(),
        req.params.id,
        section,
        String(item.name).trim(),
        item.type || null,
        Number(item.value) || 0,
        item.day_of_payment != null ? item.day_of_payment : null,
        item.classification || null,
        item.must_amount != null ? Number(item.must_amount) : null,
        item.want_amount != null ? Number(item.want_amount) : null,
        item.save_amount != null ? Number(item.save_amount) : null,
        idx
      );
    });
  });

  replace();
  const newItems = db
    .prepare('SELECT * FROM expense_template_items WHERE dossier_id = ? AND section = ? ORDER BY position')
    .all(req.params.id, section);
  res.json(newItems);
});

// DELETE /expense-template/:itemId
router.delete('/expense-template/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT * FROM expense_template_items WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Template item not found' });
  db.prepare('DELETE FROM expense_template_items WHERE id = ?').run(req.params.itemId);
  res.status(204).end();
});

// GET /cycles
router.get('/cycles', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycles = db
    .prepare('SELECT * FROM expense_cycles WHERE dossier_id = ? ORDER BY year ASC, month ASC')
    .all(req.params.id);
  res.json(cycles);
});

// POST /cycles
router.post('/cycles', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { year, month, salary, previous_balance } = req.body;

  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
  if (salary == null || isNaN(Number(salary))) return res.status(400).json({ error: 'salary is required' });
  if (previous_balance == null || isNaN(Number(previous_balance))) {
    return res.status(400).json({ error: 'previous_balance is required' });
  }

  const existing = db
    .prepare('SELECT id FROM expense_cycles WHERE dossier_id = ? AND year = ? AND month = ?')
    .get(req.params.id, year, month);
  if (existing) return res.status(400).json({ error: 'A cycle for this month already exists' });

  const id = uuidv4();

  const createCycle = db.transaction(() => {
    db.prepare(
      'INSERT INTO expense_cycles (id, dossier_id, year, month, salary, previous_balance) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, req.params.id, year, month, Number(salary), Number(previous_balance));

    const templateItems = db
      .prepare('SELECT * FROM expense_template_items WHERE dossier_id = ? ORDER BY section, position')
      .all(req.params.id);

    const insertItem = db.prepare(
      'INSERT INTO cycle_items (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const maxDay = daysInMonth(year, month);
    for (const ti of templateItems) {
      const clampedDay = ti.day_of_payment != null ? Math.min(ti.day_of_payment, maxDay) : null;
      insertItem.run(uuidv4(), id, ti.id, ti.section, ti.name, ti.type, ti.value, clampedDay, ti.position);
    }
  });

  createCycle();
  const cycle = db.prepare('SELECT * FROM expense_cycles WHERE id = ?').get(id);
  res.status(201).json(cycle);
});

// GET /cycles/:cycleId
router.get('/cycles/:cycleId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare(
      `SELECT ec.*, d.cycle_start_day
       FROM expense_cycles ec
       JOIN dossiers d ON d.id = ec.dossier_id
       WHERE ec.id = ? AND ec.dossier_id = ?`
    )
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const items = db
    .prepare('SELECT * FROM cycle_items WHERE cycle_id = ? ORDER BY section, position, created_at')
    .all(req.params.cycleId);

  const summary = computeSummary(cycle, items);
  res.json({ ...cycle, items, summary });
});

// PATCH /cycles/:cycleId
router.patch('/cycles/:cycleId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { salary, previous_balance, is_closed, final_real_balance } = req.body;
  const newSalary = salary !== undefined ? Number(salary) : cycle.salary;
  const newPrevBalance = previous_balance !== undefined ? Number(previous_balance) : cycle.previous_balance;
  const newIsClosed = is_closed !== undefined ? (is_closed ? 1 : 0) : cycle.is_closed;
  let newFinalRealBalance = final_real_balance !== undefined ? Number(final_real_balance) : cycle.final_real_balance;

  if (newIsClosed && newFinalRealBalance == null) {
    return res.status(400).json({ error: 'final_real_balance is required when closing a cycle' });
  }

  db.prepare(
    'UPDATE expense_cycles SET salary = ?, previous_balance = ?, is_closed = ?, final_real_balance = ? WHERE id = ?'
  ).run(newSalary, newPrevBalance, newIsClosed, newFinalRealBalance, req.params.cycleId);

  const updated = db.prepare('SELECT * FROM expense_cycles WHERE id = ?').get(req.params.cycleId);
  res.json(updated);
});

// POST /cycles/:cycleId/items
router.post('/cycles/:cycleId/items', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { section, name, type, value, day_of_payment } = req.body;
  if (!section || !['expense', 'distribution'].includes(section)) {
    return res.status(400).json({ error: 'section must be "expense" or "distribution"' });
  }
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (value == null || isNaN(Number(value)) || Number(value) < 0) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  if (section === 'expense') {
    if (!type || !['Fixed', 'Budget'].includes(type)) {
      return res.status(400).json({ error: 'type must be "Fixed" or "Budget" for expenses' });
    }
    if (
      type === 'Fixed' &&
      (day_of_payment == null ||
        !Number.isInteger(day_of_payment) ||
        day_of_payment < 1 ||
        day_of_payment > 31)
    ) {
      return res.status(400).json({ error: 'day_of_payment is required for Fixed expenses (1-31)' });
    }
  }

  const maxPos = db
    .prepare('SELECT MAX(position) as mp FROM cycle_items WHERE cycle_id = ? AND section = ?')
    .get(req.params.cycleId, section);
  const position = (maxPos.mp ?? -1) + 1;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO cycle_items (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    req.params.cycleId,
    null,
    section,
    name.trim(),
    type || null,
    Number(value),
    section === 'expense' && type === 'Fixed' ? day_of_payment : null,
    position
  );

  const item = db.prepare('SELECT * FROM cycle_items WHERE id = ?').get(id);
  res.status(201).json(item);
});

// PATCH /cycles/:cycleId/items/:itemId
router.patch('/cycles/:cycleId/items/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const item = db
    .prepare('SELECT * FROM cycle_items WHERE id = ? AND cycle_id = ?')
    .get(req.params.itemId, req.params.cycleId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { name, value, day_of_payment, paid, spent, done } = req.body;

  let newValue = item.value;
  if (value !== undefined) {
    newValue = Number(value);
    if (isNaN(newValue) || newValue < 0) {
      return res.status(400).json({ error: 'value must be a non-negative number' });
    }
  }

  let newSpent = item.spent;
  if (spent !== undefined) {
    newSpent = Number(spent);
    if (isNaN(newSpent) || newSpent < 0) {
      return res.status(400).json({ error: 'spent must be a non-negative number' });
    }
    if (item.type === 'Budget' && newSpent > newValue) {
      return res.status(400).json({ error: 'Spent amount cannot exceed the budget maximum' });
    }
  }

  const newName = name !== undefined ? name.trim() : item.name;
  const newDop = day_of_payment !== undefined ? day_of_payment : item.day_of_payment;
  const newPaid = paid !== undefined ? (paid ? 1 : 0) : item.paid;
  const newDone = done !== undefined ? (done ? 1 : 0) : item.done;

  db.prepare(
    'UPDATE cycle_items SET name = ?, value = ?, day_of_payment = ?, paid = ?, spent = ?, done = ? WHERE id = ?'
  ).run(newName, newValue, newDop, newPaid, newSpent, newDone, req.params.itemId);

  const updated = db.prepare('SELECT * FROM cycle_items WHERE id = ?').get(req.params.itemId);
  res.json(updated);
});

// DELETE /cycles/:cycleId/items/:itemId
router.delete('/cycles/:cycleId/items/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const item = db
    .prepare('SELECT * FROM cycle_items WHERE id = ? AND cycle_id = ?')
    .get(req.params.itemId, req.params.cycleId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  db.prepare('DELETE FROM cycle_items WHERE id = ?').run(req.params.itemId);
  res.status(204).end();
});

// ── Annual Expense Template ──────────────────────────────────────────────────

// GET /annual-expense-template
router.get('/annual-expense-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const items = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position, created_at')
    .all(req.params.id);
  res.json(items);
});

// POST /annual-expense-template
router.post('/annual-expense-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { name, value, day_of_payment, month_of_payment, classification } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (value == null || isNaN(Number(value)) || Number(value) < 0) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  if (classification && !['must', 'want'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be "must" or "want"' });
  }

  const maxPos = db
    .prepare('SELECT MAX(position) as mp FROM annual_expense_template_items WHERE dossier_id = ?')
    .get(req.params.id);
  const position = (maxPos.mp ?? -1) + 1;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    req.params.id,
    String(name).trim(),
    Number(value),
    day_of_payment != null ? day_of_payment : null,
    month_of_payment != null ? month_of_payment : null,
    classification || null,
    position
  );

  const item = db.prepare('SELECT * FROM annual_expense_template_items WHERE id = ?').get(id);
  res.status(201).json(item);
});

// PUT /annual-expense-template/:itemId
router.put('/annual-expense-template/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Template item not found' });

  const { name, value, day_of_payment, month_of_payment, classification } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
  if (value !== undefined && (isNaN(Number(value)) || Number(value) < 0)) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  if (classification !== undefined && classification !== null && !['must', 'want'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be "must" or "want"' });
  }

  const newName = name !== undefined ? String(name).trim() : item.name;
  const newValue = value !== undefined ? Number(value) : item.value;
  const newDop = day_of_payment !== undefined ? day_of_payment : item.day_of_payment;
  const newMop = month_of_payment !== undefined ? month_of_payment : item.month_of_payment;
  const newClassification = classification !== undefined ? classification : item.classification;

  db.prepare(
    'UPDATE annual_expense_template_items SET name = ?, value = ?, day_of_payment = ?, month_of_payment = ?, classification = ? WHERE id = ?'
  ).run(newName, newValue, newDop, newMop, newClassification, req.params.itemId);

  const updated = db.prepare('SELECT * FROM annual_expense_template_items WHERE id = ?').get(req.params.itemId);
  res.json(updated);
});

// DELETE /annual-expense-template/:itemId
router.delete('/annual-expense-template/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Template item not found' });
  db.prepare('DELETE FROM annual_expense_template_items WHERE id = ?').run(req.params.itemId);
  res.status(204).end();
});

// POST /annual-expense-template/bulk-replace
router.post('/annual-expense-template/bulk-replace', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM annual_expense_template_items WHERE dossier_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    items.forEach((item, idx) => {
      insert.run(
        uuidv4(),
        req.params.id,
        String(item.name).trim(),
        Number(item.value) || 0,
        item.day_of_payment != null ? item.day_of_payment : null,
        item.month_of_payment != null ? item.month_of_payment : null,
        item.classification || null,
        idx
      );
    });
  });

  replace();
  const newItems = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(req.params.id);
  res.json(newItems);
});

// ── Workbench Snapshots ──────────────────────────────────────────────────────

// GET /workbench-snapshots
router.get('/workbench-snapshots', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const snapshots = db
    .prepare('SELECT * FROM workbench_snapshots WHERE dossier_id = ? ORDER BY updated_at DESC')
    .all(req.params.id);
  res.json(snapshots.map((s) => ({ ...s, data: JSON.parse(s.data) })));
});

// POST /workbench-snapshots
router.post('/workbench-snapshots', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { name, data } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (data == null) return res.status(400).json({ error: 'data is required' });

  const id = uuidv4();
  db.prepare('INSERT INTO workbench_snapshots (id, dossier_id, name, data) VALUES (?, ?, ?, ?)').run(
    id,
    req.params.id,
    String(name).trim(),
    JSON.stringify(data)
  );

  const snapshot = db.prepare('SELECT * FROM workbench_snapshots WHERE id = ?').get(id);
  res.status(201).json({ ...snapshot, data: JSON.parse(snapshot.data) });
});

// PUT /workbench-snapshots/:snapshotId
router.put('/workbench-snapshots/:snapshotId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const snapshot = db
    .prepare('SELECT * FROM workbench_snapshots WHERE id = ? AND dossier_id = ?')
    .get(req.params.snapshotId, req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const { data } = req.body;
  if (data == null) return res.status(400).json({ error: 'data is required' });

  db.prepare("UPDATE workbench_snapshots SET data = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(data),
    req.params.snapshotId
  );

  const updated = db.prepare('SELECT * FROM workbench_snapshots WHERE id = ?').get(req.params.snapshotId);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

// POST /workbench-snapshots/:snapshotId/duplicate
router.post('/workbench-snapshots/:snapshotId/duplicate', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const snapshot = db
    .prepare('SELECT * FROM workbench_snapshots WHERE id = ? AND dossier_id = ?')
    .get(req.params.snapshotId, req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const newId = uuidv4();
  db.prepare('INSERT INTO workbench_snapshots (id, dossier_id, name, data) VALUES (?, ?, ?, ?)').run(
    newId,
    req.params.id,
    `Copy of ${snapshot.name}`,
    snapshot.data
  );

  const newSnapshot = db.prepare('SELECT * FROM workbench_snapshots WHERE id = ?').get(newId);
  res.status(201).json({ ...newSnapshot, data: JSON.parse(newSnapshot.data) });
});

// DELETE /workbench-snapshots/:snapshotId
router.delete('/workbench-snapshots/:snapshotId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const snapshot = db
    .prepare('SELECT * FROM workbench_snapshots WHERE id = ? AND dossier_id = ?')
    .get(req.params.snapshotId, req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
  db.prepare('DELETE FROM workbench_snapshots WHERE id = ?').run(req.params.snapshotId);
  res.status(204).end();
});

module.exports = router;
