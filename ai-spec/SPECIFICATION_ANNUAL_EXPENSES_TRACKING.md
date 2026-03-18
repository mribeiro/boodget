# Capital Tracker — Annual Expenses Tracking Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, `SPECIFICATION_WORKBENCH.md`, `SPECIFICATION_GOALS.md`, `SPECIFICATION_GLANCES.md`, and `SPECIFICATION_EMERGENCY_FUND.md`. Read all of them before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Annual Expenses** section is a new tab within each dossier, positioned between Monthly Expenses and Workbench.
- Before generating any files, **propose the folder structure and any schema changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Annual Expenses Tracking section allows users to manage recurring annual expenses (insurance, taxes, subscriptions) with full visibility into what has been budgeted, what has been paid, and what remains — across an entire calendar year.

Key concepts:

- The **annual expense template** (already existing) is extended to support multiple installments per expense.
- An **annual expense year** is a per-dossier, per-year instance that copies expenses from the template and tracks actual payments throughout the year.
- **Payments are recorded within expense cycles** — when a cycle's period contains the date of an annual installment, that installment appears in the cycle editor. The payment record lives in the cycle and is read by the annual tab.
- **Contributing accounts** (per dossier) track how much money is set aside for annual expenses, sourced from the most recent Capital snapshot.
- **Contributing distributions** (per dossier, "Via Distributions" pattern) track monthly contributions from expense cycles.

-----

## 2. Template Changes

### 2.1 Installments

Each annual expense template item now supports **multiple installments**. The existing `day_of_payment` and `month_of_payment` fields on the template item are replaced by a list of installment dates.

| Field | Description |
|---|---|
| `num_installments` | Number of installments (integer, ≥ 1, default 1) |
| Installment list | For each installment: `installment_number` (1-based), `month` (1–12), `day` (1–31) |

The **expected value per installment** is: `template_item.value / num_installments`.

- Expenses paid once per year have `num_installments = 1`.
- Expenses like IMI (paid in 2 or 3 installments) define 2 or 3 entries with their respective dates.

### 2.2 Migration from Existing Data

The migration must convert existing template items (which have `day_of_payment` and `month_of_payment`) into the new installments structure:

- For each existing item, create **one installment** with `installment_number = 1`, `month = month_of_payment`, `day = day_of_payment`.
- Set `num_installments = 1` on the template item.
- The old `day_of_payment` and `month_of_payment` columns on `annual_expense_template_items` are kept for backward compatibility but are no longer used by the application.

### 2.3 Template UI

The **Annual Expenses Template** editor in Dossier Settings is updated:

- Each item shows: name, annual value, classification (Must/Want), number of installments.
- Below each item (or in an expandable row), the installment dates are listed and editable: installment number, month, day.
- Changing the number of installments adjusts the list of dates accordingly (adding or removing rows).
- The expected value per installment (value / num_installments) is displayed as a read-only computed field next to each installment.

### 2.4 Template API Changes

The existing annual expense template endpoints are extended:

- `POST /api/dossiers/:id/annual-expense-template` — now also accepts `num_installments` and `installments: [{ month, day }]`.
- `PUT /api/dossiers/:id/annual-expense-template/:itemId` — now also accepts `num_installments` and `installments`.
- `POST /api/dossiers/:id/annual-expense-template/bulk-replace` — each item may include `num_installments` and `installments`.
- `GET /api/dossiers/:id/annual-expense-template` — response now includes `num_installments` and `installments` for each item.

When `installments` is provided, the entire installments list for that item is replaced atomically (delete existing + insert new).

-----

## 3. Annual Expense Year

### 3.1 Definition

An **annual expense year** is a per-dossier instance scoped to a calendar year (January–December). It holds a copy of the annual expenses from the template at the time of creation, and tracks actual payments throughout the year.

### 3.2 Creation

An annual expense year is created in one of two ways:

- **Automatically**: when a cycle is created and its period includes days in a calendar year that does not yet have an annual expense year for this dossier, one is created automatically. If the cycle spans a year boundary (e.g. December–January), annual expense years are created for both calendar years if missing.
- **Manually**: the user can create a year from the Annual Expenses tab.

