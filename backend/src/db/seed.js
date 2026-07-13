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

// Current / previous / two-months-ago calendar months (must come first)
const calYear  = todayYear;
const calMonth = todayMonth;
const prevCalMonth = calMonth === 1  ? 12 : calMonth - 1;
const prevCalYear  = calMonth === 1  ? calYear - 1  : calYear;
const twoCalAgoMonth = prevCalMonth === 1  ? 12 : prevCalMonth - 1;
const twoCalAgoYear  = prevCalMonth === 1  ? prevCalYear - 1 : prevCalYear;

// Current cycle STORED year/month (the month the cycle STARTS in):
//   If todayDay >= CYCLE_START → cycle started this calendar month → stored month = todayMonth
//   If todayDay < CYCLE_START  → cycle started last calendar month → stored month = prevCalMonth
const curCycleStartedThisMonth = todayDay >= CYCLE_START;
const curCycleMonth = curCycleStartedThisMonth ? todayMonth : prevCalMonth;
const curCycleYear  = curCycleStartedThisMonth ? todayYear  : prevCalYear;

// Previous / next cycle (by stored month)
const prevCycleMonth = curCycleMonth === 1  ? 12 : curCycleMonth - 1;
const prevCycleYear  = curCycleMonth === 1  ? curCycleYear - 1 : curCycleYear;
const nextCycleMonth = curCycleMonth === 12 ? 1  : curCycleMonth + 1;
const nextCycleYear  = curCycleMonth === 12 ? curCycleYear + 1 : curCycleYear;

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

// Advance a month number by n steps, wrapping 1–12
function addMonths(month, n) {
  return ((month - 1 + n) % 12) + 1;
}
const nextCalMonth     = calMonth === 12 ? 1  : calMonth + 1;
const nextCalYear      = calMonth === 12 ? calYear + 1 : calYear;
const twoYearsOutYM    = ym(calYear + 2, calMonth);
const nextMonthYM      = ym(nextCalYear, nextCalMonth);
const prevMonthYM      = ym(prevCalYear, prevCalMonth);

// Add n months to a (year, month), carrying over year boundaries — used for loan
// end_date so months_left computes to a fixed, seed-stable value regardless of today.
function addMonthsYM(year, month, n) {
  const total = year * 12 + (month - 1) + n;
  return ym(Math.floor(total / 12), (total % 12) + 1);
}

// ── DB helpers ──────────────────────────────────────────────────────────────

function mkDossier(userId, name, opts = {}) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO dossiers
       (id, name, currency, cycle_start_day,
        capital_snapshot_warning_day, next_cycle_warning_day, previous_cycle_close_warning_day,
        emergency_fund_months_multiplier, emergency_fund_cycles_to_average,
        paperless_url, paperless_token, paperless_date_field_id, paperless_amount_field_id,
        reference_salary, creator_id)
     VALUES (?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, name,
    opts.cycle_start_day ?? CYCLE_START,
    opts.capital_snapshot_warning_day  ?? 7,
    opts.next_cycle_warning_day        ?? 22,
    opts.previous_cycle_close_warning_day ?? 25,
    opts.emergency_fund_months_multiplier ?? 6,
    opts.emergency_fund_cycles_to_average ?? 6,
    opts.paperless_url ?? null,
    opts.paperless_token ?? null,
    opts.paperless_date_field_id ?? null,
    opts.paperless_amount_field_id ?? null,
    opts.reference_salary ?? null,
    userId
  );
  db.prepare('INSERT INTO dossier_access (dossier_id, user_id) VALUES (?, ?)').run(id, userId);
  return id;
}

function mkEmergencyFund(dossierId, accountIds, extraValues = []) {
  if (accountIds.length > 0) {
    const stmt = db.prepare('INSERT INTO emergency_fund_accounts (dossier_id, account_id) VALUES (?, ?)');
    for (const id of accountIds) stmt.run(dossierId, id);
  }
  if (extraValues.length > 0) {
    const stmt = db.prepare(
      'INSERT INTO emergency_fund_extra_values (id, dossier_id, name, value, position) VALUES (?, ?, ?, ?, ?)'
    );
    extraValues.forEach((ev, i) => stmt.run(uuidv4(), dossierId, ev.name, ev.value, i + 1));
  }
}

