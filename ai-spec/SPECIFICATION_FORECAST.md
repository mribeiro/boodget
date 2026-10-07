# boodget — Cash-flow Forecast Specification

## 1. Overview

The Forecast tab looks ahead over the next expense cycles and flags trouble before it happens: a cycle projected to end negative, an annual installment the annual fund can't cover, and when a loan payment ends and frees up money (#349).

It's the forward view over time; the Workbench remains the what-if for a single cycle. The forecast is **read-only and computed on the fly** — no tables, nothing stored.

## 2. Decisions (confirmed with the dossier owner)

| Question | Decision |
|---|---|
| Income of a future cycle | The **income template** (`income_template_items.default_value`) — what you plan with, not a recent average that a bonus would skew. |
| Carry-over | **Yes**: each cycle opens with the previous cycle's projected closing (the same way a new cycle's previous balance is prefilled). |
| Placement | Its **own dossier tab**, "Forecast", right after Monthly Expenses. |
| Horizon | **Selectable**: 6, 12 (default) or 24 cycles. |

## 3. Two tracks

### 3.1 Cycle track (main account)

For each cycle in the horizon: `closing = opening + income − expenses − distributions`, and the next cycle's `opening` is this `closing`. The figures follow `computeSummary`'s expected balance (Fixed items at their value, Budget items at their max, every distribution).

