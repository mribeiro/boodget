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

// GET /api/users
router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, is_oidc, created_at FROM users ORDER BY username').all();
  res.json(users);
});

// POST /api/users
router.post('/', (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already exists' });

  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (!validatePassword(password)) {
    return res.status(400).json({
      error:
        'Password must be at least 16 characters and include uppercase letters, lowercase letters, numbers, and symbols',
    });
  }

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, username, hash);
  console.log(`[users] User created: ${username} (${id}) by ${req.user.username}`);
  res.status(201).json({ id, username, is_oidc: 0 });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // dossiers.creator_id is ON DELETE CASCADE, so deleting a user who still owns dossiers would
  // silently destroy every one of them — including dossiers shared with (and relied on by)
  // other users. Any authenticated user can reach this endpoint, so refuse rather than cascade;
  // the owner has to delete their own dossiers first.
  const { owned } = db.prepare('SELECT COUNT(*) as owned FROM dossiers WHERE creator_id = ?').get(user.id);
  if (owned > 0) {
    return res.status(409).json({
      error: `Cannot delete "${user.username}" — they still own ${owned} dossier${owned === 1 ? '' : 's'}. Deleting the user would permanently delete ${owned === 1 ? 'it' : 'them'} too; the owner must delete ${owned === 1 ? 'it' : 'them'} first.`,
    });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  console.log(`[users] User deleted: ${user.username} (${user.id}) by ${req.user.username}`);
  res.status(204).end();
});

module.exports = router;
