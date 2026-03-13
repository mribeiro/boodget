# CLAUDE.md — Capital Tracker

This file provides AI assistants with the context needed to understand and work effectively in this codebase.

## Project Overview

**Capital Tracker** is a self-hosted personal finance application for tracking monthly capital snapshots. Users define accounts (investments, savings, etc.), record their value each month, and visualize their capital evolution over time.

Key concepts:
- **Dossier**: A named container for a set of accounts, monthly snapshots, and expense cycles. Owned by one user, shareable with others.
- **Account**: An asset being tracked (bank account, investment fund, etc.), belonging to a dossier.
- **Month**: A monthly snapshot capturing the value of all accounts at a point in time.
- **Expense Cycle**: A monthly budget/expense tracking period. Has a salary, previous balance, and a list of expense/distribution items. Cycles are independent — multiple can be open at the same time; the only uniqueness constraint is `(dossier_id, year, month)`.
- **Cycle Item**: An expense or distribution within a cycle. Expenses are either `Fixed` (with a `day_of_payment` and paid checkbox) or `Budget` (with a max and a `spent` amount). Distributions have a `done` checkbox.
- **Expense Template**: A per-dossier list of template items (expenses and distributions) that are automatically copied into each new cycle when it is created. Payment days are clamped to the last day of the cycle's month at copy time. Each expense entry also carries a `classification` (`must`/`want`). Distribution entries carry `must_amount`, `want_amount`, `save_amount` decomposition fields.
- **Annual Expense Template**: A per-dossier list of annual expenses (separate from the monthly expense template). Each entry has `name`, `value`, `day_of_payment`, `month_of_payment`, `classification`. Used by the Workbench to compute monthly averages (value / 12).
- **Workbench**: A scenario calculator within a dossier. Users model income vs. expenses vs. distributions with Must/Want/Save breakdowns. State is ephemeral per session. Can be saved as named **snapshots** (persisted). If exactly one snapshot exists, it is auto-loaded on open. A "New from scratch" button resets to the template-based working state.
- **Goal**: A financial objective with a name, target value, and target date, scoped to a dossier. Tracks progress via contributing accounts (current value) and monthly contributions (via distribution template items, a fixed manual amount, or ad-hoc). Supports historical contributions for months before cycle tracking began. State is auto-computed: `active`, `completed`, or `failed`.

## Versioning

Current version: **v0.1** (tagged in git). Both `backend/package.json` and `frontend/package.json` carry the version as `0.1.0`. When releasing a new version, bump both package files and create an annotated git tag (`git tag -a vX.Y -m "..."`).

## Architecture

