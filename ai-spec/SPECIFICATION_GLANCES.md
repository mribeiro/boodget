# boodget — Glances Specification

## 0. Status

**This feature is fully implemented.** The components, schema migration, and settings UI are all in place.

This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, `SPECIFICATION_WORKBENCH.md`, and `SPECIFICATION_GOALS.md`. Read all five alongside this one.

---

## 1. Overview

Glances is a read-only summary panel displayed **above the dossier tabs** (Capital, Monthly Expenses, Workbench, Goals, Settings) whenever a dossier is open. It gives the user an immediate at-a-glance view of the dossier's financial state across all sections, using colour coding to communicate urgency without requiring the user to navigate into each section.

---

## 2. Layout

- The Glances panel is a **horizontal row of cards**, rendered above the tab bar and below the dossier title.
- On mobile, cards stack vertically.
- There are always **exactly four cards**, in this fixed order, with no conditional 5th/6th cards:
  1. Capital
  2. Current Cycle
  3. Next Expense
  4. Goals
- All four cards share a single **fixed height** (`.glance-card { height: 148px; overflow: hidden; }`), identical in every state and at every viewport width — not just visually similar, but a literal CSS guarantee. Each card's content is condensed to fit this budget (Capital's three-row face, Current Cycle's two-row face, Next Expense's name/value-when/button rows, Goals' single-line count row and compact Emergency Fund banner); `overflow: hidden` is a safety net only, not a content-fitting strategy — every real content combination is measured to fit within the budget without clipping.
- Stocks figures are folded into the Capital card as a sub-block (see §3.3) rather than shown as a separate card. The Emergency Fund warning is folded into the Goals card as an embedded banner (see §6, and `SPECIFICATION_EMERGENCY_FUND.md` §7).
- Each card is **clickable**:
  - Capital card → in its normal state (§3.1), opens a details dialog in place (see §3.4); in its warning/empty states (§3.2/§3.3), navigates to the Capital tab instead, since there's nothing to show in a dialog.
  - Current Cycle card → **CycleEditor page for the relevant cycle** (`/dossiers/:id/cycles/:cycleId`):
    - Normal / loading state → current cycle's editor
    - Red state (previous cycle not closed) → previous cycle's editor
    - Fallback (next cycle not opened, no current cycle) → Monthly Expenses tab
  - Next Expense card → **CycleEditor page for the current cycle** (`/dossiers/:id/cycles/:cycleId`). Fallback: Monthly Expenses tab when no current cycle exists.
  - Goals card → Goals tab
- Cards use a **colour scheme** to communicate state:
  - **Neutral** (default) — no issue
  - **Amber** — attention needed
  - **Red** — urgent action required

---

## 3. Card 1 — Capital

### 3.1 Normal state (neutral)

Displayed when a filled Capital snapshot exists for the current month, **or** when the snapshot warning threshold has not yet been reached.

The card face shows three rows:
- **Total** — sum of `Idle` + `Active` account values from the most recent filled snapshot, formatted as currency (€). `Stocks`-category accounts are never included in this total. Shown inline next to the value (when a previous filled snapshot exists): the same variation arrow/percentage used in the details dialog (§3.4), e.g. "▲ +2.4%", colour-coded green/red/neutral.
- **Savings** — Idle only (see `SPECIFICATION.md` §11.1).
- **Potential** — Idle + Stocks (see `SPECIFICATION.md` §11.1).

Both row labels and values use `white-space: nowrap` so a large figure never forces the row onto two lines.

Clicking the card opens a details dialog (see §3.4) with the full breakdown — variation, idle subtotal, and (if applicable) the stocks sub-block. No data is hidden, only deferred behind a click, to keep the card the same height as its siblings.

### 3.2 Warning state (amber)

Condition: today's day-of-month ≥ `capital_snapshot_warning_day` **and** no filled snapshot exists for the current calendar month.

Replaces the normal state entirely. Shows:
- Title: "Capital"
- Message: "[Month] snapshot not yet recorded" (e.g. "March snapshot not yet recorded")

### 3.3 Empty state (neutral)

Condition: no filled snapshot exists at all (dossier has no months registered yet).

