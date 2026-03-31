# boodget — Preview Environments Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`. Read both before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- This document defines the infrastructure for **ephemeral preview environments** — one per branch, automatically created and destroyed via GitHub Actions.
- Before generating any files, **propose the folder structure and any changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed. In particular, do **not modify** `.github/workflows/deploy.yml`.

---

## 1. Overview

Every push to a branch (other than `main` and `dev`) automatically creates an isolated preview environment accessible at `<slug>.preview.<DOMAIN>`. When the branch is deleted, the environment is automatically destroyed.

Each environment is a fully independent Docker Compose stack running on the same server as production, routed by the existing Traefik instance.

---

## 2. Branch Slug

The branch name is sanitised into a **slug** used for naming all resources:

- Lowercased
- Any character that is not `a-z` or `0-9` replaced with `-`
- Consecutive `-` collapsed into one
- Leading and trailing `-` removed

Examples:
- `feature/my-thing` → `feature-my-thing`
- `fix/login_bug` → `fix-login-bug`
- `CHORE/Update-Deps` → `chore-update-deps`

---

## 3. GitHub Actions Workflow

### 3.1 File

Create `.github/workflows/preview.yml`. Do **not** modify the existing `deploy.yml`.

### 3.2 Trigger

```yaml
on:
  push:
    branches-ignore:
      - main
      - dev
  delete:
```

### 3.3 Deploy job

Runs on event `push`. Steps:

1. `actions/checkout@v4`
2. Compute slug from `github.ref_name` using shell substitution (tr + sed). Export as `SLUG` to `$GITHUB_ENV`.
3. Build Docker image:
   ```
   docker build \
     -t capital-tracker:preview-$SLUG \
     --build-arg GIT_COMMIT=${{ github.sha }} \
     .
   ```
4. Generate `docker-compose.yml` for this environment and run it (see Section 4).

### 3.4 Destroy job

Runs on event `delete` with condition `github.event.ref_type == 'branch'`. Does **not** require `actions/checkout`.

Steps:
1. Compute slug from `github.event.ref` (same logic as deploy).
2. If `$STACK_DIR` exists: `docker compose down --rmi local` then `rm -rf $STACK_DIR`.
3. If it does not exist: log and exit cleanly (no failure).

### 3.5 Runner

Both jobs run on `self-hosted`, matching the existing `deploy.yml` pattern.

### 3.6 Required secrets and variables

The workflow reads the following from the GitHub repository configuration:

| Type | Name | Description |
|---|---|---|
| Secret | `PREVIEW_DOMAIN` | Base domain, e.g. `example.com`. Environments are at `<slug>.preview.example.com`. |
| Secret | `PREVIEW_SESSION_SECRET` | Random string for signing Express sessions in preview containers. |
| Variable | `TRAEFIK_NETWORK` | Name of the external Docker network that Traefik is attached to. Default: `traefik`. |
| Variable | `PREVIEW_CERT_RESOLVER` | Name of the Traefik cert resolver. Default: `letsencrypt`. |
| Variable | `PREVIEW_STACK_BASE` | Absolute path on the server where preview stacks are stored. Default: `/home/mothership/docker/stacks/capital-tracker-preview`. |

---

## 4. Per-Environment Docker Compose

Each preview environment gets its own directory and `docker-compose.yml`, generated dynamically by the workflow.

### 4.1 Directory structure

```
$PREVIEW_STACK_BASE/
└── <slug>/
    ├── docker-compose.yml    ← generated on every push to that branch
    └── data/                 ← created by the workflow; holds the SQLite database
```

The `data/` directory is created by the workflow with `mkdir -p` before running `docker compose up`. This ensures it exists and is owned by the host user, preventing Docker from creating it as root.

### 4.2 docker-compose.yml content

Generated via heredoc inside the workflow. Must include:

- **Service name**: `app`
- **Image**: `capital-tracker:preview-<slug>`
- **Container name**: `capital-tracker-preview-<slug>`
- **Restart policy**: `unless-stopped`
- **Environment variables**:
  - `NODE_ENV=ephemeral` — triggers the light-rose navbar tint so users can immediately identify preview instances
  - `SESSION_SECRET` — from `PREVIEW_SESSION_SECRET` secret
  - `DB_PATH=/data/capital-tracker.db`
  - `SEED_ON_EMPTY=true`
