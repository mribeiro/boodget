const { db } = require('../../src/db');
const { computeCostUsd, summarizeWorkbenchData, buildDossierContext } = require('../../src/routes/ai-advisor');
const { createUser, createDossier, createAccount, createMonth } = require('../fixtures/builders');

describe('computeCostUsd', () => {
  it('computes plain input/output cost with no cache tokens', () => {
    // claude-sonnet-5: input $3/M, output $15/M
    const cost = computeCostUsd('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it('applies the 1.25x multiplier to cache-write tokens', () => {
    const cost = computeCostUsd('claude-sonnet-5', {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 * 1.25, 6);
  });

  it('applies the 0.1x multiplier to cache-read tokens', () => {
    const cost = computeCostUsd('claude-sonnet-5', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 * 0.1, 6);
  });

  it('returns null for an unknown model', () => {
    expect(computeCostUsd('not-a-real-model', { input_tokens: 100 })).toBeNull();
  });

  it('returns null when usage is missing', () => {
    expect(computeCostUsd('claude-sonnet-5', null)).toBeNull();
  });
});

describe('summarizeWorkbenchData', () => {
  it('sums income, must/want/save across monthly, annual (/12), and distributions', () => {
    const data = {
      income: [{ value: 3000 }],
      monthlyExpenses: [
        { classification: 'must', value: 800 },
        { classification: 'want', value: 200 },
      ],
      annualExpenses: [
        { classification: 'must', value: 1200 }, // /12 = 100
        { classification: 'want', value: 600 }, // /12 = 50
      ],
      distributions: [{ must_amount: 100, want_amount: 50, save_amount: 300 }],
    };
    const summary = summarizeWorkbenchData(data);
    expect(summary.total_income).toBe(3000);
    expect(summary.total_must).toBe(800 + 100 + 100);
    expect(summary.total_want).toBe(200 + 50 + 50);
    expect(summary.total_save).toBe(300);
    expect(summary.leftover).toBe(3000 - (800 + 100 + 100) - (200 + 50 + 50) - 300);
  });

  it('handles an empty/missing data shape without throwing', () => {
    const summary = summarizeWorkbenchData({});
    expect(summary.total_income).toBe(0);
    expect(summary.leftover).toBe(0);
  });
});

describe('buildDossierContext trimming caps', () => {
  function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    return { user, dossier };
  }

  it('caps the capital time series at the 24 most recent filled months', () => {
    const { dossier } = setup();
    const account = createAccount(db, { dossierId: dossier.id });
    // 25 consecutive real calendar months, starting 2018-01, so the oldest one is
    // unambiguously the one that should be dropped by the 24-month cap.
    const periods = [];
    for (let i = 0; i < 25; i++) {
      const year = 2018 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      periods.push(`${year}-${String(month).padStart(2, '0')}`);
      createMonth(db, {
        dossierId: dossier.id,
        year,
        month,
        filled: 1,
        accountIds: [account.id],
        values: { [account.id]: i * 10 },
      });
    }
    const context = JSON.parse(buildDossierContext(dossier.id));
    expect(context.capital_series).toHaveLength(24);
    // Oldest-first ordering; the very first (oldest) period should have been dropped.
    expect(context.capital_series[0].period).toBe(periods[1]);
    expect(context.capital_series[context.capital_series.length - 1].period).toBe(periods[24]);
  });

  it('caps recent_cycles at the 6 most recent cycles', () => {
    const { dossier } = setup();
    const { createExpenseCycle } = require('../fixtures/builders');
    for (let i = 1; i <= 7; i++) {
      createExpenseCycle(db, { dossierId: dossier.id, year: 2020, month: i });
    }
    const context = JSON.parse(buildDossierContext(dossier.id));
    expect(context.recent_cycles).toHaveLength(6);
  });

  it('caps annual_expense_years at the 3 most recent years', () => {
    const { dossier } = setup();
    const { createAnnualExpenseYear } = require('../fixtures/builders');
    for (const year of [2021, 2022, 2023, 2024]) {
      createAnnualExpenseYear(db, { dossierId: dossier.id, year });
    }
    const context = JSON.parse(buildDossierContext(dossier.id));
    expect(context.annual_expense_years).toHaveLength(3);
    expect(context.annual_expense_years.map((y) => y.year).sort()).toEqual([2022, 2023, 2024]);
  });

  it('caps workbench snapshots at the 3 most recently updated', () => {
    const { dossier } = setup();
    const insert = db.prepare(
      'INSERT INTO workbench_snapshots (id, dossier_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run('wb-1', dossier.id, 'A', '{}', '2026-01-01 00:00:00');
    insert.run('wb-2', dossier.id, 'B', '{}', '2026-01-02 00:00:00');
    insert.run('wb-3', dossier.id, 'C', '{}', '2026-01-03 00:00:00');
    insert.run('wb-4', dossier.id, 'D', '{}', '2026-01-04 00:00:00');
    const context = JSON.parse(buildDossierContext(dossier.id));
    expect(context.workbench).toHaveLength(3);
    expect(context.workbench.map((w) => w.name).sort()).toEqual(['B', 'C', 'D']);
  });

  it('omits user_notes when ai_user_context is empty/null', () => {
    const { dossier } = setup();
    const context = JSON.parse(buildDossierContext(dossier.id));
    expect(context.dossier.user_notes).toBeUndefined();
  });

  it('includes user_notes when ai_user_context is set', () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, ai_user_context: 'Ignore the March spike, that was a one-off.' });
    const context = JSON.parse(buildDossierContext(dossier.id));
    expect(context.dossier.user_notes).toBe('Ignore the March spike, that was a one-off.');
  });
});
