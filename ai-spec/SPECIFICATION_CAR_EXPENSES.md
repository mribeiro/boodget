# boodget — Car Expenses Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, and `SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md`. Read all three before writing any code.
- The **Car Expenses** section is a new section within each dossier, alongside Capital, Monthly Expenses, Annual Expenses, Workbench, Goals, Loans, and Subscriptions.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Car Expenses section lets users track what each car in a dossier actually costs, month by month and year by year. A dossier may have several independent cars. Each car has basic identity data (name, license plate, make, model, fuel type) and a starting mileage. Every month the user logs a snapshot — the current odometer reading and the average fuel/energy consumption and price for that month — from which the app derives that month's energy cost. Existing Monthly and Annual Expense Template items (insurance, road tax, a fuel or maintenance budget) can be "assigned" to a car so their **actual** paid/spent amounts roll into that car's cost too.

The defining design decision is that a car's monthly/yearly cost reflects **actual** spend, not the full budgeted value of its linked items — many months a budget goes unused or underused, and a budgeted total would systematically overstate the real cost. Getting the actual figure requires resolving which expense cycle represents a given calendar month, since cycles don't align to calendar-month boundaries (see §5.3).

-----

## 2. Car Definition

### 2.1 Fields

| Field | Type | Notes |
|---|---|---|
| `name` | text | Required. |
| `license_plate` | text | Optional. |
| `make` | text | Optional. |
| `model` | text | Optional. |
| `fuel_type` | enum | Required: `electric` / `hybrid` / `gas`. Drives which snapshot fields are meaningful and which energy legs are computed. |
| `initial_mileage_km` | number | Required, ≥ 0. The baseline mileage for the car's **first** snapshot; later snapshots use the previous snapshot's reading instead (§4.1). |

### 2.2 Constraints and validation

- `name` and `fuel_type` are required on create; `fuel_type` must be one of the three enum values.
- `initial_mileage_km` must be a non-negative number.
- `license_plate` / `make` / `model` are freely nullable; an empty string is normalized to `null`.
- A car is hard-deleted (`DELETE /cars/:carId`) — this cascades its snapshots and nulls the `car_id` tag on any linked expense-template items (§5.1). Cars are not archived/soft-deleted, matching Loans and Subscriptions rather than Accounts.

### 2.3 Changing `fuel_type` after creation

`fuel_type` can be changed on an existing car (e.g. a gas→hybrid retrofit) without wiping any existing snapshot data. Older snapshots simply have their now-inapplicable fields ignored by the cost computation (§4.2) — a gas car's `avg_kwh_per_100km`/`cost_per_kwh` fields, for instance, don't affect anything as a gas car, but aren't cleared, so switching back doesn't lose data either.

-----

## 3. Monthly Snapshot (`car_months`)

### 3.1 Fields, calendar-month keying, independence from cycles

Every month, the user can log a snapshot for a car:

| Field | Type | Notes |
|---|---|---|
| `year` / `month` | integer | The **calendar** month this snapshot is for. `UNIQUE(car_id, year, month)`. Independent of the dossier's expense-cycle boundaries — a snapshot is taken for a real calendar month, not a cycle period. |
| `mileage_km` | number | Required, ≥ 0. The odometer reading at the end of that month. |
| `avg_l_per_100km` | number, nullable | Average fuel consumption for the month. Meaningful for `gas`/`hybrid` cars. |
| `cost_per_l` | number, nullable | Average price per liter for the month. Meaningful for `gas`/`hybrid` cars. |
| `avg_kwh_per_100km` | number, nullable | Average electricity consumption for the month. Meaningful for `electric`/`hybrid` cars. |
| `cost_per_kwh` | number, nullable | Average price per kWh for the month. Meaningful for `electric`/`hybrid` cars. |
| `notes` | text, nullable | Free text. |

A field left unset for the car's fuel type simply isn't used — for example, a gas car's `avg_kwh_per_100km` is never read by the cost computation, whether or not it happens to be populated.

### 3.2 Immutable period; delete-and-recreate

