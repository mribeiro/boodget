# Capital Tracker — Emergency Fund Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, `SPECIFICATION_WORKBENCH.md`, `SPECIFICATION_GOALS.md`, and `SPECIFICATION_GLANCES.md`. Read all of them before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Emergency Fund** is a new section within each dossier, visible as a tab after Goals and before Settings.
- Before generating any files, **propose the folder structure and any schema changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Emergency Fund section allows users to track whether they have sufficient savings to cover a configurable number of months of expenses. Each dossier has exactly **one** emergency fund configuration.

The target value is derived automatically from recent expense cycles, and the current value comes from the balances of selected accounts in the most recent Capital snapshot.

-----

## 2. Configuration

Emergency fund settings are stored as **dossier-level configuration** and managed from the **Dossier Settings** tab, alongside existing settings (cycle start day, Glances thresholds).

### 2.1 Settings Fields

| Field | Description | Default | Constraint |
|---|---|---|---|
| **Months multiplier (X)** | Number of months of expenses the fund should cover | 6 | Integer, ≥ 1 |
| **Cycles to average (Y)** | Number of most recent cycles used to compute the average monthly expense | 6 | Integer, ≥ 1 |

### 2.2 UI Labels (user-facing)

| Field | UI Label |
|---|---|
| Months multiplier | Emergency fund should cover ___ months of expenses |
| Cycles to average | Calculate average expenses from the last ___ cycles |

-----

## 3. Contributing Accounts

- The user selects **one or more dossier accounts** whose current value counts toward the emergency fund balance.
- This selection is **persisted on the server** (not ephemeral).
- Accounts are selected and managed from the Emergency Fund tab via a dedicated button/dialog.
- Archived accounts that were previously selected are **automatically excluded** — only non-archived accounts contribute.
- The same account can contribute to both the emergency fund and to goals — there are no exclusivity restrictions.

-----

## 4. Extra Monthly Values

The user can define a list of **extra monthly values** that are added to the average monthly expense before applying the multiplier. These represent recurring costs not tracked through expense cycles (e.g. rent, school fees).

### 4.1 Fields

Each extra value entry has:

| Field | Description |
|---|---|
| **Name** | Free text label (e.g. "Rent", "School fees") |
| **Value** | Monthly amount (€) |

### 4.2 Rules

- Multiple extra values can be defined.
- Extra values can be added, edited, and removed at any time.
- Extra values are **persisted on the server** as part of the emergency fund configuration.
- The sum of all extra values is added to the cycle-derived average **before** applying the multiplier.

-----

## 5. Calculated Values

### 5.1 Average Monthly Expense

Computed from the **Y most recent cycles** (ordered by year/month descending). If fewer than Y cycles exist, all available cycles are used.

For each cycle, the expense total is:

- **Fixed expenses**: sum of all fixed expense **values** (regardless of paid/unpaid status).
- **Budget expenses**:
  - If the cycle is **open** (`is_closed = false`): the **maximum value** (budget cap).
  - If the cycle is **closed** (`is_closed = true`): the **spent value**.

Distributions are **not included** in this calculation.

```
cycle_expense_total = Σ fixed_expense_values + Σ budget_values_per_rules_above
```

The average is then:

```
average_monthly_expense = Σ cycle_expense_totals / number_of_cycles_considered
```

### 5.2 Effective Monthly Base

```
effective_monthly_base = average_monthly_expense + Σ extra_values
```

### 5.3 Target Value

```
target_value = X × effective_monthly_base
```

Where X is the **months multiplier** from the dossier settings.

### 5.4 Current Value

Sum of the values of the selected contributing accounts, taken from the **most recent filled Capital snapshot**. Zero if no accounts are selected or no filled snapshot exists.

### 5.5 Deficit

```
deficit = target_value − current_value
```

Only relevant when `current_value < target_value`.

### 5.6 Health Status

| Condition | Status |
|---|---|
| `current_value ≥ target_value` | **Healthy** |
| `current_value < target_value` | **Underfunded** |
| No cycles exist (cannot compute average) | **No data** |

-----

## 6. Emergency Fund Tab

### 6.1 Position

The Emergency Fund tab appears in the dossier tab bar after Goals and before Settings:

**Capital → Monthly Expenses → Workbench → Goals → Emergency Fund → Settings**

### 6.2 Content

The tab displays:

#### Summary Card

A card showing the key values:

| Field | Description |
|---|---|
| Current value | Sum of contributing account values |
| Target value | X × effective monthly base |
| Deficit / Surplus | Difference between current and target (colour-coded: green if surplus, red if deficit) |
| Progress bar | Current value relative to target value |
| Average monthly expense | Computed from cycles |
| Extra monthly total | Sum of extra values |
| Effective monthly base | Average + extras |
| Months covered | `current_value / effective_monthly_base` (rounded to 1 decimal place) |
| Multiplier (X) | As configured |
| Cycles considered | How many cycles were used in the calculation (e.g. "6 of 6" or "4 of 6") |

All calculated fields update automatically when any input changes.

#### Contributing Accounts

A section showing:
- The list of currently selected accounts (name, group, current value from last snapshot).
- A button to **select/deselect accounts** (opens a dialog listing all non-archived accounts in the dossier with checkboxes).

#### Extra Monthly Values

A section showing:
- A table of extra values (name, value, with edit and delete actions).
- A button to **add** a new extra value.

### 6.3 No Data State

When no expense cycles exist in the dossier:
- The summary card displays a message: "No expense cycles available. Open at least one cycle to calculate the emergency fund target."
- Contributing accounts and extra values remain configurable (so the user can set things up in advance).

