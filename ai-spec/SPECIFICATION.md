# boodget — Application Specification

## 0. Instructions for Claude Code

- The **git repository root is the working directory**. Generate all project files (backend, frontend, docker-compose, etc.) directly in this root.
- **Read this specification fully before writing any code.**
- Before generating any files, **propose the folder structure** and wait for approval.
- Do **not overwrite** any files that already exist in the repository (e.g. `.gitignore`, `README.md`) unless explicitly instructed.

---

## 1. Overview

A simple web-based system to help users track their capital at the beginning of each month, enabling month-over-month comparison and evolution analysis.

---

## 2. Architecture

| Layer    | Description                                                                 |
|----------|-----------------------------------------------------------------------------|
| Frontend | Single Page Application (SPA) — responsive, works on desktop and smartphone |
| Backend  | REST/JSON API                                                               |
| Database | SQLite                                                                      |

### 2.1 Tech Stack

| Layer    | Technology        |
|----------|-------------------|
| Backend  | Node.js + Express |
| Frontend | React             |
| Database | SQLite            |

- Prefer **simplicity over features**. Lightweight, well-known frameworks only.
- All tools must be **free and open-source licensed**.
- All code, comments, UI text, and documentation must be written in **English**.

---

## 3. Docker & Deployment

- The full stack must be runnable with a **single `docker-compose up`** command.
- SQLite database must be stored in a **persistent volume mapped to the host filesystem**, so data survives container restarts.
- Suitable for home-server / self-hosted environments.
- No cloud dependencies required.
- A **devcontainer configuration** (`.devcontainer/`) must be included to support development inside a container (e.g. VS Code Dev Containers, GitHub Codespaces).

---

## 4. Authentication

### 4.1 Local Authentication
- Username + password.
- Password rules: minimum **16 characters**, must include uppercase letters, lowercase letters, numbers, and symbols.
- Users can change their own **password** from within the app (local accounts only).
- **Usernames never change.**
- Password recovery via a **bash script that runs inside the Docker container** (e.g. via `docker exec`). No SMTP/email flow.
- Sessions expire after **72 hours**.

### 4.2 OIDC Integration (optional / configurable)
- The system must support OIDC as an authentication provider, using the **Authorization Code Flow**.
- OIDC is configured via **environment variables**.
- When OIDC is enabled, **local authentication continues to work in parallel**.
- When an OIDC user logs in:
  - Matching to an existing local account is done **by username** (`preferred_username` claim).
  - If a match is found, the existing local account is loaded.
  - If no match is found, a new account is automatically created.
- OIDC users **cannot change their password** within the app (managed externally by the OIDC provider).

---

## 5. First Launch

- On first launch, the system detects that no users exist and presents an **in-browser setup wizard**.
- The wizard prompts the creation of the first user before anything else is accessible.

---

## 6. Users

- The system supports **multiple users**.
- Any existing user can **create** or **delete** other users.
- There are **no roles or permission levels** — all users have the same permissions.
  - *(Note: an admin role concept is planned for a future iteration.)*

### 6.1 User Deletion
- When a user is deleted, **all dossiers they created are also deleted**, including all associated months, snapshots, and accounts.

---

## 7. Dossiers

### 7.1 Definition
A dossier has:
- A **name**
- A set of **months**
- A set of **accounts**

### 7.2 Ownership & Deletion
- Only the **creator** can delete a dossier.

### 7.3 Sharing
- The dossier **creator** can share the dossier with other users.
- The creator can also **revoke access** from any user at any time.
- Only the creator can manage sharing — users with shared access **cannot re-share** the dossier.
- Users with shared access can **view and edit** the dossier (add months, fill in values, reset, etc.).

### 7.4 Sections
A dossier is composed of three sections. **Only "Capital" is in scope for this phase.**

| Section          | Status         |
|------------------|----------------|
| Capital          | ✅ In scope     |
| Monthly Expenses | 🔜 Coming Soon  |
| Workbench        | 🔜 Coming Soon  |

The other sections must be visible in the UI but marked as **"Coming Soon"**.

---

## 8. Accounts

