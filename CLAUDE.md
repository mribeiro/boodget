# CLAUDE.md — boodget

This file provides AI assistants with the context needed to understand and work effectively in this codebase.

## Documentation Maintenance (MANDATORY)

**Every time a code change is made, CLAUDE.md and the relevant `ai-spec/` files must be updated in the same commit or immediately after.** These files are the source of truth for AI assistants working on this codebase. Stale documentation causes regressions.

Rules:
- Any change to a feature's behaviour, UI, API contract, data model, or business rules must be reflected in the corresponding `ai-spec/SPECIFICATION_*.md` file.
- Any change that affects the key concepts, architecture, schema summary, API route list, component list, or business rules sections of this file must be reflected here.
- When adding a new feature, create or extend the matching spec file and update the architecture / schema / API sections of CLAUDE.md.
- Documentation commits must be part of the same logical change — do not leave docs for a follow-up.

## Project Overview

**boodget** is a self-hosted personal finance application for tracking monthly capital snapshots. Users define accounts (investments, savings, etc.), record their value each month, and visualize their capital evolution over time.

Key concepts:
- **Dossier**: A named container for a set of accounts, monthly snapshots, and expense cycles. Owned by one user, shareable with others.
- **Account**: An asset being tracked (bank account, investment fund, etc.), belonging to a dossier.
- **Month**: A monthly snapshot capturing the value of all accounts at a point in time.
- **Expense Cycle**: A monthly budget/expense tracking period. Has a salary, previous balance, and a list of expense/distribution items. Cycles are independent — multiple can be open at the same time; the only uniqueness constraint is `(dossier_id, year, month)`. A cycle stored as `(year, month)` runs from `cycle_start_day` of that calendar month to `cycle_start_day − 1` of the following month, and is **named after the month it ends in** — e.g. a cycle stored as `month=3` with `cycle_start_day=25` runs Mar 25 – Apr 24 and is displayed as "April".
- **Cycle Item**: An expense or distribution within a cycle. Expenses are either `Fixed` (with a `day_of_payment` and paid checkbox) or `Budget` (with a max and a `spent` amount). Distributions have a `done` checkbox. Distributions may optionally be linked to a funding `account_id`; not propagated from template to existing cycles.
- **Expense Template**: A per-dossier list of template items copied into each new cycle. Payment days are clamped to the last day of the cycle's month at copy time. Expense entries carry `classification` (`must`/`want`). Distribution entries carry `must_amount`, `want_amount`, `save_amount` fields. Distributions may optionally be linked to a funding `account_id`; not propagated from template to existing cycles.
- **Annual Expense Template**: A per-dossier list of annual expenses. Each entry has `name`, `value`, `classification`, `num_installments`, and installment dates (`month`, `day`). Used by the Workbench (monthly avg = value / 12).
- **Annual Expense Year**: A per-dossier, per-calendar-year instance copying items from the annual expense template. Has a `carryover` field. Items sorted by first installment date. The year summary card shows carryover, accumulated, contributed, budgeted, paid, remaining, and several computed fields (amount left needed, raise needed, monthly average needed, needed this cycle). See `ai-spec/SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md` for full formula details.
- **Workbench**: A scenario calculator. Users model income vs. expenses vs. distributions with Must/Want/Save breakdowns. State is ephemeral per session; can be saved as named **snapshots**. If exactly one snapshot exists, it is auto-loaded on open. A "New from scratch" button resets to the template-based working state.
- **Goal**: A financial objective with a name, target value, and target date, scoped to a dossier. Tracks progress via contributing accounts and monthly contributions (via distributions, fixed manual amount, or ad-hoc). Supports historical contributions. State is auto-computed: `active`, `completed`, or `failed`.
- **Glances**: A read-only summary panel above the tab bar in `DossierView`. Shows up to five cards (Emergency Fund, Capital, Current Cycle, Next Expense, Goals) with colour-coded states (neutral / amber / red). Emergency Fund card only shown when underfunded. Current Cycle card navigates to the relevant `CycleEditor`; Next Expense card also navigates to `CycleEditor`. The Next Expense card shows payment date as "Month Day" and, when overdue, shows an inline "Mark as paid" button. Three per-dossier warning day thresholds control amber/red states.
- **Emergency Fund**: A per-dossier savings buffer target. `target = multiplier × effective_monthly_base`, where `effective_monthly_base = avg_monthly_expense (Y most recent cycles) + extra_monthly_values`. Status is `healthy`, `underfunded`, or `no_data`.

