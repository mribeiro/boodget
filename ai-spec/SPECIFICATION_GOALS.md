# boodget — Goals Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, and `SPECIFICATION_WORKBENCH.md`. Read all four before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Goals** section is a new section within each dossier, alongside Capital, Monthly Expenses, and Workbench.
- Before generating any files, **propose the folder structure and any schema changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Goals section allows users to define financial objectives with a target value and a target date, and track progress towards them over time. Each goal is scoped to a dossier.

-----

## 2. Goal Definition

### 2.1 Fields

When creating or editing a goal, the user provides:

|Field                          |Description                                                                                                                                                                                                                                                                                                                               |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Name**                       |Free text label for the goal                                                                                                                                                                                                                                                                                                              |
|**Target date**                |The month/year by which the goal should be achieved                                                                                                                                                                                                                                                                                       |
|**Target value**               |The monetary amount to be reached (€)                                                                                                                                                                                                                                                                                                     |
|**Contributing accounts**      |Optional. One or more dossier accounts whose current value counts toward progress. A goal may exist without any associated accounts (e.g. cash savings).                                                                                                                                                                                  |
|**Extra value already in hand**|Optional. A one-off monetary amount already included in the selected accounts’ balance (e.g. an exceptional cash injection). Used purely for projection purposes — it is **not added** to the current accumulated value, as it is already reflected in the account balance. Requires selecting an extra value impact mode (see Section 4).|
|**Extra value impact mode**    |How the extra value affects the projection. One of two mutually exclusive modes (see Section 4).                                                                                                                                                                                                                                          |
|**Monthly contribution mode**  |One of two mutually exclusive modes (see Section 3)                                                                                                                                                                                                                                                                                       |

### 2.2 Constraints

- A dossier can have **multiple goals**.
- The same account or distribution can contribute to multiple goals simultaneously — there are no exclusivity restrictions.
- Goals can be **edited at any time**, regardless of their state.
- Goals can be **deleted**.

-----

## 3. Monthly Contribution Modes

The user must choose one of three mutually exclusive modes to define the expected monthly contribution to the goal:

### Via Distributions

- The user selects one or more distributions from the **dossier’s distributions template**.
- The **expected monthly contribution** is the sum of the values of the selected distributions.
- The **real monthly contribution** is derived automatically: for each cycle (open or closed), the system sums the values of the selected distributions that are marked as **done**.

### Manual

- The user defines a **fixed monthly value** (€) representing the intended monthly contribution.
- The **expected monthly contribution** is this fixed value.
- The **real monthly contribution** must be **entered manually by the user per cycle**.

### Ad-hoc

- No monthly contribution is configured.
- Progress is tracked purely through the value of the selected contributing accounts, read from the most recent Capital snapshot.
- No feasibility warning is shown for goals in this mode.
- No month-by-month chart is shown — only the progress bar and key values.

-----

## 4. Extra Value Impact Modes

When an **extra value already in hand** is provided, it represents a one-off injection already present in the account balance. It is used **only for projection purposes** — to distinguish exceptional funds from regular monthly savings — and must not be counted again in the current progress. The user must choose how it affects the projection:

### Reduce Monthly Amount

- The target date is kept fixed.
- The extra value is subtracted from the remaining amount before computing the required monthly contribution.
- Effect: the **monthly value needed** decreases.

### Anticipate End Date

- The expected monthly contribution is kept fixed.
- The extra value reduces the number of months needed to reach the target.
- Effect: the **projected completion date** is brought forward relative to the original target date.
- The anticipated completion date is displayed alongside the original target date.

> If no extra value is provided, this field has no effect and does not need to be set.

> **Note:** an anticipated completion date is also shown independently of any extra value — see **Anticipated completion date** in Section 5 — whenever the expected monthly contribution alone outpaces the monthly value needed.

-----

## 5. Calculated Values

The following values are computed and displayed for each goal:

|Field                            |Calculation                                                                                                                                                                                                              |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Current accumulated value**    |Sum of the values of the selected accounts, taken from the **most recent filled Capital snapshot**. Zero if no accounts are selected.                                                                                    |
|**Total current progress**       |Same as current accumulated value. The extra value is already included in the account balance and is not added again.                                                                                                    |
|**Remaining amount**             |max(0, Target value − Total current progress) — floored at 0 once progress reaches or overshoots the target                                                                                                             |
|**Months remaining**             |Number of months from today to the target date                                                                                                                                                                           |
|**Monthly value needed**         |max(0, Remaining amount ÷ Months remaining), adjusted by extra value if “Reduce Monthly Amount” is selected                                                                                                              |
|**Expected monthly contribution**|Sum of selected distribution template values (“Via Distributions”) or fixed manual value (“Manual”)                                                                                                                      |
|**Anticipated completion date**  |Not applicable for “Ad-hoc” mode. Months needed = ceil((Remaining amount − Extra value) ÷ Expected monthly contribution) — Extra value is only subtracted when impact mode “Anticipate End Date” is selected, otherwise 0. Displayed (today + months needed) only when this is strictly earlier than the target date, i.e. the goal is on pace to finish early — whether from “Anticipate End Date” or simply because the expected monthly contribution outpaces the monthly value needed.|
|**Feasibility**                  |Whether the goal is achievable given the current contribution. A goal is **infeasible** if: (Expected monthly contribution × Months remaining) + Total current progress < Target value. Not applicable for “Ad-hoc” mode.|


