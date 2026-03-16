'use strict';

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

// GET /emergency-fund/accounts
router.get('/emergency-fund/accounts', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const rows = db
    .prepare('SELECT account_id FROM emergency_fund_accounts WHERE dossier_id = ?')
    .all(req.params.id);
  res.json(rows.map((r) => r.account_id));
});

// PUT /emergency-fund/accounts  (bulk-replace)
router.put('/emergency-fund/accounts', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { account_ids } = req.body;
  if (!Array.isArray(account_ids)) return res.status(400).json({ error: 'account_ids must be an array' });

  db.transaction(() => {
    db.prepare('DELETE FROM emergency_fund_accounts WHERE dossier_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)'
    );
    for (const accountId of account_ids) {
      insert.run(req.params.id, accountId);
    }
  })();

  const rows = db
    .prepare('SELECT account_id FROM emergency_fund_accounts WHERE dossier_id = ?')
    .all(req.params.id);
  console.log(`[emergency-fund] Updated account selection for dossier ${req.params.id} (${rows.length} accounts) by user ${req.user.username}`);
  res.json(rows.map((r) => r.account_id));
});

// GET /emergency-fund/extra-values
router.get('/emergency-fund/extra-values', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const items = db
    .prepare(
      'SELECT * FROM emergency_fund_extra_values WHERE dossier_id = ? ORDER BY position, rowid'
    )
    .all(req.params.id);
  res.json(items);
});

// POST /emergency-fund/extra-values
router.post('/emergency-fund/extra-values', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { name, value } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (value == null || isNaN(Number(value))) return res.status(400).json({ error: 'value must be a number' });

  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), 0) as maxp FROM emergency_fund_extra_values WHERE dossier_id = ?')
    .get(req.params.id);
  const id = uuidv4();
  db.prepare(
    'INSERT INTO emergency_fund_extra_values (id, dossier_id, name, value, position) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.params.id, String(name).trim(), Number(value), maxPos.maxp + 1);

  res.status(201).json(
    db.prepare('SELECT * FROM emergency_fund_extra_values WHERE id = ?').get(id)
  );
});

// PATCH /emergency-fund/extra-values/:itemId
router.patch('/emergency-fund/extra-values/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT * FROM emergency_fund_extra_values WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Extra value not found' });

  const { name, value } = req.body;
  const newName = name !== undefined ? String(name).trim() : item.name;
  if (!newName) return res.status(400).json({ error: 'name cannot be empty' });
  const newValue = value !== undefined ? Number(value) : item.value;
  if (isNaN(newValue)) return res.status(400).json({ error: 'value must be a number' });

  db.prepare('UPDATE emergency_fund_extra_values SET name = ?, value = ? WHERE id = ?').run(
    newName, newValue, item.id
  );
  res.json(db.prepare('SELECT * FROM emergency_fund_extra_values WHERE id = ?').get(item.id));
});

// DELETE /emergency-fund/extra-values/:itemId
router.delete('/emergency-fund/extra-values/:itemId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const item = db
    .prepare('SELECT id FROM emergency_fund_extra_values WHERE id = ? AND dossier_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Extra value not found' });
  db.prepare('DELETE FROM emergency_fund_extra_values WHERE id = ?').run(item.id);
  res.status(204).end();
});

// GET /emergency-fund/status
router.get('/emergency-fund/status', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const dossier = db
    .prepare('SELECT emergency_fund_months_multiplier, emergency_fund_cycles_to_average FROM dossiers WHERE id = ?')
    .get(req.params.id);
  const X = dossier.emergency_fund_months_multiplier ?? 6;
  const Y = dossier.emergency_fund_cycles_to_average ?? 6;

  const extraValues = db
    .prepare('SELECT * FROM emergency_fund_extra_values WHERE dossier_id = ? ORDER BY position, rowid')
    .all(req.params.id);
  const extra_monthly_total = extraValues.reduce((s, e) => s + (e.value || 0), 0);

  const accountRows = db
    .prepare(
      `SELECT a.id as account_id, a.group_name, a.name
       FROM emergency_fund_accounts efa
       JOIN accounts a ON a.id = efa.account_id
       WHERE efa.dossier_id = ? AND a.archived = 0`
    )
    .all(req.params.id);

  // Get most recent filled snapshot for current value
  const recentMonth = db
    .prepare('SELECT id FROM months WHERE dossier_id = ? AND filled = 1 ORDER BY year DESC, month DESC LIMIT 1')
    .get(req.params.id);

  let current_value = 0;
  const contributing_accounts = accountRows.map((a) => {
    let value = 0;
    if (recentMonth) {
      const entry = db
        .prepare('SELECT value FROM month_entries WHERE month_id = ? AND account_id = ?')
        .get(recentMonth.id, a.account_id);
      value = entry?.value ?? 0;
    }
    current_value += value;
    return { account_id: a.account_id, group_name: a.group_name, name: a.name, value };
  });

  // Get Y most recent cycles
  const cycles = db
    .prepare(
      'SELECT id, is_closed FROM expense_cycles WHERE dossier_id = ? ORDER BY year DESC, month DESC LIMIT ?'
    )
    .all(req.params.id, Y);

  if (cycles.length === 0) {
    const effective_monthly_base = extra_monthly_total;
    return res.json({
      current_value,
      target_value: 0,
      deficit: 0,
      average_monthly_expense: 0,
      extra_monthly_total,
      effective_monthly_base,
      months_covered: effective_monthly_base > 0 ? Math.round((current_value / effective_monthly_base) * 10) / 10 : 0,
      cycles_considered: 0,
      cycles_requested: Y,
      status: 'no_data',
      contributing_accounts,
    });
  }

  // Compute expense total per cycle
  let totalExpenses = 0;
  for (const cycle of cycles) {
    const items = db
      .prepare("SELECT type, value, spent FROM cycle_items WHERE cycle_id = ? AND section = 'expense'")
      .all(cycle.id);
    for (const item of items) {
      if (item.type === 'Fixed') {
        totalExpenses += item.value || 0;
      } else if (item.type === 'Budget') {
        // Closed cycle → spent value; open cycle → max value
        totalExpenses += cycle.is_closed ? (item.spent || 0) : (item.value || 0);
      }
    }
  }

  const average_monthly_expense = totalExpenses / cycles.length;
  const effective_monthly_base = average_monthly_expense + extra_monthly_total;
  const target_value = X * effective_monthly_base;
  const deficit = target_value - current_value;
  const months_covered =
    effective_monthly_base > 0
      ? Math.round((current_value / effective_monthly_base) * 10) / 10
      : 0;

  const status = current_value >= target_value ? 'healthy' : 'underfunded';

  res.json({
    current_value,
    target_value,
    deficit,
    average_monthly_expense,
    extra_monthly_total,
    effective_monthly_base,
    months_covered,
    cycles_considered: cycles.length,
    cycles_requested: Y,
    status,
    contributing_accounts,
  });
});

module.exports = router;