## Versioning

Current version: **v0.1** (tagged in git). Both `backend/package.json` and `frontend/package.json` carry the version as `0.1.0`. When releasing a new version, bump both package files and create an annotated git tag (`git tag -a vX.Y -m "..."`).

## Architecture

```
money_manager/
├── backend/          # Node.js + Express REST API (CommonJS)
│   ├── src/
│   │   ├── index.js          # App entry: middleware, routes, OIDC init, static serving, seeding
│   │   ├── db/index.js       # SQLite schema, migrations, db singleton
│   │   ├── db/seed.js        # Baseline seed data (SEED_ON_EMPTY)
│   │   ├── middleware/auth.js
│   │   └── routes/
│   │       ├── auth.js, setup.js, users.js
│   │       ├── dossiers.js       # Dossier CRUD, sharing, import/export; mounts sub-routers
│   │       ├── accounts.js, months.js
│   │       ├── expenses.js       # Monthly template, cycles, cycle items, workbench snapshots
│   │       ├── goals.js, emergency-fund.js
│   │       ├── annual-expenses.js # Annual template, years, payments
│   │       ├── push.js           # Push subscriptions + VAPID public key
│   │       └── notifications.js  # User notification settings + dossier opt-in
│   ├── notifications/
│   │   ├── push.js               # VAPID init, sendPush() helper
│   │   └── scheduler.js          # node-cron: evaluates 5 event types, deduplicates, sends push
│   ├── scripts/
│   │   ├── reset-password.js
│   │   └── reset-password.sh
│   └── Dockerfile
├── frontend/         # React 18 SPA (ES Modules, Vite)
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── icon.svg, icon-dark.svg
│   │   ├── icons/                # Generated PNG icons (light + dark variants)
│   │   └── sw-push.js            # Service worker push handler
│   ├── scripts/generate-icons.js # Generates PNG icons from SVGs using sharp
│   ├── src/
│   │   ├── main.jsx, App.jsx     # Entry, AuthContext/AppContext, routing
│   │   ├── services/api.js       # Fetch-based API client wrapper
│   │   ├── pages/
│   │   │   └── NotificationSettings.jsx
│   │   └── components/
│   │       ├── DossierView.jsx         # Dossier page with all tabs
│   │       ├── DossierSettingsTab.jsx
│   │       ├── ConfirmModal.jsx        # Reusable animated confirmation modal
│   │       ├── layout/AppShell.jsx, Navbar.jsx, Sidebar.jsx
│   │       ├── glances/GlancesPanel.jsx, EmergencyFundGlance.jsx, CapitalGlance.jsx,
│   │       │         CycleGlance.jsx, NextExpenseGlance.jsx, GoalsGlance.jsx
│   │       ├── emergency-fund/EmergencyFundTab.jsx
│   │       ├── expenses/ExpensesTab.jsx, CycleList.jsx, CycleEditor.jsx,
│   │       │          ExpenseTemplate.jsx, AnnualExpenseTemplate.jsx, DossierSettings.jsx
│   │       ├── ui/Checkbox.jsx, Badge.jsx, Button.jsx, Card.jsx, Modal.jsx
│   │       ├── workbench/WorkbenchTab.jsx
│   │       └── goals/GoalsTab.jsx, GoalFormModal.jsx, GoalDetail.jsx
├── ai-spec/
│   ├── SPECIFICATION.md                          # Core product spec (Capital section)
│   ├── SPECIFICATION_MONTHLY_EXPENSES.md
│   ├── SPECIFICATION_WORKBENCH.md
│   ├── SPECIFICATION_GOALS.md
│   ├── SPECIFICATION_GLANCES.md
│   ├── SPECIFICATION_EMERGENCY_FUND.md
│   ├── SPECIFICATION_PAPERLESS.md
│   ├── SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md
│   ├── SPECIFICATION_UI.md
│   ├── SPECIFICATION_BACKEND_LOGGING.md
│   ├── SPECIFICATION_PREVIEW_ENVIRONMENTS.md
│   └── SPECIFICATION_PWA.md
├── preview-index/            # Lightweight service listing preview environments
├── .github/workflows/
│   ├── deploy.yml            # CI/CD: build + deploy to self-hosted runner
│   └── preview-deploy.yml    # Ephemeral preview environments for feature branches
├── docker-compose.yml        # Production deployment (SQLite persisted to ./data/)
└── .devcontainer/
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
| Push notifications | `web-push` (VAPID), `node-cron` (scheduler) |
| Frontend framework | React 18 |
| Frontend build | Vite 5 + `vite-plugin-pwa` (Workbox, service worker) |
| Icon generation | `sharp` (devDependency, runs at build time) |
| Routing | `react-router-dom` v6 |
| Charts | `recharts` |
| Deployment | Docker + Docker Compose |

## Development Workflow

### Running Locally (Dev Container)

```bash
cd backend && npm run dev    # backend on :3000 (hot-reload)
cd frontend && npm run dev   # frontend on :5173 (proxies /api → :3000)
```

### Running via Docker

```bash
docker compose up --build    # http://localhost:3000
```

Change `SESSION_SECRET` in `docker-compose.yml` before real use.

### Git Commit SHA in Navbar

`GIT_COMMIT` build arg → `VITE_GIT_COMMIT` → displayed as first 7 chars in Navbar. Shows `unknown` in local dev.

### Environment-Based Navbar Styling

`backend/src/index.js` injects `window.__APP_ENV__` into `index.html`. Navbar applies tint based on value:

| `NODE_ENV` | Navbar colour | Badge |
|---|---|---|
| `dev` | `#f0fdfa` (light teal) | green "dev" |
| `ephemeral` | `#fff1f2` (light rose) | amber "preview" |
| `production` / unset | default | none |

