# boodget — Subscriptions Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md` and `SPECIFICATION_MONTHLY_EXPENSES.md`. Read both before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Subscriptions** section is a new top-level tab within each dossier, alongside Capital, Monthly Expenses, Workbench, Goals, and Loans.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

Subscriptions are recurring personal costs (streaming, software, etc.) the user deliberately does **not** track as a Monthly Expense — they're funded out of a **distribution** taken from salary, not budgeted for directly. The Subscriptions tab is a lightweight registry: it gives visibility into total recurring cost, and optionally checks that visibility against the distribution meant to fund it, so subscription creep against a fixed personal-spending budget doesn't go unnoticed.

Unlike Loans, Subscriptions have no scenario calculators or amortization math — it's a flat list with an add/edit modal, no detail page. It follows Loans' persistence pattern (a standalone table, no cycle items, `created_at ASC` ordering, no `position`) rather than the Fixed-expense/cycle-item pattern — subscriptions are not copied into cycles and have no per-cycle paid/unpaid state.

-----

## 2. Subscription fields

| Field | Description |
|---|---|
| **Name** | Free text label (e.g. "Claude", "Apple One") |
| **Monthly cost** | Non-negative number, monthly cadence only — no annual/other billing cycles |
| **Billing day** | Optional integer 1–31. Purely informational/display — used to sort the list (Section 4), no cycle items, reminders, or Glances integration |
| **Status** | `active` or `cancelled`. Cancelled is a soft state kept for history — it drops out of totals/coverage and is hidden from the list by default (Section 5) |
| **Linked distribution** | Optional FK to a distribution `expense_template_items` row (`section = 'distribution'`) in the same dossier. **Many subscriptions may link to the same distribution** (e.g. two subscriptions paid off one card funded by one "Personal" distribution) |

No category/vendor field — the name is considered sufficient context. No per-cycle payment tracking.

-----

## 3. Coverage calculation

For each distribution linked by at least one **active** subscription, sum every active subscription's `monthly_cost` linked to it and compare the total against that distribution template item's own `value` (its full budgeted amount — the same figure shown in the Monthly Expenses template, functionally equal to `must_amount + want_amount + save_amount` when that optional decomposition is filled in consistently).

- `covered = distribution.value >= linkedTotal - 0.005` (same epsilon convention as Loans' expense-coverage check).
- `difference = distribution.value - linkedTotal`.

Computed client-side in `SubscriptionsTab.jsx` from the list response (each subscription embeds its `linked_distribution: {id, name, value}`, mirroring Loans' `linked_item`) — no dedicated coverage endpoint. Shown as a green "Covered" / red "Over by €X" pill next to the distribution name on every row linked to it.

Cancelled subscriptions never count toward a distribution's linked total.

-----

## 4. Sorting

The list is sorted with the same wraparound convention as Fixed expenses (`ExpenseTemplate.jsx`/`CycleEditor.jsx`, CLAUDE.md rule 10): subscriptions with a billing day ≥ `cycle_start_day` first (ascending), then those with a billing day < `cycle_start_day` (ascending), then subscriptions with no billing day last (same treatment as Budget items in the expense sort).

-----

## 5. API

```
GET    /api/dossiers/:id/subscriptions?includeCancelled=true
POST   /api/dossiers/:id/subscriptions   { name, monthly_cost, billing_day?, distribution_template_item_id? }
PATCH  /api/dossiers/:id/subscriptions/:subscriptionId  { name?, monthly_cost?, billing_day?, status?, distribution_template_item_id? }
DELETE /api/dossiers/:id/subscriptions/:subscriptionId
```

- `GET` excludes `status = 'cancelled'` unless `includeCancelled=true` is passed (mirrors Accounts' `includeArchived`). Ordered `created_at ASC`.
- `POST`/`PATCH` validate `distribution_template_item_id` resolves to an `expense_template_items` row in the same dossier with `section = 'distribution'` (400 otherwise).
- `DELETE` is a genuine hard delete — cancelling via `PATCH { status: 'cancelled' }` is the soft, history-preserving path; deleting is for outright mistakes.
- No draft/active-style field-locking rules like Loans — every field is editable regardless of status.

-----

## 6. UI behavior (`SubscriptionsTab.jsx`)

- Flat list, no detail page. Rows are plain flex-row cards (`CycleEditor.jsx`'s expense-row pattern — a wrapping flex container per row, not a `<table>`), identical markup on mobile and desktop: all fields and actions are always visible inline, nothing hidden behind a tap-to-expand interaction (unlike `ExpenseTemplate.jsx`'s `mobile-cards` table pattern).
- A `KpiStrip` above the list: total monthly cost (active subscriptions only) and active subscription count.
- "Show cancelled" / "Hide cancelled" toggle, off (hidden) by default.
- Row actions — icon-only, no border (`CycleEditor.jsx`'s exact button style: no background, no border, muted color, `title` tooltip): Edit (opens the add/edit modal), Cancel (`ConfirmModal` — active rows only, since it drops the subscription out of totals/coverage) / Reactivate (cancelled rows, no confirm), Delete (`ConfirmModal`, danger, hard delete).
- `SubscriptionFormModal`: name, monthly cost, billing day (optional), linked distribution `<select>` populated from the dossier's expense template distributions (fetched via the existing `GET /expense-template`, filtered client-side to `section === 'distribution'` — no new endpoint).

-----

## 7. Export / Import

Round-trips as `subscriptions[]` in the dossier export (version **11+**; see CLAUDE.md rule 11 for the full format):

```json
{ "name": "Claude", "monthly_cost": 20, "billing_day": 5, "status": "active", "created_at": "...", "distribution_name": "Investment Top-up" }
```

`distribution_name` is re-linked by name on import (same pattern as Loans' `linked_expense_name`) — `null` if unlinked or if the named distribution no longer exists in the imported dossier. Imports of versions ≤ 10 have no `subscriptions` key and default to `[]`.

-----

## 8. AI Advisor integration

Active subscriptions are included in `buildDossierContext` (see `SPECIFICATION_AI_ADVISOR.md`) as `{name, monthly_cost, billing_day, linked_distribution}` per item, plus a `total_monthly_cost`. All three prompt intros instruct the model to compare a distribution's total linked subscriptions against that distribution's budgeted value and flag it as a risk if exceeded. Cancelled subscriptions are excluded — they no longer cost anything and aren't relevant to the analysis.