`year`/`month` cannot be changed once a snapshot exists (`PUT` rejects a period change with `400`). Moving a snapshot's period would silently reshuffle every downstream `km_driven` baseline in the carry-forward chain (§4.1) for every later snapshot — forcing delete-and-recreate makes that consequence explicit rather than happening as a side effect of an innocuous-looking edit.

### 3.3 Carry-forward prefill (client-side, editable, non-enforced)

When starting a new snapshot, the four average/price fields are prefilled from the most recent prior snapshot as an editable suggestion — the same UX precedent as a cycle's "previous balance" prefill from the prior closed cycle's `final_real_balance`. This is done client-side: the snapshot-creation modal already has every prior snapshot in memory from the car's detail payload, so no extra round trip is needed. Mileage is never prefilled — it's the one genuinely new reading each month.

The default period offered for a new snapshot is **the month right after the car's own most recent snapshot** (continuing its natural cadence), falling back to last calendar month only when the car has no snapshots yet — not an unconditional "last calendar month." Two cars can have a different number of recorded months (one may simply have started being tracked later), so always defaulting to "last calendar month" can silently land on a period that already exists for one car but not another; when that happens, the carry-forward lookup correctly resolves the baseline for the period actually selected, but that baseline can end up being several months further back than the car's true latest reading — or, if nothing exists before that colliding period, no baseline at all — which reads as "the averages didn't carry forward" even though the underlying lookup was never wrong for the period it was actually asked about.

-----

## 4. Energy Cost Formula

### 4.1 `km_driven` and the mileage baseline chain

```
baseline = the car's most recent snapshot strictly before this one, by (year, month);
           or car.initial_mileage_km if there is no earlier snapshot
km_driven = max(0, this_snapshot.mileage_km − baseline)
```

A gap in snapshot history is fine — `km_driven` simply spans the whole gap back to the last recorded reading (or the car's initial mileage). The baseline used, and which of the two sources it came from (`previous_snapshot` / `car_initial`), is exposed on the computed result as `baseline_mileage_km` / `baseline_source`.

### 4.2 `fuel_cost` / `electric_cost` / `energy_cost` per fuel type

```
fuel_applies = fuel_type in (gas, hybrid)
elec_applies = fuel_type in (electric, hybrid)

fuel_cost     = !fuel_applies ? 0
              : (avg_l_per_100km == null || cost_per_l == null) ? null
              : (km_driven / 100) * avg_l_per_100km * cost_per_l

electric_cost = !elec_applies ? 0
              : (avg_kwh_per_100km == null || cost_per_kwh == null) ? null
              : (km_driven / 100) * avg_kwh_per_100km * cost_per_kwh

energy_cost = (fuel_cost ?? 0) + (electric_cost ?? 0)
energy_incomplete = fuel_cost === null || electric_cost === null
```

`null` means "this fuel type applies here, but the user hasn't entered the needed inputs yet" — distinct from `0`, which means "this leg doesn't apply to this car's fuel type." A hybrid car missing only one leg's inputs is still `energy_incomplete`, even though the other leg resolves to a real number.

### 4.3 Odometer regressions (clamp + `mileage_anomaly`)

If a snapshot's `mileage_km` is lower than the resolved baseline (a typo, or an odometer reset), the raw delta is clamped to `0` for `km_driven` — never negative — and `mileage_anomaly: true` is set on the result so the UI can flag it rather than silently computing a nonsense negative distance.

-----

## 5. Linked Expenses

### 5.1 The `car_id` tag — semantics and the "purely additive" guarantee

A nullable `car_id` column on `expense_template_items` (Monthly Fixed/Budget items, `section = 'expense'` only — see §5.2) and on `annual_expense_template_items` tags an item as belonging to a car. This is the entire linking mechanism — there is no separate car-specific expense system.

**The tag is purely additive.** A tagged item behaves identically everywhere else in the app — cycles, budgets, Emergency Fund, Workbench, AI Advisor's non-car sections. Tagging or untagging an item never changes any cycle balance, budget total, or Emergency Fund figure. It is a read-only lens the Car Expenses module uses to roll up a subset of already-existing data; nothing about how that data flows through the rest of the app changes.

`car_id` is set/cleared through the existing template endpoints (`PUT /expense-template/:itemId`, `PUT /annual-expense-template/:itemId`), not a dedicated endpoint — the same 3-way contract `account_id`/`distribution_template_item_id` already use elsewhere: the key absent from the request body means no change, `null` clears the tag, an id validates against this dossier's cars and sets it.

### 5.2 Distributions cannot be tagged, and why

Only `section = 'expense'` items (Fixed and Budget) and annual template items can be tagged; a `car_id` on a `section = 'distribution'` item is rejected with `400`. A distribution's only "actual" signal is a boolean `done` flag with no amount attached, so it has nothing to contribute to an actual-cost rollup.

### 5.3 Resolving a calendar month to a cycle

A cycle is **named after the month it ends in** (see the Expense Cycle key concept in `CLAUDE.md`) — so "the cycle representing calendar month M" is the cycle whose `actual_end_date` falls within M. Given a car snapshot's `(year, month)`, this is resolved by loading every cycle in the dossier once (reconstructing `actual_start_date`/`actual_end_date` from the legacy `cycle_start_day`-based formula for any row predating those columns, same fallback Loans' payment-status uses) and picking the one whose end lands in that calendar month. Two cycles can end in the same month only after a `PATCH /cycles { resolve_overlap: 'ignore' }`; the later-ending one wins, since it's the one that actually closes the month out.