### CI/CD Pipeline

- **Production/Dev** (`deploy.yml`): builds Docker image with `GIT_COMMIT` arg, deploys via `docker compose up -d --force-recreate`. `-dev` suffix for `dev` branch.
- **Preview** (`preview-deploy.yml`): branch slug → Traefik-routed container at `<slug>.preview.<PREVIEW_DOMAIN>`. Posts/updates PR comment with preview URL.

See `ai-spec/SPECIFICATION_PREVIEW_ENVIRONMENTS.md` for full preview environment details.

### Emergency Password Reset

```bash
docker exec -it <container> /app/scripts/reset-password.sh <username> <new-password>
```

## Database

SQLite database at `DB_PATH` env var (default: `/data/capital-tracker.db` in Docker).

### Schema Summary

| Table | Description |
|---|---|
| `users` | User accounts. `is_oidc=1` for SSO users. |
| `sessions` | Express session store. |
| `dossiers` | Capital dossiers. `creator_id` FK → `users`. Holds `cycle_start_day` (default 25), three Glances warning thresholds (`capital_snapshot_warning_day` default 7, `next_cycle_warning_day` default 22, `previous_cycle_close_warning_day` default 25), two EF settings (`emergency_fund_months_multiplier` default 6, `emergency_fund_cycles_to_average` default 6), four Paperless fields (all nullable), `expense_notification_days_before` (default 1). |
| `dossier_access` | Many-to-many sharing: `(dossier_id, user_id)` PK. |
| `accounts` | `type` ∈ `{Risk Investment, Guaranteed Investment, Current Account}`. `archived`, `is_idle_money`, `position`. |
| `months` | Monthly snapshots. `(dossier_id, year, month)` UNIQUE. `filled` bool. |
| `month_account_snapshot` | Accounts active when a month was created. |
| `month_entries` | `(month_id, account_id)` → `value`, optional `comment`. |
| `expense_template_items` | Monthly template. `section` ∈ `{expense, distribution}`, `type` ∈ `{Fixed, Budget}`. Expenses have `classification`, `day_of_payment`, `paperless_tag_id`, `exclude_from_emergency_fund`. Distributions have `must_amount`, `want_amount`, `save_amount`, `account_id` (nullable, funding account). |
| `expense_cycles` | `(dossier_id, year, month)` UNIQUE. `salary`, `previous_balance`, `is_closed`, `final_real_balance`. |
| `cycle_items` | Items within a cycle. Fixed: `paid`. Budget: `spent`. Distributions: `done`, `account_id` (nullable, copied from template at cycle creation only — not propagated afterward, editable independently per cycle item). Expenses additionally carry `exclude_from_emergency_fund` (denormalized from template; toggling on the template propagates to all linked rows). `template_item_id` FK (nullable). |
| `annual_expense_template_items` | Annual template. `name`, `value`, `classification`, `num_installments`, `position`. |
| `annual_expense_template_installments` | `template_item_id` FK, `installment_number`, `month`, `day`. |
| `annual_expense_years` | `(dossier_id, year)` UNIQUE. `carryover`. Auto-created from template when a cycle spanning that year opens. |
| `annual_expense_year_items` | Copied from template at year creation. `budgeted_value`, `classification`, `num_installments`, `from_template`. |
| `annual_expense_year_installments` | `year_item_id` FK, `installment_number`, `month`, `day`. |
| `annual_expense_payments` | `(installment_id, cycle_id)` UNIQUE. `real_value`, `paid`. Auto-created when cycle opens if installment falls in cycle range. |
| `annual_expense_accounts` | Accounts contributing to annual fund. `(dossier_id, account_id)`. |
| `annual_expense_distributions` | Distribution template items contributing to annual fund. `(dossier_id, distribution_template_id)`. |
| `workbench_snapshots` | Named snapshots of Workbench state. `name`, `data` (JSON). |
| `goals` | `name`, `target_value`, `target_date` (YYYY-MM), `contribution_mode` (`via_distributions`/`manual`/`ad_hoc`), `manual_monthly_value`, `extra_value`, `extra_value_impact_mode`. |
| `goal_accounts` | `(goal_id, account_id)`. Cascades on delete. |
| `goal_distributions` | `(goal_id, distribution_template_id)`. Cascades on delete. |
| `goal_cycle_contributions` | `(goal_id, cycle_id)`. `real_contribution` upserted. |
| `goal_historical_contributions` | `(goal_id, year, month)`. Managed via bulk-replace. |
| `emergency_fund_accounts` | `(dossier_id, account_id)`. Current value from most recent filled snapshot. |
| `emergency_fund_extra_values` | `name`, `value`, `position`. |
| `app_settings` | Key-value. Holds VAPID keys (auto-generated on first startup). |
| `push_subscriptions` | `user_id`, `endpoint` (UNIQUE), `keys_p256dh`, `keys_auth`. One per device/browser. |
| `user_notification_settings` | `enabled`, `send_hour`, `send_minute`, `repeat_enabled`, `repeat_interval_days`. Created on first PATCH. |
| `dossier_notification_subscriptions` | `(user_id, dossier_id)`. No dossiers opted in by default. |
| `notification_log` | Deduplication log. `user_id`, `dossier_id`, `event_type`, `event_key`, `sent_at`. Entries >90 days auto-deleted. |

