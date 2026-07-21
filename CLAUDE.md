# CLAUDE.md — boodget

This file provides AI assistants with the context needed to understand and work effectively in this codebase.

## Documentation Maintenance (MANDATORY)

**Every time a code change is made, CLAUDE.md and the relevant `ai-spec/` files must be updated in the same commit or immediately after.** These files are the source of truth for AI assistants working on this codebase. Stale documentation causes regressions.

Rules:
- Any change to a feature's behaviour, UI, API contract, data model, or business rules must be reflected in the corresponding `ai-spec/SPECIFICATION_*.md` file.
- Any change that affects the key concepts, architecture, schema summary, API route list, component list, or business rules sections of this file must be reflected here.
- When adding a new feature, create or extend the matching spec file and update the architecture / schema / API sections of CLAUDE.md.
- **Any new (or changed) dossier-scoped feature that carries financial impact** (a new data-bearing field, a new per-dossier financial concept, a change to how an existing one is computed) **must also be reflected in the AI Advisor's `buildDossierContext` payload** (`backend/src/routes/ai-advisor.js`) — trimmed/summarized the same way existing features are (e.g. reusing a `computeXValues`-style helper rather than dumping raw rows), plus a one-line mention in `ai-spec/SPECIFICATION_AI_ADVISOR.md`'s "Dossier context payload" section and the relevant prompt intro (`ANALYSIS_SYSTEM_INTRO`/`CHAT_SYSTEM_INTRO`/`EXPORT_PROMPT_INTRO`) if it should factor into the health score/highlights/risks. Purely cosmetic or UI-only changes are exempt.
- Documentation commits must be part of the same logical change — do not leave docs for a follow-up.

## Project Overview

**boodget** is a self-hosted personal finance application for tracking monthly capital snapshots. Users define accounts (investments, savings, etc.), record their value each month, and visualize their capital evolution over time.

