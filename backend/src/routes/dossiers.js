const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { computeCycleStartDate, computeTheoreticalCycleEndDate, toIsoDate } = require('../utils/cycleDates');

const accountsRouter = require('./accounts');
const monthsRouter = require('./months');
const expensesRouter = require('./expenses');
const goalsRouter = require('./goals');
const emergencyFundRouter = require('./emergency-fund');
const annualExpensesRouter = require('./annual-expenses');
const aiAdvisorRouter = require('./ai-advisor');
const { isAllowedAiModel, DEFAULT_AI_MODEL } = aiAdvisorRouter;
const loansRouter = require('./loans');
const subscriptionsRouter = require('./subscriptions');
const carsRouter = require('./cars');

// Anchor month for an active loan imported from a pre-v15 export (which carried no
// balance_as_of). Mirrors migration 042's backfill: the effective current period, unless
// that lands past the end date, in which case there's no plan to anchor.
function defaultLoanAnchor(endDate, dayOfPayment) {
  if (!endDate) return null;
  const { year, month } = loansRouter.effectiveCurrentPeriod(dayOfPayment ?? null);
  const [endYear, endMonth] = String(endDate).split('-').map(Number);
  if ((endYear * 12 + endMonth) - (year * 12 + month) + 1 < 1) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

router.use('/:id/accounts', accountsRouter);
router.use('/:id/months', monthsRouter);

// Allowed values of every column the import writes that has a CHECK constraint. A hand-edited
// file with anything else used to abort the whole import with a bare 500 from SQLite.
const IMPORT_ENUMS = [
  ['accounts', 'type', ['Risk Investment', 'Guaranteed Investment', 'Current Account']],
  ['accounts', 'money_category', ['idle', 'active', 'stocks'], { optional: true }],
  ['expense_template', 'section', ['expense', 'distribution']],
  ['expense_template', 'type', ['Fixed', 'Budget'], { optional: true }],
  ['expense_template', 'classification', ['must', 'want'], { optional: true }],
  ['annual_expense_template', 'classification', ['must', 'want'], { optional: true }],
  ['goals', 'contribution_mode', ['via_distributions', 'manual', 'ad_hoc']],
  ['goals', 'extra_value_impact_mode', ['reduce_monthly_amount', 'anticipate_end_date'], { optional: true }],
  ['loans', 'status', ['draft', 'active'], { optional: true }],
  ['subscriptions', 'status', ['active', 'cancelled'], { optional: true }],
  ['cars', 'fuel_type', ['electric', 'hybrid', 'gas']],
];

// Returns a message naming the first invalid entry of an export file, or null if it's valid.
function validateImportData(data) {
  const label = (entry, idx) => (entry && entry.name ? `"${entry.name}"` : `#${idx + 1}`);
  for (const [section, field, allowed, { optional } = {}] of IMPORT_ENUMS) {
    const list = data[section];
    if (list != null && !Array.isArray(list)) return `${section} must be an array`;
    for (const [idx, entry] of (list || []).entries()) {
      const value = entry?.[field];
      if (value == null && optional) continue;
      if (!allowed.includes(value)) {
        return `${section} ${label(entry, idx)}: invalid ${field} ${JSON.stringify(value ?? null)} (expected one of ${allowed.join(', ')})`;
      }
    }
  }
  for (const [ci, cycle] of (data.cycles || []).entries()) {
    for (const [ii, item] of (cycle.items || []).entries()) {
      if (!['expense', 'distribution'].includes(item?.section)) {
        return `cycles #${ci + 1} item ${label(item, ii)}: invalid section ${JSON.stringify(item?.section ?? null)}`;
      }
      if (item.type != null && !['Fixed', 'Budget'].includes(item.type)) {
        return `cycles #${ci + 1} item ${label(item, ii)}: invalid type ${JSON.stringify(item.type)}`;
      }
    }
  }
  for (const car of data.cars || []) {
    for (const [ei, e] of (car.adhoc_expenses || []).entries()) {
      if (e.recurrence != null && !['monthly', 'one_off'].includes(e.recurrence)) {
        return `cars "${car.name}" ad-hoc expense ${label(e, ei)}: invalid recurrence ${JSON.stringify(e.recurrence)}`;
      }
      if (e.status != null && !['active', 'cancelled'].includes(e.status)) {
        return `cars "${car.name}" ad-hoc expense ${label(e, ei)}: invalid status ${JSON.stringify(e.status)}`;
      }
    }
  }
  return null;
}

// Name → id map that keeps the *first* entry for a duplicated name (a later one used to
// silently win), used only as the fallback when an export carries no id to re-link by.
function firstByName(map, name, id) {
  if (name != null && !(name in map)) map[name] = id;
}

// Normalises an exported item's installments to one entry per installment_number with a
// `payments[]` array. Version 18+ exports already have that shape; older ones carry a single
// `payment` per entry and, when an installment had payments in two cycles, listed it twice —
// those duplicates are folded back into one installment here instead of being imported twice.
function mergeExportedInstallments(installments) {
  const byNumber = new Map();
  for (const inst of installments || []) {
    const payments = Array.isArray(inst.payments) ? inst.payments : inst.payment ? [inst.payment] : [];
    const existing = byNumber.get(inst.installment_number);
    if (existing) existing.payments.push(...payments);
    else byNumber.set(inst.installment_number, { ...inst, payments: [...payments] });
  }
  return [...byNumber.values()];
}

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return null;
  if (dossier.creator_id === userId) return { dossier, isCreator: true };
  const access = db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
  if (access) return { dossier, isCreator: false };
  return null;
}

// GET /api/dossiers
router.get('/', (req, res) => {
  const dossiers = db
    .prepare(
      `SELECT d.id, d.name, d.creator_id, d.currency, d.created_at,
        (d.creator_id = ?) as is_creator
      FROM dossiers d
      WHERE d.creator_id = ?
        OR EXISTS (
          SELECT 1 FROM dossier_access da WHERE da.dossier_id = d.id AND da.user_id = ?
        )
      ORDER BY d.created_at`
    )
    .all(req.user.id, req.user.id, req.user.id);
  res.json(dossiers);
});