```
capital-tracker/
├── backend/          # Node.js + Express REST API (CommonJS)
│   ├── src/
│   │   ├── index.js          # App entry: middleware, routes, OIDC init, static serving
│   │   ├── db/index.js       # SQLite schema, migrations, db singleton
│   │   ├── middleware/auth.js # requireAuth middleware
│   │   └── routes/
│   │       ├── auth.js       # Login, logout, OIDC, change-password
│   │       ├── setup.js      # First-launch setup
│   │       ├── users.js      # User CRUD
│   │       ├── dossiers.js   # Dossier CRUD, sharing, import/export (v4); mounts expenses + goals sub-routers
│   │       ├── accounts.js   # Account CRUD (nested under dossiers)
│   │       ├── months.js     # Month snapshots and entries (nested under dossiers)
│   │       ├── expenses.js   # Expense settings, monthly template, annual template, cycles,
│   │       │                 # cycle items, workbench snapshots (nested under dossiers)
│   │       └── goals.js      # Goals CRUD, cycle contributions, historical contributions (nested under dossiers)
│   ├── scripts/
│   │   ├── reset-password.js # Node.js tool for emergency password reset
│   │   └── reset-password.sh # Shell wrapper (made executable in Docker image)
│   └── Dockerfile            # Multi-stage: builds frontend (with GIT_COMMIT arg), then runs backend+frontend
├── frontend/         # React 18 SPA (ES Modules, Vite)
│   ├── src/
│   │   ├── main.jsx          # React entry point
│   │   ├── App.jsx           # AuthContext, routing, setup/login gates; navbar shows 7-char git SHA
│   │   ├── services/api.js   # Fetch-based API client wrapper
│   │   └── components/
│   │       ├── DossierView.jsx         # Dossier page with Capital / Monthly Expenses / Workbench / Settings tabs
│   │       ├── DossierSettingsTab.jsx  # Settings tab: cycle start day, monthly template, annual template
│   │       ├── expenses/
│   │       │   ├── ExpensesTab.jsx         # Monthly Expenses tab (renders CycleList)
│   │       │   ├── CycleList.jsx           # List of cycles with placeholder rows
│   │       │   ├── CycleEditor.jsx         # Single cycle view (items, summary, close/reopen)
│   │       │   ├── ExpenseTemplate.jsx     # Monthly expense template editor (with classification)
│   │       │   ├── AnnualExpenseTemplate.jsx # Annual expense template editor
│   │       │   └── DossierSettings.jsx     # Cycle start day setting
│   │       ├── workbench/
│   │       │   └── WorkbenchTab.jsx        # Workbench scenario calculator (income, expenses, distributions, summary, snapshots)
│   │       └── goals/
│   │           ├── GoalsTab.jsx            # Goals list tab within DossierView
│   │           ├── GoalFormModal.jsx       # Create/edit goal modal
│   │           └── GoalDetail.jsx          # Goal detail view (progress bar, chart, cycle contributions, historical contributions)
├── ai-spec/
│   ├── SPECIFICATION.md                  # Core product specification (Capital section)
│   ├── SPECIFICATION_MONTHLY_EXPENSES.md # Monthly Expenses specification
│   ├── SPECIFICATION_WORKBENCH.md        # Workbench specification
│   └── SPECIFICATION_GOALS.md            # Goals specification
├── .github/
│   └── workflows/
│       ├── deploy.yml          # CI/CD: build Docker image and deploy to self-hosted runner
│       └── preview-deploy.yml  # Ephemeral preview environments for feature branches
├── docker-compose.yml        # Production deployment (SQLite persisted to ./data/)
└── .devcontainer/            # VS Code Dev Container config
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20 |
| Backend framework | Express 4 |
| Database | SQLite via `better-sqlite3` (synchronous API) |
| Sessions | `express-session` (72-hour expiry, httpOnly, SameSite=lax) |
| Password hashing | `bcrypt` |
| SSO | `openid-client` (OIDC, optional) |
| Frontend framework | React 18 |
| Frontend build | Vite 5 |
| Routing | `react-router-dom` v6 |
| Charts | `recharts` |
| Deployment | Docker + Docker Compose |

## Development Workflow

### Running Locally (Dev Container)

The repo ships with a `.devcontainer/` config. When opened in VS Code with the Dev Containers extension, it:
1. Starts the `docker-compose.yml` service
2. Installs npm deps for both `backend/` and `frontend/`
3. Forwards port 3000 (backend) and 5173 (frontend dev server)

**Start backend dev server** (hot-reload via `--watch`):
```bash
cd backend && npm run dev
```

**Start frontend dev server** (Vite, proxies `/api` → `localhost:3000`):
```bash
cd frontend && npm run dev
```

### Running via Docker (Production)

```bash
# Build and start
docker compose up --build

