# boodget — Enable Banking Integration Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md`. Read it before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- This feature adds an **optional integration** with [Enable Banking](https://enablebanking.com) (a PSD2 open-banking aggregator) so a user can authenticate with their real bank, map real bank accounts to existing boodget `accounts`, and pull the bank's live balance into a monthly snapshot.
- Before generating any files, **propose the folder structure and any schema changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Enable Banking integration lets a user connect a real bank via an OAuth-style consent flow, then map each of the bank's accounts to an existing boodget `account`. Once mapped, the user can refresh the current month's entry for a mapped account with the bank's live balance instead of typing it in by hand — a two-step **fetch-preview-then-apply** flow, mirroring the Paperless-ngx integration's UX.

The integration is **per-dossier** and **entirely optional** — dossiers without Enable Banking configuration behave exactly as before. It does not introduce any new financial concept: it only populates the `value` of an existing `month_entries` row, which every other feature (Capital totals, Glances, the AI Advisor, Emergency Fund) already consumes.

-----

## 2. Dossier Settings

Three new settings are added to the **Dossier Settings** tab, grouped under a dedicated "Enable Banking Integration" section. All Enable Banking configuration is settable per-dossier through this UI — env vars are optional operator-wide fallbacks only, never a hard requirement.

### 2.1 Settings Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enablebanking_application_id` | text (nullable) | null | Application ID issued by the Enable Banking Control Panel |
| `enablebanking_private_key` | text (nullable) | null | PEM-encoded RSA private key used to sign API requests (JWT, RS256) |
| `enablebanking_redirect_uri` | text (nullable) | null | Full OAuth callback URL whitelisted for this dossier's Enable Banking application (e.g. `https://your-domain.example.com/bank/callback`) — must exactly match, since Enable Banking rejects a mismatched `redirect_url`. This app's landing page for it is always the frontend route `/bank/callback`, regardless of dossier. |

### 2.2 UI Notes

- The **Private Key** input is a multi-line `<textarea>` (a PEM key spans several lines), unlike the single-line `<input>` used for other secrets in this app.
- All three fields must be filled for the integration to be considered **active**. If any is missing, the "Connect a bank" action is hidden.
- Each field falls back to an operator-wide env var (`ENABLE_BANKING_APPLICATION_ID` / `ENABLE_BANKING_PRIVATE_KEY` / `ENABLE_BANKING_REDIRECT_URI`) when the dossier hasn't set its own — the same precedence as the AI Advisor's `ai_api_key` / `ANTHROPIC_API_KEY`. The fallback exists purely for operator convenience (e.g. a single-dossier deployment); it is never required, since the requirement is that Settings UI configuration works standalone.

### 2.3 API

The existing settings endpoints are extended:

- `GET /api/dossiers/:id/settings` — now also returns `enablebanking_application_id` (raw), `enablebanking_private_key_set` (boolean), and `enablebanking_redirect_uri` (raw — not a secret).
- `PATCH /api/dossiers/:id/settings` — now also accepts `enablebanking_application_id`, `enablebanking_private_key`, and `enablebanking_redirect_uri`.

`enablebanking_private_key` is stored in plain text in SQLite (same acceptable-for-self-hosted convention as `paperless_token`/`ai_api_key`). It is **never returned to the frontend** — `GET /settings` returns `enablebanking_private_key_set` instead. Sending `null` clears it. `enablebanking_redirect_uri` is not a secret and is returned as-is.

-----

## 3. Bank Connections & Account Mapping

### 3.1 Bank Connection

A **Bank Connection** represents one successful consent with one bank (ASPSP). A dossier may have any number of connections. Each connection has:

| Field | Description |
|---|---|
| `aspsp_name` / `aspsp_country` | The bank's identity as returned by Enable Banking's `/aspsps` list |
| `session_id` | Enable Banking's session identifier from the `/sessions` exchange |
| `status` | `active`, `expired`, or `revoked` |
| `valid_until` | Session expiry (PSD2 sessions last up to ~90 days; **no refresh token** — full re-consent is required after expiry) |

Disconnecting a connection sets `status = 'revoked'` — the row and its account mappings are **kept**, not deleted, so reconnecting the same bank later can restore the previous mappings.

