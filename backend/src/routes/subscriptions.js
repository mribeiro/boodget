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

function attachLinkedDistribution(sub, dossierId) {
  let linkedDistribution = null;
  if (sub.distribution_template_item_id) {
    const item = db
      .prepare('SELECT id, name, value FROM expense_template_items WHERE id = ? AND dossier_id = ?')
      .get(sub.distribution_template_item_id, dossierId);
    if (item) linkedDistribution = { id: item.id, name: item.name, value: item.value };
  }
  return { ...sub, linked_distribution: linkedDistribution };
}

function validateSubscriptionFields(body, existing) {
  const name = body.name !== undefined ? String(body.name).trim() : existing?.name;
  if (!name) return { error: 'name is required' };

  const monthlyCost = body.monthly_cost !== undefined ? Number(body.monthly_cost) : existing?.monthly_cost;
  if (monthlyCost == null || isNaN(monthlyCost) || monthlyCost < 0) {
    return { error: 'monthly_cost must be a non-negative number' };
  }

  let billingDay = existing?.billing_day ?? null;
  if (body.billing_day !== undefined) {
    billingDay = body.billing_day === null || body.billing_day === '' ? null : Number(body.billing_day);
    if (billingDay != null && (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)) {
      return { error: 'billing_day must be null or an integer between 1 and 31' };
    }
  }

  const status = body.status !== undefined ? body.status : existing?.status ?? 'active';
  if (!['active', 'cancelled'].includes(status)) return { error: 'status must be "active" or "cancelled"' };

  return { name, monthly_cost: monthlyCost, billing_day: billingDay, status };
}

function resolveDistributionLink(body, dossierId) {
  if (body.distribution_template_item_id === undefined) return { changed: false };
  if (body.distribution_template_item_id === null) return { changed: true, value: null };
  const item = db
    .prepare("SELECT id FROM expense_template_items WHERE id = ? AND dossier_id = ? AND section = 'distribution'")
    .get(body.distribution_template_item_id, dossierId);
  if (!item) return { error: 'distribution_template_item_id must reference a distribution in this dossier' };
  return { changed: true, value: item.id };
}

// GET /subscriptions
router.get('/subscriptions', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const includeCancelled = req.query.includeCancelled === 'true';
  const subs = db
    .prepare(
      `SELECT * FROM subscriptions WHERE dossier_id = ? ${includeCancelled ? '' : "AND status = 'active'"} ORDER BY created_at ASC`
    )
    .all(req.params.id);
  res.json(subs.map((s) => attachLinkedDistribution(s, req.params.id)));
});

// POST /subscriptions
router.post('/subscriptions', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const validated = validateSubscriptionFields(req.body, null);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const link = resolveDistributionLink(req.body, req.params.id);
  if (link.error) return res.status(400).json({ error: link.error });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO subscriptions (id, dossier_id, name, monthly_cost, billing_day, status, distribution_template_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.id, validated.name, validated.monthly_cost, validated.billing_day, validated.status, link.value ?? null);

  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  console.log(`[subscriptions] Created subscription "${validated.name}" (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(201).json(attachLinkedDistribution(sub, req.params.id));
});

// PATCH /subscriptions/:subscriptionId
router.patch('/subscriptions/:subscriptionId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const sub = db
    .prepare('SELECT * FROM subscriptions WHERE id = ? AND dossier_id = ?')
    .get(req.params.subscriptionId, req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const validated = validateSubscriptionFields(req.body, sub);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const link = resolveDistributionLink(req.body, req.params.id);
  if (link.error) return res.status(400).json({ error: link.error });
  const distributionTemplateItemId = link.changed ? link.value : sub.distribution_template_item_id;

  db.prepare(
    `UPDATE subscriptions SET name = ?, monthly_cost = ?, billing_day = ?, status = ?, distribution_template_item_id = ? WHERE id = ?`
  ).run(validated.name, validated.monthly_cost, validated.billing_day, validated.status, distributionTemplateItemId, sub.id);

  const updated = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(sub.id);
  console.log(`[subscriptions] Updated subscription "${validated.name}" (${sub.id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.json(attachLinkedDistribution(updated, req.params.id));
});

// DELETE /subscriptions/:subscriptionId
router.delete('/subscriptions/:subscriptionId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const sub = db
    .prepare('SELECT * FROM subscriptions WHERE id = ? AND dossier_id = ?')
    .get(req.params.subscriptionId, req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });
  db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.id);
  console.log(`[subscriptions] Deleted subscription "${sub.name}" (${sub.id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

module.exports = router;
