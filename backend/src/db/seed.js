'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { db } = require('./index');

// ── Date helpers (computed once at seed time) ───────────────────────────────

const now      = new Date();
const todayDay  = now.getDate();
const todayYear = now.getFullYear();
const todayMonth = now.getMonth() + 1; // 1–12

const CYCLE_START = 25;

// Current cycle year/month:
//   If todayDay < CYCLE_START → current cycle = this calendar month
//   If todayDay >= CYCLE_START → current cycle = next calendar month
const curCycleIsThisCalMonth = todayDay < CYCLE_START;
const curCycleMonth = curCycleIsThisCalMonth ? todayMonth : (todayMonth % 12) + 1;
const curCycleYear  = (curCycleIsThisCalMonth || todayMonth < 12) ? todayYear : todayYear + 1;

// Previous / next cycle
const prevCycleMonth = curCycleMonth === 1  ? 12 : curCycleMonth - 1;
const prevCycleYear  = curCycleMonth === 1  ? curCycleYear - 1 : curCycleYear;
const nextCycleMonth = curCycleMonth === 12 ? 1  : curCycleMonth + 1;
const nextCycleYear  = curCycleMonth === 12 ? curCycleYear + 1 : curCycleYear;

// Current / previous / two-months-ago calendar months
const calYear  = todayYear;
const calMonth = todayMonth;
const prevCalMonth = calMonth === 1  ? 12 : calMonth - 1;
const prevCalYear  = calMonth === 1  ? calYear - 1  : calYear;
const twoCalAgoMonth = prevCalMonth === 1  ? 12 : prevCalMonth - 1;
const twoCalAgoYear  = prevCalMonth === 1  ? prevCalYear - 1 : prevCalYear;

// Warning threshold helpers (values between 1–28):
//   warningOn  → todayDay >= warningOn  is always true
//   warningOff → todayDay >= warningOff is always false (edge: day 28 both equal 28)
const warningOn  = todayDay;
const warningOff = Math.min(28, todayDay + 1);

// Day-of-payment helpers:
//   overdueDay (CYCLE_START): in the current cycle, maps to the previous calendar
//     month → always in the past (edge: if todayDay === CYCLE_START it shows "Today")
//   futureDay (CYCLE_START - 1): last day of the cycle's second segment,
//     always in the future (edge: if todayDay === CYCLE_START - 1 it shows "Today")
const overdueDay = CYCLE_START;      // 25
const futureDay  = CYCLE_START - 1;  // 24

