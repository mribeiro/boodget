const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { computeForecast, loanLastDueDate } = require('../../src/routes/forecast');
const {
  createUser,
  createDossier,
  createExpenseTemplateItem,
  createExpenseCycle,
  createCycleItem,
  createCycleIncomeItem,
  createIncomeTemplateItem,
  createLoan,
  createAccount,
  createMonth,
  loginAs,
} = require('../fixtures/builders');
const supertest = require('supertest');

// Monthly windows starting 25 Jan 2026 (25th → 24th).
function windows(count, firstStored = null) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ start: new Date(2026, i, 25), end: new Date(2026, i + 1, 24), stored: i === 0 ? firstStored : null });
  }
  return out;
}

function baseInputs(overrides = {}) {
  return {
    windows: windows(12),
    opening_balance: 100,
    template: {
      income_total: 2000,
      expenses: [
        { id: 'rent', name: 'Rent', type: 'Fixed', value: 900 },
        { id: 'food', name: 'Groceries', type: 'Budget', value: 400 },
      ],
      distributions: [{ id: 'save', name: 'Savings', value: 500 }],
    },
    budget_averages: {},
    loans: [],
    installments: [],
    fund: null,
    ...overrides,
  };
}

describe('computeForecast (#349)', () => {
  it('projects template cycles, carrying each closing into the next opening', () => {
    const f = computeForecast(baseInputs(), { horizon: 3 });
    expect(f.cycles).toHaveLength(3);
    // 2000 − 900 − 400 − 500 = +200 per cycle
    expect(f.cycles.map((c) => [c.opening, c.closing])).toEqual([[100, 300], [300, 500], [500, 700]]);
    expect(f.cycles[0]).toMatchObject({ name: 'February 2026', source: 'template', income: 2000, expenses: 1300, distributions: 500 });
    expect(f.flags).toEqual([]);
  });

  it("starts from the current cycle's real items and previous balance", () => {
    const stored = {
      previous_balance: 50,
      income_total: 2100,
      items: [
        { section: 'expense', type: 'Fixed', name: 'Rent', value: 900, paid: 1, template_item_id: 'rent' },
        { section: 'expense', type: 'Budget', name: 'Groceries', value: 400, spent: 120, template_item_id: 'food' },
        { section: 'distribution', name: 'Savings', value: 500, done: 0, template_item_id: 'save' },
      ],
    };
    const f = computeForecast(baseInputs({ windows: windows(12, stored) }), { horizon: 2 });
    expect(f.cycles[0]).toMatchObject({ source: 'cycle', opening: 50, income: 2100, closing: 50 + 2100 - 1300 - 500 });
    expect(f.cycles[1].opening).toBe(f.cycles[0].closing);
  });

  it('flags the first cycle that ends negative and reports the lowest', () => {
    const inputs = baseInputs({ opening_balance: -500 });
    inputs.template.income_total = 1700; // −100 per cycle
    const f = computeForecast(inputs, { horizon: 3 });
    expect(f.cycles.map((c) => c.closing)).toEqual([-600, -700, -800]);
    expect(f.flags[0]).toMatchObject({ type: 'negative_cycle', cycle_index: 0, closing: -600 });
    expect(f.lowest).toMatchObject({ cycle_index: 2, closing: -800 });
  });

  it("drops a linked loan's expense after its last payment and reports when it ends", () => {
    const inputs = baseInputs({
      loans: [{ id: 'l1', name: 'Car loan', status: 'active', monthly_payment: 250, expense_template_item_id: 'car', last_due_date: new Date(2026, 2, 5), is_matured: false }],
    });
    inputs.template.expenses.push({ id: 'car', name: 'Car loan payment', type: 'Fixed', value: 250 });
    const f = computeForecast(inputs, { horizon: 4 });
    // Windows: Jan 25–Feb 24, Feb 25–Mar 24 (holds the 5 Mar payment), Mar 25–Apr 24, …
    expect(f.cycles.map((c) => c.expenses)).toEqual([1550, 1550, 1300, 1300]);
    expect(f.cycles[1].events).toContainEqual(expect.objectContaining({ type: 'loan_ends', name: 'Car loan', amount: 250, date: '2026-03-05' }));
  });

  it('adds an untracked loan as its own outflow and flags it', () => {
    const inputs = baseInputs({
      loans: [{ id: 'l2', name: 'Personal loan', status: 'active', monthly_payment: 150, expense_template_item_id: null, last_due_date: new Date(2026, 1, 10), is_matured: false }],
    });
    const f = computeForecast(inputs, { horizon: 3 });
    expect(f.cycles.map((c) => c.expenses)).toEqual([1450, 1300, 1300]);
    expect(f.flags).toContainEqual(expect.objectContaining({ type: 'untracked_loan', name: 'Personal loan' }));
  });

  it('includes a draft loan only when asked', () => {
    const inputs = baseInputs({
      loans: [{ id: 'd1', name: 'House study', status: 'draft', monthly_payment: 700, expense_template_item_id: null, last_due_date: null, is_matured: false }],
    });
    expect(computeForecast(inputs, { horizon: 1 }).cycles[0].expenses).toBe(1300);
    const withDraft = computeForecast(inputs, { horizon: 1, includeDraftLoanIds: ['d1'] });
    expect(withDraft.cycles[0].expenses).toBe(2000);
    expect(withDraft.draft_loans).toEqual([{ id: 'd1', name: 'House study', monthly_payment: 700, included: true }]);
  });

  it('runs the annual fund and flags the first installment it cannot cover', () => {
    const inputs = baseInputs({
      fund: { opening: 300, distribution_ids: ['save'] },
      installments: [
        { date: new Date(2026, 1, 10), name: 'Insurance', amount: 600 },
        { date: new Date(2026, 2, 12), name: 'Car tax', amount: 900 },
      ],
    });
    const f = computeForecast(inputs, { horizon: 3 });
    // 300 + 500 − 600 = 200; 200 + 500 − 900 = −200 → shortfall on Car tax
    expect(f.cycles[0].annual_fund).toMatchObject({ opening: 300, in: 500, closing: 200 });
    expect(f.cycles[1].annual_fund).toMatchObject({ opening: 200, in: 500, closing: -200 });
    expect(f.flags).toContainEqual(expect.objectContaining({ type: 'fund_shortfall', name: 'Car tax', short_by: 200, date: '2026-03-12' }));
    expect(f.cycles[1].events).toContainEqual(expect.objectContaining({ type: 'installment_due', name: 'Car tax' }));
  });

  it('leaves the fund out when it is not configured, but still lists installments', () => {
    const inputs = baseInputs({ installments: [{ date: new Date(2026, 1, 10), name: 'Insurance', amount: 600 }] });
    const f = computeForecast(inputs, { horizon: 1 });
    expect(f.cycles[0].annual_fund).toBeNull();
    expect(f.fund_configured).toBe(false);
    expect(f.cycles[0].events).toContainEqual(expect.objectContaining({ type: 'installment_due', amount: 600 }));
  });

  it('counts Budget items at their usual spending in "usual" mode, never below what is spent', () => {
    const inputs = baseInputs({ budget_averages: { food: 250 } });
    expect(computeForecast(inputs, { horizon: 1 }).cycles[0].expenses).toBe(1300);
    expect(computeForecast(inputs, { horizon: 1, budgetMode: 'usual' }).cycles[0].expenses).toBe(1150);
    const stored = {
      previous_balance: 0,
      income_total: 2000,
      items: [{ section: 'expense', type: 'Budget', name: 'Groceries', value: 400, spent: 320, template_item_id: 'food' }],
    };
    const f = computeForecast({ ...inputs, windows: windows(2, stored) }, { horizon: 1, budgetMode: 'usual' });
    expect(f.cycles[0].expenses).toBe(320);
  });

  it("names and dates cycles from their own (weekend-adjusted) windows", () => {
    // Nominal start Sun 25 Jan 2026 shifted to Fri 23 Jan; a 23 Jan installment belongs to it.
    const inputs = baseInputs({
      windows: [{ start: new Date(2026, 0, 23), end: new Date(2026, 1, 24), stored: null }],
      installments: [{ date: new Date(2026, 0, 23), name: 'Licence', amount: 30 }],
    });
    const f = computeForecast(inputs, { horizon: 1 });
    expect(f.cycles[0]).toMatchObject({ name: 'February 2026', start: '2026-01-23', end: '2026-02-24' });
    expect(f.cycles[0].events).toContainEqual(expect.objectContaining({ type: 'installment_due', name: 'Licence' }));
  });

  it("puts a loan's last payment on its end month's payment day, clamped", () => {
    expect(loanLastDueDate({ end_date: '2027-02', day_of_payment: 31 })).toEqual(new Date(2027, 1, 28));
    expect(loanLastDueDate({ end_date: null })).toBeNull();
  });
});

