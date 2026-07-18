# The boodget Platform Guide

This is the human-facing companion to [`CLAUDE.md`](../CLAUDE.md) and the
[`ai-spec/`](../ai-spec/) specifications, which are written for contributors
and AI coding assistants working *on* the codebase. This document explains
the platform from the outside: what it is for, how its pieces fit together,
how you're meant to use it month to month, and — because it's the question
every new user eventually asks — why tracking your capital and your budget
cycles at a high level is enough to be genuinely in control of your money,
even though boodget never asks you to log a single transaction.

## Table of contents

1. [What boodget is](#what-boodget-is)
2. [Architecture, in brief](#architecture-in-brief)
3. [Core concepts](#core-concepts)
4. [Main features](#main-features)
5. [A typical month](#a-typical-month)
6. [Usage philosophy](#usage-philosophy)
7. [High-level control without full transaction tracking](#high-level-control-without-full-transaction-tracking)
8. [Data ownership and self-hosting](#data-ownership-and-self-hosting)
9. [Getting started](#getting-started)

---

## What boodget is

boodget is a self-hosted personal finance application built around two
questions people actually ask themselves about money:

1. **"Is my net worth going up or down?"** — answered by the **Capital**
   module: a monthly snapshot of every account you track.
2. **"Will I make it to the end of the month?"** — answered by the
   **Monthly Expenses** module: a budget cycle aligned to your real pay
   period, with fixed bills, flexible budgets, and planned distributions.

Everything else in the app — Goals, Loans, Subscriptions, Annual Expenses,
the Emergency Fund tracker, the Workbench scenario calculator, and the
optional AI Advisor — exists to make those two questions easier to answer
with confidence, and to turn the answer into a plan.

boodget is explicitly **not** a transaction-level budgeting tool. It doesn't
connect to your bank, doesn't categorize individual purchases, and doesn't
ask you to reconcile a ledger. It works one level up from that, and the
[philosophy section below](#high-level-control-without-full-transaction-tracking)
explains why that's a deliberate, defensible design choice rather than a
missing feature.

## Architecture, in brief

```
┌─────────────────────┐        ┌──────────────────────┐
│   React 18 SPA       │  /api  │  Node.js + Express    │
│   (Vite, PWA)         │◄──────►│  REST API (CommonJS)  │
└─────────────────────┘        └──────────┬───────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  SQLite          │
                                   │  (better-sqlite3)│
                                   │  ./data/*.db     │
                                   └──────────────────┘
```

- **Frontend**: a React single-page app, installable as a PWA, talking to
  the backend exclusively through a thin fetch wrapper (`services/api.js`).
- **Backend**: a REST/JSON Express API. All business logic — cycle math,
  emergency fund targets, loan amortization, goal progress — lives here,
  computed synchronously against SQLite on every request.
- **Database**: a single SQLite file. No separate database server to run,
  back up, or lose network connectivity to. Schema changes are applied via
  an append-only migration list at startup.
- **Deployment**: one `docker-compose up`. The SQLite file is bind-mounted
  to the host so it survives container rebuilds.
- **Notifications**: an optional `node-cron` scheduler sends Web Push
  reminders for upcoming expenses — no third-party notification service.
- **AI Advisor**: the one component that talks to the outside world, and
  only if you turn it on. It calls the Claude API with a deliberately
  trimmed, summarized snapshot of a single dossier — never raw transaction
  data, because none exists.

See `CLAUDE.md` for the full directory layout, schema, and API route list.

## Core concepts

boodget organizes everything around a handful of concepts. Understanding
these five makes the rest of the app self-explanatory.

- **Dossier** — your top-level container. Everything else (accounts,
  months, cycles, goals, loans...) belongs to exactly one dossier. Most
  people have one dossier for personal finances; some split "Personal" and
  "Work Savings" or run a joint dossier shared with a partner.
- **Account** — something with a balance: a bank account, an investment
  fund, unvested equity. Each account is `idle` (cash-like), `active`
  (invested), or `stocks` (illiquid/unvested — tracked but excluded from
  your main Capital figure until it vests).
- **Month** — a snapshot: the value of every account on roughly the first
  of the month. Enough of these, charted, is your net-worth curve.
- **Expense Cycle** — a budget period that runs from your chosen start day
  (e.g. the 25th) to the day before that, next month — matching a typical
  payday, not the calendar. A cycle has a salary, a starting balance, a list
  of fixed/budget expenses, and a list of distributions (money you route
  out to savings, goals, or discretionary spending).
- **Distribution** — a planned outflow from a cycle that isn't a bill: "into
  savings," "into the emergency fund," "spending money." Distributions are
  the connective tissue between the Monthly Expenses module and Goals,
  Subscriptions, and the Annual Expenses fund — they're where "budgeted
  intent" turns into a number other modules can consume.

Everything else — Goals, Loans, Subscriptions, the Emergency Fund, Annual
Expenses, the Workbench — is a purpose-built lens on top of these five
concepts, not a separate data model bolted on the side.

## Main features

### Capital
Record each account's value once a month and get an evolution chart, a
month-over-month compare table, and an idle/active/stocks breakdown. This
is the balance-sheet side of the app: a point-in-time snapshot, not a
transaction feed.

### Monthly Expenses (budget cycles)
Define a reusable **expense template** (your recurring fixed bills and
planned distributions) once; each new cycle copies it in a click. During
the cycle, tick fixed expenses as paid, update budget items' spent amounts,
and mark distributions done. The cycle math (`salary + previous balance −
expenses − distributions`) gives you a running "expected leftover" without
you ever entering a single line-item purchase.

### Annual Expenses
Big, infrequent bills (insurance, car tax, gifts) don't fit a monthly
template well. The Annual Expenses module spreads a yearly template across
installments, tracks a carryover balance, and tells you the monthly average
you should be setting aside — so a €1,200 annual bill never blindsides a
single month's budget.

### Workbench
A sandbox for "what if I got a raise," "what if rent went up," or "what if
I moved €200/month from Want to Save." It's ephemeral by default, but you
can save named snapshots to compare scenarios side by side, and load one
of them as your new working template.

### Goals
A target amount and a target date, with progress tracked automatically from
linked distributions, a fixed manual monthly contribution, or ad-hoc/
historical entries. Each goal auto-computes as active, completed, or
failed against its own trajectory — no manual bookkeeping needed to know if
you're on pace.

### Loans
Model a loan before you take it out (**draft**: principal, term, rate) or
track one you already have (**active**: remaining balance, end date, rate).
Both expose the same three scenario calculators (extra downpayment, target
payment, rate change) and a full amortization schedule, so a "should I
refinance" question has a concrete answer in seconds.

### Subscriptions
Recurring personal costs (streaming, software) tracked separately from your
expense template, since they're usually funded out of a distribution rather
than budgeted line by line. Link a subscription to the distribution that
funds it and boodget tells you whether that distribution's budget still
covers everything linked to it.

### Emergency Fund
A target of *N* months of average spend, computed from your recent cycles
plus any extra known monthly costs. One status: healthy, underfunded, or
"not enough data yet." No manual recalculation required as your spending
pattern shifts — the average simply moves with you.

### Glances
Four colour-coded cards — Capital, Current Cycle, Next Expense, Goals — on
every dossier's page, condensed to a fixed footprint so scanning them takes
seconds. Amber and red states surface exactly the things that need
attention (an unfilled snapshot, an overdue bill, an underfunded reserve);
everything else stays quietly neutral.

### AI Advisor (optional)
An opt-in tab that sends a trimmed, summarized snapshot of a dossier to the
Claude API and returns a structured health score, highlights, and risks, or
answers free-form questions in a chat. It's off by default at the code
level in spirit — every dossier can disable it entirely — and every
response shows its estimated cost. A "copy this prompt" export lets you get
the same analysis by pasting into claude.ai with no API key at all.

### Notifications & sharing
Optional browser push reminders before upcoming fixed expenses, and
multi-user dossier sharing (with optional OIDC/SSO) so a household can work
from the same numbers without a shared login.

## A typical month

1. **Open the month.** Enter each account's current value. Takes a couple
   of minutes; the Capital chart updates itself.
2. **Open the cycle.** The expense template copies in automatically —
   fixed bills, budget categories, planned distributions.
3. **Live with it.** As bills come due, tick them paid. As you spend from a
   budget category, update its running total (a handful of times a month,
   not per-purchase). As planned transfers happen, mark distributions done.
4. **Check Glances.** The panel tells you if anything needs attention
   before you'd have noticed it yourself.
5. **Close the cycle.** Confirm the real final balance; it becomes next
   cycle's starting point.

That's the entire operating loop. Everything else in the app — Goals,
Loans, the Emergency Fund, the AI Advisor — reads from the numbers this
loop produces; none of them ask you to do more bookkeeping than this.

## Usage philosophy

Three principles run through every feature in boodget:

- **Snapshots and cycles over ledgers.** You record *state* (an account
  balance, a budget category's running total) at a cadence you control,
  not every event that produced that state. See the next section for why
  this is enough.
- **Plans are first-class, not an afterthought.** The Workbench, Goals, and
  distributions all model *intent* — what you meant to do with your money —
  alongside what actually happened, so the app can point out drift between
  the two instead of just reporting history.
- **Self-hosted by default, cloud by invitation only.** The entire app runs
  offline-capable on your own hardware. The one feature that reaches the
  outside world (the AI Advisor) is opt-in, dossier-scoped, and shows you
  exactly what it sends and what it costs, every time.

## High-level control without full transaction tracking

This is the question every new user eventually asks: *"How can I actually
be in control of my money if I never record what I bought?"*

**The short answer:** control comes from the frequency and structure of
your feedback loop, not from the granularity of what feeds it. A monthly
capital snapshot plus a per-cycle budget check gives you a feedback loop
that is frequent enough, structured enough, and accurate enough to catch
every problem that actually matters — while a transaction ledger mostly
adds maintenance cost for information you were already going to get from
the two numbers that matter: **what came in, what's left.**

Here's the reasoning behind that, from a few different angles.

### 1. Two numbers dominate every financial outcome

Almost every meaningful financial outcome — did I overspend, am I saving
enough, can I afford this — reduces to two quantities: **net worth over
time** (the Capital chart) and **cash left at the end of a period** (the
cycle's expected/real leftover). A transaction ledger is one way to derive
those two numbers; a direct snapshot of account balances and a direct
tally of budget-category totals is another, shorter path to the *same*
numbers. If the destination is identical, the shorter path isn't a
compromise — it's the efficient one.

### 2. Precision below the level you act on is noise, not signal

You don't make different decisions because you know you spent €4.30 on a
coffee instead of €4.10. You make different decisions when a *budget
category* (groceries, dining out) is trending over its cap, or when your
*leftover for the cycle* is heading negative. boodget's Budget items track
exactly that: a running "spent" figure against a "max," updated as often
as you like, without needing the receipts that produced it. This mirrors
how organizations actually run budgets — a department tracks spend against
a line-item budget, not every vendor invoice, at the level where decisions
get made.

### 3. It matches how accountants already separate the two questions

Financial reporting has, for centuries, separated the **balance sheet**
(state at a point in time — what boodget's Capital snapshots are) from the
**income statement** (flows over a period — what boodget's expense cycles
summarize) without ever requiring an individual reading it to review every
underlying transaction. Auditors formalize this as **materiality**: you
verify a statement is accurate to the level that would change a decision,
not to the last cent of every line. boodget applies that same materiality
threshold by default — a budget category, a fixed bill, a distribution —
because that's the level at which you actually act.

### 4. It matches how control theory says feedback loops should work

In control-systems terms, a feedback loop needs to sample **often enough
relative to how fast the system can go wrong**, not with maximum possible
resolution. A bank account doesn't swing from healthy to overdrawn between
Tuesday and Wednesday — but it absolutely can swing from healthy to
overdrawn across a month of unchecked spending, or across a year of a
budget category quietly running over. boodget's cadence — a snapshot a
month, a check on cycle progress as often as you open the app, a nudge from
Glances when something crosses a threshold — is sized to that actual rate
of drift. A transaction-level ledger samples far faster than the system
can meaningfully change, at a maintenance cost that scales with every
individual purchase instead of with how often you need to intervene.

### 5. It's honest about where transaction-level tools actually fail

Tools that require logging every transaction have a well-documented
adoption problem: the fidelity of the data degrades under the very
condition it's supposed to detect — a busy, stressful month is exactly
when logging stops. A system that only needs a monthly account balance and
an occasional budget-category update degrades gracefully instead: even a
lightly-maintained cycle still tells you your net worth trend and whether
you're roughly on budget, because those two figures don't depend on every
individual entry being present.

### The comparison, side by side

| | Transaction-level tracking | boodget's snapshot + cycle model |
|---|---|---|
| **What you record** | Every purchase, categorized | Account balances (monthly) + budget-category totals (as often as useful) |
| **Setup/maintenance cost** | High — every transaction, forever | Low — a snapshot a month, a handful of budget updates per cycle |
| **Resolution below the decision threshold** | Full (and mostly unused) | None — by design, matched to materiality |
| **Degrades under neglect** | Badly — missing transactions silently corrupt totals | Gracefully — a skipped update just means less-fresh data, not wrong data |
| **Answers "is my net worth growing?"** | Yes, derived from category totals | Yes, directly |
| **Answers "will I make it to the end of the cycle?"** | Yes, derived from category totals | Yes, directly, from the cycle's leftover calculation |
| **Answers "did I spend €6 too much on coffee on the 14th?"** | Yes | No — and this was never the question that mattered |
| **Data entry model** | Continuous | Periodic (monthly + per-cycle) |
| **Matches** | Detailed bookkeeping / audit trail | Balance-sheet + budget/income-statement view, materiality-scoped |

**The statement, plainly:** boodget gives you real financial control — not
a simplified or "good enough" substitute for it — because control is a
property of your feedback loop's frequency and structure relative to how
fast your finances can actually change, not a property of how many
individual transactions you've logged. A monthly snapshot and a per-cycle
budget check sample that loop at exactly the rate that matters, at a
fraction of the maintenance cost, and — because the cost is low — are far
more likely to actually be kept up in the months you need them most.

## Data ownership and self-hosting

boodget's philosophy of "enough data, not maximal data" extends to how the
platform itself is run: it's self-hosted, stores everything in a single
SQLite file you control, requires no third-party account to function, and
supports full JSON export/import of a dossier at any time. The one
component that talks to an external service — the AI Advisor — is opt-in
per dossier, tells you exactly what it sends, and offers a zero-API-key
alternative (export a prompt and paste it into claude.ai yourself).

## Getting started

```bash
git clone https://github.com/ViBE-MiNDS/capital-tracker
cd capital-tracker
# edit SESSION_SECRET in docker-compose.yml before real use
docker compose up --build -d
```

Open `http://localhost:3000`, complete the first-user setup wizard, create
a dossier, add your accounts, and open your first month and first cycle.
That's the entire onboarding — everything described above builds on those
same few actions.

For technical/contributor documentation (schema, migrations, API routes,
frontend conventions), see [`CLAUDE.md`](../CLAUDE.md) and the per-feature
specs in [`ai-spec/`](../ai-spec/).