On creation, all items from the current annual expense template are copied into the year, including their installments. Copied items are marked as **template-derived**.

### 3.3 Fields

| Field | Description |
|---|---|
| `year` | Calendar year (e.g. 2026) |
| `carryover` | Amount carried over from the previous year (€, editable at any time, default 0) |

### 3.4 Constraints

- A dossier can have **multiple years** (one per calendar year).
- The same year **cannot exist twice** within a dossier (UNIQUE constraint on `dossier_id, year`).
- Years are displayed in **reverse chronological order** (newest first).

### 3.5 Deletion

- A year can be **deleted** at any time. Confirmation dialog required.
- Deletion removes the year, all its items, all their installments, and **all payment records** linked to those installments (even if those payments are in cycles). The user must be warned about this.
- After deletion, cycles that previously showed those installments will no longer display them. Re-opening the year will require going back to cycles to re-mark payments.

-----

## 4. Year Items

### 4.1 Structure

Each year item is a copy of a template entry at the time the year was created:

| Field | Description |
|---|---|
| Name | Free text |
| Budgeted value | Total annual amount (€) |
| Classification | Must or Want |
| Number of installments | Integer ≥ 1 |
| From template | Boolean — whether this item was copied from the template |

Each item has a list of **installments**:

| Field | Description |
|---|---|
| Installment number | 1-based position |
| Month | Calendar month (1–12) |
| Day | Calendar day (1–31) |
| Expected value | Budgeted value / num_installments (read-only, computed) |

### 4.2 Editing

All year items can be edited at any time:

- Name, budgeted value, classification, number of installments, installment dates.
- Editing an item's installments that already have payment records: the payment records are **preserved** as long as the installment still exists. If an installment is removed (by reducing `num_installments`), its payment record is deleted.
- Ad-hoc items can be freely added, edited, and removed.

### 4.3 Ad-hoc Items

Users can add new expense items directly to an open year. These are marked as **not from template** and are visually distinguished.

### 4.4 Sync: Template → Year

A **"Sync from template"** button is available in the Annual Expenses tab.

Behaviour:
- Template-derived items are reset to current template values (name, budgeted value, classification, installments).
- **Payment records linked to template-derived items are deleted.** The user must be warned about this in the confirmation dialog.
- Template items that do not exist in the year are added.
- **Ad-hoc items are preserved unchanged**, including their payment records.

This action does not affect the template.

### 4.5 Sync: Year → Template

A **"Sync to template"** button is available.

Before proceeding, a confirmation dialog warns that the entire annual expense template will be replaced.

Behaviour:
- The entire annual expense template is replaced with the current year items (both template-derived and ad-hoc).
- Installment dates are written to the template.
- Classification is written to the template.

-----

## 5. Payments in Cycles

### 5.1 Installment–Cycle Matching

An installment matches a cycle when the full date `(year, installment.month, installment.day)` falls within the cycle's date range:

- Cycle start: `cycle_start_day` of `(cycle.year, cycle.month)`
- Cycle end: `cycle_start_day - 1` of the following month

When a cycle is **created**, the system checks all annual expense years whose calendar year overlaps with the cycle's date range. For each matching installment, a **payment record** is created automatically with:

- `real_value` = expected value (pre-filled for convenience)
- `paid` = false

### 5.2 Payment Record

Each payment record links an installment to a cycle:

| Field | Description |
|---|---|
| Installment ID | FK to the annual expense year installment |
| Cycle ID | FK to the expense cycle |
| Real value | Actual amount paid (€, editable) |
| Paid | Boolean (checkbox) |

### 5.3 Cycle Editor Integration

A new section **"Annual Expenses"** is displayed in the CycleEditor, below the existing Distributions section. It is only visible when the cycle has at least one annual payment record.

If an annual expense year is created *after* a cycle was already open, that cycle will not have had its installments linked automatically. The **"Pull annual expenses"** button in the CycleEditor header triggers `POST /dossiers/:id/cycles/:cycleId/pull-annual-expenses`, which re-runs the same payment-creation logic used at cycle creation time. The operation is idempotent (`INSERT OR IGNORE`) — running it multiple times on the same cycle never creates duplicate records.

