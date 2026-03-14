# Capital Tracker — Preview Environments Specification

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

### 5.1 Mechanism

The backend must support a `SEED_ON_EMPTY` environment variable. When set to `"true"`, the application calls the seed function at startup, **before** the HTTP server begins accepting requests.

The seed function must be **idempotent**: it checks whether any users exist in the database before doing anything. If users already exist, it does nothing and returns immediately.

### 5.2 Integration point

In `backend/src/index.js`, after the database module is initialised and migrations have run, add:

```js
if (process.env.SEED_ON_EMPTY === 'true') {
  require('./db/seed')();
}
```

This must run before `app.listen(...)`.

### 5.3 Seed file

Create `backend/src/db/seed.js`. It must use the same `db` singleton from `backend/src/db/index.js` and run all inserts inside a single transaction.

### 5.4 Baseline data

The seed must create the following in a single transaction:

#### User
| Field | Value |
|---|---|
| username | `preview` |
| password | `Preview@Capital2024!` |
| is_oidc | `0` |

Password must be hashed with `bcrypt` (same as the rest of the application).

#### Dossier
| Field | Value |
|---|---|
| name | `My Finances` |
| currency | `EUR` |
| cycle_start_day | `25` |

The user must be added to `dossier_access` for this dossier.

#### Accounts (4 total)

| Group | Name | Type | is_idle_money | position |
|---|---|---|---|---|
| Main Bank | Current Account | Current Account | true | 1 |
| Main Bank | Savings | Guaranteed Investment | false | 2 |
| Broker | Stock Portfolio | Risk Investment | false | 3 |
| Broker | Index Funds | Risk Investment | false | 4 |

#### Months (3 filled months)

| Year | Month | Values (acc1–4) | Comment |
|---|---|---|---|
| 2025 | 1 | 3200, 8500, 4100, 6200 | January snapshot |
| 2025 | 2 | 3450, 8800, 4400, 6600 | February snapshot |
| 2025 | 3 | 3600, 9200, 4250, 7100 | March snapshot |

Each month must populate `month_account_snapshot` (all 4 accounts) and `month_entries` with the values above. `filled` must be `1`.

#### Monthly Expense Template

Expenses:

| Name | Type | Value | day_of_payment | classification |
|---|---|---|---|---|
| Rent | Fixed | 900 | 1 | must |
| Electricity | Fixed | 65 | 10 | must |
| Internet | Fixed | 35 | 15 | must |
| Gym | Fixed | 45 | 5 | want |
| Streaming | Fixed | 18 | 20 | want |
| Groceries | Budget | 350 | — | must |
| Restaurants | Budget | 120 | — | want |
| Transport | Budget | 80 | — | must |

Distributions:

| Name | Value | must_amount | want_amount | save_amount |
|---|---|---|---|---|
| Emergency Fund | 200 | 0 | 0 | 200 |
| Investment Top-up | 300 | 0 | 0 | 300 |

#### Annual Expense Template

| Name | Value | day_of_payment | month_of_payment | classification |
|---|---|---|---|---|
| Car Insurance | 720 | 15 | 3 | must |
| Home Insurance | 280 | 1 | 1 | must |
| Holiday Budget | 1200 | 1 | 7 | want |
| Tech Subscriptions | 150 | 1 | 1 | want |

#### Expense Cycle (open, March 2025)

| Field | Value |
|---|---|
| year | 2025 |
| month | 3 |
| salary | 1950 |
| previous_balance | 230 |
| is_closed | 0 |

Cycle items:

| Name | Type | Section | Value | day_of_payment | paid | spent | done |
|---|---|---|---|---|---|---|---|
| Rent | Fixed | expense | 900 | 1 | true | — | — |
| Electricity | Fixed | expense | 65 | 10 | true | — | — |
| Internet | Fixed | expense | 35 | 15 | false | — | — |
| Gym | Fixed | expense | 45 | 5 | false | — | — |
| Streaming | Fixed | expense | 18 | 20 | false | — | — |
| Groceries | Budget | expense | 350 | — | — | 180 | — |
| Restaurants | Budget | expense | 120 | — | — | 45 | — |
| Transport | Budget | expense | 80 | — | — | 32 | — |
| Emergency Fund | — | distribution | 200 | — | — | — | false |
| Investment Top-up | — | distribution | 300 | — | — | — | false |

#### Workbench Snapshot

One snapshot named `Base Scenario`. The `data` field is a JSON string with the full workbench state, containing:

- `income`: two entries — `{ name: 'Salary', value: 1950 }` and `{ name: 'Freelance', value: 200 }`
- `monthlyExpenses`: all 8 template entries with `fromTemplate: true` and their respective classifications
- `annualExpenses`: all 4 template entries with `fromTemplate: true` and their respective classifications
- `distributions`: both template entries with `fromTemplate: true` and their `mustAmount`/`wantAmount`/`saveAmount` decomposition

Each entry must have a stable string `id` (e.g. `inc-1`, `me-1`, `ae-1`, `di-1`).

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

Files to **create**:

| File | Description |
|---|---|
| `.github/workflows/preview.yml` | Preview deploy/destroy workflow |
| `backend/src/db/seed.js` | Baseline seed data for preview environments |
| `preview-index/server.js` | Index service HTTP server |
| `preview-index/Dockerfile` | Image for index service |
| `preview-index/docker-compose.yml` | Persistent index stack |

Files to **modify**:

| File | Change |
|---|---|
| `backend/src/index.js` | Call `seed()` at startup when `SEED_ON_EMPTY=true` |

---

## 9. Out of Scope

- Any changes to the production or dev deployment pipelines (`deploy.yml`)
- Authentication or access control on the preview index page
- Automatic cleanup of stale environments (no push activity for N days)
- Preview environments for `main` or `dev` branches
