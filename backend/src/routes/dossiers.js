const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

const accountsRouter = require('./accounts');
const monthsRouter = require('./months');
const expensesRouter = require('./expenses');
const goalsRouter = require('./goals');

router.use('/:id/accounts', accountsRouter);
router.use('/:id/months', monthsRouter);

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return null;
  if (dossier.creator_id === userId) return { dossier, isCreator: true };
  const access = db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
  if (access) return { dossier, isCreator: false };
  return null;
}

// GET /api/dossiers
router.get('/', (req, res) => {
  const dossiers = db
    .prepare(
      `SELECT d.id, d.name, d.creator_id, d.currency, d.created_at,
        (d.creator_id = ?) as is_creator
      FROM dossiers d
      WHERE d.creator_id = ?
        OR EXISTS (
          SELECT 1 FROM dossier_access da WHERE da.dossier_id = d.id AND da.user_id = ?
        )
      ORDER BY d.created_at`
    )
    .all(req.user.id, req.user.id, req.user.id);
  res.json(dossiers);
});

// POST /api/dossiers/import
router.post('/import', (req, res) => {
  const data = req.body;
  if (!data || (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4)) return res.status(400).json({ error: 'Invalid export file' });
  if (!data.dossier?.name) return res.status(400).json({ error: 'Invalid export: missing dossier name' });

  const baseName = data.dossier.name.trim();
  let finalName = baseName;
  let suffix = 2;
  while (db.prepare('SELECT id FROM dossiers WHERE name = ? AND creator_id = ?').get(finalName, req.user.id)) {
    finalName = `${baseName} -${suffix}`;
    suffix++;
  }

  const dossierId = uuidv4();

  const doImport = db.transaction(() => {
    db.prepare('INSERT INTO dossiers (id, name, creator_id, currency, cycle_start_day) VALUES (?, ?, ?, ?, ?)').run(
      dossierId, finalName, req.user.id, data.dossier.currency || 'EUR', data.dossier.cycle_start_day ?? 25
    );

    const accountIdMap = {};
    const insertAccount = db.prepare(
      'INSERT INTO accounts (id, dossier_id, group_name, name, type, is_idle_money, archived, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const a of (data.accounts || [])) {
      const newId = uuidv4();
      accountIdMap[a.id] = newId;
      insertAccount.run(newId, dossierId, a.group_name, a.name, a.type, a.is_idle_money ? 1 : 0, a.archived ? 1 : 0, a.position ?? 0);
    }

    const insertMonth = db.prepare(
      'INSERT INTO months (id, dossier_id, year, month, filled, comment, filled_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertSnapshot = db.prepare('INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)');
    const insertEntry = db.prepare('INSERT INTO month_entries (month_id, account_id, value, comment) VALUES (?, ?, ?, ?)');

    for (const m of (data.months || [])) {
      const monthId = uuidv4();
      insertMonth.run(monthId, dossierId, m.year, m.month, m.filled ? 1 : 0, m.comment || null, m.filled_at || null);
      for (const e of (m.entries || [])) {
        const newAccountId = accountIdMap[e.account_id];
        if (!newAccountId) continue;
        insertSnapshot.run(monthId, newAccountId);
        insertEntry.run(monthId, newAccountId, e.value ?? null, e.comment || null);
      }
    }

    const insertTemplateItem = db.prepare(
      'INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, position, classification, must_amount, want_amount, save_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const templateNameToId = {};
    for (const ti of (data.expense_template || [])) {
      const newId = uuidv4();
      if (ti.section === 'distribution') templateNameToId[ti.name] = newId;
      insertTemplateItem.run(newId, dossierId, ti.section, ti.name, ti.type ?? null, ti.value ?? 0, ti.day_of_payment ?? null, ti.position ?? 0, ti.classification ?? null, ti.must_amount ?? null, ti.want_amount ?? null, ti.save_amount ?? null);
    }

    const insertAnnualTemplateItem = db.prepare(
      'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const ti of (data.annual_expense_template || [])) {
      insertAnnualTemplateItem.run(uuidv4(), dossierId, ti.name, ti.value ?? 0, ti.day_of_payment ?? null, ti.month_of_payment ?? null, ti.classification ?? null, ti.position ?? 0);
    }

    const insertWorkbenchSnapshot = db.prepare(
      'INSERT INTO workbench_snapshots (id, dossier_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const s of (data.workbench_snapshots || [])) {
      insertWorkbenchSnapshot.run(uuidv4(), dossierId, s.name, typeof s.data === 'string' ? s.data : JSON.stringify(s.data), s.created_at || null, s.updated_at || null);
    }

    const insertCycle = db.prepare(
      'INSERT INTO expense_cycles (id, dossier_id, year, month, salary, previous_balance, is_closed, final_real_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertCycleItem = db.prepare(
      'INSERT INTO cycle_items (id, cycle_id, section, name, type, value, day_of_payment, paid, spent, done, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const cycleYMToId = {};
    for (const c of (data.cycles || [])) {
      const cycleId = uuidv4();
      cycleYMToId[`${c.year}-${c.month}`] = cycleId;
      insertCycle.run(cycleId, dossierId, c.year, c.month, c.salary ?? 0, c.previous_balance ?? 0, c.is_closed ? 1 : 0, c.final_real_balance ?? null);
      for (const ci of (c.items || [])) {
        insertCycleItem.run(uuidv4(), cycleId, ci.section, ci.name, ci.type ?? null, ci.value ?? 0, ci.day_of_payment ?? null, ci.paid ? 1 : 0, ci.spent ?? 0, ci.done ? 1 : 0, ci.position ?? 0);
      }
    }

    // Build account name→newId map for goal re-linking
    const accountNameToId = {};
    for (const a of (data.accounts || [])) {
      accountNameToId[a.name] = accountIdMap[a.id];
    }

    const insertGoal = db.prepare(
      'INSERT INTO goals (id, dossier_id, name, target_value, target_date, extra_value, extra_value_impact_mode, contribution_mode, manual_monthly_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertGoalAccount = db.prepare('INSERT OR IGNORE INTO goal_accounts (goal_id, account_id) VALUES (?, ?)');
    const insertGoalDist = db.prepare('INSERT OR IGNORE INTO goal_distributions (goal_id, distribution_template_id) VALUES (?, ?)');
    const insertGoalCycleContrib = db.prepare(
      'INSERT INTO goal_cycle_contributions (goal_id, cycle_id, real_contribution) VALUES (?, ?, ?) ON CONFLICT(goal_id, cycle_id) DO UPDATE SET real_contribution = excluded.real_contribution'
    );
    const insertGoalHistorical = db.prepare(
      'INSERT INTO goal_historical_contributions (goal_id, year, month, amount) VALUES (?, ?, ?, ?)'
    );

    for (const g of (data.goals || [])) {
      const goalId = uuidv4();
      insertGoal.run(
        goalId, dossierId, g.name, g.target_value, g.target_date,
        g.extra_value ?? null, g.extra_value_impact_mode ?? null,
        g.contribution_mode, g.manual_monthly_value ?? null,
        g.created_at || null
      );
      for (const name of (g.account_names || [])) {
        const accId = accountNameToId[name];
        if (accId) insertGoalAccount.run(goalId, accId);
      }
      for (const name of (g.distribution_names || [])) {
        const distId = templateNameToId[name];
        if (distId) insertGoalDist.run(goalId, distId);
      }
      for (const cc of (g.cycle_contributions || [])) {
        const cycleId = cycleYMToId[`${cc.year}-${cc.month}`];
        if (cycleId) insertGoalCycleContrib.run(goalId, cycleId, cc.real_contribution ?? 0);
      }
      for (const hc of (g.historical_contributions || [])) {
        insertGoalHistorical.run(goalId, hc.year, hc.month, hc.amount ?? 0);
      }
    }
  });

  doImport();
  res.status(201).json({ id: dossierId, name: finalName, creator_id: req.user.id, is_creator: 1, currency: data.dossier.currency || 'EUR' });
});

// POST /api/dossiers
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO dossiers (id, name, creator_id) VALUES (?, ?, ?)').run(id, name.trim(), req.user.id);
  res.status(201).json({ id, name: name.trim(), creator_id: req.user.id, is_creator: 1, currency: 'EUR' });
});

// GET /api/dossiers/:id
router.get('/:id', (req, res) => {
  const access = canAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Dossier not found' });
  const dossier = db
    .prepare('SELECT *, (creator_id = ?) as is_creator FROM dossiers WHERE id = ?')
    .get(req.user.id, req.params.id);
  res.json(dossier);
});

// GET /api/dossiers/:id/export
router.get('/:id/export', (req, res) => {
  const access = canAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Dossier not found' });

  const dossier = db.prepare('SELECT name, currency, cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
  const accounts = db
    .prepare('SELECT id, group_name, name, type, is_idle_money, archived, position FROM accounts WHERE dossier_id = ? ORDER BY position, group_name, name')
    .all(req.params.id);
  const months = db
    .prepare('SELECT id, year, month, filled, comment, filled_at FROM months WHERE dossier_id = ? ORDER BY year, month')
    .all(req.params.id);

  const entriesByMonth = {};
  if (months.length > 0) {
    const ph = months.map(() => '?').join(',');
    const entries = db
      .prepare(`SELECT month_id, account_id, value, comment FROM month_entries WHERE month_id IN (${ph})`)
      .all(...months.map((m) => m.id));
    for (const e of entries) {
      if (!entriesByMonth[e.month_id]) entriesByMonth[e.month_id] = [];
      entriesByMonth[e.month_id].push({ account_id: e.account_id, value: e.value, comment: e.comment });
    }
  }

  const expenseTemplate = db
    .prepare('SELECT section, name, type, value, day_of_payment, position, classification, must_amount, want_amount, save_amount FROM expense_template_items WHERE dossier_id = ? ORDER BY section, position')
    .all(req.params.id);

  const annualExpenseTemplate = db
    .prepare('SELECT name, value, day_of_payment, month_of_payment, classification, position FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(req.params.id);

  const workbenchSnapshots = db
    .prepare('SELECT name, data, created_at, updated_at FROM workbench_snapshots WHERE dossier_id = ? ORDER BY created_at')
    .all(req.params.id)
    .map((s) => ({ ...s, data: JSON.parse(s.data) }));

  const cycles = db
    .prepare('SELECT id, year, month, salary, previous_balance, is_closed, final_real_balance FROM expense_cycles WHERE dossier_id = ? ORDER BY year, month')
    .all(req.params.id);

  const cycleItemsByCycleId = {};
  if (cycles.length > 0) {
    const ph = cycles.map(() => '?').join(',');
    const cycleItems = db
      .prepare(`SELECT cycle_id, section, name, type, value, day_of_payment, paid, spent, done, position FROM cycle_items WHERE cycle_id IN (${ph}) ORDER BY section, position, created_at`)
      .all(...cycles.map((c) => c.id));
    for (const ci of cycleItems) {
      if (!cycleItemsByCycleId[ci.cycle_id]) cycleItemsByCycleId[ci.cycle_id] = [];
      cycleItemsByCycleId[ci.cycle_id].push({ section: ci.section, name: ci.name, type: ci.type, value: ci.value, day_of_payment: ci.day_of_payment, paid: ci.paid, spent: ci.spent, done: ci.done, position: ci.position });
    }
  }

  const goalsRaw = db
    .prepare('SELECT * FROM goals WHERE dossier_id = ? ORDER BY created_at')
    .all(req.params.id);

  const goalsExport = goalsRaw.map((g) => {
    const accountNames = db
      .prepare('SELECT a.name FROM goal_accounts ga JOIN accounts a ON a.id = ga.account_id WHERE ga.goal_id = ?')
      .all(g.id).map((r) => r.name);
    const distributionNames = db
      .prepare('SELECT eti.name FROM goal_distributions gd JOIN expense_template_items eti ON eti.id = gd.distribution_template_id WHERE gd.goal_id = ?')
      .all(g.id).map((r) => r.name);
    const cycleContributions = db
      .prepare('SELECT ec.year, ec.month, gcc.real_contribution FROM goal_cycle_contributions gcc JOIN expense_cycles ec ON ec.id = gcc.cycle_id WHERE gcc.goal_id = ?')
      .all(g.id);
    const historicalContributions = db
      .prepare('SELECT year, month, amount FROM goal_historical_contributions WHERE goal_id = ? ORDER BY year, month')
      .all(g.id);
    return {
      name: g.name,
      target_value: g.target_value,
      target_date: g.target_date,
      extra_value: g.extra_value,
      extra_value_impact_mode: g.extra_value_impact_mode,
      contribution_mode: g.contribution_mode,
      manual_monthly_value: g.manual_monthly_value,
      created_at: g.created_at,
      account_names: accountNames,
      distribution_names: distributionNames,
      cycle_contributions: cycleContributions,
      historical_contributions: historicalContributions,
    };
  });

  const filename = dossier.name.replace(/[^a-z0-9]/gi, '_') + '_export.json';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json({
    version: 4,
    dossier: { name: dossier.name, currency: dossier.currency, cycle_start_day: dossier.cycle_start_day },
    accounts,
    months: months.map((m) => ({
      year: m.year,
      month: m.month,
      filled: m.filled,
      comment: m.comment,
      filled_at: m.filled_at,
      entries: entriesByMonth[m.id] || [],
    })),
    expense_template: expenseTemplate,
    annual_expense_template: annualExpenseTemplate,
    workbench_snapshots: workbenchSnapshots,
    cycles: cycles.map((c) => ({
      year: c.year,
      month: c.month,
      salary: c.salary,
      previous_balance: c.previous_balance,
      is_closed: c.is_closed,
      final_real_balance: c.final_real_balance,
      items: cycleItemsByCycleId[c.id] || [],
    })),
    goals: goalsExport,
  });
});

// DELETE /api/dossiers/:id
router.delete('/:id', (req, res) => {
  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Dossier not found' });
  if (dossier.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the creator can delete this dossier' });
  }
  db.prepare('DELETE FROM dossiers WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// GET /api/dossiers/:id/access
router.get('/:id/access', (req, res) => {
  const access = canAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Dossier not found' });
  const users = db
    .prepare(
      `SELECT u.id, u.username FROM users u
      JOIN dossier_access da ON da.user_id = u.id
      WHERE da.dossier_id = ?
      ORDER BY u.username`
    )
    .all(req.params.id);
  res.json(users);
});

// POST /api/dossiers/:id/access
router.post('/:id/access', (req, res) => {
  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Dossier not found' });
  if (dossier.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the creator can share this dossier' });
  }
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot share with yourself' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('INSERT OR IGNORE INTO dossier_access (dossier_id, user_id) VALUES (?, ?)').run(req.params.id, userId);
  res.status(201).json({ ok: true });
});

// DELETE /api/dossiers/:id/access/:userId
router.delete('/:id/access/:userId', (req, res) => {
  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Dossier not found' });
  if (dossier.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the creator can manage access' });
  }
  db.prepare('DELETE FROM dossier_access WHERE dossier_id = ? AND user_id = ?').run(
    req.params.id,
    req.params.userId
  );
  res.status(204).end();
});

// Expenses sub-router (settings, expense-template, cycles)
router.use('/:id', expensesRouter);
// Goals sub-router
router.use('/:id', goalsRouter);

module.exports = router;
