# Specification — AI Advisor

## Overview

The AI Advisor is a per-dossier feature that sends a trimmed snapshot of the dossier's financial data to the Claude API (Anthropic) and returns:

1. **Analysis** — a structured financial-health assessment triggered by an "Analyze dossier" button.
2. **Chat** — a free-form conversation about the dossier, with the same data snapshot as context.

It lives in a dedicated **AI Advisor** tab in `DossierView` (`frontend/src/components/ai-advisor/`), backed by `backend/src/routes/ai-advisor.js` (mounted from `dossiers.js` like the other `/:id` sub-routers).

## Configuration

- The server operator supplies their own Anthropic API key via the `ANTHROPIC_API_KEY` environment variable (set in `.env`, referenced by `docker-compose.yml`). There is **no per-user key** and the key is never exposed to the frontend.
- If the key is missing: `GET /ai-advisor/analysis` still succeeds and returns `configured: false` (the UI shows a setup card and disables actions); `POST` endpoints return `503` with a setup message.
- The Claude API is called with raw `fetch` (no SDK dependency): `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, 180 s `AbortController` timeout. No `thinking` parameter is sent (models use their own defaults).

## Model selection

- Persisted per dossier in `dossiers.ai_model` (migration `026_add_ai_advisor`), default `claude-opus-4-8`.
- Exposed through the existing `GET/PATCH /api/dossiers/:id/settings`; PATCH validates against the whitelist.
- Whitelist and pricing (USD per million tokens; used for the cost estimate):

| Model | Input | Output | Notes |
|---|---|---|---|
| `claude-haiku-4-5` | $1 | $5 | fastest & cheapest |
| `claude-sonnet-5` | $3 | $15 | balanced |
| `claude-opus-4-8` | $5 | $25 | **default** — best for financial analysis |
| `claude-fable-5` | $10 | $50 | most capable; requires 30-day data retention on the Anthropic org and may refuse requests (safety classifiers) |

- The picker is a `<select>` in the AI Advisor tab header; changing it PATCHes the setting immediately.

## Cost label

Every AI response carries a backend-computed cost estimate:

`cost_usd = (input×p_in + output×p_out + cache_write×1.25×p_in + cache_read×0.1×p_in) / 1e6`

The frontend renders it via `CostLabel.jsx` as `~$ 0,0234 · 12.345 in / 890 out tokens` (USD, formatted with the app's `formatNumber` — costs are estimates and independent of the dossier currency). The dossier-context system block is sent with `cache_control: {type: "ephemeral"}` so consecutive chat turns get prompt-cache reads on the large context.

## Dossier context payload

`buildDossierContext(dossierId)` produces a JSON snapshot (no internal ids), size-capped:

- Dossier name, currency, `cycle_start_day`, today's date.
- Non-archived accounts (group, name, type, money_category).
- Capital time series: last **24 filled months** (`capital_total` = idle+active, `idle_total`, `stocks_total`).
- Latest filled month's per-account values.
- Monthly expense template (expenses with classification/day, distributions with must/want/save).
- Last **6 cycles** with salary, previous balance, items (paid/spent/done state), closed state, final real balance. Cycles are labelled with their display month (the month they end in).
- Goals with computed values (reuses `computeGoalValues`, now exported from `routes/goals.js`).
- Emergency-fund status (reuses `computeEmergencyFundStatus`, extracted from the `/emergency-fund/status` handler and exported from `routes/emergency-fund.js`; `contributing_accounts` stripped).
- Last 3 annual expense years (carryover, total budgeted, total paid).

## Endpoints

```
GET  /api/dossiers/:id/ai-advisor/analysis
     → { configured: bool, analysis: {...} | null }

POST /api/dossiers/:id/ai-advisor/analysis
     → runs a new analysis, upserts ai_analyses, returns same shape as GET
     Errors: 503 not configured · 502 upstream/refusal/truncation/unparseable

POST /api/dossiers/:id/ai-advisor/chat   { messages: [{role, content}] }
     → { reply, model, cost_usd, input_tokens, output_tokens }
     Validation: 1–40 messages, roles user/assistant, non-empty strings ≤ 8000 chars,
     must start and end with a user message. Nothing persisted.
```

The `analysis` object merges the stored JSON content with metadata: `health_score` (integer 0–100), `health_summary`, `highlights[]`, `improvements[]`, `risks[]` (each item `{title, detail}`), plus `model`, `created_at`, `cost_usd`, `input_tokens`, `output_tokens`.

## Analysis behaviour

- Uses **structured outputs** (`output_config.format` with a JSON schema) so the response always parses; `max_tokens` 8192.
- The system prompt instructs: score 0–100, 2–4 sentence summary, 3–6 highlights, 2–6 improvements, 0–4 risks; plain text in every field; reference concrete numbers/accounts/months.
- Result is **upserted** into `ai_analyses` (UNIQUE on `dossier_id` — only the latest analysis is kept per dossier). The tab shows the stored analysis with "Analysed on [date] · [model] · cost" on open; a Re-analyze button replaces it.
- `stop_reason` handling: `refusal` → 502 with a suggestion to pick another model; `max_tokens` → 502 "cut short". Text is extracted by concatenating only `type === 'text'` content blocks (thinking blocks are ignored).

## Chat behaviour

- Ephemeral by design: history lives in component state, resets on tab leave, and the full history is re-sent each turn (`max_tokens` 2048 per reply).
- The chat system prompt instructs concise plain-text answers (no markdown — the UI renders with `white-space: pre-wrap`, no markdown renderer).
- UI: bubbles (`.ai-chat-bubble--user/--assistant`), "Thinking…" pending bubble, per-reply cost label, Clear button.

## Export / import

- Export format **version 10**: `dossier.ai_model` round-trips. Imports of versions ≤ 9 default it to `claude-opus-4-8`.
- `ai_analyses` rows are deliberately **not** exported (point-in-time, cheap to regenerate).

## Logging

`[ai-advisor]` category: analysis runs and chat turns log dossier id, username, model, token counts and cost — never prompt or reply content. Failures log the error message.

## Out of scope (v1)

- Streaming (SSE) chat responses — buffered by design; can be added later.
- Persisting chat history.
- Per-user API keys or spend limits.
