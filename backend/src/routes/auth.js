const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const requireAuth = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');

let oidcClient = null;

function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 16 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB decoded
const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/;

// Validates a client-supplied avatar data URL, returning { mime, byteLength } on success or
// throwing an Error whose message is safe to surface directly to the client (400).
function parseAvatarDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('Image is required');
  }
  const match = AVATAR_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error(`Image must be a PNG, JPEG, or WebP data URL (allowed: ${AVATAR_MIME_TYPES.join(', ')})`);
  }
  const [, mime, base64] = match;
  const byteLength = Buffer.byteLength(base64, 'base64');
  if (byteLength > AVATAR_MAX_BYTES) {
    throw new Error('Image must be smaller than 2MB');
  }
  return { mime, byteLength };
}

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id);
  res.json({ id: req.user.id, username: req.user.username, is_oidc: req.user.is_oidc, avatar: user?.avatar || null });
});

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.password_hash) {
    console.log(`[auth] Failed login attempt for username: ${username}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) {
    console.log(`[auth] Failed login attempt for username: ${username}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  console.log(`[auth] User logged in: ${user.username} (${user.id})`);
  res.json({ id: user.id, username: user.username, is_oidc: user.is_oidc, avatar: user.avatar || null });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  console.log(`[auth] User logged out: ${req.user.username} (${req.user.id})`);
  req.session.destroy(() => {});
  res.json({ ok: true });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  if (req.user.is_oidc) {
    return res.status(400).json({ error: 'OIDC users cannot change their password here' });
  }
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const match = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!match) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({
      error:
        'New password must be at least 16 characters and include uppercase letters, lowercase letters, numbers, and symbols',
    });
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  console.log(`[auth] Password changed for user: ${req.user.username} (${req.user.id})`);
  res.json({ ok: true });
});

// POST /api/auth/avatar
router.post('/avatar', requireAuth, (req, res) => {
  try {
    parseAvatarDataUrl(req.body.image);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.body.image, req.user.id);
  console.log(`[auth] Avatar updated for user: ${req.user.username} (${req.user.id})`);
  res.json({ avatar: req.body.image });
});

// DELETE /api/auth/avatar
router.delete('/avatar', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  console.log(`[auth] Avatar removed for user: ${req.user.username} (${req.user.id})`);
  res.status(204).end();
});

// GET /api/auth/oidc/config
router.get('/oidc/config', (req, res) => {
  const prefill =
    process.env.SEED_ON_EMPTY === 'true'
      ? { username: 'preview', password: 'Preview@Capital2024!' }
      : null;
  res.json({
    enabled: process.env.OIDC_ENABLED === 'true',
    providerName: process.env.OIDC_PROVIDER_NAME || 'SSO Login',
    prefill,
  });
});

// GET /api/auth/oidc/start
router.get('/oidc/start', (req, res) => {
  if (!oidcClient) return res.status(400).json({ error: 'OIDC is not configured' });
  const { generators } = require('openid-client');
  const state = generators.state();
  req.session.oidcState = state;
  const url = oidcClient.authorizationUrl({ scope: 'openid profile', state });
  res.redirect(url);
});

// GET /api/auth/oidc/callback
router.get('/oidc/callback', async (req, res) => {
  if (!oidcClient) return res.status(400).json({ error: 'OIDC is not configured' });
  try {
    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(process.env.OIDC_REDIRECT_URI, params, {
      state: req.session.oidcState,
    });
    const userinfo = await oidcClient.userinfo(tokenSet);
    const username = userinfo.preferred_username || userinfo.sub;

    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      const id = uuidv4();
      db.prepare('INSERT INTO users (id, username, is_oidc) VALUES (?, ?, 1)').run(id, username);
      user = { id, username, is_oidc: 1 };
      console.log(`[auth] New OIDC user auto-created: ${username} (${id})`);
    }

    req.session.userId = user.id;
    console.log(`[auth] OIDC user logged in: ${user.username} (${user.id})`);
    delete req.session.oidcState;
    res.redirect('/');
  } catch (err) {
    console.error('OIDC callback error:', err);
    res.redirect('/login?error=oidc');
  }
});

async function initOIDC() {
  const { Issuer } = require('openid-client');
  const issuer = await Issuer.discover(process.env.OIDC_ISSUER_URL);
  oidcClient = new issuer.Client({
    client_id: process.env.OIDC_CLIENT_ID,
    client_secret: process.env.OIDC_CLIENT_SECRET,
    redirect_uris: [process.env.OIDC_REDIRECT_URI],
    response_types: ['code'],
  });
  console.log('OIDC configured with issuer:', issuer.issuer);
}

module.exports = router;
module.exports.initOIDC = initOIDC;
module.exports.parseAvatarDataUrl = parseAvatarDataUrl;
