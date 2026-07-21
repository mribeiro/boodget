// Row-level cleanup between `it()` blocks within a single test file, for suites that would
// rather truncate everything than create a uniquely-named dossier per test. Most tests should
// prefer fresh fixtures per test (cheaper, no ordering pitfalls) — this exists for the cases
// that don't.
const TABLES_IN_FK_SAFE_ORDER = [
  'annual_expense_payments',
  'annual_expense_year_installments',
  'annual_expense_year_items',
  'annual_expense_years',
  'annual_expense_template_installments',
  'annual_expense_template_items',
  'annual_expense_accounts',
  'annual_expense_distributions',
  'goal_historical_contributions',
  'goal_cycle_contributions',
  'goal_distributions',
  'goal_accounts',
  'goals',
  'cycle_items',
  'expense_cycles',
  'expense_template_items',
  'workbench_snapshots',
  'subscriptions',
  'loans',
  'emergency_fund_extra_values',
  'emergency_fund_accounts',
  'ai_analyses',
  'month_entries',
  'month_account_snapshot',
  'months',
  'accounts',
  'dossier_access',
  'dossiers',
  'users',
];

function resetDb(db) {
  const reset = db.transaction(() => {
    for (const table of TABLES_IN_FK_SAFE_ORDER) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });
  reset();
}

module.exports = { resetDb };