# Access at http://localhost:3000
```

The `SESSION_SECRET` environment variable in `docker-compose.yml` **must be changed** to a secure random string before real use.

### Building for Production

```bash
cd frontend && npm run build   # outputs to frontend/dist/
```

The backend serves the built frontend from `frontend-dist/` (inside the Docker image — the Dockerfile copies `frontend/dist/` to `./frontend-dist` in the container) when `NODE_ENV=production`.

### Git Commit SHA in Navbar

The Dockerfile accepts a `GIT_COMMIT` build arg (set by the CI/CD workflow to `github.sha`). It is exposed to Vite as `VITE_GIT_COMMIT`. The Navbar in `App.jsx` displays the first 7 characters of this SHA in the header for build identification. In local dev it shows `unknown`.

### CI/CD Pipeline

**Production/Dev** — `.github/workflows/deploy.yml` runs on every push to `main` or `dev`:

1. **Build** (self-hosted runner): `docker build -t capital-tracker:latest[-dev] --build-arg GIT_COMMIT=<sha> .`
2. **Deploy** (self-hosted runner): `docker compose up -d --force-recreate` from `/home/mothership/docker/stacks/capital-tracker[-dev]/`

- The `-dev` suffix is appended to both the image tag and deploy directory when the branch is `dev`.
- The workflow uses `workflow_dispatch` for manual triggers.

**Preview environments** — `.github/workflows/preview-deploy.yml` runs on every push to any branch except `main` and `dev`:

1. **Compute slug**: branch name is lowercased and non-alphanumeric characters replaced with `-` (e.g. `feature/foo-bar` → `feature-foo-bar`).
2. **Generate docker-compose.yml**: written to `$PREVIEW_STACK_BASE/<slug>/` (default base: `/home/mothership/docker/stacks/capital-tracker-preview`). The compose file wires the container into Traefik with the host rule `<slug>.preview.<PREVIEW_DOMAIN>`.
3. **Build**: `docker build -t capital-tracker:preview-<slug> --build-arg GIT_COMMIT=<sha> .`
4. **Deploy**: `docker compose up -d --force-recreate` in the stack directory.
5. **Comment on PR**: looks up the open PR for the branch via `gh pr list`. If found, posts (or updates in-place) a comment with the preview URL and short commit SHA. The comment is identified by the hidden marker `<!-- capital-tracker-preview -->` so subsequent pushes update the same comment rather than creating a new one. If no open PR exists the step exits silently.

Required GitHub secrets/vars for preview environments:

| Name | Kind | Description |
|---|---|---|
| `PREVIEW_DOMAIN` | secret | Base domain (e.g. `example.com`). Preview URL becomes `https://<slug>.preview.<PREVIEW_DOMAIN>`. |
| `PREVIEW_SESSION_SECRET` | secret | Session secret injected into preview containers. |
| `PREVIEW_STACK_BASE` | var | Directory where per-branch stack folders are created. Default: `/home/mothership/docker/stacks/capital-tracker-preview`. |
| `TRAEFIK_NETWORK` | var | Docker network name for Traefik. Default: `traefik`. |
| `PREVIEW_CERT_RESOLVER` | var | Traefik cert resolver name. Default: `letsencrypt`. |

### Emergency Password Reset

```bash
docker exec -it <container> /app/scripts/reset-password.sh <username> <new-password>
```

The shell script (`reset-password.sh`) is a thin wrapper that calls `reset-password.js`; both live in `backend/scripts/`. The `.sh` file is made executable in the Docker image (`chmod +x`).

## Database

SQLite database at path `DB_PATH` env var (default: `/data/capital-tracker.db` in Docker).

### Schema Summary

| Table | Description |
|---|---|
| `users` | User accounts. `is_oidc=1` for SSO users (no password). |
| `sessions` | Express session store. |
| `dossiers` | Capital dossiers. `creator_id` FK → `users`. |
| `dossier_access` | Many-to-many sharing: `(dossier_id, user_id)` PK. |
| `accounts` | Tracked accounts. `type` ∈ `{Risk Investment, Guaranteed Investment, Current Account}`. `archived` hides from new months. `is_idle_money` flags liquid cash. `position` controls display order. |
| `months` | Monthly snapshots. `(dossier_id, year, month)` UNIQUE. `filled` bool marks completion. |
| `month_account_snapshot` | Which accounts were active when a month was created (composite PK). |
| `month_entries` | One row per `(month_id, account_id)` with `value` and optional `comment`. |
| `expense_template_items` | Per-dossier monthly expense/distribution template. `section` ∈ `{expense, distribution}`, `type` ∈ `{Fixed, Budget}`, `day_of_payment` (Fixed only). Expense entries have `classification` (`must`/`want`). Distribution entries have `must_amount`, `want_amount`, `save_amount` decomposition fields. |
| `expense_cycles` | One row per cycle. `(dossier_id, year, month)` UNIQUE. Has `salary`, `previous_balance`, `is_closed`, `final_real_balance`. |
| `cycle_items` | Items within a cycle. `section` ∈ `{expense, distribution}`. Fixed expenses have `paid` bool. Budget expenses have `spent` real. Distributions have `done` bool. `template_item_id` FK to template (nullable). |
| `annual_expense_template_items` | Per-dossier annual expense template. Fields: `name`, `value`, `day_of_payment`, `month_of_payment` (1–12), `classification` (`must`/`want`), `position`. Used by the Workbench (monthly avg = value / 12). |
| `workbench_snapshots` | Named snapshots of the Workbench state per dossier. Fields: `name`, `data` (JSON string of full workbench state), `created_at`, `updated_at`. |
| `goals` | Financial objectives per dossier. Fields: `name`, `target_value`, `target_date` (YYYY-MM), `extra_value` (nullable), `extra_value_impact_mode` (`reduce_monthly_amount`/`anticipate_end_date`, nullable), `contribution_mode` (`via_distributions`/`manual`/`ad_hoc`), `manual_monthly_value` (nullable), `created_at`. |
| `goal_accounts` | Many-to-many: accounts whose current value counts toward a goal. Composite PK `(goal_id, account_id)`. Cascades on goal or account delete. |
| `goal_distributions` | Many-to-many: distribution template items selected for `via_distributions` mode. Composite PK `(goal_id, distribution_template_id)`. Cascades on goal or template item delete. |
| `goal_cycle_contributions` | Real contribution per cycle for `manual` mode goals. Composite PK `(goal_id, cycle_id)`. `real_contribution` is upserted. Cascades on goal or cycle delete. |
| `goal_historical_contributions` | Pre-cycle historical contributions (year/month/amount) for the chart. Composite PK `(goal_id, year, month)`. Managed via bulk-replace. Cascades on goal delete. |

