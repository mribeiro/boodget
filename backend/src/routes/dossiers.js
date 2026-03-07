const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

const accountsRouter = require('./accounts');
const monthsRouter = require('./months');

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
  if (!data || data.version !== 1) return res.status(400).json({ error: 'Invalid export file' });
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
    db.prepare('INSERT INTO dossiers (id, name, creator_id, currency) VALUES (?, ?, ?, ?)').run(
      dossierId, finalName, req.user.id, data.dossier.currency || 'EUR'
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

  const dossier = db.prepare('SELECT name, currency FROM dossiers WHERE id = ?').get(req.params.id);
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

  const filename = dossier.name.replace(/[^a-z0-9]/gi, '_') + '_export.json';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json({
    version: 1,
    dossier: { name: dossier.name, currency: dossier.currency },
    accounts,
    months: months.map((m) => ({
      year: m.year,
      month: m.month,
      filled: m.filled,
      comment: m.comment,
      filled_at: m.filled_at,
      entries: entriesByMonth[m.id] || [],
    })),
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

module.exports = router;
