const webpush = require('web-push');
const { db } = require('../db');

function getVapidKeys() {
  const pub = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('vapid_public_key');
  const priv = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('vapid_private_key');
  return pub && priv ? { publicKey: pub.value, privateKey: priv.value } : null;
}

function initVapid() {
  let keys = getVapidKeys();
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('vapid_public_key', keys.publicKey);
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('vapid_private_key', keys.privateKey);
    console.log('[push] Generated new VAPID keys');
  }
  webpush.setVapidDetails('mailto:admin@capitaltracker.local', keys.publicKey, keys.privateKey);
}

async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys_p256dh, auth: subscription.keys_auth } },
      JSON.stringify(payload)
    );
    return { success: true };
  } catch (err) {
    return { success: false, statusCode: err.statusCode };
  }
}

module.exports = { initVapid, getVapidKeys, sendPush };
