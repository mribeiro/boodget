// Small, composable fixture builders operating directly on the raw `db` handle (bypassing
// HTTP) for speed. Distinct from src/db/seed.js, which is a large, relative-date-based demo
// seeder optimized for visual-QA realism, not per-test precision. Each builder defaults every
// NOT NULL/CHECK-constrained column to a valid value so a test only overrides what it's
// actually asserting on.
const bcrypt = require('bcrypt');
const crypto = require('crypto');

let counter = 0;
function uid(prefix) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${crypto.randomUUID()}`;
}

function createUser(db, overrides = {}) {
  const id = overrides.id || uid('user');
  const username = overrides.username || uid('user');
  const password = overrides.password || 'Test-Password-1234!';
  // Cost factor 4 (vs. the app's production 12) — correctness of bcrypt hashing isn't what's
  // under test here, only that login round-trips; a low cost keeps the suite fast.
  const passwordHash = overrides.password_hash || bcrypt.hashSync(password, 4);
  db.prepare('INSERT INTO users (id, username, password_hash, is_oidc) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    passwordHash,
    overrides.is_oidc ? 1 : 0
  );
  return { id, username, password };
}

function createDossier(db, overrides = {}) {
  const id = overrides.id || uid('dossier');
  const creatorId = overrides.creatorId || overrides.creator_id;
  if (!creatorId) throw new Error('createDossier requires creatorId');
  db.prepare('INSERT INTO dossiers (id, name, creator_id, currency) VALUES (?, ?, ?, ?)').run(
    id,
    overrides.name || 'Test Dossier',
    creatorId,
    overrides.currency || 'EUR'
  );
  const fields = [
    'cycle_start_day',
    'emergency_fund_months_multiplier',
    'emergency_fund_cycles_to_average',
    'reference_salary',
    'loans_max_salary_pct',
    'ai_enabled',
    'ai_model',
    'ai_api_key',
    'ai_user_context',
    'enablebanking_application_id',
    'enablebanking_private_key',
  ];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (overrides[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(overrides[f]);
    }
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE dossiers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }
  return db.prepare('SELECT * FROM dossiers WHERE id = ?').get(id);
}

function createAccount(db, overrides = {}) {
  const id = overrides.id || uid('account');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createAccount requires dossierId');
  const moneyCategory = overrides.money_category || 'active';
  const canReceiveTransfers =
    overrides.can_receive_transfers !== undefined
      ? (overrides.can_receive_transfers ? 1 : 0)
      : moneyCategory === 'stocks' ? 0 : 1;
  db.prepare(
    `INSERT INTO accounts (id, dossier_id, group_name, name, type, money_category, can_receive_transfers, archived, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.group_name || 'Group',
    overrides.name || 'Account',
    overrides.type || 'Current Account',
    moneyCategory,
    canReceiveTransfers,
    overrides.archived ? 1 : 0,
    overrides.position ?? 0
  );
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function createMonth(db, overrides = {}) {
  const id = overrides.id || uid('month');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createMonth requires dossierId');
  db.prepare('INSERT INTO months (id, dossier_id, year, month, filled, filled_at, comment) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    dossierId,
    overrides.year,
    overrides.month,
    overrides.filled ? 1 : 0,
    overrides.filled_at ?? null,
    overrides.comment ?? null
  );
  // Snapshot the accounts passed in `accountIds` (mirrors what POST /months does at creation
  // time — the accounts that exist *then*, not whatever exists when a test later queries it).
  const accountIds = overrides.accountIds || [];
  const insertSnapshot = db.prepare('INSERT INTO month_account_snapshot (month_id, account_id) VALUES (?, ?)');
  const insertEntry = db.prepare('INSERT INTO month_entries (month_id, account_id, value, comment) VALUES (?, ?, ?, ?)');
  const values = overrides.values || {};
  for (const accountId of accountIds) {
    insertSnapshot.run(id, accountId);
    insertEntry.run(id, accountId, values[accountId] ?? null, null);
  }
  return db.prepare('SELECT * FROM months WHERE id = ?').get(id);
}

