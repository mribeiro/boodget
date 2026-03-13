'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { db } = require('./index');

module.exports = function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (userCount > 0) {
    console.log('[seed] Database already has users — skipping seed.');
    return;
  }

  console.log('[seed] Seeding preview database...');

  const insert = db.transaction(() => {
    // ── User ──────────────────────────────────────────────────────────────────
    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync('Preview@Capital2024!', 10);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, is_oidc) VALUES (?, ?, ?, 0)'
    ).run(userId, 'preview', passwordHash);

    // ── Dossier ───────────────────────────────────────────────────────────────
    const dossierId = uuidv4();
    db.prepare(
      'INSERT INTO dossiers (id, name, currency, cycle_start_day, creator_id) VALUES (?, ?, ?, ?, ?)'
    ).run(dossierId, 'My Finances', 'EUR', 25, userId);

    db.prepare(
      'INSERT INTO dossier_access (dossier_id, user_id) VALUES (?, ?)'
    ).run(dossierId, userId);

    // ── Accounts ──────────────────────────────────────────────────────────────
    const accIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    const accounts = [
      { id: accIds[0], group_name: 'Main Bank', name: 'Current Account', type: 'Current Account', is_idle_money: 1, position: 1 },
      { id: accIds[1], group_name: 'Main Bank', name: 'Savings',          type: 'Guaranteed Investment', is_idle_money: 0, position: 2 },
      { id: accIds[2], group_name: 'Broker',    name: 'Stock Portfolio',  type: 'Risk Investment',       is_idle_money: 0, position: 3 },
      { id: accIds[3], group_name: 'Broker',    name: 'Index Funds',      type: 'Risk Investment',       is_idle_money: 0, position: 4 },
    ];
    const insertAccount = db.prepare(
      'INSERT INTO accounts (id, dossier_id, group_name, name, type, is_idle_money, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const a of accounts) {
      insertAccount.run(a.id, dossierId, a.group_name, a.name, a.type, a.is_idle_money, a.position);
    }

    // ── Months ────────────────────────────────────────────────────────────────
    const monthData = [
      { year: 2025, month: 1, values: [3200, 8500, 4100, 6200], comment: 'January snapshot' },
      { year: 2025, month: 2, values: [3450, 8800, 4400, 6600], comment: 'February snapshot' },
      { year: 2025, month: 3, values: [3600, 9200, 4250, 7100], comment: 'March snapshot' },
    ];

    const insertMonth = db.prepare(
      'INSERT INTO months (id, dossier_id, year, month, comment, filled) VALUES (?, ?, ?, ?, ?, 1)'
    );
    const insertSnapshot = db.prepare(
      'INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)'
    );
    const insertEntry = db.prepare(
      'INSERT INTO month_entries (month_id, account_id, value) VALUES (?, ?, ?)'
    );

    for (const m of monthData) {
      const monthId = uuidv4();
      insertMonth.run(monthId, dossierId, m.year, m.month, m.comment);
      for (let i = 0; i < accIds.length; i++) {
        insertSnapshot.run(monthId, accIds[i]);
        insertEntry.run(monthId, accIds[i], m.values[i]);
      }
    }

    // ── Monthly Expense Template ───────────────────────────────────────────────
    const templateItems = [
      // Expenses
      { section: 'expense', name: 'Rent',        type: 'Fixed',  value: 900,  day_of_payment: 1,    classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Electricity', type: 'Fixed',  value: 65,   day_of_payment: 10,   classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Internet',    type: 'Fixed',  value: 35,   day_of_payment: 15,   classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Gym',         type: 'Fixed',  value: 45,   day_of_payment: 5,    classification: 'want', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Streaming',   type: 'Fixed',  value: 18,   day_of_payment: 20,   classification: 'want', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Groceries',   type: 'Budget', value: 350,  day_of_payment: null, classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Restaurants', type: 'Budget', value: 120,  day_of_payment: null, classification: 'want', must_amount: null, want_amount: null, save_amount: null },
      { section: 'expense', name: 'Transport',   type: 'Budget', value: 80,   day_of_payment: null, classification: 'must', must_amount: null, want_amount: null, save_amount: null },
      // Distributions
      { section: 'distribution', name: 'Emergency Fund',   type: null, value: 200, day_of_payment: null, classification: null, must_amount: 0, want_amount: 0, save_amount: 200 },
      { section: 'distribution', name: 'Investment Top-up', type: null, value: 300, day_of_payment: null, classification: null, must_amount: 0, want_amount: 0, save_amount: 300 },
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
        itemId, dossierId, item.section, item.name, item.type, item.value,
        item.day_of_payment, item.classification, item.must_amount, item.want_amount, item.save_amount
      );
    }

    // ── Annual Expense Template ───────────────────────────────────────────────
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
      insertAnnual.run(uuidv4(), dossierId, item.name, item.value, item.day_of_payment, item.month_of_payment, item.classification, item.position);
    }

    // ── Expense Cycle (March 2025, open) ──────────────────────────────────────
    const cycleId = uuidv4();
    db.prepare(
      `INSERT INTO expense_cycles (id, dossier_id, year, month, salary, previous_balance, is_closed)
       VALUES (?, ?, 2025, 3, 1950, 230, 0)`
    ).run(cycleId, dossierId);

    // Cycle items (mirror of template, with some partial progress)
    const cycleItems = [
      { section: 'expense', name: 'Rent',         type: 'Fixed',  value: 900, day_of_payment: 1,    paid: 1,     spent: null, done: null, template_item_id: templateIds[0] },
      { section: 'expense', name: 'Electricity',  type: 'Fixed',  value: 65,  day_of_payment: 10,   paid: 1,     spent: null, done: null, template_item_id: templateIds[1] },
      { section: 'expense', name: 'Internet',     type: 'Fixed',  value: 35,  day_of_payment: 15,   paid: 0,     spent: null, done: null, template_item_id: templateIds[2] },
      { section: 'expense', name: 'Gym',          type: 'Fixed',  value: 45,  day_of_payment: 5,    paid: 0,     spent: null, done: null, template_item_id: templateIds[3] },
      { section: 'expense', name: 'Streaming',    type: 'Fixed',  value: 18,  day_of_payment: 20,   paid: 0,     spent: null, done: null, template_item_id: templateIds[4] },
      { section: 'expense', name: 'Groceries',    type: 'Budget', value: 350, day_of_payment: null, paid: null,  spent: 180,  done: null, template_item_id: templateIds[5] },
      { section: 'expense', name: 'Restaurants',  type: 'Budget', value: 120, day_of_payment: null, paid: null,  spent: 45,   done: null, template_item_id: templateIds[6] },
      { section: 'expense', name: 'Transport',    type: 'Budget', value: 80,  day_of_payment: null, paid: null,  spent: 32,   done: null, template_item_id: templateIds[7] },
      { section: 'distribution', name: 'Emergency Fund',    type: null, value: 200, day_of_payment: null, paid: null, spent: null, done: 0, template_item_id: templateIds[8] },
      { section: 'distribution', name: 'Investment Top-up', type: null, value: 300, day_of_payment: null, paid: null, spent: null, done: 0, template_item_id: templateIds[9] },
    ];
    const insertCycleItem = db.prepare(
      `INSERT INTO cycle_items
        (id, cycle_id, section, name, type, value, day_of_payment, paid, spent, done, template_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of cycleItems) {
      insertCycleItem.run(
        uuidv4(), cycleId, item.section, item.name, item.type, item.value,
        item.day_of_payment, item.paid, item.spent, item.done, item.template_item_id
      );
    }

    // ── Workbench Snapshot ────────────────────────────────────────────────────
    const workbenchData = {
      income: [
        { id: 'inc-1', name: 'Salary',    value: 1950 },
        { id: 'inc-2', name: 'Freelance', value: 200 },
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
      `INSERT INTO workbench_snapshots (id, dossier_id, name, data)
       VALUES (?, ?, ?, ?)`
    ).run(uuidv4(), dossierId, 'Base Scenario', JSON.stringify(workbenchData));
  });

  insert();
  console.log('[seed] Preview database seeded successfully.');
};