Shows:
- Title: "Capital"
- Message: "No records yet"

### 3.4 Details dialog

Opened by clicking the card in its normal state (§3.1), using the shared `ui/Modal.jsx` component. Purely informational — never changes the card's colour state and never affects the main capital total.

Shows:
- **Total capital** — same value as the card face, plus **variation**: percentage change relative to the previous filled snapshot (e.g. `↑ +2.4% vs. Feb`). Colour: green if positive, red if negative, neutral if zero or no previous snapshot exists.
- **Idle money subtotal** — if any accounts are in the `Idle` category, the sum of their values plus variation.
- **Stocks sub-block** — shown whenever the most recent filled snapshot has `stocks_total > 0`:
  - **Total stocks value** — sum of `Stocks`-category account values, formatted as currency (€).
  - **Variation** — percentage change relative to the previous filled snapshot, same colour rules as the main Capital variation.
  - **Overall** — Idle + Active + Stocks (see `SPECIFICATION.md` §11.1).
  - **Savings potential** — Idle + Stocks (see `SPECIFICATION.md` §11.1) — repeated here for context alongside Overall, even though it's already visible on the card face as the "Potential" row.

---

## 4. Card 2 — Current Cycle

### 4.1 Determining the current cycle

The current cycle is the one whose date range covers today, computed using the dossier's `cycle_start_day`:

- A cycle for month M covers from `cycle_start_day` of M-1 to `cycle_start_day - 1` of M.
- Example: `cycle_start_day = 25`, today = 14 March → current cycle = March cycle (25 Feb → 24 Mar).

### 4.2 Normal state (neutral)

Condition: a cycle exists for the current period and no warning thresholds are triggered.