Key concepts:
- **Dossier**: A named container for a set of accounts, monthly snapshots, and expense cycles. Owned by one user, shareable with others.
- **Account**: An asset being tracked (bank account, investment fund, etc.), belonging to a dossier. `money_category` is one of `idle` / `active` / `stocks` (default `active`) — `stocks` is for unvested/illiquid holdings (e.g. unvested company equity) and is always excluded from the Capital total, tracked separately instead. `can_receive_transfers` (default `true`, defaults to `false` for new `stocks` accounts) controls whether the account can be picked as a distribution's funding account — disabling it only blocks new assignments, existing links are left untouched. Archiving an account (`DELETE /accounts/:accountId`) is blocked with a `409` while it's still linked as the funding `account_id` of any expense-template or cycle-item distribution — the error lists the linked distributions (grouped by template vs. cycle, with the cycle named the same way cycle displays are) so the user can reassign or clear those links first; this is preventive only, not retroactive — links created before this check existed are not swept up.
- **Month**: A monthly snapshot capturing the value of all accounts at a point in time.
- **Expense Cycle**: A monthly budget/expense tracking period. Has a salary, previous balance, and a list of expense/distribution items. Cycles are independent — multiple can be open at the same time; the only uniqueness constraint is `(dossier_id, year, month)`. A cycle stores its own `cycle_start_day`, snapshotted from the dossier's setting at creation time (`POST /cycles`) — every place that computes that cycle's own date range, item ordering, or day-of-payment clamping uses this stored value, never the dossier's *current* setting, so later changing the dossier setting only affects cycles created from that point on and never retroactively reshapes an existing cycle (open or closed). A cycle stored as `(year, month)` runs from its own `cycle_start_day` of that calendar month to `cycle_start_day − 1` of the following month, and is **named after the month it ends in** — e.g. a cycle stored as `month=3` with `cycle_start_day=25` runs Mar 25 – Apr 24 and is displayed as "April".
- **Cycle Item**: An expense or distribution within a cycle. Expenses are either `Fixed` (with a `day_of_payment` and paid checkbox) or `Budget` (with a max and a `spent` amount). Distributions have a `done` checkbox. Distributions may optionally be linked to a funding `account_id`; not propagated from template to existing cycles. The linked account must have `can_receive_transfers = 1` at the time it's assigned; an account already linked is unaffected if later disabled.
- **Expense Template**: A per-dossier list of template items copied into each new cycle. Payment days are clamped to the last day of the cycle's month at copy time. Expense entries carry `classification` (`must`/`want`). Distribution entries carry `must_amount`, `want_amount`, `save_amount` fields. Distributions may optionally be linked to a funding `account_id`; not propagated from template to existing cycles. The linked account must have `can_receive_transfers = 1` at the time it's assigned; an account already linked is unaffected if later disabled.
- **Annual Expense Template**: A per-dossier list of annual expenses. Each entry has `name`, `value`, `classification`, `num_installments`, and installment dates (`month`, `day`). Used by the Workbench (monthly avg = value / 12).
- **Annual Expense Year**: A per-dossier, per-calendar-year instance copying items from the annual expense template. Has a `carryover` field. Items sorted by first installment date. The year summary card shows carryover, accumulated, contributed, budgeted, paid, remaining, and several computed fields (amount left needed, raise needed, monthly average needed, needed this cycle). See `ai-spec/SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md` for full formula details.
- **Workbench**: A scenario calculator. Users model income vs. expenses vs. distributions with Must/Want/Save breakdowns. State is ephemeral per session; can be saved as named **snapshots**. If exactly one snapshot exists, it is auto-loaded on open. A "New from scratch" button resets to the template-based working state.
- **Goal**: A financial objective with a name, target value, and target date, scoped to a dossier. Tracks progress via contributing accounts and monthly contributions (via distributions, fixed manual amount, or ad-hoc). Supports historical contributions. State is auto-computed: `active`, `completed`, or `failed`. A linked account that gets archived is excluded from progress going forward (it's expected to hold no further funds) but stays linked until manually unlinked — the goal list/detail surface a warning naming the archived account(s), with a one-click unlink action; the edit form's account picker fetches archived accounts too but only shows ones already linked, so they can be unchecked.
- **Loan**: A per-dossier loan, either `draft` (a study/what-if — principal + term + interest rate) or `active` (a real ongoing loan — remaining balance + end date + interest rate). Both compute a `monthly_payment` via the standard annuity formula and a `salary_pct` (payment ÷ per-loan `salary`, prefilled from the dossier's manually-set `reference_salary` setting — deliberately not derived from a cycle's salary, since a one-off bonus there shouldn't skew the prefill or the Loans tab's aggregate % of salary). Active loans store an `end_date` (`YYYY-MM`, required — must resolve to `months_left ≥ 1`) and a `day_of_payment` (integer 1–31, required) instead of a directly-entered months-left figure; `months_left` is always derived fresh from `end_date`/`day_of_payment` vs. the current date — the current calendar month only counts as still-owed if `day_of_payment` hasn't passed yet (clamped to the current month's length), otherwise that payment is treated as already made and counting starts from next month — never stored, so the user never has to update it every month. The `interest_rate` field is always the **TAN** (nominal rate that drives the calc), labeled "TAN" on draft loans and "Interest rate" on active loans — never the TAEG/APR, which is a separate, fees-inclusive figure. Status can be toggled both ways, preserving both sides' field values; demoting active → draft (via `LoanFormModal`'s status toggle — there is no dedicated "Demote" button) always clears the expense link, `end_date`, and `day_of_payment`. Promoting draft → active has its own dedicated **"Promote"** button in `LoanDetail.jsx`'s toolbar (draft loans only, alongside Edit/Delete), opening `PromoteLoanModal.jsx` — a focused confirmation dialog asking only for the things a draft doesn't have (`remaining_balance`, prefilled from `principal`; `day_of_payment`, no default; `end_date`, prefilled as `term_months` months from today via `endDateFromMonthsLeft`), all adjustable before confirming; submits a `PUT` with just `status: 'active'` plus those fields, leaving every other field to carry forward automatically. `principal`, `term_months`, `down_payment`, `taeg`, and `opening_fee` are **never cleared** on promotion to active — they describe how the loan was originated and survive indefinitely as a historical record once real, even though they can only ever be explicitly *set* while `status = 'draft'` (400 if attempted on an active loan; an active PUT that omits them just carries the existing value forward unchanged). The same guard rejects an explicit `null` for any of these fields on a non-draft loan whenever it already has a non-null value on record — a partial PUT can only ever grow or leave this history untouched, never silently erase it; only omitting the field carries the existing value forward. Draft loans may optionally set a `down_payment` (nullable, draft-only to *set* — 400 if explicitly set on an active loan), letting the create/edit form take a purchase price + down payment instead of a directly-typed principal; the amortization calc always uses `principal` (amount financed), and a computed `purchase_price` (`principal + down_payment`) is returned/shown whenever a down payment is set, regardless of current status. Draft loans may also optionally set `taeg` (reference-only, never used in the calc — just for comparing against the TAN) and `opening_fee` (a one-off processing commission); whenever a loan (draft or promoted-to-active) still has `principal`/`term_months` on record, it exposes two computed totals over the full *original* term — `total_interest` (`origination_monthly_payment × term_months − principal`) and `total_amount_payable` (MTIC, a simplified estimate = `origination_monthly_payment × term_months + opening_fee`; the real legal MTIC can include untracked charges like stamp duty or insurance) — where `origination_monthly_payment` is computed from `principal`/`term_months`/`interest_rate`, distinct from the loan's current `monthly_payment` once active (which is based on `remaining_balance`/`months_left` instead). Active loans additionally expose `remaining_interest` (`monthly_payment × months_left − remaining_balance`) — interest still left to pay from now to payoff, the forward-looking counterpart to `total_interest`'s backward-looking full-term figure. Since `months_left ≥ 1` is only enforced at write time and is otherwise re-derived fresh on every read (never stored), an active loan left untouched past its `end_date` drifts to `months_left = 0` on its own; `computeLoanValues` flags this as `is_matured` and nulls out `remaining_interest` instead of letting it evaluate to a nonsensical negative figure (`0 × 0 − remaining_balance`) — `LoanDetail.jsx` shows a red "Matured" badge plus a warning banner prompting the user to update or close out the loan, and `LoansTab.jsx`'s list card shows the same badge. Active loans may optionally link to a `Fixed` expense template item to check budget coverage (green/red, with a `0.005` epsilon). Both draft and active loans offer the same three ephemeral scenario calculators (downpayment → lower payment or shorter term + interest saved; target payment → lump sum needed; interest rate change → new payment and interest cost, same balance and term, colored red/green by whether it's worse or better) — a draft's `principal`/`term_months` stand in for an active loan's `remaining_balance`/`months_left` as the simulation inputs, so a purchase study can be fine-tuned right after creation without promoting it to active first. The Loans tab list shows a `KpiStrip` summary (active loans only): total monthly amount, total amount due, loans ongoing, and total % of salary (`total monthly amount ÷ reference_salary`, not a sum of each loan's own `salary_pct`) — traffic-lighted against the dossier's `loans_max_salary_pct` setting (nullable, 0–100; edited in Dossier Settings → Loan Settings, alongside `reference_salary`): red once at or over the max, amber (`warning`) within the last 2 percentage points below it, green otherwise, neutral if the max isn't configured; a small note under the value spells out the absolute euro figures and remaining headroom (`total monthly amount € of (max% × reference_salary) € · remaining € free`, or `· over € over` once at/over the max). The loan detail page (`LoanDetail.jsx`) follows `CycleEditor`'s layout conventions: a compact hero (status/rate/payment, plus Total interest/MTIC/Remaining interest whenever available), then a `.cycle-editor-columns` two-column grid (60/40 desktop, stacking on mobile) used for every loan — left column holds the three scenario calculators as `CollapsibleSection`s, right column holds a "Loan details" `CollapsibleSection` (showing Purchase price/Down payment/original principal/original term/TAEG/opening fee whenever present, regardless of status) plus, for active loans, an "Expense coverage" `CollapsibleSection`. `LoanFormModal` shows a read-only "Original purchase structure" summary when editing an active loan that carries this historical data (switch to Draft to edit it). Active loans (only) additionally show a full-width "Amortization schedule" `CollapsibleSection` below the two-column layout, collapsed by default: a per-year interest/principal/balance rollup (`computeAmortizationSchedule`/`groupScheduleByYear` in `loanMath.js`, computed entirely client-side from the loan's existing `remaining_balance`/`interest_rate`/`months_left`/`monthly_payment` — no new endpoint) that expands per-year into its individual months, using the same expandable-row pattern as `AnnualExpenseTemplate.jsx` (`Set`-backed expanded state + chevron toggle), not `CollapsibleSection`. See `ai-spec/SPECIFICATION_LOANS.md`.
- **Subscription**: A per-dossier recurring personal cost (e.g. streaming, software) tracked separately from the Monthly Expense template, since the user funds it out of a distribution rather than budgeting it as an expense. Has a `name`, `monthly_cost`, an optional informational `billing_day` (1–31, display/sort only — no cycle items, no reminders), a `status` (`active`/`cancelled` — cancelled is a soft state kept for history, hidden from the list by default behind a "Show cancelled" toggle), and an optional link to a distribution template item (`distribution_template_item_id`). Multiple subscriptions may link to the same distribution (e.g. two subscriptions paid from one card funded by one "Personal" distribution); the linked-distribution's coverage badge on `SubscriptionsTab` sums every active subscription linked to it and compares that total against the distribution's own budgeted `value` (green "Covered" / red "Over by X €", `0.005` epsilon — same convention as Loans' expense-coverage check). No detail page — a flat list + add/edit modal (`SubscriptionsTab.jsx`), following the Loans pattern of a standalone table (`created_at ASC`, no `position`) rather than the Fixed-expense/cycle-item pattern. See `ai-spec/SPECIFICATION_SUBSCRIPTIONS.md`.
- **Glances**: A read-only summary panel above the tab bar in `DossierView`. Always shows exactly four cards (Capital, Current Cycle, Next Expense, Goals) with colour-coded states (neutral / amber / red) — no conditional 5th/6th card. All four cards share one literal fixed CSS height (`.glance-card { height: 148px; overflow: hidden }`), identical across every state and viewport — each card's content is condensed to fit that budget, with `overflow: hidden` kept only as a safety net, not relied on to hide content. In its normal state, the Capital card face shows three rows — "Total" (Idle + Active), "Savings" (Idle only), and "Potential" (Idle + Stocks, labelled "Savings potential" in the dialog) — each with its own inline trend arrow/percentage next to the value when a previous snapshot exists, shown on desktop/tablet only (`≥768px`; hidden below that since it would push the value out of the row on the narrower mobile card grid); clicking the card opens a dialog (`ui/Modal.jsx`) with the full breakdown — variation, idle subtotal, and (if at least one filled month has `stocks_total > 0`) a stocks sub-block with stocks total, variation, and "Overall" (Idle + Active + Stocks); the warning/empty Capital states still navigate to the Capital tab on click instead of opening the dialog. The Goals card shows active/completed/failed counts on one non-wrapping line (each count truncates individually with an ellipsis rather than wrapping the row if they don't all fit; the failed badge, when shown, never shrinks), an average-completion progress bar (mean of each goal's capped `total_current_progress / target_value`) below it, plus an embedded, independently-clickable Emergency Fund banner (deficit + target, condensed to one line when goals exist, navigates to the Emergency Fund tab) whenever the EF status is underfunded, and the whole card turns red while it's shown; healthy/no_data show nothing in that slot — a healthy fund is the expected default and isn't called out. Current Cycle card navigates to the relevant `CycleEditor`; Next Expense card also navigates to `CycleEditor`. The Current Cycle card's title ("Cycle of [Month Year]") drops the "Cycle of " prefix below `768px` so it fits on one line on the narrower mobile card grid, keeping the full prefix at `≥768px`; below the Balance/Expected rows it also shows a slim cycle-progress bar ("Day X/Y" of the current cycle, reusing the Goals card's progress-bar styling). The Next Expense card shows its value to the cent (Capital and Current Cycle values remain rounded to the nearest euro) and a relative "in N days" when-label; the "(Month Day)" date suffix on that label only renders at `≥768px` (hidden on the narrower mobile card grid to avoid overflow) — the "Today" and overdue states always show the payment date as "Month Day" regardless of viewport; when overdue, it shows a "Mark as paid" button on its own row below the value/when row; when not overdue and a second unpaid item exists, a 3rd line previews it ("[name] · in N days"). Three per-dossier warning day thresholds control amber/red states.
- **AI Advisor**: A per-dossier tab that sends a trimmed snapshot of the dossier (accounts, capital series, expense template, recent cycles, goals, loans, subscriptions, EF status, annual years, annual expense template, workbench, reference salary) to the Claude API. Active subscriptions contribute their `monthly_cost` and, when linked, their `linked_distribution` name — the model is instructed to compare a distribution's total linked subscriptions against that distribution's budgeted value and flag it as a risk if exceeded. Loans (both draft and active) are included via `computeLoanValues`, factoring their monthly payment, budget coverage, and total interest into the health score/highlights/risks, and compared against the dossier's `reference_salary`/`loans_max_salary_pct` ceiling when both are set; draft loans are treated as hypothetical studies, not commitments. The annual expense template (the recurring definition annual years are instantiated from) contributes a `total_monthly_avg` used to sanity-check a year's budgeted total and to factor recurring-but-not-yet-budgeted costs into capacity. Up to the 3 most-recently-updated Workbench snapshots contribute Must/Want/Save/leftover totals (via a server-side `summarizeWorkbenchData`, mirroring the frontend's `computeGlobalSummary`) — treated as the user's own targets/plans, not actuals, useful for flagging an unaffordable plan or a drift from `recent_cycles`. **Any new dossier-scoped feature with financial impact must be added to this context payload too** (see Documentation Maintenance rules above). An "Analyze dossier" button returns a structured assessment (health score 0–100, summary, highlights, improvements, risks) persisted per dossier (latest only, in `ai_analyses`); a chatbox answers questions with the same context (ephemeral, client-side history, buffered responses). Model is a per-dossier setting `ai_model` (default `claude-opus-4-8`; whitelist: haiku-4-5, sonnet-5, opus-4-8, fable-5) picked in the tab or in Settings. The whole feature is gated per dossier by `ai_enabled` (default on) — configured in Dossier Settings → **AI Settings**, alongside the model picker and an optional per-dossier `ai_api_key` (write-only, never returned by any endpoint; falls back to the operator-supplied `ANTHROPIC_API_KEY` env var when unset). When disabled, the AI Advisor tab is not rendered at all (no AI reference anywhere in the dossier UI) and the backend independently 403s all endpoints. Every response shows a USD cost estimate from token usage × a hardcoded pricing table. A "Use your Claude subscription instead" card (always visible, no API key required) lets the user copy or download the same context + analysis instructions as a self-contained prompt (`GET /ai-advisor/export-prompt`) to paste into claude.ai chat, avoiding per-call API billing entirely. An "Additional context" textarea (`ai_user_context`, capped at 4000 chars) lets the user add free-text notes the raw numbers don't capture (e.g. explaining away a one-off expense spike); it's persisted per dossier and included in every analysis, chat turn, and exported prompt, with the model instructed to give it real weight. See `ai-spec/SPECIFICATION_AI_ADVISOR.md`.
- **Emergency Fund**: A per-dossier savings buffer target. `target = multiplier × effective_monthly_base`, where `effective_monthly_base = avg_monthly_expense (Y most recent cycles) + annual_expenses_monthly_avg + extra_monthly_values`. `annual_expenses_monthly_avg` is the Annual Expense Template's total value ÷ 12 (same `total_monthly_avg`-style figure used by the AI Advisor), folded in automatically so recurring annual bills don't have to be manually re-entered as an extra monthly value. Status is `healthy`, `underfunded`, or `no_data`.

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
│   │   ├── middleware/rate-limit.js
│   │   └── routes/
│   │       ├── auth.js, setup.js, users.js
│   │       ├── dossiers.js       # Dossier CRUD, sharing, import/export; mounts sub-routers
│   │       ├── accounts.js, months.js
│   │       ├── expenses.js       # Monthly template, cycles, cycle items, workbench snapshots
│   │       ├── goals.js, emergency-fund.js
│   │       ├── ai-advisor.js     # AI Advisor: dossier context builder, Claude API calls, analysis + chat
│   │       ├── loans.js          # Loan CRUD + amortization math
│   │       ├── subscriptions.js  # Subscription CRUD + linked-distribution coverage
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
│   │   ├── utils/numbers.js, loanMath.js  # formatNumber/parseDecimalInput, loan amortization math
│   │   ├── pages/
│   │   │   └── NotificationSettings.jsx
│   │   └── components/
│   │       ├── DossierView.jsx         # Dossier page with all tabs
│   │       ├── DossierSettingsTab.jsx
│   │       ├── ConfirmModal.jsx        # Reusable animated confirmation modal
│   │       ├── layout/AppShell.jsx, Navbar.jsx, Sidebar.jsx
│   │       ├── glances/GlancesPanel.jsx, CapitalGlance.jsx,
│   │       │         CycleGlance.jsx, NextExpenseGlance.jsx, GoalsGlance.jsx
│   │       ├── ai-advisor/AIAdvisorTab.jsx, AnalysisPanel.jsx, ChatPanel.jsx, CostLabel.jsx
│   │       ├── emergency-fund/EmergencyFundTab.jsx
│   │       ├── expenses/ExpensesTab.jsx, CycleList.jsx, CycleEditor.jsx,
│   │       │          ExpenseTemplate.jsx, AnnualExpenseTemplate.jsx, DossierSettings.jsx
│   │       ├── ui/Checkbox.jsx, Badge.jsx, Button.jsx, Card.jsx, Modal.jsx, UpdateBanner.jsx
│   │       ├── workbench/WorkbenchTab.jsx
│   │       ├── goals/GoalsTab.jsx, GoalFormModal.jsx, GoalDetail.jsx
│   │       ├── loans/LoansTab.jsx, LoanFormModal.jsx, LoanDetail.jsx, PromoteLoanModal.jsx
│   │       └── subscriptions/SubscriptionsTab.jsx
├── ai-spec/
│   ├── SPECIFICATION.md                          # Core product spec (Capital section)
│   ├── SPECIFICATION_MONTHLY_EXPENSES.md
│   ├── SPECIFICATION_SUBSCRIPTIONS.md
│   ├── SPECIFICATION_WORKBENCH.md
│   ├── SPECIFICATION_GOALS.md
│   ├── SPECIFICATION_LOANS.md
│   ├── SPECIFICATION_GLANCES.md
│   ├── SPECIFICATION_EMERGENCY_FUND.md
│   ├── SPECIFICATION_AI_ADVISOR.md
│   ├── SPECIFICATION_PAPERLESS.md
│   ├── SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md
│   ├── SPECIFICATION_UI.md
│   ├── SPECIFICATION_BACKEND_LOGGING.md
│   ├── SPECIFICATION_PREVIEW_ENVIRONMENTS.md
│   └── SPECIFICATION_PWA.md
├── preview-index/            # Lightweight service listing preview environments
├── docs/
│   └── PLATFORM_GUIDE.md     # Human-facing platform guide (features, usage philosophy)
├── landing/                  # Public marketing + manual site, deployed to GitHub Pages
│   ├── index.html            # Home page (self-contained, inline CSS)
│   ├── assets/manual.css     # Shared stylesheet for the manual pages
│   └── manual/                # Screenshot-driven user manual, one page per app section
│       ├── index.html         # Manual hub (section index)
│       └── capital.html       # Capital section walkthrough (first section built out)
├── .github/workflows/
│   ├── deploy.yml            # CI/CD: build + deploy to self-hosted runner
│   ├── preview-deploy.yml    # Ephemeral preview environments for feature branches
│   └── pages.yml             # Deploys landing/ to GitHub Pages on push to main
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
| Rate limiting | `express-rate-limit` (global API limiter + stricter login limiter) |
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

### Branch Naming

When creating a new branch for a piece of work, give it a short, meaningful, descriptive name reflecting the feature or fix being developed (e.g. `add-stocks-money-category`, `fix-emergency-fund-rounding`) rather than a generic or auto-generated name.

### GitHub Issue Conventions

Every issue filed in `mribeiro/boodget` (by an AI assistant or otherwise) must carry three labels, all lowercase:

1. **Type** (exactly one): `bug`, `likely real bug`, `idea`, `improvement`, `tech debt`, or `documentation`.
   - `likely real bug` is reserved for defects found via code review/audit before being confirmed by a human, as opposed to `bug`, a confirmed defect.
2. **Criticality** (exactly one, for defect-type issues — `bug`/`likely real bug`; apply to other types too when a severity call meaningfully applies):
   - `blocker` — must block a release/going live (e.g. a security issue); cannot be lived with.
   - `critical` — a hard bug that prevents the user from doing something, with no repair/recovery path (e.g. irreversible data loss).
   - `major` — impacts the user and requires them to fix or work around it somehow.
   - `minor` — a bug only in data representation/display; underlying data is unaffected, and there's typically no user-actionable fix.
   - `trivial` — a UI-only issue or something with light user impact (includes most code-hygiene/tech-debt items).
3. **`opened by claude`** — always applied, marking the issue as filed by an AI assistant.

Label names are case-insensitive in GitHub, so reuse the exact lowercase strings above rather than creating capitalized variants that would silently collide with (or duplicate) the canonical ones.

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
- **Pages** (`pages.yml`): on push to `main` touching `landing/**` (or manual dispatch), uploads `landing/` as a Pages artifact and deploys it via `actions/deploy-pages`. Requires the repo's *Settings → Pages → Build and deployment → Source* to be set to "GitHub Actions" (one-time, done outside this repo).

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
| `dossiers` | Capital dossiers. `creator_id` FK → `users`. Holds `cycle_start_day` (default 25), three Glances warning thresholds (`capital_snapshot_warning_day` default 7, `next_cycle_warning_day` default 22, `previous_cycle_close_warning_day` default 25), two EF settings (`emergency_fund_months_multiplier` default 6, `emergency_fund_cycles_to_average` default 6), four Paperless fields (all nullable), `expense_notification_days_before` (default 1), `ai_enabled` (default `1` — gates the entire AI Advisor feature for the dossier), `ai_model` (default `claude-opus-4-8`; whitelist enforced in settings PATCH), `ai_api_key` (nullable, secret — per-dossier Claude API key, write-only, never returned by any GET; falls back to the `ANTHROPIC_API_KEY` env var when unset), `ai_user_context` (nullable, user-authored free text ≤ 4000 chars, included in every AI Advisor prompt), `reference_salary` (nullable, manually-set — prefills new loans' `salary` and denominates the Loans tab's total % of salary; not derived from `expense_cycles`), `loans_max_salary_pct` (nullable, 0–100 — the Loans tab's red/amber/green threshold against `reference_salary`). |
| `dossier_access` | Many-to-many sharing: `(dossier_id, user_id)` PK. |
| `accounts` | `type` ∈ `{Risk Investment, Guaranteed Investment, Current Account}`. `archived`, `money_category` ∈ `{idle, active, stocks}` (default `active`; `stocks` accounts are excluded from `capital_total` and tracked separately), `can_receive_transfers` (default `1`; gates eligibility as a distribution funding account), `position`. |
| `months` | Monthly snapshots. `(dossier_id, year, month)` UNIQUE. `filled` bool. |
| `month_account_snapshot` | Accounts active when a month was created. |
| `month_entries` | `(month_id, account_id)` → `value`, optional `comment`. |
| `expense_template_items` | Monthly template. `section` ∈ `{expense, distribution}`, `type` ∈ `{Fixed, Budget}`. Expenses have `classification`, `day_of_payment`, `paperless_tag_id`, `exclude_from_emergency_fund`. Distributions have `must_amount`, `want_amount`, `save_amount`, `account_id` (nullable, funding account). |
| `expense_cycles` | `(dossier_id, year, month)` UNIQUE. `salary`, `previous_balance`, `is_closed`, `final_real_balance`, `cycle_start_day` (snapshotted from the dossier's setting at creation time; used for all of this cycle's own date/ordering/clamping math instead of the dossier's live setting, so later changes to it don't retroactively reshape existing cycles). |
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
| `goal_distributions` | `(goal_id, distribution_template_item_id)`. Cascades on delete. |
| `goal_cycle_contributions` | `(goal_id, cycle_id)`. `real_contribution` upserted. |
| `goal_historical_contributions` | `(goal_id, year, month)`. Managed via bulk-replace. |
| `loans` | `name`, `status` (`draft`/`active`), `interest_rate` (annual %, the TAN), `salary`, `principal`/`term_months`/`down_payment`/`taeg`/`opening_fee` (all nullable; settable only while `status='draft'`, but never cleared on promotion to active — persist as a historical record), `remaining_balance`/`end_date`/`day_of_payment` (active; `end_date` nullable `YYYY-MM`, `day_of_payment` nullable integer 1–31, both required for active and cleared on demotion to draft — `months_left` is derived from both, never stored), `expense_template_item_id` (nullable FK → `expense_template_items`, `ON DELETE SET NULL`, active only). No `position`/`updated_at`; list ordered `created_at ASC`. |
| `subscriptions` | `name`, `monthly_cost`, `billing_day` (nullable integer 1–31, informational/sort only), `status` (`active`/`cancelled`, default `active`), `distribution_template_item_id` (nullable FK → `expense_template_items`, `ON DELETE SET NULL`; must reference a `section='distribution'` row). No `position`/`updated_at`; list ordered `created_at ASC`. |
| `emergency_fund_accounts` | `(dossier_id, account_id)`. Current value from most recent filled snapshot. |
| `emergency_fund_extra_values` | `name`, `value`, `position`. |
| `ai_analyses` | Latest AI Advisor analysis per dossier. `dossier_id` UNIQUE (upserted on re-run). `model`, `content` (analysis JSON), token counts, `cost_usd`, `created_at`. Not exported. |
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
- **Last applied migration**: `038_add_cycle_start_day_to_expense_cycles`. **Next id must be `039_...`**
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

## Naming Conventions

### Budgeted vs. actual amounts

Several features track a "budgeted/planned" figure alongside "what actually happened" for the same period — this is the same underlying shape every time, but it has historically been named differently per feature, which makes cross-feature mismatches (e.g. one side using a stored actual, the other a derived-expected figure) easy to miss (see issue #197 and the #177 incident it references — a year-detail `total_paid` computed inconsistently from `real_value` in one place and a derived figure in another).

**Convention going forward**: name the actual/realized field `real_value` (or `real_<name>` if disambiguation from `value` is needed), matching the clearest existing example, `annual_expense_payments.real_value`. Don't introduce a new synonym (`actual_value`, `paid_value`, etc.) for a new budgeted-vs-actual pair. Existing fields that predate this convention are **not** renamed — no functional/schema change was made for issue #197:

| Feature | Budgeted/planned field | Actual/realized field |
|---|---|---|
| Monthly Expenses — Budget items | `cycle_items.value` (the max) | `cycle_items.spent` |
| Monthly Expenses — Fixed items | `cycle_items.value` | none stored — `paid` (boolean) implies the actual equals `value` |
| Annual Expenses | `annual_expense_year_items.budgeted_value` | `annual_expense_payments.real_value` |
| Expense Template (Monthly) | `expense_template_items.value` | n/a — templates are planning-only, no actual is ever recorded against them |

## API Conventions

All API routes are under `/api`. REST with JSON request/response bodies.

- Protected routes use `requireAuth` middleware (checks `req.session.userId`).
- Public routes: `/api/setup/*`, `/api/auth/login`, `/api/auth/oidc/*`.
- Error format: `{ error: "message" }` with appropriate HTTP status.
- All `/api/*` routes are rate-limited (429 with `{ error }` once exceeded); `POST /api/auth/login` additionally sits behind a stricter, per-account limiter (`backend/src/middleware/rate-limit.js`).

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
POST   /api/dossiers/:id/accounts   { group_name, name, type, money_category? }
PUT    /api/dossiers/:id/accounts/reorder   { accountIds: [] }
PATCH  /api/dossiers/:id/accounts/:accountId  { name?, group_name?, money_category?, can_receive_transfers? }
DELETE /api/dossiers/:id/accounts/:accountId  (archives, not deletes)
                                              # 409 if still linked as a distribution's funding account

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
                                       paperless_amount_field_id?, expense_notification_days_before?,
                                       ai_enabled?, ai_model?, ai_api_key?, ai_user_context?, reference_salary?, loans_max_salary_pct? }

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

GET    /api/dossiers/:id/loans
POST   /api/dossiers/:id/loans   { name, status, interest_rate, salary?, principal?, term_months?, down_payment?, taeg?, opening_fee?, remaining_balance?, end_date?, day_of_payment?, expense_template_item_id? }
GET    /api/dossiers/:id/loans/:loanId
PUT    /api/dossiers/:id/loans/:loanId
DELETE /api/dossiers/:id/loans/:loanId

GET    /api/dossiers/:id/subscriptions?includeCancelled=true
POST   /api/dossiers/:id/subscriptions   { name, monthly_cost, billing_day?, distribution_template_item_id? }
PATCH  /api/dossiers/:id/subscriptions/:subscriptionId  { name?, monthly_cost?, billing_day?, status?, distribution_template_item_id? }
DELETE /api/dossiers/:id/subscriptions/:subscriptionId

GET    /api/dossiers/:id/emergency-fund/accounts
PUT    /api/dossiers/:id/emergency-fund/accounts         { account_ids: [] }
GET    /api/dossiers/:id/emergency-fund/extra-values
POST   /api/dossiers/:id/emergency-fund/extra-values     { name, value }
PATCH  /api/dossiers/:id/emergency-fund/extra-values/:itemId  { name?, value? }
DELETE /api/dossiers/:id/emergency-fund/extra-values/:itemId
GET    /api/dossiers/:id/emergency-fund/status

GET    /api/dossiers/:id/ai-advisor/analysis   # { configured, analysis|null }
POST   /api/dossiers/:id/ai-advisor/analysis   # run + persist a new analysis
POST   /api/dossiers/:id/ai-advisor/chat       { messages: [{role, content}] }
GET    /api/dossiers/:id/ai-advisor/export-prompt   # { prompt } — paste into claude.ai chat, no API key needed

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
- `/dossiers/:id` → `DossierView` (tabs: Capital, Monthly Expenses, Annual Expenses, Workbench, Goals, Loans, Emergency Fund, AI Advisor, Settings)
- `/dossiers/:id/months/:monthId`, `/dossiers/:id/cycles/:cycleId`, `/dossiers/:id/goals/:goalId`, `/dossiers/:id/loans/:loanId`
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

### Visual QA — Screenshot Every UI Change

**Mandatory, automatic, no need to be asked.** Whenever a change touches rendered UI (anything under `frontend/src/components`, or CSS affecting it), before ending the turn: run the app, capture screenshots of every distinct visual state the change affects, at both a mobile and a desktop viewport, and send them inline via `SendUserFile` (`display: 'render'`). Skip only for diffs with no visual surface (backend-only, docs-only) — same scoping as the `/verify` skill.

- **Tooling**: `scripts/screenshot.js` — a dependency-free Node script (no `package.json` entry anywhere) that resolves Playwright from `node_modules` if present, else falls back to a known global install path. Logs in via the `#username`/`#password` form, navigates to a path, and saves a PNG (optionally cropped to a `--selector`). Usage: `node scripts/screenshot.js <path> <outFile> --width= --height= --base= [--selector=] [--user=] [--pass=]`.
- **Isolation**: never point this at a real/shared dev DB. Start a throwaway backend (`NODE_ENV=ephemeral SEED_ON_EMPTY=true DB_PATH=<scratchpad>/screenshot.db`) and frontend (`npm run dev`) in the background, using the **default ports** (3000 / 5173) whenever they're free — `vite.config.js`'s `/api` proxy target is a hardcoded `http://localhost:3000`, and Chromium blocks `page.route()` from rewriting a request to a different origin/port (`ERR_BLOCKED_BY_CLIENT`), so the throwaway backend must run on :3000 for the frontend's proxy to reach it. If :3000/:5173 are already occupied by a real dev session, temporarily change vite.config.js's proxy target to the alternate port for the run and revert it immediately after — never leave that edit committed or uncommitted in the tree. Reuse the running pair for the rest of the session; tear both down (and delete the scratch DB) when done.
- **Choosing states ("variations")**: prefer the six dossiers `backend/src/db/seed.js` seeds for the `preview` user (password `Preview@Capital2024!`) — they're deliberately engineered to cover most Glances/Capital/Cycle/Goals/Emergency-Fund/Loans states: "My Finances" (all-neutral; also the only dossier with seeded loans — an active, covered "Car Loan" and a draft "House Purchase Study" exercising the down payment/TAEG/opening fee/MTIC fields), "Glances — All Good", "Glances — Capital Snapshot Missing" (Capital amber), "Glances — Red Alerts" (cycle red), "Glances — Next Cycle Not Opened" (cycle amber), "Emergency Fund — Underfunded". If the change affects a state none of these cover, create it with a couple of API calls against the throwaway instance rather than editing seed data.
- **Viewports**: mobile `390×844`, desktop `1440×900` — comfortably inside this codebase's `<768` / `≥1024` breakpoints (`ai-spec/SPECIFICATION_UI.md` §14).
- Caption each sent image with component + state + viewport so the set is scannable.

## Key Business Rules

1. **Password policy**: Min 16 chars, uppercase + lowercase + digit + symbol. Validated in `routes/auth.js` and `routes/users.js`.
2. **Account deletion is soft**: `DELETE /accounts/:id` sets `archived=true`. Preserves historical month data. Blocked with `409` if the account is still linked as a distribution's funding `account_id` anywhere (template or cycle items).
3. **Month snapshots**: On month creation, all non-archived accounts are snapshotted (`month_account_snapshot`).
4. **Dossier access**: Only `creator_id` can share/unshare or delete. Shared users have full edit rights.
5. **OIDC users**: `is_oidc=1`; cannot use local login or change-password.
6. **Currency**: Stored per-dossier, defaulting to `EUR`. Multi-currency out of scope. All displayed numbers use `.` as the thousands separator and `,` as the decimal separator (e.g. `1.234,56 €`), via the shared `formatNumber` helper in `frontend/src/utils/numbers.js` — never call `Intl.NumberFormat` directly in components.
7. **Expense cycles**: `(dossier_id, year, month)` uniqueness only. Stored `(year, month)` is the **start** month; display name uses the **end** month.
8. **Cycle start day**: `cycle_start_day` is a per-dossier setting (default 25) that only determines the start day used when a *new* cycle is created — the value in effect at that moment is copied onto the cycle's own `expense_cycles.cycle_start_day` column and used for everything about that cycle from then on (display name, date range, Fixed-expense sorting, day-of-payment clamping, annual-expense installment matching). Display name: `new Date(year, month, startDay - 1)`. Range: start = `new Date(year, month - 1, startDay)`, end = `new Date(year, month, startDay - 1)`. Example: stored `month=3`, `startDay=25` → Mar 25 – Apr 24 → "April 2025". Cycles created before this per-cycle column existed were backfilled with the dossier's setting at migration time (best-effort, since the value actually in effect when each was originally created was never recorded).
9. **Template → cycle copy**: All template items copied to `cycle_items`. `day_of_payment` clamped to last day of cycle's calendar month.
10. **Expense sorting**: Fixed expenses sort by day — days ≥ `cycle_start_day` first (asc), then days < `cycle_start_day` (asc). Budget items always last. Applies in `CycleEditor`, `ExpenseTemplate`, and `SubscriptionsTab` (subscriptions with no `billing_day` sort last, same as Budget items).
11. **Export format**: version `12`. Includes dossier settings, `expense_template[]`, `annual_expense_template[]` (with installments), `workbench_snapshots[]`, `cycles[]` (with items), `goals[]` (with account_names, distribution_names, contributions), `emergency_fund_accounts[]`, `emergency_fund_extra_values[]`, `annual_expense_years[]`, `loans[]` (version 10+), `subscriptions[]` (version 11+). Template items and cycle items round-trip `exclude_from_emergency_fund` (default `0` for older versions) and `account_name` for distributions (the funding account, re-linked by name on import; `null`/missing on older exports). `accounts[]` round-trips `money_category` (version 9+); imports of versions ≤ 8 (which only have `is_idle_money`) derive it as `is_idle_money ? 'idle' : 'active'`. `accounts[]` also round-trips `can_receive_transfers` (defaults to `1`/true on older exports missing the field). Dossier settings round-trip `ai_enabled` (version 10+; imports of versions ≤ 9 default to `true`), `ai_model` (version 10+; imports of versions ≤ 9 default to `claude-opus-4-8`), `ai_user_context` (version 10+; imports of versions ≤ 9 default to `null`), `reference_salary`, and `loans_max_salary_pct`; `ai_api_key` is a secret and, like the Paperless token, is never exported/imported; `ai_analyses` rows are deliberately not exported. `loans[]` round-trips `linked_expense_name` (the linked Fixed expense, re-linked by name on import, active loans only; absent/ignored on versions ≤ 9), `down_payment`/`taeg`/`opening_fee`/`principal`/`term_months` (imported as-is regardless of status — these survive on active loans as a historical record from origination, same as live), and `end_date`/`day_of_payment` (active loans only, both imported as `null` for draft loans; `months_left` is never exported, always re-derived from `end_date` and `day_of_payment`). `subscriptions[]` round-trips `distribution_name` (the linked distribution template item, re-linked by name on import; `null`/missing on older exports or versions ≤ 10). Each entry in `cycles[]` round-trips its own `cycle_start_day` (version 12+; imports of versions ≤ 11, which only carried the dossier-wide setting, fall back to the exported `dossier.cycle_start_day` — the same value that cycle would have used before this per-cycle column existed). Import accepts versions 1–12. Goals and EF accounts re-linked by account name on import. Cycle items are re-linked to their new template item on import by matching `(section, name)`, so the EF average correctly recognizes them as template-derived. Paperless token excluded for security.
12. **Emergency Fund**: `target = multiplier × (avg_monthly_expense + annual_expenses_monthly_avg + extra_monthly_total)`. Average from Y most recent cycles: budget items use `spent` (closed) or `max` (open). Archived accounts excluded. Cycle items with no template link (ad-hoc) are always excluded from the average. `annual_expenses_monthly_avg` is the Annual Expense Template total ÷ 12, independent of cycles (included even in the `no_data` state).

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
| `ANTHROPIC_API_KEY` | No | Fallback Anthropic API key for the AI Advisor, used by dossiers that haven't set their own key in Settings → AI Settings. If no key resolves (neither dossier nor env var), the AI Advisor tab shows a setup hint and its POST endpoints return 503. |
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
| `[accounts]` | Created, archived, renamed |
| `[months]` | Created, submitted, reset |
| `[cycles]` | Created, closed/reopened, deleted |
| `[settings]` | Updated (lists changed field names) |
| `[goals]` | Created, deleted |
| `[loans]` | Created, updated, deleted |
| `[subscriptions]` | Created, updated, deleted |
| `[emergency-fund]` | Account selection updated |
| `[ai-advisor]` | Analysis run, chat turn (dossier, user, model, tokens, cost — never message content), failures |
| `[push]` | Generated new VAPID keys; removed expired subscription (scheduler and test endpoint) |

## No Test Suite

No automated tests. Prefer pure functions and thin route handlers to make logic easy to test in isolation. (The Visual QA screenshot workflow under Frontend Conventions is a manual/AI-driven visual-QA aid, not an automated test suite — it doesn't change this.)