### 3.2 Bank Connection Account

Each bank account returned by a connection's `/sessions` exchange is stored as a **Bank Connection Account**: `external_account_uid` (Enable Banking's session-scoped account id), `iban`, `currency`, `display_name`, and a nullable `account_id` — the mapping to a boodget `account`.

Mapping is strictly **1:1**: one boodget account can be mapped to at most one bank connection account at a time (`409` if a `PATCH` tries to map an account that's already mapped elsewhere). Mapping to an archived account is rejected (`400`). Archiving a boodget account (`DELETE /accounts/:accountId`) clears any mapping pointing to it.

### 3.3 Reconnect Carry-Forward

When a new connection is created for a dossier that already has a prior (now `expired`/`revoked`) connection to the same `aspsp_name`+`aspsp_country`, each new bank account is pre-populated with the prior connection's mapping — matched by **IBAN first** (the durable identifier across sessions), falling back to `external_account_uid` (not guaranteed stable for every ASPSP) when IBAN is absent. The match is applied directly (not merely suggested) but remains fully editable on the mapping screen afterward.

-----

## 4. OAuth Flow & Session Lifecycle

### 4.1 Starting a Connection

```
POST /api/dossiers/:id/bank/connections/start
{ "aspsp_name": "...", "aspsp_country": "...", "psu_type": "personal" }
→ { "url": "https://..." }
```

The backend signs a JWT (RS256, `kid` = application ID) and calls Enable Banking's `POST /auth`, requesting a redirect to the dossier's `enablebanking_redirect_uri` (the fixed, whitelisted `/bank/callback` frontend path). Before returning the redirect `url`, it stores a **pending connection request** row keyed by a random `state` value (15-minute TTL) — since the callback path is fixed and dossier-agnostic (it cannot carry a dossier id in its URL), this row is what lets the callback recover which dossier and user initiated the flow.

The frontend navigates the full browser (`window.location.href = url`) to the returned URL — the user then authenticates with their bank and gives consent there.

### 4.2 Callback

The bank redirects back to `{enablebanking_redirect_uri}?code=...&state=...` (or `?error=...` if the user cancelled consent). The frontend's `/bank/callback` page calls:

```
POST /api/bank/callback
{ "code": "...", "state": "..." }
→ { "dossier_id": "...", "connection_id": "..." }
```

This endpoint is **dossier-agnostic** (mounted at the top level, not under `/dossiers/:id`) since the whitelisted redirect carries no dossier id. It:

1. Looks up the pending request by `state` — `410` if missing or past its TTL.
2. Deletes the pending row immediately (**single-use** — a replayed `state` also 410s).
3. Re-checks that the logged-in user still has access to the pending request's `dossier_id` — `403` if not (defense in depth beyond the `state` match itself).
4. Exchanges the `code` via Enable Banking's `POST /sessions` — `502` on upstream failure.
5. Inserts the `bank_connections` row and one `bank_connection_accounts` row per returned account, running the reconnect carry-forward match (§3.3).

### 4.3 Expiry

A connection's `valid_until` is checked lazily (no proactive notification in this version — see §8): whenever the connections list or a balance preview is requested, an `active` connection past its `valid_until` is treated as expired. The UI offers a **Reconnect** action that re-runs the start flow for the same bank.

-----

## 5. Balance Refresh (Month-Level Fetch/Apply)

Mirrors the Paperless-ngx integration's two-step **fetch-preview-then-apply** pattern, scoped to **the month currently open in `MonthEditor`** — there is no way to target an arbitrary past month from the connections panel in this version.

### 5.1 Fetch

```
GET /api/dossiers/:id/bank/months/:monthId/balances-preview
→ { "results": [{ "account_id", "account_name", "current_value", "current_comment",
                   "proposed_value", "bank_display_name", "as_of" }],
    "warnings": ["..."] }
```

For every account in this month's snapshot that's mapped via an `active`, non-expired bank connection, the backend calls Enable Banking's `GET /accounts/{uid}/balances`. A per-account failure (expired connection, upstream error, no balance returned) becomes a `warnings[]` entry rather than failing the whole request — one dead connection shouldn't block refreshing the others.

Preconditions: `400` if Enable Banking isn't configured for the dossier; an empty `results`/`warnings` (not an error) if there are no mapped accounts in this month.

### 5.2 Apply

```
POST /api/dossiers/:id/bank/months/:monthId/balances-apply
{ "entries": [{ "account_id": "...", "value": 1234.56 }] }
→ { "updated": 1 }
```

Writes into the month's existing `month_entries` rows only (never inserts — every `account_id` must already be part of the month's snapshot, `400` otherwise). Does not touch `comment`.