- **Volume**: `./data:/data`
- **Network**: the external Traefik network
- **Traefik labels**:
  - Enable Traefik
  - Router rule: `` Host(`<slug>.preview.<DOMAIN>`) ``
  - Entrypoint: `websecure`
  - TLS enabled, cert resolver from variable
  - Service port: `3000`

Router and service names in Traefik labels must be unique per environment. Use `ct-preview-<slug>` as the prefix for both.

### 4.3 Deploy command

```bash
cd "$STACK_DIR"
docker compose up -d --force-recreate
```

`--force-recreate` ensures the container is replaced even if the compose file did not change (new image built from the same branch).

---

## 5. Environment-Based Navbar Styling

The backend injects `window.__APP_ENV__` into the served `index.html` at request time:

```js
const appEnv = process.env.NODE_ENV || 'production';
const injected = html.replace('<head>', `<head><script>window.__APP_ENV__="${appEnv}";</script>`);
```

The `Navbar` component in `App.jsx` reads this value and applies a background colour:

| Value | Colour | CSS variable |
|---|---|---|
| `dev` | `#f0fdfa` (light teal) | `--color-navbar-dev` |
| `ephemeral` | `#fff1f2` (light rose) | `--color-navbar-ephemeral` |
| `production` / unset | no override | — |

Preview containers use `NODE_ENV=ephemeral`, so the rose navbar gives a visual cue that the user is on a preview instance. Static file serving is triggered by the existence of `frontend-dist/` (not by `NODE_ENV`), so `ephemeral` works the same as `production` for serving the frontend.

---

## 6. Database Seeding

### 6.1 Mechanism

The backend supports a `SEED_ON_EMPTY` environment variable. When set to `"true"`, the application calls the seed function at startup, **before** the HTTP server begins accepting requests.

The seed function is **idempotent**: it checks whether any users exist in the database before doing anything. If users already exist, it does nothing and returns immediately.

### 6.2 Integration point

In `backend/src/index.js`, after the database module is initialised and migrations have run:

```js
if (process.env.SEED_ON_EMPTY === 'true') {
  require('./db/seed')();
}
```

### 6.3 Seed file

`backend/src/db/seed.js` uses the `db` singleton from `backend/src/db/index.js`. All inserts run inside a single transaction.

The seed uses internal helper functions (`mkDossier`, `mkAccounts`, `mkMonth`, `mkCycle`, `mkGoal`) to keep each dossier declaration concise and DRY.

### 6.4 Dynamic date computation

All dates are computed relative to **today at seed time** (`new Date()`). This keeps the seeded data current regardless of when a preview environment is deployed.