function mkAccounts(dossierId, defs) {
  const stmt = db.prepare(
    'INSERT INTO accounts (id, dossier_id, group_name, name, type, money_category, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const ids = [];
  defs.forEach((a, i) => {
    const id = uuidv4();
    ids.push(id);
    stmt.run(id, dossierId, a.group_name, a.name, a.type, a.money_category, i + 1);
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
       (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, paid, spent, done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const findTemplateItem = db.prepare(
    'SELECT id FROM expense_template_items WHERE dossier_id = ? AND section = ? AND name = ?'
  );
  for (const item of items) {
    const templateItem = findTemplateItem.get(dossierId, item.section, item.name);
    stmt.run(
      uuidv4(), cycleId, templateItem?.id ?? null,
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

function mkAnnualTemplate(dossierId, items) {
  const insertItem = db.prepare(
    `INSERT INTO annual_expense_template_items
       (id, dossier_id, name, value, num_installments, day_of_payment, month_of_payment, classification, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertInst = db.prepare(
    `INSERT INTO annual_expense_template_installments
       (id, template_item_id, installment_number, month, day)
     VALUES (?, ?, ?, ?, ?)`
  );
  const ids = [];
  items.forEach((item, i) => {
    const itemId = uuidv4();
    ids.push(itemId);
    const firstInst = item.installments[0];
    insertItem.run(
      itemId, dossierId, item.name, item.value, item.installments.length,
      firstInst?.day ?? null, firstInst?.month ?? null,
      item.classification, i + 1
    );
    item.installments.forEach((inst, j) => {
      insertInst.run(uuidv4(), itemId, j + 1, inst.month, inst.day);
    });
  });
  return ids;
}

function mkAnnualYear(dossierId, year, items, cycleList) {
  const yearId = uuidv4();
  db.prepare(
    `INSERT INTO annual_expense_years (id, dossier_id, year, carryover) VALUES (?, ?, ?, 0)`
  ).run(yearId, dossierId, year);
  const insertYearItem = db.prepare(
    `INSERT INTO annual_expense_year_items
       (id, year_id, name, budgeted_value, classification, num_installments, from_template, position)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const insertYearInst = db.prepare(
    `INSERT INTO annual_expense_year_installments
       (id, year_item_id, installment_number, month, day)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertPayment = db.prepare(
    `INSERT INTO annual_expense_payments (id, installment_id, cycle_id, real_value, paid)
     VALUES (?, ?, ?, 0, ?)`
  );
  items.forEach((item, i) => {
    const yearItemId = uuidv4();
    insertYearItem.run(yearItemId, yearId, item.name, item.value, item.classification, item.installments.length, i + 1);
    item.installments.forEach((inst, j) => {
      const instId = uuidv4();
      insertYearInst.run(instId, yearItemId, j + 1, inst.month, inst.day);
      // Match installment date to a seeded cycle and create a payment record
      const instDate = new Date(year, inst.month - 1, inst.day);
      for (const c of cycleList) {
        const cycleStart = new Date(c.cycleYear, c.cycleMonth - 1, c.startDay);
        const cycleEnd   = new Date(c.cycleYear, c.cycleMonth,     c.startDay - 1);
        if (instDate >= cycleStart && instDate <= cycleEnd) {
          insertPayment.run(uuidv4(), instId, c.cycleId, inst.paid ? 1 : 0);
          break;
        }
      }
    });
  });
}

function mkAnnualAccounts(dossierId, accountIds) {
  const stmt = db.prepare('INSERT INTO annual_expense_accounts (dossier_id, account_id) VALUES (?, ?)');
  for (const aId of accountIds) stmt.run(dossierId, aId);
}

function mkAnnualDistributions(dossierId, distributionTemplateIds) {
  const stmt = db.prepare('INSERT INTO annual_expense_distributions (dossier_id, distribution_template_id) VALUES (?, ?)');
  for (const tId of distributionTemplateIds) stmt.run(dossierId, tId);
}

function mkLoan(dossierId, def) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO loans
       (id, dossier_id, name, status, interest_rate, salary, principal, term_months,
        remaining_balance, end_date, expense_template_item_id, down_payment, taeg, opening_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, dossierId, def.name, def.status, def.interest_rate,
    def.salary ?? null, def.principal ?? null, def.term_months ?? null,
    def.remaining_balance ?? null, def.end_date ?? null,
    def.expense_template_item_id ?? null,
    def.down_payment ?? null, def.taeg ?? null, def.opening_fee ?? null
  );
  return id;
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
      // EF: multiplier=3, avg≈1467 → target≈4400; Savings=9200 → HEALTHY
      emergency_fund_months_multiplier: 3,
      emergency_fund_cycles_to_average: 6,
      // Paperless integration (demo — not a real instance)
      paperless_url: 'https://paperless.example.com',
      paperless_token: 'preview-token-not-real',
      paperless_date_field_id: 2,
      paperless_amount_field_id: 1,
      // Loans reference salary — manually set, matches the cycles' salary in this demo
      reference_salary: 1950,
    });

    const d0Accs = mkAccounts(d0, [
      { group_name: 'Main Bank', name: 'Current Account', type: 'Current Account',        money_category: 'idle'   },
      { group_name: 'Main Bank', name: 'Savings',          type: 'Guaranteed Investment',  money_category: 'active' },
      { group_name: 'Broker',    name: 'Stock Portfolio',  type: 'Risk Investment',        money_category: 'active' },
      { group_name: 'Broker',    name: 'Index Funds',      type: 'Risk Investment',        money_category: 'active' },
      { group_name: 'Broker',    name: 'Unvested RSUs',    type: 'Risk Investment',        money_category: 'stocks' },
    ]);

    mkMonth(d0, d0Accs, twoCalAgoYear,  twoCalAgoMonth, [3200, 8500, 4100, 6200, 7800]);
    mkMonth(d0, d0Accs, prevCalYear,    prevCalMonth,   [3450, 8800, 4400, 6600, 8400]);
    mkMonth(d0, d0Accs, calYear,        calMonth,       [3600, 9200, 4250, 7100, 9100]);

    // Monthly expense template
    const templateItems = [
      { section: 'expense',      name: 'Rent',           type: 'Fixed',  value: 900,  day_of_payment: 1,    classification: 'must', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
      { section: 'expense',      name: 'Electricity',    type: 'Fixed',  value: 65,   day_of_payment: 10,   classification: 'must', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: 15   },
      { section: 'expense',      name: 'Internet',       type: 'Fixed',  value: 35,   day_of_payment: 15,   classification: 'must', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: 2    },
      { section: 'expense',      name: 'Gym',            type: 'Fixed',  value: 45,   day_of_payment: 5,    classification: 'want', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
      { section: 'expense',      name: 'Streaming',      type: 'Fixed',  value: 18,   day_of_payment: 20,   classification: 'want', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
      { section: 'expense',      name: 'Groceries',      type: 'Budget', value: 350,  day_of_payment: null, classification: 'must', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
      { section: 'expense',      name: 'Restaurants',    type: 'Budget', value: 120,  day_of_payment: null, classification: 'want', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
      { section: 'expense',      name: 'Transport',      type: 'Budget', value: 80,   day_of_payment: null, classification: 'must', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
      { section: 'distribution', name: 'Emergency Fund', type: null,     value: 200,  day_of_payment: null, classification: null,   must_amount: 0,    want_amount: 0,    save_amount: 200,  paperless_tag_id: null },
      { section: 'distribution', name: 'Investment Top-up', type: null,  value: 300,  day_of_payment: null, classification: null,   must_amount: 0,    want_amount: 0,    save_amount: 300,  paperless_tag_id: null },
      { section: 'expense',      name: 'Car Loan Payment', type: 'Fixed',  value: 220, day_of_payment: 8,    classification: 'must', must_amount: null, want_amount: null, save_amount: null, paperless_tag_id: null },
    ];
    const insertTemplate = db.prepare(
      `INSERT INTO expense_template_items
         (id, dossier_id, section, name, type, value, day_of_payment, classification, must_amount, want_amount, save_amount, paperless_tag_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const templateIds = [];
    for (const item of templateItems) {
      const itemId = uuidv4();
      templateIds.push(itemId);
      insertTemplate.run(
        itemId, d0, item.section, item.name, item.type, item.value,
        item.day_of_payment, item.classification, item.must_amount, item.want_amount, item.save_amount, item.paperless_tag_id
      );
    }

    // Annual expense template — 4 items with varying installment counts
    const d0AnnualTemplateItems = [
      {
        name: 'Car Insurance', value: 720, classification: 'must',
        installments: [
          { month: curCycleMonth, day: 25 },   // falls in current cycle (unpaid)
        ],
      },
      {
        name: 'Property Tax', value: 540, classification: 'must',
        installments: [
          { month: prevCycleMonth, day: 25, paid: 1 },  // previous cycle (paid)
          { month: curCycleMonth,  day: 27, paid: 0 },  // current cycle (unpaid)
          { month: nextCycleMonth, day: 26, paid: 0 },  // next cycle (not seeded)
        ],
      },
      {
        name: 'Home Insurance', value: 280, classification: 'must',
        installments: [
          { month: addMonths(curCycleMonth, 4), day: 1 }, // ~4 months out, no seeded cycle
        ],
      },
      {
        name: 'Holiday Budget', value: 1200, classification: 'want',
        installments: [
          { month: addMonths(curCycleMonth, 3), day: 1 }, // ~3 months out, no seeded cycle
        ],
      },
    ];
    mkAnnualTemplate(d0, d0AnnualTemplateItems);

    // Previous cycle (closed)
    const d0PrevCycleId = mkCycle(d0, prevCycleYear, prevCycleMonth, 1950, 180, true, [
      { section: 'expense',      name: 'Rent',            type: 'Fixed',  value: 900, day_of_payment: 1,    paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Electricity',     type: 'Fixed',  value: 65,  day_of_payment: 10,   paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Internet',        type: 'Fixed',  value: 35,  day_of_payment: 15,   paid: 1,    spent: null, done: null },
      { section: 'expense',      name: 'Groceries',       type: 'Budget', value: 350, day_of_payment: null, paid: null, spent: 320,  done: null },
      { section: 'distribution', name: 'Investment Top-up', type: null,   value: 300, day_of_payment: null, paid: null, spent: null, done: 1    },
    ]);

    // Current cycle (open, partial progress)
    const d0CurCycleId = mkCycle(d0, curCycleYear, curCycleMonth, 1950, 230, false, [
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

    // Annual expense year — open year with payments matching seeded cycles
    mkAnnualYear(d0, calYear, d0AnnualTemplateItems, [
      { cycleId: d0PrevCycleId, cycleYear: prevCycleYear, cycleMonth: prevCycleMonth, startDay: CYCLE_START },
      { cycleId: d0CurCycleId,  cycleYear: curCycleYear,  cycleMonth: curCycleMonth,  startDay: CYCLE_START },
    ]);

    // Annual expense: Savings account contributes; Investment Top-up distribution linked
    mkAnnualAccounts(d0, [d0Accs[1]]); // Savings
    mkAnnualDistributions(d0, [templateIds[9]]); // Investment Top-up

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
        { id: 'ae-1', name: 'Car Insurance',  value: 720,  classification: 'must', fromTemplate: true },
        { id: 'ae-2', name: 'Property Tax',   value: 540,  classification: 'must', fromTemplate: true },
        { id: 'ae-3', name: 'Home Insurance', value: 280,  classification: 'must', fromTemplate: true },
        { id: 'ae-4', name: 'Holiday Budget', value: 1200, classification: 'want', fromTemplate: true },
      ],
      distributions: [
        { id: 'di-1', name: 'Emergency Fund',    value: 200, mustAmount: 0, wantAmount: 0, saveAmount: 200, fromTemplate: true },
        { id: 'di-2', name: 'Investment Top-up', value: 300, mustAmount: 0, wantAmount: 0, saveAmount: 300, fromTemplate: true },
      ],
    };
    db.prepare(
      'INSERT INTO workbench_snapshots (id, dossier_id, name, data) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), d0, 'Base Scenario', JSON.stringify(workbenchData));

    // Emergency fund: Savings account → HEALTHY (9200 > ~4400)
    mkEmergencyFund(d0, [d0Accs[1]]); // Savings

    // Loans: an active car loan (linked + covered by the "Car Loan Payment" expense
    // above: payment ≈205.23 < budgeted 220) and a draft house-purchase study
    // exercising the down payment / TAEG / opening fee fields.
    mkLoan(d0, {
      name: 'Car Loan', status: 'active', interest_rate: 4.5, salary: 1950,
      remaining_balance: 9000, end_date: addMonthsYM(calYear, calMonth, 47), // 48 months left
      expense_template_item_id: templateIds[10], // Car Loan Payment
    });
    mkLoan(d0, {
      name: 'House Purchase Study', status: 'draft', interest_rate: 3.2, salary: 1950,
      principal: 200000, term_months: 300, down_payment: 50000, taeg: 3.8, opening_fee: 350,
    });


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
      // EF: multiplier=6, avg≈995 → target≈5970; Index Funds=8200 → HEALTHY
      emergency_fund_months_multiplier: 6,
      emergency_fund_cycles_to_average: 6,
    });

    const dAAccs = mkAccounts(dA, [
      { group_name: 'Bank',   name: 'Current Account', type: 'Current Account', money_category: 'idle'   },
      { group_name: 'Broker', name: 'Index Funds',     type: 'Risk Investment', money_category: 'active' },
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

    // Emergency fund: Index Funds → HEALTHY (8200 > ~5970)
    mkEmergencyFund(dA, [dAAccs[1]]); // Index Funds


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
      // EF: avg≈75 → target≈450; Stock Portfolio (prev month)=12500 → HEALTHY
      emergency_fund_months_multiplier: 6,
      emergency_fund_cycles_to_average: 6,
    });

    const dBAccs = mkAccounts(dB, [
      { group_name: 'Bank',   name: 'Savings',         type: 'Guaranteed Investment', money_category: 'active' },
      { group_name: 'Broker', name: 'Stock Portfolio', type: 'Risk Investment',       money_category: 'active' },
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

    // Emergency fund: Stock Portfolio (from prev month, 12500) → HEALTHY vs target ~450
    mkEmergencyFund(dB, [dBAccs[1]]); // Stock Portfolio


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
      // EF: avg≈598 → target≈3585; Current Account=1500 → UNDERFUNDED (adds to red glance)
      emergency_fund_months_multiplier: 6,
      emergency_fund_cycles_to_average: 6,
    });

    const dCAccs = mkAccounts(dC, [
      { group_name: 'Bank',   name: 'Current Account', type: 'Current Account', money_category: 'idle'   },
      { group_name: 'Broker', name: 'Bonds',           type: 'Guaranteed Investment', money_category: 'active' },
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

    // Emergency fund: Current Account (1500) → UNDERFUNDED vs target ~3585
    mkEmergencyFund(dC, [dCAccs[0]]); // Current Account


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
      // EF: avg≈1015 → target≈6090; Index Funds=15500 → HEALTHY
      emergency_fund_months_multiplier: 6,
      emergency_fund_cycles_to_average: 6,
    });

    const dDAccs = mkAccounts(dD, [
      { group_name: 'Bank',   name: 'Savings',     type: 'Guaranteed Investment', money_category: 'active' },
      { group_name: 'Broker', name: 'Index Funds', type: 'Risk Investment',       money_category: 'active' },
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

    // Emergency fund: Index Funds (15500) → HEALTHY vs target ~6090
    mkEmergencyFund(dD, [dDAccs[1]]); // Index Funds


    // ══════════════════════════════════════════════════════════════════════
    // DOSSIER E — "Emergency Fund — Underfunded"
    // Dedicated showcase for the underfunded EF glance card.
    // avg≈660; extra=400; effective_base=1060; target=6360; current=2000 → UNDERFUNDED
    // ══════════════════════════════════════════════════════════════════════
    const dE = mkDossier(userId, 'Emergency Fund — Underfunded', {
      capital_snapshot_warning_day:     warningOff,
      next_cycle_warning_day:           warningOff,
      previous_cycle_close_warning_day: warningOff,
      emergency_fund_months_multiplier: 6,
      emergency_fund_cycles_to_average: 6,
    });

    const dEAccs = mkAccounts(dE, [
      { group_name: 'Bank', name: 'Current Account',   type: 'Current Account',       money_category: 'idle'   },
      { group_name: 'Bank', name: 'Emergency Savings', type: 'Guaranteed Investment',  money_category: 'active' },
    ]);

    mkMonth(dE, dEAccs, prevCalYear, prevCalMonth, [500, 1800]);
    mkMonth(dE, dEAccs, calYear,     calMonth,     [800, 2000]);

    // Prev cycle (closed): Rent=500 fixed paid + Groceries budget spent=120 → total=620
    mkCycle(dE, prevCycleYear, prevCycleMonth, 1600, 0, true, [
      { section: 'expense', name: 'Rent',      type: 'Fixed',  value: 500, day_of_payment: 1,    paid: 1,    spent: null, done: null },
      { section: 'expense', name: 'Groceries', type: 'Budget', value: 200, day_of_payment: null, paid: null, spent: 120,  done: null },
    ]);

    // Current cycle (open): Rent=500 + Groceries budget max=200 (open→uses max) → total=700
    mkCycle(dE, curCycleYear, curCycleMonth, 1600, 0, false, [
      { section: 'expense', name: 'Rent',      type: 'Fixed',  value: 500, day_of_payment: overdueDay, paid: 1,    spent: null, done: null },
      { section: 'expense', name: 'Groceries', type: 'Budget', value: 200, day_of_payment: null,       paid: null, spent: 80,   done: null },
    ]);

    // avg=(620+700)/2=660; extra=400; effective_base=1060; target=6×1060=6360
    // Emergency Savings (2000) → UNDERFUNDED, deficit≈4360
    mkEmergencyFund(dE, [dEAccs[1]], [  // Emergency Savings
      { name: 'Rent (external)', value: 400 },
    ]);

  });

  insert();
  console.log('[seed] Preview database seeded successfully.');
};