### 5.3 MonthEditor UI

A **"Refresh from bank"** button appears in `MonthEditor` whenever the month has at least one account mapped via an active bank connection (`bankable_accounts_count` on `GET /months/:monthId`). Clicking it opens a preview modal (Account / Current / Bank balance / As of, with a per-row checkbox, all pre-selected) — **Apply** calls the endpoint above for the checked rows and reloads the month, exactly like the existing "Add to month" (sync-accounts) flow.

-----

## 6. Schema Changes

### 6.1 Migration `039_enable_banking_integration`

**`dossiers` table** — 2 new columns:

| Column | Type | Default |
|---|---|---|
| `enablebanking_application_id` | TEXT | NULL |
| `enablebanking_private_key` | TEXT | NULL |

### 6.1a Migration `040_add_enablebanking_redirect_uri_to_dossiers`

**`dossiers` table** — 1 new column, added in a follow-up migration (appended, not merged into `039`, per the migration system's append-only rule):

| Column | Type | Default |
|---|---|---|
| `enablebanking_redirect_uri` | TEXT | NULL |

**New table `bank_connections`**:

| Column | Type |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `dossier_id` | TEXT NOT NULL REFERENCES dossiers(id) |
| `aspsp_name` | TEXT NOT NULL |
| `aspsp_country` | TEXT NOT NULL |
| `session_id` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'active' CHECK IN ('active','expired','revoked') |
| `valid_until` | TEXT NOT NULL |
| `created_at` | TEXT |

**New table `bank_connection_accounts`**:

| Column | Type |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `connection_id` | TEXT NOT NULL REFERENCES bank_connections(id) |
| `external_account_uid` | TEXT NOT NULL |
| `iban` | TEXT (nullable) |
| `currency` | TEXT (nullable) |
| `display_name` | TEXT (nullable) |
| `account_id` | TEXT (nullable) REFERENCES accounts(id) ON DELETE SET NULL |

`UNIQUE(connection_id, external_account_uid)`.

**New table `bank_connection_requests`** (pending OAuth state, single-use, 15-minute TTL):

| Column | Type |
|---|---|
| `state` | TEXT PRIMARY KEY |
| `dossier_id` | TEXT NOT NULL REFERENCES dossiers(id) |
| `user_id` | TEXT NOT NULL REFERENCES users(id) |
| `aspsp_name` / `aspsp_country` | TEXT NOT NULL |
| `created_at` / `expires_at` | TEXT |

All columns/tables added idempotently (`PRAGMA table_info`/`CREATE TABLE IF NOT EXISTS` guards), following the existing migration pattern.

-----

## 7. Export / Import

- `enablebanking_application_id` and `enablebanking_private_key` are **excluded** from the dossier export, same as `paperless_token`/`ai_api_key`.
- `bank_connections`, `bank_connection_accounts`, and `bank_connection_requests` are **not exported at all** — a bank connection is inherently non-portable (it's tied to one Enable Banking application registration and to a session that expires regardless), so there is nothing meaningful to restore on import. An imported dossier always starts with Enable Banking fully unconfigured, same as a brand-new dossier.
- This does **not** change the export payload shape, so the export format version is **not** bumped for this feature.

-----

## 8. Out of Scope (this phase)

- Summing multiple bank accounts into a single boodget account (mapping is strictly 1:1).
- Proactive "your bank connection is about to expire" notifications — expiry is surfaced lazily (as a badge) when the user views the connections panel, not pushed.
- Refreshing a balance into any month other than the one currently open in `MonthEditor`.
- Payment initiation (PIS) — this integration only reads account information (AIS).
- Multiple Enable Banking application registrations per dossier.
- Transaction-level data (only current balances are read).
