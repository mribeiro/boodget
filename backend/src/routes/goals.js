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

const getLatestAccountValue = db.prepare(`
  SELECT me.value
  FROM month_entries me
  JOIN months m ON m.id = me.month_id
  WHERE m.dossier_id = ? AND m.filled = 1 AND me.account_id = ? AND me.value IS NOT NULL
  ORDER BY m.year DESC, m.month DESC
  LIMIT 1
`);

const getDistributionSum = db.prepare(`
  SELECT COALESCE(SUM(eti.value), 0) AS total
  FROM goal_distributions gd
  JOIN expense_template_items eti ON eti.id = gd.template_item_id
  WHERE gd.goal_id = ?
`);

function enrichGoal(goal, dossierId) {
  const accountRows = db
    .prepare('SELECT account_id FROM goal_accounts WHERE goal_id = ?')
    .all(goal.id);
  const account_ids = accountRows.map((r) => r.account_id);

  const distRows = db
    .prepare('SELECT template_item_id FROM goal_distributions WHERE goal_id = ?')
    .all(goal.id);
  const distribution_template_item_ids = distRows.map((r) => r.template_item_id);

  // Compute current_value from latest filled month entries for each account
  let accountsTotal = 0;
  for (const accountId of account_ids) {
    const row = getLatestAccountValue.get(dossierId, accountId);
    if (row) accountsTotal += row.value;
  }
  const current_value = accountsTotal + (goal.extra_initial_amount || 0);

  // Compute monthly_contribution
  let monthly_contribution;
  if (goal.monthly_amount !== null && goal.monthly_amount !== undefined) {
    monthly_contribution = goal.monthly_amount;
  } else {
    const row = getDistributionSum.get(goal.id);
    monthly_contribution = row ? row.total : 0;
  }

  // Compute months_remaining from today
  const now = new Date();
  const months_remaining = Math.max(
    0,
    (goal.target_year - now.getFullYear()) * 12 + (goal.target_month - (now.getMonth() + 1))
  );

  const monthly_required =
    months_remaining > 0 ? (goal.target_value - current_value) / months_remaining : null;

  const progress_pct =
    goal.target_value > 0 ? Math.min(100, (current_value / goal.target_value) * 100) : 0;

  return {
    ...goal,
    account_ids,
    distribution_template_item_ids,
    current_value,
    monthly_contribution,
    months_remaining,
    monthly_required,
    progress_pct,
  };
}

// GET /goals
router.get('/', (req, res) => {
  const dossierId = req.params.id;
  if (!canAccess(dossierId, req.session.userId)) {
    return res.status(404).json({ error: 'Dossier not found' });
  }
  const goals = db
    .prepare('SELECT * FROM goals WHERE dossier_id = ? ORDER BY position, created_at')
    .all(dossierId);
  res.json(goals.map((g) => enrichGoal(g, dossierId)));
});

// POST /goals
router.post('/', (req, res) => {
  const dossierId = req.params.id;
  if (!canAccess(dossierId, req.session.userId)) {
    return res.status(404).json({ error: 'Dossier not found' });
  }

  const {
    name,
    target_year,
    target_month,
    target_value,
    extra_initial_amount = 0,
    monthly_amount = null,
    account_ids = [],
    distribution_template_item_ids = [],
  } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(target_year)) return res.status(400).json({ error: 'target_year must be an integer' });
  if (!Number.isInteger(target_month) || target_month < 1 || target_month > 12) {
    return res.status(400).json({ error: 'target_month must be between 1 and 12' });
  }
  if (typeof target_value !== 'number' || target_value < 0) {
    return res.status(400).json({ error: 'target_value must be a non-negative number' });
  }

  // Validate account_ids belong to this dossier
  for (const accountId of account_ids) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND dossier_id = ?').get(accountId, dossierId);
    if (!acc) return res.status(400).json({ error: `Account ${accountId} not found in dossier` });
  }

  // Validate distribution template item ids belong to this dossier and are distributions
  for (const itemId of distribution_template_item_ids) {
    const item = db
      .prepare("SELECT id FROM expense_template_items WHERE id = ? AND dossier_id = ? AND section = 'distribution'")
      .get(itemId, dossierId);
    if (!item) return res.status(400).json({ error: `Distribution template item ${itemId} not found` });
  }

  const id = uuidv4();
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO goals (id, dossier_id, name, target_year, target_month, target_value, extra_initial_amount, monthly_amount, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, dossierId, name.trim(), target_year, target_month, target_value, extra_initial_amount || 0, monthly_amount, 0);

    for (const accountId of account_ids) {
      db.prepare('INSERT INTO goal_accounts (goal_id, account_id) VALUES (?, ?)').run(id, accountId);
    }
    for (const itemId of distribution_template_item_ids) {
      db.prepare('INSERT INTO goal_distributions (goal_id, template_item_id) VALUES (?, ?)').run(id, itemId);
    }
  });
  create();

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  res.status(201).json(enrichGoal(goal, dossierId));
});

