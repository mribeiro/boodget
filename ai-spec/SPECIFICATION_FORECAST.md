# boodget — Cash-flow Forecast Specification

## 1. Overview

The Forecast tab looks ahead over the next expense cycles and flags trouble before it happens: a cycle projected to end negative, an annual installment the annual fund can't cover, and when a loan payment ends and frees up money (#349). It also projects the dossier's **Capital** forward, so money put aside through savings distributions shows up as growth rather than as money gone.

It's the forward view over time; the Workbench remains the what-if for a single cycle. The forecast is **read-only and computed on the fly** — no tables, nothing stored.

## 2. Decisions (confirmed with the dossier owner)

| Question | Decision |
|---|---|
| Income of a future cycle | The **income template** (`income_template_items.default_value`) — what you plan with, not a recent average that a bonus would skew. |
| Carry-over | **Yes**: each cycle opens with the previous cycle's projected closing (the same way a new cycle's previous balance is prefilled). |
| Placement | Its **own dossier tab**, "Forecast", right after Monthly Expenses. |
| Horizon | **Selectable**: 6, 12 (default) or 24 cycles. |
| Which distributions are saving | A distribution's **Save part** (`save_amount`, from the Must/Want/Save split set in the Workbench/template). Its Must and Want parts are spent. A distribution with no split counts as spent. |
| What the savings line shows | **Projected Capital**: the Capital total (idle + active, as on the Capital tab) carried forward. |
| Investment growth | An optional per-dossier **expected annual return %** (`forecast_expected_return_pct`, 0–30, default none), applied to invested money. |

## 3. Three tracks

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

### 3.3 Capital track

The cycle track only follows the main account, where a distribution is money leaving. But a savings distribution only moves money to another account you own, so the Capital track follows the **Capital total** instead.

- **Configured** when the dossier has at least one filled Capital snapshot. Otherwise `capital` is `null` on every cycle and in the summary, and the tab shows a hint to fill one in.
- **Start**: the latest filled snapshot's idle + active total — the same `capital_total` the Capital tab shows (stocks excluded). It's split into **cash** (idle accounts) and **invested** (active accounts).
- **Per cycle**:
  - **Cash flow** = income − expenses − distributions. It's the same arithmetic as the cycle track, and it goes to cash.
  - **Kept**: for each distribution, its Save part (`min(save_amount, value)`), or all of it for a contributing annual-fund distribution, since that money sits in the fund's account until a bill is paid. Kept money moves to invested, so it stays in Capital.
  - **Growth**: invested × the monthly rate, `(1 + return/100)^(1/12) − 1`, on the cycle's opening balance (none while invested is negative or no return is set).
  - **Annual bills**: every unpaid annual installment due in the cycle leaves invested money, whether or not the annual fund is configured.
  - `closing = opening + cash flow + kept + growth − annual bills`.
