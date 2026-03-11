# Goals — Specification

## Overview

The Goals feature allows users to define savings or investment targets within a dossier. Each goal has a target value and a target date. The system computes how much has already been accumulated (based on selected accounts) and how much needs to be set aside per month to reach the goal on time.

Goals are scoped per dossier and appear as a dedicated **Goals** tab in the DossierView, positioned between Workbench and Settings.

---

## Data Model

A **Goal** has:

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable label for the goal |
| `target_year` | integer | Year to reach the target |
| `target_month` | integer (1–12) | Month to reach the target |
| `target_value` | number ≥ 0 | The amount to accumulate |
| `extra_initial_amount` | number ≥ 0 | A fixed value already in the portfolio, added on top of account values |
| `monthly_amount` | number or null | If set, overrides distribution-based monthly contribution |
| `account_ids` | array of account IDs | Accounts whose latest values count toward the current accumulated value |
| `distribution_template_item_ids` | array of template item IDs | Distribution template items whose values are summed as the monthly contribution (used when `monthly_amount` is null) |

---

## Computed Values

These are derived on read (not stored):

| Field | Formula |
|---|---|
| `current_value` | Sum of each selected account's value in its latest filled month + `extra_initial_amount` |
| `monthly_contribution` | `monthly_amount` if set; otherwise sum of selected distribution template items' values |
| `months_remaining` | `(target_year − now.year) × 12 + (target_month − now.month)`, clamped to ≥ 0 |
| `monthly_required` | `(target_value − current_value) / months_remaining` (null if `months_remaining = 0`) |
| `progress_pct` | `min(100, current_value / target_value × 100)` |

If an account has no filled month entries yet, it contributes 0 to `current_value`.

---

## Monthly Contribution Modes

When creating or editing a goal, the user chooses one of two modes for the monthly contribution:

1. **Distribution mode** (default): Select one or more items from the dossier's monthly expense template where `section = 'distribution'`. The monthly contribution is the sum of their `value` fields.

2. **Manual mode**: Enter a fixed number directly. This overrides distribution-based calculation entirely.

The mode is stored implicitly: `monthly_amount = null` means distribution mode; `monthly_amount = <number>` means manual mode.

---

## UI

### Goals Tab

- Accessible via the **Goals** tab in DossierView (between Workbench and Settings).
- Displays all goals for the current dossier as cards.
- An **Add Goal** button opens the creation modal.
- If no goals exist, an empty-state message is shown with a shortcut to create the first goal.

### Goal Card

Each goal card displays:
- Goal name and target date (formatted as e.g. "June 2030")
- A **progress bar** (0–100%)
- Key figures: Current value | Target value | Monthly contribution | Monthly required

Edit and Delete actions are available on each card. Delete prompts for confirmation.

### Add / Edit Modal

Fields:
1. **Name** (text, required)
2. **Target date** — year (integer) and month (1–12) selectors
3. **Target value** (number)
4. **Extra initial amount** (number, optional, default 0)
5. **Accounts** — multi-checkbox list of all dossier accounts (including archived, marked as such); select which ones contribute to the current value
6. **Monthly contribution** — toggle between:
   - *Distributions*: multi-checkbox list of distribution template items (name + value)
   - *Manual amount*: single number input

---

## API

All routes are nested under `/api/dossiers/:id/goals` and require authentication + dossier access.

| Method | Path | Description |
|---|---|---|
| GET | `/` | List all goals (with computed fields) |
| POST | `/` | Create a goal |
| GET | `/:goalId` | Get single goal (with computed fields) |
| PATCH | `/:goalId` | Update goal; presence of `account_ids` or `distribution_template_item_ids` in body triggers a full replace of those associations |
| DELETE | `/:goalId` | Delete goal (cascades to junction tables) |

---

## Export / Import

Goals are included in the dossier export starting from **version 4**.

**Export**: Each goal is serialized with account names/group_names and distribution item names (not IDs, which are instance-specific).

**Import**: On import of a v4 export, goals are recreated by matching account (`group_name` + `name`) and distribution item names against the newly-created records. Version 1/2/3 exports are imported without goals (no change to existing import behavior).

---

## Constraints

- A goal's `(dossier_id, name)` pair has no uniqueness constraint — duplicate names are allowed.
- Deleting an account (soft-delete: sets `archived = true`) does not remove it from goal associations. The account simply stops receiving new month entries and contributes its last known value.
- Deleting a distribution template item removes it from all goal associations via cascade.
- A goal may have zero accounts and zero distributions — it will show `current_value = extra_initial_amount` and `monthly_contribution = 0`.
