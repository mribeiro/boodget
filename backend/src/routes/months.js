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

// GET /api/dossiers/:id/months
// Includes capital_total (sum of idle + active account values, excludes stocks) for filled months
router.get('/', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const months = db
    .prepare(
      `SELECT m.*,
        (SELECT SUM(me.value) FROM month_entries me
         JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = m.id AND a.money_category IN ('idle', 'active')) as capital_total,
        (SELECT SUM(me.value) FROM month_entries me
         JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = m.id AND a.money_category = 'idle') as idle_total,
        (SELECT SUM(me.value) FROM month_entries me
         JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = m.id AND a.money_category = 'stocks') as stocks_total
      FROM months m
      WHERE m.dossier_id = ?
      ORDER BY m.year DESC, m.month DESC`
    )
    .all(req.params.id);
  res.json(months);
});

// POST /api/dossiers/:id/months
router.post('/', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { year, month } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

  const existing = db
    .prepare('SELECT id FROM months WHERE dossier_id = ? AND year = ? AND month = ?')
    .get(req.params.id, year, month);
  if (existing) return res.status(400).json({ error: 'This month already exists in the dossier' });

  const id = uuidv4();

  const createMonth = db.transaction(() => {
    db.prepare('INSERT INTO months (id, dossier_id, year, month) VALUES (?, ?, ?, ?)').run(
      id,
      req.params.id,
      year,
      month
    );
    // Snapshot all currently non-archived accounts
    const accounts = db
      .prepare('SELECT id FROM accounts WHERE dossier_id = ? AND archived = 0')
      .all(req.params.id);
    const insertSnapshot = db.prepare(
      'INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)'
    );
    const insertEntry = db.prepare('INSERT INTO month_entries (month_id, account_id) VALUES (?, ?)');
    for (const account of accounts) {
      insertSnapshot.run(id, account.id);
      insertEntry.run(id, account.id);
    }
  });

  createMonth();
  console.log(`[months] Created month ${year}/${month} (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(201).json({ id, dossier_id: req.params.id, year, month, filled: 0, capital_total: null });
});

// GET /api/dossiers/:id/months/compare
router.get('/compare', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const months = db
    .prepare('SELECT id, year, month, filled FROM months WHERE dossier_id = ? ORDER BY year DESC, month DESC LIMIT 12')
    .all(req.params.id);
  months.reverse(); // oldest first (left-to-right)

  if (months.length === 0) return res.json({ months: [], rows: [] });

  const monthIds = months.map((m) => m.id);
  const ph = monthIds.map(() => '?').join(',');

  const accounts = db
    .prepare(
      `SELECT DISTINCT a.id, a.group_name, a.name, a.type, a.money_category, a.archived
       FROM month_account_snapshot mas
       JOIN accounts a ON a.id = mas.account_id
       WHERE mas.month_id IN (${ph})
       ORDER BY a.position, a.group_name, a.name`
    )
    .all(...monthIds);

  const entries = db
    .prepare(`SELECT month_id, account_id, value FROM month_entries WHERE month_id IN (${ph})`)
    .all(...monthIds);

  const lookup = {};
  for (const e of entries) {
    if (!lookup[e.account_id]) lookup[e.account_id] = {};
    lookup[e.account_id][e.month_id] = e.value;
  }

  const rows = accounts.map((a) => ({
    id: a.id,
    group_name: a.group_name,
    name: a.name,
    type: a.type,
    money_category: a.money_category,
    archived: a.archived,
    values: monthIds.reduce((acc, mid) => {
      acc[mid] = lookup[a.id]?.[mid] ?? null;
      return acc;
    }, {}),
  }));

  res.json({ months, rows });
});

// GET /api/dossiers/:id/months/:monthId
router.get('/:monthId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const month = db
    .prepare('SELECT * FROM months WHERE id = ? AND dossier_id = ?')
    .get(req.params.monthId, req.params.id);
  if (!month) return res.status(404).json({ error: 'Month not found' });

  // Return snapshot accounts (including archived ones that were active when month was created)
  // joined with the current entry values
  const entries = db
    .prepare(
      `SELECT a.id, a.group_name, a.name, a.type, a.money_category, a.archived,
        me.value, me.comment,
        (SELECT me2.value
         FROM month_entries me2
         JOIN months m2 ON m2.id = me2.month_id
         WHERE me2.account_id = a.id
           AND m2.dossier_id = ?
           AND me2.value IS NOT NULL
           AND (m2.year < ? OR (m2.year = ? AND m2.month < ?))
         ORDER BY m2.year DESC, m2.month DESC
         LIMIT 1) AS prev_value
      FROM month_account_snapshot mas
      JOIN accounts a ON a.id = mas.account_id
      LEFT JOIN month_entries me ON me.month_id = ? AND me.account_id = a.id
      WHERE mas.month_id = ?
      ORDER BY a.position, a.group_name, a.name`
    )
    .all(req.params.id, month.year, month.year, month.month, req.params.monthId, req.params.monthId);

  const { missing_accounts } = db
    .prepare(
      `SELECT COUNT(*) AS missing_accounts FROM accounts
       WHERE dossier_id = ? AND archived = 0
         AND id NOT IN (SELECT account_id FROM month_account_snapshot WHERE month_id = ?)`
    )
    .get(req.params.id, req.params.monthId);

  res.json({ ...month, entries, missing_accounts });
});

// PUT /api/dossiers/:id/months/:monthId  (save / submit)
router.put('/:monthId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const month = db
    .prepare('SELECT * FROM months WHERE id = ? AND dossier_id = ?')
    .get(req.params.monthId, req.params.id);
  if (!month) return res.status(404).json({ error: 'Month not found' });

  const { entries = [], comment } = req.body;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const filledAt =
    month.year === currentYear && month.month === currentMonth
      ? now.toISOString().split('T')[0]
      : `${month.year}-${String(month.month).padStart(2, '0')}-05`;

  const save = db.transaction(() => {
    db.prepare('UPDATE months SET comment = ?, filled = 1, filled_at = ? WHERE id = ?').run(
      comment || null,
      filledAt,
      req.params.monthId
    );
    const updateEntry = db.prepare(
      'UPDATE month_entries SET value = ?, comment = ? WHERE month_id = ? AND account_id = ?'
    );
    for (const entry of entries) {
      updateEntry.run(
        entry.value != null ? entry.value : null,
        entry.comment || null,
        req.params.monthId,
        entry.accountId
      );
    }
  });

  save();
  console.log(`[months] Submitted month ${month.year}/${month.month} (${req.params.monthId}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.json({ ok: true });
});

// POST /api/dossiers/:id/months/:monthId/sync-accounts
router.post('/:monthId/sync-accounts', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const month = db
    .prepare('SELECT * FROM months WHERE id = ? AND dossier_id = ?')
    .get(req.params.monthId, req.params.id);
  if (!month) return res.status(404).json({ error: 'Month not found' });

  const newAccounts = db
    .prepare(
      `SELECT id FROM accounts
       WHERE dossier_id = ? AND archived = 0
         AND id NOT IN (SELECT account_id FROM month_account_snapshot WHERE month_id = ?)`
    )
    .all(req.params.id, req.params.monthId);

  const sync = db.transaction(() => {
    const insertSnapshot = db.prepare('INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)');
    const insertEntry = db.prepare('INSERT INTO month_entries (month_id, account_id) VALUES (?, ?)');
    for (const account of newAccounts) {
      insertSnapshot.run(req.params.monthId, account.id);
      insertEntry.run(req.params.monthId, account.id);
    }
  });

  sync();
  res.json({ added: newAccounts.length });
});

