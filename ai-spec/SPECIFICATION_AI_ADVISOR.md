# Specification — AI Advisor

## Overview

The AI Advisor is a per-dossier feature that sends a trimmed snapshot of the dossier's financial data to the Claude API (Anthropic) and returns:

1. **Analysis** — a structured financial-health assessment triggered by an "Analyze dossier" button.
2. **Chat** — a free-form conversation about the dossier, with the same data snapshot as context.

It lives in a dedicated **AI Advisor** tab in `DossierView` (`frontend/src/components/ai-advisor/`), backed by `backend/src/routes/ai-advisor.js` (mounted from `dossiers.js` like the other `/:id` sub-routers).

## Configuration

- The server operator can supply a shared Anthropic API key via the `ANTHROPIC_API_KEY` environment variable (set in `.env`, referenced by `docker-compose.yml`). Additionally, each dossier can set its own key in **Settings → AI Settings** (`dossiers.ai_api_key`, write-only — never returned by any GET endpoint, and stripped from `GET /api/dossiers/:id`'s `SELECT *` response before it reaches the frontend). A dossier's own key, when set, takes priority over the env var; otherwise the env var is used as a fallback. Neither key is ever exposed to the frontend once saved (the settings GET exposes only `ai_api_key_set: bool`, mirroring the `paperless_token` convention).
- **Per-dossier enable/disable**: `dossiers.ai_enabled` (default `true`) is also configured in Settings → AI Settings. When disabled: the **AI Advisor tab is not rendered at all** in `DossierView` (no reference to AI appears anywhere in the dossier UI), and all three backend endpoints (`GET/POST /ai-advisor/analysis`, `POST /ai-advisor/chat`) return `403 { error: 'AI Advisor is disabled for this dossier' }` regardless of frontend state, as defense in depth.
- If no key is resolved (neither dossier nor env var): `GET /ai-advisor/analysis` still succeeds and returns `configured: false` (the UI shows a setup card pointing at both configuration options, and disables actions); `POST` endpoints return `503` with a setup message.
- The Claude API is called with raw `fetch` (no SDK dependency): `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, 180 s `AbortController` timeout. No `thinking` parameter is sent (models use their own defaults).

## Model selection

- Persisted per dossier in `dossiers.ai_model` (migration `033_add_ai_advisor`), default `claude-opus-4-8`.
- Exposed through the existing `GET/PATCH /api/dossiers/:id/settings`; PATCH validates against the whitelist.
- Editable from two places that write the same setting: the `<select>` in the AI Advisor tab header, and the "Default model" picker in **Settings → AI Settings** (`DossierSettingsTab.jsx`).
- Whitelist and pricing (USD per million tokens; used for the cost estimate):

| Model | Input | Output | Notes |
|---|---|---|---|
| `claude-haiku-4-5` | $1 | $5 | fastest & cheapest |
| `claude-sonnet-5` | $3 | $15 | balanced |
| `claude-opus-4-8` | $5 | $25 | **default** — best for financial analysis |
| `claude-fable-5` | $10 | $50 | most capable; requires 30-day data retention on the Anthropic org and may refuse requests (safety classifiers) |

- Both pickers are plain `<select>`s; changing either PATCHes the setting immediately.

## Cost label

Every AI response carries a backend-computed cost estimate:

`cost_usd = (input×p_in + output×p_out + cache_write×1.25×p_in + cache_read×0.1×p_in) / 1e6`

The frontend renders it via `CostLabel.jsx` as `~$ 0,0234 · 12.345 in / 890 out tokens` (USD, formatted with the app's `formatNumber` — costs are estimates and independent of the dossier currency). The dossier-context system block is sent with `cache_control: {type: "ephemeral"}` so consecutive chat turns get prompt-cache reads on the large context.

## Dossier context payload

`buildDossierContext(dossierId)` produces a JSON snapshot (no internal ids), size-capped:

- Dossier name, currency, `cycle_start_day`, `reference_salary` and `loans_max_salary_pct` (the manually-set salary used to prefill new loans / denominate the Loans tab's % of salary, and the user's self-imposed ceiling on that % — Sections 6.1/6.2 of `SPECIFICATION_LOANS.md`), today's date.
- Non-archived accounts (group, name, type, money_category).
- Capital time series: last **24 filled months** (`capital_total` = idle+active, `idle_total`, `stocks_total`).
- Latest filled month's per-account values.
- Monthly expense template (expenses with classification/day, distributions with must/want/save).
- Last **6 cycles** with salary, previous balance, items (paid/spent/done state), closed state, final real balance. Cycles are labelled with their display month (the month they end in).
- Goals with computed values (reuses `computeGoalValues`, now exported from `routes/goals.js`).
- **Loans** — every loan (draft and active), reusing `computeLoanValues` (now exported from `routes/loans.js`): name, status, interest rate, `monthly_payment`, `salary_pct`; draft-only `principal`/`term_months` or active-only `remaining_balance`/`months_left`; `purchase_price`/`total_interest`/`total_amount_payable` whenever origination data is on record; active-only `remaining_interest` and, for linked loans, the linked expense item's name plus `covered`/`coverage_difference`. The month-by-month amortization schedule is **not** included — it's client-side-only and can run hundreds of rows for long terms, which would bloat the payload for no analytical benefit.
- Emergency-fund status (reuses `computeEmergencyFundStatus`, extracted from the `/emergency-fund/status` handler and exported from `routes/emergency-fund.js`; `contributing_accounts` stripped).
- Last 3 annual expense years (carryover, total budgeted, total paid).

## AI Settings (dossier Settings tab)

`DossierSettingsTab.jsx` has an **AI Settings** `SettingsCard` (`AISettings` component) with three controls, all writing through the existing `GET/PATCH /api/dossiers/:id/settings`:

1. **Enable/disable** — a `Checkbox` bound to `ai_enabled`. Toggling PATCHes immediately.
2. **Default model** — the same `ai_model` `<select>` as the AI Advisor tab's picker (kept in sync since both read/write the same setting).
3. **Claude API key** — a write-only, `paperless_token`-style inline text field (masked by default with a show/hide eye toggle) bound to `ai_api_key`. The GET response only ever reveals `ai_api_key_set: bool`; the raw key is never sent to the frontend once saved. Leaving it blank falls back to the operator's `ANTHROPIC_API_KEY` env var.

Backend enforcement (`backend/src/routes/ai-advisor.js`'s `resolveAiConfig(dossierId)`): reads `ai_enabled`/`ai_api_key`/`ai_model` from `dossiers`, resolves `apiKey = dossier.ai_api_key || process.env.ANTHROPIC_API_KEY || null`, and all three AI Advisor endpoints check `config.enabled` up front, returning `403` when disabled — independent of whether the frontend tab is reachable.

Schema: migration `034_add_ai_settings_to_dossiers` adds `dossiers.ai_enabled INTEGER DEFAULT 1` and `dossiers.ai_api_key TEXT` (nullable, secret).

## Endpoints

```
GET  /api/dossiers/:id/ai-advisor/analysis
     → { configured: bool, analysis: {...} | null }
     Errors: 403 AI disabled for this dossier

POST /api/dossiers/:id/ai-advisor/analysis
     → runs a new analysis, upserts ai_analyses, returns same shape as GET
     Errors: 403 AI disabled · 503 not configured · 502 upstream/refusal/truncation/unparseable

POST /api/dossiers/:id/ai-advisor/chat   { messages: [{role, content}] }
     → { reply, model, cost_usd, input_tokens, output_tokens }
     Validation: 1–40 messages, roles user/assistant, non-empty strings ≤ 8000 chars,
     must start and end with a user message. Nothing persisted.
     Errors: 403 AI disabled · 503 not configured
```

The `analysis` object merges the stored JSON content with metadata: `health_score` (integer 0–100), `health_summary`, `highlights[]`, `improvements[]`, `risks[]` (each item `{title, detail}`), plus `model`, `created_at`, `cost_usd`, `input_tokens`, `output_tokens`.

## Analysis behaviour

- Uses **structured outputs** (`output_config.format` with a JSON schema) so the response always parses; `max_tokens` 8192.
- The system prompt instructs: score 0–100, 2–4 sentence summary, 3–6 highlights, 2–6 improvements, 0–4 risks; plain text in every field; reference concrete numbers/accounts/months. It also instructs the model to factor active loans' `monthly_payment` into repayment capacity, flag underbudgeted (uncovered) linked loans as a risk, compare combined active-loan payments against the dossier's `loans_max_salary_pct` ceiling (when both it and `reference_salary` are set) and flag if exceeded, and treat draft loans as hypothetical studies rather than real liabilities.
- Result is **upserted** into `ai_analyses` (UNIQUE on `dossier_id` — only the latest analysis is kept per dossier). The tab shows the stored analysis with "Analysed on [date] · [model] · cost" on open; a Re-analyze button replaces it.
- `stop_reason` handling: `refusal` → 502 with a suggestion to pick another model; `max_tokens` → 502 "cut short". Text is extracted by concatenating only `type === 'text'` content blocks (thinking blocks are ignored).

## Chat behaviour

- Ephemeral by design: history lives in component state, resets on tab leave, and the full history is re-sent each turn (`max_tokens` 2048 per reply).
- The chat system prompt instructs concise plain-text answers (no markdown — the UI renders with `white-space: pre-wrap`, no markdown renderer) and to draw on loan data (payments, rates, coverage, total interest) when relevant, treating draft loans as hypothetical.
- UI: bubbles (`.ai-chat-bubble--user/--assistant`), "Thinking…" pending bubble, per-reply cost label, Clear button.

## Export / import

- Export format **version 10**: `dossier.ai_model` and `dossier.ai_enabled` round-trip. Imports of versions ≤ 9 default `ai_model` to `claude-opus-4-8` and `ai_enabled` to `true`.
- `ai_api_key` is a secret, like `paperless_token` — it is **never exported or imported**. An imported dossier always falls back to the operator's `ANTHROPIC_API_KEY` env var (if set) until a new key is entered in its own Settings.
- `ai_analyses` rows are deliberately **not** exported (point-in-time, cheap to regenerate).

## Logging

`[ai-advisor]` category: analysis runs and chat turns log dossier id, username, model, token counts and cost — never prompt or reply content. Failures log the error message.

## Out of scope (v1)

- Streaming (SSE) chat responses — buffered by design; can be added later.
- Persisting chat history.
- Per-user API keys or spend limits (per-*dossier* keys are supported; see AI Settings above).