> All calculated fields must update automatically whenever any input changes.

-----

## 6. States

A goal is always in one of three states:

|State        |Condition                                                             |
|-------------|----------------------------------------------------------------------|
|**Active**   |Default state; goal is in progress                                    |
|**Completed**|Total current progress ≥ Target value                                 |
|**Failed**   |Target date has been reached and Total current progress < Target value|

### State Transitions

- The system evaluates state **automatically** based on the conditions above.
- If a goal is in state **Completed** or **Failed** and the user edits any field, the state **automatically returns to Active** and is **immediately re-evaluated**. If the conditions for Completed or Failed still apply after the edit, the state transitions back accordingly.
- The user cannot manually set the state.

-----

## 7. Progress Tracking

### 7.1 Per-Cycle Real Contribution

Each cycle contributes a real contribution value to the goal:

- **”Via Distributions”:** sum of the values of selected distributions marked as `done` in that cycle, regardless of whether the cycle is open or closed. Matched by `template_item_id` FK when available, falling back to name matching for items copied before template linkage was enforced.
- **”Manual”:** the user manually enters the real contribution value for each cycle. This is done from the **goal detail page**, which lists all cycles and allows entering a value per cycle.
- **”Ad-hoc”:** no per-cycle tracking. Progress is determined solely by the current value of the selected accounts in the most recent Capital snapshot.

### 7.2 Historical Contributions

For goals in **”Via Distributions”** or **”Manual”** modes, users may enter pre-cycle contributions covering months before any expense cycles existed in the dossier (or before the goal was created). These are stored as `goal_historical_contributions` rows (year, month, amount) and managed via a bulk-replace operation from the goal detail page.

In the chart, historical contributions are prepended before the first cycle data point, accumulated into the `real_cumulative` line. If a historical month overlaps with an existing cycle month, the cycle data takes precedence.

### 7.3 Cumulative Tracking

The system maintains a cumulative view of:

- **Expected cumulative**: sum of expected monthly contributions per cycle across **all of the dossier's cycles** (not limited to cycles on/after the goal's creation date — the underlying distributions are dossier-wide and may predate the goal object itself).
- **Real cumulative**: sum of historical contributions (pre-cycle) followed by real contributions per cycle, across that same full cycle range.

Historical contribution points carry `is_historical: true` in the chart data and have no `expected_cumulative` value (since no cycle existed yet).

Both cumulative series are then **shifted by a constant offset** (`current_accumulated_value` minus the last tracked `real_cumulative` value) so that the most recent point always lands exactly on the goal's true current balance — see Section 8.3. This means earlier points are an approximation (real accounts also earn interest or receive deposits the tracked "done" distributions don't capture), but the join into the Projected line is always exact.

-----

## 8. Visualisation

Each goal displays:

### 8.1 Progress Bar + Key Values

A visual progress bar showing **Total current progress** relative to the **Target value**, accompanied by the following key values:

- Target value
- Total current progress
- Remaining amount
- Monthly value needed
- Expected monthly contribution
- Target date

### 8.2 Month-by-Month Chart

Only shown for **“Via Distributions”** and **“Manual”** modes. Not shown for **“Ad-hoc”** mode.

A line chart showing, per cycle:

- **Expected cumulative** contribution (projected line)
- **Real cumulative** contribution (actual line)

The chart allows the user to visually compare actual progress against the original projection. See Section 7.3 for how these two lines are computed across the dossier's full cycle history and anchored to the goal's true current balance.

### 8.3 Future Trend Line

When the goal has at least one linked account (so a current value is known) and the target date has not yet passed, the chart also shows a **Projected** line (`projected_cumulative`, dashed) extending from the current month to the target date. It starts at the current accumulated value (`current_accumulated_value`) and increases by the expected monthly contribution for each month until the target date, showing where the goal balance is trending towards. If no cycle/historical data points exist yet, a single anchor point for the current month is added so the projected line has a starting point. Because Real cumulative (Section 7.3) is anchored to end at this same `current_accumulated_value`, the Projected line is always a seamless continuation of Real rather than a disconnected jump.

