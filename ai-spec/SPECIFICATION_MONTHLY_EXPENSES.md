# Capital Tracker — Monthly Expenses Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`. Read both before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- The **Monthly Expenses** section is already visible in the UI as "Coming Soon" (per the main spec). This document defines its full implementation.
- Before generating any files, **propose the folder structure and any schema changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed.

---

## 1. Overview

The Monthly Expenses section allows users to track recurring and occasional expenses and money distributions within a dossier, organised around **cycles** — the period between salary payments.

---

## 2. Dossier Settings

A new **Settings** section must be added to each dossier. It is designed to accommodate future configuration options.

For this phase, the only setting is:

| Setting | Description | Default |
|---|---|---|
| **Cycle start day** | Day of the month on which the cycle begins (i.e. the day the salary is received) | 25 |

Settings are accessible to all users with access to the dossier (same permission model as the rest of the dossier).

---

## 3. Cycles

### 3.1 Definition

A **cycle** represents the period between two salary payments. It is named after the month it transitions **into**.

**Example:** The **March cycle** runs from **25 February to 24 March** (when the cycle start day is 25).

### 3.2 Rules

- A dossier can have **only one open cycle at a time**.
- The same cycle (month + year) **cannot be created twice**.
- Cycles are displayed in **chronological order**.
- There is **no reset** for a cycle — once opened, it cannot be reverted to an unopened state.

### 3.3 Opening a Cycle

When a cycle is opened, the user must provide:

| Field | Description |
|---|---|
| **Salary received** | The salary amount received this cycle |
| **Previous balance** | The leftover balance from the previous cycle (entered manually) |

Both fields can be **updated at any time** after opening.

### 3.4 Closing a Cycle

- A cycle can be **closed** by the user at any time.
- Closing a cycle requires entering a **final real balance** — the actual amount left in the account at the end of the cycle.
- The system compares the final real balance against the **expected balance** (calculated — see Section 7).
- A closed cycle **remains fully editable** — the user can correct values after closing.
- There is no automatic suggestion of the previous cycle's final balance as the next cycle's previous balance — this is always entered manually.

---

## 4. Expense Templates

### 4.1 Structure

Each dossier has exactly **one expense template**, divided into two independent tabs:

- **Expenses** — fixed and budget-type expenses
- **Distributions** — money allocations to accounts or purposes

Changing the template **does not affect** existing cycles. New template entries only appear in **future cycles**.

### 4.2 Expense Entry (in template)

| Field | Fixed expense | Budget expense |
|---|---|---|
| **Name** | ✅ | ✅ |
| **Type** | `Fixed` | `Budget` |
| **Value** | Exact amount | Maximum amount |
| **Day of payment** | Day of calendar month | — |

### 4.3 Distribution Entry (in template)

| Field | Description |
|---|---|
| **Name** | Free text label (e.g. "Emergency fund") |
| **Value** | Amount to distribute |

---

## 5. Expenses

### 5.1 Types

Expenses are of two subtypes:

#### Fixed Expense

- Has a **name**, **exact value**, and **day of payment** (calendar day of the month).
- Has a status: **paid** or **unpaid**.

#### Budget Expense

- Has a **name** and a **maximum value**.
- Tracks a single **accumulated spent value** (no transaction history).
- The spent value can be updated at any time during the cycle.
- The spent value **cannot exceed the maximum**.
- The maximum can be **increased** at any time within the cycle.
- Has no day of payment.
- Has no paid/unpaid status.

### 5.2 Cycle Day Ordering

Expenses are ordered by their **cycle day** — the position within the cycle based on the day of payment.

- If the payment day is **≥ cycle start day** → it falls in the **first calendar month** of the cycle.
- If the payment day is **< cycle start day** → it falls in the **second calendar month** of the cycle.

**Example** (cycle start day = 25, March cycle = 25 Feb → 24 Mar):
- Payment day 27 → 27 February → cycle day 3
- Payment day 5 → 5 March → cycle day 9

Budget expenses (no day of payment) are displayed **at the end**, after all fixed expenses.

### 5.3 Adding Expenses in a Cycle

When a cycle is opened, all template expenses are **copied** into the cycle as independent entries.

Users can also add **ad-hoc expenses** at any time during the cycle. These behave identically to template-derived expenses after creation.

### 5.4 Overrides per Cycle

For template-derived expenses, the user can override:

- **Value** (for fixed expenses)
- **Day of payment** (for fixed expenses)

Ad-hoc expenses can be freely edited.

---

## 6. Distributions

- Each distribution has a **name**, **value**, and status: **done** or **not done**.
- No day of payment.
- When a cycle is opened, all template distributions are **copied** into the cycle as independent entries.
- Ad-hoc distributions can be added at any time and behave identically after creation.

---

## 7. Cycle Summary

The following values must be displayed in a summary section for each cycle:

| Field | Calculation |
|---|---|
| **Total available** | Salary received + Previous balance |
| **Total expenses** | Sum of all fixed expense values + Sum of all budget maximums |
| **Total expenses paid** | Sum of paid fixed expenses + Sum of budget spent values |
| **Total expenses unpaid** | Total expenses − Total expenses paid |
| **Total distributions** | Sum of all distribution values |
| **Total distributions done** | Sum of done distributions |
| **Total distributions not done** | Total distributions − Total distributions done |
| **Expected balance** | Total available − Total expenses − Total distributions |
| **Final real balance** | Entered manually when closing the cycle (shown only if cycle is closed) |
| **Balance difference** | Final real balance − Expected balance (shown only if cycle is closed) |

> Additional calculated fields may be defined in future iterations.

---

## 8. UI Notes

- The **Monthly Expenses** section follows the same navigation and access patterns as the Capital section.
- The **template** is accessible from a dedicated area within the dossier (not per-cycle).
- The **Settings** section is accessible from the dossier and clearly separated from functional sections.
- The **Dossier Settings**, **Expense Template**, and **Cycles** should be clearly distinct areas in the UI.
- Tabs for **Expenses** and **Distributions** must be visually clear and indicate they are two separate concepts within the same template.

---

## 9. Out of Scope (this phase)

- Closing/locking a cycle in a way that prevents editing
- Automatic pre-fill of previous balance from prior cycle
- Transaction history for budget expenses
- Multi-currency support for expenses
- Notifications or reminders for upcoming payments
- Workbench section