Key computed values:
- `curCycleYear / curCycleMonth` — the cycle whose date range covers today (same logic as the frontend's `cycleYearMonth()`)
- `prevCycleYear / prevCycleMonth` — one cycle before
- `calYear / calMonth` — current calendar month
- `prevCalYear / prevCalMonth` — previous calendar month
- `warningOn = todayDay` — a warning threshold that always fires today (`todayDay >= warningOn`)
- `warningOff = min(28, todayDay + 1)` — a threshold that never fires today (edge case: day 28)
- `overdueDay = 25` (= `CYCLE_START`) — a `day_of_payment` that maps to the previous calendar month in the current cycle, so it is always in the past
- `futureDay = 24` (= `CYCLE_START - 1`) — maps to the last day of the cycle's second segment, always upcoming

### 6.5 Seeded data

#### User

| Field | Value |
|---|---|
| username | `preview` |
| password | `Preview@Capital2024!` |
| is_oidc | `0` |

#### Dossiers (5 total)

All dossiers use `cycle_start_day = 25` and `currency = EUR`.

---

**Dossier 0 — "My Finances"** (full-featured preview dossier, all Glances neutral)

- `capital_snapshot_warning_day = warningOff`, `next_cycle_warning_day = warningOff`, `previous_cycle_close_warning_day = warningOff`
- 4 accounts: Current Account (idle), Savings, Stock Portfolio, Index Funds
- 3 filled months: two months ago, last month, current month
- Monthly expense template: 5 fixed + 3 budget expenses, 2 distributions
- Annual expense template: Car Insurance, Home Insurance, Holiday Budget, Tech Subscriptions
- Previous cycle (closed) + current cycle (open, partial progress)
- Workbench snapshot: "Base Scenario"

---

**Dossier A — "Glances — All Good"** (all four Glances cards in neutral/positive state)

- All warning thresholds: `warningOff`
- 2 accounts: Current Account (idle), Index Funds
- 2 filled months: previous + current calendar month → Capital shows variation and idle money
- Cycles: previous cycle closed; current cycle open with 1 paid expense (`overdueDay`), 1 unpaid upcoming expense (`futureDay`), 1 budget, 1 distribution
- Goals: 1 active (target >> current Index Funds value), 1 completed (target ≤ current Current Account value)

---

**Dossier B — "Glances — Capital Snapshot Missing"** (Capital card: amber)

- `capital_snapshot_warning_day = warningOn`; other thresholds: `warningOff`
- 2 accounts: Savings, Stock Portfolio
- **Only 2 older filled months** — no snapshot for the current calendar month → Capital amber
- Cycles: previous cycle closed; current cycle open with 1 unpaid future expense
- Goals: none → "No goals defined"

---

**Dossier C — "Glances — Red Alerts"** (Cycle: red · Next Expense: amber · Goals: red)

- `previous_cycle_close_warning_day = warningOn`; other thresholds: `warningOff`
- 2 accounts: Current Account (idle), Bonds
- 2 filled months: previous + current → Capital normal
- Cycles: previous cycle **not closed** (`is_closed = false`) → Cycle card **red**; current cycle open with 1 overdue unpaid expense (`overdueDay`, `paid = false`) → Next Expense card **amber**
- Goals: 1 failed (target_date already passed, current value << target_value) → Goals card **red**

---

**Dossier D — "Glances — Next Cycle Not Opened"** (Cycle card: amber · Next Expense: all paid · Goals: completed)

- `next_cycle_warning_day = warningOn`; other thresholds: `warningOff`
- 2 accounts: Savings, Index Funds
- 2 filled months: previous + current → Capital normal
- Cycles: previous cycle **closed** (prevents red override); current cycle open with **all fixed expenses paid**; next cycle not created → Cycle card **amber**
- Goals: 1 completed (current Savings value ≥ target_value)

---

## 7. Preview Index Service

A lightweight, persistent Node.js HTTP service that lists all running preview environments. It runs as a separate Docker Compose stack, deployed once manually on the server (not via GitHub Actions).

### 6.1 Location in repository

```
preview-index/
├── server.js
├── Dockerfile
└── docker-compose.yml
```

### 6.2 server.js

- Plain Node.js HTTP server (no npm dependencies). Uses only built-in modules (`http`, `child_process`).
- Queries the Docker socket via `curl --unix-socket /var/run/docker.sock` to list containers whose name starts with `capital-tracker-preview-`.
- For each container, extracts: slug (from container name), URL (`https://<slug>.preview.<DOMAIN>`), Docker state, Docker status string, and creation timestamp.
- Renders an HTML page with a table of environments (slug, state badge, status, relative creation time).
- Includes a `<meta http-equiv="refresh" content="30">` for auto-refresh.
- Exposes a `/health` endpoint returning `200 ok`.
- Port: `3000`. Domain read from `PREVIEW_DOMAIN` environment variable.

### 6.3 Dockerfile

- Base: `node:20-alpine`
- Must install `curl` (needed to query the Docker socket)
- No `package.json` needed (no dependencies)
- Copies `server.js` and runs it with `node server.js`

### 6.4 docker-compose.yml

- Mounts `/var/run/docker.sock` as **read-only** (`:ro`)
- Connects to the external Traefik network
- Traefik labels routing `preview.<DOMAIN>` to port `3000`
- Reads `PREVIEW_DOMAIN`, `TRAEFIK_NETWORK`, `CERT_RESOLVER` from environment / `.env` file
- `restart: unless-stopped`

---

## 8. File Summary

All files described in this specification have been created and are in place:

| File | Description |
|---|---|
| `.github/workflows/preview.yml` | Preview deploy/destroy workflow |
| `backend/src/db/seed.js` | Multi-dossier seed for Glances scenario testing |
| `backend/src/index.js` | Calls `seed()` at startup when `SEED_ON_EMPTY=true` |
| `preview-index/server.js` | Index service HTTP server |
| `preview-index/Dockerfile` | Image for index service |
| `preview-index/docker-compose.yml` | Persistent index stack |

---

## 9. Out of Scope

- Any changes to the production or dev deployment pipelines (`deploy.yml`)
- Authentication or access control on the preview index page
- Automatic cleanup of stale environments (no push activity for N days)
- Preview environments for `main` or `dev` branches