// POST /api/dossiers/:id/months/:monthId/reset
router.post('/:monthId/reset', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const month = db
    .prepare('SELECT * FROM months WHERE id = ? AND dossier_id = ?')
    .get(req.params.monthId, req.params.id);
  if (!month) return res.status(404).json({ error: 'Month not found' });

  const reset = db.transaction(() => {
    db.prepare('UPDATE months SET comment = NULL, filled = 0, filled_at = NULL WHERE id = ?').run(req.params.monthId);
    db.prepare('UPDATE month_entries SET value = NULL, comment = NULL WHERE month_id = ?').run(
      req.params.monthId
    );
    // Add any active accounts created after the month was originally set up
    const newAccounts = db
      .prepare(
        `SELECT id FROM accounts
         WHERE dossier_id = ? AND archived = 0
           AND id NOT IN (SELECT account_id FROM month_account_snapshot WHERE month_id = ?)`
      )
      .all(req.params.id, req.params.monthId);
    const insertSnapshot = db.prepare(
      'INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)'
    );
    const insertEntry = db.prepare(
      'INSERT INTO month_entries (month_id, account_id) VALUES (?, ?)'
    );
    for (const account of newAccounts) {
      insertSnapshot.run(req.params.monthId, account.id);
      insertEntry.run(req.params.monthId, account.id);
    }
  });

  reset();
  console.log(`[months] Reset month ${month.year}/${month.month} (${req.params.monthId}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.json({ ok: true });
});

module.exports = router;
