const express = require('express');
const path = require('path');
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

// GET /api/backups/:name/download
router.get('/:name/download', (req, res) => {
  const { name } = req.params;
  if (!backups.FILE_RE.test(name)) return res.status(400).json({ error: 'Invalid backup name' });
  const { dir } = backups.getConfig();
  if (!backups.listBackups(dir).some((b) => b.name === name)) return res.status(404).json({ error: 'Backup not found' });
  console.log(`[backup] ${name} downloaded by ${req.user.username}`);
  res.download(path.join(dir, name), name);
});

module.exports = router;
