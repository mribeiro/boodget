const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

const VALID_TYPES = ['Risk Investment', 'Guaranteed Investment', 'Current Account'];

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// GET /api/dossiers/:id/accounts
router.get('/', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const includeArchived = req.query.includeArchived === 'true';
  const accounts = includeArchived
    ? db
        .prepare('SELECT * FROM accounts WHERE dossier_id = ? ORDER BY position, group_name, name')
        .all(req.params.id)
    : db
        .prepare('SELECT * FROM accounts WHERE dossier_id = ? AND archived = 0 ORDER BY position, group_name, name')
        .all(req.params.id);
  res.json(accounts);
});

// POST /api/dossiers/:id/accounts
router.post('/', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { group_name, name, type, is_idle_money } = req.body;
  if (!group_name || !name || !type) {
    return res.status(400).json({ error: 'group_name, name, and type are required' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  const id = uuidv4();
  const { position: maxPos } = db
    .prepare('SELECT COALESCE(MAX(position), -1) as position FROM accounts WHERE dossier_id = ?')
    .get(req.params.id);
  db.prepare(
    'INSERT INTO accounts (id, dossier_id, group_name, name, type, is_idle_money, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.id, group_name.trim(), name.trim(), type, is_idle_money ? 1 : 0, maxPos + 1);
  res.status(201).json({
    id,
    dossier_id: req.params.id,
    group_name: group_name.trim(),
    name: name.trim(),
    type,
    is_idle_money: is_idle_money ? 1 : 0,
    archived: 0,
  });
});

// PUT /api/dossiers/:id/accounts/reorder
router.put('/reorder', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const { order } = req.body; // array of account ids in the desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  const update = db.prepare('UPDATE accounts SET position = ? WHERE id = ? AND dossier_id = ?');
  const reorder = db.transaction(() => {
    order.forEach((id, index) => update.run(index, id, req.params.id));
  });
  reorder();
  res.json({ ok: true });
});

// PATCH /api/dossiers/:id/accounts/:accountId
router.patch('/:accountId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const account = db
    .prepare('SELECT * FROM accounts WHERE id = ? AND dossier_id = ?')
    .get(req.params.accountId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const { is_idle_money } = req.body;
  db.prepare('UPDATE accounts SET is_idle_money = ? WHERE id = ?').run(is_idle_money ? 1 : 0, req.params.accountId);
  res.json({ ...account, is_idle_money: is_idle_money ? 1 : 0 });
});

// DELETE /api/dossiers/:id/accounts/:accountId  (archives the account)
router.delete('/:accountId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const account = db
    .prepare('SELECT * FROM accounts WHERE id = ? AND dossier_id = ?')
    .get(req.params.accountId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.prepare('UPDATE accounts SET archived = 1 WHERE id = ?').run(req.params.accountId);
  res.status(204).end();
});

module.exports = router;