If no cycle exists yet for a snapshot's calendar month, every linked item for that month is **unknown** (§5.6) — the month hasn't been budgeted at all yet, so nothing about it can be resolved.

### 5.4 Monthly items → actual amounts (Fixed / Budget)

For each car-linked `expense_template_items` row, once a cycle is resolved:

1. Find the matching `cycle_items` row via `template_item_id`.
2. If that misses, fall back to matching by `(cycle_id, section = 'expense', name)` — the same fallback Loans' payment-status uses, for the same reason: `POST /expense-template/bulk-replace` reinserts every item with fresh UUIDs, orphaning surviving `cycle_items.template_item_id` values.
3. If neither resolves, the item's amount for this month is **unknown**.
4. Otherwise: `Fixed → paid ? value : 0`; `Budget → spent ?? 0`. Both are real, known numbers — an unpaid Fixed item or a Budget item with nothing spent contributes a genuine `0`, not unknown.

### 5.5 Annual items → actual amounts (paid payments in the resolved cycle)

For each car-linked `annual_expense_template_items` row, once a cycle is resolved:

1. Resolve the item's per-year instance(s) by name and `from_template = 1` — the same matching rule `mergeYearFromTemplate` already uses to reconcile a template item with its per-year copy — across every calendar year the resolved cycle's `[start, end]` window touches (a cycle can straddle Dec/Jan).
2. Sum `annual_expense_payments.real_value` for payments whose `cycle_id` is the resolved cycle **and** `paid = 1`.
3. If nothing sums to more than `0`, that's a real `0` — "none due" (`none_due`) — not unknown, since annual items aren't expected to have an installment due every single month.

### 5.6 Unknown (`null`) vs. zero — the two rules and their asymmetry

- **No cycle for the calendar month at all** → every linked item, monthly and annual alike, is `null`/unknown. The month simply hasn't been budgeted for yet.
- **A cycle exists, but a monthly item has no matching `cycle_items` row** → unknown. A Fixed/Budget item is expected in every cycle it's tagged in, so a missing row is a genuine data gap (e.g. it was added to the car after that cycle was already created).
- **A cycle exists, and an annual item's installments simply don't land in it, or land unpaid** → a real `0`. Annual items only have installments in specific months by design, so "nothing due/paid this period" is a fact, not a gap.

`null` (unknown) is counted as `0` when summing a *total*, so a total is always renderable — but the UI must never render an unknown amount as `0,00 €`; it renders a muted `—`, and a footer note ("N item(s) pending cycle data") makes clear the total is a floor.

-----

## 6. Totals and Rollups

