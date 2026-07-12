const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Create an annual expense year from the current template for a given calendar year
function createAnnualYearFromTemplate(dossierId, calYear) {
  const yearId = uuidv4();
  db.prepare('INSERT INTO annual_expense_years (id, dossier_id, year, carryover) VALUES (?, ?, ?, 0)')
    .run(yearId, dossierId, calYear);

  const templateItems = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(dossierId);
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

    const templateInsts = db
      .prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number')
      .all(ti.id);

    if (templateInsts.length > 0) {
      for (const inst of templateInsts) {
        insertInst.run(uuidv4(), itemId, inst.installment_number, inst.month, inst.day);
      }
    } else if (ti.day_of_payment != null && ti.month_of_payment != null) {
      insertInst.run(uuidv4(), itemId, 1, ti.month_of_payment, ti.day_of_payment);
    }
  }

  return yearId;
}

// Create payment records for a cycle based on annual expense year installments
function createAnnualPaymentsForCycle(dossierId, cycleId, cycleYear, cycleMonth, startDay) {
  const cycleStartDate = new Date(cycleYear, cycleMonth - 1, startDay);
  const cycleEndDate = new Date(cycleYear, cycleMonth, startDay - 1);
  const startCalYear = cycleStartDate.getFullYear();
  const endCalYear = cycleEndDate.getFullYear();
  const calYears = startCalYear === endCalYear ? [startCalYear] : [startCalYear, endCalYear];

  const insertPayment = db.prepare(
    'INSERT OR IGNORE INTO annual_expense_payments (id, installment_id, cycle_id, real_value, paid) VALUES (?, ?, ?, ?, 0)'
  );

  for (const calYear of calYears) {
    let annualYear = db
      .prepare('SELECT id FROM annual_expense_years WHERE dossier_id = ? AND year = ?')
      .get(dossierId, calYear);
    if (!annualYear) {
      const yearId = createAnnualYearFromTemplate(dossierId, calYear);
      annualYear = { id: yearId };
    }

    const installments = db.prepare(`
      SELECT ayii.id as installment_id, ayii.month, ayii.day,
             ayi.budgeted_value, ayi.num_installments
      FROM annual_expense_year_items ayi
      JOIN annual_expense_year_installments ayii ON ayii.year_item_id = ayi.id
      WHERE ayi.year_id = ?
    `).all(annualYear.id);

    for (const inst of installments) {
      const instDate = new Date(calYear, inst.month - 1, inst.day);
      if (instDate >= cycleStartDate && instDate <= cycleEndDate) {
        const expectedValue = inst.budgeted_value / (inst.num_installments || 1);
        insertPayment.run(uuidv4(), inst.installment_id, cycleId, expectedValue);
      }
    }
  }
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

  const distributionsByAccountMap = new Map();
  for (const d of distributions) {
    const key = d.account_id ?? null;
    distributionsByAccountMap.set(key, (distributionsByAccountMap.get(key) ?? 0) + (d.value || 0));
  }
  const distributionsByAccount = [...distributionsByAccountMap.entries()].map(([account_id, total]) => ({
    account_id,
    total,
  }));

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
    distributions_by_account: distributionsByAccount,
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
  const dossier = db
    .prepare('SELECT cycle_start_day, capital_snapshot_warning_day, next_cycle_warning_day, previous_cycle_close_warning_day, emergency_fund_months_multiplier, emergency_fund_cycles_to_average, paperless_url, paperless_token, paperless_date_field_id, paperless_amount_field_id, expense_notification_days_before, ai_model FROM dossiers WHERE id = ?')
    .get(req.params.id);
  res.json({
    cycle_start_day: dossier.cycle_start_day ?? 25,
    capital_snapshot_warning_day: dossier.capital_snapshot_warning_day ?? 7,
    next_cycle_warning_day: dossier.next_cycle_warning_day ?? 22,
    previous_cycle_close_warning_day: dossier.previous_cycle_close_warning_day ?? 25,
    emergency_fund_months_multiplier: dossier.emergency_fund_months_multiplier ?? 6,
    emergency_fund_cycles_to_average: dossier.emergency_fund_cycles_to_average ?? 6,
    paperless_url: dossier.paperless_url ?? null,
    paperless_token_set: !!dossier.paperless_token,
    paperless_date_field_id: dossier.paperless_date_field_id ?? null,
    paperless_amount_field_id: dossier.paperless_amount_field_id ?? null,
    expense_notification_days_before: dossier.expense_notification_days_before ?? 1,
    ai_model: dossier.ai_model ?? 'claude-opus-4-8',
  });
});

