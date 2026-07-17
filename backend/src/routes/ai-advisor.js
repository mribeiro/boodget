'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { computeEmergencyFundStatus } = require('./emergency-fund');
const { computeGoalValues } = require('./goals');
const { computeLoanValues } = require('./loans');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

const ALLOWED_AI_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'];
const DEFAULT_AI_MODEL = 'claude-opus-4-8';

// USD per million tokens. Cache writes cost 1.25x input, cache reads 0.1x input.
const PRICING = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
};

function computeCostUsd(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return null;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    (input * p.input + output * p.output + cacheWrite * 1.25 * p.input + cacheRead * 0.1 * p.input) /
    1e6
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A cycle stored as (year, month) is displayed with the month it ends in.
function cycleLabel(year, month) {
  const d = new Date(year, month, 1); // stored month is 1-based → JS index = following month
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// Summarize a workbench snapshot's stored `data` blob into Must/Want/Save totals — mirrors
// computeGlobalSummary() in frontend/src/components/workbench/WorkbenchTab.jsx.
function summarizeWorkbenchData(data) {
  const sum = (arr, fn) => (arr || []).reduce((s, x) => s + (fn(x) || 0), 0);
  const totalIncome = sum(data.income, (e) => e.value);
  const monthlyMust = sum((data.monthlyExpenses || []).filter((e) => e.classification === 'must'), (e) => e.value);
  const monthlyWant = sum((data.monthlyExpenses || []).filter((e) => e.classification === 'want'), (e) => e.value);
  const annualMustAvg = sum((data.annualExpenses || []).filter((e) => e.classification === 'must'), (e) => e.value / 12);
  const annualWantAvg = sum((data.annualExpenses || []).filter((e) => e.classification === 'want'), (e) => e.value / 12);
  const distMust = sum(data.distributions, (e) => e.must_amount || 0);
  const distWant = sum(data.distributions, (e) => e.want_amount || 0);
  const distSave = sum(data.distributions, (e) => e.save_amount || 0);
  const totalMust = monthlyMust + annualMustAvg + distMust;
  const totalWant = monthlyWant + annualWantAvg + distWant;
  const totalSave = distSave;
  return {
    total_income: totalIncome,
    total_must: totalMust,
    total_want: totalWant,
    total_save: totalSave,
    leftover: totalIncome - totalMust - totalWant - totalSave,
  };
}

// Build a trimmed, model-readable snapshot of the dossier's finances.
function buildDossierContext(dossierId) {
  const dossier = db
    .prepare('SELECT name, currency, cycle_start_day, reference_salary, loans_max_salary_pct, ai_user_context FROM dossiers WHERE id = ?')
    .get(dossierId);

  const accounts = db
    .prepare(
      'SELECT id, group_name, name, type, money_category FROM accounts WHERE dossier_id = ? AND archived = 0 ORDER BY position, rowid'
    )
    .all(dossierId);

  // Capital time series (filled months only), oldest first, capped at 24 months
  const capitalSeries = db
    .prepare(
      `SELECT m.year, m.month,
        (SELECT SUM(me.value) FROM month_entries me
         JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = m.id AND a.money_category IN ('idle', 'active')) as capital_total,
        (SELECT SUM(me.value) FROM month_entries me
         JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = m.id AND a.money_category = 'idle') as idle_total,
        (SELECT SUM(me.value) FROM month_entries me
         JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = m.id AND a.money_category = 'stocks') as stocks_total
      FROM months m
      WHERE m.dossier_id = ? AND m.filled = 1
      ORDER BY m.year DESC, m.month DESC LIMIT 24`
    )
    .all(dossierId)
    .reverse()
    .map((m) => ({
      period: `${m.year}-${String(m.month).padStart(2, '0')}`,
      capital_total: m.capital_total,
      idle_total: m.idle_total,
      stocks_total: m.stocks_total,
    }));

  // Latest filled month's per-account values
  const recentMonth = db
    .prepare('SELECT id, year, month FROM months WHERE dossier_id = ? AND filled = 1 ORDER BY year DESC, month DESC LIMIT 1')
    .get(dossierId);
  let latestSnapshot = null;
  if (recentMonth) {
    const entries = db
      .prepare(
        `SELECT a.group_name, a.name, a.type, a.money_category, me.value
         FROM month_entries me JOIN accounts a ON a.id = me.account_id
         WHERE me.month_id = ? ORDER BY a.position, a.rowid`
      )
      .all(recentMonth.id);
    latestSnapshot = {
      period: `${recentMonth.year}-${String(recentMonth.month).padStart(2, '0')}`,
      accounts: entries.map((e) => ({
        group: e.group_name,
        name: e.name,
        type: e.type,
        money_category: e.money_category,
        value: e.value,
      })),
    };
  }

  // Monthly expense/distribution template
  const templateItems = db
    .prepare(
      'SELECT section, name, type, value, day_of_payment, classification, must_amount, want_amount, save_amount FROM expense_template_items WHERE dossier_id = ? ORDER BY section, position, rowid'
    )
    .all(dossierId);
  const expense_template = {
    expenses: templateItems
      .filter((i) => i.section === 'expense')
      .map((i) => ({ name: i.name, type: i.type, value: i.value, day_of_payment: i.day_of_payment, classification: i.classification })),
    distributions: templateItems
      .filter((i) => i.section === 'distribution')
      .map((i) => ({ name: i.name, value: i.value, must_amount: i.must_amount, want_amount: i.want_amount, save_amount: i.save_amount })),
  };

  // Last 6 cycles with items
  const cycles = db
    .prepare(
      'SELECT id, year, month, salary, previous_balance, is_closed, final_real_balance FROM expense_cycles WHERE dossier_id = ? ORDER BY year DESC, month DESC LIMIT 6'
    )
    .all(dossierId);
  let cycleItemsByCycle = {};
  if (cycles.length > 0) {
    const ph = cycles.map(() => '?').join(',');
    const items = db
      .prepare(
        `SELECT cycle_id, section, name, type, value, day_of_payment, paid, spent, done FROM cycle_items WHERE cycle_id IN (${ph}) ORDER BY section, position, rowid`
      )
      .all(...cycles.map((c) => c.id));
    for (const item of items) {
      (cycleItemsByCycle[item.cycle_id] = cycleItemsByCycle[item.cycle_id] || []).push(item);
    }
  }
  const recent_cycles = cycles.reverse().map((c) => ({
    label: cycleLabel(c.year, c.month),
    salary: c.salary,
    previous_balance: c.previous_balance,
    is_closed: !!c.is_closed,
    final_real_balance: c.final_real_balance,
    items: (cycleItemsByCycle[c.id] || []).map((i) => ({
      section: i.section,
      name: i.name,
      type: i.type,
      value: i.value,
      ...(i.section === 'expense' && i.type === 'Fixed' ? { paid: !!i.paid } : {}),
      ...(i.section === 'expense' && i.type === 'Budget' ? { spent: i.spent } : {}),
      ...(i.section === 'distribution' ? { done: !!i.done } : {}),
    })),
  }));

  // Goals with computed progress
  const goalRows = db
    .prepare(
      'SELECT id, name, target_value, target_date, contribution_mode, manual_monthly_value, extra_value, extra_value_impact_mode FROM goals WHERE dossier_id = ? ORDER BY rowid'
    )
    .all(dossierId);
  const goals = goalRows.map((g) => {
    const computed = computeGoalValues(g, dossierId);
    return {
      name: g.name,
      target_value: g.target_value,
      target_date: g.target_date,
      contribution_mode: g.contribution_mode,
      state: computed.state,
      total_current_progress: computed.total_current_progress,
      remaining_amount: computed.remaining_amount,
      months_remaining: computed.months_remaining,
      monthly_value_needed: computed.monthly_value_needed,
      expected_monthly_contribution: computed.expected_monthly_contribution,
      feasible: computed.feasible,
    };
  });

  // Emergency fund status (drop per-account detail — the snapshot already covers values)
  const efStatus = computeEmergencyFundStatus(dossierId);
  delete efStatus.contributing_accounts;

  // Loans — draft (what-if studies) and active (real, ongoing). Amortization schedules are
  // not included (they're client-side-only and can span hundreds of rows for long terms).
  const loanRows = db.prepare('SELECT * FROM loans WHERE dossier_id = ? ORDER BY created_at ASC').all(dossierId);
  const loans = loanRows.map((loan) => {
    const computed = computeLoanValues(loan, dossierId);
    return {
      name: loan.name,
      status: loan.status,
      interest_rate: loan.interest_rate,
      monthly_payment: computed.monthly_payment,
      salary_pct: computed.salary_pct,
      ...(loan.status === 'draft'
        ? { principal: loan.principal, term_months: loan.term_months }
        : { remaining_balance: loan.remaining_balance, months_left: computed.months_left }),
      purchase_price: computed.purchase_price,
      total_interest: computed.total_interest,
      total_amount_payable: computed.total_amount_payable,
      remaining_interest: computed.remaining_interest,
      linked_expense_item: computed.linked_item?.name ?? null,
      covered: computed.covered,
      coverage_difference: computed.coverage_difference,
    };
  });

  // Subscriptions — discretionary personal costs funded from a distribution, deliberately not
  // part of expense_template (cancelled ones are excluded, they no longer cost anything).
  const subscriptionRows = db
    .prepare(
      `SELECT s.name, s.monthly_cost, s.billing_day, eti.name as linked_distribution_name, eti.value as linked_distribution_value
       FROM subscriptions s LEFT JOIN expense_template_items eti ON eti.id = s.distribution_template_item_id
       WHERE s.dossier_id = ? AND s.status = 'active' ORDER BY s.created_at`
    )
    .all(dossierId);
  const subscriptions = {
    items: subscriptionRows.map((s) => ({
      name: s.name,
      monthly_cost: s.monthly_cost,
      billing_day: s.billing_day,
      linked_distribution: s.linked_distribution_name ?? null,
    })),
    total_monthly_cost: subscriptionRows.reduce((sum, s) => sum + s.monthly_cost, 0),
  };

  // Annual expense years summary
  const annualYears = db
    .prepare('SELECT id, year, carryover FROM annual_expense_years WHERE dossier_id = ? ORDER BY year DESC LIMIT 3')
    .all(dossierId);
  const annual_expense_years = annualYears.map((y) => {
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(i.budgeted_value), 0) as budgeted,
                (SELECT COALESCE(SUM(p.real_value), 0)
                 FROM annual_expense_payments p
                 JOIN annual_expense_year_installments ins ON ins.id = p.installment_id
                 JOIN annual_expense_year_items ii ON ii.id = ins.year_item_id
                 WHERE ii.year_id = ? AND p.paid = 1) as paid
         FROM annual_expense_year_items i WHERE i.year_id = ?`
      )
      .get(y.id, y.id);
    return { year: y.year, carryover: y.carryover, total_budgeted: totals.budgeted, total_paid: totals.paid };
  });

  // Annual expense template — the recurring definition annual years are instantiated from
  // (insurance, car tax, etc.). Calendar precision (exact installment day/month) is dropped;
  // only the recurring cost and must/want split matter for analysis.
  const annualTemplateItems = db
    .prepare('SELECT name, value, classification, num_installments FROM annual_expense_template_items WHERE dossier_id = ? ORDER BY position')
    .all(dossierId);
  const annual_expense_template = {
    items: annualTemplateItems.map((i) => ({ name: i.name, value: i.value, classification: i.classification, num_installments: i.num_installments ?? 1 })),
    total_monthly_avg: annualTemplateItems.reduce((s, i) => s + (i.value || 0), 0) / 12,
  };

  // Workbench — ephemeral scenario snapshots (what-if planning, not real transactions).
  // Summarized to Must/Want/Save totals only; raw line items are dropped for brevity.
  const workbenchRows = db
    .prepare('SELECT name, data, updated_at FROM workbench_snapshots WHERE dossier_id = ? ORDER BY updated_at DESC LIMIT 3')
    .all(dossierId);
  const workbench = workbenchRows.map((w) => {
    let data;
    try {
      data = JSON.parse(w.data);
    } catch (e) {
      data = {};
    }
    return { name: w.name, updated_at: w.updated_at, ...summarizeWorkbenchData(data) };
  });

  return JSON.stringify(
    {
      today: new Date().toISOString().slice(0, 10),
      dossier: {
        name: dossier.name,
        currency: dossier.currency || 'EUR',
        cycle_start_day: dossier.cycle_start_day ?? 25,
        reference_salary: dossier.reference_salary ?? null,
        loans_max_salary_pct: dossier.loans_max_salary_pct ?? null,
        ...(dossier.ai_user_context ? { user_notes: dossier.ai_user_context } : {}),
      },
      accounts: accounts.map((a) => ({ group: a.group_name, name: a.name, type: a.type, money_category: a.money_category })),
      capital_series: capitalSeries,
      latest_snapshot: latestSnapshot,
      expense_template,
      recent_cycles,
      goals,
      loans,
      subscriptions,
      emergency_fund: efStatus,
      annual_expense_years,
      annual_expense_template,
      workbench,
    },
    null,
    1
  );
}

// Call the Claude Messages API. Returns { text, usage, model } or throws { status, message }.
async function callClaude({ model, system, messages, maxTokens, outputFormat, apiKey }) {
  if (!apiKey) {
    const err = new Error(
      'AI Advisor is not configured. Set an API key in this dossier\'s Settings → AI Settings, or set ANTHROPIC_API_KEY in your .env / docker-compose environment.'
    );
    err.status = 503;
    throw err;
  }

  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  if (outputFormat) {
    body.output_config = { format: outputFormat };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error('Could not reach the Claude API');
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const upstream = data?.error?.message || `HTTP ${resp.status}`;
    const err = new Error(`Claude API error: ${upstream}`);
    err.status = 502;
    throw err;
  }

  if (data.stop_reason === 'refusal') {
    const err = new Error('The model declined this request. Try again or pick a different model in the selector.');
    err.status = 502;
    throw err;
  }
  if (data.stop_reason === 'max_tokens') {
    const err = new Error('The response was cut short by the token limit. Please try again.');
    err.status = 502;
    throw err;
  }

  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { text, usage: data.usage || {}, model: data.model || model };
}

// Resolves per-dossier AI configuration: whether the feature is enabled, which API key to use
// (dossier-specific key takes priority over the operator's ANTHROPIC_API_KEY env var), and model.
function resolveAiConfig(dossierId) {
  const dossier = db.prepare('SELECT ai_enabled, ai_api_key, ai_model FROM dossiers WHERE id = ?').get(dossierId);
  const enabled = dossier?.ai_enabled == null ? true : !!dossier.ai_enabled;
  const apiKey = dossier?.ai_api_key || process.env.ANTHROPIC_API_KEY || null;
  const model = ALLOWED_AI_MODELS.includes(dossier?.ai_model) ? dossier.ai_model : DEFAULT_AI_MODEL;
  return { enabled, apiKey, model };
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['health_score', 'health_summary', 'highlights', 'improvements', 'risks'],
  properties: {
    health_score: { type: 'integer' },
    health_summary: { type: 'string' },
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
  },
};

const ANALYSIS_SYSTEM_INTRO = `You are a personal-finance advisor analysing a user's financial dossier from the "boodget" capital-tracking app.
All monetary amounts are in the dossier's currency unless stated otherwise. Percentages and trends should be computed from the capital series.
Produce a rigorous but encouraging analysis:
- health_score: an integer from 0 (critical) to 100 (excellent) reflecting overall financial health (savings buffer, expense discipline, capital trend, goal feasibility, loan repayment capacity).
- health_summary: 2-4 sentences summarising the overall situation.
- highlights: 3-6 notable strengths or positive facts, each with a short title and a specific detail referencing actual numbers.
- improvements: 2-6 concrete, actionable suggestions, each with a short title and a specific detail.
- risks: 0-4 risks or warning signs worth watching (empty array if none).
The dossier may include loans (draft studies or active, ongoing loans). For active loans, factor their monthly_payment into repayment capacity, note whether they're covered by a linked budgeted expense (underbudgeted loans are a risk worth flagging), and weigh total interest/salary_pct where relevant. If the dossier has both a reference_salary and a loans_max_salary_pct set, compare the combined active-loan payments against that self-imposed ceiling and flag it as a risk if exceeded. Draft loans are hypothetical studies, not commitments — treat them as context, not liabilities.
annual_expense_template is the recurring baseline (insurance, car tax, etc.) that annual_expense_years is instantiated from each calendar year — use total_monthly_avg to sanity-check whether a year's budgeted total looks right, and to factor upcoming recurring costs into repayment/savings capacity even if the current year hasn't budgeted for them yet.
workbench holds ephemeral scenario snapshots (what-if plans the user built, not real transactions) with total_income/total_must/total_want/total_save/leftover already computed — treat these as the user's own targets or plans, useful for comparing against what's actually happening in recent_cycles (e.g. flag a plan that's structurally unaffordable, i.e. a strongly negative leftover, or note if actual spending has drifted far from a stated plan).
subscriptions are active recurring discretionary costs (e.g. streaming, software) the user deliberately funds from a distribution rather than the monthly expense template — when a subscription's linked_distribution is set, compare that distribution's total linked subscriptions against the distribution's own budgeted value (from expense_template.distributions) and flag it as a risk if the subscriptions exceed it.
If dossier.user_notes is present, it's free-text context the user wrote themselves — give it real weight: use it to explain away a risk or anomaly it addresses (don't flag something the user has already accounted for), and factor in any goals, constraints, or plans it mentions.
Be specific — reference actual account names, amounts, and months from the data. Use plain text inside every field: no markdown, no bullet characters.

The dossier data follows:
`;

const CHAT_SYSTEM_INTRO = `You are a personal-finance advisor inside the "boodget" capital-tracking app, chatting with the owner of the financial dossier below.
Answer questions about this dossier concretely, referencing actual numbers, account names, and months from the data. All amounts are in the dossier's currency.
The dossier may include loans (draft studies or active, ongoing loans) — draw on their monthly payments, interest rates, budget coverage, and total interest figures when relevant; treat draft loans as hypothetical studies, not commitments.
annual_expense_template is the recurring annual-cost baseline annual_expense_years is instantiated from; workbench holds ephemeral what-if planning snapshots (not real transactions) with Must/Want/Save totals already computed — draw on both when relevant, treating workbench figures as the user's own targets/plans rather than actuals.
subscriptions are active recurring discretionary costs funded from a distribution rather than the monthly expense template — when relevant, compare a distribution's linked subscriptions total against that distribution's budgeted value.
If dossier.user_notes is present, it's free-text context the user wrote themselves — give it real weight and factor it into your answers.
Be concise. Answer in plain text only — no markdown, no headers, no bullet characters. If a question cannot be answered from the data, say so briefly.

The dossier data follows:
`;

// Standalone prompt meant to be copied/downloaded and pasted directly into claude.ai chat (or any
// Claude client billed by subscription rather than API usage). Unlike ANALYSIS_SYSTEM_INTRO, this
// is addressed to Claude in the second person as a one-shot user message (not an API `system`
// block), asks for markdown (claude.ai renders it, unlike this app's own plain-text chat panel),
// and explicitly invites the user to keep chatting afterwards using the pasted data as context.
const EXPORT_PROMPT_INTRO = `You are a personal-finance advisor. I'm pasting a JSON snapshot of my financial dossier from an app called "boodget" — please analyse it.
All monetary amounts are in the currency noted in the data. Reply in markdown, formatted exactly like this:

**Financial health score:** X/100 — [one-line label: critical / poor / fair / good / excellent]

**Summary:** 2-4 sentences on my overall financial situation.

**Highlights:**
- **Title** — specific detail referencing actual numbers, accounts, or months.
(3-6 notable strengths)

**Improvements:**
- **Title** — specific, actionable detail.
(2-6 concrete suggestions)

**Risks:**
- **Title** — specific detail.
(0-4 risks or warning signs — omit this whole section if there are none)

The dossier may include loans (draft studies or active, ongoing loans). For active loans, factor their monthly_payment into repayment capacity, note whether they're covered by a linked budgeted expense (underbudgeted loans are a risk worth flagging), and weigh total interest/salary_pct where relevant. If the dossier has both a reference_salary and a loans_max_salary_pct set, compare the combined active-loan payments against that self-imposed ceiling and flag it as a risk if exceeded. Draft loans are hypothetical studies, not commitments — treat them as context, not liabilities.
annual_expense_template is the recurring baseline (insurance, car tax, etc.) that annual_expense_years is instantiated from each calendar year — use total_monthly_avg to sanity-check a year's budgeted total, and factor upcoming recurring costs into repayment/savings capacity even if not yet budgeted for. workbench holds ephemeral scenario snapshots (what-if plans I built, not real transactions) with total_income/total_must/total_want/total_save/leftover already computed — treat these as my own targets or plans, useful for comparing against what's actually happening in recent_cycles.
subscriptions are active recurring discretionary costs I fund from a distribution rather than the monthly expense template — when a subscription's linked_distribution is set, compare that distribution's total linked subscriptions against the distribution's own budgeted value and flag it if the subscriptions exceed it.
If dossier.user_notes is present, it's context I wrote myself — give it real weight: use it to explain away a risk or anomaly it addresses, and factor in any goals, constraints, or plans it mentions.
Be specific — reference actual account names, amounts, and months from the data.

After giving me this analysis, keep answering any follow-up questions I ask about this dossier, using the same data below as context.

Here is the dossier data:

`;

function analysisResponse(row) {
  let parsed = null;
  try {
    parsed = JSON.parse(row.content);
  } catch (e) {
    parsed = null;
  }
  return {
    ...parsed,
    model: row.model,
    created_at: row.created_at,
    cost_usd: row.cost_usd,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
  };
}

// GET /ai-advisor/analysis — last persisted analysis
router.get('/ai-advisor/analysis', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveAiConfig(req.params.id);
  if (!config.enabled) return res.status(403).json({ error: 'AI Advisor is disabled for this dossier' });
  const row = db.prepare('SELECT * FROM ai_analyses WHERE dossier_id = ?').get(req.params.id);
  res.json({
    configured: !!config.apiKey,
    analysis: row ? analysisResponse(row) : null,
  });
});

// GET /ai-advisor/export-prompt — a self-contained prompt for pasting into claude.ai chat
// (or any subscription-billed Claude client), so the user can run the same analysis without
// incurring API costs. Does not call the Claude API and does not require an apiKey.
router.get('/ai-advisor/export-prompt', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveAiConfig(req.params.id);
  if (!config.enabled) return res.status(403).json({ error: 'AI Advisor is disabled for this dossier' });
  const context = buildDossierContext(req.params.id);
  res.json({ prompt: EXPORT_PROMPT_INTRO + context });
});

// POST /ai-advisor/analysis — run a new analysis and persist it
router.post('/ai-advisor/analysis', async (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveAiConfig(req.params.id);
  if (!config.enabled) return res.status(403).json({ error: 'AI Advisor is disabled for this dossier' });
  const model = config.model;

  try {
    const context = buildDossierContext(req.params.id);
    const result = await callClaude({
      model,
      system: ANALYSIS_SYSTEM_INTRO + context,
      messages: [{ role: 'user', content: 'Analyse this financial dossier and return the structured assessment.' }],
      maxTokens: 8192,
      outputFormat: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
      apiKey: config.apiKey,
    });

    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (e) {
      return res.status(502).json({ error: 'The model returned an unexpected response. Please try again.' });
    }

    const costUsd = computeCostUsd(model, result.usage);
    db.prepare(
      `INSERT INTO ai_analyses (id, dossier_id, model, content, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dossier_id) DO UPDATE SET
         model = excluded.model,
         content = excluded.content,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cache_creation_input_tokens = excluded.cache_creation_input_tokens,
         cache_read_input_tokens = excluded.cache_read_input_tokens,
         cost_usd = excluded.cost_usd,
         created_at = datetime('now')`
    ).run(
      uuidv4(),
      req.params.id,
      model,
      JSON.stringify(parsed),
      result.usage.input_tokens ?? null,
      result.usage.output_tokens ?? null,
      result.usage.cache_creation_input_tokens ?? null,
      result.usage.cache_read_input_tokens ?? null,
      costUsd
    );

    console.log(
      `[ai-advisor] Analysis run for dossier ${req.params.id} by user ${req.user.username} — model=${model} in=${result.usage.input_tokens} out=${result.usage.output_tokens} cost=$${costUsd?.toFixed(4)}`
    );

    const row = db.prepare('SELECT * FROM ai_analyses WHERE dossier_id = ?').get(req.params.id);
    res.json({ configured: true, analysis: analysisResponse(row) });
  } catch (err) {
    console.error(`[ai-advisor] Analysis failed for dossier ${req.params.id} — ${err.message}`);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /ai-advisor/chat — one buffered chat turn with the dossier as context
router.post('/ai-advisor/chat', async (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveAiConfig(req.params.id);
  if (!config.enabled) return res.status(403).json({ error: 'AI Advisor is disabled for this dossier' });
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  if (messages.length > 40) {
    return res.status(400).json({ error: 'Conversation too long — clear the chat to continue' });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
      return res.status(400).json({ error: 'Each message must have role user/assistant and non-empty string content' });
    }
    if (m.content.length > 8000) {
      return res.status(400).json({ error: 'Messages must be at most 8000 characters' });
    }
  }
  if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Conversation must start and end with a user message' });
  }

  const model = config.model;

  try {
    const context = buildDossierContext(req.params.id);
    const result = await callClaude({
      model,
      system: CHAT_SYSTEM_INTRO + context,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      maxTokens: 2048,
      apiKey: config.apiKey,
    });

    const costUsd = computeCostUsd(model, result.usage);
    console.log(
      `[ai-advisor] Chat turn for dossier ${req.params.id} by user ${req.user.username} — model=${model} in=${result.usage.input_tokens} out=${result.usage.output_tokens} cost=$${costUsd?.toFixed(4)}`
    );

    res.json({
      reply: result.text,
      model,
      cost_usd: costUsd,
      input_tokens: result.usage.input_tokens ?? null,
      output_tokens: result.usage.output_tokens ?? null,
    });
  } catch (err) {
    console.error(`[ai-advisor] Chat failed for dossier ${req.params.id} — ${err.message}`);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
