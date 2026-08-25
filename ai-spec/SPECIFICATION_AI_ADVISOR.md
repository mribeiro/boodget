# Specification — AI Advisor

## Overview

The AI Advisor is a per-dossier feature that sends a trimmed snapshot of the dossier's financial data to the Claude API (Anthropic) and returns:

1. **Analysis** — a structured financial-health assessment triggered by an "Analyze dossier" button.
2. **Chat** — a free-form conversation about the dossier, with the same data snapshot as context.
3. **Export prompt** — a copy/download of a self-contained prompt (same instructions + data) for pasting into claude.ai chat or any other subscription-billed Claude client, for users who'd rather not pay per API call.

Analysis lives in a dedicated **AI Advisor** tab in `DossierView`; Chat lives in a floating widget available from anywhere inside a dossier (`frontend/src/components/ai-advisor/`), backed by `backend/src/routes/ai-advisor.js` (mounted from `dossiers.js` like the other `/:id` sub-routers). Both Analysis and Chat stream from the Claude API through an in-memory backend job registry (see Endpoints below) and a frontend module-level store, `frontend/src/utils/aiAdvisorSession.js`, that keeps an in-flight request alive across the `DossierView` tab-switch remount — see Analysis behaviour / Chat behaviour below for the recovery guarantees, and Chat behaviour's "Floating chat widget" subsection for the widget's states, per-chat model switch, and page-context attachment.

## Configuration