`dossiers` also has a `cycle_start_day INTEGER DEFAULT 25` column (added in migration `003`).

### Migration System

All schema changes **must** go through the migration system in `backend/src/db/index.js`. Migrations run automatically at service startup.

- A `schema_migrations` table tracks which migrations have been applied (by `id`).
- Migrations are defined as an array of `{ id, up() }` objects. The runner checks the table and only calls `up()` for unapplied migrations.
- IDs follow the pattern `NNN_description`, e.g. `003_add_foo_to_bar`.
- Each `up()` must be idempotent (guard with `PRAGMA table_info` checks before `ALTER TABLE`).

The last applied migration is `015_create_goal_historical_contributions`. The next migration id must be `016_...`.

Migrations 011–015 created the goals subsystem:
- `011_create_goals` — `goals` table
- `012_create_goal_accounts` — `goal_accounts` join table
- `013_create_goal_distributions` — `goal_distributions` join table
- `014_create_goal_cycle_contributions` — `goal_cycle_contributions` table
- `015_create_goal_historical_contributions` — `goal_historical_contributions` table

**To add a new migration**, append an entry to the `migrations` array:

```js
{
  id: '016_your_description',
  up() {
    const cols = db.prepare('PRAGMA table_info(your_table)').all();
    if (!cols.find((c) => c.name === 'your_column')) {
      db.exec('ALTER TABLE your_table ADD COLUMN your_column TYPE');
    }
  },
},
```

Never modify or remove existing migration entries — only append new ones.

**Database access pattern**: `better-sqlite3` is synchronous. All DB calls are direct (no async/await, no ORM). Use `.prepare()` + `.run()` / `.get()` / `.all()`.

## API Conventions

All API routes are under `/api`. The backend is a REST API with JSON request/response bodies.

### Authentication

- Protected routes use the `requireAuth` middleware (`backend/src/middleware/auth.js`), which checks `req.session.userId`.
- Public routes: `/api/setup/*`, `/api/auth/login`, `/api/auth/oidc/*`.

### Route Structure