// POST /api/dossiers/import
router.post('/import', (req, res) => {
  const data = req.body;
  if (!data || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(data.version)) return res.status(400).json({ error: 'Invalid export file' });
  if (!data.dossier?.name) return res.status(400).json({ error: 'Invalid export: missing dossier name' });
  const invalid = validateImportData(data);
  if (invalid) return res.status(400).json({ error: `Invalid export: ${invalid}` });

  const baseName = data.dossier.name.trim();
  let finalName = baseName;
  let suffix = 2;
  while (db.prepare('SELECT id FROM dossiers WHERE name = ? AND creator_id = ?').get(finalName, req.user.id)) {
    finalName = `${baseName} -${suffix}`;
    suffix++;
  }

  const dossierId = uuidv4();

  const doImport = db.transaction(() => {
    db.prepare(
      'INSERT INTO dossiers (id, name, creator_id, currency, cycle_start_day, cycle_start_weekend_adjustment, emergency_fund_months_multiplier, emergency_fund_cycles_to_average, paperless_url, paperless_date_field_id, paperless_amount_field_id, ai_enabled, ai_model, ai_user_context, reference_salary, loans_max_salary_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      dossierId, finalName, req.user.id, data.dossier.currency || 'EUR', data.dossier.cycle_start_day ?? 25,
      // Versions <= 12 predate this setting; 'none' is the correct historical default.
      data.dossier.cycle_start_weekend_adjustment ?? 'none',
      data.dossier.emergency_fund_months_multiplier ?? 6,
      data.dossier.emergency_fund_cycles_to_average ?? 6,
      data.dossier.paperless_url ?? null,
      data.dossier.paperless_date_field_id ?? null,
      data.dossier.paperless_amount_field_id ?? null,
      // Versions <= 9 have no ai_enabled/ai_model; default to enabled + the app's default model.
      // ai_api_key is a secret and is never exported/imported.
      (data.dossier.ai_enabled ?? true) ? 1 : 0,
      // A hand-edited or stale export can carry an ai_model outside the allowed families
      // (haiku/sonnet/opus); coerce it to the default rather than storing it as-is.
      isAllowedAiModel(data.dossier.ai_model) ? data.dossier.ai_model : DEFAULT_AI_MODEL,
      data.dossier.ai_user_context ?? null,
      data.dossier.reference_salary ?? null,
      data.dossier.loans_max_salary_pct ?? null
    );

    const accountIdMap = {};
    const insertAccount = db.prepare(
      'INSERT INTO accounts (id, dossier_id, group_name, name, type, money_category, can_receive_transfers, archived, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const a of (data.accounts || [])) {
      const newId = uuidv4();
      accountIdMap[a.id] = newId;
      const canReceiveTransfers = a.can_receive_transfers !== undefined ? (a.can_receive_transfers ? 1 : 0) : 1;
      // Versions <= 8 only have the legacy is_idle_money boolean; map it to the new 3-way category.
      const moneyCategory = a.money_category ?? (a.is_idle_money ? 'idle' : 'active');
      insertAccount.run(newId, dossierId, a.group_name, a.name, a.type, moneyCategory, canReceiveTransfers, a.archived ? 1 : 0, a.position ?? 0);
    }

    // References to accounts are re-linked by the exported account id (v18+). Older exports
    // only carry names, which aren't unique (only group + name is), so fall back to the first
    // account with that name.
    const accountNameToId = {};
    for (const a of (data.accounts || [])) firstByName(accountNameToId, a.name, accountIdMap[a.id]);
    const resolveTemplate = (oldId, section, name) =>
      (oldId != null && templateIdMap[oldId]) ||
      (name != null ? (section === 'expense' ? expenseTemplateNameToId : templateNameToId)[name] : null) ||
      null;
    const resolveAccount = (oldId, name) =>
      (oldId != null && accountIdMap[oldId]) || (name != null ? accountNameToId[name] : null) || null;

    // Cars (v16+) — imported before the expense/annual templates below, since their car_id
    // tags are re-linked by car name (same convention as account_name/linked_expense_name).
    const carNameToId = {};
    const insertCar = db.prepare(
      `INSERT INTO cars (id, dossier_id, name, license_plate, make, model, fuel_type, initial_mileage_km, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCarMonth = db.prepare(
      `INSERT INTO car_months (id, car_id, year, month, mileage_km, avg_l_per_100km, avg_kwh_per_100km, cost_per_l, cost_per_kwh, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // adhoc_expenses is version 17+; absent/empty on older exports.
    const insertCarAdhocExpense = db.prepare(
      `INSERT INTO car_adhoc_expenses (id, car_id, name, value, recurrence, status, year, month, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of (data.cars || [])) {
      const carId = uuidv4();
      carNameToId[c.name] = carId;
      insertCar.run(carId, dossierId, c.name, c.license_plate ?? null, c.make ?? null, c.model ?? null, c.fuel_type, c.initial_mileage_km ?? 0, c.created_at || null);
      for (const e of (c.adhoc_expenses || [])) {
        insertCarAdhocExpense.run(
          uuidv4(),
          carId,
          e.name,
          e.value ?? 0,
          e.recurrence ?? 'monthly',
          e.status ?? 'active',
          e.year ?? null,
          e.month ?? null,
          e.created_at || null
        );
      }
      for (const m of (c.months || [])) {
        insertCarMonth.run(
          uuidv4(),
          carId,
          m.year,
          m.month,
          m.mileage_km,
          m.avg_l_per_100km ?? null,
          m.avg_kwh_per_100km ?? null,
          m.cost_per_l ?? null,
          m.cost_per_kwh ?? null,
          m.notes ?? null
        );
      }
    }

    const insertMonth = db.prepare(
      'INSERT INTO months (id, dossier_id, year, month, filled, comment, filled_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertSnapshot = db.prepare('INSERT OR IGNORE INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)');
    const insertEntry = db.prepare('INSERT INTO month_entries (month_id, account_id, value, comment) VALUES (?, ?, ?, ?)');

    for (const m of (data.months || [])) {
      const monthId = uuidv4();
      insertMonth.run(monthId, dossierId, m.year, m.month, m.filled ? 1 : 0, m.comment || null, m.filled_at || null);
      // The month's account list is exported explicitly since v18 — an account can be part of
      // a month without an entry. Older exports only have entries, which imply membership.
      const snapshotIds = new Set([...(m.snapshot_account_ids || []), ...(m.entries || []).map((e) => e.account_id)]);
      for (const oldId of snapshotIds) {
        if (accountIdMap[oldId]) insertSnapshot.run(monthId, accountIdMap[oldId]);
      }
      for (const e of (m.entries || [])) {
        const newAccountId = accountIdMap[e.account_id];
        if (!newAccountId) continue;
        insertEntry.run(monthId, newAccountId, e.value ?? null, e.comment || null);
      }
    }

    const insertTemplateItem = db.prepare(
      'INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, position, classification, must_amount, want_amount, save_amount, paperless_tag_id, exclude_from_emergency_fund, account_id, car_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // Template items are re-linked by their exported id (v18+), falling back to (section, name)
    // — first match wins — for older exports.
    const templateNameToId = {};
    const expenseTemplateNameToId = {};
    const templateIdMap = {};
    for (const ti of (data.expense_template || [])) {
      const newId = uuidv4();
      if (ti.id != null) templateIdMap[ti.id] = newId;
      if (ti.section === 'distribution') firstByName(templateNameToId, ti.name, newId);
      if (ti.section === 'expense') firstByName(expenseTemplateNameToId, ti.name, newId);
      const accountId = resolveAccount(ti.account_id, ti.account_name);
      const carId = ti.car_name ? (carNameToId[ti.car_name] ?? null) : null;
      insertTemplateItem.run(newId, dossierId, ti.section, ti.name, ti.type ?? null, ti.value ?? 0, ti.day_of_payment ?? null, ti.position ?? 0, ti.classification ?? null, ti.must_amount ?? null, ti.want_amount ?? null, ti.save_amount ?? null, ti.paperless_tag_id ?? null, ti.exclude_from_emergency_fund ? 1 : 0, accountId, carId);
    }

    // income_template is version 14+; absent/empty on older exports.
    const insertIncomeTemplateItem = db.prepare(
      'INSERT INTO income_template_items (id, dossier_id, name, default_value, position) VALUES (?, ?, ?, ?, ?)'
    );
    const incomeTemplateNameToId = {};
    (data.income_template || []).forEach((iti, idx) => {
      const itiId = uuidv4();
      incomeTemplateNameToId[iti.name] = itiId;
      insertIncomeTemplateItem.run(itiId, dossierId, iti.name, iti.default_value ?? 0, iti.position ?? idx);
    });

    const insertAnnualTemplateItem = db.prepare(
      'INSERT INTO annual_expense_template_items (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position, num_installments, car_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertAnnualTemplateInstallment = db.prepare(
      'INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
    );
    const annualTemplateNameToId = {};
    for (const ti of (data.annual_expense_template || [])) {
      const tiId = uuidv4();
      annualTemplateNameToId[ti.name] = tiId;
      const numInst = ti.num_installments ?? 1;
      const carId = ti.car_name ? (carNameToId[ti.car_name] ?? null) : null;
      insertAnnualTemplateItem.run(tiId, dossierId, ti.name, ti.value ?? 0, ti.day_of_payment ?? null, ti.month_of_payment ?? null, ti.classification ?? null, ti.position ?? 0, numInst, carId);
      for (const inst of (ti.installments || [])) {
        insertAnnualTemplateInstallment.run(uuidv4(), tiId, inst.installment_number, inst.month, inst.day);
      }
    }

    const insertWorkbenchSnapshot = db.prepare(
      'INSERT INTO workbench_snapshots (id, dossier_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const s of (data.workbench_snapshots || [])) {
      insertWorkbenchSnapshot.run(uuidv4(), dossierId, s.name, typeof s.data === 'string' ? s.data : JSON.stringify(s.data), s.created_at || null, s.updated_at || null);
    }

    const insertCycle = db.prepare(
      'INSERT INTO expense_cycles (id, dossier_id, year, month, previous_balance, is_closed, final_real_balance, cycle_start_day, cycle_start_weekend_adjustment, actual_start_date, actual_end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertCycleItem = db.prepare(
      'INSERT INTO cycle_items (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, paid, spent, done, position, paperless_tag_id, exclude_from_emergency_fund, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertCycleIncomeItem = db.prepare(
      'INSERT INTO cycle_income_items (id, cycle_id, template_item_id, name, value, position) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const cycleYMToId = {};
    for (const c of (data.cycles || [])) {
      const cycleId = uuidv4();
      cycleYMToId[`${c.year}-${c.month}`] = cycleId;
      // cycle_start_day is per-cycle since v12; older exports only had the dossier-wide
      // setting, so fall back to that (the same value the cycle would have used pre-fix).
      const cycleStartDay = c.cycle_start_day ?? data.dossier.cycle_start_day ?? 25;
      // cycle_start_weekend_adjustment/actual_start_date/actual_end_date are per-cycle
      // since v13; older exports predate the feature, so recompute the unshifted
      // ('none') formula from the cycle's own (year, month, cycleStartDay) — the same
      // best-effort precedent already used for cycle_start_day above.
      const cycleWeekendAdjustment = c.cycle_start_weekend_adjustment ?? 'none';
      const actualStartDate = c.actual_start_date ?? toIsoDate(computeCycleStartDate(c.year, c.month, cycleStartDay, cycleWeekendAdjustment));
      const actualEndDate = c.actual_end_date ?? toIsoDate(computeTheoreticalCycleEndDate(c.year, c.month, cycleStartDay, cycleWeekendAdjustment));
      insertCycle.run(cycleId, dossierId, c.year, c.month, c.previous_balance ?? 0, c.is_closed ? 1 : 0, c.final_real_balance ?? null, cycleStartDay, cycleWeekendAdjustment, actualStartDate, actualEndDate);
      for (const ci of (c.items || [])) {
        const templateItemId = resolveTemplate(ci.template_item_id, ci.section, ci.name);
        const accountId = resolveAccount(ci.account_id, ci.account_name);
        insertCycleItem.run(uuidv4(), cycleId, templateItemId, ci.section, ci.name, ci.type ?? null, ci.value ?? 0, ci.day_of_payment ?? null, ci.paid ? 1 : 0, ci.spent ?? 0, ci.done ? 1 : 0, ci.position ?? 0, ci.paperless_tag_id ?? null, ci.exclude_from_emergency_fund ? 1 : 0, accountId);
      }
      // income_items is version 14+. Versions <= 13 only carried a flat c.salary — synthesize
      // a single ad-hoc "Salary" line from it so the historical total isn't lost on import.
      const incomeItems = c.income_items || [];
      if (incomeItems.length === 0 && c.salary != null) {
        insertCycleIncomeItem.run(uuidv4(), cycleId, null, 'Salary', c.salary, 0);
      } else {
        incomeItems.forEach((ii, idx) => {
          const templateItemId = incomeTemplateNameToId[ii.name] || null;
          insertCycleIncomeItem.run(uuidv4(), cycleId, templateItemId, ii.name, ii.value ?? 0, ii.position ?? idx);
        });
      }
    }

    const insertGoal = db.prepare(
      'INSERT INTO goals (id, dossier_id, name, target_value, target_date, extra_value, extra_value_impact_mode, contribution_mode, manual_monthly_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertGoalAccount = db.prepare('INSERT OR IGNORE INTO goal_accounts (goal_id, account_id) VALUES (?, ?)');
    const insertGoalDist = db.prepare('INSERT OR IGNORE INTO goal_distributions (goal_id, distribution_template_item_id) VALUES (?, ?)');
    const insertGoalCycleContrib = db.prepare(
      'INSERT INTO goal_cycle_contributions (goal_id, cycle_id, real_contribution) VALUES (?, ?, ?) ON CONFLICT(goal_id, cycle_id) DO UPDATE SET real_contribution = excluded.real_contribution'
    );
    const insertGoalHistorical = db.prepare(
      'INSERT INTO goal_historical_contributions (goal_id, year, month, amount) VALUES (?, ?, ?, ?)'
    );

    for (const g of (data.goals || [])) {
      const goalId = uuidv4();
      insertGoal.run(
        goalId, dossierId, g.name, g.target_value, g.target_date,
        g.extra_value ?? null, g.extra_value_impact_mode ?? null,
        g.contribution_mode, g.manual_monthly_value ?? null,
        g.created_at || null
      );
      (g.account_names || []).forEach((name, i) => {
        const accId = resolveAccount(g.account_ids?.[i], name);
        if (accId) insertGoalAccount.run(goalId, accId);
      });
      (g.distribution_names || []).forEach((name, i) => {
        const distId = resolveTemplate(g.distribution_ids?.[i], 'distribution', name);
        if (distId) insertGoalDist.run(goalId, distId);
      });
      for (const cc of (g.cycle_contributions || [])) {
        const cycleId = cycleYMToId[`${cc.year}-${cc.month}`];
        if (cycleId) insertGoalCycleContrib.run(goalId, cycleId, cc.real_contribution ?? 0);
      }
      for (const hc of (g.historical_contributions || [])) {
        insertGoalHistorical.run(goalId, hc.year, hc.month, hc.amount ?? 0);
      }
    }

    // Emergency fund accounts (re-linked by account name)
    const insertEFAccount = db.prepare(
      'INSERT OR IGNORE INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)'
    );
    (data.emergency_fund_accounts || []).forEach((name, i) => {
      const accId = resolveAccount(data.emergency_fund_account_ids?.[i], name);
      if (accId) insertEFAccount.run(dossierId, accId);
    });

    // Emergency fund extra values
    const insertEFExtra = db.prepare(
      'INSERT INTO emergency_fund_extra_values (id, dossier_id, name, value, position) VALUES (?, ?, ?, ?, ?)'
    );
    for (const ev of (data.emergency_fund_extra_values || [])) {
      insertEFExtra.run(uuidv4(), dossierId, ev.name, ev.value ?? 0, ev.position ?? 0);
    }

    // Annual expense years (v7+)
    if (data.annual_expense_years && data.annual_expense_years.length > 0) {
      const insertAnnualYear = db.prepare(
        'INSERT INTO annual_expense_years (id, dossier_id, year, carryover) VALUES (?, ?, ?, ?)'
      );
      const insertAnnualYearItem = db.prepare(
        'INSERT INTO annual_expense_year_items (id, year_id, name, budgeted_value, classification, num_installments, from_template, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      const insertAnnualYearInst = db.prepare(
        'INSERT INTO annual_expense_year_installments (id, year_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
      );
      const insertAnnualPayment = db.prepare(
        'INSERT OR IGNORE INTO annual_expense_payments (id, installment_id, cycle_id, real_value, paid) VALUES (?, ?, ?, ?, ?)'
      );

      for (const ay of data.annual_expense_years) {
        const yearId = uuidv4();
        insertAnnualYear.run(yearId, dossierId, ay.year, ay.carryover ?? 0);

        for (const item of (ay.items || [])) {
          const itemId = uuidv4();
          insertAnnualYearItem.run(itemId, yearId, item.name, item.budgeted_value ?? 0, item.classification ?? null, item.num_installments ?? 1, item.from_template ? 1 : 0, item.position ?? 0);

          for (const inst of mergeExportedInstallments(item.installments)) {
            const instId = uuidv4();
            insertAnnualYearInst.run(instId, itemId, inst.installment_number, inst.month, inst.day);

            const seenCycles = new Set();
            for (const payment of inst.payments) {
              const cycleId = cycleYMToId[`${payment.cycle_year}-${payment.cycle_month}`];
              if (cycleId && !seenCycles.has(cycleId)) {
                seenCycles.add(cycleId);
                insertAnnualPayment.run(uuidv4(), instId, cycleId, payment.real_value ?? 0, payment.paid ? 1 : 0);
              }
            }
          }
        }
      }
    }

    // Annual expense contributing accounts (re-linked by account name)
    const insertAEAccount = db.prepare('INSERT OR IGNORE INTO annual_expense_accounts (dossier_id, account_id) VALUES (?, ?)');
    (data.annual_expense_accounts || []).forEach((name, i) => {
      const accId = resolveAccount(data.annual_expense_account_ids?.[i], name);
      if (accId) insertAEAccount.run(dossierId, accId);
    });

    // Annual expense contributing distributions (re-linked by template item name)
    const insertAEDist = db.prepare('INSERT OR IGNORE INTO annual_expense_distributions (dossier_id, distribution_template_id) VALUES (?, ?)');
    (data.annual_expense_distributions || []).forEach((name, i) => {
      const distId = resolveTemplate(data.annual_expense_distribution_ids?.[i], 'distribution', name);
      if (distId) insertAEDist.run(dossierId, distId);
    });

    // Loans (v10+) — re-linked to the new Fixed expense template item by name, active only
    const insertLoan = db.prepare(
      `INSERT INTO loans (id, dossier_id, name, status, interest_rate, salary, principal, term_months, remaining_balance, end_date, day_of_payment, balance_as_of, expense_template_item_id, created_at, down_payment, taeg, opening_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of (data.loans || [])) {
      const linkedItemId = l.status === 'active' && (l.linked_expense_id || l.linked_expense_name)
        ? resolveTemplate(l.linked_expense_id, 'expense', l.linked_expense_name)
        : null;
      const isDraft = l.status !== 'active';
      // balance_as_of (v15+). Older exports carry an undated balance, which under the
      // pre-anchor rules meant "what's owed right now" — so anchor it at the effective
      // current period, exactly as migration 042 does for a pre-anchor database. An old
      // export and an old DB therefore land in the same state instead of diverging.
      const balanceAsOf = isDraft ? null : (l.balance_as_of ?? defaultLoanAnchor(l.end_date, l.day_of_payment));
      insertLoan.run(
        uuidv4(),
        dossierId,
        l.name,
        isDraft ? 'draft' : 'active',
        l.interest_rate ?? 0,
        l.salary ?? null,
        l.principal ?? null,
        l.term_months ?? null,
        l.remaining_balance ?? null,
        isDraft ? null : (l.end_date ?? null),
        isDraft ? null : (l.day_of_payment ?? null),
        balanceAsOf,
        linkedItemId,
        l.created_at || null,
        l.down_payment ?? null,
        l.taeg ?? null,
        l.opening_fee ?? null
      );
    }

    // Subscriptions (v11+) — re-linked to the new distribution template item by name
    const insertSubscription = db.prepare(
      `INSERT INTO subscriptions (id, dossier_id, name, monthly_cost, billing_day, status, distribution_template_item_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of (data.subscriptions || [])) {
      const distId = s.distribution_id || s.distribution_name ? resolveTemplate(s.distribution_id, 'distribution', s.distribution_name) : null;
      insertSubscription.run(
        uuidv4(),
        dossierId,
        s.name,
        s.monthly_cost,
        s.billing_day ?? null,
        s.status || 'active',
        distId,
        s.created_at || null
      );
    }
  });

  try {
    doImport();
  } catch (err) {
    // Validation above covers the known constraints; anything else is still the file's fault
    // (a missing required value, a wrong type), so say what failed instead of a bare 500.
    if (err && err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      console.log(`[dossiers] Import rejected for user ${req.user.username}: ${err.message}`);
      return res.status(400).json({ error: `Invalid export: ${err.message}` });
    }
    throw err;
  }
  console.log(`[dossiers] Imported dossier "${finalName}" (${dossierId}) for user ${req.user.username} (version ${data.version})`);
  res.status(201).json({ id: dossierId, name: finalName, creator_id: req.user.id, is_creator: 1, currency: data.dossier.currency || 'EUR' });
});

// POST /api/dossiers
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO dossiers (id, name, creator_id, ai_model) VALUES (?, ?, ?, ?)').run(
    id,
    name.trim(),
    req.user.id,
    DEFAULT_AI_MODEL
  );
  console.log(`[dossiers] Created dossier "${name.trim()}" (${id}) by user ${req.user.username}`);
  res.status(201).json({ id, name: name.trim(), creator_id: req.user.id, is_creator: 1, currency: 'EUR' });
});

// GET /api/dossiers/:id
router.get('/:id', (req, res) => {
  const access = canAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Dossier not found' });
  const dossier = db
    .prepare('SELECT *, (creator_id = ?) as is_creator FROM dossiers WHERE id = ?')
    .get(req.user.id, req.params.id);
  delete dossier.ai_api_key;
  res.json(dossier);
});

// GET /api/dossiers/:id/export
router.get('/:id/export', (req, res) => {
  const access = canAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Dossier not found' });

  const dossier = db.prepare('SELECT name, currency, cycle_start_day, cycle_start_weekend_adjustment, emergency_fund_months_multiplier, emergency_fund_cycles_to_average, paperless_url, paperless_date_field_id, paperless_amount_field_id, ai_enabled, ai_model, ai_user_context, reference_salary, loans_max_salary_pct FROM dossiers WHERE id = ?').get(req.params.id);
  const accounts = db
    .prepare('SELECT id, group_name, name, type, money_category, can_receive_transfers, archived, position FROM accounts WHERE dossier_id = ? ORDER BY position, group_name, name')
    .all(req.params.id);
  const months = db
    .prepare('SELECT id, year, month, filled, comment, filled_at FROM months WHERE dossier_id = ? ORDER BY year, month')
    .all(req.params.id);

  const entriesByMonth = {};
  const snapshotsByMonth = {};
  if (months.length > 0) {
    const monthPh = months.map(() => '?').join(',');
    for (const snap of db
      .prepare(`SELECT month_id, account_id FROM month_account_snapshot WHERE month_id IN (${monthPh})`)
      .all(...months.map((m) => m.id))) {
      (snapshotsByMonth[snap.month_id] ||= []).push(snap.account_id);
    }
    const ph = months.map(() => '?').join(',');
    const entries = db
      .prepare(`SELECT month_id, account_id, value, comment FROM month_entries WHERE month_id IN (${ph})`)
      .all(...months.map((m) => m.id));
    for (const e of entries) {
      if (!entriesByMonth[e.month_id]) entriesByMonth[e.month_id] = [];
      entriesByMonth[e.month_id].push({ account_id: e.account_id, value: e.value, comment: e.comment });
    }
  }

  const expenseTemplate = db
    .prepare(
      `SELECT eti.id, eti.section, eti.name, eti.type, eti.value, eti.day_of_payment, eti.position, eti.classification,
              eti.must_amount, eti.want_amount, eti.save_amount, eti.paperless_tag_id, eti.exclude_from_emergency_fund,
              eti.account_id, acc.name as account_name, car.name as car_name
       FROM expense_template_items eti
       LEFT JOIN accounts acc ON acc.id = eti.account_id
       LEFT JOIN cars car ON car.id = eti.car_id
       WHERE eti.dossier_id = ? ORDER BY eti.section, eti.position`
    )
    .all(req.params.id);

  const incomeTemplate = db
    .prepare('SELECT name, default_value, position FROM income_template_items WHERE dossier_id = ? ORDER BY position')
    .all(req.params.id);

  const annualExpenseTemplateRaw = db
    .prepare(
      `SELECT ti.id, ti.name, ti.value, ti.day_of_payment, ti.month_of_payment, ti.classification, ti.position,
              ti.num_installments, car.name as car_name
       FROM annual_expense_template_items ti
       LEFT JOIN cars car ON car.id = ti.car_id
       WHERE ti.dossier_id = ? ORDER BY ti.position`
    )
    .all(req.params.id);
  const annualExpenseTemplate = annualExpenseTemplateRaw.map((ti) => ({
    name: ti.name,
    value: ti.value,
    day_of_payment: ti.day_of_payment,
    month_of_payment: ti.month_of_payment,
    classification: ti.classification,
    position: ti.position,
    num_installments: ti.num_installments ?? 1,
    car_name: ti.car_name ?? null,
    installments: db.prepare('SELECT installment_number, month, day FROM annual_expense_template_installments WHERE template_item_id = ? ORDER BY installment_number').all(ti.id),
  }));

  const workbenchSnapshots = db
    .prepare('SELECT name, data, created_at, updated_at FROM workbench_snapshots WHERE dossier_id = ? ORDER BY created_at')
    .all(req.params.id)
    .map((s) => ({ ...s, data: JSON.parse(s.data) }));

  const cycles = db
    .prepare('SELECT id, year, month, previous_balance, is_closed, final_real_balance, cycle_start_day, cycle_start_weekend_adjustment, actual_start_date, actual_end_date FROM expense_cycles WHERE dossier_id = ? ORDER BY year, month')
    .all(req.params.id);

  const cycleItemsByCycleId = {};
  const incomeItemsByCycleId = {};
  if (cycles.length > 0) {
    const ph = cycles.map(() => '?').join(',');
    const cycleItems = db
      .prepare(
        `SELECT ci.cycle_id, ci.template_item_id, ci.section, ci.name, ci.type, ci.value, ci.day_of_payment, ci.paid, ci.spent, ci.done,
                ci.position, ci.paperless_tag_id, ci.exclude_from_emergency_fund, ci.account_id, acc.name as account_name
         FROM cycle_items ci
         LEFT JOIN accounts acc ON acc.id = ci.account_id
         WHERE ci.cycle_id IN (${ph}) ORDER BY ci.section, ci.position, ci.created_at`
      )
      .all(...cycles.map((c) => c.id));
    for (const ci of cycleItems) {
      if (!cycleItemsByCycleId[ci.cycle_id]) cycleItemsByCycleId[ci.cycle_id] = [];
      cycleItemsByCycleId[ci.cycle_id].push({ section: ci.section, name: ci.name, type: ci.type, value: ci.value, day_of_payment: ci.day_of_payment, paid: ci.paid, spent: ci.spent, done: ci.done, position: ci.position, paperless_tag_id: ci.paperless_tag_id, exclude_from_emergency_fund: ci.exclude_from_emergency_fund, account_name: ci.account_name, account_id: ci.account_id, template_item_id: ci.template_item_id });
    }

    const incomeItems = db
      .prepare(
        `SELECT cycle_id, name, value, position FROM cycle_income_items WHERE cycle_id IN (${ph}) ORDER BY position, created_at`
      )
      .all(...cycles.map((c) => c.id));
    for (const ii of incomeItems) {
      if (!incomeItemsByCycleId[ii.cycle_id]) incomeItemsByCycleId[ii.cycle_id] = [];
      incomeItemsByCycleId[ii.cycle_id].push({ name: ii.name, value: ii.value, position: ii.position });
    }
  }

  const goalsRaw = db
    .prepare('SELECT * FROM goals WHERE dossier_id = ? ORDER BY created_at')
    .all(req.params.id);

  const goalsExport = goalsRaw.map((g) => {
    const linkedAccounts = db
      .prepare('SELECT a.id, a.name FROM goal_accounts ga JOIN accounts a ON a.id = ga.account_id WHERE ga.goal_id = ?')
      .all(g.id);
    const linkedDistributions = db
      .prepare('SELECT eti.id, eti.name FROM goal_distributions gd JOIN expense_template_items eti ON eti.id = gd.distribution_template_item_id WHERE gd.goal_id = ?')
      .all(g.id);
    const cycleContributions = db
      .prepare('SELECT ec.year, ec.month, gcc.real_contribution FROM goal_cycle_contributions gcc JOIN expense_cycles ec ON ec.id = gcc.cycle_id WHERE gcc.goal_id = ?')
      .all(g.id);
    const historicalContributions = db
      .prepare('SELECT year, month, amount FROM goal_historical_contributions WHERE goal_id = ? ORDER BY year, month')
      .all(g.id);
    return {
      name: g.name,
      target_value: g.target_value,
      target_date: g.target_date,
      extra_value: g.extra_value,
      extra_value_impact_mode: g.extra_value_impact_mode,
      contribution_mode: g.contribution_mode,
      manual_monthly_value: g.manual_monthly_value,
      created_at: g.created_at,
      // Names for readability and pre-v18 importers; ids (same order) are what v18 re-links by.
      account_names: linkedAccounts.map((r) => r.name),
      account_ids: linkedAccounts.map((r) => r.id),
      distribution_names: linkedDistributions.map((r) => r.name),
      distribution_ids: linkedDistributions.map((r) => r.id),
      cycle_contributions: cycleContributions,
      historical_contributions: historicalContributions,
    };
  });

  const efAccounts = db
    .prepare(
      `SELECT a.id, a.name FROM emergency_fund_accounts efa
       JOIN accounts a ON a.id = efa.account_id AND a.dossier_id = efa.dossier_id
       WHERE efa.dossier_id = ?`
    )
    .all(req.params.id);

  const efExtraValues = db
    .prepare(
      'SELECT name, value, position FROM emergency_fund_extra_values WHERE dossier_id = ? ORDER BY position, rowid'
    )
    .all(req.params.id);

  // Annual expense years
  const annualYearsRaw = db
    .prepare('SELECT * FROM annual_expense_years WHERE dossier_id = ? ORDER BY year')
    .all(req.params.id);

  const annualExpenseYears = annualYearsRaw.map((ay) => {
    const yearItems = db
      .prepare('SELECT * FROM annual_expense_year_items WHERE year_id = ? ORDER BY position')
      .all(ay.id);

    return {
      year: ay.year,
      carryover: ay.carryover,
      items: yearItems.map((item) => {
        // One entry per installment, with all of its payments — an installment can have payments
        // in two (overlapping) cycles, and joining payments in directly exported it twice.
        const insts = db
          .prepare('SELECT * FROM annual_expense_year_installments WHERE year_item_id = ? ORDER BY installment_number')
          .all(item.id);
        const paymentsOf = db.prepare(
          `SELECT p.real_value, p.paid, ec.year AS cycle_year, ec.month AS cycle_month
             FROM annual_expense_payments p JOIN expense_cycles ec ON ec.id = p.cycle_id
            WHERE p.installment_id = ? ORDER BY ec.year, ec.month`
        );
        return {
          name: item.name,
          budgeted_value: item.budgeted_value,
          classification: item.classification,
          num_installments: item.num_installments,
          from_template: item.from_template,
          position: item.position,
          installments: insts.map((inst) => ({
            installment_number: inst.installment_number,
            month: inst.month,
            day: inst.day,
            payments: paymentsOf.all(inst.id).map((p) => ({ ...p, paid: !!p.paid })),
          })),
        };
      }),
    };
  });

  // Annual expense contributing accounts/distributions
  const aeAccounts = db
    .prepare('SELECT a.id, a.name FROM annual_expense_accounts aea JOIN accounts a ON a.id = aea.account_id AND a.dossier_id = aea.dossier_id WHERE aea.dossier_id = ?')
    .all(req.params.id);

  const aeDistributions = db
    .prepare('SELECT eti.id, eti.name FROM annual_expense_distributions aed JOIN expense_template_items eti ON eti.id = aed.distribution_template_id AND eti.dossier_id = aed.dossier_id WHERE aed.dossier_id = ?')
    .all(req.params.id);

  const loansExport = db
    .prepare(
      `SELECT l.name, l.status, l.interest_rate, l.salary, l.principal, l.term_months, l.remaining_balance, l.end_date, l.day_of_payment, l.balance_as_of, l.created_at, l.down_payment, l.taeg, l.opening_fee,
              eti.name as linked_expense_name, l.expense_template_item_id as linked_expense_id
       FROM loans l
       LEFT JOIN expense_template_items eti ON eti.id = l.expense_template_item_id
       WHERE l.dossier_id = ? ORDER BY l.created_at`
    )
    .all(req.params.id);

  const subscriptionsExport = db
    .prepare(
      `SELECT s.name, s.monthly_cost, s.billing_day, s.status, s.created_at,
              eti.name as distribution_name, s.distribution_template_item_id as distribution_id
       FROM subscriptions s
       LEFT JOIN expense_template_items eti ON eti.id = s.distribution_template_item_id
       WHERE s.dossier_id = ? ORDER BY s.created_at`
    )
    .all(req.params.id);

  const carsExport = db
    .prepare(
      `SELECT id, name, license_plate, make, model, fuel_type, initial_mileage_km, created_at
       FROM cars WHERE dossier_id = ? ORDER BY created_at`
    )
    .all(req.params.id)
    .map((c) => ({
      name: c.name,
      license_plate: c.license_plate,
      make: c.make,
      model: c.model,
      fuel_type: c.fuel_type,
      initial_mileage_km: c.initial_mileage_km,
      created_at: c.created_at,
      months: db
        .prepare(
          `SELECT year, month, mileage_km, avg_l_per_100km, avg_kwh_per_100km, cost_per_l, cost_per_kwh, notes
           FROM car_months WHERE car_id = ? ORDER BY year, month`
        )
        .all(c.id),
      adhoc_expenses: db
        .prepare(
          `SELECT name, value, recurrence, status, year, month, created_at
           FROM car_adhoc_expenses WHERE car_id = ? ORDER BY created_at`
        )
        .all(c.id),
    }));

  const filename = dossier.name.replace(/[^a-z0-9]/gi, '_') + '_export.json';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json({
    version: 18,
    dossier: {
      name: dossier.name,
      currency: dossier.currency,
      cycle_start_day: dossier.cycle_start_day,
      cycle_start_weekend_adjustment: dossier.cycle_start_weekend_adjustment ?? 'none',
      emergency_fund_months_multiplier: dossier.emergency_fund_months_multiplier ?? 6,
      emergency_fund_cycles_to_average: dossier.emergency_fund_cycles_to_average ?? 6,
      paperless_url: dossier.paperless_url ?? null,
      paperless_date_field_id: dossier.paperless_date_field_id ?? null,
      paperless_amount_field_id: dossier.paperless_amount_field_id ?? null,
      ai_enabled: dossier.ai_enabled == null ? true : !!dossier.ai_enabled,
      ai_model: dossier.ai_model ?? DEFAULT_AI_MODEL,
      ai_user_context: dossier.ai_user_context ?? null,
      reference_salary: dossier.reference_salary ?? null,
      loans_max_salary_pct: dossier.loans_max_salary_pct ?? null,
    },
    accounts,
    months: months.map((m) => ({
      year: m.year,
      month: m.month,
      filled: m.filled,
      comment: m.comment,
      filled_at: m.filled_at,
      entries: entriesByMonth[m.id] || [],
      snapshot_account_ids: snapshotsByMonth[m.id] || [],
    })),
    expense_template: expenseTemplate,
    income_template: incomeTemplate,
    annual_expense_template: annualExpenseTemplate,
    workbench_snapshots: workbenchSnapshots,
    cycles: cycles.map((c) => ({
      year: c.year,
      month: c.month,
      previous_balance: c.previous_balance,
      is_closed: c.is_closed,
      final_real_balance: c.final_real_balance,
      cycle_start_day: c.cycle_start_day,
      cycle_start_weekend_adjustment: c.cycle_start_weekend_adjustment,
      actual_start_date: c.actual_start_date,
      actual_end_date: c.actual_end_date,
      items: cycleItemsByCycleId[c.id] || [],
      income_items: incomeItemsByCycleId[c.id] || [],
    })),
    goals: goalsExport,
    emergency_fund_accounts: efAccounts.map((r) => r.name),
    emergency_fund_account_ids: efAccounts.map((r) => r.id),
    emergency_fund_extra_values: efExtraValues,
    annual_expense_years: annualExpenseYears,
    annual_expense_accounts: aeAccounts.map((r) => r.name),
    annual_expense_account_ids: aeAccounts.map((r) => r.id),
    annual_expense_distributions: aeDistributions.map((r) => r.name),
    annual_expense_distribution_ids: aeDistributions.map((r) => r.id),
    loans: loansExport,
    subscriptions: subscriptionsExport,
    cars: carsExport,
  });
  console.log(`[dossiers] Exported dossier "${dossier.name}" (${req.params.id}) by user ${req.user.username}`);
});

// DELETE /api/dossiers/:id
router.delete('/:id', (req, res) => {
  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Dossier not found' });
  if (dossier.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the creator can delete this dossier' });
  }
  db.prepare('DELETE FROM dossiers WHERE id = ?').run(req.params.id);
  console.log(`[dossiers] Deleted dossier "${dossier.name}" (${req.params.id}) by user ${req.user.username}`);
  res.status(204).end();
});

// GET /api/dossiers/:id/access
router.get('/:id/access', (req, res) => {
  const access = canAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Dossier not found' });
  const users = db
    .prepare(
      `SELECT u.id, u.username FROM users u
      JOIN dossier_access da ON da.user_id = u.id
      WHERE da.dossier_id = ?
      ORDER BY u.username`
    )
    .all(req.params.id);
  res.json(users);
});

// POST /api/dossiers/:id/access
router.post('/:id/access', (req, res) => {
  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Dossier not found' });
  if (dossier.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the creator can share this dossier' });
  }
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot share with yourself' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('INSERT OR IGNORE INTO dossier_access (dossier_id, user_id) VALUES (?, ?)').run(req.params.id, userId);
  const sharedWith = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  console.log(`[dossiers] Access granted on dossier "${dossier.name}" (${req.params.id}) to user ${sharedWith?.username} by ${req.user.username}`);
  res.status(201).json({ ok: true });
});

// DELETE /api/dossiers/:id/access/:userId
router.delete('/:id/access/:userId', (req, res) => {
  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Dossier not found' });
  if (dossier.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the creator can manage access' });
  }
  db.prepare('DELETE FROM dossier_access WHERE dossier_id = ? AND user_id = ?').run(
    req.params.id,
    req.params.userId
  );
  const revokedFrom = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.userId);
  console.log(`[dossiers] Access revoked on dossier "${dossier.name}" (${req.params.id}) from user ${revokedFrom?.username} by ${req.user.username}`);
  res.status(204).end();
});

// Expenses sub-router (settings, expense-template, cycles)
router.use('/:id', expensesRouter);
// Goals sub-router
router.use('/:id', goalsRouter);
// Emergency fund sub-router
router.use('/:id', emergencyFundRouter);
// Annual expenses sub-router
router.use('/:id', annualExpensesRouter);
// AI Advisor sub-router
router.use('/:id', aiAdvisorRouter);
// Loans sub-router
router.use('/:id', loansRouter);
router.use('/:id', subscriptionsRouter);
router.use('/:id', carsRouter);

module.exports = router;
module.exports.mergeExportedInstallments = mergeExportedInstallments;
