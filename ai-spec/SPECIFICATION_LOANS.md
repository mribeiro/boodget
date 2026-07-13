# boodget — Loans Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, and `SPECIFICATION_GOALS.md`. Read all three before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Loans** section is a new section within each dossier, alongside Capital, Monthly Expenses, Workbench, and Goals.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Loans section lets users configure loans per dossier. Each loan is either a **draft** (a study/what-if scenario) or an **active** loan (a real, ongoing one being tracked). Both compute a monthly payment via the standard annuity formula and show what percentage of a stored salary that payment represents. Active loans can optionally be linked to a Fixed monthly-expense template item to check whether the budgeted value covers the payment, and offer three ephemeral scenario calculators (downpayment, target payment, interest rate change).

-----

## 2. Loan Definition

### 2.1 Fields (common to both statuses)

| Field | Description |
|---|---|
| **Name** | Free text label for the loan |
| **Status** | `draft` or `active` — see Section 3 |
| **Interest rate** | Annual nominal percentage (e.g. `3.5` = 3.5%), 0–100. Always the **TAN** (nominal rate) — the rate that actually drives the amortization formula, labeled "TAN" on draft loans and "Interest rate" on active loans. Never the TAEG/APR, which is a separate, higher, fees-inclusive figure — see the `taeg` field below |
| **Salary** | Per-loan editable value. Prefilled from the dossier's **most recent expense cycle's salary** when creating a loan; can be changed at any time and does not follow the cycle afterward |

### 2.2 Draft-only fields