-----

## 7. Glances Integration

### 7.1 Position

The Emergency Fund Glance card is displayed in the **first position** of the Glances panel, before Capital. The panel now shows **five cards** in this order:

1. **Emergency Fund**
2. Capital
3. Current Cycle
4. Next Expense
5. Goals

### 7.2 Visibility Rules

The Emergency Fund Glance card is shown **only when all of the following are true**:

- At least one expense cycle exists in the dossier (average can be computed).
- The emergency fund status is **Underfunded** (`current_value < target_value`).

When the fund is healthy (`current_value ≥ target_value`) or when no cycles exist, the card is **not rendered** and the panel shows four cards as before.

### 7.3 Card Content (Underfunded — red state)

When the card is visible, it always appears in the **red/danger** state:

```
EMERGENCY FUND  ⚠
€ X,XXX.XX short
Target: € XX,XXX.XX
```

- **Title**: "Emergency Fund"
- **Main value**: the deficit amount, displayed as "€ [deficit] short"
- **Subtitle**: "Target: € [target_value]"
- **Accent colour**: `--color-danger` (red)
- **Background**: `--color-danger-light`

### 7.4 Navigation

Clicking the Emergency Fund Glance card navigates to the **Emergency Fund tab** within the dossier.

-----

## 8. Schema Changes

### 8.1 Dossier Settings (`dossiers` table)

Two new columns added via migration:

| Column | Type | Default | Description |
|---|---|---|---|
| `emergency_fund_months_multiplier` | INTEGER | 6 | Number of months the fund should cover (X) |
| `emergency_fund_cycles_to_average` | INTEGER | 6 | Number of recent cycles to average (Y) |

### 8.2 Emergency Fund Accounts (new table: `emergency_fund_accounts`)

A join table linking dossiers to their contributing accounts:

| Column | Type | Description |
|---|---|---|
| `dossier_id` | TEXT | Foreign key to dossier (UUID) |
| `account_id` | TEXT | Foreign key to account (UUID) |

Composite PK `(dossier_id, account_id)`. Cascades on dossier or account delete.

### 8.3 Emergency Fund Extra Values (new table: `emergency_fund_extra_values`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key (UUID) |
| `dossier_id` | TEXT | Foreign key to dossier (UUID) |
| `name` | TEXT | Free text label |
| `value` | REAL | Monthly amount (€) |
| `position` | INTEGER | Display order |

Foreign key to dossier. Cascades on dossier delete.

-----

## 9. API Endpoints

### 9.1 Settings

The existing settings endpoints are extended:

- `GET /api/dossiers/:id/settings` — now also returns `emergency_fund_months_multiplier` and `emergency_fund_cycles_to_average`.
- `PATCH /api/dossiers/:id/settings` — now also accepts `emergency_fund_months_multiplier` and `emergency_fund_cycles_to_average`.

### 9.2 Contributing Accounts

```
GET    /api/dossiers/:id/emergency-fund/accounts
PUT    /api/dossiers/:id/emergency-fund/accounts    { account_ids: [] }
```

- `GET` returns the list of selected account IDs.
- `PUT` replaces the entire selection atomically (bulk-replace pattern). Sending an empty array clears the selection.

### 9.3 Extra Values

```
GET    /api/dossiers/:id/emergency-fund/extra-values
POST   /api/dossiers/:id/emergency-fund/extra-values          { name, value }
PATCH  /api/dossiers/:id/emergency-fund/extra-values/:itemId  { name?, value? }
DELETE /api/dossiers/:id/emergency-fund/extra-values/:itemId
```

### 9.4 Computed Status

```
GET    /api/dossiers/:id/emergency-fund/status
```

Returns all calculated values needed by the frontend:

```json
{
  "current_value": 15000.00,
  "target_value": 21600.00,
  "deficit": 6600.00,
  "average_monthly_expense": 1500.00,
  "extra_monthly_total": 300.00,
  "effective_monthly_base": 1800.00,
  "months_covered": 8.3,
  "cycles_considered": 6,
  "cycles_requested": 6,
  "status": "healthy | underfunded | no_data",
  "contributing_accounts": [
    { "account_id": "...", "group_name": "...", "name": "...", "value": 15000.00 }
  ]
}
```

The `status` field is one of: `"healthy"`, `"underfunded"`, `"no_data"`.

> **Note**: the emergency fund calculation involves aggregating data across multiple cycles. The `/status` endpoint centralises this logic on the backend to avoid the frontend needing to fetch and process all cycles.

-----

## 10. Navigation & Access

- The Emergency Fund follows the same access patterns as the rest of the dossier. All users with access to the dossier can view, configure, and modify the emergency fund.
- The sidebar navigation includes an entry for the Emergency Fund tab (positioned after Goals).

-----

## 11. Export / Import

The dossier export format must be extended to include the emergency fund configuration:

- `emergency_fund_months_multiplier` and `emergency_fund_cycles_to_average` (from dossier settings).
- `emergency_fund_accounts`: list of account **names** (for re-linking on import, same pattern as Goals).
- `emergency_fund_extra_values`: list of `{ name, value, position }` entries.

On import, accounts are re-linked by name within the dossier. Extra values are recreated as-is.

The export format version must be bumped accordingly.

-----

## 12. Out of Scope (this phase)

- Historical tracking of emergency fund health over time
- Multiple emergency funds per dossier
- Automatic recommendations for how to reach the target
- Notifications or reminders when the fund becomes underfunded
- Including distributions in the average monthly expense calculation
