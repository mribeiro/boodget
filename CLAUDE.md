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
- **Expense Template**: A per-dossier list of template items (expenses and distributions) that are automatically copied into each new cycle when it is created. Payment days are clamped to the last day of the cycle's month at copy time.

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
│   │       ├── dossiers.js   # Dossier CRUD, sharing, import/export; mounts expenses sub-router
│   │       ├── accounts.js   # Account CRUD (nested under dossiers)
│   │       ├── months.js     # Month snapshots and entries (nested under dossiers)
│   │       └── expenses.js   # Expense settings, template, cycles, cycle items (nested under dossiers)
│   ├── scripts/
│   │   └── reset-password.js # CLI tool for emergency password reset via docker exec
│   └── Dockerfile            # Multi-stage: builds frontend, then runs backend+frontend
├── frontend/         # React 18 SPA (ES Modules, Vite)
│   ├── src/
│   │   ├── main.jsx          # React entry point
│   │   ├── App.jsx           # AuthContext, routing, setup/login gates
│   │   ├── services/api.js   # Fetch-based API client wrapper
│   │   └── components/
│   │       ├── DossierView.jsx         # Dossier page with Capital / Monthly Expenses / Settings tabs
│   │       ├── DossierSettingsTab.jsx  # Settings tab: cycle start day + expense template
│   │       └── expenses/
│   │           ├── ExpensesTab.jsx     # Monthly Expenses tab (renders CycleList)
│   │           ├── CycleList.jsx       # List of cycles with placeholder rows
│   │           ├── CycleEditor.jsx     # Single cycle view (items, summary, close/reopen)
│   │           ├── ExpenseTemplate.jsx # Dossier-level expense template editor
│   │           └── DossierSettings.jsx # Cycle start day setting
├── ai-spec/
│   └── SPECIFICATION.md      # Original product specification document
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

The backend serves `frontend/dist/` as static files when `NODE_ENV=production`.

### Emergency Password Reset

```bash
docker exec -it <container> node /app/scripts/reset-password.js <username> <new-password>
```

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
| `expense_template_items` | Per-dossier template: `section` ∈ `{expense, distribution}`, `type` ∈ `{Fixed, Budget}`, `day_of_payment` (Fixed only). |
| `expense_cycles` | One row per cycle. `(dossier_id, year, month)` UNIQUE. Has `salary`, `previous_balance`, `is_closed`, `final_real_balance`. |
| `cycle_items` | Items within a cycle. `section` ∈ `{expense, distribution}`. Fixed expenses have `paid` bool. Budget expenses have `spent` real. Distributions have `done` bool. `template_item_id` FK to template (nullable). |

`dossiers` also has a `cycle_start_day INTEGER DEFAULT 25` column (added in migration `003`).

### Migration System

All schema changes **must** go through the migration system in `backend/src/db/index.js`. Migrations run automatically at service startup.

- A `schema_migrations` table tracks which migrations have been applied (by `id`).
- Migrations are defined as an array of `{ id, up() }` objects. The runner checks the table and only calls `up()` for unapplied migrations.
- IDs follow the pattern `NNN_description`, e.g. `003_add_foo_to_bar`.
- Each `up()` must be idempotent (guard with `PRAGMA table_info` checks before `ALTER TABLE`).

The last applied migration is `006_create_cycle_items`. The next migration id must be `007_...`.

**To add a new migration**, append an entry to the `migrations` array:

```js
{
  id: '007_your_description',
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
POST   /api/dossiers/:id/expense-template     { section, name, type?, value, day_of_payment? }
PATCH  /api/dossiers/:id/expense-template/:itemId  { name?, value?, day_of_payment? }
DELETE /api/dossiers/:id/expense-template/:itemId

GET    /api/dossiers/:id/cycles
POST   /api/dossiers/:id/cycles               { year, month, salary, previous_balance }
GET    /api/dossiers/:id/cycles/:cycleId
PATCH  /api/dossiers/:id/cycles/:cycleId      { salary?, previous_balance?, is_closed?, final_real_balance? }

POST   /api/dossiers/:id/cycles/:cycleId/items          { section, name, type?, value, day_of_payment? }
PATCH  /api/dossiers/:id/cycles/:cycleId/items/:itemId  { value?, day_of_payment?, paid?, spent?, done? }
DELETE /api/dossiers/:id/cycles/:cycleId/items/:itemId
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

React Router v6. All routes defined in `App.jsx`. Route params: `dossierId`, `monthId`, `cycleId`.

Key routes:
- `/dossiers/:id` → `DossierView` (tabs: Capital, Monthly Expenses, Settings)
- `/dossiers/:id/months/:monthId` → month detail
- `/dossiers/:id/cycles/:cycleId` → `CycleEditor`

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
11. **Export format version**: The export JSON is now `version: 2`. Includes `dossier.cycle_start_day`, `expense_template[]`, and `cycles[]` (each with `items[]`). Import accepts both version 1 (old, no expenses data) and version 2.

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
- "Workbench" section
- PWA or mobile app
- Multi-currency conversion

The frontend renders a "Coming Soon" placeholder for the Workbench tab. The Monthly Expenses feature (cycles, templates, settings) is fully implemented.

## No Test Suite

There are currently no automated tests. When adding significant logic, prefer making it easy to test in isolation (pure functions, thin route handlers).
