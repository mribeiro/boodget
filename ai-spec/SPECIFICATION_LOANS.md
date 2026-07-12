# boodget — Loans Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, and `SPECIFICATION_GOALS.md`. Read all three before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Loans** section is a new section within each dossier, alongside Capital, Monthly Expenses, Workbench, and Goals.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Loans section lets users configure loans per dossier. Each loan is either a **draft** (a study/what-if scenario) or an **active** loan (a real, ongoing one being tracked). Both compute a monthly payment via the standard annuity formula and show what percentage of a stored salary that payment represents. Active loans can optionally be linked to a Fixed monthly-expense template item to check whether the budgeted value covers the payment, and offer two ephemeral scenario calculators (downpayment, target payment).

-----

## 2. Loan Definition

### 2.1 Fields (common to both statuses)

| Field | Description |
|---|---|
| **Name** | Free text label for the loan |
| **Status** | `draft` or `active` — see Section 3 |
| **Interest rate** | Annual nominal percentage (e.g. `3.5` = 3.5%), 0–100 |
| **Salary** | Per-loan editable value. Prefilled from the dossier's **most recent expense cycle's salary** when creating a loan; can be changed at any time and does not follow the cycle afterward |

### 2.2 Draft-only fields

| Field | Description |
|---|---|
| **Principal** | Amount borrowed (must be > 0) |
| **Term (months)** | Total loan length (integer ≥ 1) |

### 2.3 Active-only fields

| Field | Description |
|---|---|
| **Remaining balance** | Amount still owing (must be > 0) |
| **Months left** | Remaining number of months (integer ≥ 1) |
| **Linked expense** | Optional. A Fixed expense template item in the same dossier used to check budget coverage (Section 5) |

### 2.4 Constraints

- A dossier can have multiple loans, in either status, simultaneously.
- Draft loans **cannot** be linked to an expense template item — the link field is only meaningful once a loan is active.
- Loans can be edited and deleted at any time.

-----

## 3. Status: Draft vs Active

| Status | Meaning | Payment computed from |
|---|---|---|
| **Draft** | A study/what-if — not a real ongoing loan | `principal`, `interest_rate`, `term_months` |
| **Active** | A real ongoing loan being tracked | `remaining_balance`, `interest_rate`, `months_left` |

### 3.1 Status Transitions

- Status can be toggled **both ways** (draft → active, active → draft) at any time via the edit form.
- Toggling **preserves all field values** on both sides — switching to draft doesn't erase `remaining_balance`/`months_left`, and switching to active doesn't erase `principal`/`term_months`. Only the fields relevant to the *new* status are validated as required.
- Demoting **active → draft** always clears the expense link (`expense_template_item_id` is forced to `NULL`), since draft loans cannot carry a link.

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

Both scenarios are **ephemeral** — component-local state on the loan detail page, recomputed on every keystroke via `frontend/src/utils/loanMath.js`. Nothing is persisted.

### 7.1 Downpayment Scenario

Given a hypothetical downpayment `X` paid now against the current `remaining_balance` (`balance`), at the current `interest_rate` (`r` monthly) and `months_left`:

- **Current payment** `M` = the loan's existing computed monthly payment.
- If `X ≥ balance`: the loan is paid off entirely; all remaining interest (`M·months_left − balance`) is shown as saved, and no further breakdown is computed.
- Otherwise, both outcomes are shown side by side:
  - **Lower payment, same term**: recompute the annuity payment on `balance − X` over the unchanged `months_left`.
  - **Same payment, shorter term**: solve for the new term `n′` that keeps the payment at `M` against the reduced balance:
    - `r > 0`: `n′ = ln(M / (M − (balance−X)·r)) / ln(1+r)`, ceiled for display.
    - `r = 0`: `n′ = (balance−X) / M`.
  - **Interest saved** (computed against the *exact*, non-ceiled `n′`, not the displayed rounded value): `(M·months_left − balance) − (M·n′ − (balance−X))`.

### 7.2 Target Payment Scenario

Given a desired target monthly payment `Y` (must be less than the current payment to be meaningful):

