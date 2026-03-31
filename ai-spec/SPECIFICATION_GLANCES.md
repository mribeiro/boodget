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
- There are always **four cards**, in this fixed order:
  1. Capital
  2. Current Cycle
  3. Next Expense
  4. Goals
- Each card is **clickable** and navigates the user to the relevant section:
  - Capital card → Capital tab
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

Shows:
- **Total capital** — sum of all account values from the most recent filled snapshot, formatted as currency (€).
- **Variation** — percentage change relative to the previous filled snapshot (e.g. `↑ +2.4% vs. Feb`). Colour: green if positive, red if negative, neutral if zero or no previous snapshot exists.
- **Idle money subtitle** — if any accounts are flagged as `is_idle_money`, show the sum of their values (e.g. `€12 000 in idle`).

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

---

## 4. Card 2 — Current Cycle

### 4.1 Determining the current cycle

The current cycle is the one whose date range covers today, computed using the dossier's `cycle_start_day`:

- A cycle for month M covers from `cycle_start_day` of M-1 to `cycle_start_day - 1` of M.
- Example: `cycle_start_day = 25`, today = 14 March → current cycle = March cycle (25 Feb → 24 Mar).

### 4.2 Normal state (neutral)

Condition: a cycle exists for the current period and no warning thresholds are triggered.

Shows:
- **Title**: "Cycle of [Month Year]" (e.g. "Cycle of March 2025")
- **Current expected balance**: `Total available − paid fixed expenses − spent budget amounts − done distributions`
- **Expected leftover**: the `Expected balance` field already computed on the cycle (`Total available − all fixed expense values − all budget maximum values − all distribution values`)

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
- **Value** (€)
- **When**: days until payment with the calendar date (e.g. "in 3 days (Mar 10)"). If the payment day is today: "Today (Mar N)". If the payment day has already passed in the current cycle but the expense is still unpaid: "Overdue (Mar N)" — card turns amber.
- **Mark as paid button**: when the expense is overdue, a "Mark as paid" shortcut button appears on the card. Clicking it marks the item as paid in place (via `PATCH /cycles/:cycleId/items/:itemId` for monthly items, or `PATCH /annual-expense-payments/:paymentId` for annual items) and refreshes the card immediately — without navigating away.

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

### 6.2 Alert state (red)

Condition: one or more goals are in state `failed`.

Shows:
- Title: "Goals"
- Count of active goals
- Count of failed goals with a warning indicator (e.g. "2 failed ⚠")

### 6.3 Empty state (neutral)

Condition: no goals exist for the dossier.

Shows:
- Title: "Goals"
- Message: "No goals defined"

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
- `CapitalGlance.jsx`
- `CycleGlance.jsx`
- `NextExpenseGlance.jsx`
- `GoalsGlance.jsx`

`GlancesPanel` is rendered in `DossierView.jsx`, between the dossier title and the tab bar.

---

## 11. Out of Scope

- Customising which cards are shown or their order
- Glances for the Workbench section
- Notifications or push alerts based on the warning thresholds
- Server-side computation of Glances data

> Both the **Current Cycle** card and the **Next Expense** card navigate directly to the relevant `CycleEditor` page rather than to the Monthly Expenses tab. The Current Cycle card resolves to the current cycle in normal state, or to the previous cycle when the red "not closed" warning is active. Both fall back to the Monthly Expenses tab only when no specific cycle can be resolved.