- **The current cycle** is already running, and its salary is already in the accounts, since cycles start on payday. So it adds no income, and only takes what's still outstanding: unpaid Fixed items, the part of a Budget not spent yet, and distributions not done yet (with their kept part). Untracked and included draft loan payments count in full.
- **Save parts** live on the template (cycle items don't carry the split). A running cycle's item is matched to its template item by `template_item_id`, then by name.
- **Summary** (`capital`): `{ as_of, start, end, saved_total, growth_total, return_pct }`.

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
  - `cycles[]`: `{ name, start, end, source: 'cycle'|'template', opening, income, expenses, distributions, closing, annual_fund: null|{opening, in, out[{name, amount, date}], closing}, capital: null|{opening, cash_flow, saved, growth, annual_bills, closing}, events[] }`;
  - `flags[]`: `negative_cycle` (first cycle closing below zero), `fund_shortfall`, and one `untracked_loan` per loan;
  - `lowest` (the lowest closing and its cycle);
  - `fund_configured`, `template_fallbacks[]`;
  - `capital` (`null` without a filled snapshot, else `{ as_of: 'YYYY-MM', start, end, saved_total, growth_total, return_pct }`);
  - `draft_loans[]` (`{ id, name, monthly_payment, included }`).
- Amounts are rounded to cents.

Implementation: `backend/src/routes/forecast.js`.
- `loadForecastInputs(dossierId, now)` reads everything from the DB.
- `computeForecast(inputs, { horizon, budgetMode, includeDraftLoanIds, returnPct })` is pure and exported for unit tests, like `computeSummary`. `returnPct` overrides the dossier's `expected_return_pct` input.
- The expected return is the dossier setting `forecast_expected_return_pct` (migration `050`), read and written through `GET`/`PATCH /settings` (`400` outside 0–30). It's exported with the dossier settings, and an import with an out-of-range value stores `null`.
- `summarizeForecastForAi` trims the result for the AI Advisor.

## 7. UI (`frontend/src/components/forecast/ForecastTab.jsx`)

- **Header**: a horizon `<select>` (6/12/24) and a budget-mode `<select>` ("Budgets at their max" / "Budgets at usual spending"), plus a one-line explanation that it's a projection.
- **Alerts**:
  - an amber note for each template fallback;
  - an amber warning for a negative cycle or a fund shortfall;
  - an amber note for each untracked loan.
- **`KpiStrip`**:
  - the closing at the end of the horizon;
  - the lowest closing (red when negative);
  - the annual fund (its closing, or "Short X €" in red at the first shortfall);
  - Capital at the end of the horizon, with its change from today (green when up, red when down).
- **Chart**: a recharts line chart of the cycle closing (brand colour) and the annual fund (green, only when configured), with a dashed red zero line (named in the legend as "0 € (below = in the red)", since it's a fixed baseline, not a series). Line animation is off, so a re-render never leaves the lines half-drawn.
- **Capital card**, below the cash-flow chart:
  - an **Expected return** text input (`% / year`, parsed with `parseRateInput`). It saves the dossier setting when the field is left or Enter is pressed, then reloads. An empty field means none; anything outside 0–30 shows an error.
  - a one-line explanation naming the snapshot month;
  - Today, Saved over N cycles, Growth (only when a return is set) and End of the last cycle;
  - its own line chart, starting at "Today" (the snapshot) and auto-scaled, so it isn't flattened against the cycle closings.
  - Without a snapshot, the card only shows a hint.
- **"What if I take…"**: one `Checkbox` per draft loan.
- **Cycle table**: one row per cycle with a "Current"/"Opened" badge for stored cycles and icons for a loan ending or installments due.
  - Columns are income, out (expenses + distributions), closing (red when negative), annual fund and Capital.
  - Each row expands to show the dates, the source, the arithmetic of each track and the events.
  - The table scrolls horizontally on phones (`min-width: 560px`, or `660px` with the Capital column).
- The result is published to `pageContext`, so the AI chat can use the page.

## 8. AI Advisor

`buildDossierContext` includes `forecast` = `summarizeForecastForAi` of a 12-cycle planned-budget forecast. It contains:
- the first cycle;
- `lowest_projected_closing`;
- `first_negative_cycle`;
- `annual_fund_first_shortfall`;
- `loan_endings`;
- `untracked_loans`;
- `capital`: the snapshot month, today's total, the projected end, saved and growth over the horizon, and the expected return;
- a `closing_series` with the annual fund and Capital closings.

It never includes the per-cycle item breakdown. All three prompt intros describe it:
- a negative cycle or a fund shortfall is a concrete upcoming risk;
- a loan ending is freed-up capacity;
- `saved_over_horizon` measures the savings rate, and growth is an assumption;
- the whole thing is a projection.

## 9. Validation dossier

The preview seed (`backend/src/db/seed.js`, `SEED_ON_EMPTY=true`) includes **"Forecast — Validation"**, a dossier built so that every forecast figure is a round number someone can check by hand. Its dates are all relative to today, so the figures are the same whenever it's seeded. `backend/test/db/seed.test.js` pins them.

Setup:
- **Income template**: Salary 2.900 €.
- **Expense template**:
  - Rent 900 €, Utilities 120 € and Car Loan Payment 350 € (Fixed);
  - Groceries, a Budget item with a 400 € max;
  - distributions:
    - Annual fund 250 € (contributing to the annual fund);
    - Savings 100 € and Investments 600 € (all Save);
    - Personal 200 € (Want 150 €, Save 50 €).
- **Cycles**:
  - three closed cycles, where Groceries spent 360/340/350 €, so the "usual" average is 350 €;
  - the current cycle (idx0), opening 150 €;
  - the next cycle (idx1), already opened, with a one-off Dentist 200 € on top of the template.
- **Loans** (all 0% TAN, so payments are exact):
  - Car Loan, active, 1.400 € over 4 months = 350 €, linked to Car Loan Payment; its last payment falls in idx3;
  - Personal Loan, active, 600 € over 12 months = 50 €, no linked expense, so it's untracked; its last payment falls in idx11;
  - Kitchen Renovation, a draft, 6.000 € over 48 months = 125 €.
- **Capital snapshot**: Current Account 1.250 € (idle), Annual Savings 700 € and Investments 10.050 € (active), 12.000 € in all. No expected return is set, so the figures stay round.
- **Annual fund**: Annual Savings at 700 € in the latest Capital snapshot, plus Annual fund at 250 € per cycle. Installments fall on day 1 of the month each cycle ends in:
  - Car Insurance 600 € (idx2);
  - Holiday 1.500 € (idx4);
  - IMI 2 × 450 € (idx5 and idx11).
  - That's 3.000 € a year in and 3.000 € a year out, so the pattern repeats in the second year.

Expected (planned budgets, no draft):

| Cycle | idx0 | idx1 | idx2 | idx3 | idx4 | idx5 | idx6 | idx7 | idx8 | idx9 | idx10 | idx11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Closing | 80 | −190 | −260 | **−330** | −50 | 230 | 510 | 790 | 1.070 | 1.350 | 1.630 | 1.910 |
| Annual fund | 950 | 1.200 | 850 | 1.100 | **−150** | −350 | −100 | 150 | 400 | 650 | 900 | 700 |
| Capital | 11.230 | 11.960 | 12.290 | 13.220 | 13.000 | 13.830 | 15.110 | 16.390 | 17.670 | 18.950 | 20.230 | 21.060 |

- **Closings**:
  - each cycle moves by −70 € (2.900 − 1.770 − 1.150 = −20 € from the template, plus the untracked 50 €), with idx1 also paying the Dentist;
  - after the Car Loan ends, each cycle moves by +280 €;
  - after the Personal Loan ends, by +330 €, reaching 5.870 € at idx23.
- **Flags**:
  - `negative_cycle` at idx1;
  - lowest closing −330 € at idx3;
  - `fund_shortfall` for Holiday at idx4, short by 150 €;
  - `untracked_loan` for Personal Loan;
  - `loan_ends` events at idx3 (Car Loan, frees 350 €) and idx11 (Personal Loan, frees 50 €).
- **Capital**:
  - Each cycle keeps 1.000 € of its distributions: Annual fund 250 €, Savings 100 €, Investments 600 € and Personal's Save part, 50 €.
  - idx0 takes only what's still outstanding, and no income: −620 € unpaid or unspent (Car Loan Payment 350 €, 220 € of Groceries, the untracked loan 50 €) − 1.150 € of distributions + 1.000 € kept = −770 €.
  - Later cycles add their cash flow + 1.000 € kept − annual bills, ending at 34.020 € at idx23. That's 24.000 € saved over 24 cycles.
  - With a 4 % return, the first cycle grows by 10.750 € × ((1,04)^(1/12) − 1) ≈ 35,19 €.
- **"Usual" budgets** add 50 € per cycle: 130, −90, −110, −130, 200, 530, …
- **Ticking Kitchen Renovation** takes 125 € more per cycle: −45, −440, −635, −830, −675, −520, …