Each row shows:
- Expense name (from the year item)
- Installment number (e.g. "2/3" for installment 2 of 3)
- Expected value (read-only)
- Real value (editable number input)
- Paid checkbox

This section is **read-only in terms of adding/removing items** — installments appear automatically based on the year data. The user can only edit the real value and toggle the paid status.

### 5.4 Impact on Cycle Balance

Annual expense payments **do not affect** the cycle's expected balance, total expenses, or any other cycle summary calculation. They are tracked separately. The money comes from the dedicated annual expenses account, not from the cycle's operational balance.

### 5.5 Cycle Deletion

When a cycle is deleted, all payment records linked to that cycle are deleted (cascade). When the cycle is re-created, the installments reappear as unpaid with the expected value pre-filled.

-----

## 6. Annual Expenses Tab

### 6.1 Position

The Annual Expenses tab appears in the dossier tab bar between Monthly Expenses and Workbench:

**Capital → Monthly Expenses → Annual Expenses → Workbench → Goals → Emergency Fund → Settings**

### 6.2 Year Selector

At the top of the tab, a year selector allows switching between years. The current year is selected by default. A button to **create a new year** (if the desired year doesn't exist) is available.

### 6.3 Year Summary Card

A summary card at the top shows:

| Field | Description |
|---|---|
| Carryover | Amount carried from previous year (editable) |
| Accumulated (accounts) | Sum of contributing account values from last Capital snapshot (already includes carryover and is net of paid expenses) |
| Contributed (distributions) | Sum of "done" distributions from cycles in this calendar year |
| Total budgeted | Sum of all year item budgeted values |
| Total paid | Sum of all real_value where paid = true |
| Total expenses remaining | Total budgeted − Total paid (amber when > 0, green when 0) |
| Amount left needed | max(0, Total expenses remaining − Accumulated accounts) — how much still needs to be raised beyond what is already on hand; green when accumulated covers remaining, amber otherwise |
| Total raise needed | max(0, Total budgeted − Carryover) — total amount to be raised over the year; subtitle shows projected annual distributions (selected distribution template values × 12), colour-coded green/amber vs. target |
| Monthly average needed | Total raise needed / 12; subtitle shows projected monthly distributions (sum of selected distribution template values), colour-coded green/amber vs. target |
| Needed this cycle | Sum of unpaid installment expected values assigned to the current cycle |

### 6.4 Year Items Detail

Below the summary, year items are **sorted by their first installment date ascending** (month × 100 + day of installment #1). Items with no installments sort last.

Each year item is displayed as a card or expandable row:

| Field | Description |
|---|---|
| Name | Expense name |
| Budgeted value | Total annual amount |
| Classification | Must / Want badge |
| Total paid | Sum of real values of paid installments |
| Difference | Total paid − Budgeted value (colour-coded: green if under budget, red if over) |

Items with a single installment render as a flat row. Items with multiple installments render as a collapsible header; the installment rows slide in with a `slideUp` entrance animation when expanded.

Each item expands to show its **installments table**:

| Installment | Date | Expected | Real | Status |
|---|---|---|---|---|
| 1/3 | May 15 | € 100,00 | € 105,00 | ✓ Paid |
| 2/3 | Sep 15 | € 100,00 | — | Not paid |
| 3/3 | Nov 15 | € 100,00 | — | Not paid |

- Paid installments show the real value and a green checkmark.
- Unpaid installments whose date has passed are highlighted as **overdue** (amber).
- Unpaid installments with a future date show as **upcoming** (neutral).
- Clicking an installment row navigates to the cycle where the payment is recorded (if a cycle exists for that period).

### 6.5 Actions

- **Edit item**: opens an inline editor or modal to change name, value, classification, installments.
- **Delete item**: removes the item and all its installments and payment records. Confirmation required.
- **Add item**: adds an ad-hoc item to the year.
- **Sync from template**: see Section 4.4.
- **Sync to template**: see Section 4.5.
- **Edit carryover**: the carryover field is directly editable in the summary card.

### 6.6 No Year State

When no year exists for the current calendar year:
- A message: "No annual expense year opened for [year]."
- A button: "Open [year]" that creates the year (copies from template).

### 6.7 No Items State

When a year exists but has no items:
- A message: "No annual expenses defined for [year]. Add expenses or sync from the template."

-----

## 7. Contributing Accounts

### 7.1 Configuration

The user selects **one or more dossier accounts** whose value counts toward the annual expenses fund. This selection is **per dossier** (not per year) — the same accounts apply to all years.

- Managed from the Annual Expenses tab via a dedicated button/dialog (same pattern as Emergency Fund).
- Archived accounts are automatically excluded.
- The current value is the sum of selected account values from the most recent filled Capital snapshot.

### 7.2 Persistence

Stored in a join table `annual_expense_accounts` (see Schema Changes).

-----

## 8. Contributing Distributions

### 8.1 Configuration

The user selects **one or more distributions** from the dossier's distribution template. This selection is **per dossier** (not per year) — the same distributions apply to all years.

- Managed from the Annual Expenses tab via a dedicated button/dialog.
- Uses the **"Via Distributions"** pattern from Goals: the system sums the values of selected distributions marked as `done` in cycles belonging to the calendar year being viewed.

### 8.2 Contribution Calculation

For a given year Y:

- Find all cycles whose period falls within year Y.
- For each cycle, sum the values of selected distributions that are marked as `done`.
- The total is the **year's contributed amount via distributions**.

### 8.3 Persistence

Stored in a join table `annual_expense_distributions` (see Schema Changes).

-----

## 9. Glances — Next Expense Card (Merged)

### 9.1 Merged Logic

The **Next Expense** Glance card now considers both:

1. **Monthly fixed expenses**: unpaid fixed expenses from the current cycle (existing logic).
2. **Annual installments**: unpaid payment records from the current cycle.

Both types are ordered by their **cycle day** (same ordering logic as monthly fixed expenses — see `SPECIFICATION_MONTHLY_EXPENSES.md`, Section 5.2). The chronologically nearest unpaid expense wins.

### 9.2 Display

When the next expense is an **annual installment**, the card shows:

```
NEXT EXPENSE
[Expense name] (installment N/M)
€ XX,XX  ·  in X days (day DD)
```

The installment indicator `(N/M)` (e.g. "2/3") distinguishes it from a monthly expense. A small badge or label "Annual" is shown to further differentiate.

When the next expense is a **monthly fixed expense**, the card shows the existing format (unchanged).

### 9.3 Overdue / All Paid States

The overdue and all-paid states now consider both monthly and annual expenses:

- **Overdue**: if the next unpaid expense (monthly or annual) has a date that has already passed in the current cycle.
- **All paid**: all monthly fixed expenses are paid **and** all annual installments in the current cycle are paid.

-----

## 10. Sidebar Navigation

The sidebar gains a new nav item for Annual Expenses, positioned between Monthly Expenses and Workbench:

| Route | Icon | Label |
|---|---|---|
| `/dossiers/:id` → Annual Expenses tab | calendar/receipt-euro | Annual Expenses |

-----

## 11. Schema Changes

### 11.1 Template Installments (new table: `annual_expense_template_installments`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key (UUID) |
| `template_item_id` | TEXT | FK to `annual_expense_template_items` |
| `installment_number` | INTEGER | 1-based position |
| `month` | INTEGER | Calendar month (1–12) |
| `day` | INTEGER | Calendar day (1–31) |

FK cascades on template item delete.

### 11.2 Template Item Changes (`annual_expense_template_items`)

| Column | Type | Default | Description |
|---|---|---|---|
| `num_installments` | INTEGER | 1 | Number of installments |

The existing `day_of_payment` and `month_of_payment` columns are preserved for backward compatibility but are no longer read by the application after migration.

### 11.3 Annual Expense Years (new table: `annual_expense_years`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key (UUID) |
| `dossier_id` | TEXT | FK to dossier |
| `year` | INTEGER | Calendar year |
| `carryover` | REAL | Carryover from previous year (default 0) |
| `created_at` | TEXT | Creation timestamp |

UNIQUE constraint on `(dossier_id, year)`. Cascades on dossier delete.

### 11.4 Annual Expense Year Items (new table: `annual_expense_year_items`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key (UUID) |
| `year_id` | TEXT | FK to `annual_expense_years` |
| `name` | TEXT | Expense name |
| `budgeted_value` | REAL | Total annual amount |
| `classification` | TEXT | `must` or `want` |
| `num_installments` | INTEGER | Number of installments |
| `from_template` | INTEGER | 1 if copied from template, 0 if ad-hoc |
| `position` | INTEGER | Display order |

Cascades on year delete.

### 11.5 Annual Expense Year Installments (new table: `annual_expense_year_installments`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key (UUID) |
| `year_item_id` | TEXT | FK to `annual_expense_year_items` |
| `installment_number` | INTEGER | 1-based position |
| `month` | INTEGER | Calendar month (1–12) |
| `day` | INTEGER | Calendar day (1–31) |

Cascades on year item delete.

### 11.6 Annual Expense Payments (new table: `annual_expense_payments`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key (UUID) |
| `installment_id` | TEXT | FK to `annual_expense_year_installments` |
| `cycle_id` | TEXT | FK to `expense_cycles` |
| `real_value` | REAL | Actual amount paid |
| `paid` | INTEGER | 0 or 1 |

UNIQUE constraint on `(installment_id, cycle_id)`. Cascades on installment delete **and** on cycle delete.

### 11.7 Contributing Accounts (new table: `annual_expense_accounts`)

| Column | Type | Description |
|---|---|---|
| `dossier_id` | TEXT | FK to dossier |
| `account_id` | TEXT | FK to account |

Composite PK `(dossier_id, account_id)`. Cascades on dossier or account delete.

### 11.8 Contributing Distributions (new table: `annual_expense_distributions`)

| Column | Type | Description |
|---|---|---|
| `dossier_id` | TEXT | FK to dossier |
| `distribution_template_id` | TEXT | FK to `expense_template_items` |

Composite PK `(dossier_id, distribution_template_id)`. Cascades on dossier or template item delete.

### 11.9 Migration

Migration ID: `019_annual_expenses_tracking` (or the next available ID if 019 is taken by another feature).

Steps:
1. Add `num_installments` column to `annual_expense_template_items` (default 1).
2. Create `annual_expense_template_installments` table.
3. Migrate existing data: for each row in `annual_expense_template_items` that has `day_of_payment` and `month_of_payment` set, create one installment row.
4. Create all new tables (sections 11.3–11.8).

-----

## 12. API Endpoints

### 12.1 Annual Expense Years

```
GET    /api/dossiers/:id/annual-years
POST   /api/dossiers/:id/annual-years              { year }
GET    /api/dossiers/:id/annual-years/:yearId
PATCH  /api/dossiers/:id/annual-years/:yearId       { carryover }
DELETE /api/dossiers/:id/annual-years/:yearId
```

- `GET` (list) returns all years for the dossier, ordered newest first, with summary values (total budgeted, total paid, total remaining).
- `POST` creates a new year, copying items and installments from the current template. Returns 409 if the year already exists.
- `GET` (detail) returns the year with all items, installments, and payment records.
- `PATCH` updates the carryover value.
- `DELETE` removes the year and all associated data (items, installments, payments). Returns confirmation of deletion.

### 12.2 Year Items

```
POST   /api/dossiers/:id/annual-years/:yearId/items              { name, budgeted_value, classification, num_installments, installments: [{ month, day }] }
PATCH  /api/dossiers/:id/annual-years/:yearId/items/:itemId      { name?, budgeted_value?, classification?, num_installments?, installments? }
DELETE /api/dossiers/:id/annual-years/:yearId/items/:itemId
```

- When `installments` is provided on PATCH, the entire installments list is replaced atomically. Payment records linked to removed installments are deleted.
- DELETE removes the item, its installments, and all linked payment records.

### 12.3 Sync Operations

```
POST   /api/dossiers/:id/annual-years/:yearId/sync-from-template
POST   /api/dossiers/:id/annual-years/:yearId/sync-to-template
```

- `sync-from-template`: resets template-derived items, adds new template items, preserves ad-hoc items. Deletes payment records for template-derived items. Returns the updated year.
- `sync-to-template`: replaces the entire annual expense template with the year's items. Returns the updated template.

### 12.4 Payments

```
PATCH  /api/dossiers/:id/annual-expense-payments/:paymentId    { real_value?, paid? }
```

Payments are created automatically when a cycle is created (see Section 5.1). This endpoint only updates existing payment records.

### 12.5 Contributing Accounts

```
GET    /api/dossiers/:id/annual-expenses/accounts
PUT    /api/dossiers/:id/annual-expenses/accounts    { account_ids: [] }
```

Same pattern as Emergency Fund accounts. `PUT` replaces the entire selection atomically.

### 12.6 Contributing Distributions

```
GET    /api/dossiers/:id/annual-expenses/distributions
PUT    /api/dossiers/:id/annual-expenses/distributions    { distribution_template_ids: [] }
```

Same pattern. `PUT` replaces the entire selection atomically.

### 12.7 Year Status

```
GET    /api/dossiers/:id/annual-years/:yearId/status
```

Returns computed values for the tab summary:

The frontend derives the following computed fields client-side (not returned by the API):
- `total_raise_needed = max(0, total_budgeted − carryover)`
- `monthly_average_needed = total_raise_needed / 12`
- `amount_left_needed = max(0, total_remaining − accumulated_accounts)`
- `monthly_dist_projected` and `annual_dist_projected` — from the loaded distribution template × selected IDs

```json
{
  "year": 2026,
  "carryover": 500.00,
  "accumulated_accounts": 2400.00,
  "contributed_distributions": 1800.00,
  "total_budgeted": 3600.00,
  "total_paid": 1200.00,
  "total_remaining": 2400.00,
  "needed_this_cycle": 300.00,
  "items": [
    {
      "id": "...",
      "name": "Car Insurance",
      "budgeted_value": 600.00,
      "classification": "must",
      "num_installments": 1,
      "total_paid": 620.00,
      "difference": 20.00,
      "installments": [
        {
          "id": "...",
          "installment_number": 1,
          "month": 3,
          "day": 15,
          "expected_value": 600.00,
          "payment": {
            "id": "...",
            "cycle_id": "...",
            "real_value": 620.00,
            "paid": true
          }
        }
      ]
    }
  ],
  "contributing_accounts": [
    { "id": "...", "name": "Annual Savings", "group_name": "Bank", "current_value": 2400.00 }
  ]
}
```

-----

## 13. Export / Import

### 13.1 Export

The dossier export format must be extended to include:

- **Template**: `num_installments` and `installments` for each annual expense template item.
- **Years**: list of annual expense years, each with items, installments, and payment records (linked by cycle year/month for re-linking on import).
- **Contributing accounts**: list of account **names** (for re-linking on import).
- **Contributing distributions**: list of distribution **names** (for re-linking on import).

### 13.2 Import

On import:

- Template installments are restored.
- Annual expense years are recreated with their items and installments.
- Payment records are re-linked to cycles by matching `(year, month)`. If the cycle does not exist on import, the payment record is skipped.
- Contributing accounts and distributions are re-linked by name.

The export format version must be bumped to **7** (or the next available version). Import continues to accept all previous versions.

-----

## 14. Workbench

The Workbench continues to use the annual expense template for monthly average calculations (`value / 12`). **No changes** to the Workbench are required. The installments structure does not affect the Workbench — it only uses the total annual value.

-----

## 15. Out of Scope (this phase)

- Automatic carryover calculation from the previous year
- Closing / archiving a year with a summary report
- Notifications or reminders for upcoming annual payments
- Multi-year comparison or trend analysis
- Splitting a single installment into sub-payments
- Linking annual expenses to Goals