- The server operator can supply a shared Anthropic API key via the `ANTHROPIC_API_KEY` environment variable (set in `.env`, referenced by `docker-compose.yml`). Additionally, each dossier can set its own key in **Settings → AI Settings** (`dossiers.ai_api_key`, write-only — never returned by any GET endpoint, and stripped from `GET /api/dossiers/:id`'s `SELECT *` response before it reaches the frontend). A dossier's own key, when set, takes priority over the env var; otherwise the env var is used as a fallback. Neither key is ever exposed to the frontend once saved (the settings GET exposes only `ai_api_key_set: bool`, mirroring the `paperless_token` convention).
- **Per-dossier enable/disable**: `dossiers.ai_enabled` (default `true`) is also configured in Settings → AI Settings. When disabled: the **AI Advisor tab is not rendered at all** in `DossierView` (no reference to AI appears anywhere in the dossier UI), and every backend endpoint (`GET /ai-advisor/analysis`, `POST /ai-advisor/analysis/start`, `POST /ai-advisor/chat/start`, `GET /ai-advisor/export-prompt`, and the two `GET .../stream/:jobId` — see Endpoints below) returns `403 { error: 'AI Advisor is disabled for this dossier' }` regardless of frontend state, as defense in depth. `AIAdvisorTab` also guards against a **mid-session disable**: if `ai_enabled` is toggled off in another tab/session while this one already has the AI Advisor tab open, `loadAll` picks it up from `GET /settings`'s `ai_enabled` on its next run, and any in-flight action (Analyze, chat send, copy/download prompt) that hits the `403` above matches the exact error string (`isAiDisabledError` in `frontend/src/utils/aiModels.js`, shared with `ChatPanel` via an `onDisabled` callback) and switches the whole tab body to the same friendly "AI Advisor is disabled for this dossier" card used for the never-configured case, instead of surfacing the raw error.
- If no key is resolved (neither dossier nor env var): `GET /ai-advisor/analysis` still succeeds and returns `configured: false` (the UI shows a setup card pointing at both configuration options, and disables actions); the `/start` endpoints return `503` with a setup message, checked synchronously before any job is created.
- The Claude API is called with raw `fetch` (no SDK dependency): `POST https://api.anthropic.com/v1/messages` with `"stream": true`, headers `x-api-key`, `anthropic-version: 2023-06-01`, 180 s `AbortController` timeout. The response body's Server-Sent Events are parsed by hand (`callClaudeStream` in `ai-advisor.js` — split on blank lines, read the `event:`/`data:` fields) rather than via an SDK helper, for the same no-new-dependency reason. No `thinking` parameter is sent (models use their own defaults).

## Model selection

- Persisted per dossier in `dossiers.ai_model` (migration `033_add_ai_advisor`), default `claude-opus-5`.
- **The whitelist is by family, not exact model+version.** `isAllowedAiModel(modelId)` (`backend/src/routes/ai-advisor.js`) accepts any id matching `/^claude-(haiku|sonnet|opus)-/` — `claude-fable-*`/`claude-mythos-*` and anything else are rejected. This is deliberate: a dossier's chosen model never becomes invalid just because a newer version of that family is released (e.g. a dossier left on `claude-opus-4-8` stays valid indefinitely, even after `claude-opus-5` becomes the suggested default). Exposed through the existing `GET/PATCH /api/dossiers/:id/settings`; PATCH validates via `isAllowedAiModel`. Dossier import (`POST /api/dossiers/import`) validates the same way, coercing an out-of-family `ai_model` (e.g. from a hand-edited export, or a pre-this-change export carrying `claude-fable-5`) to `DEFAULT_AI_MODEL` rather than storing it as-is — keeps the Settings dropdown and `resolveAiConfig`'s runtime fallback from silently diverging.
- Editable from two places that write the same setting: the `<select>` in the AI Advisor tab header, and the "Default model" picker in **Settings → AI Settings** (`DossierSettingsTab.jsx`). Both pickers are plain `<select>`s; changing either PATCHes the setting immediately.

### Model catalog (picker options) — dynamic, refreshable

The whitelist (above) governs *validity*; a separate, app-wide **catalog** governs what the two pickers *suggest*. This keeps a hardcoded model list from going stale (e.g. a new "Opus 5" shipping with no code change) while never retroactively invalidating an already-chosen older version.

- `getAvailableModels()` reads a single JSON blob from `app_settings` (key `ai_available_models`, same key-value table the VAPID keys use — no dedicated schema, no migration needed) shaped `{ models: [{id, family, display_name}, ...], updated_at }`. If the row is missing, unparseable, or empty, it falls back to `DEFAULT_MODELS` — three baked-in entries (one per family, currently `claude-haiku-4-5` / `claude-sonnet-5` / `claude-opus-5`) that also define `DEFAULT_AI_MODEL` (the opus entry). The cache is **global**, not per-dossier — model availability isn't dossier-scoped, so every dossier's picker reads the same resolved list.
- `refreshAvailableModels(apiKey)` calls `GET https://api.anthropic.com/v1/models` (paginated via `after_id`/`has_more`, no beta header), filters to ids matching the family regex, and for each of the 3 families keeps only the entry with the most recent `created_at` — **older versions of a family are dropped from the suggested list, never offered as both an "old" and "new" option side by side**. A family absent from the response (e.g. a transient gap) keeps its previously-cached entry rather than being dropped or reset to the baked-in default. The result is written back to `app_settings` with a fresh `updated_at` and returned.
- Requires a resolvable API key — the same precedence as everywhere else (`resolveAiConfig(dossierId).apiKey`: the dossier's own `ai_api_key`, else `ANTHROPIC_API_KEY`) — and throws a `503` if neither is set.
- **Not gated by `ai_enabled`** (neither the GET nor the POST below): the Settings → AI Settings picker must render options even while the feature is turned off, so a user can see what's available before enabling it.

### Cost estimate pricing — by family, not exact model

`FAMILY_PRICING` in `ai-advisor.js` is keyed by family (`haiku`/`sonnet`/`opus`), not exact model id — `GET /v1/models` doesn't expose pricing, and a family's rate is far more stable across its own version bumps than the id itself. `computeCostUsd(model, usage)` resolves the model's family first, then looks up pricing; an id outside the three families (e.g. a historical `claude-fable-5` value on an old `ai_analyses` row) returns `null` — that row's already-persisted `cost_usd` is unaffected, since it was computed and stored at analysis time, not recomputed on read.

| Family | Input | Output |
|---|---|---|
| haiku | $1 | $5 |
| sonnet | $3 | $15 |
| opus | $5 | $25 |

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
- Last **6 cycles** with income lines (`income_total` plus per-line `{name, value}` breakdown, from the dossier's configurable income lines — see the Income Line key concept in `CLAUDE.md`), previous balance, items (paid/spent/done state), closed state, final real balance. Cycles are labelled with their display month (the month they end in).
- Goals with computed values (reuses `computeGoalValues`, now exported from `routes/goals.js`).
- **Loans** — every loan (draft and active), reusing `computeLoanValues` (now exported from `routes/loans.js`): name, status, interest rate, `monthly_payment`, `salary_pct`; draft-only `principal`/`term_months` or active-only `current_balance`/`balance_as_of`/`months_left`/`payments_made`/`term_from_anchor`/`payments_tracked`/`is_matured` (true once the loan's `end_date` has passed with no payments left but it's still marked active — worth flagging as a risk, since a `current_balance` projected down to `0` there doesn't mean the debt is gone); `purchase_price`/`total_interest`/`total_amount_payable` whenever origination data is on record; active-only `remaining_interest` (`null` once matured, since nothing is scheduled) and, for linked loans, the linked expense item's name plus `covered`/`coverage_difference`. The stored `remaining_balance` is deliberately **not** sent: it's a *dated* anchor (§4.3 of `SPECIFICATION_LOANS.md`), so a model reading it as today's debt would overstate what's owed — `current_balance` is the live figure, with `balance_as_of`/`payments_made` alongside it so the model can weigh how stale the projection is. `payments_tracked` is false when an active loan has no linked monthly expense, meaning its payment isn't budgeted anywhere in the template. The month-by-month payment plan and its per-period paid state are **not** included — the plan is client-side-only and can run hundreds of rows for long terms, which would bloat the payload for no analytical benefit; `payments_made` summarizes the progress instead.
- **Subscriptions** — active subscriptions only: `{name, monthly_cost, billing_day, linked_distribution}` per item, plus a `total_monthly_cost`. `linked_distribution` is the linked distribution template item's name (or `null`); the model is instructed to compare a distribution's total linked subscriptions against that distribution's own budgeted `value` (from `expense_template.distributions`) and flag it as a risk if exceeded.
- **Cars** — every car, reusing `computeCarMonthValues`/`summarizeCarMonths` (exported from `routes/cars.js`, see `SPECIFICATION_CAR_EXPENSES.md`): `name`, `fuel_type`, `latest_mileage_km`, `latest_month` (`{period, km_driven, energy_cost, monthly_expenses_total, annual_expenses_total, adhoc_expenses_total, total_cost, unknown_count}` — an **actual**, not budgeted, figure), `ytd_total_cost`, `avg_monthly_cost_12m`, `linked_expense_items` (names only), `adhoc_recurring_items` (active recurring ad-hoc expenses, `{name, monthly_value}`), and `monthly_series` (last 12 months, oldest first, `{period, km_driven, total_cost}`). Raw snapshot averages/prices (L/100km, €/kWh) and the per-item cost breakdown are dropped — the model can't act on a per-liter price, and the linked items' own amounts already surface via `expense_template`/`annual_expense_template`/`recent_cycles`. The model is instructed to treat `unknown_count > 0` as meaning that month's `total_cost` is a floor, not a final figure, and to treat `adhoc_expenses_total`/`adhoc_recurring_items` (costs someone else pays that the user tracks manually for a complete car cost, e.g. a spouse's insurance) as folded into `total_cost` but not the user's own spending.
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
     → { configured: bool, analysis: {...} | null }   — last persisted analysis, buffered read
     Errors: 403 AI disabled for this dossier

POST /api/dossiers/:id/ai-advisor/analysis/start
     → 202 { job_id }   — starts a new run, or reattaches to one already running for this
     dossier (idempotent: no duplicate concurrent runs from a double-click or a second tab)
     Errors: 403 AI disabled · 503 not configured (checked synchronously, before any job exists)

GET  /api/dossiers/:id/ai-advisor/analysis/stream/:jobId
     → text/event-stream. `sync` once on attach (whatever text has accumulated so far — a
     reconnect replaces its buffer with this, not append), then `delta` per chunk, then a
     terminal `done` (analysis object, same shape as the GET above) or `error` ({error: string}).
     Job keeps running server-side even if every listener disconnects; a fresh GET some time
     later still gets a `sync` catch-up (jobs are retained ~20 min after completion).
     Errors: 404 job not found / not this dossier's

POST /api/dossiers/:id/ai-advisor/chat/start   { messages: [{role, content}], model?, page_context? }
     → 202 { job_id }
     Validation: 1–40 messages, roles user/assistant, non-empty strings ≤ 8000 chars,
     must start and end with a user message (all checked before the 503-not-configured check).
     model: optional ephemeral per-call override — must pass the family whitelist
     (isAllowedAiModel), 400 otherwise; used only for this job, never written to
     dossiers.ai_model.
     page_context: optional arbitrary JSON object (from the floating widget's "attach page"
     toggle — see Chat behaviour below), capped at 6000 serialized chars (400 if exceeded);
     spliced onto the newest message's text only, never into the cached system block.
     Nothing persisted server-side (see Chat behaviour below).
     Errors: 400 validation · 403 AI disabled · 503 not configured

GET  /api/dossiers/:id/ai-advisor/chat/stream/:jobId
     → text/event-stream, same `sync`/`delta`/`done`/`error` shape as the analysis stream;
     `done`'s payload is { reply, model, cost_usd, input_tokens, output_tokens }.
     Errors: 404 job not found / not this dossier's

GET  /api/dossiers/:id/ai-advisor/jobs/active
     → { analysis: jobId|null, chat: jobId|null }
     Lets a fresh mount (including a full page reload) discover a run already in progress and
     reconnect via the stream endpoints above, instead of showing stale state or starting a
     redundant, billable second run.

GET  /api/dossiers/:id/ai-advisor/export-prompt
     → { prompt: string } — self-contained, paste-into-claude.ai prompt (context + instructions)
     Does not call the Claude API; no API key required.
     Errors: 403 AI disabled for this dossier

GET  /api/dossiers/:id/ai-advisor/available-models
     → { models: [{id, family, display_name}], updated_at: string|null }
     Cached/default catalog — does not call the Claude API. Not gated on ai_enabled.

POST /api/dossiers/:id/ai-advisor/refresh-models
     → same shape as GET above, freshly fetched from GET https://api.anthropic.com/v1/models
     Keeps only the latest-created model per family (haiku/sonnet/opus); a family absent from
     the response keeps its previous entry. Not gated on ai_enabled.
     Errors: 503 no API key resolvable · 502 upstream error
```

The `analysis` object merges the stored JSON content with metadata: `health_score` (integer 0–100), `health_summary`, `highlights[]`, `improvements[]`, `risks[]` (each item `{title, detail}`), plus `model`, `created_at`, `cost_usd`, `input_tokens`, `output_tokens`.

## Analysis behaviour

- Uses **structured outputs** (`output_config.format` with a JSON schema) so the response always parses; `max_tokens` 8192. Structured output is compatible with streaming — the JSON still arrives as ordinary `text_delta` chunks on one text content block, so it's only parsed once the stream completes (no partial-JSON parsing on the frontend).
- The system prompt instructs: score 0–100, 2–4 sentence summary, 3–6 highlights, 2–6 improvements, 0–4 risks; plain text in every field; reference concrete numbers/accounts/months. It also instructs the model to factor active loans' `monthly_payment` into repayment capacity, flag underbudgeted (uncovered) linked loans as a risk, compare combined active-loan payments against the dossier's `loans_max_salary_pct` ceiling (when both it and `reference_salary` are set) and flag if exceeded, treat draft loans as hypothetical studies rather than real liabilities, treat a long-stale `balance_as_of` as an estimate worth re-checking rather than fact, and flag an active loan with `payments_tracked` false as an unbudgeted gap. It further instructs the model to use `annual_expense_template.total_monthly_avg` to sanity-check a given year's budgeted total and factor recurring-but-not-yet-budgeted costs into capacity, and to treat `workbench` snapshots as the user's own targets/plans (not actuals) — useful for flagging a structurally unaffordable plan (strongly negative `leftover`) or a large drift between a stated plan and `recent_cycles`.
- **Streamed via an in-memory job**: `POST .../analysis/start` creates a job (or returns the id of one already running for this dossier) and kicks off `runAnalysisJob` detached from that HTTP request — it keeps running to completion even if every SSE listener disconnects. Result is **upserted** into `ai_analyses` (UNIQUE on `dossier_id` — only the latest analysis is kept per dossier) exactly as before streaming was added. The tab shows the stored analysis with "Analysed on [date] · [model] · cost" on open; a Re-analyze button starts a new job. While a job is running, `AIAdvisorTab` shows a live raw-text preview (the accumulating stream) in place of the button's static state, swapping to the normal structured panel once the `done` event's parsed result arrives.
- Recovery: `GET .../jobs/active` on mount (including a genuine page reload, not just a same-session remount) reports a running analysis job so the tab reconnects to it via `GET .../analysis/stream/:jobId` instead of showing stale state or letting the user fire a redundant, billable second run.
- `stop_reason` handling: `refusal` → the job ends in `error` with a suggestion to pick another model; `max_tokens` → `error` "cut short". Text is accumulated from `content_block_delta` events whose `delta.type === 'text_delta'` (thinking/other block types are ignored) — the same shape the old buffered code produced by concatenating `type === 'text'` content blocks, just assembled incrementally.

## Chat behaviour

- Ephemeral by design: history lives in a module-level store (`frontend/src/utils/aiAdvisorSession.js`), not in the backend and not in React component state, and the full history is re-sent each turn (`max_tokens` 2048 per reply). Nothing about a chat turn is written to the database.
- **Streamed via the same in-memory job mechanism as Analysis** (`POST .../chat/start` → `GET .../chat/stream/:jobId`), but *not* deduplicated against an already-running chat job — each call carries its own distinct question, unlike re-clicking Analyze.
- **Recovery scope is deliberately narrower than Analysis**: because `DossierView`'s tab content is remounted on every tab switch (`key={activeTab}`, see `ai-spec/SPECIFICATION_UI.md`), a `ChatPanel` backed only by local `useState` used to lose an in-flight turn — and the tokens it cost — the instant the user switched to another tab and back. Moving chat state into the module-level `aiAdvisorSession` store (keyed by dossier id, holding both `chatMessages` and the current `chatJob`) fixes that: it survives the remount because it isn't React state. A full page reload or navigating away from the dossier still resets chat, matching the panel's own "conversation is not stored and resets when you leave" copy — there is intentionally no `GET .../jobs/active` reconnect for chat on mount, since a reload has nothing to reconnect the message history *to* anyway.
- The chat system prompt instructs concise plain-text answers (no markdown — the UI renders with `white-space: pre-wrap`, no markdown renderer) and to draw on loan data (payments, rates, coverage, total interest) when relevant, treating draft loans as hypothetical and a long-stale `balance_as_of` as an estimate rather than fact, and to draw on `annual_expense_template`/`workbench` when relevant, treating workbench figures as targets/plans rather than actuals.

### Floating chat widget

Chat is not embedded in the AI Advisor tab — it's a floating widget (`frontend/src/components/ai-advisor/AiChatWidget.jsx`) available from anywhere inside a dossier. `AIAdvisorTab` keeps only Analysis, the additional-context notes textarea, and the Analysis model picker, with a small pointer card ("use the chat button in the bottom-right corner…") where the embedded panel used to be.

- **Mounting and visibility**: mounted once in `AppShell.jsx` — the one place in the component tree that survives both route changes and the dossier tab-switch remount — so an open widget (and any in-flight turn) is unaffected by navigating anywhere inside the dossier. Shown only when the current route is inside a dossier (same `isInDossierPath` check `Sidebar.jsx` uses for its own nav) *and* that dossier's `ai_enabled !== 0`; hidden entirely otherwise (Dossier List, Users, Notifications, or a disabled dossier), matching the "no AI reference anywhere" principle from the Configuration section above.
- **Three states, controlled by `AppShell`** (mirroring how it already owns the sidebar's `collapsed` state): closed (a `.ai-chat-fab` button, bottom-right by default), open as a small popup card (`.ai-chat-widget`), or open pinned as a full-height panel docked to the right edge (`.ai-chat-widget.pinned`). Pinning also adds a `chat-pinned` class to `.app-shell-main`, which gets a matching `margin-right: var(--chat-widget-width)` (380px) so the main column reflows around the docked panel instead of being covered by it — the same pattern `.sidebar-collapsed` already uses for the sidebar's own margin. The pinned preference persists in `localStorage` as `ct-chat-pinned` (mirroring `ct-sidebar-collapsed`); open/closed does not persist and always starts closed. Pinning is unavailable below the `768px` breakpoint (mobile always renders the popup-card style, full-width near the bottom of the screen).
- **Draggable FAB**: the closed FAB is user-repositionable — a fixed bottom-right circle otherwise sometimes overlaps other fixed-position UI (a page's own bottom toolbar on mobile, a detail page's Edit/Delete buttons). Implemented with Pointer Events (`onPointerDown`/`onPointerMove`/`onPointerUp` plus `setPointerCapture`, `touch-action: none` in CSS so it works identically with touch and mouse) rather than native HTML5 drag-and-drop (which the codebase otherwise uses only for list reordering, not free positioning). A pointer move past a small threshold (4px) marks the interaction a drag: the button follows the pointer (clamped to stay fully within the viewport, re-clamped on window resize), and the click that would otherwise follow pointerup is swallowed so a drag never also opens the chat. The final position persists per-viewer in `localStorage` as `ct-chat-fab-position` (`{right, bottom}` px offsets from that corner, so it stays anchored to the same corner across resizes) — a fresh browser/profile falls back to the CSS default (24px/24px). Only the closed FAB is draggable; the open popup card and pinned panel keep their existing fixed positions, since the FAB itself isn't rendered while the chat is open.
- **Per-chat model switcher**: a compact `<select>` in the widget header, populated from the same `useAiAvailableModels`/`modelSelectOptions` catalog the Analysis picker uses, defaulting to the dossier's `ai_model` on open. Selecting a different model here only affects this widget's own chat calls (via the `model` field on `POST .../chat/start` — see Endpoints above); it is never written to `dossiers.ai_model` and has no effect on the Analysis picker or a future "Analyze dossier" run.
- **"Attach current page" toggle**: a small module-level singleton, `frontend/src/utils/pageContext.js` (`publishPageContext({label, data})` / `clearPageContext()` / `subscribePageContext(cb)`), holds a summary of whatever dossier page is currently on screen. Each dossier page publishes into it as it loads (and clears it on unmount) — wired into the list tabs (Capital, Monthly Expenses, Annual Expenses, Workbench, Goals, Loans, Subscriptions, Emergency Fund) and the detail routes (a Month, a Cycle, a Goal, a Loan). Settings and the AI Advisor tab itself are not wired (config/meta pages, not "data to ask about"). When the toggle is on and a page has published something, the widget shows a small chip with that page's `label` and forwards its `data` as `page_context` on the next `POST .../chat/start`; the toggle is disabled with an explanatory tooltip when nothing's published for the current page. This is genuinely richer than the dossier-wide snapshot in some cases — e.g. a Loan's full amortization schedule, or a cycle older than the 6-most-recent window `buildDossierContext` caps at, are both things `page_context` can surface that the standing dossier context deliberately omits.
- UI: bubbles (`.ai-chat-bubble--user/--assistant`), a pending bubble that fills in live as `delta` events arrive (falling back to "Thinking…" until the first chunk), per-reply cost label, Clear button (`clearChat`, resets the session store for this dossier). Each assistant message also stores the `model` returned with that reply (mirroring `AnalysisPanel`'s persisted `model` field); a small model-name badge (shared `MODEL_LABELS` map in `utils/aiModels.js`) is shown next to a reply only when it differs from the model of the previous assistant reply, so switching the per-dossier `ai_model` setting mid-conversation is visible in the transcript.

## Export prompt (paste into claude.ai chat)

For users who'd rather use a Claude subscription than pay per API call, the "Use your Claude subscription instead" card (always shown, regardless of `configured`) lets them copy or download the same analysis as a self-contained, one-shot prompt:

- `GET /api/dossiers/:id/ai-advisor/export-prompt` → `{ prompt: string }`. Gated only on `canAccess` + `config.enabled` (`403` when AI is disabled for the dossier) — it does **not** call the Claude API and does **not** require an API key, so `configured` is irrelevant here.
- The prompt is `EXPORT_PROMPT_INTRO + buildDossierContext(dossierId)` — the same context payload as the in-app analysis/chat, prefixed with a standalone instruction block (`EXPORT_PROMPT_INTRO` in `ai-advisor.js`) that differs from `ANALYSIS_SYSTEM_INTRO` in two ways: it's phrased as a one-shot **user** message addressed to Claude in the second person (not an API `system` block), and it asks for **markdown** output (claude.ai's UI renders it, unlike this app's own plain-text `ChatPanel`). It asks for the same fields — health score 0–100 with a one-line label, summary, highlights, improvements, risks — plus the same loans/`reference_salary`/`loans_max_salary_pct` instructions as the in-app analysis, and closes by inviting the user to keep asking follow-up questions using the pasted data as context.
- Frontend (`AIAdvisorTab.jsx`): "Copy to clipboard" (`navigator.clipboard.writeText`, with a transient "Copied!" checkmark state) and "Download as text file" (client-side `Blob`, filename `<dossier name>_ai_prompt.txt`). Both fetch a fresh prompt on click rather than caching one, so the data is always current.

## Export / import

- Export format **version 10**: `dossier.ai_model`, `dossier.ai_enabled`, and `dossier.ai_user_context` round-trip. Imports of versions ≤ 9 default `ai_model` to `claude-opus-5`, `ai_enabled` to `true`, and `ai_user_context` to `null` (those versions predate the field). An imported `ai_model` outside the allowed families (haiku/sonnet/opus — e.g. a hand-edited export, `claude-fable-5`, or any other string) is likewise coerced to `DEFAULT_AI_MODEL` rather than stored as-is; a valid-family model of any version (including an older one a "Refresh models" run has since superseded in the picker) round-trips unchanged.
- `ai_api_key` is a secret, like `paperless_token` — it is **never exported or imported**. An imported dossier always falls back to the operator's `ANTHROPIC_API_KEY` env var (if set) until a new key is entered in its own Settings.
- `ai_analyses` rows are deliberately **not** exported (point-in-time, cheap to regenerate).

## Logging

`[ai-advisor]` category: analysis runs and chat turns log dossier id, username, model, token counts and cost — never prompt or reply content. Model catalog refreshes log the triggering user/dossier and the resolved model ids. Failures log the error message.

## Out of scope (v1)

- Persisting chat history server-side — chat stays ephemeral by design (see Chat behaviour above); only the in-flight turn is made resilient to in-app navigation, not the transcript across reloads.
- Per-user API keys or spend limits (per-*dossier* keys are supported; see AI Settings above).
