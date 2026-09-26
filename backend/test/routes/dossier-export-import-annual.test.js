const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createExpenseCycle,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
  loginAs,
} = require('../fixtures/builders');
const { mergeExportedInstallments } = require('../../src/routes/dossiers');
const { computeYearStatus, pickInstallmentPayment } = require('../../src/routes/annual-expenses');
const supertest = require('supertest');

// One installment with payments in two overlapping cycles (possible after a period edit with
// resolve_overlap: 'ignore') used to be exported — and shown in the year view — twice (#331).
async function setup() {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id });
  const jan = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 }); // Jan 25 – Feb 24
  const overlapping = createExpenseCycle(db, {
    dossierId: dossier.id, year: 2026, month: 2, actual_start_date: '2026-01-20', actual_end_date: '2026-03-24',
  });
  const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
  const item = createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Insurance', budgeted_value: 600, installments: [{ month: 1, day: 30 }] });
  createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: jan.id, real_value: 600, paid: true });
  createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: overlapping.id, real_value: 600, paid: false });
  const agent = supertest.agent(buildTestApp());
  await loginAs(agent, user);
  return { dossier, year, jan, agent };
}

describe('annual installments with payments in two cycles', () => {
  it('exports the installment once, with both payments', async () => {
    const { dossier, agent } = await setup();

    const res = await agent.get(`/api/dossiers/${dossier.id}/export`);

    expect(res.body.version).toBe(18);
    const installments = res.body.annual_expense_years[0].items[0].installments;
    expect(installments).toHaveLength(1);
    expect(installments[0].payments).toHaveLength(2);
    expect(installments[0].payment).toBeUndefined();
  });

  it('round-trips through import without duplicating the installment', async () => {
    const { dossier, agent } = await setup();
    const exported = (await agent.get(`/api/dossiers/${dossier.id}/export`)).body;

    const imported = await agent.post('/api/dossiers/import').send({ ...exported, name: 'Copy' });

    expect(imported.status).toBe(201);
    const counts = db.prepare(
      `SELECT COUNT(DISTINCT inst.id) AS insts, COUNT(p.id) AS pays
         FROM annual_expense_years y
         JOIN annual_expense_year_items i ON i.year_id = y.id
         JOIN annual_expense_year_installments inst ON inst.year_item_id = i.id
         LEFT JOIN annual_expense_payments p ON p.installment_id = inst.id
        WHERE y.dossier_id = ?`
    ).get(imported.body.id);
    expect(counts).toEqual({ insts: 1, pays: 2 });
  });

  it('shows the installment once in the year view, with the payment of the covering cycle', async () => {
    const { dossier, year, jan } = await setup();

    const status = computeYearStatus(year.id, dossier.id);

    const installments = status.items[0].installments;
    expect(installments).toHaveLength(1);
    // Jan 30 falls in both windows; the Jan cycle is found first, and it's the paid one.
    expect(installments[0].payment.cycle_id).toBe(jan.id);
  });
});

describe('mergeExportedInstallments', () => {
  it('folds a pre-v18 duplicated installment back into one with both payments', () => {
    const merged = mergeExportedInstallments([
      { installment_number: 1, month: 1, day: 30, payment: { cycle_year: 2026, cycle_month: 1, paid: true, real_value: 600 } },
      { installment_number: 1, month: 1, day: 30, payment: { cycle_year: 2026, cycle_month: 2, paid: false, real_value: 600 } },
      { installment_number: 2, month: 7, day: 30, payment: null },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].payments.map((p) => p.cycle_month)).toEqual([1, 2]);
    expect(merged[1].payments).toEqual([]);
  });
});

describe('pickInstallmentPayment', () => {
  const base = { actual_start_date: null, actual_end_date: null };
  it('prefers a paid payment, then the earliest cycle, when no cycle covers the date', () => {
    const early = { ...base, id: 'a', paid: 0, cycle_year: 2026, cycle_month: 1 };
    const paid = { ...base, id: 'b', paid: 1, cycle_year: 2026, cycle_month: 3 };
    expect(pickInstallmentPayment([paid, early], new Date(2026, 5, 1)).id).toBe('b');
    expect(pickInstallmentPayment([{ ...paid, paid: 0 }, early], new Date(2026, 5, 1)).id).toBe('a');
  });
});