### 8.4 Anticipated Completion Milestone

Whenever `anticipated_completion_date` is set (i.e. whenever the "Estimated done" key value from Section 5 is shown — the goal is on pace to finish before its target date), the chart also renders a vertical milestone marker at that month: a dashed reference line labelled "Estimated", styled with a neutral color (distinct from the Expected/Real/Projected line colors) so it reads as an annotation rather than a fourth data series. Not shown for "Ad-hoc" mode (which has no chart) or when the goal is not ahead of pace.

-----

## 9. UI Notes

- Goals is a **dedicated section within the dossier**, visible alongside Capital, Monthly Expenses, and Workbench, following the same navigation and access patterns.
- The section shows a **list of all goals** for the dossier, with their name, state, target date, and a summary of current progress.
- Clicking a goal opens its **detail view**, showing all fields, calculated values, progress bar, and chart.
- If a goal is **infeasible** (the expected monthly contribution is insufficient to reach the target value by the target date), a **prominent warning** must be displayed — both in the goal list and in the goal detail view. The warning should indicate that the goal cannot be reached with the current settings.
- Goals in state **Completed**, **Failed**, or marked as **infeasible** should be visually distinct from Active goals (e.g. different colour or badge).
- All users with access to the dossier can create, view, edit, and delete goals (same permission model as the rest of the dossier).

-----

## 10. Schema Changes

The following new data must be persisted:

### 10.1 Goals table

|Field                    |Type                                                            |Description                                                        |
|-------------------------|----------------------------------------------------------------|-------------------------------------------------------------------|
|`id`                     |integer                                                         |Primary key                                                        |
|`dossier_id`             |integer                                                         |Foreign key to dossier                                             |
|`name`                   |text                                                            |Goal name                                                          |
|`target_value`           |decimal                                                         |Target monetary amount                                             |
|`target_date`            |date                                                            |Target month/year                                                  |
|`extra_value`            |decimal (nullable)                                              |Extra value already in hand                                        |
|`extra_value_impact_mode`|enum: `reduce_monthly_amount` / `anticipate_end_date` (nullable)|How extra value affects projection (required if extra_value is set)|
|`contribution_mode`      |enum: `via_distributions` / `manual` / `ad_hoc`                 |Monthly contribution mode                                          |
|`manual_monthly_value`   |decimal (nullable)                                              |Fixed monthly value (“Manual” mode only)                           |
|`created_at`             |datetime                                                        |Creation timestamp                                                 |

### 10.2 Goal–Account associations

A join table linking goals to their contributing accounts:

|Field       |Type   |Description           |
|------------|-------|----------------------|
|`goal_id`   |integer|Foreign key to goal   |
|`account_id`|integer|Foreign key to account|

### 10.3 Goal–Distribution associations (“Via Distributions” mode only)

A join table linking goals to their selected distributions from the template:

|Field                     |Type   |Description                               |
|--------------------------|-------|------------------------------------------|
|`goal_id`                 |integer|Foreign key to goal                       |
|`distribution_template_id`|integer|Foreign key to distribution template entry|

### 10.4 Goal cycle contributions (“Manual” mode only)

A table to store manually entered real contributions per cycle:

|Field              |Type   |Description                                      |
|-------------------|-------|-------------------------------------------------|
|`goal_id`          |text   |Foreign key to goal (UUID)                       |
|`cycle_id`         |text   |Foreign key to cycle (UUID)                      |
|`real_contribution`|decimal|Manually entered real contribution for this cycle|

Composite PK `(goal_id, cycle_id)`. Upserted on write. Cascades on goal or cycle delete.

### 10.5 Goal historical contributions

A table to store pre-cycle monthly contribution amounts for the cumulative chart:

|Field   |Type   |Description                                    |
|--------|-------|-----------------------------------------------|
|`goal_id`|text  |Foreign key to goal (UUID)                     |
|`year`  |integer|Year of the contribution                       |
|`month` |integer|Month of the contribution (1–12)               |
|`amount`|decimal|Contribution amount for that month             |

Composite PK `(goal_id, year, month)`. Managed via the bulk-replace endpoint — the entire set is replaced atomically on save. Cascades on goal delete. Only applicable to “Via Distributions” and “Manual” contribution modes.

> **Note on IDs**: all PKs in this feature use UUIDs (TEXT), consistent with the rest of the codebase.

-----

## 11. Out of Scope (this phase)

- Notifications or reminders for upcoming goal deadlines
- Multiple contribution modes active simultaneously on the same goal
- Goal templates or duplication
- Comparison between goals