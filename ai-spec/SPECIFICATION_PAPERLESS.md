# Capital Tracker — Paperless-ngx Integration Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION.md` and `SPECIFICATION_MONTHLY_EXPENSES.md`. Read both before writing any code.
- All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.
- This feature adds an **optional integration** with [Paperless-ngx](https://docs.paperless-ngx.com/) to automatically fetch expense values from scanned documents into expense cycles.
- Before generating any files, **propose the folder structure and any schema changes**, and wait for approval.
- Do **not overwrite** existing files unless explicitly instructed.

-----

## 1. Overview

The Paperless-ngx integration allows users to link fixed expenses in their monthly expense template to Paperless-ngx document tags. When viewing a cycle, the user can fetch matching documents from Paperless-ngx and apply the extracted values (amount and payment day) to the cycle's expenses.

The integration is **per-dossier** and **entirely optional** — dossiers without Paperless configuration behave exactly as before.

-----

## 2. Dossier Settings

Four new settings are added to the **Dossier Settings** tab, grouped under a dedicated "Paperless-ngx Integration" section.

### 2.1 Settings Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `paperless_url` | text (nullable) | null | Root URL of the Paperless-ngx instance, **without** `/api` (e.g. `https://paperless.example.com`) |
| `paperless_token` | text (nullable) | null | API authentication token (sent as `Authorization: Token <value>`) |
| `paperless_date_field_id` | integer (nullable) | null | ID of the Paperless custom field that holds the payment date |
| `paperless_amount_field_id` | integer (nullable) | null | ID of the Paperless custom field that holds the expense amount |

### 2.2 UI Labels (user-facing)

| Field | UI Label |
|---|---|
| `paperless_url` | Paperless-ngx URL |
| `paperless_token` | API Token |
| `paperless_date_field_id` | Payment date custom field ID |
| `paperless_amount_field_id` | Amount custom field ID |

### 2.3 UI Notes

- The **API Token** input must be of type `password` with a visibility toggle.
- The **Paperless-ngx URL** input should include a placeholder: `https://paperless.example.com`.
- All four fields must be filled for the integration to be considered **active**. If any field is missing, the integration is inactive and all Paperless-related UI elements are hidden throughout the dossier.

### 2.4 API

The existing settings endpoints are extended:

- `GET /api/dossiers/:id/settings` — now also returns `paperless_url`, `paperless_token`, `paperless_date_field_id`, `paperless_amount_field_id`.
- `PATCH /api/dossiers/:id/settings` — now also accepts these four fields.

The `paperless_token` is stored in plain text in SQLite. This is acceptable for a self-hosted, single-user/small-team application. The token is **never returned to the frontend** — the `GET /settings` endpoint returns a boolean `paperless_token_set` (true/false) instead of the actual value. The `PATCH` endpoint accepts the token value for writing. Sending `null` clears it.

-----

## 3. Expense Template — Tag Mapping

### 3.1 New Field

Each expense template item gains an optional field:

| Field | Type | Description |
|---|---|---|
| `paperless_tag_id` | integer (nullable) | Paperless-ngx tag ID associated with this expense |

This field is **only applicable to fixed expenses** (`section = 'expense'`, `type = 'Fixed'`). For budget expenses and distributions, the field is ignored.

### 3.2 UI

In the **Expense Template** editor (Dossier Settings), fixed expense rows display an additional optional field "Paperless Tag ID" — a small numeric input. The field is only visible/editable when the Paperless integration is active (all four settings populated).

### 3.3 Template → Cycle Copy

When a new cycle is created and template items are copied into `cycle_items`, the `paperless_tag_id` value is copied along with all other fields.

### 3.4 Ad-hoc Items

Ad-hoc fixed expenses added directly to a cycle can also have a `paperless_tag_id` set.

### 3.5 API

The existing expense template endpoints are extended to accept and return `paperless_tag_id`:

- `POST /api/dossiers/:id/expense-template` — accepts `paperless_tag_id`.
- `PATCH /api/dossiers/:id/expense-template/:itemId` — accepts `paperless_tag_id`.
- `POST /api/dossiers/:id/expense-template/bulk-replace` — each item may include `paperless_tag_id`.

The existing cycle item endpoints are also extended:

- `POST /api/dossiers/:id/cycles/:cycleId/items` — accepts `paperless_tag_id`.
- `PATCH /api/dossiers/:id/cycles/:cycleId/items/:itemId` — accepts `paperless_tag_id`.

-----

## 4. Fetching Documents from Paperless-ngx

### 4.1 Endpoint

```
GET /api/dossiers/:id/cycles/:cycleId/paperless-fetch
```

This endpoint is called by the frontend to retrieve matching documents from Paperless-ngx and compute proposed values for cycle expenses.

### 4.2 Preconditions

The endpoint validates:

1. The dossier has all four Paperless settings populated. If not → `400 { error: "Paperless-ngx integration is not configured" }`.
2. The cycle has at least one fixed expense item with a non-null `paperless_tag_id`. If not → `200 { results: [] }`.

### 4.3 Cycle Date Range

The date range is computed from the cycle's `(year, month)` and the dossier's `cycle_start_day`:

- **Start date**: `{year}-{month}-{cycle_start_day}` (the stored start month).
- **End date**: day before the next cycle's start — `new Date(year, month, cycle_start_day - 1)` (JS Date handles month overflow).

Both dates are formatted as `YYYY-MM-DD`.

### 4.4 Paperless API Call

A single HTTP request is made from the backend to the Paperless-ngx API:

```
GET {paperless_url}/api/documents/?tags__id__in={tag_ids}&custom_field_query={query}&page_size=100
Authorization: Token {paperless_token}
```

Where:
- `{tag_ids}` — comma-separated list of all unique `paperless_tag_id` values from qualifying cycle items.
- `{query}` — URL-encoded JSON: `["AND",[[{date_field_id},"gte","{start_date}"],[{date_field_id},"lte","{end_date}"]]]`.

### 4.5 Response Processing

For each document in the Paperless response:

1. **Tag matching**: check which cycle items have a `paperless_tag_id` present in the document's `tags` array. A document may match multiple cycle items (though unlikely).
2. **Amount extraction**: find the custom field entry where `field == paperless_amount_field_id`. Parse the `value`:
   - Strip any leading alphabetic prefix (regex: `/^[A-Za-z]*/`).
   - Parse the remainder as a float.
   - If parsing fails, skip this document and include a warning in the response.
3. **Date extraction**: find the custom field entry where `field == paperless_date_field_id`. The value is a date string (`YYYY-MM-DD`). Extract the day of month as the proposed `day_of_payment`.

### 4.6 Aggregation

Results are grouped by `cycle_item_id`:

- If **multiple documents** match the same cycle item (same `paperless_tag_id`), their amounts are **summed**. The `day_of_payment` uses the day from the **most recent** document (by the date field value).
- All matching documents are listed individually in the response for reference.

### 4.7 Response Format

```json
{
  "results": [
    {
      "cycle_item_id": "uuid-abc",
      "expense_name": "Eletricidade",
      "current_value": 150.00,
      "current_day_of_payment": 5,
      "proposed_value": 182.78,
      "proposed_day_of_payment": 23,
      "documents": [
        {
          "id": 278,
          "title": "162006777828",
          "value": 182.78,
          "date": "2026-03-23",
          "url": "https://paperless.example.com/documents/278/details"
        }
      ]
    }
  ],
  "warnings": []
}
```

- `documents[].url` is constructed as `{paperless_url}/documents/{document_id}/details`.
- `warnings` contains free-text messages for documents that could not be parsed (e.g. unparseable amount).

### 4.8 Error Handling

| Scenario | Response |
|---|---|
| Paperless settings incomplete | `400 { error: "Paperless-ngx integration is not configured" }` |
| Paperless API unreachable / timeout | `502 { error: "Could not connect to Paperless-ngx" }` |
| Paperless API returns non-2xx | `502 { error: "Paperless-ngx returned an error: {status}" }` |
| No cycle items with tag IDs | `200 { results: [] }` |
| No documents found | `200 { results: [] }` |

The backend should use a reasonable timeout for the Paperless API call (10 seconds).

-----

## 5. Applying Fetched Values

### 5.1 Endpoint

```
POST /api/dossiers/:id/cycles/:cycleId/paperless-apply
```

### 5.2 Request Body

```json
{
  "items": [
    { "cycle_item_id": "uuid-abc", "value": 182.78, "day_of_payment": 23 },
    { "cycle_item_id": "uuid-def", "value": 38.70, "day_of_payment": 2 }
  ]
}
```

### 5.3 Behaviour

For each item in the request:

- Updates the `cycle_item`'s `value` and `day_of_payment`.
- Does **not** change the `paid` status — it stays in whatever state it was.
- Does **not** modify the expense template — changes are scoped to this cycle only.

Validation:
- Each `cycle_item_id` must belong to the specified cycle.
- Each item must be a fixed expense (`type = 'Fixed'`, `section = 'expense'`).
- `value` must be a positive number.
- `day_of_payment` must be an integer between 1 and 31.

### 5.4 Response

```json
{
  "updated": 2
}
```

Returns the number of cycle items successfully updated.

-----

## 6. Cycle Editor UI

### 6.1 Fetch Button

A **"Fetch from Paperless"** button is displayed in the cycle editor when **both** conditions are met:

1. The dossier's Paperless integration is active (all four settings populated).
2. At least one fixed expense item in the cycle has a non-null `paperless_tag_id`.

The button is positioned in the expenses section header, alongside existing action buttons. It should use a secondary button style with a document/download icon.

### 6.2 Linked Expense Indicator

Fixed expenses that have a `paperless_tag_id` set display a small badge or icon (e.g. a document icon) next to their name, indicating they are linked to Paperless.

### 6.3 Preview Modal

Clicking the fetch button triggers a call to the `paperless-fetch` endpoint. While loading, the button shows a spinner.

On success, a modal is displayed with the following content:

#### Header

"Paperless-ngx — Fetched Documents"

#### Results Table

| Expense | Current | Proposed | Day | Documents |
|---|---|---|---|---|
| Eletricidade | € 150,00 | **€ 182,78** | 5 → 23 | [📄 162006777828](link) |
| Água | € 35,00 | **€ 38,70** | 1 → 2 | [📄 1326.AR...](link) |

- **Proposed values** that differ from current values are visually highlighted (e.g. bold, coloured).
- **Day** column shows `current → proposed` when different; just the value when unchanged.
- **Document links** open in a new tab, pointing to the Paperless document detail page.
- If a cycle item has multiple matching documents, all are listed (each with its individual value), and the proposed value shows the sum.

#### Warnings

If any warnings exist (e.g. unparseable amounts), they are displayed below the table in an amber alert box.

#### No Results

If no documents were found, the modal shows: "No matching documents found in Paperless-ngx for this cycle's date range."

#### Actions

- **Apply** (primary button): calls the `paperless-apply` endpoint with all proposed values, closes the modal, and reloads the cycle data.
- **Cancel** (secondary button): closes the modal without changes.

-----

## 7. Schema Changes

### 7.1 Migration `018_paperless_integration`

**`dossiers` table** — 4 new columns:

| Column | Type | Default |
|---|---|---|
| `paperless_url` | TEXT | NULL |
| `paperless_token` | TEXT | NULL |
| `paperless_date_field_id` | INTEGER | NULL |
| `paperless_amount_field_id` | INTEGER | NULL |

**`expense_template_items` table** — 1 new column:

| Column | Type | Default |
|---|---|---|
| `paperless_tag_id` | INTEGER | NULL |

**`cycle_items` table** — 1 new column:

| Column | Type | Default |
|---|---|---|
| `paperless_tag_id` | INTEGER | NULL |

All columns are added via `ALTER TABLE ... ADD COLUMN` with idempotency guards (check `PRAGMA table_info` before altering), following the existing migration pattern.

-----

## 8. Export / Import

### 8.1 Export

The dossier export format must be extended to include:

- Dossier settings: `paperless_url`, `paperless_date_field_id`, `paperless_amount_field_id`. The **token is excluded** from exports for security.
- Expense template items: `paperless_tag_id` (when set).
- Cycle items: `paperless_tag_id` (when set).

### 8.2 Import

On import:

- `paperless_url`, `paperless_date_field_id`, `paperless_amount_field_id` are restored to the dossier settings.
- `paperless_token` is **not imported** — the user must configure it manually after import.
- `paperless_tag_id` values on template items and cycle items are restored as-is (they are numeric IDs that may or may not match the target Paperless instance).

This feature bumped the export format version to **6**. At the time of implementation, import accepted versions 1–6. The Annual Expenses Tracking feature subsequently bumped the version to **7** — see `SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md`. The current export version and accepted import range are documented in `CLAUDE.md`.

-----

## 9. Seed Data (Preview Environments)

The "My Finances" seed dossier (Dossier 0) should be updated to include sample Paperless settings and tag IDs on two fixed expenses, demonstrating the integration in the UI. Since preview environments cannot connect to a real Paperless instance, the fetch button will return an error — this is acceptable for demonstration purposes.

| Setting | Seed Value |
|---|---|
| `paperless_url` | `https://paperless.example.com` |
| `paperless_token` | `preview-token-not-real` |
| `paperless_date_field_id` | `2` |
| `paperless_amount_field_id` | `1` |

Two fixed expenses in the seed template should have `paperless_tag_id` set (e.g. `15` and `2`), so the Paperless badge is visible in the cycle editor.

-----

## 10. Out of Scope (this phase)

- Automatic/scheduled fetching (cron-style)
- Fetching values for budget expenses or distributions
- Writing data back to Paperless-ngx (e.g. marking documents as processed)
- Multiple Paperless instances per dossier
- Tag name resolution (showing the tag name from Paperless instead of the numeric ID)
- Pagination of Paperless results beyond 100 documents per cycle
- Encryption of the stored Paperless token
