# boodget — Loans Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, and `SPECIFICATION_GOALS.md`. Read all three before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Loans** section is a new section within each dossier, alongside Capital, Monthly Expenses, Workbench, and Goals.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Loans section lets users configure loans per dossier. Each loan is either a **draft** (a study/what-if scenario) or an **active** loan (a real, ongoing one being tracked). Both compute a monthly payment via the standard annuity formula and show what percentage of a stored salary that payment represents. Active loans can optionally be linked to a Fixed monthly-expense template item to check whether the budgeted value covers the payment. Both statuses offer the same three ephemeral scenario calculators (downpayment, target payment, interest rate change) — a draft you're still studying is just as worth fine-tuning as a loan you've already signed.

-----

## 2. Loan Definition

### 2.1 Fields (common to both statuses)

| Field | Description |
|---|---|
| **Name** | Free text label for the loan |
| **Status** | `draft` or `active` — see Section 3 |
| **Interest rate** | Annual nominal percentage (e.g. `3.5` = 3.5%), 0–100. Always the **TAN** (nominal rate) — the rate that actually drives the amortization formula, labeled "TAN" on draft loans and "Interest rate" on active loans. Never the TAEG/APR, which is a separate, higher, fees-inclusive figure — see the `taeg` field below |
| **Salary** | Per-loan editable value. Prefilled from the dossier's manually-set **reference salary** setting when creating a loan (Section 6.1) — never derived from a cycle; can be changed at any time and does not follow the setting afterward |

### 2.2 Draft-only fields