- **The current cycle** — the stored cycle whose window covers today — uses its **real** items, income lines and `previous_balance` (its opening). Any later cycle that's already been opened (and isn't closed) also uses its real items. A closed cycle is never part of the horizon.
- **Every other cycle** uses the template: the income template's total, every expense template item, every distribution template item.
- **When the current cycle hasn't been opened yet**, the first cycle is a template cycle, and it opens with the latest earlier cycle's `final_real_balance` if that cycle was closed, else its expected balance (0 when there's no cycle at all).
- **Empty template fallback.** If the income template has no items, or the expense template has none, the latest cycle's income total (or its expense and distribution items) stands in for that part of the template, so the projection doesn't show zero income or zero spending for every future cycle. The response lists these as `template_fallbacks[]` (`{ part: 'income' | 'expenses', cycle }`), and the tab shows a note pointing to Settings.
- **Windows.** A stored cycle keeps its own `actual_start_date`/`actual_end_date`. A cycle not opened yet is dated with the dossier's **live** `cycle_start_day`/`cycle_start_weekend_adjustment` (`computeCycleStartDate`/`computeTheoreticalCycleEndDate`). This is a forward-looking prediction, which the Expense Cycle rules allow for cycles that don't exist yet. A cycle is named after the month it ends in.

### 3.2 Annual fund track

Annual installments are paid from the annual fund, not from the cycle balance, so they're a separate track.

- **Configured** when the dossier has contributing accounts or contributing distributions (Annual Expenses → `annual_expense_accounts` / `annual_expense_distributions`, the same two sources as the year status). Otherwise `annual_fund` is `null` on every cycle and `fund_configured: false`. Installments still appear as events.
- **Opening**: the contributing accounts' value in the latest filled Capital snapshot (non-archived accounts only).
- **Per cycle**: plus the contributing distributions' values for that cycle (in a running cycle, only those not yet `done`, since a done one is already in the account balance), minus every **unpaid** installment whose date falls inside the cycle's window, in date order.
- **Installments** come from the year instance (`annual_expense_year_installments`, amount `budgeted_value ÷ num_installments`) where that year exists, else from the annual template (`value ÷ num_installments`). Days past a month's end clamp to its last day. Installments with a paid payment are skipped.
- **Shortfall**: the first installment that takes the running fund below zero raises a `fund_shortfall` flag naming the item, amount, date, cycle and how much short.

## 4. Budget items: planned vs. usual

- **Planned** (default): a Budget item counts at its full `max` — conservative.
- **Usual**: at the average `spent` over the last N closed cycles, where N is `emergency_fund_cycles_to_average`. Cycle items are matched to template items by `template_item_id`, falling back to name for items a template bulk-replace orphaned. An item with no closed history stays at its max.
- In a running cycle a Budget item never counts below what's already been spent.

## 5. Loans and subscriptions

- An **active loan linked to a Fixed template item** is already in the template. Its last payment is due on `day_of_payment` (clamped) of its `end_date` month (`loanLastDueDate`). Template cycles that start after that date drop the item, and the cycle holding the last payment gets a `loan_ends` event ("frees X €/cycle from the next cycle").
- An **active loan with no linked expense** (and not matured) is added as its own outflow, at its `monthly_payment`, in every cycle up to its last payment (`untracked_loan_payment` events). It's also flagged `untracked_loan`, the same idea as the Loans tab's "Not tracked" pill.
- **Draft loans** are ignored unless the user ticks them under "What if I take…" (`include_draft`). An included draft adds its `monthly_payment` to every cycle in the horizon (`draft_loan_payment` events).
- **Subscriptions** are not added: they're funded by distributions, which are already counted.

## 6. API

```
GET /api/dossiers/:id/forecast?horizon=6|12|24&budget=planned|usual&include_draft=<loanId>,<loanId>
```

- `400` on any other `horizon` or `budget` value.
- Response:
  - `horizon` and `budget_mode`;
  - `cycles[]`: `{ name, start, end, source: 'cycle'|'template', opening, income, expenses, distributions, closing, annual_fund: null|{opening, in, out[{name, amount, date}], closing}, events[] }`;
  - `flags[]`: `negative_cycle` (first cycle closing below zero), `fund_shortfall`, and one `untracked_loan` per loan;
  - `lowest` (the lowest closing and its cycle);
  - `fund_configured`, `template_fallbacks[]`;
  - `draft_loans[]` (`{ id, name, monthly_payment, included }`).
- Amounts are rounded to cents.

Implementation: `backend/src/routes/forecast.js`.
- `loadForecastInputs(dossierId, now)` reads everything from the DB.
- `computeForecast(inputs, { horizon, budgetMode, includeDraftLoanIds })` is pure and exported for unit tests, like `computeSummary`.
- `summarizeForecastForAi` trims the result for the AI Advisor.

## 7. UI (`frontend/src/components/forecast/ForecastTab.jsx`)

- **Header**: a horizon `<select>` (6/12/24) and a budget-mode `<select>` ("Budgets at their max" / "Budgets at usual spending"), plus a one-line explanation that it's a projection.
- **Alerts**:
  - an amber note for each template fallback;
  - an amber warning for a negative cycle or a fund shortfall;
  - an amber note for each untracked loan.
- **`KpiStrip`**: the closing at the end of the horizon, the lowest closing (red when negative), and the annual fund (its closing, or "Short X €" in red at the first shortfall).
- **Chart**: a recharts line chart of the cycle closing (brand colour) and the annual fund (green, only when configured), with a dashed red zero line. Line animation is off, so a re-render never leaves the lines half-drawn.
- **"What if I take…"**: one `Checkbox` per draft loan.
- **Cycle table**: one row per cycle with a "Current"/"Opened" badge for stored cycles and icons for a loan ending or installments due. Columns are income, out (expenses + distributions), closing (red when negative) and annual fund. Each row expands to show the dates, the source, the arithmetic and the events. The table scrolls horizontally on phones (`min-width: 560px`).
- The result is published to `pageContext`, so the AI chat can use the page.

## 8. AI Advisor

`buildDossierContext` includes `forecast` = `summarizeForecastForAi` of a 12-cycle planned-budget forecast. It contains:
- the first cycle;
- `lowest_projected_closing`;
- `first_negative_cycle`;
- `annual_fund_first_shortfall`;
- `loan_endings`;
- `untracked_loans`;
- a `closing_series` with the annual fund closing.

It never includes the per-cycle item breakdown. All three prompt intros describe it: a negative cycle or a fund shortfall is a concrete upcoming risk, a loan ending is freed-up capacity, and the whole thing is a projection.
