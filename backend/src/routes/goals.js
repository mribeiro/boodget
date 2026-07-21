const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// Return current year-month as "YYYY-MM"
function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Count months from fromYM to toYM (positive if toYM is in the future)
function monthsDiff(fromYM, toYM) {
  const [fy, fm] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function computeGoalValues(goal, dossierId) {
  const recentMonth = db
    .prepare(
      'SELECT id FROM months WHERE dossier_id = ? AND filled = 1 ORDER BY year DESC, month DESC LIMIT 1'
    )
    .get(dossierId);

  // Archived accounts are expected to hold no further funds going forward, so they're
  // excluded from progress — they still show up in goal_accounts until manually unlinked.
  const archivedLinkedAccounts = db
    .prepare(
      `SELECT a.id, a.name, a.group_name FROM goal_accounts ga
       JOIN accounts a ON a.id = ga.account_id
       WHERE ga.goal_id = ? AND a.archived = 1`
    )
    .all(goal.id);

  let currentAccumulatedValue = 0;
  if (recentMonth) {
    const accountRows = db
      .prepare(
        `SELECT ga.account_id FROM goal_accounts ga
         JOIN accounts a ON a.id = ga.account_id
         WHERE ga.goal_id = ? AND a.archived = 0`
      )
      .all(goal.id);
    if (accountRows.length > 0) {
      const ids = accountRows.map((r) => r.account_id);
      const ph = ids.map(() => '?').join(',');
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(value), 0) as total FROM month_entries WHERE month_id = ? AND account_id IN (${ph})`
        )
        .get(recentMonth.id, ...ids);
      currentAccumulatedValue = row.total || 0;
    }
  }

  const extraValue = goal.extra_value || 0;
  // Extra value is already included in the account balance — not added again to progress
  const totalCurrentProgress = currentAccumulatedValue;
  // Floored at 0 — once the target is reached, nothing is "remaining" even if progress overshoots it
  const remainingAmount = Math.max(0, goal.target_value - totalCurrentProgress);

  const nowYM = currentYearMonth();
  const monthsRemaining = monthsDiff(nowYM, goal.target_date);

  // Expected monthly contribution
  let expectedMonthlyContribution = 0;
  if (goal.contribution_mode === 'via_distributions') {
    const distRows = db
      .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
      .all(goal.id);
    if (distRows.length > 0) {
      const ids = distRows.map((r) => r.distribution_template_item_id);
      const ph = ids.map(() => '?').join(',');
      const row = db
        .prepare(`SELECT COALESCE(SUM(value), 0) as total FROM expense_template_items WHERE id IN (${ph})`)
        .get(...ids);
      expectedMonthlyContribution = row.total || 0;
    }
  } else if (goal.contribution_mode === 'manual') {
    expectedMonthlyContribution = goal.manual_monthly_value || 0;
  }

  // Monthly value needed:
  // - "reduce_monthly_amount": subtract extra_value from remaining before dividing
  // - "anticipate_end_date": extra only shifts the completion date, not the monthly amount
  // - default (no extra or ad_hoc): remaining / months
  let monthlyValueNeeded = 0;
  if (monthsRemaining > 0) {
    if (goal.extra_value_impact_mode === 'reduce_monthly_amount' && extraValue > 0) {
      monthlyValueNeeded = Math.max(0, (remainingAmount - extraValue) / monthsRemaining);
    } else {
      monthlyValueNeeded = remainingAmount / monthsRemaining;
    }
  }

  // Anticipated completion date: shown whenever the goal is on pace to finish before
  // the target date — either because the budgeted contribution alone outpaces the
  // monthly amount needed, or (in "Anticipate End Date" mode) because an extra value
  // accelerates it further. months_needed = (remaining - extra) / expected, where
  // extra is only subtracted in "Anticipate End Date" mode; date = today + months_needed.
  let anticipatedCompletionDate = null;
  if (expectedMonthlyContribution > 0 && remainingAmount > 0) {
    const effectiveExtra = goal.extra_value_impact_mode === 'anticipate_end_date' ? extraValue : 0;
    const monthsNeeded = Math.max(0, Math.ceil((remainingAmount - effectiveExtra) / expectedMonthlyContribution));
    if (monthsNeeded < monthsRemaining) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth() + monthsNeeded, 1);
      anticipatedCompletionDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  // Feasibility (not applicable for ad_hoc)
  let feasible = null;
  if (goal.contribution_mode !== 'ad_hoc') {
    feasible =
      expectedMonthlyContribution * Math.max(0, monthsRemaining) + totalCurrentProgress >=
      goal.target_value;
  }

  // State
  let state = 'active';
  if (totalCurrentProgress >= goal.target_value) {
    state = 'completed';
  } else if (goal.target_date <= nowYM && totalCurrentProgress < goal.target_value) {
    state = 'failed';
  }

  return {
    current_accumulated_value: currentAccumulatedValue,
    total_current_progress: totalCurrentProgress,
    remaining_amount: remainingAmount,
    months_remaining: monthsRemaining,
    monthly_value_needed: monthlyValueNeeded,
    expected_monthly_contribution: expectedMonthlyContribution,
    anticipated_completion_date: anticipatedCompletionDate,
    feasible,
    state,
    archived_linked_accounts: archivedLinkedAccounts,
  };
}

function buildChartData(goal, dossierId, currentAccumulatedValue) {
  if (goal.contribution_mode === 'ad_hoc') return null;

  // All of the dossier's cycles — not gated by the goal's creation date, since the
  // distributions being tracked are dossier-wide and may predate the goal itself.
  const cycles = db
    .prepare(
      `SELECT id, year, month FROM expense_cycles WHERE dossier_id = ?
       ORDER BY year ASC, month ASC`
    )
    .all(dossierId);

  // Fetch historical contributions (sorted)
  const historicalRows = db
    .prepare(
      'SELECT year, month, amount FROM goal_historical_contributions WHERE goal_id = ? ORDER BY year ASC, month ASC'
    )
    .all(goal.id);

  let expectedMonthlyContribution = 0;
  if (goal.contribution_mode === 'via_distributions') {
    const distRows = db
      .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
      .all(goal.id);
    if (distRows.length > 0) {
      const ids = distRows.map((r) => r.distribution_template_item_id);
      const ph = ids.map(() => '?').join(',');
      const row = db
        .prepare(`SELECT COALESCE(SUM(value), 0) as total FROM expense_template_items WHERE id IN (${ph})`)
        .get(...ids);
      expectedMonthlyContribution = row.total || 0;
    }
  } else if (goal.contribution_mode === 'manual') {
    expectedMonthlyContribution = goal.manual_monthly_value || 0;
  }

  // For "via_distributions": get template item ids linked to this goal
  let distTemplateIds = [];
  if (goal.contribution_mode === 'via_distributions') {
    distTemplateIds = db
      .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
      .all(goal.id)
      .map((r) => r.distribution_template_item_id);
  }

  const chartData = [];
  let expectedCumulative = 0;
  let realCumulative = 0;

  // Prepend historical contributions (months before the tracked cycle range)
  const cycleYMs = new Set(cycles.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`));
  for (const h of historicalRows) {
    const hYM = `${h.year}-${String(h.month).padStart(2, '0')}`;
    if (cycleYMs.has(hYM)) continue; // cycle data takes precedence for overlapping months
    realCumulative += h.amount;
    chartData.push({
      cycle_id: null,
      year: h.year,
      month: h.month,
      expected_cumulative: null,
      real_cumulative: realCumulative,
      real_contribution: h.amount,
      is_historical: true,
    });
  }
  // Sort historical points before cycle points (they should already be ordered, but be safe)
  chartData.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  for (const cycle of cycles) {
    expectedCumulative += expectedMonthlyContribution;

    let realContribution = 0;
    if (goal.contribution_mode === 'via_distributions' && distTemplateIds.length > 0) {
      const ph = distTemplateIds.map(() => '?').join(',');
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(ci.value), 0) as total
           FROM cycle_items ci
           WHERE ci.cycle_id = ?
             AND ci.section = 'distribution'
             AND ci.done = 1
             AND (
               ci.template_item_id IN (${ph})
               OR (ci.template_item_id IS NULL AND ci.name IN (
                     SELECT name FROM expense_template_items WHERE id IN (${ph})
                   ))
             )`
        )
        .get(cycle.id, ...distTemplateIds, ...distTemplateIds);
      realContribution = row.total || 0;
    } else if (goal.contribution_mode === 'manual') {
      const contrib = db
        .prepare(
          'SELECT real_contribution FROM goal_cycle_contributions WHERE goal_id = ? AND cycle_id = ?'
        )
        .get(goal.id, cycle.id);
      realContribution = contrib ? contrib.real_contribution : 0;
    }

    realCumulative += realContribution;

    chartData.push({
      cycle_id: cycle.id,
      year: cycle.year,
      month: cycle.month,
      expected_cumulative: expectedCumulative,
      real_cumulative: realCumulative,
      real_contribution: realContribution,
    });
  }

  // Anchor Real/Expected to today's true balance: shift the whole series by a constant
  // so the most recent point lands exactly on current_accumulated_value, guaranteeing a
  // seamless join into the Projected line below (which starts from that same value).
  // Older points become an approximation, since real accounts also earn interest / receive
  // deposits the tracked "done" distributions don't capture.
  const lastRealPoint = [...chartData].reverse().find((p) => p.real_cumulative != null);
  if (lastRealPoint) {
    const offset = (currentAccumulatedValue || 0) - lastRealPoint.real_cumulative;
    if (offset !== 0) {
      for (const point of chartData) {
        if (point.real_cumulative != null) point.real_cumulative += offset;
        if (point.expected_cumulative != null) point.expected_cumulative += offset;
      }
    }
  }

  // Projected trend line: from now to target_date, based on current accumulated
  // value and the expected monthly contribution. Requires accounts to be linked
  // (so a current value is known) and a target_date in the future.
  const hasAccounts = !!db.prepare('SELECT 1 FROM goal_accounts WHERE goal_id = ?').get(goal.id);
  const nowYM = currentYearMonth();
  const monthsRemaining = monthsDiff(nowYM, goal.target_date);
  if (hasAccounts && monthsRemaining > 0) {
    let projectedCumulative = currentAccumulatedValue || 0;

    if (chartData.length > 0) {
      chartData[chartData.length - 1].projected_cumulative = projectedCumulative;
    } else {
      const [ny, nm] = nowYM.split('-').map(Number);
      chartData.push({
        cycle_id: null,
        year: ny,
        month: nm,
        expected_cumulative: null,
        real_cumulative: null,
        real_contribution: null,
        projected_cumulative: projectedCumulative,
        is_projected: true,
      });
    }

    const [ny, nm] = nowYM.split('-').map(Number);
    for (let i = 1; i <= monthsRemaining; i++) {
      projectedCumulative += expectedMonthlyContribution;
      const d = new Date(ny, nm - 1 + i, 1);
      chartData.push({
        cycle_id: null,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        expected_cumulative: null,
        real_cumulative: null,
        real_contribution: null,
        projected_cumulative: projectedCumulative,
        is_projected: true,
      });
    }
  }

  return chartData;
}

// GET /goals
router.get('/goals', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const goals = db
    .prepare('SELECT * FROM goals WHERE dossier_id = ? ORDER BY created_at ASC')
    .all(req.params.id);

  const result = goals.map((goal) => {
    const computed = computeGoalValues(goal, req.params.id);
    const accounts = db
      .prepare('SELECT account_id FROM goal_accounts WHERE goal_id = ?')
      .all(goal.id)
      .map((r) => r.account_id);
    const distributions = db
      .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
      .all(goal.id)
      .map((r) => r.distribution_template_item_id);
    return { ...goal, ...computed, account_ids: accounts, distribution_template_ids: distributions };
  });

  res.json(result);
});

// POST /goals
router.post('/goals', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const {
    name,
    target_value,
    target_date,
    extra_value,
    extra_value_impact_mode,
    contribution_mode,
    manual_monthly_value,
    account_ids,
    distribution_template_ids,
  } = req.body;

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (target_value == null || isNaN(Number(target_value)) || Number(target_value) <= 0) {
    return res.status(400).json({ error: 'target_value must be a positive number' });
  }
  if (!target_date || !/^\d{4}-\d{2}$/.test(target_date)) {
    return res.status(400).json({ error: 'target_date must be in YYYY-MM format' });
  }
  if (!contribution_mode || !['via_distributions', 'manual', 'ad_hoc'].includes(contribution_mode)) {
    return res.status(400).json({ error: 'contribution_mode must be via_distributions, manual, or ad_hoc' });
  }
  if (
    extra_value != null &&
    (!extra_value_impact_mode ||
      !['reduce_monthly_amount', 'anticipate_end_date'].includes(extra_value_impact_mode))
  ) {
    return res.status(400).json({ error: 'extra_value_impact_mode is required when extra_value is set' });
  }
  if (contribution_mode === 'manual' && (manual_monthly_value == null || isNaN(Number(manual_monthly_value)))) {
    return res.status(400).json({ error: 'manual_monthly_value is required for manual contribution mode' });
  }

  const id = uuidv4();
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO goals (id, dossier_id, name, target_value, target_date, extra_value, extra_value_impact_mode, contribution_mode, manual_monthly_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.params.id,
      String(name).trim(),
      Number(target_value),
      target_date,
      extra_value != null ? Number(extra_value) : null,
      extra_value_impact_mode || null,
      contribution_mode,
      contribution_mode === 'manual' ? Number(manual_monthly_value) : null
    );

    if (Array.isArray(account_ids)) {
      const insertAcc = db.prepare('INSERT OR IGNORE INTO goal_accounts (goal_id, account_id) VALUES (?, ?)');
      for (const accountId of account_ids) {
        insertAcc.run(id, accountId);
      }
    }

    if (contribution_mode === 'via_distributions' && Array.isArray(distribution_template_ids)) {
      const insertDist = db.prepare(
        'INSERT OR IGNORE INTO goal_distributions (goal_id, distribution_template_item_id) VALUES (?, ?)'
      );
      for (const distId of distribution_template_ids) {
        insertDist.run(id, distId);
      }
    }
  });

  create();

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  const computed = computeGoalValues(goal, req.params.id);
  const accounts = db
    .prepare('SELECT account_id FROM goal_accounts WHERE goal_id = ?')
    .all(id)
    .map((r) => r.account_id);
  const distributions = db
    .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
    .all(id)
    .map((r) => r.distribution_template_item_id);

  console.log(`[goals] Created goal "${String(name).trim()}" (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(201).json({ ...goal, ...computed, account_ids: accounts, distribution_template_ids: distributions });
});

// GET /goals/:goalId
router.get('/goals/:goalId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const goal = db
    .prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?')
    .get(req.params.goalId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const computed = computeGoalValues(goal, req.params.id);
  const accounts = db
    .prepare('SELECT account_id FROM goal_accounts WHERE goal_id = ?')
    .all(goal.id)
    .map((r) => r.account_id);
  const distributions = db
    .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
    .all(goal.id)
    .map((r) => r.distribution_template_item_id);
  const historicalContributions = db
    .prepare('SELECT year, month, amount FROM goal_historical_contributions WHERE goal_id = ? ORDER BY year, month')
    .all(goal.id);
  const chartData = buildChartData(goal, req.params.id, computed.current_accumulated_value);

  res.json({
    ...goal,
    ...computed,
    account_ids: accounts,
    distribution_template_ids: distributions,
    historical_contributions: historicalContributions,
    chart_data: chartData,
  });
});

// PUT /goals/:goalId
router.put('/goals/:goalId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const goal = db
    .prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?')
    .get(req.params.goalId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const {
    name,
    target_value,
    target_date,
    extra_value,
    extra_value_impact_mode,
    contribution_mode,
    manual_monthly_value,
    account_ids,
    distribution_template_ids,
  } = req.body;

  const newName = name !== undefined ? String(name).trim() : goal.name;
  if (!newName) return res.status(400).json({ error: 'name cannot be empty' });

  const newTargetValue =
    target_value !== undefined ? Number(target_value) : goal.target_value;
  if (isNaN(newTargetValue) || newTargetValue <= 0) {
    return res.status(400).json({ error: 'target_value must be a positive number' });
  }

  const newTargetDate = target_date !== undefined ? target_date : goal.target_date;
  if (!/^\d{4}-\d{2}$/.test(newTargetDate)) {
    return res.status(400).json({ error: 'target_date must be in YYYY-MM format' });
  }

  const newContributionMode =
    contribution_mode !== undefined ? contribution_mode : goal.contribution_mode;
  if (!['via_distributions', 'manual', 'ad_hoc'].includes(newContributionMode)) {
    return res.status(400).json({ error: 'contribution_mode must be via_distributions, manual, or ad_hoc' });
  }

  const newExtraValue = extra_value !== undefined ? (extra_value != null ? Number(extra_value) : null) : goal.extra_value;
  const newExtraImpactMode =
    extra_value_impact_mode !== undefined ? extra_value_impact_mode : goal.extra_value_impact_mode;

  if (
    newExtraValue != null &&
    (!newExtraImpactMode ||
      !['reduce_monthly_amount', 'anticipate_end_date'].includes(newExtraImpactMode))
  ) {
    return res.status(400).json({ error: 'extra_value_impact_mode is required when extra_value is set' });
  }

  const newManualMonthlyValue =
    manual_monthly_value !== undefined
      ? manual_monthly_value != null
        ? Number(manual_monthly_value)
        : null
      : goal.manual_monthly_value;

  if (newContributionMode === 'manual' && (newManualMonthlyValue == null || isNaN(newManualMonthlyValue))) {
    return res.status(400).json({ error: 'manual_monthly_value is required for manual contribution mode' });
  }

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE goals SET name = ?, target_value = ?, target_date = ?, extra_value = ?,
       extra_value_impact_mode = ?, contribution_mode = ?, manual_monthly_value = ?
       WHERE id = ?`
    ).run(
      newName,
      newTargetValue,
      newTargetDate,
      newExtraValue,
      newContributionMode === 'ad_hoc' ? null : newExtraImpactMode,
      newContributionMode,
      newContributionMode === 'manual' ? newManualMonthlyValue : null,
      goal.id
    );

    if (Array.isArray(account_ids)) {
      db.prepare('DELETE FROM goal_accounts WHERE goal_id = ?').run(goal.id);
      const insertAcc = db.prepare('INSERT OR IGNORE INTO goal_accounts (goal_id, account_id) VALUES (?, ?)');
      for (const accountId of account_ids) {
        insertAcc.run(goal.id, accountId);
      }
    }

    if (Array.isArray(distribution_template_ids)) {
      db.prepare('DELETE FROM goal_distributions WHERE goal_id = ?').run(goal.id);
      if (newContributionMode === 'via_distributions') {
        const insertDist = db.prepare(
          'INSERT OR IGNORE INTO goal_distributions (goal_id, distribution_template_item_id) VALUES (?, ?)'
        );
        for (const distId of distribution_template_ids) {
          insertDist.run(goal.id, distId);
        }
      }
    }
  });

  update();

  const updated = db.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id);
  const computed = computeGoalValues(updated, req.params.id);
  const accounts = db
    .prepare('SELECT account_id FROM goal_accounts WHERE goal_id = ?')
    .all(goal.id)
    .map((r) => r.account_id);
  const distributions = db
    .prepare('SELECT distribution_template_item_id FROM goal_distributions WHERE goal_id = ?')
    .all(goal.id)
    .map((r) => r.distribution_template_item_id);
  const chartData = buildChartData(updated, req.params.id, computed.current_accumulated_value);

  res.json({
    ...updated,
    ...computed,
    account_ids: accounts,
    distribution_template_ids: distributions,
    chart_data: chartData,
  });
});

// DELETE /goals/:goalId
router.delete('/goals/:goalId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const goal = db
    .prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?')
    .get(req.params.goalId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  db.prepare('DELETE FROM goals WHERE id = ?').run(goal.id);
  console.log(`[goals] Deleted goal "${goal.name}" (${goal.id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

// PUT /goals/:goalId/cycle-contributions/:cycleId  (manual mode only)
router.put('/goals/:goalId/cycle-contributions/:cycleId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const goal = db
    .prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?')
    .get(req.params.goalId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  if (goal.contribution_mode !== 'manual') {
    return res.status(400).json({ error: 'Cycle contributions are only for manual mode goals' });
  }
  const cycle = db
    .prepare('SELECT id FROM expense_cycles WHERE id = ? AND dossier_id = ?')
    .get(req.params.cycleId, req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

  const { real_contribution } = req.body;
  if (real_contribution == null || isNaN(Number(real_contribution))) {
    return res.status(400).json({ error: 'real_contribution is required' });
  }

  db.prepare(
    `INSERT INTO goal_cycle_contributions (goal_id, cycle_id, real_contribution)
     VALUES (?, ?, ?)
     ON CONFLICT(goal_id, cycle_id) DO UPDATE SET real_contribution = excluded.real_contribution`
  ).run(goal.id, cycle.id, Number(real_contribution));

  res.json({ goal_id: goal.id, cycle_id: cycle.id, real_contribution: Number(real_contribution) });
});

// POST /goals/:goalId/historical-contributions/bulk-replace
router.post('/goals/:goalId/historical-contributions/bulk-replace', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const goal = db
    .prepare('SELECT * FROM goals WHERE id = ? AND dossier_id = ?')
    .get(req.params.goalId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  for (const item of items) {
    const y = Number(item.year);
    const m = Number(item.month);
    const a = Number(item.amount);
    if (!Number.isInteger(y) || y < 1900 || y > 2200) return res.status(400).json({ error: 'Each item must have a valid year' });
    if (!Number.isInteger(m) || m < 1 || m > 12) return res.status(400).json({ error: 'Each item must have a valid month (1–12)' });
    if (isNaN(a)) return res.status(400).json({ error: 'Each item must have a numeric amount' });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM goal_historical_contributions WHERE goal_id = ?').run(goal.id);
    const insert = db.prepare(
      'INSERT INTO goal_historical_contributions (goal_id, year, month, amount) VALUES (?, ?, ?, ?)'
    );
    for (const item of items) {
      insert.run(goal.id, Number(item.year), Number(item.month), Number(item.amount));
    }
  })();

  const saved = db
    .prepare('SELECT year, month, amount FROM goal_historical_contributions WHERE goal_id = ? ORDER BY year, month')
    .all(goal.id);
  res.json(saved);
});

module.exports = router;
// Shared with the AI Advisor context builder
module.exports.computeGoalValues = computeGoalValues;
