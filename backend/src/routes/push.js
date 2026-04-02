const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getVapidKeys, sendPush } = require('../notifications/push');

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  const keys = getVapidKeys();
  if (!keys) return res.status(503).json({ error: 'VAPID keys not yet initialized' });
  res.json({ publicKey: keys.publicKey });
});

// GET /api/push/vapid-info  — debug: masked key info to verify correct config
router.get('/vapid-info', (req, res) => {
  const keys = getVapidKeys();
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@capitaltracker.local';
  const fromEnv = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const mask = (s) => s ? `${s.slice(0, 6)}…${s.slice(-6)}` : null;
  res.json({
    subject,
    fromEnv,
    publicKey: mask(keys?.publicKey),
    privateKey: mask(keys?.privateKey),
  });
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

// POST /api/push/test
router.post('/test', async (req, res) => {
  const subscriptions = db
    .prepare('SELECT * FROM push_subscriptions WHERE user_id = ?')
    .all(req.user.id);

  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No push subscriptions registered for this user.' });
  }

  const results = [];
  for (const sub of subscriptions) {
    const result = await sendPush(sub, {
      type: 'test',
      title: 'Test notification',
      body: 'Push notifications are working correctly.',
      url: '/notifications',
    });
    if (!result.success) {
      console.log(`[push] Test send failed for user ${req.user.username}: status=${result.statusCode} message=${result.message}`);
      if (result.statusCode === 410 || result.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        console.log(`[push] Removed expired subscription for user ${req.user.username} (test endpoint)`);
      }
    }
    results.push({
      endpoint: sub.endpoint,
      success: result.success,
      ...(result.success ? {} : { statusCode: result.statusCode, message: result.message }),
    });
  }

  res.json({ results });
});

module.exports = router;