function setMonthEntryValue(db, { monthId, accountId, value, comment = null }) {
  db.prepare('UPDATE month_entries SET value = ?, comment = ? WHERE month_id = ? AND account_id = ?').run(
    value,
    comment,
    monthId,
    accountId
  );
}

function createExpenseTemplateItem(db, overrides = {}) {
  const id = overrides.id || uid('tmpl-item');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createExpenseTemplateItem requires dossierId');
  const section = overrides.section || 'expense';
  db.prepare(
    `INSERT INTO expense_template_items
       (id, dossier_id, section, name, type, value, day_of_payment, position, classification,
        must_amount, want_amount, save_amount, exclude_from_emergency_fund, account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    section,
    overrides.name || 'Template Item',
    overrides.type ?? (section === 'expense' ? 'Fixed' : null),
    overrides.value ?? 0,
    overrides.day_of_payment ?? null,
    overrides.position ?? 0,
    overrides.classification ?? null,
    overrides.must_amount ?? null,
    overrides.want_amount ?? null,
    overrides.save_amount ?? null,
    overrides.exclude_from_emergency_fund ? 1 : 0,
    overrides.account_id ?? null
  );
  return db.prepare('SELECT * FROM expense_template_items WHERE id = ?').get(id);
}

function createExpenseCycle(db, overrides = {}) {
  const id = overrides.id || uid('cycle');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createExpenseCycle requires dossierId');
  db.prepare(
    `INSERT INTO expense_cycles
       (id, dossier_id, year, month, salary, previous_balance, is_closed, final_real_balance, cycle_start_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.year,
    overrides.month,
    overrides.salary ?? 0,
    overrides.previous_balance ?? 0,
    overrides.is_closed ? 1 : 0,
    overrides.final_real_balance ?? null,
    overrides.cycle_start_day ?? 25
  );
  return db.prepare('SELECT * FROM expense_cycles WHERE id = ?').get(id);
}

function createCycleItem(db, overrides = {}) {
  const id = overrides.id || uid('cycle-item');
  const cycleId = overrides.cycleId || overrides.cycle_id;
  if (!cycleId) throw new Error('createCycleItem requires cycleId');
  const section = overrides.section || 'expense';
  db.prepare(
    `INSERT INTO cycle_items
       (id, cycle_id, template_item_id, section, name, type, value, day_of_payment, paid, spent, done,
        position, exclude_from_emergency_fund, account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    cycleId,
    overrides.template_item_id ?? null,
    section,
    overrides.name || 'Cycle Item',
    overrides.type ?? (section === 'expense' ? 'Fixed' : null),
    overrides.value ?? 0,
    overrides.day_of_payment ?? null,
    overrides.paid ? 1 : 0,
    overrides.spent ?? 0,
    overrides.done ? 1 : 0,
    overrides.position ?? 0,
    overrides.exclude_from_emergency_fund ? 1 : 0,
    overrides.account_id ?? null
  );
  return db.prepare('SELECT * FROM cycle_items WHERE id = ?').get(id);
}

function createGoal(db, overrides = {}) {
  const id = overrides.id || uid('goal');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createGoal requires dossierId');
  db.prepare(
    `INSERT INTO goals
       (id, dossier_id, name, target_value, target_date, extra_value, extra_value_impact_mode,
        contribution_mode, manual_monthly_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.name || 'Test Goal',
    overrides.target_value ?? 1000,
    overrides.target_date || '2099-01',
    overrides.extra_value ?? null,
    overrides.extra_value_impact_mode ?? null,
    overrides.contribution_mode || 'manual',
    overrides.manual_monthly_value ?? null
  );
  if (overrides.accountIds) {
    const insert = db.prepare('INSERT INTO goal_accounts (goal_id, account_id) VALUES (?, ?)');
    for (const accountId of overrides.accountIds) insert.run(id, accountId);
  }
  if (overrides.distributionTemplateIds) {
    const insert = db.prepare('INSERT INTO goal_distributions (goal_id, distribution_template_item_id) VALUES (?, ?)');
    for (const distId of overrides.distributionTemplateIds) insert.run(id, distId);
  }
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
}

function createLoan(db, overrides = {}) {
  const id = overrides.id || uid('loan');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createLoan requires dossierId');
  const status = overrides.status || 'draft';
  db.prepare(
    `INSERT INTO loans
       (id, dossier_id, name, status, interest_rate, salary, principal, term_months, remaining_balance,
        end_date, day_of_payment, expense_template_item_id, down_payment, taeg, opening_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.name || 'Test Loan',
    status,
    overrides.interest_rate ?? 5,
    overrides.salary ?? null,
    overrides.principal ?? (status === 'draft' ? 10000 : null),
    overrides.term_months ?? (status === 'draft' ? 24 : null),
    overrides.remaining_balance ?? (status === 'active' ? 10000 : null),
    overrides.end_date ?? null,
    overrides.day_of_payment ?? null,
    overrides.expense_template_item_id ?? null,
    overrides.down_payment ?? null,
    overrides.taeg ?? null,
    overrides.opening_fee ?? null
  );
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
}

function createSubscription(db, overrides = {}) {
  const id = overrides.id || uid('subscription');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createSubscription requires dossierId');
  db.prepare(
    `INSERT INTO subscriptions (id, dossier_id, name, monthly_cost, billing_day, status, distribution_template_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.name || 'Test Subscription',
    overrides.monthly_cost ?? 10,
    overrides.billing_day ?? null,
    overrides.status || 'active',
    overrides.distribution_template_item_id ?? null
  );
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

function createAnnualExpenseTemplateItem(db, overrides = {}) {
  const id = overrides.id || uid('annual-tmpl-item');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createAnnualExpenseTemplateItem requires dossierId');
  db.prepare(
    `INSERT INTO annual_expense_template_items (id, dossier_id, name, value, classification, num_installments, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.name || 'Annual Item',
    overrides.value ?? 120,
    overrides.classification ?? null,
    overrides.num_installments ?? 1,
    overrides.position ?? 0
  );
  const installments = overrides.installments || [{ month: 1, day: 15 }];
  const insertInst = db.prepare(
    'INSERT INTO annual_expense_template_installments (id, template_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
  );
  installments.forEach((inst, idx) => {
    insertInst.run(uid('annual-tmpl-inst'), id, idx + 1, inst.month, inst.day);
  });
  return db.prepare('SELECT * FROM annual_expense_template_items WHERE id = ?').get(id);
}

function createAnnualExpenseYear(db, overrides = {}) {
  const id = overrides.id || uid('annual-year');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createAnnualExpenseYear requires dossierId');
  db.prepare('INSERT INTO annual_expense_years (id, dossier_id, year, carryover) VALUES (?, ?, ?, ?)').run(
    id,
    dossierId,
    overrides.year,
    overrides.carryover ?? 0
  );
  return db.prepare('SELECT * FROM annual_expense_years WHERE id = ?').get(id);
}

function createAnnualExpenseYearItem(db, overrides = {}) {
  const id = overrides.id || uid('annual-year-item');
  const yearId = overrides.yearId || overrides.year_id;
  if (!yearId) throw new Error('createAnnualExpenseYearItem requires yearId');
  db.prepare(
    `INSERT INTO annual_expense_year_items (id, year_id, name, budgeted_value, classification, num_installments, from_template, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    yearId,
    overrides.name || 'Annual Year Item',
    overrides.budgeted_value ?? 120,
    overrides.classification ?? null,
    overrides.num_installments ?? 1,
    overrides.from_template ? 1 : 0,
    overrides.position ?? 0
  );
  const installments = overrides.installments || [{ month: 1, day: 15 }];
  const insertInst = db.prepare(
    'INSERT INTO annual_expense_year_installments (id, year_item_id, installment_number, month, day) VALUES (?, ?, ?, ?, ?)'
  );
  const installmentIds = installments.map((inst, idx) => {
    const instId = uid('annual-year-inst');
    insertInst.run(instId, id, idx + 1, inst.month, inst.day);
    return instId;
  });
  return { ...db.prepare('SELECT * FROM annual_expense_year_items WHERE id = ?').get(id), installmentIds };
}

function createAnnualExpensePayment(db, overrides = {}) {
  const id = overrides.id || uid('annual-payment');
  const installmentId = overrides.installmentId || overrides.installment_id;
  const cycleId = overrides.cycleId || overrides.cycle_id;
  if (!installmentId || !cycleId) throw new Error('createAnnualExpensePayment requires installmentId and cycleId');
  db.prepare(
    'INSERT INTO annual_expense_payments (id, installment_id, cycle_id, real_value, paid) VALUES (?, ?, ?, ?, ?)'
  ).run(id, installmentId, cycleId, overrides.real_value ?? 0, overrides.paid ? 1 : 0);
  return db.prepare('SELECT * FROM annual_expense_payments WHERE id = ?').get(id);
}

function createBankConnection(db, overrides = {}) {
  const id = overrides.id || uid('bank-conn');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  if (!dossierId) throw new Error('createBankConnection requires dossierId');
  db.prepare(
    `INSERT INTO bank_connections (id, dossier_id, aspsp_name, aspsp_country, session_id, status, valid_until)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dossierId,
    overrides.aspsp_name || 'Test Bank',
    overrides.aspsp_country || 'FI',
    overrides.session_id || uid('session'),
    overrides.status || 'active',
    overrides.valid_until || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  );
  return db.prepare('SELECT * FROM bank_connections WHERE id = ?').get(id);
}

function createBankConnectionAccount(db, overrides = {}) {
  const id = overrides.id || uid('bank-acc');
  const connectionId = overrides.connectionId || overrides.connection_id;
  if (!connectionId) throw new Error('createBankConnectionAccount requires connectionId');
  db.prepare(
    `INSERT INTO bank_connection_accounts (id, connection_id, external_account_uid, iban, currency, display_name, account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    connectionId,
    overrides.external_account_uid || uid('ext-acc'),
    overrides.iban ?? null,
    overrides.currency ?? 'EUR',
    overrides.display_name ?? 'Bank Account',
    overrides.account_id ?? null
  );
  return db.prepare('SELECT * FROM bank_connection_accounts WHERE id = ?').get(id);
}

function createBankConnectionRequest(db, overrides = {}) {
  const state = overrides.state || uid('state');
  const dossierId = overrides.dossierId || overrides.dossier_id;
  const userId = overrides.userId || overrides.user_id;
  if (!dossierId) throw new Error('createBankConnectionRequest requires dossierId');
  if (!userId) throw new Error('createBankConnectionRequest requires userId');
  db.prepare(
    `INSERT INTO bank_connection_requests (state, dossier_id, user_id, aspsp_name, aspsp_country, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    state,
    dossierId,
    userId,
    overrides.aspsp_name || 'Test Bank',
    overrides.aspsp_country || 'FI',
    overrides.expires_at || new Date(Date.now() + 15 * 60 * 1000).toISOString()
  );
  return db.prepare('SELECT * FROM bank_connection_requests WHERE state = ?').get(state);
}

// Logs the given user in through the real HTTP endpoint (not a DB shortcut) so the
// supertest agent carries a genuine session cookie for subsequent requests.
async function loginAs(agent, { username, password }) {
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`loginAs failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

module.exports = {
  uid,
  createUser,
  createDossier,
  createAccount,
  createMonth,
  setMonthEntryValue,
  createExpenseTemplateItem,
  createExpenseCycle,
  createCycleItem,
  createGoal,
  createLoan,
  createSubscription,
  createAnnualExpenseTemplateItem,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
  createBankConnection,
  createBankConnectionAccount,
  createBankConnectionRequest,
  loginAs,
};
