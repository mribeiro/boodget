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
| **Remaining balance** | Amount still owing (must be > 0) |
| **End date** | Required. The calendar month (`YYYY-MM`) the loan finishes. **Months left is never entered directly** — it's computed fresh on every read from `end_date` vs. the current date, so the user never has to update it month by month. Must resolve to at least 1 month remaining (i.e. the current month or later) |
| **Linked expense** | Optional. A Fixed expense template item in the same dossier used to check budget coverage (Section 5) |

### 2.4 Constraints

- A dossier can have multiple loans, in either status, simultaneously.
- Draft loans **cannot** be linked to an expense template item — the link field is only meaningful once a loan is active.
- Loans can be edited and deleted at any time.
- Down payment is **settable only while draft**: an active loan's `remaining_balance` is already net of any down payment made, so there's nothing new to model there once it's real. The create/edit form lets the user enter a **Purchase price** and **Down payment** instead of typing Principal directly; Principal is then derived as `purchase_price − down_payment` and that's what feeds the amortization formula. Leaving Purchase price blank falls back to typing Principal directly, with no down payment stored. Once set, the value is **preserved indefinitely** across status changes — promoting to active does not erase it, since it's a fact about how the loan was originated, not something that stops being true.
- TAEG and Opening fee follow the same settable-only-while-draft-but-persists rule as Down payment: they describe the terms of a loan being studied before signing. TAEG is purely for the user's own reference (e.g. to note the number a lender advertises) and is never read by the amortization formula — only the TAN (the `interest_rate` field) drives `monthly_payment`. Opening fee feeds `total_amount_payable` (Section 8) only.
- `principal` and `term_months` themselves are likewise never cleared when a loan is promoted to active — they remain in the database as a record of the loan's original terms, which is what lets `purchase_price`/`total_interest`/`total_amount_payable` (Section 8) keep working after promotion.
- End date is **active-only**, the mirror image of the draft-only fields: draft loans study a fixed `term_months`, while an active loan tracks a real calendar deadline. Setting `end_date` while `status = 'draft'` is rejected with a 400; it's forced to `NULL` on demotion to draft.

-----

## 3. Status: Draft vs Active

| Status | Meaning | Payment computed from |
|---|---|---|
| **Draft** | A study/what-if — not a real ongoing loan | `principal`, `interest_rate`, `term_months` |
| **Active** | A real ongoing loan being tracked | `remaining_balance`, `interest_rate`, `months_left` (computed from `end_date`, Section 4.1) |

### 3.1 Status Transitions

- Status can be toggled **both ways** (draft → active, active → draft) at any time via the edit form's status radio toggle.
- Toggling **preserves all field values** on both sides — switching to draft doesn't erase `remaining_balance`/`end_date`, and switching to active doesn't erase `principal`/`term_months`. Only the fields relevant to the *new* status are validated as required.
- Demoting **active → draft** always clears the expense link (`expense_template_item_id` is forced to `NULL`) and the end date (`end_date` forced to `NULL`), since neither is meaningful for a draft. There is **no dedicated "Demote" button** — demoting only happens via `LoanFormModal`'s status toggle, same as any other field edit.
- Promoting **draft → active** does **not** clear `principal`, `term_months`, `down_payment`, `taeg`, or `opening_fee` — they describe how the loan was originated and remain on record as history once it's real, surfaced read-only in `LoanDetail` and `LoanFormModal` (Section 9). They can still only be explicitly *set* via the API while `status = 'draft'` (400 otherwise); a `PUT` that flips status without touching them just carries the existing values forward unchanged.
- Promoting has its own dedicated **"Promote" button**, shown in `LoanDetail`'s toolbar only for draft loans (alongside Edit/Delete), which opens `PromoteLoanModal` — a focused dialog that asks only for the two fields a draft doesn't have (`remaining_balance` and `end_date`), rather than the full edit form. See Section 9 for the UI details.

-----

## 4. Amortization Formula

Standard annuity formula, applied identically whether the loan is a draft or active:

```
r = (annual_interest_rate_pct / 100) / 12
payment = P · r / (1 − (1 + r)^−n)         when r > 0
payment = P / n                             when r = 0
```

Where `P` is `principal` (draft) or `remaining_balance` (active), and `n` is `term_months` (draft) or `months_left` (active).