### Migration System

All schema changes **must** go through the migration system in `backend/src/db/index.js`. Migrations run automatically at startup.

- `schema_migrations` table tracks applied migrations by `id`.
- IDs follow `NNN_description` pattern (e.g. `003_add_foo_to_bar`).
- Each `up()` must be idempotent (guard with `PRAGMA table_info` checks before `ALTER TABLE`).
- **Last applied migration**: `023_add_account_id_to_distributions`. **Next id must be `024_...`**
- Never modify or remove existing migration entries — only append.

**To add a new migration**, append to the `migrations` array:

```js
{
  id: '021_your_description',
  up() {
    const cols = db.prepare('PRAGMA table_info(your_table)').all();
    if (!cols.find((c) => c.name === 'your_column')) {
      db.exec('ALTER TABLE your_table ADD COLUMN your_column TYPE');
    }
  },
},
```

**Database access pattern**: `better-sqlite3` is synchronous. Use `.prepare()` + `.run()` / `.get()` / `.all()`. No async/await, no ORM.

## API Conventions

All API routes are under `/api`. REST with JSON request/response bodies.

- Protected routes use `requireAuth` middleware (checks `req.session.userId`).
- Public routes: `/api/setup/*`, `/api/auth/login`, `/api/auth/oidc/*`.
- Error format: `{ error: "message" }` with appropriate HTTP status.

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
PATCH  /api/dossiers/:id/settings   { cycle_start_day?, capital_snapshot_warning_day?,
                                       next_cycle_warning_day?, previous_cycle_close_warning_day?,
                                       emergency_fund_months_multiplier?, emergency_fund_cycles_to_average?,
                                       paperless_url?, paperless_token?, paperless_date_field_id?,
                                       paperless_amount_field_id?, expense_notification_days_before? }