// target_date format: YYYY-MM
function ym(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
const nextCalMonth     = calMonth === 12 ? 1  : calMonth + 1;
const nextCalYear      = calMonth === 12 ? calYear + 1 : calYear;
const twoYearsOutYM    = ym(calYear + 2, calMonth);
const nextMonthYM      = ym(nextCalYear, nextCalMonth);
const prevMonthYM      = ym(prevCalYear, prevCalMonth);

// ── DB helpers ──────────────────────────────────────────────────────────────

function mkDossier(userId, name, opts = {}) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO dossiers
       (id, name, currency, cycle_start_day,
        capital_snapshot_warning_day, next_cycle_warning_day, previous_cycle_close_warning_day,
        creator_id)
     VALUES (?, ?, 'EUR', ?, ?, ?, ?, ?)`
  ).run(
    id, name,
    opts.cycle_start_day ?? CYCLE_START,
    opts.capital_snapshot_warning_day  ?? 7,
    opts.next_cycle_warning_day        ?? 22,
    opts.previous_cycle_close_warning_day ?? 25,
    userId
  );
  db.prepare('INSERT INTO dossier_access (dossier_id, user_id) VALUES (?, ?)').run(id, userId);
  return id;
}

function mkAccounts(dossierId, defs) {
  const stmt = db.prepare(
    'INSERT INTO accounts (id, dossier_id, group_name, name, type, is_idle_money, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const ids = [];
  defs.forEach((a, i) => {
    const id = uuidv4();
    ids.push(id);
    stmt.run(id, dossierId, a.group_name, a.name, a.type, a.is_idle_money ? 1 : 0, i + 1);
  });
  return ids;
}

function mkMonth(dossierId, accIds, year, month, values) {
  const monthId = uuidv4();
  db.prepare(
    'INSERT INTO months (id, dossier_id, year, month, filled) VALUES (?, ?, ?, ?, 1)'
  ).run(monthId, dossierId, year, month);
  const snap = db.prepare('INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)');
  const entry = db.prepare('INSERT INTO month_entries (month_id, account_id, value) VALUES (?, ?, ?)');
  accIds.forEach((aId, i) => {
    snap.run(monthId, aId);
    entry.run(monthId, aId, values[i] ?? 0);
  });
  return monthId;
}

function mkCycle(dossierId, year, month, salary, prevBal, isClosed, items = []) {
  const cycleId = uuidv4();
  db.prepare(
    `INSERT INTO expense_cycles (id, dossier_id, year, month, salary, previous_balance, is_closed)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(cycleId, dossierId, year, month, salary, prevBal, isClosed ? 1 : 0);
  const stmt = db.prepare(
    `INSERT INTO cycle_items
       (id, cycle_id, section, name, type, value, day_of_payment, paid, spent, done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of items) {
    stmt.run(
      uuidv4(), cycleId,
      item.section, item.name, item.type ?? null, item.value,
      item.day_of_payment ?? null,
      item.paid  ?? null,
      item.spent ?? null,
      item.done  ?? null
    );
  }
  return cycleId;
}

function mkGoal(dossierId, accIds, def) {
  const goalId = uuidv4();
  db.prepare(
    `INSERT INTO goals
       (id, dossier_id, name, target_value, target_date, contribution_mode,
        manual_monthly_value, extra_value, extra_value_impact_mode)
     VALUES (?, ?, ?, ?, ?, 'ad_hoc', null, null, null)`
  ).run(goalId, dossierId, def.name, def.target_value, def.target_date);
  const stmt = db.prepare('INSERT INTO goal_accounts (goal_id, account_id) VALUES (?, ?)');
  for (const aId of accIds) stmt.run(goalId, aId);
  return goalId;
}

// ── Seed entry point ─────────────────────────────────────────────────────────

module.exports = function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (userCount > 0) {
    console.log('[seed] Database already has users — skipping seed.');
    return;
  }

  console.log('[seed] Seeding preview database...');

  const insert = db.transaction(() => {

    // ── User ───────────────────────────────────────────────────────────────
    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync('Preview@Capital2024!', 10);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, is_oidc) VALUES (?, ?, ?, 0)'
    ).run(userId, 'preview', passwordHash);

    // ══════════════════════════════════════════════════════════════════════
    // DOSSIER 0 — "My Finances" (full-featured preview dossier)
    // Glances: all states neutral (all warning thresholds suppressed)
    // ══════════════════════════════════════════════════════════════════════
    const d0 = mkDossier(userId, 'My Finances', {
      capital_snapshot_warning_day:    warningOff,
      next_cycle_warning_day:          warningOff,
      previous_cycle_close_warning_day: warningOff,
    });

    const d0Accs = mkAccounts(d0, [
      { group_name: 'Main Bank', name: 'Current Account', type: 'Current Account',        is_idle_money: true  },
      { group_name: 'Main Bank', name: 'Savings',          type: 'Guaranteed Investment',  is_idle_money: false },
      { group_name: 'Broker',    name: 'Stock Portfolio',  type: 'Risk Investment',        is_idle_money: false },
      { group_name: 'Broker',    name: 'Index Funds',      type: 'Risk Investment',        is_idle_money: false },
    ]);

    mkMonth(d0, d0Accs, twoCalAgoYear,  twoCalAgoMonth, [3200, 8500, 4100, 6200]);
    mkMonth(d0, d0Accs, prevCalYear,    prevCalMonth,   [3450, 8800, 4400, 6600]);
    mkMonth(d0, d0Accs, calYear,        calMonth,       [3600, 9200, 4250, 7100]);

    // Monthly expense template
    const templateItems = [
      { section: 'expense',      name: 'Rent',           type: 'Fixed',  value: 900,  day_of_payment: 1,    classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Electricity',    type: 'Fixed',  value: 65,   day_of_payment: 10,   classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Internet',       type: 'Fixed',  value: 35,   day_of_payment: 15,   classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Gym',            type: 'Fixed',  value: 45,   day_of_payment: 5,    classification: 'want', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Streaming',      type: 'Fixed',  value: 18,   day_of_payment: 20,   classification: 'want', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Groceries',      type: 'Budget', value: 350,  day_of_payment: null, classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Restaurants',    type: 'Budget', value: 120,  day_of_payment: null, classification: 'want', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense',      name: 'Transport',      type: 'Budget', value: 80,   day_of_payment: null, classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'distribution', name: 'Emergency Fund', type: null,     value: 200,  day_of_payment: null, classification: null,   must_amount: 0,    want_amount: 0,    save_amount: 200  },
      { section: 'distribution', name: 'Investment Top-up', type: null,  value: 300,  day_of_payment: null, classification: null,   must_amount: 0,    want_amount: 0,    save_amount: 300  },
    ];
    const insertTemplate = db.prepare(
      `INSERT INTO expense_template_items
         (id, dossier_id, section, name, type, value, day_of_payment, classification, must_amount, want_amount, save_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const templateIds = [];
    for (const item of templateItems) {
      const itemId = uuidv4();
      templateIds.push(itemId);
      insertTemplate.run(
        itemId, d0, item.section, item.name, item.type, item.value,
        item.day_of_payment, item.classification, item.must_amount, item.want_amount, item.save_amount
      );
    }

    // Annual expense template
    const annualItems = [
      { name: 'Car Insurance',      value: 720,  day_of_payment: 15, month_of_payment: 3,  classification: 'must', position: 1 },
      { name: 'Home Insurance',     value: 280,  day_of_payment: 1,  month_of_payment: 1,  classification: 'must', position: 2 },
      { name: 'Holiday Budget',     value: 1200, day_of_payment: 1,  month_of_payment: 7,  classification: 'want', position: 3 },
      { name: 'Tech Subscriptions', value: 150,  day_of_payment: 1,  month_of_payment: 1,  classification: 'want', position: 4 },
    ];
    const insertAnnual = db.prepare(
      `INSERT INTO annual_expense_template_items
         (id, dossier_id, name, value, day_of_payment, month_of_payment, classification, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of annualItems) {
      insertAnnual.run(uuidv4(), d0, item.name, item.value, item.day_of_payment, item.month_of_payment, item.classification, item.position);
    }

    // Previous cycle (closed)
    mkCycle(d0, prevCycleYear, prevCycleMonth, 1950, 180, true, [
      { section: 'expense',      name: 'Rent',            type: 'Fixed',  value: 900, day_of_payment: 1,    paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Electricity',     type: 'Fixed',  value: 65,  day_of_payment: 10,   paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Internet',        type: 'Fixed',  value: 35,  day_of_payment: 15,   paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Groceries',       type: 'Budget', value: 350, day_of_payment: null, paid: null, spent: 320,  done: null },
      { section: 'distribution', name: 'Investment Top-up', type: null,   value: 300, day_of_payment: null, paid: null, spent: null, done: 1    },
    ]);

    // Current cycle (open, partial progress)
    mkCycle(d0, curCycleYear, curCycleMonth, 1950, 230, false, [
      { section: 'expense',      name: 'Rent',              type: 'Fixed',  value: 900, day_of_payment: 1,    paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Electricity',       type: 'Fixed',  value: 65,  day_of_payment: 10,   paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Internet',          type: 'Fixed',  value: 35,  day_of_payment: 15,   paid: 0,    spent: null, done: null },
      { section: 'expense',      name: 'Gym',               type: 'Fixed',  value: 45,  day_of_payment: 5,    paid: 0,    spent: null, done: null },
      { section: 'expense',      name: 'Streaming',         type: 'Fixed',  value: 18,  day_of_payment: 20,   paid: 0,    spent: null, done: null },
      { section: 'expense',      name: 'Groceries',         type: 'Budget', value: 350, day_of_payment: null, paid: null, spent: 180,  done: null },
      { section: 'expense',      name: 'Restaurants',       type: 'Budget', value: 120, day_of_payment: null, paid: null, spent: 45,   done: null },
      { section: 'expense',      name: 'Transport',         type: 'Budget', value: 80,  day_of_payment: null, paid: null, spent: 32,   done: null },
      { section: 'distribution', name: 'Emergency Fund',    type: null,     value: 200, day_of_payment: null, paid: null, spent: null, done: 0    },
      { section: 'distribution', name: 'Investment Top-up', type: null,     value: 300, day_of_payment: null, paid: null, spent: null, done: 0    },
    ]);

    // Workbench snapshot
    const workbenchData = {
      income: [
        { id: 'inc-1', name: 'Salary',    value: 1950 },
        { id: 'inc-2', name: 'Freelance', value: 200  },
      ],
      monthlyExpenses: [
        { id: 'me-1', name: 'Rent',        type: 'Fixed',  value: 900,  day_of_payment: 1,  classification: 'must', fromTemplate: true },
        { id: 'me-2', name: 'Electricity', type: 'Fixed',  value: 65,   day_of_payment: 10, classification: 'must', fromTemplate: true },
        { id: 'me-3', name: 'Internet',    type: 'Fixed',  value: 35,   day_of_payment: 15, classification: 'must', fromTemplate: true },
        { id: 'me-4', name: 'Gym',         type: 'Fixed',  value: 45,   day_of_payment: 5,  classification: 'want', fromTemplate: true },
        { id: 'me-5', name: 'Streaming',   type: 'Fixed',  value: 18,   day_of_payment: 20, classification: 'want', fromTemplate: true },
        { id: 'me-6', name: 'Groceries',   type: 'Budget', value: 350,  classification: 'must', fromTemplate: true },
        { id: 'me-7', name: 'Restaurants', type: 'Budget', value: 120,  classification: 'want', fromTemplate: true },
        { id: 'me-8', name: 'Transport',   type: 'Budget', value: 80,   classification: 'must', fromTemplate: true },
      ],
      annualExpenses: [
        { id: 'ae-1', name: 'Car Insurance',      value: 720,  day_of_payment: 15, month_of_payment: 3,  classification: 'must', fromTemplate: true },
        { id: 'ae-2', name: 'Home Insurance',     value: 280,  day_of_payment: 1,  month_of_payment: 1,  classification: 'must', fromTemplate: true },
        { id: 'ae-3', name: 'Holiday Budget',     value: 1200, day_of_payment: 1,  month_of_payment: 7,  classification: 'want', fromTemplate: true },
        { id: 'ae-4', name: 'Tech Subscriptions', value: 150,  day_of_payment: 1,  month_of_payment: 1,  classification: 'want', fromTemplate: true },
      ],
      distributions: [
        { id: 'di-1', name: 'Emergency Fund',    value: 200, mustAmount: 0, wantAmount: 0, saveAmount: 200, fromTemplate: true },
        { id: 'di-2', name: 'Investment Top-up', value: 300, mustAmount: 0, wantAmount: 0, saveAmount: 300, fromTemplate: true },
      ],
    };
    db.prepare(
      'INSERT INTO workbench_snapshots (id, dossier_id, name, data) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), d0, 'Base Scenario', JSON.stringify(workbenchData));


    // ══════════════════════════════════════════════════════════════════════
    // DOSSIER A — "Glances — All Good"
    // Capital: normal (variation + idle)
    // Cycle:   normal
    // Next:    upcoming expense
    // Goals:   active + completed
    // ══════════════════════════════════════════════════════════════════════
    const dA = mkDossier(userId, 'Glances — All Good', {
      capital_snapshot_warning_day:     warningOff,
      next_cycle_warning_day:           warningOff,
      previous_cycle_close_warning_day: warningOff,
    });

    const dAAccs = mkAccounts(dA, [
      { group_name: 'Bank',   name: 'Current Account', type: 'Current Account', is_idle_money: true  },
      { group_name: 'Broker', name: 'Index Funds',     type: 'Risk Investment', is_idle_money: false },
    ]);

    mkMonth(dA, dAAccs, prevCalYear, prevCalMonth, [2800, 7500]);
    mkMonth(dA, dAAccs, calYear,     calMonth,     [3100, 8200]);

    mkCycle(dA, prevCycleYear, prevCycleMonth, 2400, 100, true, [
      { section: 'expense', name: 'Rent', type: 'Fixed', value: 800, day_of_payment: 1, paid: 1, spent: null, done: null },
    ]);
    mkCycle(dA, curCycleYear, curCycleMonth, 2500, 150, false, [
      { section: 'expense',      name: 'Rent',         type: 'Fixed',  value: 800, day_of_payment: overdueDay, paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Internet',     type: 'Fixed',  value: 40,  day_of_payment: futureDay,  paid: 0,    spent: null, done: null },
      { section: 'expense',      name: 'Groceries',    type: 'Budget', value: 350, day_of_payment: null,       paid: null, spent: 120,  done: null },
      { section: 'distribution', name: 'Savings top-up', type: null,   value: 200, day_of_payment: null,       paid: null, spent: null, done: 0    },
    ]);
    // No next cycle created → but warningOff so no Cycle amber

    // Active goal: target >> current Index Funds value (8200)
    mkGoal(dA, [dAAccs[1]], { name: 'Retirement Fund', target_value: 50000, target_date: twoYearsOutYM });
    // Completed goal: target <= current Current Account value (3100)
    mkGoal(dA, [dAAccs[0]], { name: 'Emergency Buffer', target_value: 1000, target_date: nextMonthYM });


    // ══════════════════════════════════════════════════════════════════════
    // DOSSIER B — "Glances — Capital Snapshot Missing"
    // Capital: AMBER (warning threshold reached, no current-month snapshot)
    // Cycle:   normal
    // Next:    upcoming expense
    // Goals:   empty
    // ══════════════════════════════════════════════════════════════════════
    const dB = mkDossier(userId, 'Glances — Capital Snapshot Missing', {
      capital_snapshot_warning_day:     warningOn,   // ← triggers amber
      next_cycle_warning_day:           warningOff,
      previous_cycle_close_warning_day: warningOff,
    });

    const dBAccs = mkAccounts(dB, [
      { group_name: 'Bank',   name: 'Savings',         type: 'Guaranteed Investment', is_idle_money: false },
      { group_name: 'Broker', name: 'Stock Portfolio', type: 'Risk Investment',       is_idle_money: false },
    ]);

    // Only two older months — NO current-month snapshot
    mkMonth(dB, dBAccs, twoCalAgoYear, twoCalAgoMonth, [5200, 12000]);
    mkMonth(dB, dBAccs, prevCalYear,   prevCalMonth,   [5400, 12500]);

    mkCycle(dB, prevCycleYear, prevCycleMonth, 2100, 50, true, [
      { section: 'expense', name: 'Phone', type: 'Fixed', value: 25, day_of_payment: 1, paid: 1, spent: null, done: null },
    ]);
    mkCycle(dB, curCycleYear, curCycleMonth, 2200, 80, false, [
      { section: 'expense', name: 'Phone Bill', type: 'Fixed',  value: 25,  day_of_payment: futureDay, paid: 0,    spent: null, done: null },
      { section: 'expense', name: 'Transport',  type: 'Budget', value: 100, day_of_payment: null,      paid: null, spent: 30,   done: null },
    ]);
    // No goals → "No goals defined"


    // ══════════════════════════════════════════════════════════════════════
    // DOSSIER C — "Glances — Red Alerts"
    // Capital: normal
    // Cycle:   RED (previous cycle not closed)
    // Next:    AMBER (overdue unpaid expense)
    // Goals:   RED (failed goal)
    // ══════════════════════════════════════════════════════════════════════
    const dC = mkDossier(userId, 'Glances — Red Alerts', {
      capital_snapshot_warning_day:     warningOff,
      next_cycle_warning_day:           warningOff,
      previous_cycle_close_warning_day: warningOn,   // ← triggers red
    });

    const dCAccs = mkAccounts(dC, [
      { group_name: 'Bank',   name: 'Current Account', type: 'Current Account', is_idle_money: true  },
      { group_name: 'Broker', name: 'Bonds',           type: 'Guaranteed Investment', is_idle_money: false },
    ]);

    mkMonth(dC, dCAccs, prevCalYear, prevCalMonth, [1500, 3000]);
    mkMonth(dC, dCAccs, calYear,     calMonth,     [1500, 3100]);

    // Previous cycle NOT closed → Cycle card RED
    mkCycle(dC, prevCycleYear, prevCycleMonth, 1900, 0, false, [
      { section: 'expense', name: 'Rent',      type: 'Fixed', value: 700, day_of_payment: 1, paid: 1, spent: null, done: null },
      { section: 'expense', name: 'Insurance', type: 'Fixed', value: 90,  day_of_payment: 5, paid: 1, spent: null, done: null },
    ]);

    // Current cycle with an overdue unpaid expense → Next Expense AMBER
    mkCycle(dC, curCycleYear, curCycleMonth, 2000, 0, false, [
      { section: 'expense', name: 'Electricity', type: 'Fixed',  value: 70,  day_of_payment: overdueDay, paid: 0,    spent: null, done: null },
      { section: 'expense', name: 'Internet',    type: 'Fixed',  value: 35,  day_of_payment: futureDay,  paid: 0,    spent: null, done: null },
      { section: 'expense', name: 'Groceries',   type: 'Budget', value: 300, day_of_payment: null,       paid: null, spent: 50,   done: null },
    ]);

    // Failed goal: target_date already past, value far above current Bonds value (3100)
    mkGoal(dC, [dCAccs[1]], { name: 'House Down Payment', target_value: 50000, target_date: prevMonthYM });


    // ══════════════════════════════════════════════════════════════════════
    // DOSSIER D — "Glances — Next Cycle Not Opened"
    // Capital: normal
    // Cycle:   AMBER (next cycle not opened, warning threshold reached)
    // Next:    neutral (all fixed expenses paid)
    // Goals:   neutral (completed)
    // ══════════════════════════════════════════════════════════════════════
    const dD = mkDossier(userId, 'Glances — Next Cycle Not Opened', {
      capital_snapshot_warning_day:     warningOff,
      next_cycle_warning_day:           warningOn,   // ← triggers amber
      previous_cycle_close_warning_day: warningOff,
    });

    const dDAccs = mkAccounts(dD, [
      { group_name: 'Bank',   name: 'Savings',     type: 'Guaranteed Investment', is_idle_money: false },
      { group_name: 'Broker', name: 'Index Funds', type: 'Risk Investment',       is_idle_money: false },
    ]);

    mkMonth(dD, dDAccs, prevCalYear, prevCalMonth, [4800, 14000]);
    mkMonth(dD, dDAccs, calYear,     calMonth,     [5500, 15500]);

    // Previous cycle closed → prevents red override
    mkCycle(dD, prevCycleYear, prevCycleMonth, 2700, 250, true, [
      { section: 'expense', name: 'Rent',      type: 'Fixed', value: 800, day_of_payment: 1,  paid: 1, spent: null, done: null },
      { section: 'expense', name: 'Streaming', type: 'Fixed', value: 15,  day_of_payment: 20, paid: 1, spent: null, done: null },
    ]);

    // Current cycle open, all fixed expenses PAID → Next Expense "All fixed expenses paid"
    mkCycle(dD, curCycleYear, curCycleMonth, 2800, 300, false, [
      { section: 'expense',      name: 'Rent',       type: 'Fixed',  value: 800, day_of_payment: overdueDay, paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Streaming',  type: 'Fixed',  value: 15,  day_of_payment: futureDay,  paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Groceries',  type: 'Budget', value: 400, day_of_payment: null,       paid: null, spent: 210,  done: null },
      { section: 'distribution', name: 'Savings',    type: null,     value: 500, day_of_payment: null,       paid: null, spent: null, done: 1    },
    ]);
    // No next cycle created → with warningOn → Cycle card AMBER

    // Completed goal: target_value <= current Savings value (5500)
    mkGoal(dD, [dDAccs[0]], { name: 'Emergency Fund', target_value: 5000, target_date: nextMonthYM });

  });

  insert();
  console.log('[seed] Preview database seeded successfully.');
};
