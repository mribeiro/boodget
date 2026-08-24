# boodget

**Because handling your money shouldn't be scary.**

🌐 **[Project site & manual](https://mribeiro.github.io/boodget/)** —
overview, features, and a screenshot-driven user manual covering every
section of the app (source: [`landing/`](landing/), deployed via GitHub
Pages on every push to `main`).

boodget is a self-hosted personal finance application for tracking monthly
capital, running budget cycles, chasing goals, and keeping an eye on loans,
subscriptions, car costs, and annual bills — all from one dashboard, on
infrastructure you control.

It is built around a simple idea: you don't need to log every coffee
purchase to be in control of your money. A monthly capital snapshot plus a
lightweight budget cycle gives you a genuinely accurate picture of where you
stand and where you're going — without the maintenance burden of a
full transaction ledger. See
[**"High-level control without full transaction tracking"**](docs/PLATFORM_GUIDE.md#high-level-control-without-full-transaction-tracking)
in the full guide for the reasoning behind that choice.

---

## What it does

| Area | What it gives you |
|---|---|
| **Capital** | Monthly snapshots of every account's value, charted over time. Idle / Active / Stocks breakdown. |
| **Monthly Expenses** | Budget cycles aligned to your actual pay period (custom start day, not the 1st). Fixed expenses, budget items, distributions. |
| **Annual Expenses** | Multi-installment annual bills tracked against a yearly template, with carryover. |
| **Workbench** | A what-if scenario calculator for income vs. expenses vs. Must/Want/Save distributions. |
| **Goals** | Target amount + date, auto-tracked progress from distributions, manual entries, or history. |
| **Loans** | Draft (study) and active loans with amortization, scenario simulators, and expense-coverage checks. |
| **Car Expenses** | Actual (not budgeted) monthly/yearly cost per vehicle — mileage-driven energy cost, tagged expenses, and ad-hoc costs someone else pays. |
| **Subscriptions** | Recurring personal costs tracked against the distribution that funds them. |
| **Emergency Fund** | A savings-buffer target derived from your recent average spend. |
| **Glances** | An at-a-glance, colour-coded panel (Capital, Cycle, Next Expense, Goals) on every dossier. |
| **AI Advisor** | Optional, opt-in Claude-powered analysis and chat over a trimmed snapshot of your dossier. |
| **Notifications** | Browser push reminders before upcoming expenses. |
| **Sharing** | Multiple users, multiple dossiers, per-dossier access control, optional OIDC/SSO. |

For the full walkthrough — how each module works, the concepts that tie them
together, and the philosophy behind the design — see
**[docs/PLATFORM_GUIDE.md](docs/PLATFORM_GUIDE.md)**.

For contributor/AI-assistant-level technical detail (schema, API routes,
migrations, conventions), see **[CLAUDE.md](CLAUDE.md)** and the per-feature
specs in **[ai-spec/](ai-spec/)**.

## Quick start

```bash
git clone https://github.com/mribeiro/boodget
cd boodget
# edit SESSION_SECRET in docker-compose.yml before real use
docker compose up --build -d
```

The app is served at `http://localhost:3000`. On first launch, an in-browser
setup wizard walks you through creating the first user — nothing else is
accessible until that's done. Data lives in SQLite under `./data/` on the
host, so it survives container restarts and belongs entirely to you.

### Local development

```bash
cd backend && npm run dev    # API on :3000 (hot-reload)
cd frontend && npm run dev   # SPA on :5173 (proxies /api → :3000)
```

A `.devcontainer/` configuration is included for VS Code Dev Containers /
GitHub Codespaces.

## Tech stack

Node.js + Express (CommonJS) API, SQLite via `better-sqlite3`, React 18 SPA
built with Vite, and Docker for deployment. No external services required to
run the core app — the only optional outbound call is to the Claude API, and
only if you enable the AI Advisor. See
[docs/PLATFORM_GUIDE.md](docs/PLATFORM_GUIDE.md) for the architecture
diagram and [CLAUDE.md](CLAUDE.md) for the full tech stack table.

## Data ownership

Everything runs on your own server: no subscriptions, no third-party
analytics, no cloud account required. You can export a full dossier to JSON
at any time and re-import it (e.g. onto a fresh install), so nothing is
locked in.

## License

boodget's source is licensed under **AGPL-3.0, subject to the "Commons
Clause" License Condition** (see [`LICENSE`](LICENSE)) — a
**source-available**, not permissively-licensed, project: anyone may run,
study, and modify it, and any distributed modification (including one
exposed as a network service) must have its source made available under the
same license, but selling boodget or offering it as a paid hosted/managed
service is not permitted. See
[`landing/terms.html`](https://mribeiro.github.io/boodget/terms.html) for the
plain-language explanation, and
[`landing/privacy.html`](https://mribeiro.github.io/boodget/privacy.html)
for how the software itself handles data.

## Project status

Current version: **v0.1**. Both packages have an automated test suite
(Vitest) covering business-logic functions and API routes, run on every pull
request via CI — see [CLAUDE.md](CLAUDE.md#testing) for conventions and how
to run it locally.
