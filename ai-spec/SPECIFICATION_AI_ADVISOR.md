# Specification — AI Advisor

## Overview

The AI Advisor is a per-dossier feature that sends a trimmed snapshot of the dossier's financial data to the Claude API (Anthropic) and returns:

1. **Analysis** — a structured financial-health assessment triggered by an "Analyze dossier" button.
2. **Chat** — a free-form conversation about the dossier, with the same data snapshot as context.
3. **Export prompt** — a copy/download of a self-contained prompt (same instructions + data) for pasting into claude.ai chat or any other subscription-billed Claude client, for users who'd rather not pay per API call.

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
- `user_notes` — free-text context the user wrote themselves (see "User context" below) — included only when non-empty, to keep the payload minimal for dossiers that don't use it.
- Non-archived accounts (group, name, type, money_category).
- Capital time series: last **24 filled months** (`capital_total` = idle+active, `idle_total`, `stocks_total`).
- Latest filled month's per-account values.
- Monthly expense template (expenses with classification/day, distributions with must/want/save).
- Last **6 cycles** with salary, previous balance, items (paid/spent/done state), closed state, final real balance. Cycles are labelled with their display month (the month they end in).
- Goals with computed values (reuses `computeGoalValues`, now exported from `routes/goals.js`).
- **Loans** — every loan (draft and active), reusing `computeLoanValues` (now exported from `routes/loans.js`): name, status, interest rate, `monthly_payment`, `salary_pct`; draft-only `principal`/`term_months` or active-only `remaining_balance`/`months_left`; `purchase_price`/`total_interest`/`total_amount_payable` whenever origination data is on record; active-only `remaining_interest` and, for linked loans, the linked expense item's name plus `covered`/`coverage_difference`. The month-by-month amortization schedule is **not** included — it's client-side-only and can run hundreds of rows for long terms, which would bloat the payload for no analytical benefit.
- Emergency-fund status (reuses `computeEmergencyFundStatus`, extracted from the `/emergency-fund/status` handler and exported from `routes/emergency-fund.js`; `contributing_accounts` stripped).
- Last 3 annual expense years (carryover, total budgeted, total paid).
- **Annual expense template** — the recurring definition (insurance, car tax, etc.) that annual expense years are instantiated from: `{name, value, classification, num_installments}` per item (exact installment day/month dropped — not analytically relevant), plus a `total_monthly_avg` (`sum(value)/12`) so the model can sanity-check a given year's budgeted total against the recurring baseline.
- **Workbench** — up to the 3 most recently updated saved snapshots (ephemeral what-if scenarios, not real transactions): `{name, updated_at, total_income, total_must, total_want, total_save, leftover}`, computed server-side by `summarizeWorkbenchData()` (a port of the frontend's `computeGlobalSummary()` in `WorkbenchTab.jsx`) from the snapshot's stored line items — raw income/expense/distribution rows are never included, only the aggregated totals.

## User context

The AI Advisor tab has an **"Additional context"** box (`AIAdvisorTab.jsx`) — a plain `<textarea>`, capped at 4000 characters, where the user can add anything the raw numbers don't capture (e.g. "the July spike was a one-off vet bill", "I'm deliberately not rebalancing stocks yet", or clarifying why a highlighted risk isn't actually a concern). It's explicit opt-in, persisted, and asymmetric from chat: the user writes it once and it's reused everywhere, rather than having to repeat it every conversation.

- Persisted per dossier in `dossiers.ai_user_context` (migration `035_add_ai_user_context_to_dossiers`, nullable `TEXT`), via the existing `GET/PATCH /api/dossiers/:id/settings` (`ai_user_context` — not write-only, since it's the user's own note rather than a secret; GET returns `''` when unset so the frontend textarea stays a controlled component). PATCH caps it at 4000 characters (400 if exceeded) and stores an empty string as `null`.
- Included in `buildDossierContext(dossierId)` as `dossier.user_notes` whenever non-empty (see above) — flows into **all three** consumers automatically: the in-app analysis, the in-app chat, and the exported paste-into-claude.ai prompt.
- All three prompt intros (`ANALYSIS_SYSTEM_INTRO`, `CHAT_SYSTEM_INTRO`, `EXPORT_PROMPT_INTRO`) instruct the model to give `user_notes` real weight: use it to explain away a risk/anomaly it addresses rather than flagging something the user has already accounted for, and factor in any goals/constraints/plans it mentions.
- Frontend: a Save button (disabled until the draft differs from the last-saved value) with a transient "Saved!" confirmation, matching the export-prompt card's "Copied!" pattern. Not auto-saved on every keystroke, to avoid PATCH spam on a large text field.
- Round-trips in export/import (version 10, not a secret — unlike `ai_api_key`).

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

GET  /api/dossiers/:id/ai-advisor/export-prompt
     → { prompt: string } — self-contained, paste-into-claude.ai prompt (context + instructions)
     Does not call the Claude API; no API key required.
     Errors: 403 AI disabled for this dossier
```

The `analysis` object merges the stored JSON content with metadata: `health_score` (integer 0–100), `health_summary`, `highlights[]`, `improvements[]`, `risks[]` (each item `{title, detail}`), plus `model`, `created_at`, `cost_usd`, `input_tokens`, `output_tokens`.

## Analysis behaviour

- Uses **structured outputs** (`output_config.format` with a JSON schema) so the response always parses; `max_tokens` 8192.
- The system prompt instructs: score 0–100, 2–4 sentence summary, 3–6 highlights, 2–6 improvements, 0–4 risks; plain text in every field; reference concrete numbers/accounts/months. It also instructs the model to factor active loans' `monthly_payment` into repayment capacity, flag underbudgeted (uncovered) linked loans as a risk, compare combined active-loan payments against the dossier's `loans_max_salary_pct` ceiling (when both it and `reference_salary` are set) and flag if exceeded, and treat draft loans as hypothetical studies rather than real liabilities. It further instructs the model to use `annual_expense_template.total_monthly_avg` to sanity-check a given year's budgeted total and factor recurring-but-not-yet-budgeted costs into capacity, and to treat `workbench` snapshots as the user's own targets/plans (not actuals) — useful for flagging a structurally unaffordable plan (strongly negative `leftover`) or a large drift between a stated plan and `recent_cycles`.
- Result is **upserted** into `ai_analyses` (UNIQUE on `dossier_id` — only the latest analysis is kept per dossier). The tab shows the stored analysis with "Analysed on [date] · [model] · cost" on open; a Re-analyze button replaces it.
- `stop_reason` handling: `refusal` → 502 with a suggestion to pick another model; `max_tokens` → 502 "cut short". Text is extracted by concatenating only `type === 'text'` content blocks (thinking blocks are ignored).

## Chat behaviour

- Ephemeral by design: history lives in component state, resets on tab leave, and the full history is re-sent each turn (`max_tokens` 2048 per reply).
- The chat system prompt instructs concise plain-text answers (no markdown — the UI renders with `white-space: pre-wrap`, no markdown renderer) and to draw on loan data (payments, rates, coverage, total interest) when relevant, treating draft loans as hypothetical, and to draw on `annual_expense_template`/`workbench` when relevant, treating workbench figures as targets/plans rather than actuals.
- UI: bubbles (`.ai-chat-bubble--user/--assistant`), "Thinking…" pending bubble, per-reply cost label, Clear button.

## Export prompt (paste into claude.ai chat)

For users who'd rather use a Claude subscription than pay per API call, the "Use your Claude subscription instead" card (always shown, regardless of `configured`) lets them copy or download the same analysis as a self-contained, one-shot prompt:

- `GET /api/dossiers/:id/ai-advisor/export-prompt` → `{ prompt: string }`. Gated only on `canAccess` + `config.enabled` (`403` when AI is disabled for the dossier) — it does **not** call the Claude API and does **not** require an API key, so `configured` is irrelevant here.
- The prompt is `EXPORT_PROMPT_INTRO + buildDossierContext(dossierId)` — the same context payload as the in-app analysis/chat, prefixed with a standalone instruction block (`EXPORT_PROMPT_INTRO` in `ai-advisor.js`) that differs from `ANALYSIS_SYSTEM_INTRO` in two ways: it's phrased as a one-shot **user** message addressed to Claude in the second person (not an API `system` block), and it asks for **markdown** output (claude.ai's UI renders it, unlike this app's own plain-text `ChatPanel`). It asks for the same fields — health score 0–100 with a one-line label, summary, highlights, improvements, risks — plus the same loans/`reference_salary`/`loans_max_salary_pct` instructions as the in-app analysis, and closes by inviting the user to keep asking follow-up questions using the pasted data as context.
- Frontend (`AIAdvisorTab.jsx`): "Copy to clipboard" (`navigator.clipboard.writeText`, with a transient "Copied!" checkmark state) and "Download as text file" (client-side `Blob`, filename `<dossier name>_ai_prompt.txt`). Both fetch a fresh prompt on click rather than caching one, so the data is always current.

## Export / import

- Export format **version 10**: `dossier.ai_model`, `dossier.ai_enabled`, and `dossier.ai_user_context` round-trip. Imports of versions ≤ 9 default `ai_model` to `claude-opus-4-8`, `ai_enabled` to `true`, and `ai_user_context` to `null` (those versions predate the field).
- `ai_api_key` is a secret, like `paperless_token` — it is **never exported or imported**. An imported dossier always falls back to the operator's `ANTHROPIC_API_KEY` env var (if set) until a new key is entered in its own Settings.
- `ai_analyses` rows are deliberately **not** exported (point-in-time, cheap to regenerate).

## Logging

`[ai-advisor]` category: analysis runs and chat turns log dossier id, username, model, token counts and cost — never prompt or reply content. Failures log the error message.

## Out of scope (v1)

- Streaming (SSE) chat responses — buffered by design; can be added later.
- Persisting chat history.
- Per-user API keys or spend limits (per-*dossier* keys are supported; see AI Settings above).
