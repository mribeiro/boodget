const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createExpenseCycle,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
  createAnnualExpenseTemplateItem,
  createCar,
  loginAs,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function setup({ closed = false, paid = false } = {}) {
  const user = createUser(db);
  const dossier = createDossier(db, { creatorId: user.id });
  const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
  if (closed) db.prepare('UPDATE expense_cycles SET is_closed = 1 WHERE id = ?').run(cycle.id);
  const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
  const item = createAnnualExpenseYearItem(db, {
    yearId: year.id, name: 'Insurance', budgeted_value: 600, num_installments: 2,
    installments: [{ month: 1, day: 30 }, { month: 7, day: 30 }],
  });
  const payment = createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: cycle.id, real_value: 300, paid });
  const agent = supertest.agent(buildTestApp());
  await loginAs(agent, user);
  const url = `/api/dossiers/${dossier.id}/annual-expense-payments/${payment.id}`;
  return { dossier, year, item, payment, agent, url };
}

describe('PATCH /annual-expense-payments/:paymentId', () => {
  it('records the real amount paid, alone or together with paid', async () => {
    const { agent, url, payment, dossier, year } = await setup();

    const both = await agent.patch(url).send({ paid: true, real_value: 312.4 });
    expect(both.status).toBe(200);
    expect(both.body).toMatchObject({ paid: true, real_value: 312.4 });

    const alone = await agent.patch(url).send({ real_value: '287.5' });
    expect(alone.status).toBe(200);
    expect(db.prepare('SELECT paid, real_value FROM annual_expense_payments WHERE id = ?').get(payment.id)).toEqual({ paid: 1, real_value: 287.5 });

    // The year's "paid" total now reflects the real amount, not the 300 € estimate.
    const status = await agent.get(`/api/dossiers/${dossier.id}/annual-years/${year.id}`);
    expect(status.body.items[0].total_paid).toBe(287.5);
  });

  it('rejects a negative or non-numeric real_value, and an empty body', async () => {
    const { agent, url } = await setup();
    expect((await agent.patch(url).send({ real_value: -1 })).status).toBe(400);
    expect((await agent.patch(url).send({ real_value: 'abc' })).status).toBe(400);
    expect((await agent.patch(url).send({ real_value: null })).status).toBe(400);
    expect((await agent.patch(url).send({})).status).toBe(400);
  });

  it('returns 409 on a closed cycle', async () => {
    const { agent, url, payment } = await setup({ closed: true });
    expect((await agent.patch(url).send({ real_value: 10 })).status).toBe(409);
    expect(db.prepare('SELECT real_value FROM annual_expense_payments WHERE id = ?').get(payment.id).real_value).toBe(300);
  });
});

describe('PATCH /annual-years/:yearId/items/:itemId (estimate refresh)', () => {
  it('refreshes the estimate on unpaid payments when the budgeted value changes', async () => {
    const { agent, dossier, year, item, payment } = await setup();

    const res = await agent.patch(`/api/dossiers/${dossier.id}/annual-years/${year.id}/items/${item.id}`).send({ budgeted_value: 800 });

    expect(res.status).toBe(200);
    expect(db.prepare('SELECT real_value FROM annual_expense_payments WHERE id = ?').get(payment.id).real_value).toBe(400);
  });

  it('leaves the real amount of paid payments untouched', async () => {
    const { agent, dossier, year, item, payment } = await setup({ paid: true });

    await agent.patch(`/api/dossiers/${dossier.id}/annual-years/${year.id}/items/${item.id}`).send({ budgeted_value: 800 });

    expect(db.prepare('SELECT real_value FROM annual_expense_payments WHERE id = ?').get(payment.id).real_value).toBe(300);
  });
});

describe('POST /annual-years/:yearId/sync-to-template', () => {
  it('keeps the car tag of a same-name template item', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id, name: 'Daily Driver' });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Car insurance', value: 600, car_id: car.id });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Property tax', value: 300, position: 1 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Car insurance', budgeted_value: 650 });
    createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Property tax', budgeted_value: 300, position: 1 });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/annual-years/${year.id}/sync-to-template`);

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.map((i) => [i.name, i]));
    expect(byName['Car insurance']).toMatchObject({ value: 650, car_id: car.id });
    expect(byName['Property tax'].car_id).toBeNull();
  });
});