// GET /goals/:goalId
router.get('/:goalId', (req, res) => {
  const dossierId = req.params.id;
  if (!canAccess(dossierId, req.session.userId)) {
    return res.status(404).json({ error: 'Dossier not found' });
  }
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?').get(req.params.goalId, dossierId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  res.json(enrichGoal(goal, dossierId));
});

// PATCH /goals/:goalId
router.patch('/:goalId', (req, res) => {
  const dossierId = req.params.id;
  if (!canAccess(dossierId, req.session.userId)) {
    return res.status(404).json({ error: 'Dossier not found' });
  }
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?').get(req.params.goalId, dossierId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const {
    name,
    target_year,
    target_month,
    target_value,
    extra_initial_amount,
    monthly_amount,
    account_ids,
    distribution_template_item_ids,
  } = req.body;

  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  if (target_month !== undefined && (target_month < 1 || target_month > 12)) {
    return res.status(400).json({ error: 'target_month must be between 1 and 12' });
  }
  if (target_value !== undefined && (typeof target_value !== 'number' || target_value < 0)) {
    return res.status(400).json({ error: 'target_value must be a non-negative number' });
  }

  // Validate new account_ids if provided
  if (account_ids !== undefined) {
    for (const accountId of account_ids) {
      const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND dossier_id = ?').get(accountId, dossierId);
      if (!acc) return res.status(400).json({ error: `Account ${accountId} not found in dossier` });
    }
  }

  // Validate new distribution_template_item_ids if provided
  if (distribution_template_item_ids !== undefined) {
    for (const itemId of distribution_template_item_ids) {
      const item = db
        .prepare("SELECT id FROM expense_template_items WHERE id = ? AND dossier_id = ? AND section = 'distribution'")
        .get(itemId, dossierId);
      if (!item) return res.status(400).json({ error: `Distribution template item ${itemId} not found` });
    }
  }

  const update = db.transaction(() => {
    const newName = name !== undefined ? name.trim() : goal.name;
    const newYear = target_year !== undefined ? target_year : goal.target_year;
    const newMonth = target_month !== undefined ? target_month : goal.target_month;
    const newValue = target_value !== undefined ? target_value : goal.target_value;
    const newExtra = extra_initial_amount !== undefined ? extra_initial_amount : goal.extra_initial_amount;
    // monthly_amount: explicit null in body clears it (switches to distribution mode)
    const newMonthly = 'monthly_amount' in req.body ? monthly_amount : goal.monthly_amount;

    db.prepare(
      `UPDATE goals SET name = ?, target_year = ?, target_month = ?, target_value = ?,
       extra_initial_amount = ?, monthly_amount = ? WHERE id = ?`
    ).run(newName, newYear, newMonth, newValue, newExtra, newMonthly, goal.id);

    if (account_ids !== undefined) {
      db.prepare('DELETE FROM goal_accounts WHERE goal_id = ?').run(goal.id);
      for (const accountId of account_ids) {
        db.prepare('INSERT INTO goal_accounts (goal_id, account_id) VALUES (?, ?)').run(goal.id, accountId);
      }
    }

    if (distribution_template_item_ids !== undefined) {
      db.prepare('DELETE FROM goal_distributions WHERE goal_id = ?').run(goal.id);
      for (const itemId of distribution_template_item_ids) {
        db.prepare('INSERT INTO goal_distributions (goal_id, template_item_id) VALUES (?, ?)').run(goal.id, itemId);
      }
    }
  });
  update();

  const updated = db.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id);
  res.json(enrichGoal(updated, dossierId));
});

// DELETE /goals/:goalId
router.delete('/:goalId', (req, res) => {
  const dossierId = req.params.id;
  if (!canAccess(dossierId, req.session.userId)) {
    return res.status(404).json({ error: 'Dossier not found' });
  }
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?').get(req.params.goalId, dossierId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  db.prepare('DELETE FROM goals WHERE id = ?').run(goal.id);
  res.status(204).end();
});

module.exports = router;
