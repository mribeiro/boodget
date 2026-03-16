const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/notifications/settings
router.get('/settings', (req, res) => {
  const settings = db
    .prepare('SELECT * FROM user_notification_settings WHERE user_id = ?')
    .get(req.user.id);
  if (!settings) {
    return res.json({ enabled: 1, send_hour: 9, send_minute: 0, repeat_enabled: 0, repeat_interval_days: 1 });
  }
  res.json(settings);
});

// PATCH /api/notifications/settings
router.patch('/settings', (req, res) => {
  const { enabled, send_hour, send_minute, repeat_enabled, repeat_interval_days } = req.body;

  if (send_hour !== undefined && (!Number.isInteger(send_hour) || send_hour < 0 || send_hour > 23)) {
    return res.status(400).json({ error: 'send_hour must be 0–23' });
  }
  if (send_minute !== undefined && (!Number.isInteger(send_minute) || send_minute < 0 || send_minute > 59)) {
    return res.status(400).json({ error: 'send_minute must be 0–59' });
  }
  if (
    repeat_interval_days !== undefined &&
    (!Number.isInteger(repeat_interval_days) || repeat_interval_days < 1 || repeat_interval_days > 7)
  ) {
    return res.status(400).json({ error: 'repeat_interval_days must be 1–7' });
  }

  const existing = db
    .prepare('SELECT user_id FROM user_notification_settings WHERE user_id = ?')
    .get(req.user.id);

  if (!existing) {
    db.prepare(`
      INSERT INTO user_notification_settings (user_id, enabled, send_hour, send_minute, repeat_enabled, repeat_interval_days)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      enabled !== undefined ? (enabled ? 1 : 0) : 1,
      send_hour ?? 9,
      send_minute ?? 0,
      repeat_enabled !== undefined ? (repeat_enabled ? 1 : 0) : 0,
      repeat_interval_days ?? 1
    );
  } else {
    const updates = [];
    const params = [];
    if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
    if (send_hour !== undefined) { updates.push('send_hour = ?'); params.push(send_hour); }
    if (send_minute !== undefined) { updates.push('send_minute = ?'); params.push(send_minute); }
    if (repeat_enabled !== undefined) { updates.push('repeat_enabled = ?'); params.push(repeat_enabled ? 1 : 0); }
    if (repeat_interval_days !== undefined) { updates.push('repeat_interval_days = ?'); params.push(repeat_interval_days); }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    params.push(req.user.id);
    db.prepare(`UPDATE user_notification_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
  }

  const updated = db
    .prepare('SELECT * FROM user_notification_settings WHERE user_id = ?')
    .get(req.user.id);
  res.json(updated);
});

// GET /api/notifications/dossiers
router.get('/dossiers', (req, res) => {
  const rows = db
    .prepare('SELECT dossier_id FROM dossier_notification_subscriptions WHERE user_id = ?')
    .all(req.user.id);
  res.json(rows.map((r) => r.dossier_id));
});

// PUT /api/notifications/dossiers
router.put('/dossiers', (req, res) => {
  const { dossier_ids } = req.body;
  if (!Array.isArray(dossier_ids)) return res.status(400).json({ error: 'dossier_ids must be an array' });

  const del = db.prepare('DELETE FROM dossier_notification_subscriptions WHERE user_id = ?');
  const ins = db.prepare(
    'INSERT OR IGNORE INTO dossier_notification_subscriptions (user_id, dossier_id) VALUES (?, ?)'
  );

  db.transaction(() => {
    del.run(req.user.id);
    for (const dossierId of dossier_ids) {
      ins.run(req.user.id, dossierId);
    }
  })();

  const updated = db
    .prepare('SELECT dossier_id FROM dossier_notification_subscriptions WHERE user_id = ?')
    .all(req.user.id);
  res.json(updated.map((r) => r.dossier_id));
});

module.exports = router;