GET    /api/dossiers/:id/expense-template
POST   /api/dossiers/:id/expense-template     { section, name, type?, value, day_of_payment?, classification?, must_amount?, want_amount?, save_amount? }
PATCH  /api/dossiers/:id/expense-template/:itemId
DELETE /api/dossiers/:id/expense-template/:itemId
POST   /api/dossiers/:id/expense-template/bulk-replace  { items: [] }

GET    /api/dossiers/:id/annual-expense-template
POST   /api/dossiers/:id/annual-expense-template     { name, value, classification?, num_installments?, installments?: [{month, day}] }
PUT    /api/dossiers/:id/annual-expense-template/:itemId
DELETE /api/dossiers/:id/annual-expense-template/:itemId
POST   /api/dossiers/:id/annual-expense-template/bulk-replace  { items: [] }

GET    /api/dossiers/:id/annual-years
POST   /api/dossiers/:id/annual-years               { year }
GET    /api/dossiers/:id/annual-years/:yearId
PATCH  /api/dossiers/:id/annual-years/:yearId        { carryover }
DELETE /api/dossiers/:id/annual-years/:yearId
GET    /api/dossiers/:id/annual-years/:yearId/status
POST   /api/dossiers/:id/annual-years/:yearId/sync-from-template
POST   /api/dossiers/:id/annual-years/:yearId/sync-to-template

POST   /api/dossiers/:id/annual-years/:yearId/items              { name, budgeted_value, classification?, num_installments, installments: [{month, day}] }
PATCH  /api/dossiers/:id/annual-years/:yearId/items/:itemId
DELETE /api/dossiers/:id/annual-years/:yearId/items/:itemId

PATCH  /api/dossiers/:id/annual-expense-payments/:paymentId      { real_value?, paid? }

GET    /api/dossiers/:id/annual-expenses/accounts
PUT    /api/dossiers/:id/annual-expenses/accounts    { account_ids: [] }
GET    /api/dossiers/:id/annual-expenses/distributions
PUT    /api/dossiers/:id/annual-expenses/distributions  { distribution_template_ids: [] }

GET    /api/dossiers/:id/workbench-snapshots
POST   /api/dossiers/:id/workbench-snapshots          { name, data }
PUT    /api/dossiers/:id/workbench-snapshots/:snapshotId  { name?, data? }
POST   /api/dossiers/:id/workbench-snapshots/:snapshotId/duplicate
DELETE /api/dossiers/:id/workbench-snapshots/:snapshotId

GET    /api/dossiers/:id/cycles
POST   /api/dossiers/:id/cycles               { year, month, salary, previous_balance }
GET    /api/dossiers/:id/cycles/:cycleId
PATCH  /api/dossiers/:id/cycles/:cycleId      { year?, month?, salary?, previous_balance?, is_closed?, final_real_balance? }
                                              # year/month change → 409 if period already occupied
DELETE /api/dossiers/:id/cycles/:cycleId

POST   /api/dossiers/:id/cycles/:cycleId/pull-annual-expenses  # idempotent
POST   /api/dossiers/:id/cycles/:cycleId/items          { section, name, type?, value, day_of_payment? }
PATCH  /api/dossiers/:id/cycles/:cycleId/items/:itemId  { value?, day_of_payment?, paid?, spent?, done? }
DELETE /api/dossiers/:id/cycles/:cycleId/items/:itemId

GET    /api/dossiers/:id/goals
POST   /api/dossiers/:id/goals   { name, target_value, target_date, contribution_mode, manual_monthly_value?, extra_value?, extra_value_impact_mode?, account_ids?, distribution_template_ids? }
GET    /api/dossiers/:id/goals/:goalId   # includes chart_data and historical_contributions
PUT    /api/dossiers/:id/goals/:goalId
DELETE /api/dossiers/:id/goals/:goalId

PUT    /api/dossiers/:id/goals/:goalId/cycle-contributions/:cycleId  { real_contribution }
POST   /api/dossiers/:id/goals/:goalId/historical-contributions/bulk-replace  { items: [{year, month, amount}] }

