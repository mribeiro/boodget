const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

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

// GET /api/setup/status
router.get('/status', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get();
  res.json({ needsSetup: count === 0 });
});

// POST /api/setup/create-first-user
router.post('/create-first-user', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (count > 0) {
    return res.status(400).json({ error: 'Setup already completed' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({
      error:
        'Password must be at least 16 characters and include uppercase letters, lowercase letters, numbers, and symbols',
    });
  }

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, username, hash);

  req.session.userId = id;
  res.status(201).json({ id, username, is_oidc: 0 });
});

module.exports = router;