Per snapshot: `total_cost = energy_cost + monthly_expenses_total + annual_expenses_total`, plus `unknown_count` (how many legs — energy, monthly items, annual items — were genuinely unresolvable for that month).

The car detail payload additionally provides:
- `summary.per_year` — one rollup per calendar year with any snapshots, summing `km_driven`/`energy_cost`/`monthly_expenses_total`/`annual_expenses_total`/`total_cost`/`unknown_count` across that year's snapshots.
- `summary.ytd` — the same rollup restricted to the current calendar year.
- `summary.last_12_months` — the same rollup over an inclusive rolling 12-calendar-month window ending "now".
- `summary.avg_monthly_cost` — `last_12_months.total_cost ÷ last_12_months.snapshot_count`, or `null` if there are no snapshots in that window.

-----

## 7. Calculated Values Summary

| Field | Formula / Source |
|---|---|
| `km_driven` | `max(0, mileage_km − baseline)` (§4.1) |
| `baseline_mileage_km` / `baseline_source` | Previous snapshot's mileage, or `cars.initial_mileage_km` |
| `mileage_anomaly` | `true` if the raw (unclamped) delta was negative |
| `fuel_cost` / `electric_cost` / `energy_cost` | §4.2 |
| `energy_incomplete` | `true` if a fuel-type-applicable leg is missing its inputs |
| `cycle` | The resolved cycle (`{id, year, month, is_closed}`) for this snapshot's calendar month, or `null` |
| `monthly_expenses[]` / `monthly_expenses_total` / `monthly_expenses_unknown_count` | §5.4 |
| `annual_expenses[]` / `annual_expenses_total` | §5.5 |
| `total_cost` | `energy_cost + monthly_expenses_total + annual_expenses_total` |
| `unknown_count` | Count of unresolvable legs (§5.6) |

-----

## 8. UI Notes

- **Car Expenses tab** (`CarExpensesTab.jsx`): a `KpiStrip` (latest-month total across cars, cost this year, car count, km this month) above a clickable card list, following the Loans tab's list-page pattern. A "N pending" amber badge appears on a car's row when its latest month has `unknown_count > 0`.
- **Car detail page** (`CarDetail.jsx`, route `/dossiers/:id/cars/:carId`): follows `LoanDetail.jsx`'s layout — page-header + toolbar, a hero stats card, a two-column `CollapsibleSection` grid (latest month's cost breakdown left; linked expenses + yearly totals right), and a full-width expandable "Monthly snapshots" table below (the same `Set`-backed per-row expand idiom `AnnualExpenseTemplate.jsx` uses).
- **Unknown amounts render as a muted `—`, never as `0,00 €`** — the same rule Loans applies to `paid: null`. A footer note under the breakdown states how many items are pending cycle data.
- **Car picker on the Expense Template / Annual Expense Template tabs**: a "Car" column, hidden entirely for dossiers with zero cars, with an inline `<select>` per expense row — mirrors the existing Account picker on the Distributions table. No Car column on the Distributions table (§5.2).
- **Snapshot form** (`CarMonthFormModal.jsx`): fuel-type-conditional fields, carried-forward averages (§3.3), and a live "≈ X € this month" energy preview recomputed on every keystroke via the client-side `computeEnergyCost` in `frontend/src/utils/carMath.js` — a small deliberate duplication of the backend formula for live-preview purposes only (the linked-expense/cycle-resolution logic is server-only).

-----

## 9. Schema

### 9.1 `cars` table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `dossier_id` | TEXT | `REFERENCES dossiers(id) ON DELETE CASCADE` |
| `name` | TEXT NOT NULL | |
| `license_plate` | TEXT | Nullable |
| `make` | TEXT | Nullable |
| `model` | TEXT | Nullable |
| `fuel_type` | TEXT NOT NULL | `CHECK IN ('electric','hybrid','gas')` |
| `initial_mileage_km` | REAL NOT NULL DEFAULT 0 | |
| `created_at` | TEXT | |

