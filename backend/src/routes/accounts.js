const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

const VALID_TYPES = ['Risk Investment', 'Guaranteed Investment', 'Current Account'];
const VALID_MONEY_CATEGORIES = ['idle', 'active', 'stocks'];

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
  const { group_name, name, type, money_category, can_receive_transfers } = req.body;
  if (!group_name || !name || !type) {
    return res.status(400).json({ error: 'group_name, name, and type are required' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  const moneyCategory = money_category === undefined ? 'active' : money_category;
  if (!VALID_MONEY_CATEGORIES.includes(moneyCategory)) {
    return res.status(400).json({ error: `money_category must be one of: ${VALID_MONEY_CATEGORIES.join(', ')}` });
  }
  const id = uuidv4();
  const { position: maxPos } = db
    .prepare('SELECT COALESCE(MAX(position), -1) as position FROM accounts WHERE dossier_id = ?')
    .get(req.params.id);
  const canReceiveTransfers =
    can_receive_transfers === undefined ? (moneyCategory === 'stocks' ? 0 : 1) : (can_receive_transfers ? 1 : 0);
  db.prepare(
    'INSERT INTO accounts (id, dossier_id, group_name, name, type, money_category, can_receive_transfers, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.id, group_name.trim(), name.trim(), type, moneyCategory, canReceiveTransfers, maxPos + 1);
  console.log(`[accounts] Created account "${name.trim()}" (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(201).json({
    id,
    dossier_id: req.params.id,
    group_name: group_name.trim(),
    name: name.trim(),
    type,
    money_category: moneyCategory,
    can_receive_transfers: canReceiveTransfers,
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
  const { name, group_name, money_category, can_receive_transfers } = req.body;
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'name must not be empty' });
  }
  if (group_name !== undefined && !group_name.trim()) {
    return res.status(400).json({ error: 'group_name must not be empty' });
  }
  if (money_category !== undefined && !VALID_MONEY_CATEGORIES.includes(money_category)) {
    return res.status(400).json({ error: `money_category must be one of: ${VALID_MONEY_CATEGORIES.join(', ')}` });
  }
  const newName = name !== undefined ? name.trim() : account.name;
  const newGroupName = group_name !== undefined ? group_name.trim() : account.group_name;
  const newMoneyCategory = money_category !== undefined ? money_category : account.money_category;
  const newCanReceiveTransfers = can_receive_transfers !== undefined ? (can_receive_transfers ? 1 : 0) : account.can_receive_transfers;
  db.prepare('UPDATE accounts SET name = ?, group_name = ?, money_category = ?, can_receive_transfers = ? WHERE id = ?')
    .run(newName, newGroupName, newMoneyCategory, newCanReceiveTransfers, req.params.accountId);
  if (newName !== account.name || newGroupName !== account.group_name) {
    console.log(`[accounts] Renamed account "${account.group_name}/${account.name}" -> "${newGroupName}/${newName}" (${req.params.accountId}) in dossier ${req.params.id} by user ${req.user.username}`);
  }
  res.json({ ...account, name: newName, group_name: newGroupName, money_category: newMoneyCategory, can_receive_transfers: newCanReceiveTransfers });
});

// DELETE /api/dossiers/:id/accounts/:accountId  (archives the account)
router.delete('/:accountId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const account = db
    .prepare('SELECT * FROM accounts WHERE id = ? AND dossier_id = ?')
    .get(req.params.accountId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const templateLinks = db
    .prepare("SELECT name FROM expense_template_items WHERE dossier_id = ? AND section = 'distribution' AND account_id = ?")
    .all(req.params.id, req.params.accountId);
  const cycleLinks = db
    .prepare(
      `SELECT ci.name, ec.year, ec.month
       FROM cycle_items ci
       JOIN expense_cycles ec ON ec.id = ci.cycle_id
       WHERE ec.dossier_id = ? AND ci.section = 'distribution' AND ci.account_id = ?`
    )
    .all(req.params.id, req.params.accountId);

  if (templateLinks.length > 0 || cycleLinks.length > 0) {
    const dossier = db.prepare('SELECT cycle_start_day FROM dossiers WHERE id = ?').get(req.params.id);
    const startDay = dossier?.cycle_start_day ?? 25;
    const groups = [];
    if (templateLinks.length > 0) {
      groups.push(`Monthly template: ${templateLinks.map((l) => `"${l.name}"`).join(', ')}`);
    }
    if (cycleLinks.length > 0) {
      const byCycle = new Map();
      for (const link of cycleLinks) {
        const cycleName = new Date(link.year, link.month, startDay - 1).toLocaleString('en', { month: 'long', year: 'numeric' });
        if (!byCycle.has(cycleName)) byCycle.set(cycleName, []);
        byCycle.get(cycleName).push(link.name);
      }
      for (const [cycleName, names] of byCycle) {
        groups.push(`Cycle of ${cycleName}: ${names.map((n) => `"${n}"`).join(', ')}`);
      }
    }
    return res.status(409).json({
      error: `Cannot archive "${account.name}" — it's still linked as the funding account for: ${groups.join('; ')}. Reassign or clear the funding account on those distributions first.`,
    });
  }

  db.prepare('UPDATE accounts SET archived = 1 WHERE id = ?').run(req.params.accountId);
  console.log(`[accounts] Archived account "${account.name}" (${req.params.accountId}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

module.exports = router;