describe('PATCH /annual-years/:yearId/items/:itemId (installment date edits vs. recorded payments)', () => {
  // Jan cycle (stored month 1, day 25) runs Jan 25 – Feb 24; Feb cycle runs Feb 25 – Mar 24.
  async function setup({ janClosed = false, febClosed = false, paid = false } = {}) {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const jan = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 1 });
    const feb = createExpenseCycle(db, { dossierId: dossier.id, year: 2026, month: 2 });
    if (janClosed) db.prepare('UPDATE expense_cycles SET is_closed = 1 WHERE id = ?').run(jan.id);
    if (febClosed) db.prepare('UPDATE expense_cycles SET is_closed = 1 WHERE id = ?').run(feb.id);
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const item = createAnnualExpenseYearItem(db, {
      yearId: year.id, name: 'Insurance', budgeted_value: 600, num_installments: 2,
      installments: [{ month: 1, day: 30 }, { month: 7, day: 30 }],
    });
    const payment = createAnnualExpensePayment(db, { installmentId: item.installmentIds[0], cycleId: jan.id, real_value: 300, paid });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, user);
    const url = `/api/dossiers/${dossier.id}/annual-years/${year.id}/items/${item.id}`;
    const paymentRow = () => db.prepare('SELECT * FROM annual_expense_payments WHERE id = ?').get(payment.id);
    return { jan, feb, url, agent, paymentRow };
  }
  const moveFirstTo = (month, day) => ({ installments: [{ installment_number: 1, month, day }, { installment_number: 2, month: 7, day: 30 }] });

  it('still moves an unpaid payment between open cycles', async () => {
    const { feb, url, agent, paymentRow } = await setup();
    const res = await agent.patch(url).send(moveFirstTo(3, 1));
    expect(res.status).toBe(200);
    expect(res.body.payments_kept_in_place).toBe(0);
    expect(paymentRow().cycle_id).toBe(feb.id);
  });

  it('leaves a paid payment in its cycle', async () => {
    const { jan, url, agent, paymentRow } = await setup({ paid: true });
    const res = await agent.patch(url).send(moveFirstTo(3, 1));
    expect(res.body.payments_kept_in_place).toBe(1);
    expect(paymentRow().cycle_id).toBe(jan.id);
  });

  it('never moves a payment out of a closed cycle', async () => {
    const { jan, url, agent, paymentRow } = await setup({ janClosed: true });
    const res = await agent.patch(url).send(moveFirstTo(3, 1));
    expect(res.body.payments_kept_in_place).toBe(1);
    expect(paymentRow().cycle_id).toBe(jan.id);
  });

  it('never moves a payment into a closed cycle', async () => {
    const { jan, url, agent, paymentRow } = await setup({ febClosed: true });
    const res = await agent.patch(url).send(moveFirstTo(3, 1));
    expect(res.body.payments_kept_in_place).toBe(1);
    expect(paymentRow().cycle_id).toBe(jan.id);
  });

  it('never deletes a paid payment when no cycle covers the new date', async () => {
    const { url, agent, paymentRow } = await setup({ paid: true });
    await agent.patch(url).send(moveFirstTo(11, 15));
    expect(paymentRow()).toBeTruthy();
  });

  it('still drops an unpaid placeholder when no cycle covers the new date', async () => {
    const { url, agent, paymentRow } = await setup();
    await agent.patch(url).send(moveFirstTo(11, 15));
    expect(paymentRow()).toBeUndefined();
  });

  it('refuses to remove an installment holding a paid payment', async () => {
    const { url, agent, paymentRow } = await setup({ paid: true });
    const res = await agent.patch(url).send({ num_installments: 1, installments: [{ installment_number: 2, month: 7, day: 30 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Installment 1 can't be removed/);
    expect(paymentRow()).toBeTruthy();
  });
});