```
GET    /api/auth/me
POST   /api/auth/login          { username, password }
POST   /api/auth/logout
POST   /api/auth/change-password { currentPassword, newPassword }

GET    /api/setup/status
POST   /api/setup/create-first-user { username, password }

GET    /api/users
POST   /api/users               { username, password }
DELETE /api/users/:id

GET    /api/dossiers
POST   /api/dossiers            { name, currency? }
POST   /api/dossiers/import     (JSON body of exported dossier)
GET    /api/dossiers/:id
DELETE /api/dossiers/:id
GET    /api/dossiers/:id/export
GET    /api/dossiers/:id/access
POST   /api/dossiers/:id/access { userId }
DELETE /api/dossiers/:id/access/:userId

GET    /api/dossiers/:id/accounts?includeArchived=true
POST   /api/dossiers/:id/accounts   { group_name, name, type, is_idle_money? }
PUT    /api/dossiers/:id/accounts/reorder   { accountIds: [] }
PATCH  /api/dossiers/:id/accounts/:accountId  { is_idle_money?, archived? }
DELETE /api/dossiers/:id/accounts/:accountId  (archives, not deletes)

GET    /api/dossiers/:id/months
POST   /api/dossiers/:id/months     { year, month }
GET    /api/dossiers/:id/months/compare
GET    /api/dossiers/:id/months/:monthId
PUT    /api/dossiers/:id/months/:monthId  { entries: [], comment?, filled? }
POST   /api/dossiers/:id/months/:monthId/sync-accounts
POST   /api/dossiers/:id/months/:monthId/reset

GET    /api/dossiers/:id/settings
PATCH  /api/dossiers/:id/settings             { cycle_start_day }

GET    /api/dossiers/:id/expense-template
POST   /api/dossiers/:id/expense-template     { section, name, type?, value, day_of_payment?, classification?, must_amount?, want_amount?, save_amount? }
PATCH  /api/dossiers/:id/expense-template/:itemId  { name?, value?, day_of_payment?, classification?, must_amount?, want_amount?, save_amount? }
DELETE /api/dossiers/:id/expense-template/:itemId
POST   /api/dossiers/:id/expense-template/bulk-replace  { items: [] }  # replaces entire template atomically

GET    /api/dossiers/:id/annual-expense-template
POST   /api/dossiers/:id/annual-expense-template     { name, value, day_of_payment?, month_of_payment?, classification? }
PUT    /api/dossiers/:id/annual-expense-template/:itemId  { name?, value?, day_of_payment?, month_of_payment?, classification? }
DELETE /api/dossiers/:id/annual-expense-template/:itemId
POST   /api/dossiers/:id/annual-expense-template/bulk-replace  { items: [] }  # replaces entire template atomically

GET    /api/dossiers/:id/workbench-snapshots
POST   /api/dossiers/:id/workbench-snapshots          { name, data }
PUT    /api/dossiers/:id/workbench-snapshots/:snapshotId  { name?, data? }
POST   /api/dossiers/:id/workbench-snapshots/:snapshotId/duplicate
DELETE /api/dossiers/:id/workbench-snapshots/:snapshotId

GET    /api/dossiers/:id/cycles
POST   /api/dossiers/:id/cycles               { year, month, salary, previous_balance }
GET    /api/dossiers/:id/cycles/:cycleId
PATCH  /api/dossiers/:id/cycles/:cycleId      { salary?, previous_balance?, is_closed?, final_real_balance? }

POST   /api/dossiers/:id/cycles/:cycleId/items          { section, name, type?, value, day_of_payment? }
PATCH  /api/dossiers/:id/cycles/:cycleId/items/:itemId  { value?, day_of_payment?, paid?, spent?, done? }
DELETE /api/dossiers/:id/cycles/:cycleId/items/:itemId

GET    /api/dossiers/:id/goals
POST   /api/dossiers/:id/goals   { name, target_value, target_date, contribution_mode, manual_monthly_value?, extra_value?, extra_value_impact_mode?, account_ids?, distribution_template_ids? }
GET    /api/dossiers/:id/goals/:goalId   # includes chart_data and historical_contributions
PUT    /api/dossiers/:id/goals/:goalId   { name?, target_value?, target_date?, contribution_mode?, manual_monthly_value?, extra_value?, extra_value_impact_mode?, account_ids?, distribution_template_ids? }
DELETE /api/dossiers/:id/goals/:goalId

PUT    /api/dossiers/:id/goals/:goalId/cycle-contributions/:cycleId  { real_contribution }  # manual mode only
POST   /api/dossiers/:id/goals/:goalId/historical-contributions/bulk-replace  { items: [{year, month, amount}] }
```

### Error Handling

Routes return `{ error: "message" }` with an appropriate HTTP status code on failure. Use `res.status(4xx).json({ error: '...' })` for client errors.

## Frontend Conventions

### State Management

No global state library. State lives in:
- `AuthContext` (App.jsx) — current user, `setupRequired`, `loading`
- Component-local `useState` / `useEffect` hooks for page data

### API Client

All API calls go through `frontend/src/services/api.js`, which wraps `fetch` with:
- Base URL `/api`
- JSON serialization
- Credential inclusion (`credentials: 'include'` for session cookies)

Always add new API helper functions to `api.js` rather than calling `fetch` directly in components.

### Routing

React Router v6. All routes defined in `App.jsx`. Route params: `dossierId`, `monthId`, `cycleId`, `goalId`.

Key routes:
- `/dossiers/:id` → `DossierView` (tabs: Capital, Monthly Expenses, Workbench, Goals, Settings)
- `/dossiers/:id/months/:monthId` → month detail
- `/dossiers/:id/cycles/:cycleId` → `CycleEditor`
- `/dossiers/:id/goals/:goalId` → `GoalDetail`

`DossierView` tab state can be restored via router location state: `navigate('/dossiers/:id', { state: { tab: 'expenses' } })`.

### Component Patterns