This is computed server-side on every read/write (never persisted as a stored column) so it always reflects the latest inputs. The frontend duplicates the same formula in `frontend/src/utils/loanMath.js` for live, per-keystroke previews in the form — the server remains the source of truth for anything actually saved or displayed outside the form.

### 4.1 Months Left (active loans, derived from `end_date`)

`months_left` is never entered or stored — it's derived fresh on every read from the loan's `end_date` (`YYYY-MM`) and the current date, so the user is never asked to update it as the loan progresses:

```
months_left = (end_year × 12 + end_month) − (current_year × 12 + current_month) + 1
months_left = max(0, months_left)
```

The `+ 1` makes the end month itself inclusive — an `end_date` equal to the current month means 1 payment remains (this month's, the last one). `end_date` must resolve to `months_left ≥ 1` at write time (400 otherwise); a loan that has already matured should be demoted, deleted, or given a corrected end date rather than left with a months-left of 0.

Implemented identically in `computeMonthsLeft()` in both `backend/src/routes/loans.js` (source of truth for `monthly_payment` and everywhere else `months_left` is read) and `frontend/src/utils/loanMath.js` (live preview in the form as the user picks a month/year).

### 4.2 Amortization Schedule (active loans only)

Walks the fixed monthly payment forward from the current `remaining_balance`, splitting each payment into its interest and principal portions — the actual month-by-month payoff plan, not a total. Computed **entirely client-side** in `frontend/src/utils/loanMath.js` (no new API endpoint): it's a deterministic projection of data the loan detail response already returns (`remaining_balance`, `interest_rate`, `months_left`, `monthly_payment`), so there's nothing for the server to compute that the client doesn't already have.

For each month `i` from `0` to `months_left − 1`, starting from `balance = remaining_balance`:

```
interest_i  = balance × monthly_rate
principal_i = payment − interest_i
balance     = balance − principal_i
```

The final payment (and any payment whose computed `principal_i` would overshoot the remaining balance) has `principal_i` clamped to exactly `balance`, so the schedule always ends at exactly `0` — absorbing the small floating-point drift a fixed annuity payment accumulates over many months rather than letting it show as a nonzero leftover balance.

Each row is dated by calendar month/year, counting forward from the current month (payment 1 = this month, matching `months_left`'s own convention). `computeAmortizationSchedule(balance, ratePct, monthsLeft, payment)` returns the flat list of `{ year, month, interest, principal, balance }` rows; `groupScheduleByYear(schedule)` rolls that up into per-calendar-year buckets (`{ year, interest, principal, endBalance, months }`) for the UI (Section 9) to render as a collapsible year list that expands into its constituent months on demand, rather than rendering every payment at once.

Draft loans have no `remaining_balance` to walk forward from, so this schedule is **active-loans only** — a draft's `principal`/`term_months` describe a hypothetical starting point, not a real payoff-in-progress.

-----

## 5. Expense Coverage (active loans only)

If an active loan is linked to a Fixed expense template item:

- `linked_item`: `{ id, name, value }` of the linked item, or `null` if unlinked or the item no longer exists.
- `covered`: `true` when the item's budgeted `value` is greater than or equal to the computed monthly payment, allowing a `0.005` epsilon for floating-point rounding (`value >= payment − 0.005`).
- `coverage_difference`: `value − payment`. Negative when underbudgeted.

The UI shows a green "Covered" pill when `covered` is true, or a red "Underbudgeted" pill with the payment, budgeted value, and difference when `covered` is false. Unlinked loans show a muted hint instead, with no pill.

### 5.1 Link Semantics

- Only expense template items with `section = 'expense' AND type = 'Fixed'` can be linked — the form's dropdown is filtered accordingly, and the backend rejects any other target with a 400.
- Setting a link while the loan's status is `draft` is rejected with a 400.
- If the linked template item is deleted (`DELETE /expense-template/:itemId`), the FK's `ON DELETE SET NULL` clears the link automatically — `linked_item` becomes `null` on the next read.
- If the dossier's expense template section is bulk-replaced (`POST /expense-template/bulk-replace`, used by the Workbench "apply to template" action), all expense-section template items are deleted and reinserted with **new UUIDs**. Any loan linked to an item in that section is **re-linked by name** to the freshly-inserted item with the same `(section='expense', type='Fixed')` and name, inside the same transaction. If the item was renamed or removed, the loan is left unlinked — this is a documented limitation, matching the equivalent behavior for cycle-item template links.
- If multiple template items share the same name, re-linking (both on bulk-replace and on import) picks the first match — same tolerance the import name-matcher already has elsewhere in the codebase.

-----

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
| `monthly_payment` | Computed via Section 4 |
| `months_left` | Section 4.1 — `null` unless active. Derived from `end_date`, never stored |
| `salary_pct` | Section 6 |
| `reference_salary` | Section 6.1 — the dossier's manually-set reference salary, not derived from any cycle |
| `linked_item` | Section 5 — `null` unless active + linked + item still exists |
| `covered` | Section 5 — `null` unless `linked_item` is present |
| `coverage_difference` | Section 5 — `null` unless `linked_item` is present |
| `purchase_price` | `principal + down_payment` — `null` unless `down_payment` is set. Available for any loan with that data on record, draft or promoted-to-active |
| `total_interest` | `origination_monthly_payment × term_months − principal`, where `origination_monthly_payment` is computed from `principal`/`interest_rate`/`term_months` (Section 4) — `null` unless `principal` and `term_months` are both on record. The total interest paid over the *original* full term, excluding the opening fee (not interest). For an active loan this is a historical figure computed from origination data, distinct from the loan's current `monthly_payment` (which is based on `remaining_balance`/`months_left` instead) |
| `total_amount_payable` (MTIC) | `origination_monthly_payment × term_months + opening_fee` — `null` under the same condition as `total_interest`. A **simplified estimate**: principal + total interest + the one modeled fee, not the full legal MTIC (which can include stamp duty, insurance, etc. this app doesn't track) |
| `remaining_interest` | `monthly_payment × months_left − remaining_balance` — `null` unless active. Interest still left to pay from now to payoff, using the loan's *current* balance/term — the forward-looking counterpart to `total_interest`'s backward-looking full-term figure |

-----

## 9. UI Notes

- Loans is a dedicated tab within the dossier (`Capital · Monthly Expenses · Annual Expenses · Workbench · Goals · Loans · Emergency Fund · Settings`), following the same navigation and access patterns as Goals.
- The list view (`LoansTab`) shows each loan as a clickable card: name, status badge (`active` → brand, `draft` → neutral), monthly payment, down payment (only shown when set, prefixed with a coins icon rather than a text label to stay compact), `salary_pct` ("—" if null), interest rate, and — for active + linked loans — a coverage pill. The stats row is `flexWrap: nowrap` with `overflowX: auto` rather than wrapping — a wide value (a 5+ digit down payment, say) scrolls the row horizontally instead of growing the card, so every card in the list stays the same height regardless of which optional stats it shows. Above the list (when at least one loan exists), a `KpiStrip` summary shows four aggregates scoped to **active loans only**: total monthly amount (sum of `monthly_payment`), total amount due (sum of `remaining_balance`), number of loans ongoing (count of active loans), and total % of salary — `total monthly amount ÷ reference_salary × 100` (the dossier's manually-set reference salary, Section 6.1 — not a sum of each loan's individually-stored `salary_pct`, since those can reference different salary values if edited independently), highlighted red above 50%.
- The detail view (`LoanDetail`) follows `CycleEditor`'s patterns rather than a single dense summary card: a `.cycle-toolbar` with Edit and Delete, plus a **Promote** button shown only for draft loans (there is no Demote button — demoting is edit-form-only, Section 3.1), then a compact hero card (status badge, rate, monthly payment — plus, whenever the underlying data exists regardless of status, Total interest (full term) and Total payable/MTIC, and for active loans an additional Remaining interest figure), then a `.cycle-editor-columns` two-column layout (60/40 desktop, stacking to one column below 767px, same as `CycleEditor`) used for **every** loan regardless of status: the left column holds the three scenario calculators as `CollapsibleSection`s (`ui/CollapsibleSection.jsx`), the right column holds a "Loan details" `CollapsibleSection` — principal/balance, term/months-left/end-date, and, whenever present regardless of status, purchase price/down payment/original principal/original term (months)/TAEG/opening fee — followed by an "Expense coverage" `CollapsibleSection` for active loans only. Drafts have no coverage panel, so their right column holds just "Loan details" — never left empty, since scenarios and details both render for every status. The "Term (months)"/"Months left"/"Original term (months)" rows show a years breakdown alongside the raw month count once it reaches 12+ — e.g. `300 (25 years)`, `25 (2 years and 1 month)` — via a local `formatMonthsWithYears()` helper; below 12 months just the bare number is shown, since a years breakdown wouldn't add anything.
- Clicking **Promote** opens `PromoteLoanModal` — a focused confirmation dialog, not the full edit form. It explains that principal/term/rate/TAEG/opening fee carry over as-is, then asks only for the two active-only fields a draft lacks: **Remaining balance** (prefilled from the draft's `principal` — nothing paid down yet is the default assumption) and **Loan end date** (the same month-`<select>` + year-`<input>` picker as `LoanFormModal`, prefilled to `term_months` months from today via `endDateFromMonthsLeft()`, with a live "N months left" hint). Both are freely editable before confirming. Submitting sends a single `PUT` with just `{ status: 'active', remaining_balance, end_date }` — every other field (including `down_payment`/`taeg`/`opening_fee`) is omitted from the payload and so carries forward automatically per Section 3.1's preservation rule.
- The form modal (`LoanFormModal`) mirrors `GoalFormModal`'s hand-rolled markup: name, status radio toggle, interest rate + salary (`parseDecimalInput`, accepts `,` or `.` as decimal separator), draft fields (principal + term) or active fields (balance + end date + linked-expense `<select>`) shown conditionally, and a live payment preview. The interest rate field is labeled "TAN (nominal rate, %)" on draft loans (with a hint not to use the TAEG) and "Interest rate (annual, %)" on active loans. Active mode's end date uses the same month-`<select>` + year-`<input>` pattern as `GoalFormModal`'s target date (storing `YYYY-MM`), with a live "N months left — calculated automatically" hint below it computed via `computeMonthsLeft()` — there is no direct months-left input anywhere. Draft mode additionally shows optional Purchase price/Down payment and TAEG/Opening fee rows, and the preview card adds live "Total interest paid" (red, mirroring the scenario calculators' green "interest saved") and "Total amount payable (MTIC, estimate)" figures below the monthly payment whenever a term is set. When editing an **active** loan that carries preserved origination data (`principal`/`term_months`/`down_payment`/`taeg`/`opening_fee` set from when it was a draft), active mode shows a read-only "Original purchase structure" card summarizing whichever of those fields are present, with a hint to switch to Draft to edit them — nothing is editable there directly in active mode. `LoanFormModal`'s status toggle remains the only way to promote/demote when the user wants to change *other* fields at the same time; `PromoteLoanModal` (above) is the fast path for the common case of promoting with no other edits.
- Below the two-column layout, active loans (only) get a full-width **"Amortization schedule"** `CollapsibleSection` (Section 4.2), collapsed by default since it's the most data-dense part of the page. It lists one summary row per calendar year (Year / Interest / Principal / Balance, interest in red, principal in green), mirroring the expandable-row pattern already used by `AnnualExpenseTemplate.jsx` (a `Set`-backed `expandedYears` state, `faChevronRight`/`faChevronDown` toggle) rather than `CollapsibleSection`'s single-boolean whole-section collapse. Clicking a year row expands a small `<table>` of that year's individual months (Month / Interest / Principal / Balance), inserted directly below the row rather than navigating anywhere.
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
| `principal` | REAL (nullable) | Original amount borrowed, set while draft. Never cleared on promotion to active — persists as the origination record |
| `term_months` | INTEGER (nullable) | Original total length, set while draft. Never cleared on promotion to active — persists as the origination record |
| `remaining_balance` | REAL (nullable) | Active: amount still owing |
| `end_date` | TEXT (nullable) | Active: `YYYY-MM` the loan finishes; `months_left` is always derived from this (Section 4.1), never stored. Active-only; cleared on demotion to draft |
| `expense_template_item_id` | TEXT (nullable) | FK → `expense_template_items`, `ON DELETE SET NULL` |
| `down_payment` | REAL (nullable) | Settable only while draft (400 otherwise); never cleared on promotion to active — persists as a historical record |
| `taeg` | REAL (nullable) | Settable only while draft, reference-only (never used in the calc); never cleared on promotion to active — persists as a historical record |
| `opening_fee` | REAL (nullable) | Settable only while draft; feeds `total_amount_payable`; never cleared on promotion to active — persists as a historical record |
| `created_at` | TEXT | Creation timestamp |

No `position` or `updated_at` column (mirrors `goals`). List endpoint orders `ORDER BY created_at ASC`.

### 10.2 `dossiers.reference_salary`

| Field | Type | Description |
|---|---|---|
| `reference_salary` | REAL (nullable) | Manually-set reference monthly salary (Section 6.1) — not derived from `expense_cycles`. Edited via `GET`/`PATCH /api/dossiers/:id/settings`, exposed to loans via each loan's computed `reference_salary` field |

-----

## 11. API Contract

```
GET    /api/dossiers/:id/loans
POST   /api/dossiers/:id/loans           { name, status, interest_rate, salary?, principal?, term_months?, down_payment?, taeg?, opening_fee?, remaining_balance?, end_date?, expense_template_item_id? }
GET    /api/dossiers/:id/loans/:loanId
PUT    /api/dossiers/:id/loans/:loanId   (partial merge, goals-style)
DELETE /api/dossiers/:id/loans/:loanId
```

Validation (400 on failure):
- `name` required (non-empty after trim).
- `status` ∈ `{draft, active}`.
- `interest_rate` between 0 and 100.
- `salary` null or ≥ 0.
- Effective-status requirements: `draft` → `principal > 0` and integer `term_months ≥ 1`; `active` → `remaining_balance > 0` and `end_date` required, matching `/^\d{4}-\d{2}$/`, resolving to `months_left ≥ 1` (Section 4.1). The other status's fields are preserved (if present) but not required.
- `expense_template_item_id`: rejected (400) if the loan's effective status is `draft`; otherwise must resolve to a same-dossier `expense_template_items` row with `section='expense' AND type='Fixed'`, else 400.
- `down_payment`, `taeg`, `opening_fee`: each null or a non-negative number; rejected (400) if explicitly set to a non-null value while the loan's effective status is `active`. If the field is omitted from the request body entirely, the existing stored value (if any) is carried forward unchanged regardless of status — these are only gated on *explicit* setting, not on status itself.
- `end_date`: rejected (400) if set to a non-null value while the loan's effective status is `draft`.
- `PUT` flipping `active → draft` forces `expense_template_item_id = NULL` and `end_date = NULL` regardless of what was sent.
- `PUT` flipping `draft → active` does **not** clear `down_payment`, `taeg`, or `opening_fee` — see Section 3.1.

-----

## 12. Export / Import

- Export version **10** adds a `loans` array: `{ name, status, interest_rate, salary, principal, term_months, remaining_balance, end_date, created_at, down_payment, taeg, opening_fee, linked_expense_name }`. `linked_expense_name` is resolved via a `LEFT JOIN` to the expense template item's name (or `null` if unlinked), matching the Goals resolve-to-name export pattern. `principal`, `term_months`, `down_payment`, `taeg`, and `opening_fee` are imported as-is regardless of status — an active loan that was originated as a draft carries this historical data through export/import just like it does through normal reads/writes. `end_date` is only meaningful for active loans; imported as `null` for draft loans regardless of the exported value. `months_left` is never exported — it's always re-derived at read time from `end_date`.
- The dossier's `reference_salary` (Section 6.1) also round-trips as part of the `dossier` object in the same version-10 export, alongside the existing settings fields (`cycle_start_day`, `emergency_fund_*`, `paperless_*`).
- Import accepts versions **1–10**. Loans are inserted with new UUIDs inside the same import transaction. The link is re-established only when `status === 'active'`, by matching `linked_expense_name` against the already-built `expenseTemplateNameToId` map (expense-section only) — the same map import already builds for expense template re-linking. A missing or unmatched name leaves the loan unlinked. Older exports (versions 1–9) have no `loans` key and simply import with zero loans.

-----

## 13. Known Limitations (out of scope for fixing here)

- A Workbench "apply to template" rename of a linked Fixed expense unlinks the loan (same semantics as cycle-item links — see Section 5.1).
- If duplicate template item names exist, re-linking (bulk-replace and import) picks the first match.