| Field | Description |
|---|---|
| **Principal** | Amount financed (must be > 0). Used directly in the amortization formula — unaffected by whether it was typed directly or derived from a purchase-price breakdown |
| **Term (months)** | Total loan length (integer ≥ 1) |
| **Down payment** | Optional. When set, the loan also exposes a computed **Purchase price** (`principal + down_payment`) for display. Only **settable** while `status = 'draft'` (400 if the client attempts to set it on an active loan) — but once set, it's **never cleared** on promotion to active; it survives as a read-only historical record of how the loan was originated |
| **TAEG** | Optional, reference-only. The marketing/legal APR figure (includes fees) as disclosed on the loan offer — stored purely for comparison against the TAN, **never used in any calculation**. Same settable-only-while-draft-but-persists rules as Down payment |
| **Opening fee** | Optional. A one-off processing/opening commission (e.g. a bank's "comissão de abertura de contrato"), added into the computed **Total amount payable** (Section 8). Same settable-only-while-draft-but-persists rules as Down payment |

### 2.3 Active-only fields

| Field | Description |
|---|---|
| **Remaining balance** | Amount owing **as of `balance_as_of`** (must be > 0). Not a live figure — the live one is the computed `current_balance` (Section 4.3) |
| **Balance as of** | Optional `YYYY-MM`. The month whose payment is the next one still owed on `remaining_balance`. Auto-set on every active write when absent, and re-set whenever `remaining_balance` changes (Section 4.3). `NULL` falls back to pre-anchoring behaviour |
| **End date** | Required. The calendar month (`YYYY-MM`) the loan finishes. **Months left is never entered directly** — it's computed fresh on every read from `end_date` vs. the current date, so the user never has to update it month by month. Must resolve to at least 1 month remaining (i.e. the current month or later) |
| **Day of payment** | Required. The day of the month (1–31) the payment is due. Drives whether the *current* calendar month still counts as owed in `months_left` (Section 4.1) — once this day has passed, this month's payment is treated as already made |
| **Linked expense** | Optional. A Fixed expense template item in the same dossier, used both to check budget coverage (Section 5) and to track payments (Section 5.2) |

### 2.4 Constraints

- A dossier can have multiple loans, in either status, simultaneously.
- Draft loans **cannot** be linked to an expense template item — the link field is only meaningful once a loan is active.
- Loans can be edited and deleted at any time.
- Down payment is **settable only while draft**: an active loan's `remaining_balance` is already net of any down payment made, so there's nothing new to model there once it's real. The create/edit form lets the user enter a **Purchase price** and **Down payment** instead of typing Principal directly; Principal is then derived as `purchase_price − down_payment` and that's what feeds the amortization formula. Leaving Purchase price blank falls back to typing Principal directly, with no down payment stored. Once set, the value is **preserved indefinitely** across status changes — promoting to active does not erase it, since it's a fact about how the loan was originated, not something that stops being true.
- TAEG and Opening fee follow the same settable-only-while-draft-but-persists rule as Down payment: they describe the terms of a loan being studied before signing. TAEG is purely for the user's own reference (e.g. to note the number a lender advertises) and is never read by the amortization formula — only the TAN (the `interest_rate` field) drives `monthly_payment`. Opening fee feeds `total_amount_payable` (Section 8) only.
- `principal` and `term_months` themselves are likewise never cleared when a loan is promoted to active — they remain in the database as a record of the loan's original terms, which is what lets `purchase_price`/`total_interest`/`total_amount_payable` (Section 8) keep working after promotion.
- `balance_as_of` is **active-only** and follows `end_date`'s rules: setting it while `status = 'draft'` is a 400, and it's forced to `NULL` on demotion. It must be the same month as `end_date` or earlier (i.e. `term_from_anchor ≥ 1`), else 400. It is deliberately **not required**: demanding it would 400 `PromoteLoanModal`'s minimal `PUT` and every pre-v15 import, for no gain given the `NULL` fallback reproduces the old behaviour exactly. Instead, writes auto-anchor (Section 4.3).
- An anchor in the *future* is allowed — it means "this is what I'll owe from that month on", and `payments_made` clamps to 0 until then.
- End date and day of payment are both **active-only**, the mirror image of the draft-only fields: draft loans study a fixed `term_months`, while an active loan tracks a real calendar deadline and a real monthly due date. Setting either while `status = 'draft'` is rejected with a 400; both are forced to `NULL` on demotion to draft.

-----

## 3. Status: Draft vs Active

| Status | Meaning | Payment computed from |
|---|---|---|
| **Draft** | A study/what-if — not a real ongoing loan | `principal`, `interest_rate`, `term_months` |
| **Active** | A real ongoing loan being tracked | `remaining_balance`, `interest_rate`, `months_left` (computed from `end_date` and `day_of_payment`, Section 4.1) |

### 3.1 Status Transitions

- Status can be toggled **both ways** (draft → active, active → draft) at any time via the edit form's status radio toggle.
- Toggling **preserves all field values** on both sides — switching to draft doesn't erase `remaining_balance`/`end_date`, and switching to active doesn't erase `principal`/`term_months`. Only the fields relevant to the *new* status are validated as required.
- Demoting **active → draft** always clears the expense link (`expense_template_item_id` forced to `NULL`), the end date (`end_date` forced to `NULL`), and the day of payment (`day_of_payment` forced to `NULL`), since none is meaningful for a draft. There is **no dedicated "Demote" button** — demoting only happens via `LoanFormModal`'s status toggle, same as any other field edit.
- Promoting **draft → active** does **not** clear `principal`, `term_months`, `down_payment`, `taeg`, or `opening_fee` — they describe how the loan was originated and remain on record as history once it's real, surfaced read-only in `LoanDetail` and `LoanFormModal` (Section 9). They can still only be explicitly *set* via the API while `status = 'draft'` (400 otherwise); a `PUT` that flips status without touching them just carries the existing values forward unchanged.
- Promoting has its own dedicated **"Promote" button**, shown in `LoanDetail`'s toolbar only for draft loans (alongside Edit/Delete), which opens `PromoteLoanModal` — a focused dialog that asks only for the fields a draft doesn't have (`remaining_balance`, `day_of_payment`, and `end_date`), rather than the full edit form. See Section 9 for the UI details.

-----

## 4. Amortization Formula

Standard annuity formula, applied identically whether the loan is a draft or active:

```
r = (annual_interest_rate_pct / 100) / 12
payment = P · r / (1 − (1 + r)^−n)         when r > 0
payment = P / n                             when r = 0
```

Where `P` is `principal` (draft) or `remaining_balance` (active), and `n` is `term_months` (draft) or **`term_from_anchor`** (active — the span from `balance_as_of` to `end_date`, Section 4.3). An active loan's `n` was originally `months_left`, which is re-derived on every read and therefore shrinks each month while the stored balance stayed put — so the payment climbed month after month and only stayed honest if the user re-entered the outstanding balance by hand. Anchoring the balance removes the time dependency from the payment entirely: on a real annuity loan the payment is fixed and the balance is what falls. A loan with no anchor (`balance_as_of IS NULL`) still uses `months_left`, preserving the old behaviour exactly.

This is computed server-side on every read/write (never persisted as a stored column) so it always reflects the latest inputs. The frontend duplicates the same formula in `frontend/src/utils/loanMath.js` for live, per-keystroke previews in the form — the server remains the source of truth for anything actually saved or displayed outside the form.

### 4.1 Months Left (active loans, derived from `end_date` and `day_of_payment`)

`months_left` is never entered or stored — it's derived fresh on every read from the loan's `end_date` (`YYYY-MM`), `day_of_payment` (1–31), and the current date, so the user is never asked to update it as the loan progresses. "Current date" is read in UTC (`computeMonthsLeft` in `backend/src/routes/loans.js`), not the server's OS-local timezone, so the `day_of_payment` cutoff doesn't shift with where the server happens to be deployed.

The current calendar month only counts as still-owed if `day_of_payment` **hasn't passed yet** this month — once it has, that month's payment is treated as already made, and counting starts from the following month instead. Concretely: today the 15th, a loan with `day_of_payment = 5` has already had this month's payment made (`15 ≥ 5`), so this month is excluded; a loan with `day_of_payment = 20` hasn't (`15 < 20`), so it's still included. `day_of_payment` is clamped to the current month's actual length before comparing (`min(day_of_payment, days_in_current_month)`), so e.g. `31` correctly means "the last day" in a 30-day month or February.

```
effective_month = current_month, unless today ≥ min(day_of_payment, days_in(current_month)),
                   in which case effective_month = current_month + 1 (rolling into next year if needed)
months_left = (end_year × 12 + end_month) − (effective_year × 12 + effective_month) + 1
months_left = max(0, months_left)
```

The `+ 1` makes the end month itself inclusive — an `end_date` equal to the effective month means 1 payment remains (that month's, the last one). `end_date` must resolve to `months_left ≥ 1` at write time given the loan's own `day_of_payment` (400 otherwise); a loan that has already matured should be demoted, deleted, or given a corrected end date rather than left with a months-left of 0.

Because `months_left` is derived fresh on every read rather than stored, this ≥ 1 check only runs at write time — an active loan left untouched past its `end_date` will drift to `months_left = 0` on its own with no re-validation. `computeLoanValues` flags this as `is_matured` (`status === 'active' && months_left <= 0`) and nulls out `remaining_interest` instead of letting it evaluate to `monthly_payment (0) × 0 − remaining_balance`, a large negative number that would otherwise reach the UI unexplained. `monthly_payment` itself still computes to `0` in this state (the existing `computeMonthlyPayment` guard). See Section 9 for how the UI surfaces this.

Implemented identically in `computeMonthsLeft()` in both `backend/src/routes/loans.js` (source of truth for `monthly_payment` and everywhere else `months_left` is read) and `frontend/src/utils/loanMath.js` (live preview in the form as the user picks a month/year/day). Both share the same internal "effective current period" helper (`effectiveCurrentPeriod()` on the frontend) so `computeMonthsLeft`, `endDateFromMonthsLeft`, and the amortization schedule (Section 4.2) all agree on which month is the first still-owed one.

### 4.2 Payment Plan (active loans only)

Walks the fixed monthly payment forward from the **anchored** `remaining_balance`, splitting each payment into its interest and principal portions — the actual month-by-month payoff plan, not a total. Because it starts at `balance_as_of` rather than at the first still-owed month, it covers the months already paid as well as the ones still owed, which is what makes it a *record* rather than only a projection.

Still computed **entirely client-side** in `frontend/src/utils/loanMath.js`: it's a deterministic projection of data the loan detail response already returns (`remaining_balance`, `interest_rate`, `balance_as_of`, `term_from_anchor`, `monthly_payment`), the scenario calculators need the same functions per keystroke and can't round-trip, and a 30-year plan would add ~360 rows to a response the list-and-navigate path also uses. Only the per-period *paid* state comes from the server, since that alone can't be derived client-side (Section 5.2).

For each month `i` from `0` to `term_from_anchor − 1`, starting from `balance = remaining_balance`:

```
interest_i  = balance × monthly_rate
principal_i = payment − interest_i
balance     = balance − principal_i
```

The final payment (and any payment whose computed `principal_i` would overshoot the remaining balance) has `principal_i` clamped to exactly `balance`, so the plan always ends at exactly `0` — absorbing the small floating-point drift a fixed annuity payment accumulates over many months. Each row also reports its own `payment` as `interest_i + principal_i`, so that clamped final row shows the real short last payment rather than the nominal one.

`computeAmortizationSchedule(balance, ratePct, months, payment, startPeriod)` takes an explicit `startPeriod` (`{ year, month }`) rather than a `dayOfPayment` it derives "now" from. That keeps the function **pure** — the same inputs always produce the same plan whatever today's date is — and lets the caller pass `balance_as_of` for an anchored loan or `effectiveCurrentPeriod()` for an unanchored one. It returns `{ period, year, month, interest, principal, payment, balance }` rows; `groupScheduleByYear(schedule)` rolls those into per-calendar-year buckets (`{ year, interest, principal, endBalance, paidCount, trackedCount, months }`) for the UI (Section 9). `paidCount`/`trackedCount` count only rows whose paid state is actually *known* — a `null` means "unknowable", never "unpaid" (Section 5.2).

Draft loans have no `remaining_balance` to walk forward from, so the plan is **active-loans only** — a draft's `principal`/`term_months` describe a hypothetical starting point, not a real payoff-in-progress.

-----

### 4.3 Balance Anchoring (active loans only)

`remaining_balance` is a **dated** figure: `balance_as_of` (`YYYY-MM`) records the month whose payment is the next one still owed on it. Everything else follows:

```
term_from_anchor = (end_year × 12 + end_month) − (anchor_year × 12 + anchor_month) + 1
payments_made    = clamp( (eff_year × 12 + eff_month) − (anchor_year × 12 + anchor_month), 0, term_from_anchor )
monthly_payment  = annuity(remaining_balance, interest_rate, term_from_anchor)      ← no dependence on "now"
current_balance  = projectBalance(remaining_balance, interest_rate, monthly_payment, payments_made, term_from_anchor)
months_left      = term_from_anchor − payments_made
```

where `(eff_year, eff_month)` is the same **effective current period** `months_left` has always used (Section 4.1). Substituting shows why that matters:

```
term_from_anchor − payments_made = [(end) − (anchor) + 1] − [(eff) − (anchor)] = (end) − (eff) + 1
```

— i.e. exactly `computeMonthsLeft(end_date, day_of_payment)`. The identity `months_left === term_from_anchor − payments_made` therefore holds **algebraically**, not by coincidence, which is what keeps the plan's row count, the payments-made counter, and the months-left figure from ever disagreeing.

`projectBalance` walks the payment forward `payments_made` rows of a `term_from_anchor`-row plan, deliberately as a loop rather than the closed form so it mirrors Section 4.2's final-row clamp row for row — the projected balance and the plan's own running balance must never disagree, and a fully-amortized loan lands on exactly `0` instead of a fraction-of-a-cent residue. It also refuses to compound a balance upward when the payment can't cover the interest (only reachable from hand-edited data).

**Auto-anchoring.** Writes set `balance_as_of` themselves rather than requiring it (Section 2.4): to the effective current period when the loan has no anchor, and *again* whenever `remaining_balance` itself changes — entering a fresh balance **is** a re-anchor. The change is detected **by value, not by presence**: `LoanFormModal` resends its entire payload on every save, so a presence-only check would silently re-anchor (discarding the recorded plan) on an unrelated edit to, say, the interest rate. An explicit `balance_as_of` in the request always wins.

**The `NULL` fallback is load-bearing.** With no anchor, `term_from_anchor` is unused, `payments_made` is `null`, `current_balance === remaining_balance`, and `monthly_payment` falls back to the annuity over `months_left` — i.e. *precisely* the pre-anchoring behaviour. That is what lets older rows, pre-v15 imports, and matured loans the migration skipped keep working unchanged instead of jumping to different figures. An anchor at or past `end_date` (only reachable from hand-edited data, since validation rejects it) falls back the same way rather than emitting `NaN`.

**Migration.** `042_add_balance_as_of_to_loans` adds the column and backfills each active loan with its own effective current period. Under the old rules `remaining_balance` meant "what's owed right now", so that is exactly the value the `NULL` fallback would have used — making the migration a **visual no-op at deploy**: every loan's `monthly_payment` reads identically the moment it lands, and merely stops climbing from the following month. It's best-effort in the same sense as the `cycle_start_day` backfill: the month each balance was *actually* accurate as of was never recorded, so "as of now" is the honest assumption, and the user can re-anchor from the edit form. Loans whose anchor would land past `end_date` are skipped. The date math is inlined rather than imported from `routes/loans` — that would be a circular require, and a migration must never depend on a live helper whose meaning can change later and retroactively rewrite recorded history.

**Known drift.** The projection assumes exactly the scheduled amount every month; an overpayment, underpayment, or payment holiday makes `current_balance` diverge from reality. Mitigated by labelling the anchor date everywhere the projected balance appears and by an explicit **"Re-anchor to today"** action in the edit form (Section 9) — never by auto-anchoring, which would pair a new anchor month with an old balance figure and corrupt the balance outright. The same reasoning applies to a mid-loan rate change, which retroactively rewrites the interest/principal split of months already paid: the form warns and offers the re-anchor instead.

-----

## 5. Expense Coverage (active loans only)

If an active loan is linked to a Fixed expense template item:

- `linked_item`: `{ id, name, value }` of the linked item, or `null` if unlinked or the item no longer exists.
- `covered`: `true` when the item's budgeted `value` is greater than or equal to the computed monthly payment, allowing a `0.005` epsilon for floating-point rounding (`value >= payment − 0.005`).
- `coverage_difference`: `value − payment`. Negative when underbudgeted.

The UI shows a green "Covered" pill when `covered` is true, or a red "Underbudgeted" pill with the payment, budgeted value, and difference when `covered` is false, plus an **"Update budgeted amount to X"** action that `PUT`s the template item's `value` to the loan's payment — the budgeted figure most often falls behind after a rate change or a re-anchor moved the payment. An active loan with **no** link shows an amber "Not tracked" pill in the list and a warning banner with an "Assign an expense" action on the detail page: without one it is neither budgeted anywhere nor able to record payments.

Note that anchoring (Section 4.3) makes this check stable. Before it, the payment climbed every month against a fixed budgeted value, so a loan that started out "Covered" would flip to "Underbudgeted" on its own with nothing having changed.

### 5.1 Link Semantics

- Only expense template items with `section = 'expense' AND type = 'Fixed'` can be linked — the form's dropdown is filtered accordingly, and the backend rejects any other target with a 400.
- Setting a link while the loan's status is `draft` is rejected with a 400.
- If the linked template item is deleted (`DELETE /expense-template/:itemId`), the FK's `ON DELETE SET NULL` clears the link automatically — `linked_item` becomes `null` on the next read.
- If the dossier's expense template section is bulk-replaced (`POST /expense-template/bulk-replace`, used by the Workbench "apply to template" action), all expense-section template items are deleted and reinserted with **new UUIDs**. Any loan linked to an item in that section is **re-linked by name** to the freshly-inserted item with the same `(section='expense', type='Fixed')` and name, inside the same transaction. If the item was renamed or removed, the loan is left unlinked — this is a documented limitation, matching the equivalent behavior for cycle-item template links.
- If multiple template items share the same name, re-linking (both on bulk-replace and on import) picks the first match — same tolerance the import name-matcher already has elsewhere in the codebase.

-----

### 5.2 Payment Tracking

The loan's linked Fixed expense **is** its payment — so tracking reuses it rather than introducing a parallel `loan_payments` table that would put two checkboxes on screen for one real-world event. A period counts as paid when the cycle covering that period's due date has a `cycle_items` row for the linked template item with `paid = 1`. There is exactly one paid flag, editable from either side: the cycle (as always) or the loan's payment plan, which writes through via the existing `PATCH /cycles/:cycleId/items/:itemId` — inheriting its 409-if-the-cycle-is-closed guard for free. No loan-specific write endpoint exists.

`GET /api/dossiers/:id/loans/:loanId/payment-status` supplies the read side:

```json
{ "tracking": "linked" | "unlinked",
  "linked_item": { "id", "name", "value" } | null,
  "shared_with": ["Other loan name"],
  "periods": [ { "period": "2026-08", "due_date": "2026-08-08",
                 "cycle_id", "cycle_year", "cycle_month", "cycle_is_closed",
                 "item_id", "item_value", "matched_by": "id" | "name" | null,
                 "paid": true | false | null } ] }
```

- **Range**: `balance_as_of` (or, unanchored, the effective current period) through the **current** effective period inclusive, capped at `term_from_anchor` and hard-capped at 240 rows. Future months can never be paid, so emitting them would only bloat the payload.
- **Due date**: `day_of_payment` clamped to that month's length — the same clamp used everywhere else.
- **Period → cycle**: cycles are loaded once and scanned in memory (a 30-year plan would otherwise be hundreds of round trips), matching on `actual_start_date <= due_date <= actual_end_date` with a recompute fallback for either date, mirroring `annual-expenses.js`. A due date landing exactly on a `cycle_start_day` belongs to the cycle *starting* that day (inclusive start), and where two cycles genuinely overlap (`PATCH /cycles { resolve_overlap: 'ignore' }`) the first in `(year, month)` order wins.
- **Cycle → item**: by `template_item_id` first (`matched_by: 'id'`), falling back to the linked item's **name** (`matched_by: 'name'`). The fallback is not cosmetic: `expense-template/bulk-replace` deletes and reinserts every item with fresh UUIDs and re-links the loan by name (Section 5.1), while surviving `cycle_items` still point at the *deleted* id — without the fallback, one Workbench "apply to template" would silently orphan a loan's entire recorded payment history.

**`paid: null` means unknowable, and is deliberately distinct from `false`.** There are four causes: the loan has no linked expense (`tracking: 'unlinked'`, empty `periods`); no cycle covers that month (it predates the dossier's cycles, or that cycle was never opened); the cycle exists but has no matching item (the loan was linked *after* that cycle was created — the template→cycle copy only runs at cycle creation); or the item was deleted from that cycle. The UI renders `null` as a muted "—", never as an unticked box, which would read as unpaid.

**Shared links.** Nothing forbids two loans pointing at one expense item (the FK isn't unique), and "one direct debit, two loans" is a real arrangement — so no uniqueness constraint was added. But those loans then share a single paid flag, and each independently compares its own payment against the same budgeted value (so both can read "Covered" when the item covers only one). `shared_with` names the others so the payment plan can say so out loud.

### 5.3 Creating a matching Fixed expense

`POST`/`PUT /loans[/:loanId]` accept `create_expense_template_item`: `true`, or `{ name?, value?, day_of_payment? }` to override the defaults. The route inserts the template item and links the loan **in the same transaction** — done client-side it would take two calls with no way to roll back the first, leaving an orphan expense in the user's budget whenever the second failed (and on `POST` there is no loan id yet, so the client would need a compensating delete).

Defaults: `name` ← the loan's name; `value` ← the loan's own stable `monthly_payment`, rounded to 2 dp, so coverage starts out green; `day_of_payment` ← the loan's. Fixed: `section='expense'`, `type='Fixed'`, `classification='must'` (a loan instalment is not discretionary), `position = MAX(position)+1` within the expense section, `paperless_tag_id = NULL`, `exclude_from_emergency_fund = 0`.

Rejected with a 400 when the effective status is `draft`, or when combined with a non-null `expense_template_item_id` — refusing to pick a winner rather than leaving the user with a link they didn't ask for or a stray expense they can't explain.

Template items only reach cycles at cycle creation (Business Rule 9), so the new expense appears in the **next** cycle opened, not in ones already open — the current period will read `paid: null` until then. Both modals say so.

## 6. Salary and % of Salary

- `salary` is stored per loan (nullable) and is independent of the dossier's cycles once set.
- When creating a loan, the form prefills `salary` from the dossier's **`reference_salary`** setting (Section 6.1) — a manually-configured value, not derived from any cycle — via the same computed field the backend also exposes as `reference_salary` on every loan response (so the edit form can offer a "use reference salary (X €)" affordance without a dedicated endpoint).
- `salary_pct` = `monthly_payment / salary * 100` when `salary > 0`, else `null` (shown as "—").

### 6.1 Reference Salary (dossier setting)

- `dossiers.reference_salary` (REAL, nullable) is a **manually-set** dossier-level setting, edited in Dossier Settings → "Loan Settings". It deliberately does **not** derive from `expense_cycles.salary` (the most recent cycle) — a one-off bonus or "special prize" in a single cycle would otherwise silently skew every new loan's prefill and the Loans tab's aggregate % of salary. The user sets it once and updates it only when their actual base salary changes.
- Used in two places: (1) prefilling a new loan's `salary` field (Section 6), and (2) the denominator for the Loans tab's total % of salary (Section 9, `KpiStrip`).
- `null` until the user sets it — prefill and the aggregate % both show "—"/blank until then; no automatic fallback to cycle data.
- Round-trips through export/import (still version 10, since this field was added before the version shipped) and via `GET/PATCH /dossiers/:id/settings`.
- Both draft and active loans show this percentage — it answers "how much of my pay would this loan payment consume," which is meaningful even for a pure what-if.

### 6.2 Max % of Salary for Loans (dossier setting)

- `dossiers.loans_max_salary_pct` (REAL, nullable, 0–100) is a **manually-set** dossier-level setting, edited in Dossier Settings → "Loan Settings" alongside `reference_salary`. It's the threshold the user considers the ceiling for how much of their salary should go to loan payments.
- Used exclusively to color the Loans tab's total "% of salary" `KpiStrip` item (Section 9) — a **traffic light** against `reference_salary`-denominated actual %:
  - **Red** (`danger`) once the actual % is at or above the max (`actual ≥ max`).
  - **Amber** (`warning`) within the last 2 percentage points below the max (`max − 2 ≤ actual < max`) — e.g. max `30`, actual `28`–`29.9` is amber.
  - **Green** (`success`) otherwise (`actual < max − 2`) — e.g. max `30`, actual `27.9` or below is green.
  - **Neutral** (no color) if `loans_max_salary_pct` isn't configured, or if the actual % can't be computed (no `reference_salary` set) — there's nothing to compare against.
- The KPI's `note` (rendered on both desktop `KpiBlock` cards and the mobile collapsible rows) spells out the **absolute euro values** behind both percentages plus the remaining headroom: `{formatEur(total_monthly_amount)} of {formatEur(max_absolute)} max · {formatEur(free_room)} free`, where `max_absolute = (loans_max_salary_pct / 100) × reference_salary` and `free_room = max_absolute − total_monthly_amount`. Once `free_room` goes negative (at/over the max, i.e. the red state), the trailing clause instead reads `{formatEur(Math.abs(free_room))} over`. This is the only place `note` needed adding to the mobile row of `ui/KpiStrip.jsx` — previously only the desktop `KpiBlock` rendered it (`GoalDetail`/`AnnualExpensesTab` already used `note` on desktop; the fix benefits them too).
- `null` until the user sets it — no traffic light, no note, until then.
- **A failed settings load is not the same as an unset maximum**, and must not render as one. If `GET /dossiers/:id/settings` fails, `LoansTab` keeps the neutral traffic light (there is genuinely nothing to compare against) but sets the note to *"Could not load the salary threshold — this figure is not being checked"*. Without that note the two states are pixel-identical, so a user at or over their configured ceiling would see the same silent neutral as someone who never set one. Do not swallow this rejection with `.catch(() => {})`.
- Round-trips through export/import (still version 10, folded in alongside `reference_salary`) and via `GET/PATCH /dossiers/:id/settings`.

-----

## 7. Scenario Calculators (draft and active loans)

All three scenarios are **ephemeral** — component-local state on the loan detail page, recomputed on every keystroke via `frontend/src/utils/loanMath.js`. Nothing is persisted. Available for both statuses: a draft's `(principal, term_months)` stands in for an active loan's `(remaining_balance, months_left)` as the simulation's starting balance/term (`simBalance`/`simMonthsLeft` in `LoanDetail.jsx`), so a purchase study can be fine-tuned immediately after creation, before ever promoting it to active.

### 7.1 Downpayment Scenario

Given a hypothetical downpayment `X` paid now against the current balance (`remaining_balance` if active, `principal` if draft — `balance` below), at the current `interest_rate` (`r` monthly) and term (`months_left` if active, `term_months` if draft):

- **Current payment** `M` = the loan's existing computed monthly payment.
- If `X ≥ balance`: the loan is paid off entirely; all remaining interest (`M·months_left − balance`) is shown as saved, and no further breakdown is computed.
- Otherwise, both outcomes are shown side by side:
  - **Lower payment, same term**: recompute the annuity payment on `balance − X` over the unchanged `months_left`.
  - **Same payment, shorter term**: solve for the new term `n′` that keeps the payment at `M` against the reduced balance:
    - `r > 0`: `n′ = ln(M / (M − (balance−X)·r)) / ln(1+r)`, ceiled for display (this ceiled value is `newTermSamePayment`).
    - `r = 0`: `n′ = (balance−X) / M`.
  - **Interest saved** (computed against the *exact*, non-ceiled `n′`, not the displayed rounded value): `(M·months_left − balance) − (M·n′ − (balance−X))`.
  - The UI presents the shorter term as a **new payoff date**, not a bare month count: `endDateFromMonthsLeft(newTermSamePayment)` (the exact inverse of Section 4.1's `computeMonthsLeft`) converts it to a `YYYY-MM` shown as "Month YYYY", alongside a **"Time saved"** figure (`months_left − newTermSamePayment`, formatted as "N years M months sooner") — both computed in `LoanDetail.jsx`, not `loanMath.js`, since they're presentation-only derivations of values `loanMath.js` already returns.

### 7.2 Target Payment Scenario

Given a desired target monthly payment `Y` (must be less than the current payment to be meaningful):

- `lumpSumNeeded = balance − Y·(1 − (1+r)^−months_left) / r` (or `balance − Y·months_left` when `r = 0`), clamped to a minimum of 0.
- If `Y` is already greater than or equal to the current payment, no lump sum is needed — the UI shows a message instead of a figure.

### 7.3 Interest Rate Scenario

Given a hypothetical new rate (e.g. refinancing, or a variable-rate reset), holding `remaining_balance` and `months_left` unchanged:

- `newPayment = computeMonthlyPayment(balance, newRatePct, months_left)`.
- `paymentDifference = newPayment − currentPayment` (positive = payment increases).
- `newTotalInterest = newPayment · months_left − balance`; `interestDifference = newTotalInterest − currentTotalInterest` (positive = paying more interest overall over the remaining term).
- No lower bound beyond `newRatePct ≥ 0`; a value equal to the current rate is valid and simply shows a zero difference.
- The UI colors both difference figures red when positive (worse) and green when negative (better), with a leading `+`/`−` sign (`formatSignedEur` in `LoanDetail.jsx`).

-----

## 8. Calculated Values Summary

Every loan API response (list and detail) includes, spread alongside the stored fields:

| Field | Description |
|---|---|
| `monthly_payment` | Computed via Section 4. For an **anchored** loan this derives from `term_from_anchor`, so it is stable over time and stays non-zero once matured — a loan past its end date isn't suddenly free. An **unanchored** loan still derives it from `months_left` and so still collapses to `0` once matured, via the existing `computeMonthlyPayment` guard |
| `current_balance` | The live balance: `remaining_balance` walked forward `payments_made` scheduled payments (Section 4.3). Equal to `remaining_balance` when unanchored, `null` for drafts. This — not the dated `remaining_balance` — is what `remaining_interest`, the Loans tab's total amount due, the scenario calculators, and the AI Advisor payload all read |
| `term_from_anchor` | Payments scheduled from `balance_as_of` through `end_date`, inclusive (Section 4.3) — `null` unless active *and* anchored |
| `payments_made` | How many of those are behind us, clamped into `[0, term_from_anchor]` — `null` unless active *and* anchored |
| `months_left` | Section 4.1 — `null` unless active. Derived from `end_date` and `day_of_payment`, never stored |
| `is_matured` | `true` when `status === 'active'` and `months_left <= 0` — the loan's `end_date` has passed without being updated. `false`/`null` otherwise (Section 4.1) |
| `salary_pct` | Section 6 |
| `reference_salary` | Section 6.1 — the dossier's manually-set reference salary, not derived from any cycle |
| `linked_item` | Section 5 — `null` unless active + linked + item still exists |
| `covered` | Section 5 — `null` unless `linked_item` is present |
| `coverage_difference` | Section 5 — `null` unless `linked_item` is present |
| `purchase_price` | `principal + down_payment` — `null` unless `down_payment` is set. Available for any loan with that data on record, draft or promoted-to-active |
| `total_interest` | `origination_monthly_payment × term_months − principal`, where `origination_monthly_payment` is computed from `principal`/`interest_rate`/`term_months` (Section 4) — `null` unless `principal` and `term_months` are both on record. The total interest paid over the *original* full term, excluding the opening fee (not interest). For an active loan this is a historical figure computed from origination data, distinct from the loan's current `monthly_payment` (which is based on `remaining_balance`/`months_left` instead) |
| `total_amount_payable` (MTIC) | `origination_monthly_payment × term_months + opening_fee` — `null` under the same condition as `total_interest`. A **simplified estimate**: principal + total interest + the one modeled fee, not the full legal MTIC (which can include stamp duty, insurance, etc. this app doesn't track) |
| `remaining_interest` | `monthly_payment × months_left − current_balance` — `null` unless active, and also `null` when `is_matured` (nothing is scheduled, so there is no meaningful forward-looking figure). Interest still left to pay from now to payoff, using the loan's *current* balance/term — the forward-looking counterpart to `total_interest`'s backward-looking full-term figure |

-----

## 9. UI Notes

- Loans is a dedicated tab within the dossier (`Capital · Monthly Expenses · Annual Expenses · Workbench · Goals · Loans · Emergency Fund · Settings`), following the same navigation and access patterns as Goals.
- The list view (`LoansTab`) shows each loan as a clickable card: a header row with the name, the interest rate right next to it (small, muted — "X% APR" active / "X% TAN" draft, same status-dependent labeling as `LoanDetail`'s hero), a status badge (`active` → brand, `draft` → neutral), a red "Matured" badge when `is_matured` is true, and — for active + linked loans — a coverage pill; then a stats row with monthly payment, down payment (only shown when set, prefixed with a coins icon rather than a text label to stay compact), and `salary_pct` ("—" if null). Putting the interest rate in the header rather than the stats row keeps the stats row short enough that it fits without scrolling in the common case. The stats row is still `flexWrap: nowrap` with `overflowX: auto` rather than wrapping, as a safety net — an unusually wide value (a 5+ digit down payment, say) scrolls the row horizontally instead of growing the card, so every card in the list stays the same height regardless of which optional stats it shows. Above the list (when at least one loan exists), a `KpiStrip` summary shows four aggregates scoped to **active loans only**: total monthly amount (sum of `monthly_payment`), total amount due (sum of `remaining_balance`), number of loans ongoing (count of active loans), and total % of salary — `total monthly amount ÷ reference_salary × 100` (the dossier's manually-set reference salary, Section 6.1 — not a sum of each loan's individually-stored `salary_pct`, since those can reference different salary values if edited independently), traffic-lighted red/amber/green against the dossier's `loans_max_salary_pct` setting (Section 6.2) with an absolute-euro-values-plus-remaining-headroom note underneath.
- The detail view (`LoanDetail`) follows `CycleEditor`'s patterns rather than a single dense summary card: a `.cycle-toolbar` with Edit and Delete, plus a **Promote** button shown only for draft loans (there is no Demote button — demoting is edit-form-only, Section 3.1); when `is_matured` is true, an `alert alert-warning` banner appears below the toolbar prompting the user to update the loan's remaining balance/end date or demote/delete it. Then a compact hero card (status badge — plus a red "Matured" badge alongside it when `is_matured` — rate, monthly payment — plus, whenever the underlying data exists regardless of status, Total interest (full term) and Total payable/MTIC, and for active, non-matured loans an additional Remaining interest figure, `null`/hidden once matured per Section 8), then a `.cycle-editor-columns` two-column layout (60/40 desktop, stacking to one column below 767px, same as `CycleEditor`) used for **every** loan regardless of status: the left column holds the three scenario calculators as `CollapsibleSection`s (`ui/CollapsibleSection.jsx`), the right column holds a "Loan details" `CollapsibleSection` — principal/balance, term/months-left/end-date/day-of-payment, and, whenever present regardless of status, purchase price/down payment/original principal/original term (months)/TAEG/opening fee — followed by an "Expense coverage" `CollapsibleSection` for active loans only. Drafts have no coverage panel, so their right column holds just "Loan details" — never left empty, since scenarios and details both render for every status. The "Term (months)"/"Months left"/"Original term (months)" rows show a years breakdown alongside the raw month count once it reaches 12+ — e.g. `300 (25 years)`, `25 (2 years and 1 month)` — via a local `formatMonthsWithYears()` helper; below 12 months just the bare number is shown, since a years breakdown wouldn't add anything.
- Clicking **Promote** opens `PromoteLoanModal` — a focused confirmation dialog, not the full edit form. It explains that principal/term/rate/TAEG/opening fee carry over as-is, then asks only for the active-only fields a draft lacks: **Remaining balance** (prefilled from the draft's `principal` — nothing paid down yet is the default assumption), **Day of payment** (1–31, no sensible default — starts blank), and **Loan end date** (the same month-`<select>` + year-`<input>` picker as `LoanFormModal`, prefilled to `term_months` months from today via `endDateFromMonthsLeft()`, with a live "N months left" hint that already reflects whichever day of payment has been typed so far). All three are freely editable before confirming. Submitting sends a single `PUT` with `{ status: 'active', remaining_balance, end_date, day_of_payment }` — every other field (including `down_payment`/`taeg`/`opening_fee`) is omitted from the payload and so carries forward automatically per Section 3.1's preservation rule.
- The form modal (`LoanFormModal`) mirrors `GoalFormModal`'s hand-rolled markup: name, status radio toggle, interest rate + salary (`parseDecimalInput`, accepts `,` or `.` as decimal separator), draft fields (principal + term) or active fields (balance + day of payment + end date + linked-expense `<select>`) shown conditionally, and a live payment preview. The interest rate field is labeled "TAN (nominal rate, %)" on draft loans (with a hint not to use the TAEG) and "Interest rate (annual, %)" on active loans. Active mode's day of payment is a plain `1–31` number input (same markup as the Fixed-expense day-of-payment field in `CycleEditor.jsx`), with a hint that a payment counts as made once that day passes each month. Active mode's end date uses the same month-`<select>` + year-`<input>` pattern as `GoalFormModal`'s target date (storing `YYYY-MM`), with a live "N months left — calculated automatically" hint below it computed via `computeMonthsLeft()` (day-of-payment-aware) — there is no direct months-left input anywhere. Draft mode additionally shows optional Purchase price/Down payment and TAEG/Opening fee rows, and the preview card adds live "Total interest paid" (red, mirroring the scenario calculators' green "interest saved") and "Total amount payable (MTIC, estimate)" figures below the monthly payment whenever a term is set. When editing an **active** loan that carries preserved origination data (`principal`/`term_months`/`down_payment`/`taeg`/`opening_fee` set from when it was a draft), active mode shows a read-only "Original purchase structure" card summarizing whichever of those fields are present, with a hint to switch to Draft to edit them — nothing is editable there directly in active mode. `LoanFormModal`'s status toggle remains the only way to promote/demote when the user wants to change *other* fields at the same time; `PromoteLoanModal` (above) is the fast path for the common case of promoting with no other edits.
- Below the two-column layout, active loans (only) get a full-width **"Payment plan"** `CollapsibleSection` (Section 4.2), collapsed by default since it's the most data-dense part of the page. It lists one summary row per calendar year (Year / Interest / Principal / Balance, interest in red, principal in green), mirroring the expandable-row pattern already used by `AnnualExpenseTemplate.jsx` (a `Set`-backed `expandedYears` state, `faChevronRight`/`faChevronDown` toggle) rather than `CollapsibleSection`'s single-boolean whole-section collapse. Clicking a year row expands a small `<table>` of that year's individual months (Month / Paid / Interest / Principal / Balance), inserted directly below the row rather than navigating anywhere. The year containing the current period auto-expands on load — for a 30-year mortgage the first year could otherwise be a decade of scrolling away.
- Each month row of the plan carries a `<Checkbox>` (from `ui/Checkbox.jsx`, never a native input) bound to that period's cycle item, disabled while its cycle is closed with a title saying so, and replaced by a muted "—" when the paid state is unknowable (Section 5.2). Ticking calls the existing `api.updateCycleItem`, then refetches; a 409 surfaces inline rather than being pre-empted. Each year row carries an "N/M paid" badge, and the current period's row is highlighted with a "NOW" marker. The whole plan (header, year rows, and month tables together) sits inside one `overflow-x: auto` container with a `460px` min width, so the columns stay aligned and scroll as a block on a phone rather than clipping at the card edge.
- The hero adds a "Balance left" figure (`current_balance`) next to the monthly payment for active loans, and "Loan details" splits the old single balance row into **Remaining balance** (`current_balance`), a muted **Balance entered** (`{remaining_balance} as of {Month Year}`), and **Payments made** (`{payments_made} of {term_from_anchor}`) — so what's owed now and what was typed when are never confused for each other. An unanchored active loan shows "Not anchored — edit to set one" in place of the anchor rows.
- An active loan with no linked expense shows an `alert alert-warning` under the toolbar (alongside the matured banner) with an **"Assign an expense"** button opening the edit form, and an amber "Not tracked" pill on its `LoansTab` card.
- Both `LoanFormModal` and `PromoteLoanModal` gain a **"Balance as of"** month/year picker (defaulting to the effective current period) and a **"Create a matching Fixed monthly expense"** checkbox (Section 5.3), shown only when no existing expense is picked. The edit form additionally offers **"Re-anchor to today"**, which fills the balance field with `current_balance` and moves the anchor to the current period — deliberately a button rather than an automatic prefill, since silently re-anchoring on every edit would reset `payments_made` and erase the recorded plan from view. Its live payment preview computes over `term_from_anchor`, not `months_left`, so it matches what the server will store.
- All numeric display uses `formatNumber`/`parseDecimalInput` — never `Intl.NumberFormat` directly.
- Deletion uses `ConfirmModal`, never `window.confirm()`.

-----

## 10. Schema

### 10.1 `loans` table

| Field | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `dossier_id` | TEXT | FK → `dossiers`, `ON DELETE CASCADE` |
| `name` | TEXT | Loan name |
| `status` | TEXT | `draft` (default) or `active` |
| `interest_rate` | REAL | Annual nominal percent, default 0 |
| `salary` | REAL (nullable) | Per-loan salary |
| `principal` | REAL (nullable) | Original amount borrowed. Settable only while draft (400 otherwise); never cleared on promotion to active — persists as the origination record |
| `term_months` | INTEGER (nullable) | Original total length. Settable only while draft (400 otherwise); never cleared on promotion to active — persists as the origination record |
| `remaining_balance` | REAL (nullable) | Active: amount owing **as of `balance_as_of`** — a dated anchor, not a live figure (Section 4.3) |
| `balance_as_of` | TEXT (nullable) | Active: `YYYY-MM`, the month whose payment is the next one still owed on `remaining_balance`. Auto-set on active writes; cleared on demotion to draft. `NULL` falls back to pre-anchoring behaviour (Section 4.3) |
| `end_date` | TEXT (nullable) | Active: `YYYY-MM` the loan finishes; `months_left` is always derived from this (Section 4.1), never stored. Active-only; cleared on demotion to draft |
| `day_of_payment` | INTEGER (nullable) | Active: day of the month (1–31) the payment is due; required for active loans. Feeds `months_left`'s "is this month already paid" check (Section 4.1) and, for an unanchored loan, the payment plan's starting month (Section 4.2). Active-only; cleared on demotion to draft |
| `expense_template_item_id` | TEXT (nullable) | FK → `expense_template_items`, `ON DELETE SET NULL` |
| `down_payment` | REAL (nullable) | Settable only while draft (400 otherwise); never cleared on promotion to active — persists as a historical record |
| `taeg` | REAL (nullable) | Settable only while draft, reference-only (never used in the calc); never cleared on promotion to active — persists as a historical record |
| `opening_fee` | REAL (nullable) | Settable only while draft; feeds `total_amount_payable`; never cleared on promotion to active — persists as a historical record |
| `created_at` | TEXT | Creation timestamp |

No `position` or `updated_at` column (mirrors `goals`). List endpoint orders `ORDER BY created_at ASC`.

### 10.2 `dossiers.reference_salary` / `dossiers.loans_max_salary_pct`

| Field | Type | Description |
|---|---|---|
| `reference_salary` | REAL (nullable) | Manually-set reference monthly salary (Section 6.1) — not derived from `expense_cycles`. Edited via `GET`/`PATCH /api/dossiers/:id/settings`, exposed to loans via each loan's computed `reference_salary` field |
| `loans_max_salary_pct` | REAL (nullable, 0–100) | Manually-set max % of salary the user wants going to loans (Section 6.2) — drives the Loans tab `KpiStrip`'s red/amber/green threshold. Edited via `GET`/`PATCH /api/dossiers/:id/settings`; not exposed on individual loan responses, since it's a tab-level aggregate setting, not a per-loan one — `LoansTab` fetches it directly via `getDossierSettings()` |

-----

## 11. API Contract

```
GET    /api/dossiers/:id/loans
POST   /api/dossiers/:id/loans           { name, status, interest_rate, salary?, principal?, term_months?, down_payment?, taeg?, opening_fee?,
                                           remaining_balance?, end_date?, day_of_payment?, balance_as_of?, expense_template_item_id?,
                                           create_expense_template_item? }
GET    /api/dossiers/:id/loans/:loanId
GET    /api/dossiers/:id/loans/:loanId/payment-status   → { tracking, linked_item, shared_with, periods[] }   (Section 5.2)
PUT    /api/dossiers/:id/loans/:loanId   (partial merge, goals-style)
DELETE /api/dossiers/:id/loans/:loanId
```

Validation (400 on failure):
- `name` required (non-empty after trim).
- `status` ∈ `{draft, active}`.
- `interest_rate` between 0 and 100.
- `salary` null or ≥ 0.
- Effective-status requirements: `draft` → `principal > 0` and integer `term_months ≥ 1`; `active` → `remaining_balance > 0`, `day_of_payment` required as an integer 1–31, and `end_date` required, matching `/^\d{4}-\d{2}$/`, resolving to `months_left ≥ 1` given that `day_of_payment` (Section 4.1). The other status's fields are preserved (if present) but not required.
- `expense_template_item_id`: rejected (400) if the loan's effective status is `draft`; otherwise must resolve to a same-dossier `expense_template_items` row with `section='expense' AND type='Fixed'`, else 400.
- `principal`, `term_months`, `down_payment`, `taeg`, `opening_fee`: each null or a non-negative number (`term_months` an integer); rejected (400) if explicitly set to a non-null value while the loan's effective status is `active`. If the field is omitted from the request body entirely, the existing stored value (if any) is carried forward unchanged regardless of status. Explicitly passing `null` for one of these fields is also rejected (400) whenever the loan's effective status is not `draft` *and* the field already has a non-null value on record — this protects the permanent historical record from being silently erased by an unrelated partial `PUT` (e.g. one that only touches `interest_rate`). Explicit `null` is still accepted for a field that has no existing value, and for any of these fields on a `draft` loan (subject to the `draft` positivity/required checks above for `principal`/`term_months`).
- `end_date`: rejected (400) if set to a non-null value while the loan's effective status is `draft`.
- `day_of_payment`: null or an integer 1–31 (400 otherwise); rejected (400) if set to a non-null value while the loan's effective status is `draft`.
- `balance_as_of`: must match `/^\d{4}-\d{2}$/` if non-null; rejected (400) if set while the effective status is `draft`; must resolve to `term_from_anchor ≥ 1` against `end_date`. Not required — when omitted from the body, an active write auto-anchors it to the effective current period if the loan has none, or if `remaining_balance` changed value (Section 4.3).
- `create_expense_template_item`: `true` or an object of overrides (Section 5.3). 400 when the effective status is `draft`, when combined with a non-null `expense_template_item_id`, when the resolved name is empty, when `value` is negative, or when `day_of_payment` isn't an integer 1–31. The item insert and the loan write share one transaction, so a rejection leaves no partial state.
- `PUT` flipping `active → draft` forces `expense_template_item_id = NULL`, `end_date = NULL`, `day_of_payment = NULL`, and `balance_as_of = NULL` regardless of what was sent.
- `PUT` flipping `draft → active` does **not** clear `down_payment`, `taeg`, or `opening_fee` — see Section 3.1.

-----

## 12. Export / Import

- Export version **10** adds a `loans` array: `{ name, status, interest_rate, salary, principal, term_months, remaining_balance, end_date, day_of_payment, created_at, down_payment, taeg, opening_fee, linked_expense_name }`. `linked_expense_name` is resolved via a `LEFT JOIN` to the expense template item's name (or `null` if unlinked), matching the Goals resolve-to-name export pattern. `principal`, `term_months`, `down_payment`, `taeg`, and `opening_fee` are imported as-is regardless of status — an active loan that was originated as a draft carries this historical data through export/import just like it does through normal reads/writes. `end_date`, `day_of_payment`, and `balance_as_of` are only meaningful for active loans; all imported as `null` for draft loans regardless of the exported value. `months_left`, `current_balance`, `term_from_anchor`, and `payments_made` are never exported — all are re-derived at read time.
- The dossier's `reference_salary` (Section 6.1) and `loans_max_salary_pct` (Section 6.2) also round-trip as part of the `dossier` object in the same version-10 export, alongside the existing settings fields (`cycle_start_day`, `emergency_fund_*`, `paperless_*`).
- Export version **15** adds `balance_as_of` to each loan. Imports of versions ≤ 14 carry an undated balance, which under the pre-anchor rules meant "what's owed right now" — so an active loan is anchored at the effective current period, exactly what migration `042` does for a pre-anchor database (`null` when that would land past the loan's `end_date`). An old export and an old database therefore reach the same state instead of diverging.
- Per-period payment tracking (Section 5.2) needs nothing of its own in the export: it's derived from `cycle_items.paid`, which already round-trips, and loans already re-link to their expense by `linked_expense_name`.
- Import accepts versions **1–15**. Loans are inserted with new UUIDs inside the same import transaction. The link is re-established only when `status === 'active'`, by matching `linked_expense_name` against the already-built `expenseTemplateNameToId` map (expense-section only) — the same map import already builds for expense template re-linking. A missing or unmatched name leaves the loan unlinked. Older exports (versions 1–9) have no `loans` key and simply import with zero loans.

-----

## 13. Known Limitations (out of scope for fixing here)

- A Workbench "apply to template" rename of a linked Fixed expense unlinks the loan (same semantics as cycle-item links — see Section 5.1).
- If duplicate template item names exist, re-linking (bulk-replace and import) picks the first match.
- Deleting a linked template item clears the loan's link (`ON DELETE SET NULL`) and with it the whole payment plan's tracking, even though the `cycle_items` rows survive. Re-linking to a same-named replacement does **not** restore that history: the surviving cycle items still point at the *deleted* id, and the name fallback (Section 5.2) resolves against the *new* item's name — so it recovers a bulk-replace, but not a delete-and-recreate under a different name.
- A period with no covering cycle can't be ticked off at all (`paid: null`). Opening the cycle later makes it tickable, but only if the linked expense is in the template at that point — cycle items are copied at cycle creation and never re-synced.
- `current_balance` assumes exactly the scheduled payment every month; overpayments, underpayments, and payment holidays make it drift until the user re-anchors (Section 4.3).
- Changing `interest_rate` mid-loan retroactively rewrites the interest/principal split of months already paid. The form warns and offers a re-anchor; no per-period rate history is kept.
- The effective current period is computed in UTC (`loans.js`) while due-date/cycle matching uses local date components (`cycleDates.js` convention). Both are date-only within one process, so this is consistent in practice, but a due date landing on a cycle's first or last day is theoretically sensitive to the seam.