describe('computeForecast — capital track', () => {
  const capital = { idle: 1000, active: 5000, as_of: '2026-01' };

  it('keeps the Save part of distributions in Capital and treats the rest as spent', () => {
    // Savings 500, of which 300 is Save: 200 leaves Capital, 300 only moves to invested money.
    const f = computeForecast(baseInputs({ capital, save_amounts: { save: 300 } }), { horizon: 3 });
    // The first cycle is running: its income is already in the snapshot, everything else is
    // still to go (nothing ticked): −900 −400 −500 cash, +300 kept.
    expect(f.cycles[0].capital).toEqual({ opening: 6000, cash_flow: -1800, saved: 300, growth: 0, annual_bills: 0, closing: 4500 });
    // Later cycles: 2000 − 1800 = +200 cash, +300 kept.
    expect(f.cycles.map((c) => c.capital.closing)).toEqual([4500, 5000, 5500]);
    expect(f.capital).toEqual({ as_of: '2026-01', start: 6000, end: 5500, saved_total: 900, growth_total: 0, return_pct: null });
  });

  it("only takes what's still outstanding in the running cycle", () => {
    const stored = {
      previous_balance: 0,
      income_total: 2000,
      items: [
        { section: 'expense', type: 'Fixed', name: 'Rent', value: 900, paid: 1, template_item_id: 'rent' },
        { section: 'expense', type: 'Budget', name: 'Groceries', value: 400, spent: 120, template_item_id: 'food' },
        { section: 'distribution', name: 'Savings', value: 500, done: 1, template_item_id: 'save' },
        { section: 'distribution', name: 'Invest', value: 200, done: 0, template_item_id: 'orphaned' },
      ],
    };
    // 'Invest' is matched to its template Save part by name.
    const inputs = baseInputs({ windows: windows(12, stored), capital, save_amounts: { save: 500, 'name:Invest': 200 } });
    const f = computeForecast(inputs, { horizon: 1 });
    // Rent paid, Savings done: only 280 of Groceries and the 200 Invest are left, all of it kept.
    expect(f.cycles[0].capital).toMatchObject({ cash_flow: -480, saved: 200, closing: 6000 - 480 + 200 });
  });

  it('keeps a contributing annual-fund distribution whole and takes the installments out', () => {
    const inputs = baseInputs({
      capital,
      fund: { opening: 0, distribution_ids: ['save'] },
      installments: [{ date: new Date(2026, 2, 1), name: 'Insurance', amount: 1200 }],
    });
    const f = computeForecast(inputs, { horizon: 2 });
    // First cycle: 6000 − 1800 + 500 kept = 4700; second: 4700 + 200 + 500 − 1200.
    expect(f.cycles[1].capital).toEqual({ opening: 4700, cash_flow: 200, saved: 500, growth: 0, annual_bills: 1200, closing: 4200 });
  });

  it('grows invested money at the expected return, compounded monthly', () => {
    const inputs = baseInputs({ capital: { idle: 0, active: 12000, as_of: '2026-01' }, expected_return_pct: 6 });
    const rate = Math.pow(1.06, 1 / 12) - 1;
    const f = computeForecast(inputs, { horizon: 2 });
    expect(f.cycles[0].capital.growth).toBeCloseTo(12000 * rate, 2);
    expect(f.capital.return_pct).toBe(6);
    // An explicit option overrides the dossier setting.
    expect(computeForecast(inputs, { horizon: 2, returnPct: 0 }).capital.growth_total).toBe(0);
  });

  it('has no capital track without a Capital snapshot', () => {
    const f = computeForecast(baseInputs(), { horizon: 2 });
    expect(f.capital).toBeNull();
    expect(f.cycles[0].capital).toBeNull();
  });
});

