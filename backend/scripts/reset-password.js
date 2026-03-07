#!/usr/bin/env node
'use strict';

const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const path = require('path');

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error('Usage: reset-password.sh <username> <new-password>');
  process.exit(1);
}

if (
  newPassword.length < 16 ||
  !/[A-Z]/.test(newPassword) ||
  !/[a-z]/.test(newPassword) ||
  !/[0-9]/.test(newPassword) ||
  !/[^A-Za-z0-9]/.test(newPassword)
) {
  console.error(
    'Error: Password must be at least 16 characters and include uppercase letters, lowercase letters, numbers, and symbols.'
  );
  process.exit(1);
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/capital-tracker.db');
const db = new Database(dbPath);

const hash = bcrypt.hashSync(newPassword, 12);
const result = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);

if (result.changes === 0) {
  console.error(`Error: User "${username}" not found.`);
  process.exit(1);
}

console.log(`Password reset successfully for user: ${username}`);
