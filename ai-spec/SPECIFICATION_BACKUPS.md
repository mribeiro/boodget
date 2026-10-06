# Scheduled Automatic Backups — Specification

## 1. Overview

boodget backs up its whole SQLite database on a schedule (weekly by default), keeping the most recent N copies in a plain folder. Getting those copies **off the machine** is deliberately left to the operator's own tooling (Kopia, restic, a NAS mount, cloud sync…) pointed at that folder — boodget doesn't upload anywhere and doesn't encrypt (the folder is meant to be picked up by tooling that does).

What's backed up is the **entire database** (every user, session, dossier, setting, the VAPID keys and per-dossier AI API keys) — not per-dossier JSON exports, which would miss users and account-level data and would need re-importing one dossier at a time to restore.

## 2. Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_ENABLED` | `true` (`false` when `NODE_ENV=ephemeral`) | Turns the schedule on/off. Manual "Back up now" works either way. |
| `BACKUP_DIR` | `backups/` next to `DB_PATH` (`/data/backups` in Docker) | Where copies are written. Created with mode `0700` if missing. |
| `BACKUP_CRON` | `0 3 * * 0` (Sundays 03:00, server time) | node-cron expression. An invalid one disables the schedule with a logged error. |
| `BACKUP_KEEP` | `12` | How many copies to keep (≈ 3 months at weekly). Anything < 1 or non-numeric falls back to 12. |

Configuration is env-only (an operator concern, like `DB_PATH`); the admin page shows it read-only.

## 3. Taking a backup (`backend/src/backups/index.js`, `runBackup`)

1. Write a consistent online copy with better-sqlite3's `db.backup()` (SQLite's backup API — safe while the app is serving requests) to a hidden temp name `.boodget-<stamp>.db.partial`.
2. Open the copy, switch it to a rollback journal (`PRAGMA journal_mode = DELETE`) and run `PRAGMA integrity_check`; anything but `ok` fails the backup. The live DB runs in WAL mode and `db.backup()` carries that over; a read-only connection used to leave a `-wal`/`-shm` pair next to every copy that nothing removed (#379), whereas this way each backup is one self-contained file.
3. `chmod 0600` (the file holds password hashes, sessions and API keys), then rename to `boodget-YYYY-MM-DD_HHMMSS.db` (UTC). A copy that failed any step is deleted — a partial file never carries a final name.
4. Prune: delete all but the `BACKUP_KEEP` newest `boodget-*.db` files (name order = age order), plus any leftover `.partial` (and its `-wal`/`-shm` sidecars) from an interrupted run. Other files in the folder are never touched.
5. Record the outcome in `app_settings` under `backup_last_run` (`{ ok, at, trigger: 'scheduled'|'manual', by, file, size, error }`) — failures too.

Only one backup runs at a time per process; a second request while one is running gets `409`.

**Failure alerting**: when a *scheduled* backup fails, every admin's push subscriptions get a `backup_failed` push ("Backup failed" — "The scheduled database backup failed: …", url `/backups`). It's sent directly, outside the per-dossier notification scheduler (no opt-in, no dedup — it's at most once per scheduled run). Manual failures are shown in the UI instead.

## 4. API (admin only — `403` otherwise)

```
GET  /api/backups                    # { enabled, schedule, keep, dir, running, last_run, backups: [{ name, size, created_at }] } newest first
POST /api/backups                    # back up now → 201 last-run object; 409 if one is running; 500 { error } on failure
```

## 5. Admin UI (`frontend/src/pages/Backups.jsx`, route `/backups`)

A **Backups** entry in the sidebar's bottom block, shown to admins only. The page shows:

- A status banner: red when the last run failed (with the error), amber when scheduled backups are on but the newest copy is older than the schedule's own interval plus a day's grace — 2 days for a daily `BACKUP_CRON`, 8 for a weekly one, 32 for a monthly one or any shape `describeSchedule` doesn't read (`scheduleIntervalDays`); a fixed 8-day threshold used to flag a monthly schedule for most of every month (#379), amber when there are no backups yet (`backupHealth` in `utils/backups.js`).
- Read-only config: schedule in plain English (`describeSchedule` — "Weekly on Sunday at 03:00 (server time)"), retention, folder, last run (OK/Failed badge, when, scheduled or manual-by-whom).
- The list of backups (date, file name, size — formatted with the app's separators via `formatNumber`, e.g. `1.536,0 MB`). There is **no download** (#372): a backup is the whole database — every user's dossiers, password hashes, sessions and the write-only secrets (`ai_api_key`, `paperless_token`) — so serving it would give any admin what the admin flag deliberately doesn't ("grants nothing over dossiers"). Copies leave the machine through the operator's tooling reading `BACKUP_DIR` on the host; the page says so.
- A "Back up now" button in the page header.
- Restore instructions (below).

Non-admins reaching `/backups` directly see "Only administrators can manage backups."

## 6. Restoring

Manual, by design (swapping the live database from inside the running app is risky):

1. Stop the container (`docker compose stop`).
2. Replace `data/capital-tracker.db` with the chosen backup, renamed to that name (and remove any `capital-tracker.db-wal`/`-shm` files next to it).
3. Start it again (`docker compose up -d`). Pending migrations run on startup, so an older backup is upgraded automatically.

Everyone's sessions are those stored in the backup, so users may need to log in again.