### 9.2 `car_months` table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `car_id` | TEXT | `REFERENCES cars(id) ON DELETE CASCADE` |
| `year` / `month` | INTEGER NOT NULL | `UNIQUE(car_id, year, month)` |
| `mileage_km` | REAL NOT NULL | |
| `avg_l_per_100km` / `avg_kwh_per_100km` | REAL | Nullable |
| `cost_per_l` / `cost_per_kwh` | REAL | Nullable |
| `notes` | TEXT | Nullable |
| `created_at` | TEXT | |

### 9.3 `car_id` on the template tables

`expense_template_items.car_id` and `annual_expense_template_items.car_id` — both `TEXT REFERENCES cars(id) ON DELETE SET NULL`, nullable.

-----

## 10. API Contract

```
GET    /api/dossiers/:id/cars
POST   /api/dossiers/:id/cars              { name, license_plate?, make?, model?, fuel_type, initial_mileage_km }
GET    /api/dossiers/:id/cars/:carId
PUT    /api/dossiers/:id/cars/:carId
DELETE /api/dossiers/:id/cars/:carId

POST   /api/dossiers/:id/cars/:carId/months     { year, month, mileage_km, avg_l_per_100km?, avg_kwh_per_100km?, cost_per_l?, cost_per_kwh?, notes? }
                                                # 400 if (car_id, year, month) already exists
PUT    /api/dossiers/:id/cars/:carId/months/:carMonthId   # year/month immutable — 400 if changed
DELETE /api/dossiers/:id/cars/:carId/months/:carMonthId
```

`car_id` is additionally accepted on the existing `POST`/`PUT /expense-template[/:itemId]` and `POST`/`PUT /annual-expense-template[/:itemId]` endpoints (§5.1) — no new endpoints for tagging.

`GET /cars/:carId` returns the car row, every snapshot (each merged with its computed values, newest first), a `summary` block (§6), and `linked_monthly_items[]`/`linked_annual_items[]`.

-----

## 11. Export / Import

Export version **16** (bumped from 15). A new `cars[]` array, each entry carrying a nested `months[]` array (matching the `goals[].historical_contributions` nesting convention — no cross-reference key needed between the two). `expense_template[]` and `annual_expense_template[]` entries gain a `car_name` field (`null` when untagged), round-tripped by name on import exactly like `linked_expense_name`/`distribution_name`. Cars are imported before the template loops so `car_name` can be resolved. Import accepts versions 1–16; versions ≤ 15 import with zero cars and every `car_id` `null`.

`car_id` survives a `POST /expense-template/bulk-replace` / `POST /annual-expense-template/bulk-replace` via the same capture-by-name-then-relink mechanism already used there for loans/subscriptions/goal_distributions — tags on renamed or dropped items are lost, same semantics as those other links.

-----

## 12. AI Advisor Integration

`buildDossierContext` in `backend/src/routes/ai-advisor.js` includes a `cars` array, one entry per car: `name`, `fuel_type`, `latest_mileage_km`, `latest_month` (period, km_driven, energy_cost, monthly_expenses_total, annual_expenses_total, total_cost, unknown_count), `ytd_total_cost`, `avg_monthly_cost_12m`, `linked_expense_items` (names only), and `monthly_series` (last 12 months, oldest first, `{period, km_driven, total_cost}`). Raw snapshot averages/prices and the per-item cost breakdown are deliberately omitted — the model can't act on a €/liter price, and the linked item names/amounts already appear via `expense_template`/`annual_expense_template`/`recent_cycles`. All three prompt intros (`ANALYSIS_SYSTEM_INTRO`, `CHAT_SYSTEM_INTRO`, `EXPORT_PROMPT_INTRO`) note that a car's `total_cost` is actual, not budgeted, and that `unknown_count > 0` means that month's total is a floor rather than a final figure.

-----

## 13. Known Limitations (out of scope for fixing here)

- No per-fill-up logging — averages are entered once per month, not derived from individual receipts.
- No depreciation or resale-value tracking.
- No maintenance scheduling/reminders.
- The cycle-window-loading idiom (§5.3) is duplicated a third time here, alongside Loans' payment-status and Annual Expenses' payment-to-cycle linkage — each module carries its own copy rather than sharing a helper. Tracked as a follow-up tech-debt item.