- Accounts are **exclusive to a dossier** — not shared between dossiers.
- Each account has:
  - **Group** — groups multiple accounts together (e.g. bank name)
  - **Name** — the account identifier within the group
  - **Type** — one of:
    - `Risk Investment`
    - `Guaranteed Investment`
    - `Current Account`
  - **Money category** — one of `Idle`, `Active`, `Stocks`. `Stocks` is meant for unvested/illiquid holdings (e.g. unvested company equity) that should never be mixed into the regular Capital total. Defaults to `Active`. See §11.1 below for how each category feeds into totals.
  - **Can receive transfers?** — boolean flag, default **on** (defaults to **off** for `Stocks` accounts at creation, since unvested stock can't fund a distribution — can still be flipped manually). Controls whether the account can be picked as a distribution's funding account (see `SPECIFICATION_MONTHLY_EXPENSES.md` §6.1). Turning it off only blocks *new* assignments — distributions already linked to the account keep that link.

### 8.1 Adding Accounts
- Any user with access to the dossier can add new accounts at any time.
- Adding a new account **does not affect previous monthly records** — historical snapshots remain unchanged.

### 8.2 Deleting Accounts
- Accounts can be deleted.
- Deletion **archives** the account: it no longer appears for future months, but remains visible in historical records where it was previously used.

---

## 9. Months

### 9.1 Rules
- A dossier starts with **no months**.
- The **same month cannot be added twice** (e.g. two entries for February 2026 are not allowed).
- Months must always be displayed in **chronological order**, regardless of insertion order.

### 9.2 Month State
- A month is either **filled** or **not filled** — no draft/closed/locked states.
- A month can always be **edited** or **reset** by anyone with access to the dossier.

### 9.3 Capital Snapshot
When a month is opened, the user:
- Sees **all accounts that existed at the time** the month was created (including currently archived ones, if they existed then).
- Enters the **current value** for each account (decimal number, 2 decimal places, currency symbol only).
- Optionally adds a **comment per account entry**.
- Optionally adds a **comment to the overall month snapshot**.

### 9.4 Submitting
- On submit, data is saved and can later be **viewed**, **edited**, or **reset**.
- **Reset** clears all values and all comments (per account and snapshot-level), returning the month to an unfilled state — exactly as if it had just been created.
- After reset, archived accounts that existed when the month was created **remain visible and editable**.

---

## 10. Currency

- Currency is **Euro (€)** for now.
- Currency is represented as a **symbol only** (e.g. `€`).
- All monetary values support **2 decimal places**.
- *(Multi-currency support is out of scope for this phase but the currency should be stored as a configurable field to allow future extension.)*

---

## 11. Analysis / Visualisation

- A **line chart** showing the evolution of **total capital** (sum of `Idle` + `Active` accounts only) month over month, in **chronological order**, plus separate `Idle` and `Stocks` lines.
- The Capital compare table and month editor mirror this breakdown: a Total row/column that excludes `Stocks`, plus separate Idle and Stocks subtotal rows.
- *(Further breakdowns — by account type, by group — are planned for future iterations.)*

### 11.1 Money categories and derived totals

Each account belongs to exactly one money category: `Idle`, `Active`, or `Stocks`. Three figures are derived from monthly snapshot values:

| Figure | Formula | Meaning |
|---|---|---|
| **Capital** (the headline total everywhere) | Idle + Active | "How much real money I have" — never includes Stocks. |
| **Stocks** | Stocks only | Unvested/illiquid holdings, tracked separately. |
| **Overall** | Idle + Active + Stocks | "How much I have overall," including unvested stock. |
| **Savings potential** | Idle + Stocks | "How much I could still turn into savings" — idle cash not yet invested, plus stock once vested. |

`Overall` and `Savings potential` are shown only alongside the Stocks glance card (see `SPECIFICATION_GLANCES.md`), never as part of the main Capital total.

---

## 12. Out of Scope (this phase)

- Admin role / permission levels
- Monthly Expenses section
- Workbench section
- Capital breakdown by account type or group in the chart
- Email / SMTP of any kind
- Multi-currency support
- PWA / offline mode
- Native mobile app