- Functional components with hooks only (no class components).
- Components fetch their own data on mount (`useEffect`).
- Modal state (`showModal`) managed locally in the component that opens them.
- Drag-and-drop reordering uses native HTML5 `draggable` + `onDragStart`/`onDrop` events.
- The `modalPreset` pattern is used for pre-filling modals: `null` = closed, `{}` = open with defaults, `{ year, month }` = open with those values pre-filled.
- CSS only styles `input[type='text']`, `input[type='password']`, `input[type='number']`, `select`, `textarea`. Always include an explicit `type` attribute on inputs or they won't pick up the base styles.

### Styling

Inline styles and CSS via `index.css`. No CSS framework (Tailwind, Bootstrap) is installed. Match the existing inline-style pattern when adding UI.

## Key Business Rules

1. **Password policy**: Min 16 chars, must include uppercase, lowercase, digit, and symbol. Validated in both `routes/auth.js` (`validatePassword()`) and `routes/users.js`.
2. **Account deletion is soft**: `DELETE /accounts/:id` sets `archived=true`, never removes the row. This preserves historical month data.
3. **Month snapshots**: When a month is created, a snapshot of all non-archived accounts is taken (`month_account_snapshot`). Archived accounts visible in old months are those present in the snapshot.
4. **Dossier access**: Only the `creator_id` can share/unshare or delete a dossier. Shared users have full edit rights.
5. **OIDC users**: When `OIDC_ENABLED=true`, SSO users are auto-created on first login. They have `is_oidc=1` and cannot use local login or change-password.
6. **Currency**: Stored per-dossier, defaulting to `EUR`. Only `EUR` is used in practice; multi-currency support is out of scope.
7. **Expense cycles**: Multiple cycles can be open simultaneously. The only uniqueness constraint is `(dossier_id, year, month)` — one cycle per calendar month.
8. **Cycle start day**: Stored on the dossier (`cycle_start_day`, default 25). A cycle for month M runs from day `cycle_start_day` of M to day `cycle_start_day - 1` of M+1. Use `new Date(year, month - 1, startDay)` / `new Date(year, month, startDay - 1)` for date range computation (JS Date handles month overflow automatically).
9. **Template → cycle copy**: When a new cycle is created, all template items are copied into `cycle_items`. `day_of_payment` values are clamped to the last day of the cycle's calendar month at copy time (e.g., day 30 becomes day 28 for February).
10. **Expense sorting**: Fixed expenses sort by day within the cycle: days ≥ `cycle_start_day` first (ascending), then days < `cycle_start_day` (ascending). Budget items always sort last. This applies in both `CycleEditor` and `ExpenseTemplate`.
11. **Export format version**: The export JSON is now `version: 4`. Includes `dossier.cycle_start_day`, `expense_template[]` (with `classification`, `must_amount`, `want_amount`, `save_amount`), `annual_expense_template[]`, `workbench_snapshots[]`, `cycles[]` (each with `items[]`), and `goals[]` (each with `account_names[]`, `distribution_names[]`, `cycle_contributions[]`, `historical_contributions[]`). Import accepts versions 1, 2, 3, and 4. Goals are re-linked by account name and distribution template item name.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Secret for signing session cookies. Change before production use. |
| `DB_PATH` | No | SQLite file path. Default: `./capital-tracker.db` |
| `NODE_ENV` | No | Set to `production` to enable static file serving from `frontend/dist/`. |
| `OIDC_ENABLED` | No | Set to `true` to enable OIDC SSO. |
| `OIDC_ISSUER_URL` | If OIDC | OIDC provider issuer URL. |
| `OIDC_CLIENT_ID` | If OIDC | OIDC client ID. |
| `OIDC_CLIENT_SECRET` | If OIDC | OIDC client secret. |
| `OIDC_REDIRECT_URI` | If OIDC | Callback URL registered with provider. |
| `OIDC_PROVIDER_NAME` | No | Display name for the SSO button. |

## Out of Scope (per spec)

Do not implement the following unless the specification is explicitly updated:
- Admin roles or permission tiers
- PWA or mobile app
- Multi-currency conversion

The Monthly Expenses feature (cycles, templates, settings), the Workbench (scenario calculator with snapshots, income/expense/distribution sections, Must/Want/Save breakdown, Annual Expense Template), and Goals (financial objectives with progress tracking, contribution modes, historical contributions, and export/import) are fully implemented.

## No Test Suite

There are currently no automated tests. When adding significant logic, prefer making it easy to test in isolation (pure functions, thin route handlers).
