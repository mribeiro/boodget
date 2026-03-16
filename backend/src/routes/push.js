const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getVapidKeys } = require('../notifications/push');

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  const keys = getVapidKeys();
  if (!keys) return res.status(503).json({ error: 'VAPID keys not yet initialized' });
  res.json({ publicKey: keys.publicKey });
});

// POST /api/push/subscribe
router.post('/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Missing required subscription fields' });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      keys_p256dh = excluded.keys_p256dh,
      keys_auth = excluded.keys_auth
  `).run(req.user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

// DELETE /api/push/subscribe
router.delete('/subscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

// GET /api/push/subscriptions
router.get('/subscriptions', (req, res) => {
  const subs = db
    .prepare('SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?')
    .all(req.user.id);
  res.json(subs);
});

module.exports = router;
