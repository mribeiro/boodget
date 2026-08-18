# Specification — AI Advisor

## Overview

The AI Advisor is a per-dossier feature that sends a trimmed snapshot of the dossier's financial data to the Claude API (Anthropic) **or** the Gemini API (Google) and returns:

1. **Analysis** — a structured financial-health assessment triggered by an "Analyze dossier" button.
2. **Chat** — a free-form conversation about the dossier, with the same data snapshot as context.
3. **Export prompt** — a copy/download of a self-contained prompt (same instructions + data) for pasting into claude.ai, gemini.google.com, or any other subscription-billed chat client, for users who'd rather not pay per API call.

Which provider is used is **derived purely from the selected `ai_model` id's prefix** (`claude-*` vs `gemini-*`) — there is no separate stored "provider" setting anywhere in the schema or the API. This keeps the provider from ever drifting out of sync with the model a dossier actually has selected, and lets a single `<select>` (grouped by provider) be the only UI surface for choosing "which AI."

It lives in a dedicated **AI Advisor** tab in `DossierView` (`frontend/src/components/ai-advisor/`), backed by `backend/src/routes/ai-advisor.js` (mounted from `dossiers.js` like the other `/:id` sub-routers).

## Configuration

- The server operator can supply a shared Anthropic API key via the `ANTHROPIC_API_KEY` environment variable, and/or a shared Google Gemini API key via `GEMINI_API_KEY` (both set in `.env`, referenced by `docker-compose.yml`). Additionally, each dossier can set its own keys in **Settings → AI Settings** (`dossiers.ai_api_key` for Claude, `dossiers.ai_gemini_api_key` for Gemini — both write-only, never returned by any GET endpoint, and stripped from `GET /api/dossiers/:id`'s `SELECT *` response before it reaches the frontend). A dossier's own key, when set, takes priority over the matching env var; otherwise the env var is used as a fallback. **Only the key matching the dossier's currently-selected model's provider is ever consulted** — a dossier on a `gemini-*` model with only `ai_api_key` set reports `configured: false`, same as having no key at all. Neither key is ever exposed to the frontend once saved (the settings GET exposes only `ai_api_key_set`/`ai_gemini_api_key_set: bool`, mirroring the `paperless_token` convention).
- **Per-dossier enable/disable**: `dossiers.ai_enabled` (default `true`) is also configured in Settings → AI Settings. When disabled: the **AI Advisor tab is not rendered at all** in `DossierView` (no reference to AI appears anywhere in the dossier UI), and all four backend endpoints (`GET/POST /ai-advisor/analysis`, `POST /ai-advisor/chat`, `GET /ai-advisor/export-prompt`) return `403 { error: 'AI Advisor is disabled for this dossier' }` regardless of frontend state, as defense in depth. `AIAdvisorTab` also guards against a **mid-session disable**: if `ai_enabled` is toggled off in another tab/session while this one already has the AI Advisor tab open, `loadAll` picks it up from `GET /settings`'s `ai_enabled` on its next run, and any in-flight action (Analyze, chat send, copy/download prompt) that hits the `403` above matches the exact error string (`isAiDisabledError` in `frontend/src/utils/aiModels.js`, shared with `ChatPanel` via an `onDisabled` callback) and switches the whole tab body to the same friendly "AI Advisor is disabled for this dossier" card used for the never-configured case, instead of surfacing the raw error.
- If no key is resolved for the selected model's provider (neither dossier nor env var): `GET /ai-advisor/analysis` still succeeds and returns `configured: false` (the UI shows a provider-specific setup card pointing at both configuration options, and disables actions); `POST` endpoints return `503` with a setup message.
- Both APIs are called with raw `fetch` (no SDK dependency), behind a small dispatcher (`callAiProvider`, see "Provider adapters" below) that picks the right function by the model's derived provider:
  - **Claude**: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`.
  - **Gemini**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key` (never the `?key=` query param, so it can't leak into a proxy/access log).
  - Both share a 180 s `AbortController` timeout and send no `thinking`/thinking-budget parameter (models use their own defaults).

## Model selection

- Persisted per dossier in `dossiers.ai_model` (migration `033_add_ai_advisor`), default `claude-opus-5`.
- **The whitelist is by family, not exact model+version — and it's the same mechanism that determines provider.** `isAllowedAiModel(modelId)` (`backend/src/routes/ai-advisor.js`) accepts any id matching `/^claude-(haiku|sonnet|opus)-/` **or** the Gemini pattern `gemini-<version>-<pro|flash>[-<tail>]` where the tail doesn't hit an exclusion list (`lite`/`8b`/`image`/`tts`/`audio`/`embedding`/`latest`) — so `claude-fable-*`/`claude-mythos-*`, `gemini-*-flash-lite`, `gemini-*-flash-8b`, and the versionless `gemini-{pro,flash}-latest` aliases are all rejected. `modelProvider(modelId)` derives which of the two APIs a valid id belongs to, purely from its family — this is the **only** place "provider" is determined anywhere in the app; there is no stored provider column. This is deliberate: a dossier's chosen model never becomes invalid just because a newer version of that family is released (e.g. a dossier left on `claude-opus-4-8` stays valid indefinitely, even after `claude-opus-5` becomes the suggested default), and rejecting the `-latest` aliases keeps "latest" resolution exclusively in this app's own refresh mechanism rather than delegating it to a floating upstream alias. Exposed through the existing `GET/PATCH /api/dossiers/:id/settings`; PATCH validates via `isAllowedAiModel`. Dossier import (`POST /api/dossiers/import`) validates the same way, coercing an out-of-family `ai_model` (e.g. from a hand-edited export, or a pre-this-change export carrying `claude-fable-5`) to `DEFAULT_AI_MODEL` rather than storing it as-is — keeps the Settings dropdown and `resolveAiConfig`'s runtime fallback from silently diverging.
- Editable from two places that write the same setting: the `<select>` in the AI Advisor tab header, and the "Default model" picker in **Settings → AI Settings** (`DossierSettingsTab.jsx`). Both pickers are grouped `<optgroup>` `<select>`s (Claude options first, then Gemini — `modelSelectGroups()` in `frontend/src/utils/aiModels.js`, built on top of the flat `modelSelectOptions()`); changing either PATCHes the setting immediately.

### Model catalog (picker options) — dynamic, refreshable, both providers

The whitelist (above) governs *validity*; a separate, app-wide **catalog** governs what the two pickers *suggest*. This keeps a hardcoded model list from going stale (e.g. a new "Opus 5" or "Gemini 4" shipping with no code change) while never retroactively invalidating an already-chosen older version.

- `getAvailableModels()` reads a single JSON blob from `app_settings` (key `ai_available_models`, same key-value table the VAPID keys use — no dedicated schema, no migration needed) shaped `{ models: [{id, family, display_name}, ...], updated_at }`. It is **merged against the current family list** (`MODEL_FAMILIES = ['haiku','sonnet','opus','gemini-pro','gemini-flash']`) rather than returned verbatim: any family present in the cache keeps its cached entry, any family absent (e.g. an older cache from before Gemini support existed, or a row that's missing/unparseable/empty entirely) falls back to `DEFAULT_MODELS` — five baked-in entries (one per family, currently `claude-haiku-4-5` / `claude-sonnet-5` / `claude-opus-5` / `gemini-3.7-pro` / `gemini-3.1-flash`) that also define `DEFAULT_AI_MODEL` (the opus entry — unchanged by adding Gemini, so no existing dossier's default moves). This merge is what makes a new family (like Gemini, when it first shipped) appear in the picker immediately on an existing install, rather than staying hidden until someone happens to click Refresh. The cache is **global**, not per-dossier — model availability isn't dossier-scoped, so every dossier's picker reads the same resolved list.
- `refreshAvailableModels({ anthropic, gemini })` refreshes both providers' halves of the catalog independently:
  - **Claude** (`fetchAnthropicLatest`): `GET https://api.anthropic.com/v1/models` (paginated via `after_id`/`has_more`, no beta header), filtered to ids matching the Anthropic family regex, keeping per family the entry with the most recent `created_at`.
  - **Gemini** (`fetchGeminiLatest`): `GET https://generativelanguage.googleapis.com/v1beta/models` (paginated via `pageToken`/`nextPageToken`), filtered to ids matching the Gemini family regex **and** whose `supportedGenerationMethods` includes `generateContent` (cleanly excludes embedding/prediction-only models without needing the id-based exclusion list to do that work). Google's list carries no creation timestamp, so "latest" per family is picked by `betterGeminiCandidate`: compare the version parsed out of the id as a numeric tuple first (`gemini-3.7-pro` > `gemini-2.5-pro`), then prefer a **stable release over a preview at equal version** (`gemini-3.7-pro` > `gemini-3.7-pro-preview`), then the raw id string as a final deterministic tiebreak — a brand-new generation that's preview-only for a while still wins over an older stable one, since that's how new Gemini generations typically ship.
  - For each family across both providers, **older versions are dropped from the suggested list, never offered as both an "old" and "new" option side by side**. A family with no match in its provider's response (e.g. a transient gap) keeps its previously-cached entry rather than being dropped or reset to the baked-in default.
  - **A provider with no resolvable key is silently skipped** — its families simply keep their previously-cached/default entries, reported back in the response's `skipped: ['anthropic'|'google', ...]` list — rather than failing the whole refresh. This means a dossier with only a Claude key can still refresh the Claude half of the catalog, and vice versa. The endpoint returns `503` only when **neither** key resolves. An upstream error on a provider that *did* have a key is caught and reported in `errors: [{provider, message}]` rather than thrown, unless it's the only provider attempted (in which case it's rethrown as a `502`).
  - The merged result — `{ models, updated_at, skipped, errors }` — is written back to `app_settings` with a fresh `updated_at` and returned.
- Requires a resolvable API key for **at least one** provider — `resolveAiConfig(dossierId).apiKeys` resolves both (`{ anthropic, gemini }`) using the same per-provider precedence as everywhere else (dossier's own key, else the matching env var).
- **Not gated by `ai_enabled`** (neither the GET nor the POST below): the Settings → AI Settings picker must render options even while the feature is turned off, so a user can see what's available before enabling it.

### Cost estimate pricing — by family, not exact model

`FAMILY_PRICING` in `ai-advisor.js` is keyed by family (`haiku`/`sonnet`/`opus`/`gemini-pro`/`gemini-flash`), not exact model id — neither provider's Models API exposes pricing, and a family's rate is far more stable across its own version bumps than the id itself. `computeCostUsd(model, usage)` resolves the model's family first, then looks up pricing; an id outside the five families (e.g. a historical `claude-fable-5` value on an old `ai_analyses` row) returns `null` — that row's already-persisted `cost_usd` is unaffected, since it was computed and stored at analysis time, not recomputed on read.

| Family | Input | Output |
|---|---|---|
| haiku | $1 | $5 |
| sonnet | $3 | $15 |
| opus | $5 | $25 |
| gemini-pro | $1.25 | $10 |
| gemini-flash | $0.30 | $2.50 |

Gemini's figures are the base (≤200k-token prompt) tier — Pro is context-tiered with a higher rate above that threshold, but `buildDossierContext`'s caps keep every request far under it, so only the base tier is modeled. Re-check Google's published pricing whenever the baked-in default Gemini model ids are bumped, since a new generation can reprice.

## Cost label

Every AI response carries a backend-computed cost estimate:

`cost_usd = (input×p_in + output×p_out + cache_write×1.25×p_in + cache_read×0.1×p_in) / 1e6`

The frontend renders it via `CostLabel.jsx` as `~$ 0,0234 · 12.345 in / 890 out tokens` (USD, formatted with the app's `formatNumber` — costs are estimates and independent of the dossier currency). For Claude, the dossier-context system block is sent with `cache_control: {type: "ephemeral"}` so consecutive chat turns get prompt-cache reads on the large context, and `cache_write`/`cache_read` above reflect that. Gemini has no equivalent request-level cache control in this integration (see "Provider adapters" below) — its two cache fields are always `0`, and `input` reports the full prompt token count on every call, which makes the resulting estimate deliberately **conservative** (never understated) rather than an attempt to model Gemini's own implicit-cache discount.

## Dossier context payload

`buildDossierContext(dossierId)` produces a JSON snapshot (no internal ids), size-capped:

- Dossier name, currency, `cycle_start_day`, `reference_salary` and `loans_max_salary_pct` (the manually-set salary used to prefill new loans / denominate the Loans tab's % of salary, and the user's self-imposed ceiling on that % — Sections 6.1/6.2 of `SPECIFICATION_LOANS.md`), today's date.
- `user_notes` — free-text context the user wrote themselves (see "User context" below) — included only when non-empty, to keep the payload minimal for dossiers that don't use it.
- Non-archived accounts (group, name, type, money_category).
- Capital time series: last **24 filled months** (`capital_total` = idle+active, `idle_total`, `stocks_total`).
- Latest filled month's per-account values.
- Monthly expense template (expenses with classification/day, distributions with must/want/save).
- Last **6 cycles** with income lines (`income_total` plus per-line `{name, value}` breakdown, from the dossier's configurable income lines — see the Income Line key concept in `CLAUDE.md`), previous balance, items (paid/spent/done state), closed state, final real balance. Cycles are labelled with their display month (the month they end in).
- Goals with computed values (reuses `computeGoalValues`, now exported from `routes/goals.js`).
- **Loans** — every loan (draft and active), reusing `computeLoanValues` (now exported from `routes/loans.js`): name, status, interest rate, `monthly_payment`, `salary_pct`; draft-only `principal`/`term_months` or active-only `current_balance`/`balance_as_of`/`months_left`/`payments_made`/`term_from_anchor`/`payments_tracked`/`is_matured` (true once the loan's `end_date` has passed with no payments left but it's still marked active — worth flagging as a risk, since a `current_balance` projected down to `0` there doesn't mean the debt is gone); `purchase_price`/`total_interest`/`total_amount_payable` whenever origination data is on record; active-only `remaining_interest` (`null` once matured, since nothing is scheduled) and, for linked loans, the linked expense item's name plus `covered`/`coverage_difference`. The stored `remaining_balance` is deliberately **not** sent: it's a *dated* anchor (§4.3 of `SPECIFICATION_LOANS.md`), so a model reading it as today's debt would overstate what's owed — `current_balance` is the live figure, with `balance_as_of`/`payments_made` alongside it so the model can weigh how stale the projection is. `payments_tracked` is false when an active loan has no linked monthly expense, meaning its payment isn't budgeted anywhere in the template. The month-by-month payment plan and its per-period paid state are **not** included — the plan is client-side-only and can run hundreds of rows for long terms, which would bloat the payload for no analytical benefit; `payments_made` summarizes the progress instead.
- **Subscriptions** — active subscriptions only: `{name, monthly_cost, billing_day, linked_distribution}` per item, plus a `total_monthly_cost`. `linked_distribution` is the linked distribution template item's name (or `null`); the model is instructed to compare a distribution's total linked subscriptions against that distribution's own budgeted `value` (from `expense_template.distributions`) and flag it as a risk if exceeded.
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

`DossierSettingsTab.jsx` has an **AI Settings** `SettingsCard` (`AISettings` component) with four controls, all writing through the existing `GET/PATCH /api/dossiers/:id/settings`:

1. **Enable/disable** — a `Checkbox` bound to `ai_enabled`. Toggling PATCHes immediately.
2. **Default model** — the same grouped (`<optgroup>` Claude/Gemini) `ai_model` `<select>` as the AI Advisor tab's picker (kept in sync since both read/write the same setting). A hint line below it names which key the currently-selected model will actually use.
3. **Claude API key** — a write-only, `paperless_token`-style inline text field (masked by default with a show/hide eye toggle) bound to `ai_api_key`. Leaving it blank falls back to the operator's `ANTHROPIC_API_KEY` env var.
4. **Gemini API key** — the same pattern, bound to `ai_gemini_api_key`, falling back to `GEMINI_API_KEY`.

Both key fields share one edit modal in the component (parameterized by which field is being edited — title/placeholder/env-var hint — rather than two near-duplicate modals). The GET response only ever reveals `ai_api_key_set`/`ai_gemini_api_key_set: bool`; neither raw key is ever sent to the frontend once saved.

Backend enforcement (`backend/src/routes/ai-advisor.js`'s `resolveAiConfig(dossierId)`): reads `ai_enabled`/`ai_api_key`/`ai_gemini_api_key`/`ai_model` from `dossiers`, resolves the model's `provider` via `modelProvider`, then `apiKey` as whichever of `dossier.ai_api_key || process.env.ANTHROPIC_API_KEY` or `dossier.ai_gemini_api_key || process.env.GEMINI_API_KEY` matches that provider (both are also exposed together as `apiKeys` for the refresh endpoint, which needs both regardless of which model is currently selected). All three AI Advisor endpoints check `config.enabled` up front, returning `403` when disabled — independent of whether the frontend tab is reachable.

Schema: migration `034_add_ai_settings_to_dossiers` adds `dossiers.ai_enabled INTEGER DEFAULT 1` and `dossiers.ai_api_key TEXT` (nullable, secret); migration `043_add_ai_gemini_api_key_to_dossiers` adds `dossiers.ai_gemini_api_key TEXT` (nullable, secret, same treatment).

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
     → { prompt: string } — self-contained prompt (context + instructions) to paste into
       claude.ai, gemini.google.com, or any other chat client
     Does not call the Claude or Gemini API; no API key required.
     Errors: 403 AI disabled for this dossier

GET  /api/dossiers/:id/ai-advisor/available-models
     → { models: [{id, family, display_name}], updated_at: string|null }
     Cached/default catalog spanning both providers — does not call either API. Not gated on
     ai_enabled.

POST /api/dossiers/:id/ai-advisor/refresh-models
     → { models, updated_at, skipped: string[], errors: [{provider, message}] }
     Freshly fetched from Claude's GET /v1/models and Gemini's GET /v1beta/models, keeping only
     the latest model per family (haiku/sonnet/opus/gemini-pro/gemini-flash) — a family absent
     from its provider's response keeps its previous entry. A provider with no resolvable key is
     skipped (named in `skipped`), not failed; an upstream failure on an attempted provider is
     reported in `errors` rather than thrown, unless it's the only provider attempted. Not gated
     on ai_enabled.
     Errors: 503 no API key resolvable for either provider · 502 upstream error (both providers
     failed, or the only attempted provider failed)
```

The `analysis` object merges the stored JSON content with metadata: `health_score` (integer 0–100), `health_summary`, `highlights[]`, `improvements[]`, `risks[]` (each item `{title, detail}`), plus `model`, `created_at`, `cost_usd`, `input_tokens`, `output_tokens`.

## Analysis behaviour

- Uses **structured outputs** (Claude's `output_config.format` with a JSON schema, or Gemini's `generationConfig.responseSchema` via `toGeminiSchema` — see "Provider adapters" below) so the response always parses; `max_tokens` 8192.
- The system prompt instructs: score 0–100, 2–4 sentence summary, 3–6 highlights, 2–6 improvements, 0–4 risks; plain text in every field; reference concrete numbers/accounts/months. It also instructs the model to factor active loans' `monthly_payment` into repayment capacity, flag underbudgeted (uncovered) linked loans as a risk, compare combined active-loan payments against the dossier's `loans_max_salary_pct` ceiling (when both it and `reference_salary` are set) and flag if exceeded, treat draft loans as hypothetical studies rather than real liabilities, treat a long-stale `balance_as_of` as an estimate worth re-checking rather than fact, and flag an active loan with `payments_tracked` false as an unbudgeted gap. It further instructs the model to use `annual_expense_template.total_monthly_avg` to sanity-check a given year's budgeted total and factor recurring-but-not-yet-budgeted costs into capacity, and to treat `workbench` snapshots as the user's own targets/plans (not actuals) — useful for flagging a structurally unaffordable plan (strongly negative `leftover`) or a large drift between a stated plan and `recent_cycles`.
- Result is **upserted** into `ai_analyses` (UNIQUE on `dossier_id` — only the latest analysis is kept per dossier). The tab shows the stored analysis with "Analysed on [date] · [model] · cost" on open; a Re-analyze button replaces it.
- Refusal/truncation handling is provider-specific but produces identical user-facing messages (see "Provider adapters" below for the full mapping) — Claude's `stop_reason` vs Gemini's `candidates[0].finishReason`/`promptFeedback.blockReason`. Text is extracted by concatenating only the actual answer content: Claude's `type === 'text'` blocks, Gemini's parts where `thought` isn't `true` (thinking blocks/summaries are ignored on both).

## Chat behaviour

- Ephemeral by design: history lives in component state, resets on tab leave, and the full history is re-sent each turn (`max_tokens` 2048 per reply).
- The chat system prompt instructs concise plain-text answers (no markdown — the UI renders with `white-space: pre-wrap`, no markdown renderer) and to draw on loan data (payments, rates, coverage, total interest) when relevant, treating draft loans as hypothetical and a long-stale `balance_as_of` as an estimate rather than fact, and to draw on `annual_expense_template`/`workbench` when relevant, treating workbench figures as targets/plans rather than actuals.
- UI: bubbles (`.ai-chat-bubble--user/--assistant`), "Thinking…" pending bubble, per-reply cost label, Clear button. Each assistant message also stores the `model` returned with that reply (`ChatPanel`'s local history, mirroring `AnalysisPanel`'s persisted `model` field); a small model-name badge (shared `MODEL_LABELS` map in `utils/aiModels.js`) is shown next to a reply only when it differs from the model of the previous assistant reply, so switching the per-dossier `ai_model` setting mid-conversation is visible in the transcript.

## Export prompt (paste into claude.ai or gemini.google.com)

For users who'd rather use a Claude or Gemini subscription than pay per API call, the "Use your Claude or Gemini subscription instead" card (always shown, regardless of `configured`) lets them copy or download the same analysis as a self-contained, one-shot prompt:

- `GET /api/dossiers/:id/ai-advisor/export-prompt` → `{ prompt: string }`. Gated only on `canAccess` + `config.enabled` (`403` when AI is disabled for the dossier) — it does **not** call either API and does **not** require an API key, so `configured` is irrelevant here. The prompt content itself (`EXPORT_PROMPT_INTRO`) is provider-agnostic and unchanged by which provider a dossier has configured — only the card's surrounding copy names both.
- The prompt is `EXPORT_PROMPT_INTRO + buildDossierContext(dossierId)` — the same context payload as the in-app analysis/chat, prefixed with a standalone instruction block (`EXPORT_PROMPT_INTRO` in `ai-advisor.js`) that differs from `ANALYSIS_SYSTEM_INTRO` in two ways: it's phrased as a one-shot **user** message addressed to Claude in the second person (not an API `system` block), and it asks for **markdown** output (claude.ai's UI renders it, unlike this app's own plain-text `ChatPanel`). It asks for the same fields — health score 0–100 with a one-line label, summary, highlights, improvements, risks — plus the same loans/`reference_salary`/`loans_max_salary_pct` instructions as the in-app analysis, and closes by inviting the user to keep asking follow-up questions using the pasted data as context.
- Frontend (`AIAdvisorTab.jsx`): "Copy to clipboard" (`navigator.clipboard.writeText`, with a transient "Copied!" checkmark state) and "Download as text file" (client-side `Blob`, filename `<dossier name>_ai_prompt.txt`). Both fetch a fresh prompt on click rather than caching one, so the data is always current.

## Export / import

- Export format **version 10**: `dossier.ai_model`, `dossier.ai_enabled`, and `dossier.ai_user_context` round-trip. Imports of versions ≤ 9 default `ai_model` to `claude-opus-5`, `ai_enabled` to `true`, and `ai_user_context` to `null` (those versions predate the field). An imported `ai_model` outside the allowed families (haiku/sonnet/opus/gemini-pro/gemini-flash — e.g. a hand-edited export, `claude-fable-5`, a `-lite`/`-8b` Gemini variant, or a versionless `gemini-{pro,flash}-latest` alias) is likewise coerced to `DEFAULT_AI_MODEL` rather than stored as-is; a valid-family model of any version and either provider (including an older one a "Refresh models" run has since superseded in the picker) round-trips unchanged. **No export-format version bump was needed to add Gemini support** — `ai_model` already round-trips as a validated free string; only the set of values `isAllowedAiModel` accepts widened, which doesn't change what an importer needs to default for the field's *presence*.
- `ai_api_key` and `ai_gemini_api_key` are secrets, like `paperless_token` — **neither is ever exported or imported**. An imported dossier always falls back to the operator's `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` env vars (if set) until new keys are entered in its own Settings.
- `ai_analyses` rows are deliberately **not** exported (point-in-time, cheap to regenerate).

## Provider adapters

`callAiProvider({ model, system, messages, maxTokens, jsonSchema, apiKey })` in `ai-advisor.js` derives `modelProvider(model)` and dispatches to `callClaude` or `callGemini` — the two route handlers (`POST /analysis`, `POST /chat`) call only this dispatcher, never a provider-specific function directly, so they stay provider-agnostic. Both underlying functions share one contract: same params, same `{ text, usage, model }` return shape (`usage` always keyed `input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`, Anthropic's native naming — Gemini's usage is normalized into it), and the same `{status, message}` throw shape for errors.

Request translation (Claude → Gemini):

| Claude (`callClaude`) | Gemini (`callGemini`) |
|---|---|
| `system` (string) → `system: [{type:'text', text, cache_control:{type:'ephemeral'}}]` | `system` (string) → `systemInstruction: {parts:[{text}]}` — no cache-control equivalent sent |
| `messages: [{role:'user'\|'assistant', content}]` | `contents: [{role:'user'\|'model', parts:[{text: content}]}]` — `assistant` renamed to `model` |
| `maxTokens` → `max_tokens` | `maxTokens` → `generationConfig.maxOutputTokens` |
| `jsonSchema` → `output_config.format: {type:'json_schema', schema: jsonSchema}` | `jsonSchema` → `generationConfig.responseMimeType:'application/json'` + `responseSchema: toGeminiSchema(jsonSchema)` |

`toGeminiSchema(schema)` adapts `ANALYSIS_SCHEMA`'s JSON-Schema dialect to the OpenAPI-3.0 subset Gemini's `responseSchema` accepts: drops `additionalProperties` (unsupported, present at three nesting levels in `ANALYSIS_SCHEMA`), uppercases every `type` value (`'object'` → `'OBJECT'`), and adds `propertyOrdering` at each object level (the object's own key order) so the response's field order is deterministic. `properties`/`required`/`items`/`enum`/`description` pass through unchanged.

Refusal/truncation mapping — both sides collapse to the same three user-facing messages so the UI reads identically regardless of provider:

| Outcome | Claude signal | Gemini signal | Message |
|---|---|---|---|
| Refused/blocked | `stop_reason === 'refusal'` | `candidates[0].finishReason` ∈ `{SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, RECITATION}`, or `promptFeedback.blockReason` set with no candidates at all | "The model declined this request. Try again or pick a different model in the selector." |
| Truncated | `stop_reason === 'max_tokens'` | `finishReason === 'MAX_TOKENS'` | "The response was cut short by the token limit. Please try again." |
| Other unexpected stop | *(not handled specially — falls through to a parse/response error)* | any other non-`STOP` `finishReason` | "The model stopped unexpectedly (`<reason>`). Please try again." |

Usage normalization (`callGemini` only — Claude's `usage` object already matches the target shape natively): `input_tokens = usageMetadata.promptTokenCount`; `output_tokens = usageMetadata.candidatesTokenCount + usageMetadata.thoughtsTokenCount` (thinking tokens are billed as output but are *not* included in `candidatesTokenCount` on thinking-by-default models, so omitting them would silently understate cost); both cache fields are always `0` (see "Cost estimate pricing" above for why).

## Logging

`[ai-advisor]` category: analysis runs and chat turns log dossier id, username, model, token counts and cost — never prompt or reply content. Model catalog refreshes log the triggering user/dossier, the resolved model ids, and any skipped/errored providers. Failures log the error message.

## Out of scope (v1)

- Streaming (SSE) chat responses — buffered by design; can be added later.
- Persisting chat history.
- Per-user API keys or spend limits (per-*dossier* keys are supported; see AI Settings above).
- Gemini's explicit context-caching API (`cachedContent`) — only Claude's request-level ephemeral prompt caching is used; Gemini requests always resend the full context.
- Gemini thinking-budget controls (`thinkingConfig`) — both providers' models use their own default reasoning effort, same as the existing "no `thinking` parameter" convention for Claude.
- Vertex AI (Google Cloud) endpoints — only the direct Gemini API (`generativelanguage.googleapis.com`) is supported, mirroring Claude's direct-API-only (no Bedrock/Vertex) integration.
