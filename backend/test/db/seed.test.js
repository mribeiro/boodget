const { db } = require('../../src/db');
const seed = require('../../src/db/seed');
const { computeForecast, loadForecastInputs } = require('../../src/routes/forecast');

// The "Forecast — Validation" preview dossier is built so every forecast figure is a round
// number someone can check by hand; SPECIFICATION_FORECAST.md §9 lists the expected table.
// Its dates are all relative to today, so these figures hold whenever the seed runs.
describe('seed: Forecast — Validation dossier', () => {
  let inputs;
  beforeAll(() => {
    seed();
    const dossier = db.prepare("SELECT id FROM dossiers WHERE name = 'Forecast — Validation'").get();
    inputs = loadForecastInputs(dossier.id);
  });

  it('projects the documented cycle and annual fund closings', () => {
    const f = computeForecast(inputs, { horizon: 24 });
    expect(f.cycles.map((c) => c.source).slice(0, 3)).toEqual(['cycle', 'cycle', 'template']);
    expect(f.cycles.map((c) => c.closing)).toEqual([
      80, -190, -260, -330, -50, 230, 510, 790, 1070, 1350, 1630, 1910,
      2240, 2570, 2900, 3230, 3560, 3890, 4220, 4550, 4880, 5210, 5540, 5870,
    ]);
    expect(f.cycles.slice(0, 12).map((c) => c.annual_fund.closing)).toEqual([
      950, 1200, 850, 1100, -150, -350, -100, 150, 400, 650, 900, 700,
    ]);
    expect(f.template_fallbacks).toEqual([]);
    expect(f.lowest).toMatchObject({ cycle_index: 3, closing: -330 });
    expect(f.flags.map((x) => [x.type, x.cycle_index ?? x.name])).toEqual([
      ['negative_cycle', 1],
      ['fund_shortfall', 4],
      ['untracked_loan', 'Personal Loan'],
    ]);
    expect(f.flags.find((x) => x.type === 'fund_shortfall')).toMatchObject({ name: 'Holiday', short_by: 150 });
    const endings = f.cycles.flatMap((c, i) => c.events.filter((e) => e.type === 'loan_ends').map((e) => [i, e.name, e.amount]));
    expect(endings).toEqual([[3, 'Car Loan', 350], [11, 'Personal Loan', 50]]);
  });

  it('moves by +50 per cycle with usual budgets and −125 with the draft loan', () => {
    const usual = computeForecast(inputs, { horizon: 6, budgetMode: 'usual' });
    expect(usual.cycles.map((c) => c.closing)).toEqual([130, -90, -110, -130, 200, 530]);
    const draft = computeForecast(inputs, { horizon: 6 });
    const withDraft = computeForecast(inputs, { horizon: 6, includeDraftLoanIds: [draft.draft_loans[0].id] });
    expect(draft.draft_loans).toMatchObject([{ name: 'Kitchen Renovation', monthly_payment: 125 }]);
    expect(withDraft.cycles.map((c) => c.closing)).toEqual([-45, -440, -635, -830, -675, -520]);
  });
});