- `lumpSumNeeded = balance − Y·(1 − (1+r)^−months_left) / r` (or `balance − Y·months_left` when `r = 0`), clamped to a minimum of 0.
- If `Y` is already greater than or equal to the current payment, no lump sum is needed — the UI shows a message instead of a figure.

-----

## 8. Calculated Values Summary

Every loan API response (list and detail) includes, spread alongside the stored fields:

| Field | Description |
|---|---|
| `monthly_payment` | Computed via Section 4 |
| `salary_pct` | Section 6 |
| `latest_cycle_salary` | Section 6 |
| `linked_item` | Section 5 — `null` unless active + linked + item still exists |
| `covered` | Section 5 — `null` unless `linked_item` is present |
| `coverage_difference` | Section 5 — `null` unless `linked_item` is present |

-----

## 9. UI Notes

- Loans is a dedicated tab within the dossier (`Capital · Monthly Expenses · Annual Expenses · Workbench · Goals · Loans · Emergency Fund · Settings`), following the same navigation and access patterns as Goals.
- The list view (`LoansTab`) shows each loan as a clickable card: name, status badge (`active` → brand, `draft` → neutral), monthly payment, `salary_pct` ("—" if null), interest rate, and — for active + linked loans — a coverage pill.
- The detail view (`LoanDetail`) shows: a summary card (status, payment, rate, term/months-left, principal/balance, salary + %), a coverage panel (active only), and the two scenario cards (active only).
- The form modal (`LoanFormModal`) mirrors `GoalFormModal`'s hand-rolled markup: name, status radio toggle, interest rate + salary (`parseDecimalInput`, accepts `,` or `.` as decimal separator), draft fields (principal + term) or active fields (balance + months left + linked-expense `<select>`) shown conditionally, and a live payment preview.
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
| `months_left` | INTEGER (nullable) | Active: months remaining |
| `expense_template_item_id` | TEXT (nullable) | FK → `expense_template_items`, `ON DELETE SET NULL` |
| `created_at` | TEXT | Creation timestamp |

No `position` or `updated_at` column (mirrors `goals`). List endpoint orders `ORDER BY created_at ASC`.

-----

## 11. API Contract

```
GET    /api/dossiers/:id/loans
POST   /api/dossiers/:id/loans           { name, status, interest_rate, salary?, principal?, term_months?, remaining_balance?, months_left?, expense_template_item_id? }
GET    /api/dossiers/:id/loans/:loanId
PUT    /api/dossiers/:id/loans/:loanId   (partial merge, goals-style)
DELETE /api/dossiers/:id/loans/:loanId
```

Validation (400 on failure):
- `name` required (non-empty after trim).
- `status` ∈ `{draft, active}`.
- `interest_rate` between 0 and 100.
- `salary` null or ≥ 0.
- Effective-status requirements: `draft` → `principal > 0` and integer `term_months ≥ 1`; `active` → `remaining_balance > 0` and integer `months_left ≥ 1`. The other status's fields are preserved (if present) but not required.
- `expense_template_item_id`: rejected (400) if the loan's effective status is `draft`; otherwise must resolve to a same-dossier `expense_template_items` row with `section='expense' AND type='Fixed'`, else 400.
- `PUT` flipping `active → draft` forces `expense_template_item_id = NULL` regardless of what was sent.

-----

## 12. Export / Import

- Export version **10** adds a `loans` array: `{ name, status, interest_rate, salary, principal, term_months, remaining_balance, months_left, created_at, linked_expense_name }`. `linked_expense_name` is resolved via a `LEFT JOIN` to the expense template item's name (or `null` if unlinked), matching the Goals resolve-to-name export pattern.
- Import accepts versions **1–10**. Loans are inserted with new UUIDs inside the same import transaction. The link is re-established only when `status === 'active'`, by matching `linked_expense_name` against the already-built `expenseTemplateNameToId` map (expense-section only) — the same map import already builds for expense template re-linking. A missing or unmatched name leaves the loan unlinked. Older exports (versions 1–9) have no `loans` key and simply import with zero loans.

-----

## 13. Known Limitations (out of scope for fixing here)

- A Workbench "apply to template" rename of a linked Fixed expense unlinks the loan (same semantics as cycle-item links — see Section 5.1).
- If duplicate template item names exist, re-linking (bulk-replace and import) picks the first match.