const ALLOWED_AI_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'];

function isValidDay(v) {
  return v != null && Number.isInteger(v) && v >= 1 && v <= 28;
}

// PATCH /settings
router.patch('/settings', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const {
    cycle_start_day,
    capital_snapshot_warning_day,
    next_cycle_warning_day,
    previous_cycle_close_warning_day,
    emergency_fund_months_multiplier,
    emergency_fund_cycles_to_average,
    paperless_url,
    paperless_token,
    paperless_date_field_id,
    paperless_amount_field_id,
    expense_notification_days_before,
    ai_model,
  } = req.body;

  if (cycle_start_day !== undefined && !isValidDay(cycle_start_day)) {
    return res.status(400).json({ error: 'cycle_start_day must be an integer between 1 and 28' });
  }
  if (capital_snapshot_warning_day !== undefined && !isValidDay(capital_snapshot_warning_day)) {
    return res.status(400).json({ error: 'capital_snapshot_warning_day must be an integer between 1 and 28' });
  }
  if (next_cycle_warning_day !== undefined && !isValidDay(next_cycle_warning_day)) {
    return res.status(400).json({ error: 'next_cycle_warning_day must be an integer between 1 and 28' });
  }
  if (previous_cycle_close_warning_day !== undefined && !isValidDay(previous_cycle_close_warning_day)) {
    return res.status(400).json({ error: 'previous_cycle_close_warning_day must be an integer between 1 and 28' });
  }
  if (emergency_fund_months_multiplier !== undefined) {
    const v = emergency_fund_months_multiplier;
    if (!Number.isInteger(v) || v < 1) return res.status(400).json({ error: 'emergency_fund_months_multiplier must be an integer ≥ 1' });
  }
  if (emergency_fund_cycles_to_average !== undefined) {
    const v = emergency_fund_cycles_to_average;
    if (!Number.isInteger(v) || v < 1) return res.status(400).json({ error: 'emergency_fund_cycles_to_average must be an integer ≥ 1' });
  }
  if (paperless_date_field_id !== undefined && paperless_date_field_id !== null && !Number.isInteger(paperless_date_field_id)) {
    return res.status(400).json({ error: 'paperless_date_field_id must be an integer' });
  }
  if (paperless_amount_field_id !== undefined && paperless_amount_field_id !== null && !Number.isInteger(paperless_amount_field_id)) {
    return res.status(400).json({ error: 'paperless_amount_field_id must be an integer' });
  }
  if (expense_notification_days_before !== undefined) {
    const v = expense_notification_days_before;
    if (!Number.isInteger(v) || v < 0 || v > 7) {
      return res.status(400).json({ error: 'expense_notification_days_before must be an integer between 0 and 7' });
    }
  }
  if (ai_model !== undefined && !ALLOWED_AI_MODELS.includes(ai_model)) {
    return res.status(400).json({ error: `ai_model must be one of: ${ALLOWED_AI_MODELS.join(', ')}` });
  }

  const updates = [];
  const params = [];
  if (cycle_start_day !== undefined) { updates.push('cycle_start_day = ?'); params.push(cycle_start_day); }
  if (capital_snapshot_warning_day !== undefined) { updates.push('capital_snapshot_warning_day = ?'); params.push(capital_snapshot_warning_day); }
  if (next_cycle_warning_day !== undefined) { updates.push('next_cycle_warning_day = ?'); params.push(next_cycle_warning_day); }
  if (previous_cycle_close_warning_day !== undefined) { updates.push('previous_cycle_close_warning_day = ?'); params.push(previous_cycle_close_warning_day); }
  if (emergency_fund_months_multiplier !== undefined) { updates.push('emergency_fund_months_multiplier = ?'); params.push(emergency_fund_months_multiplier); }
  if (emergency_fund_cycles_to_average !== undefined) { updates.push('emergency_fund_cycles_to_average = ?'); params.push(emergency_fund_cycles_to_average); }
  if (paperless_url !== undefined) { updates.push('paperless_url = ?'); params.push(paperless_url || null); }
  if (paperless_token !== undefined) { updates.push('paperless_token = ?'); params.push(paperless_token || null); }
  if (paperless_date_field_id !== undefined) { updates.push('paperless_date_field_id = ?'); params.push(paperless_date_field_id); }
  if (paperless_amount_field_id !== undefined) { updates.push('paperless_amount_field_id = ?'); params.push(paperless_amount_field_id); }
  if (expense_notification_days_before !== undefined) { updates.push('expense_notification_days_before = ?'); params.push(expense_notification_days_before); }
  if (ai_model !== undefined) { updates.push('ai_model = ?'); params.push(ai_model); }

  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE dossiers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  console.log(`[settings] Updated settings for dossier ${req.params.id} by user ${req.user.username}: ${updates.map((u) => u.split(' = ')[0]).join(', ')}`);

  const updated = db
    .prepare('SELECT cycle_start_day, capital_snapshot_warning_day, next_cycle_warning_day, previous_cycle_close_warning_day, emergency_fund_months_multiplier, emergency_fund_cycles_to_average, paperless_url, paperless_token, paperless_date_field_id, paperless_amount_field_id, expense_notification_days_before, ai_model FROM dossiers WHERE id = ?')
    .get(req.params.id);
  res.json({
    cycle_start_day: updated.cycle_start_day ?? 25,
    capital_snapshot_warning_day: updated.capital_snapshot_warning_day ?? 7,
    next_cycle_warning_day: updated.next_cycle_warning_day ?? 22,
    previous_cycle_close_warning_day: updated.previous_cycle_close_warning_day ?? 25,
    emergency_fund_months_multiplier: updated.emergency_fund_months_multiplier ?? 6,
    emergency_fund_cycles_to_average: updated.emergency_fund_cycles_to_average ?? 6,
    paperless_url: updated.paperless_url ?? null,
    paperless_token_set: !!updated.paperless_token,
    paperless_date_field_id: updated.paperless_date_field_id ?? null,
    paperless_amount_field_id: updated.paperless_amount_field_id ?? null,
    expense_notification_days_before: updated.expense_notification_days_before ?? 1,
    ai_model: updated.ai_model ?? 'claude-opus-4-8',
  });
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
  const { section, name, type, value, day_of_payment, paperless_tag_id, exclude_from_emergency_fund, account_id } = req.body;

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
  if (section === 'distribution' && account_id != null) {
    const acc = db.prepare('SELECT can_receive_transfers FROM accounts WHERE id = ? AND dossier_id = ?').get(account_id, req.params.id);
    if (!acc) return res.status(400).json({ error: 'account_id does not belong to this dossier' });
    if (!acc.can_receive_transfers) return res.status(400).json({ error: 'This account cannot receive transfers' });
  }

  const maxPos = db
    .prepare('SELECT MAX(position) as mp FROM expense_template_items WHERE dossier_id = ? AND section = ?')
    .get(req.params.id, section);
  const position = (maxPos.mp ?? -1) + 1;

  const tagId = section === 'expense' && type === 'Fixed' && paperless_tag_id != null ? Number(paperless_tag_id) : null;
  const excludeFromEF = section === 'expense' && exclude_from_emergency_fund ? 1 : 0;
  const accountId = section === 'distribution' && account_id != null ? account_id : null;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, position, paperless_tag_id, exclude_from_emergency_fund, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    req.params.id,
    section,
    name.trim(),
    type || null,
    Number(value),
    section === 'expense' && type === 'Fixed' ? day_of_payment : null,
    position,
    tagId,
    excludeFromEF,
    accountId
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

  const { name, value, day_of_payment, classification, must_amount, want_amount, save_amount, paperless_tag_id, exclude_from_emergency_fund, account_id } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  if (value !== undefined && (isNaN(Number(value)) || Number(value) < 0)) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  if (classification !== undefined && classification !== null && !['must', 'want'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be "must" or "want"' });
  }
  if (account_id !== undefined && account_id !== null) {
    const acc = db.prepare('SELECT can_receive_transfers FROM accounts WHERE id = ? AND dossier_id = ?').get(account_id, req.params.id);
    if (!acc) return res.status(400).json({ error: 'account_id does not belong to this dossier' });
    if (!acc.can_receive_transfers) return res.status(400).json({ error: 'This account cannot receive transfers' });
  }

  const newName = name !== undefined ? name.trim() : item.name;
  const newValue = value !== undefined ? Number(value) : item.value;
  const newDop = day_of_payment !== undefined ? day_of_payment : item.day_of_payment;
  const newClassification = classification !== undefined ? classification : item.classification;
  const newMustAmount = must_amount !== undefined ? (must_amount !== null ? Number(must_amount) : null) : item.must_amount;
  const newWantAmount = want_amount !== undefined ? (want_amount !== null ? Number(want_amount) : null) : item.want_amount;
  const newSaveAmount = save_amount !== undefined ? (save_amount !== null ? Number(save_amount) : null) : item.save_amount;
  const newTagId = paperless_tag_id !== undefined ? (paperless_tag_id !== null ? Number(paperless_tag_id) : null) : item.paperless_tag_id;
  const newExcludeFromEF =
    exclude_from_emergency_fund !== undefined
      ? (item.section === 'expense' && exclude_from_emergency_fund ? 1 : 0)
      : item.exclude_from_emergency_fund;
  const newAccountId = account_id !== undefined ? (account_id || null) : item.account_id;

  const apply = db.transaction(() => {
    db.prepare(
      'UPDATE expense_template_items SET name = ?, value = ?, day_of_payment = ?, classification = ?, must_amount = ?, want_amount = ?, save_amount = ?, paperless_tag_id = ?, exclude_from_emergency_fund = ?, account_id = ? WHERE id = ?'
    ).run(newName, newValue, newDop, newClassification, newMustAmount, newWantAmount, newSaveAmount, newTagId, newExcludeFromEF, newAccountId, req.params.itemId);

    // Propagate exclusion flag to all linked cycle items so the EF average updates retroactively.
    if (exclude_from_emergency_fund !== undefined && item.section === 'expense') {
      db.prepare('UPDATE cycle_items SET exclude_from_emergency_fund = ? WHERE template_item_id = ?')
        .run(newExcludeFromEF, req.params.itemId);
    }
  });
  apply();

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
      'INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, classification, must_amount, want_amount, save_amount, position, paperless_tag_id, exclude_from_emergency_fund, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    items.forEach((item, idx) => {
      const tagId = section === 'expense' && item.type === 'Fixed' && item.paperless_tag_id != null ? Number(item.paperless_tag_id) : null;
      const excludeFromEF = section === 'expense' && item.exclude_from_emergency_fund ? 1 : 0;
      const accountId = section === 'distribution' && item.account_id != null ? item.account_id : null;
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
        idx,
        tagId,
        excludeFromEF,
        accountId
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

  const dossierSettings = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
  const startDay = dossierSettings?.cycle_start_day ?? 25;

  const createCycle = db.transaction(() => {
    db.prepare(
      'INSERT INTO expense_cycles (id, dossier_id, year, month, salary, previous_balance) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, req.params.id, year, month, Number(salary), Number(previous_balance));

    const templateItems = db
      .prepare('SELECT * FROM expense_template_items WHERE dossier_id = ? ORDER BY section, position')
      .all(req.params.id);

    const transferableAccountIds = new Set(
      db.prepare('SELECT id FROM accounts WHERE dossier_id = ? AND can_receive_transfers = 1').all(req.params.id).map((a) => a.id)
    );

    const insertItem = db.prepare(
      'INSERT INTO cycle_items (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, position, paperless_tag_id, exclude_from_emergency_fund, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const maxDay = daysInMonth(year, month);
    for (const ti of templateItems) {
      const clampedDay = ti.day_of_payment != null ? Math.min(ti.day_of_payment, maxDay) : null;
      const accountId = ti.account_id != null && transferableAccountIds.has(ti.account_id) ? ti.account_id : null;
      insertItem.run(uuidv4(), id, ti.id, ti.section, ti.name, ti.type, ti.value, clampedDay, ti.position, ti.paperless_tag_id ?? null, ti.exclude_from_emergency_fund ?? 0, accountId);
    }

    // Auto-create annual years and payment records for this cycle's date range
    createAnnualPaymentsForCycle(req.params.id, id, year, month, startDay);
  });

  createCycle();
  const cycle = db.prepare('SELECT * FROM expense_cycles WHERE id = ?').get(id);
  console.log(`[cycles] Created cycle ${year}/${month} (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
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

  const annualPayments = db.prepare(`
    SELECT p.id, p.paid,
           ayi.id as year_item_id, ayi.name, ayi.num_installments, ayi.budgeted_value,
           ayi.classification, ayi.position as item_position,
           ayii.installment_number, ayii.month, ayii.day,
           aey.id as year_id, aey.year as expense_year
    FROM annual_expense_payments p
    JOIN annual_expense_year_installments ayii ON ayii.id = p.installment_id
    JOIN annual_expense_year_items ayi ON ayi.id = ayii.year_item_id
    JOIN annual_expense_years aey ON aey.id = ayi.year_id
    WHERE p.cycle_id = ?
    ORDER BY ayi.position, ayii.installment_number
  `).all(req.params.cycleId);

  const summary = computeSummary(cycle, items);
  res.json({ ...cycle, items, annual_payments: annualPayments, summary });
});

// PATCH /cycles/:cycleId
router.patch('/cycles/:cycleId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { year, month, salary, previous_balance, is_closed, final_real_balance } = req.body;

  // If year/month are being changed, enforce uniqueness
  const newYear = year !== undefined ? Number(year) : cycle.year;
  const newMonth = month !== undefined ? Number(month) : cycle.month;
  if ((newYear !== cycle.year || newMonth !== cycle.month)) {
    const conflict = db
      .prepare('SELECT id FROM expense_cycles WHERE dossier_id = ? AND year = ? AND month = ? AND id != ?')
      .get(req.params.id, newYear, newMonth, req.params.cycleId);
    if (conflict) return res.status(409).json({ error: 'A cycle for that period already exists' });
  }

  const newSalary = salary !== undefined ? Number(salary) : cycle.salary;
  const newPrevBalance = previous_balance !== undefined ? Number(previous_balance) : cycle.previous_balance;
  const newIsClosed = is_closed !== undefined ? (is_closed ? 1 : 0) : cycle.is_closed;
  let newFinalRealBalance = final_real_balance !== undefined ? Number(final_real_balance) : cycle.final_real_balance;

  if (newIsClosed && newFinalRealBalance == null) {
    return res.status(400).json({ error: 'final_real_balance is required when closing a cycle' });
  }

  db.prepare(
    'UPDATE expense_cycles SET year = ?, month = ?, salary = ?, previous_balance = ?, is_closed = ?, final_real_balance = ? WHERE id = ?'
  ).run(newYear, newMonth, newSalary, newPrevBalance, newIsClosed, newFinalRealBalance, req.params.cycleId);

  if (is_closed !== undefined && newIsClosed !== cycle.is_closed) {
    const action = newIsClosed ? 'Closed' : 'Reopened';
    console.log(`[cycles] ${action} cycle ${newYear}/${newMonth} (${req.params.cycleId}) in dossier ${req.params.id} by user ${req.user.username}`);
  }

  const updated = db.prepare('SELECT * FROM expense_cycles WHERE id = ?').get(req.params.cycleId);
  res.json(updated);
});

// DELETE /cycles/:cycleId
router.delete('/cycles/:cycleId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  db.prepare('DELETE FROM cycle_items WHERE cycle_id = ?').run(req.params.cycleId);
  db.prepare('DELETE FROM expense_cycles WHERE id = ?').run(req.params.cycleId);
  console.log(`[cycles] Deleted cycle ${cycle.year}/${cycle.month} (${req.params.cycleId}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

// POST /cycles/:cycleId/pull-annual-expenses
router.post('/cycles/:cycleId/pull-annual-expenses', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { cycle_start_day } = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
  const startDay = cycle_start_day ?? 25;

  createAnnualPaymentsForCycle(req.params.id, req.params.cycleId, cycle.year, cycle.month, startDay);
  console.log(`[cycles] Pulled annual expenses for cycle ${cycle.year}/${cycle.month} (${req.params.cycleId}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

// POST /cycles/:cycleId/items
router.post('/cycles/:cycleId/items', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { section, name, type, value, day_of_payment, paperless_tag_id, account_id } = req.body;
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
  if (section === 'distribution' && account_id != null) {
    const acc = db.prepare('SELECT can_receive_transfers FROM accounts WHERE id = ? AND dossier_id = ?').get(account_id, req.params.id);
    if (!acc) return res.status(400).json({ error: 'account_id does not belong to this dossier' });
    if (!acc.can_receive_transfers) return res.status(400).json({ error: 'This account cannot receive transfers' });
  }

  const maxPos = db
    .prepare('SELECT MAX(position) as mp FROM cycle_items WHERE cycle_id = ? AND section = ?')
    .get(req.params.cycleId, section);
  const position = (maxPos.mp ?? -1) + 1;

  const tagId = section === 'expense' && type === 'Fixed' && paperless_tag_id != null ? Number(paperless_tag_id) : null;
  const accountId = section === 'distribution' && account_id != null ? account_id : null;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO cycle_items (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, position, paperless_tag_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    req.params.cycleId,
    null,
    section,
    name.trim(),
    type || null,
    Number(value),
    section === 'expense' && type === 'Fixed' ? day_of_payment : null,
    position,
    tagId,
    accountId
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

  const { name, value, day_of_payment, paid, spent, done, paperless_tag_id, account_id } = req.body;

  if (account_id !== undefined && account_id !== null) {
    const acc = db.prepare('SELECT can_receive_transfers FROM accounts WHERE id = ? AND dossier_id = ?').get(account_id, req.params.id);
    if (!acc) return res.status(400).json({ error: 'account_id does not belong to this dossier' });
    if (!acc.can_receive_transfers) return res.status(400).json({ error: 'This account cannot receive transfers' });
  }

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
  const newTagId = paperless_tag_id !== undefined ? (paperless_tag_id !== null ? Number(paperless_tag_id) : null) : item.paperless_tag_id;
  const newAccountId = account_id !== undefined ? (account_id || null) : item.account_id;

  db.prepare(
    'UPDATE cycle_items SET name = ?, value = ?, day_of_payment = ?, paid = ?, spent = ?, done = ?, paperless_tag_id = ?, account_id = ? WHERE id = ?'
  ).run(newName, newValue, newDop, newPaid, newSpent, newDone, newTagId, newAccountId, req.params.itemId);

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

// GET /cycles/:cycleId/paperless-fetch
router.get('/cycles/:cycleId/paperless-fetch', async (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const dossier = db
    .prepare('SELECT cycle_start_day, paperless_url, paperless_token, paperless_date_field_id, paperless_amount_field_id FROM dossiers WHERE id = ?')
    .get(req.params.id);

  if (!dossier.paperless_url || !dossier.paperless_token || !dossier.paperless_date_field_id || !dossier.paperless_amount_field_id) {
    return res.status(400).json({ error: 'Paperless-ngx integration is not configured' });
  }

  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const linkedItems = db
    .prepare("SELECT * FROM cycle_items WHERE cycle_id = ? AND section = 'expense' AND type = 'Fixed' AND paperless_tag_id IS NOT NULL")
    .all(req.params.cycleId);

  const prefix = `[paperless] dossier=${req.params.id} cycle=${req.params.cycleId}`;

  if (linkedItems.length === 0) {
    console.log(`${prefix} no linked items — skipping fetch`);
    return res.json({ results: [], warnings: [] });
  }

  const startDay = dossier.cycle_start_day ?? 25;
  const { year, month } = cycle;
  const startDate = `${year}-${String(month).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  const endDateObj = new Date(year, month, startDay - 1);
  const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

  const tagIds = [...new Set(linkedItems.map((i) => i.paperless_tag_id))].join(',');
  const query = JSON.stringify(['AND', [[dossier.paperless_date_field_id, 'gte', startDate], [dossier.paperless_date_field_id, 'lte', endDate]]]);
  const url = `${dossier.paperless_url}/api/documents/?tags__id__in=${tagIds}&custom_field_query=${encodeURIComponent(query)}&page_size=100`;

  console.log(`${prefix} fetching — url=${url} tags=[${tagIds}] range=${startDate}..${endDate} linked_items=${linkedItems.length}`);

  let paperlessData;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: { Authorization: `Token ${dossier.paperless_token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`${prefix} response status=${resp.status}`);
    if (!resp.ok) {
      console.error(`${prefix} error — Paperless returned HTTP ${resp.status}`);
      return res.status(502).json({ error: `Paperless-ngx returned an error: ${resp.status}` });
    }
    paperlessData = await resp.json();
    console.log(`${prefix} received ${paperlessData.results?.length ?? 0} document(s)`);
  } catch (err) {
    console.error(`${prefix} connection failed — ${err.message}`);
    return res.status(502).json({ error: 'Could not connect to Paperless-ngx' });
  }

  const documents = paperlessData.results ?? [];
  const warnings = [];

  // Group matched documents by cycle_item_id
  const byItem = {};
  for (const doc of documents) {
    const docTags = doc.tags ?? [];
    const matchingItems = linkedItems.filter((i) => docTags.includes(i.paperless_tag_id));

    if (matchingItems.length === 0) {
      console.log(`${prefix} doc id=${doc.id} title="${doc.title}" tags=[${docTags.join(',')}] — no matching cycle items`);
      continue;
    }

    for (const ci of matchingItems) {
      const cfValues = doc.custom_fields ?? [];
      const amountEntry = cfValues.find((f) => f.field === dossier.paperless_amount_field_id);
      const dateEntry = cfValues.find((f) => f.field === dossier.paperless_date_field_id);

      if (!amountEntry) {
        const warn = `Document "${doc.title}" (id ${doc.id}): amount field not found`;
        console.warn(`${prefix} ${warn}`);
        warnings.push(warn);
        continue;
      }

      const rawAmount = String(amountEntry.value ?? '').replace(/^[A-Za-z]*/, '');
      const parsedAmount = parseFloat(rawAmount);
      if (isNaN(parsedAmount)) {
        const warn = `Document "${doc.title}" (id ${doc.id}): could not parse amount "${amountEntry.value}"`;
        console.warn(`${prefix} ${warn}`);
        warnings.push(warn);
        continue;
      }

      const dateStr = dateEntry ? String(dateEntry.value) : null;
      const dayOfPayment = dateStr ? new Date(dateStr).getDate() : null;

      console.log(`${prefix} doc id=${doc.id} title="${doc.title}" matched item="${ci.name}" amount=${parsedAmount} date=${dateStr}`);

      if (!byItem[ci.id]) {
        byItem[ci.id] = { item: ci, docs: [] };
      }
      byItem[ci.id].docs.push({ doc, amount: parsedAmount, date: dateStr, day: dayOfPayment });
    }
  }

  const results = Object.values(byItem).map(({ item, docs }) => {
    const totalAmount = docs.reduce((s, d) => s + d.amount, 0);
    const mostRecent = docs.reduce((a, b) => (!a || (b.date && b.date > a.date) ? b : a), null);
    const proposedDay = mostRecent ? mostRecent.day : item.day_of_payment;
    return {
      cycle_item_id: item.id,
      expense_name: item.name,
      current_value: item.value,
      current_day_of_payment: item.day_of_payment,
      proposed_value: Math.round(totalAmount * 100) / 100,
      proposed_day_of_payment: proposedDay,
      documents: docs.map((d) => ({
        id: d.doc.id,
        title: d.doc.title,
        value: d.amount,
        date: d.date,
        url: `${dossier.paperless_url}/documents/${d.doc.id}/details`,
      })),
    };
  });

  console.log(`${prefix} done — ${results.length} result(s) ${warnings.length} warning(s)`);
  res.json({ results, warnings });
});

// POST /cycles/:cycleId/paperless-apply
router.post('/cycles/:cycleId/paperless-apply', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const cycle = db
    .prepare('SELECT * FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  let updated = 0;
  const updateStmt = db.prepare('UPDATE cycle_items SET value = ?, day_of_payment = ? WHERE id = ?');

  const applyAll = db.transaction(() => {
    for (const entry of items) {
      const { cycle_item_id, value, day_of_payment } = entry;
      if (!cycle_item_id) continue;

      const ci = db
        .prepare("SELECT * FROM cycle_items WHERE id = ? AND cycle_id = ? AND section = 'expense' AND type = 'Fixed'")
        .get(cycle_item_id, req.params.cycleId);
      if (!ci) continue;

      const v = Number(value);
      const d = Number(day_of_payment);
      if (isNaN(v) || v <= 0) continue;
      if (!Number.isInteger(d) || d < 1 || d > 31) continue;

      updateStmt.run(v, d, cycle_item_id);
      updated++;
    }
  });

  applyAll();
  res.json({ updated });
});

// ── Annual Expense Template ──────────────────────────────────────────────────

function attachTemplateInstallments(items) {
  return items.map((item) => ({
    ...item,
    installments: db
      .prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number')
      .all(item.id),
  }));
}

// GET /annual-expense-template
router.get('/annual-expense-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const items = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position, created_at')
    .all(req.params.id);
  res.json(attachTemplateInstallments(items));
});

// POST /annual-expense-template
router.post('/annual-expense-template', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { name, value, day_of_payment, month_of_payment, classification, num_installments, installments } = req.body;
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
  const numInst = num_installments != null ? Math.max(1, Number(num_installments)) : 1;

  const id = uuidv4();
  const createItem = db.transaction(() => {
    db.prepare(
      'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position, num_installments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, req.params.id, String(name).trim(), Number(value),
      day_of_payment != null ? day_of_payment : null,
      month_of_payment != null ? month_of_payment : null,
      classification || null, position, numInst
    );
    if (Array.isArray(installments)) {
      const insertInst = db.prepare('INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)');
      installments.forEach((inst, idx) => {
        insertInst.run(uuidv4(), id, inst.installment_number ?? (idx + 1), inst.month, inst.day);
      });
    } else if (month_of_payment != null && day_of_payment != null) {
      db.prepare('INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, 1, ?, ?)').run(uuidv4(), id, month_of_payment, day_of_payment);
    }
  });
  createItem();

  const item = db.prepare('SELECT * FROM annual_expense_template_items WHERE id = ?').get(id);
  res.status(201).json({ ...item, installments: db.prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number').all(id) });
});

// PUT /annual-expense-template/:itemId
router.put('/annual-expense-template/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Template item not found' });

  const { name, value, day_of_payment, month_of_payment, classification, num_installments, installments } = req.body;
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
  const newNumInst = num_installments !== undefined ? Math.max(1, Number(num_installments)) : item.num_installments ?? 1;

  const doUpdate = db.transaction(() => {
    db.prepare(
      'UPDATE annual_expense_template_items SET name = ?, value = ?, day_of_payment = ?, month_of_payment = ?, classification = ?, num_installments = ? WHERE id = ?'
    ).run(newName, newValue, newDop, newMop, newClassification, newNumInst, req.params.itemId);

    if (Array.isArray(installments)) {
      db.prepare('DELETE FROM annual_expense_template_installments WHERE template_item_id = ?').run(req.params.itemId);
      const insertInst = db.prepare('INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)');
      installments.forEach((inst, idx) => {
        insertInst.run(uuidv4(), req.params.itemId, inst.installment_number ?? (idx + 1), inst.month, inst.day);
      });
    }
  });
  doUpdate();

  const updated = db.prepare('SELECT * FROM annual_expense_template_items WHERE id = ?').get(req.params.itemId);
  res.json({ ...updated, installments: db.prepare('SELECT * FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number').all(req.params.itemId) });
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
      'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position, num_installments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertInst = db.prepare('INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)');
    items.forEach((item, idx) => {
      const itemId = uuidv4();
      const numInst = item.num_installments != null ? Math.max(1, Number(item.num_installments)) : 1;
      insert.run(
        itemId, req.params.id, String(item.name).trim(), Number(item.value) || 0,
        item.day_of_payment != null ? item.day_of_payment : null,
        item.month_of_payment != null ? item.month_of_payment : null,
        item.classification || null, idx, numInst
      );
      if (Array.isArray(item.installments)) {
        item.installments.forEach((inst, iIdx) => {
          insertInst.run(uuidv4(), itemId, inst.installment_number ?? (iIdx + 1), inst.month, inst.day);
        });
      } else if (item.day_of_payment != null && item.month_of_payment != null) {
        insertInst.run(uuidv4(), itemId, 1, item.month_of_payment, item.day_of_payment);
      }
    });
  });

  replace();
  const newItems = db
    .prepare('SELECT * FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(req.params.id);
  res.json(attachTemplateInstallments(newItems));
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