GET    /api/dossiers/:id/emergency-fund/accounts
PUT    /api/dossiers/:id/emergency-fund/accounts         { account_ids: [] }
GET    /api/dossiers/:id/emergency-fund/extra-values
POST   /api/dossiers/:id/emergency-fund/extra-values     { name, value }
PATCH  /api/dossiers/:id/emergency-fund/extra-values/:itemId  { name?, value? }
DELETE /api/dossiers/:id/emergency-fund/extra-values/:itemId
GET    /api/dossiers/:id/emergency-fund/status

GET    /api/push/vapid-public-key
POST   /api/push/subscribe              { endpoint, keys: { p256dh, auth } }
DELETE /api/push/subscribe              { endpoint }
GET    /api/push/subscriptions
POST   /api/push/test

GET    /api/notifications/settings
PATCH  /api/notifications/settings      { enabled?, send_hour?, send_minute?, repeat_enabled?, repeat_interval_days? }
GET    /api/notifications/dossiers
PUT    /api/notifications/dossiers      { dossier_ids: [] }
```

## Frontend Conventions

### State Management

No global state library. State lives in:
- `AuthContext` (App.jsx) — current user, `setupRequired`, `loading`
- `AppContext` (App.jsx) — `currentDossier`, `setCurrentDossier`
- Component-local `useState` / `useEffect` for page data

### API Client

All calls go through `frontend/src/services/api.js` (wraps fetch: base URL `/api`, JSON serialization, `credentials: 'include'`). Always add new helpers to `api.js`, never call `fetch` directly in components.

### Routing

React Router v6. Routes in `App.jsx`. Key routes:
- `/dossiers/:id` → `DossierView` (tabs: Capital, Monthly Expenses, Annual Expenses, Workbench, Goals, Emergency Fund, Settings)
- `/dossiers/:id/months/:monthId`, `/dossiers/:id/cycles/:cycleId`, `/dossiers/:id/goals/:goalId`
- `/notifications` → `NotificationSettings`

Tab state restorable via location state: `navigate('/dossiers/:id', { state: { tab: 'expenses' } })`.

### Layout

`AppShell`: collapsible sidebar (Users link only) + top navbar + main content. All dossier navigation is via the tab bar in `DossierView`.

### Component Patterns

- Functional components with hooks only.
- Components fetch their own data on mount.
- Drag-and-drop reordering uses native HTML5 `draggable` events.
- `modalPreset` pattern: `null` = closed, `{}` = open with defaults, `{ field }` = open pre-filled.
- CSS only styles `input[type='text/password/number']`, `select`, `textarea` — always include explicit `type`.
- **ConfirmModal pattern**: all destructive actions use `ConfirmModal` (never `window.confirm()`). Hold `const [confirmState, setConfirmState] = useState(null)`, render `{confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}`.
- **Custom checkboxes**: use `<Checkbox>` from `ui/Checkbox.jsx` — never native `<input type="checkbox">`.

### Animations

- `.page-fade-in` — full page entrance (opacity 0→1, 300ms).
- `.tab-content` with `key={activeTab}` — forces remount on tab switch. **Must use `fadeIn`, not `slideUp`** — `translateY` breaks `position: fixed` modal stacking.
- `.glance-card` — `slideUp` with staggered `nth-child` delays.
- Body scroll locked while modal open via `body:has(.modal-overlay) { overflow: hidden }`.

### Styling

Inline styles + `index.css`. No CSS framework. Match existing inline-style pattern.

## Key Business Rules

1. **Password policy**: Min 16 chars, uppercase + lowercase + digit + symbol. Validated in `routes/auth.js` and `routes/users.js`.
2. **Account deletion is soft**: `DELETE /accounts/:id` sets `archived=true`. Preserves historical month data.
3. **Month snapshots**: On month creation, all non-archived accounts are snapshotted (`month_account_snapshot`).
4. **Dossier access**: Only `creator_id` can share/unshare or delete. Shared users have full edit rights.
5. **OIDC users**: `is_oidc=1`; cannot use local login or change-password.
6. **Currency**: Stored per-dossier, defaulting to `EUR`. Multi-currency out of scope.
7. **Expense cycles**: `(dossier_id, year, month)` uniqueness only. Stored `(year, month)` is the **start** month; display name uses the **end** month.
8. **Cycle start day**: `cycle_start_day` (default 25). Display name: `new Date(year, month, startDay - 1)`. Range: start = `new Date(year, month - 1, startDay)`, end = `new Date(year, month, startDay - 1)`. Example: stored `month=3`, `startDay=25` → Mar 25 – Apr 24 → "April 2025".
9. **Template → cycle copy**: All template items copied to `cycle_items`. `day_of_payment` clamped to last day of cycle's calendar month.
10. **Expense sorting**: Fixed expenses sort by day — days ≥ `cycle_start_day` first (asc), then days < `cycle_start_day` (asc). Budget items always last. Applies in both `CycleEditor` and `ExpenseTemplate`.
11. **Export format**: version `8`. Includes dossier settings, `expense_template[]`, `annual_expense_template[]` (with installments), `workbench_snapshots[]`, `cycles[]` (with items), `goals[]` (with account_names, distribution_names, contributions), `emergency_fund_accounts[]`, `emergency_fund_extra_values[]`, `annual_expense_years[]`. Template items and cycle items round-trip `exclude_from_emergency_fund` (default `0` for older versions) and `account_name` for distributions (the funding account, re-linked by name on import; `null`/missing on older exports). Import accepts versions 1–8. Goals and EF accounts re-linked by account name on import. Cycle items are re-linked to their new template item on import by matching `(section, name)`, so the EF average correctly recognizes them as template-derived. Paperless token excluded for security.
12. **Emergency Fund**: `target = multiplier × (avg_monthly_expense + extra_monthly_total)`. Average from Y most recent cycles: budget items use `spent` (closed) or `max` (open). Archived accounts excluded. Cycle items with no template link (ad-hoc) are always excluded from the average.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Session cookie secret. Change before production use. |
| `DB_PATH` | No | SQLite path. Default: `./capital-tracker.db` |
| `NODE_ENV` | No | `production` (default), `dev` (teal navbar), `ephemeral` (rose navbar + DB wiped on start). |
| `SEED_ON_EMPTY` | No | `"true"` to seed preview data on empty DB (one `preview` user, six dossiers). |
| `VAPID_PUBLIC_KEY` | No | Base64url VAPID public key. If set together with `VAPID_PRIVATE_KEY`, overrides auto-generated DB keys. Recommended in production to pin keys across restarts. |
| `VAPID_PRIVATE_KEY` | No | Base64url VAPID private key. Must be set together with `VAPID_PUBLIC_KEY`. |
| `VAPID_SUBJECT` | No | VAPID subject URI (`mailto:` or `https://`). Default: `mailto:admin@capitaltracker.local`. Set to a real email/URL — some push services (Apple) reject `.local` domains. |
| `OIDC_ENABLED` | No | `true` to enable OIDC SSO. |
| `OIDC_ISSUER_URL` | If OIDC | OIDC provider issuer URL. |
| `OIDC_CLIENT_ID` | If OIDC | OIDC client ID. |
| `OIDC_CLIENT_SECRET` | If OIDC | OIDC client secret. |
| `OIDC_REDIRECT_URI` | If OIDC | Callback URL registered with provider. |
| `OIDC_PROVIDER_NAME` | No | Display name for the SSO button. |

## Out of Scope

Do not implement unless the spec is explicitly updated: admin roles/permission tiers, multi-currency conversion.

## Backend Logging

Mutations and auth events logged to stdout as `[category] message`. GET operations not logged.

| Category | Events |
|---|---|
| `[db]` | DB path, migrations applied, expired session cleanup |
| `[auth]` | Login success/failure, logout, password change, OIDC auto-creation |
| `[users]` | Created/deleted |
| `[dossiers]` | Created, imported (with version), exported, deleted, access granted/revoked |
| `[accounts]` | Created, archived |
| `[months]` | Created, submitted, reset |
| `[cycles]` | Created, closed/reopened, deleted |
| `[settings]` | Updated (lists changed field names) |
| `[goals]` | Created, deleted |
| `[emergency-fund]` | Account selection updated |
| `[push]` | Generated new VAPID keys; removed expired subscription (scheduler and test endpoint) |

## No Test Suite

No automated tests. Prefer pure functions and thin route handlers to make logic easy to test in isolation.