| Field | Description |
|---|---|
| **Principal** | Amount financed (must be > 0). Used directly in the amortization formula — unaffected by whether it was typed directly or derived from a purchase-price breakdown |
| **Term (months)** | Total loan length (integer ≥ 1) |
| **Down payment** | Optional. When set, the loan also exposes a computed **Purchase price** (`principal + down_payment`) for display. Only meaningful — and only settable — while `status = 'draft'`; forced to `NULL` on promotion to active (400 if the client attempts to set it on an active loan) |
| **TAEG** | Optional, reference-only. The marketing/legal APR figure (includes fees) as disclosed on the loan offer — stored purely for comparison against the TAN, **never used in any calculation**. Same draft-only rules as Down payment |
| **Opening fee** | Optional. A one-off processing/opening commission (e.g. a bank's "comissão de abertura de contrato"), added into the computed **Total amount payable** (Section 6). Same draft-only rules as Down payment |

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
- Down payment is **draft-only**: an active loan's `remaining_balance` is already net of any down payment made, so there's nothing to model there. The create/edit form lets the user enter a **Purchase price** and **Down payment** instead of typing Principal directly; Principal is then derived as `purchase_price − down_payment` and that's what feeds the amortization formula. Leaving Purchase price blank falls back to typing Principal directly, with no down payment stored.
- TAEG and Opening fee are also **draft-only**, for the same reason as Down payment: they describe the terms of a loan being studied before signing, not an ongoing one. TAEG is purely for the user's own reference (e.g. to note the number a lender advertises) and is never read by the amortization formula — only the TAN (the `interest_rate` field) drives `monthly_payment`. Opening fee feeds `total_amount_payable` (Section 8) only.
- End date is **active-only**, the mirror image of the draft-only fields: draft loans study a fixed `term_months`, while an active loan tracks a real calendar deadline. Setting `end_date` while `status = 'draft'` is rejected with a 400; it's forced to `NULL` on demotion to draft.

-----

## 3. Status: Draft vs Active

| Status | Meaning | Payment computed from |
|---|---|---|
| **Draft** | A study/what-if — not a real ongoing loan | `principal`, `interest_rate`, `term_months` |
| **Active** | A real ongoing loan being tracked | `remaining_balance`, `interest_rate`, `months_left` (computed from `end_date`, Section 4.1) |

### 3.1 Status Transitions

- Status can be toggled **both ways** (draft → active, active → draft) at any time via the edit form.
- Toggling **preserves all field values** on both sides — switching to draft doesn't erase `remaining_balance`/`end_date`, and switching to active doesn't erase `principal`/`term_months`. Only the fields relevant to the *new* status are validated as required.
- Demoting **active → draft** always clears the expense link (`expense_template_item_id` is forced to `NULL`) and the end date (`end_date` forced to `NULL`), since neither is meaningful for a draft.
- Promoting **draft → active** always clears the down payment, TAEG, and opening fee (all forced to `NULL`), since they're only meaningful for the study/what-if scenario a draft represents.

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
- When creating a loan, the form prefills `salary` from the dossier's most recent expense cycle (`ORDER BY year DESC, month DESC LIMIT 1`), via the same computed field the backend also exposes as `latest_cycle_salary` on every loan response (so the edit form can offer a "use latest (X €)" affordance without a dedicated endpoint).
- `salary_pct` = `monthly_payment / salary * 100` when `salary > 0`, else `null` (shown as "—").
- Both draft and active loans show this percentage — it answers "how much of my pay would this loan payment consume," which is meaningful even for a pure what-if.

-----

## 7. Scenario Calculators (active loans only)

All three scenarios are **ephemeral** — component-local state on the loan detail page, recomputed on every keystroke via `frontend/src/utils/loanMath.js`. Nothing is persisted.

### 7.1 Downpayment Scenario

Given a hypothetical downpayment `X` paid now against the current `remaining_balance` (`balance`), at the current `interest_rate` (`r` monthly) and `months_left`:

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
| `latest_cycle_salary` | Section 6 |
| `linked_item` | Section 5 — `null` unless active + linked + item still exists |
| `covered` | Section 5 — `null` unless `linked_item` is present |
| `coverage_difference` | Section 5 — `null` unless `linked_item` is present |
| `purchase_price` | `principal + down_payment` — `null` unless draft with `down_payment` set |
| `total_interest` | `monthly_payment × term_months − principal` — `null` unless draft. The total interest paid over the term, excluding the opening fee (not interest) |
| `total_amount_payable` (MTIC) | `monthly_payment × term_months + opening_fee` — `null` unless draft. A **simplified estimate**: principal + total interest + the one modeled fee, not the full legal MTIC (which can include stamp duty, insurance, etc. this app doesn't track) |

-----

## 9. UI Notes

- Loans is a dedicated tab within the dossier (`Capital · Monthly Expenses · Annual Expenses · Workbench · Goals · Loans · Emergency Fund · Settings`), following the same navigation and access patterns as Goals.
- The list view (`LoansTab`) shows each loan as a clickable card: name, status badge (`active` → brand, `draft` → neutral), monthly payment, `salary_pct` ("—" if null), interest rate, and — for active + linked loans — a coverage pill.
- The detail view (`LoanDetail`) shows: a summary card (status, payment, rate, term/months-left, principal/balance, salary + %), a coverage panel (active only), and the two scenario cards (active only).
- The form modal (`LoanFormModal`) mirrors `GoalFormModal`'s hand-rolled markup: name, status radio toggle, interest rate + salary (`parseDecimalInput`, accepts `,` or `.` as decimal separator), draft fields (principal + term) or active fields (balance + end date + linked-expense `<select>`) shown conditionally, and a live payment preview. The interest rate field is labeled "TAN (nominal rate, %)" on draft loans (with a hint not to use the TAEG) and "Interest rate (annual, %)" on active loans. Active mode's end date uses the same month-`<select>` + year-`<input>` pattern as `GoalFormModal`'s target date (storing `YYYY-MM`), with a live "N months left — calculated automatically" hint below it computed via `computeMonthsLeft()` — there is no direct months-left input anywhere. Draft mode additionally shows optional Purchase price/Down payment and TAEG/Opening fee rows, and the preview card adds live "Total interest paid" (red, mirroring the scenario calculators' green "interest saved") and "Total amount payable (MTIC, estimate)" figures below the monthly payment whenever a term is set.
- `LoanDetail`'s summary card shows an "End date" row (formatted as "Month YYYY") above the computed "Months left" row for active loans, and the same Total interest paid and MTIC estimate under the monthly payment for draft loans, plus Purchase price/Down payment, TAEG (labeled "reference only"), and Opening fee rows whenever those fields are set.
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
| `principal` | REAL (nullable) | Draft: amount borrowed |
| `term_months` | INTEGER (nullable) | Draft: total length |
| `remaining_balance` | REAL (nullable) | Active: amount still owing |
| `end_date` | TEXT (nullable) | Active: `YYYY-MM` the loan finishes; `months_left` is always derived from this (Section 4.1), never stored. Active-only; cleared on demotion to draft |
| `expense_template_item_id` | TEXT (nullable) | FK → `expense_template_items`, `ON DELETE SET NULL` |
| `down_payment` | REAL (nullable) | Draft-only; cleared on promotion to active |
| `taeg` | REAL (nullable) | Draft-only, reference-only (never used in the calc); cleared on promotion to active |
| `opening_fee` | REAL (nullable) | Draft-only; feeds `total_amount_payable`; cleared on promotion to active |
| `created_at` | TEXT | Creation timestamp |

No `position` or `updated_at` column (mirrors `goals`). List endpoint orders `ORDER BY created_at ASC`.

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
- `down_payment`, `taeg`, `opening_fee`: each null or a non-negative number; rejected (400) if set to a non-null value while the loan's effective status is `active`.
- `end_date`: rejected (400) if set to a non-null value while the loan's effective status is `draft`.
- `PUT` flipping `active → draft` forces `expense_template_item_id = NULL` and `end_date = NULL` regardless of what was sent.
- `PUT` flipping `draft → active` forces `down_payment`, `taeg`, and `opening_fee` all to `NULL` regardless of what was sent.

-----

## 12. Export / Import

- Export version **10** adds a `loans` array: `{ name, status, interest_rate, salary, principal, term_months, remaining_balance, end_date, created_at, down_payment, taeg, opening_fee, linked_expense_name }`. `linked_expense_name` is resolved via a `LEFT JOIN` to the expense template item's name (or `null` if unlinked), matching the Goals resolve-to-name export pattern. `down_payment`, `taeg`, and `opening_fee` are only meaningful for draft loans; imported as `null` for active loans regardless of the exported value. `end_date` is only meaningful for active loans; imported as `null` for draft loans regardless of the exported value. `months_left` is never exported — it's always re-derived at read time from `end_date`.
- Import accepts versions **1–10**. Loans are inserted with new UUIDs inside the same import transaction. The link is re-established only when `status === 'active'`, by matching `linked_expense_name` against the already-built `expenseTemplateNameToId` map (expense-section only) — the same map import already builds for expense template re-linking. A missing or unmatched name leaves the loan unlinked. Older exports (versions 1–9) have no `loans` key and simply import with zero loans.

-----

## 13. Known Limitations (out of scope for fixing here)

- A Workbench "apply to template" rename of a linked Fixed expense unlinks the loan (same semantics as cycle-item links — see Section 5.1).
- If duplicate template item names exist, re-linking (bulk-replace and import) picks the first match.