Shows:
- **Title**: "Cycle of [Month Year]" (e.g. "Cycle of March 2025") — the "Cycle of " prefix is hidden below `768px` (`.cycle-title-prefix`, same breakpoint as the card grid's mobile/desktop switch) so the title fits on one line on the narrower mobile card grid; desktop/tablet keeps the full "Cycle of [Month Year]". Same prefix-hiding rule applies to the title in every state below (4.3, 4.4, 4.5 keeps its own static "Current Cycle" title unaffected since it has no prefix).
- **Current expected balance**: `Total available − paid fixed expenses − spent budget amounts − done distributions`
- **Expected leftover**: the `Expected balance` field already computed on the cycle (`Total available − all fixed expense values − all budget maximum values − all distribution values`)
- **Cycle progress bar**: a slim bar (reusing the same `.progress-track`/`.progress-fill` styling as the Goals card's completion bar) showing how many days of the current cycle have elapsed, with a "Day X/Y" label to the right. Computed from the cycle's start/end dates (§4.1) and today's date, clamped to 1–100%. Only shown in this normal state — not in the warning/no-cycle states (4.3–4.5), which show a message instead.

### 4.3 Warning: next cycle not opened (amber)

Condition: today's day-of-month ≥ `next_cycle_warning_day` **and** the next cycle has not yet been opened.

"Next cycle" is the cycle that will start on the next occurrence of `cycle_start_day`.

Shows:
- Title: "Cycle of [next month]"
- Message: "Next cycle has not been opened yet"

### 4.4 Warning: previous cycle not closed (red)

Condition: today's day-of-month ≥ `previous_cycle_close_warning_day` **and** the previous cycle is not closed (`is_closed = false`).

Takes priority over the amber warning (4.3) if both conditions are true simultaneously. Only the most severe warning is shown.

Shows:
- Title: "Cycle of [previous month]"
- Message: "Previous cycle has not been closed yet"

### 4.5 No cycle open (amber)

Condition: no cycle exists whose date range covers today.

This is always an anomalous state — there should always be a cycle open. Treated as a warning.

Shows:
- Title: "Current Cycle"
- Message: "No cycle is currently open"

---

## 5. Card 3 — Next Expense

### 5.1 Normal state (neutral)

Condition: current cycle exists and at least one fixed expense is unpaid.

The next expense is the first unpaid fixed expense ordered by **cycle day** (as defined in `SPECIFICATION_MONTHLY_EXPENSES.md`, Section 5.2). Annual expense payments due within the current cycle are merged into the same ordered list.

Shows:
- **Title**: "Next Expense"
- **Expense name** (annual payments also show installment counter and "Annual" badge)
- **Value** (€, shown to the cent — unlike the Capital and Current Cycle cards, which round to the nearest euro)
- **When**: days until payment as a relative count, e.g. "in 3 days"; the calendar date suffix ("in 3 days (Mar 10)") is appended only at `≥768px` (`.next-expense-date-suffix`, same breakpoint as the card grid's mobile/desktop switch) — below that the narrower two-column mobile card grid doesn't have room for it. If the payment day is today: "Today (Mar N)" (date always shown, both viewports). If the payment day has already passed in the current cycle but the expense is still unpaid: just the date, "Mar N" (no "Overdue" prefix, always shown) — the card turning amber already signals the overdue state.
- **Mark as paid button**: when the expense is overdue, a "Mark as paid" shortcut button appears on its own row below the value/when row. Clicking it marks the item as paid in place (via `PATCH /cycles/:cycleId/items/:itemId` for monthly items, or `PATCH /annual-expense-payments/:paymentId` for annual items) and refreshes the card immediately — without navigating away.
- **Next-next preview**: when the expense is **not** overdue and a second unpaid item exists in the same ordered list, a 3rd line previews it — "Then: [name] · [relative day count]" (e.g. "Then: Electricity · in 5 days"; "Today"/"Overdue" for the edge cases), truncating with an ellipsis rather than wrapping. Only shown when not overdue, since the overdue state uses that row for the "Mark as paid" button instead.

### 5.2 All paid state (neutral)

Condition: current cycle exists and all fixed expenses are paid (or there are no fixed expenses).

Shows:
- Title: "Next Expense"
- Message: "All fixed expenses paid"

### 5.3 No cycle state (neutral)

Condition: no current cycle exists.

Shows:
- Title: "Next Expense"
- Message: "No cycle in progress"

---

## 6. Card 4 — Goals

### 6.1 Normal state (neutral)

Condition: no failed goals exist.

Shows:
- **Title**: "Goals"
- Count of active goals (e.g. "4 active")
- Count of completed goals if any (e.g. "1 completed")
- An **average completion progress bar**: the mean of each goal's `min(100, total_current_progress / target_value × 100)`, with a percentage label to the right. Bar colour follows the same low/medium/high thresholds as `GoalsTab`'s per-goal bars (red < 25%, amber < 75%, green ≥ 75%).

Active, completed, and failed counts render as same-line items in a flex-wrapped row (not stacked lines), with the average completion bar directly below, to keep the card within the shared fixed height.

### 6.2 Alert state (red)

Condition: one or more goals are in state `failed`.

Shows:
- Title: "Goals"
- Count of active goals
- Count of failed goals with a warning indicator (e.g. "2 failed ⚠")
- Same average completion progress bar as 6.1 (failed goals count as their raw completion percentage, not 0, and are not excluded from the average)

### 6.3 Empty state (neutral)

Condition: no goals exist for the dossier.

Shows:
- Title: "Goals"
- Message: "No goals defined"

### 6.4 Emergency Fund banner

An embedded, independently-clickable banner shown inside the Goals card (in any of the 6.1–6.3 states above) whenever the Emergency Fund status is `underfunded`. See `SPECIFICATION_EMERGENCY_FUND.md` §7 for full details. Summary:
- Renders below the goal counts (and, when goals exist, below the average completion bar too), separated by a border.
- Shows a shield icon and a warning triangle. When goals exist (6.1/6.2), the text is condensed to a single line — "€X short of €Y" — to fit the card's height budget alongside the progress bar; in the empty state (6.3, no progress bar present) it uses the fuller two-line form: "Emergency Fund: €X short" plus a "Target: €Y" subtitle.
- Clicking the banner navigates to the Emergency Fund tab (via `stopPropagation`, independent of the rest of the card, which navigates to the Goals tab).
- When this banner is shown, the outer Goals card itself also switches to the **red** colour state, even if no goals have failed.

When the Emergency Fund status is `healthy` instead, a compact one-line status is shown in the same slot — a shield icon, "Emergency Fund: healthy", and a check-circle icon, in the success colour — rather than nothing at all. Same click-through behaviour as the underfunded banner. Does not affect the card's colour state. When the status is `no_data` (or no Emergency Fund accounts are configured), nothing is shown, same as before — there's nothing meaningful to report yet.

---

## 7. Settings Changes

Three new configurable thresholds are added to the **Dossier Settings** section, alongside the existing "Cycle start day" setting.

| Field | Description | Default | Constraint |
|---|---|---|---|
| `capital_snapshot_warning_day` | Day of month from which a warning is shown if the Capital snapshot for the current month is missing | 7 | Integer, 1–28 |
| `next_cycle_warning_day` | Day of month from which a warning is shown if the next cycle has not been opened | 22 | Integer, 1–28 |
| `previous_cycle_close_warning_day` | Day of month from which a warning is shown if the previous cycle has not been closed | 25 | Integer, 1–28 |

### 7.1 UI Labels (user-facing)

| Field | UI Label |
|---|---|
| `capital_snapshot_warning_day` | Warn about missing capital snapshot from day ___ of the month |
| `next_cycle_warning_day` | Warn about next cycle not opened from day ___ of the month |
| `previous_cycle_close_warning_day` | Warn about previous cycle not closed from day ___ of the month |

### 7.2 Validation

- All three fields accept integers between **1 and 28** (inclusive).
- Validated on both frontend and backend.
- The constraint of 28 ensures the threshold is always valid regardless of month length.

---

## 8. Schema Changes

### 8.1 Dossier settings (`dossiers` table)

Three new columns are added via migration:

| Column | Type | Default |
|---|---|---|
| `capital_snapshot_warning_day` | INTEGER | 7 |
| `next_cycle_warning_day` | INTEGER | 22 |
| `previous_cycle_close_warning_day` | INTEGER | 25 |

These columns follow the same pattern as `cycle_start_day` (migration `003`). Add a new migration (id: `016_add_glance_warning_days`) to apply the `ALTER TABLE` statements idempotently.

> Note: if migration `016` is already taken by another feature, use the next available id.

### 8.2 Settings API

The existing `GET /api/dossiers/:id/settings` and `PATCH /api/dossiers/:id/settings` endpoints must be extended to include the three new fields.

---

## 9. API

No new endpoints are required. The Glances panel is computed entirely on the **frontend** using data already available from existing endpoints:

| Data needed | Existing endpoint |
|---|---|
| Most recent filled snapshot + variation | `GET /api/dossiers/:id/months` |
| Dossier settings (warning days, cycle_start_day) | `GET /api/dossiers/:id/settings` |
| Current cycle data (salary, balance, items) | `GET /api/dossiers/:id/cycles` |
| Goals list and states | `GET /api/dossiers/:id/goals` |

The frontend determines "today" using the client's local date (`new Date()`).

---

## 10. Component Structure

A new component `GlancesPanel` is created under `frontend/src/components/glances/GlancesPanel.jsx`. It receives dossier data as props (or fetches it independently) and renders the four cards.

Sub-components (one per card) are recommended for clarity:
- `CapitalGlance.jsx` — also computes and renders the Stocks sub-block (§3.4)
- `CycleGlance.jsx`
- `NextExpenseGlance.jsx`
- `GoalsGlance.jsx` — also receives `efStatus`/`onEfClick` and renders the Emergency Fund banner (§6.4)

`GlancesPanel` is rendered in `DossierView.jsx`, between the dossier title and the tab bar.

---

## 11. Out of Scope

- Customising which cards are shown or their order
- Glances for the Workbench section
- Notifications or push alerts based on the warning thresholds
- Server-side computation of Glances data

> Both the **Current Cycle** card and the **Next Expense** card navigate directly to the relevant `CycleEditor` page rather than to the Monthly Expenses tab. The Current Cycle card resolves to the current cycle in normal state, or to the previous cycle when the red "not closed" warning is active. Both fall back to the Monthly Expenses tab only when no specific cycle can be resolved.