describe('GET /forecast (#349)', () => {
  async function setup() {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, user);
    return { user, dossier, agent };
  }

  it('projects from the open current cycle and then the template', async () => {
    const { dossier, agent } = await setup();
    createIncomeTemplateItem(db, { dossierId: dossier.id, name: 'Salary', default_value: 2000 });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 900, day_of_payment: 1 });
    // The cycle covering today.
    const now = new Date();
    const y = now.getDate() >= 25 ? now.getFullYear() : new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear();
    const m = now.getDate() >= 25 ? now.getMonth() + 1 : new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth() + 1;
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: y, month: m, previous_balance: 40 });
    createCycleIncomeItem(db, { cycleId: cycle.id, name: 'Salary', value: 2100 });
    createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 900 });

    const res = await agent.get(`/api/dossiers/${dossier.id}/forecast?horizon=6`);

    expect(res.status).toBe(200);
    expect(res.body.cycles).toHaveLength(6);
    expect(res.body.cycles[0]).toMatchObject({ source: 'cycle', opening: 40, income: 2100, closing: 1240 });
    expect(res.body.cycles[1]).toMatchObject({ source: 'template', opening: 1240, income: 2000, closing: 2340 });
  });

  it("uses the latest cycle's figures when the income or expense template is empty", async () => {
    const { dossier, agent } = await setup();
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 1, previous_balance: 0 });
    createCycleIncomeItem(db, { cycleId: cycle.id, name: 'Salary', value: 1800 });
    createCycleItem(db, { cycleId: cycle.id, section: 'expense', type: 'Fixed', name: 'Rent', value: 800 });

    const res = await agent.get(`/api/dossiers/${dossier.id}/forecast?horizon=6`);

    expect(res.body.template_fallbacks.map((f) => f.part)).toEqual(['income', 'expenses']);
    const later = res.body.cycles[1];
    expect(later).toMatchObject({ source: 'template', income: 1800, expenses: 800 });
  });

  it('lists draft loans and includes one on request', async () => {
    const { dossier, agent } = await setup();
    const loan = createLoan(db, { dossierId: dossier.id, name: 'House study', status: 'draft', principal: 100000, term_months: 360, interest_rate: 3 });

    const plain = await agent.get(`/api/dossiers/${dossier.id}/forecast`);
    const withDraft = await agent.get(`/api/dossiers/${dossier.id}/forecast?include_draft=${loan.id}`);

    expect(plain.body.draft_loans[0]).toMatchObject({ id: loan.id, included: false });
    expect(withDraft.body.cycles[0].expenses).toBeGreaterThan(plain.body.cycles[0].expenses);
  });

  it('projects Capital from the latest snapshot, the Save parts and the expected return', async () => {
    const { dossier, agent } = await setup();
    db.prepare('UPDATE dossiers SET forecast_expected_return_pct = 5 WHERE id = ?').run(dossier.id);
    const cash = createAccount(db, { dossierId: dossier.id, name: 'Current', money_category: 'idle' });
    const invest = createAccount(db, { dossierId: dossier.id, name: 'Broker', money_category: 'active' });
    const rsu = createAccount(db, { dossierId: dossier.id, name: 'RSUs', money_category: 'stocks' });
    createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, filled: true, accountIds: [cash.id, invest.id, rsu.id], values: { [cash.id]: 1000, [invest.id]: 9000, [rsu.id]: 50000 } });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution', name: 'Investments', value: 900, must_amount: 0, want_amount: 0, save_amount: 900 });

    const res = await agent.get(`/api/dossiers/${dossier.id}/forecast?horizon=6`);

    // Stocks are left out, as on the Capital tab.
    expect(res.body.capital).toMatchObject({ as_of: '2026-01', start: 10000, return_pct: 5 });
    expect(res.body.cycles[0].capital).toMatchObject({ opening: 10000, cash_flow: -900, saved: 900 });
    expect(res.body.capital.saved_total).toBe(5400);
    expect(res.body.capital.growth_total).toBeGreaterThan(0);
  });

  it('rejects an unknown horizon or budget mode', async () => {
    const { dossier, agent } = await setup();
    expect((await agent.get(`/api/dossiers/${dossier.id}/forecast?horizon=7`)).status).toBe(400);
    expect((await agent.get(`/api/dossiers/${dossier.id}/forecast?budget=max`)).status).toBe(400);
  });

  it("404s for another user's dossier", async () => {
    const { agent } = await setup();
    const other = createDossier(db, { creatorId: createUser(db).id });
    expect((await agent.get(`/api/dossiers/${other.id}/forecast`)).status).toBe(404);
  });
});
