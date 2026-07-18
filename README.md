# boodget

**Because handling your money shouldn't be scary.**

boodget (this repository: `capital-tracker`) is a self-hosted personal finance
application for tracking monthly capital, running budget cycles, chasing
goals, and keeping an eye on loans, subscriptions, and annual bills — all
from one dashboard, on infrastructure you control.

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
git clone https://github.com/ViBE-MiNDS/capital-tracker
cd capital-tracker
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

## Project status

Current version: **v0.1**. No automated test suite yet — see
[CLAUDE.md](CLAUDE.md#no-test-suite) for the testing approach in the
meantime.
