const express = require('express');
const backups = require('../backups');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Only administrators can manage backups' });
  next();
});

// GET /api/backups
router.get('/', (req, res) => {
  const config = backups.getConfig();
  res.json({
    enabled: config.enabled,
    schedule: config.cron,
    keep: config.keep,
    dir: config.dir,
    running: backups.isRunning(),
    last_run: backups.getLastRun(),
    backups: backups.listBackups(config.dir),
  });
});

// POST /api/backups — back up now
router.post('/', async (req, res) => {
  try {
    const result = await backups.runBackup({ trigger: 'manual', by: req.user.username });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : `Backup failed: ${err.message}` });
  }
});

// No download endpoint, on purpose (#372): a backup is the whole database — every user's
// dossiers plus the write-only secrets (dossiers.ai_api_key, paperless_token) — and the admin flag
// grants nothing over dossiers. Copies leave the machine through the operator's own tooling
// reading BACKUP_DIR on the host, where filesystem access is the real trust boundary.

module.exports = router;
