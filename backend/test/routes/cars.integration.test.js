const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createCar,
  createCarMonth,
  createCarAdhocExpense,
  createExpenseTemplateItem,
  createAnnualExpenseTemplateItem,
  createExpenseCycle,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('Cars CRUD', () => {
  it('creates, lists, fetches, updates and deletes a car', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const created = await agent
      .post(`/api/dossiers/${dossier.id}/cars`)
      .send({ name: 'Daily Driver', fuel_type: 'gas', initial_mileage_km: 1000, license_plate: 'AB-12-CD' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Daily Driver');
    expect(created.body.linked_monthly_count).toBe(0);

    const list = await agent.get(`/api/dossiers/${dossier.id}/cars`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cars/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.months).toEqual([]);
    expect(detail.body.summary.avg_monthly_cost).toBeNull();

    const updated = await agent.put(`/api/dossiers/${dossier.id}/cars/${created.body.id}`).send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed');

    const deleted = await agent.delete(`/api/dossiers/${dossier.id}/cars/${created.body.id}`);
    expect(deleted.status).toBe(204);
    const afterDelete = await agent.get(`/api/dossiers/${dossier.id}/cars/${created.body.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it("404s for a car belonging to another user's dossier", async () => {
    const owner = createUser(db);
    const dossier = createDossier(db, { creatorId: owner.id });
    const car = createCar(db, { dossierId: dossier.id });

    const stranger = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, stranger);
    const res = await agent.get(`/api/dossiers/${dossier.id}/cars/${car.id}`);
    expect(res.status).toBe(404);
  });

  it("404s for a carId from a different dossier", async () => {
    const user = createUser(db);
    const dossierA = createDossier(db, { creatorId: user.id });
    const dossierB = createDossier(db, { creatorId: user.id });
    const carInB = createCar(db, { dossierId: dossierB.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.get(`/api/dossiers/${dossierA.id}/cars/${carInB.id}`);
    expect(res.status).toBe(404);
  });

  it('deleting a car nulls car_id on both template tables and cascades its snapshots', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const monthlyItem = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', day_of_payment: 5, car_id: car.id });
    const annualItem = createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, car_id: car.id });
    const snapshot = createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 100 });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.delete(`/api/dossiers/${dossier.id}/cars/${car.id}`);
    expect(res.status).toBe(204);

    const reloadedMonthly = db.prepare('SELECT car_id FROM expense_template_items WHERE id = ?').get(monthlyItem.id);
    const reloadedAnnual = db.prepare('SELECT car_id FROM annual_expense_template_items WHERE id = ?').get(annualItem.id);
    expect(reloadedMonthly.car_id).toBeNull();
    expect(reloadedAnnual.car_id).toBeNull();
    expect(db.prepare('SELECT * FROM car_months WHERE id = ?').get(snapshot.id)).toBeUndefined();
  });
});

describe('Car-month snapshot CRUD', () => {
  it('creates a snapshot and rejects a duplicate (car_id, year, month)', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const created = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/months`)
      .send({ year: 2025, month: 3, mileage_km: 500, avg_l_per_100km: 6, cost_per_l: 1.6 });
    expect(created.status).toBe(201);
    expect(created.body.km_driven).toBe(500);

    const duplicate = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/months`)
      .send({ year: 2025, month: 3, mileage_km: 600 });
    expect(duplicate.status).toBe(400);
  });

  it('rejects changing year or month on PUT', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const snapshot = createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 500 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .put(`/api/dossiers/${dossier.id}/cars/${car.id}/months/${snapshot.id}`)
      .send({ year: 2025, month: 4, mileage_km: 600 });
    expect(res.status).toBe(400);
  });

  it('updates and deletes a snapshot', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const snapshot = createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 500 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const updated = await agent
      .put(`/api/dossiers/${dossier.id}/cars/${car.id}/months/${snapshot.id}`)
      .send({ mileage_km: 650 });
    expect(updated.status).toBe(200);
    expect(updated.body.mileage_km).toBe(650);

    const deleted = await agent.delete(`/api/dossiers/${dossier.id}/cars/${car.id}/months/${snapshot.id}`);
    expect(deleted.status).toBe(204);
  });
});

describe('Ad-hoc car expense CRUD', () => {
  it('creates a monthly recurring ad-hoc expense and returns it in the car detail payload', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const created = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses`)
      .send({ name: 'Insurance (wife pays)', value: 45, recurrence: 'monthly' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Insurance (wife pays)');
    expect(created.body.status).toBe('active');
    expect(created.body.year).toBeNull();

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cars/${car.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.adhoc_expenses).toHaveLength(1);
    expect(detail.body.adhoc_expenses[0].name).toBe('Insurance (wife pays)');
  });

  it('creates a one_off ad-hoc expense requiring year/month', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const missingPeriod = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses`)
      .send({ name: 'Road Tax', value: 180, recurrence: 'one_off' });
    expect(missingPeriod.status).toBe(400);

    const created = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses`)
      .send({ name: 'Road Tax', value: 180, recurrence: 'one_off', year: 2026, month: 3 });
    expect(created.status).toBe(201);
    expect(created.body.year).toBe(2026);
    expect(created.body.month).toBe(3);
  });

  it('rejects an invalid recurrence with 400', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses`)
      .send({ name: 'X', value: 10, recurrence: 'weekly' });
    expect(res.status).toBe(400);
  });

  it('updates name/value/status via PATCH, and rejects changing recurrence', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const expense = createCarAdhocExpense(db, { carId: car.id, name: 'Insurance', value: 40, recurrence: 'monthly' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const updated = await agent
      .patch(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses/${expense.id}`)
      .send({ value: 45, status: 'cancelled' });
    expect(updated.status).toBe(200);
    expect(updated.body.value).toBe(45);
    expect(updated.body.status).toBe('cancelled');

    const rejected = await agent
      .patch(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses/${expense.id}`)
      .send({ recurrence: 'one_off' });
    expect(rejected.status).toBe(400);
  });

  it('deletes an ad-hoc expense', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const expense = createCarAdhocExpense(db, { carId: car.id, name: 'Insurance', value: 40, recurrence: 'monthly' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const deleted = await agent.delete(`/api/dossiers/${dossier.id}/cars/${car.id}/adhoc-expenses/${expense.id}`);
    expect(deleted.status).toBe(204);

    const detail = await agent.get(`/api/dossiers/${dossier.id}/cars/${car.id}`);
    expect(detail.body.adhoc_expenses).toEqual([]);
  });

  it('cascades ad-hoc expenses when the car is deleted', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    createCarAdhocExpense(db, { carId: car.id, name: 'Insurance', value: 40, recurrence: 'monthly' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.delete(`/api/dossiers/${dossier.id}/cars/${car.id}`);
    expect(res.status).toBe(204);
    expect(db.prepare('SELECT * FROM car_adhoc_expenses WHERE car_id = ?').all(car.id)).toEqual([]);
  });

  it("404s for an ad-hoc expense belonging to another car", async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const carA = createCar(db, { dossierId: dossier.id });
    const carB = createCar(db, { dossierId: dossier.id });
    const expense = createCarAdhocExpense(db, { carId: carB.id, name: 'Insurance', value: 40, recurrence: 'monthly' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.patch(`/api/dossiers/${dossier.id}/cars/${carA.id}/adhoc-expenses/${expense.id}`).send({ value: 50 });
    expect(res.status).toBe(404);
  });
});

describe('car_id tagging on expense/annual template endpoints', () => {
  it('follows the 3-way contract: absent = no change, null = clear, id = set', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const item = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', day_of_payment: 5 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const setRes = await agent.put(`/api/dossiers/${dossier.id}/expense-template/${item.id}`).send({ car_id: car.id });
    expect(setRes.status).toBe(200);
    expect(setRes.body.car_id).toBe(car.id);

    const unrelatedRes = await agent.put(`/api/dossiers/${dossier.id}/expense-template/${item.id}`).send({ value: 55 });
    expect(unrelatedRes.status).toBe(200);
    expect(unrelatedRes.body.car_id).toBe(car.id); // untouched by an absent key
    expect(unrelatedRes.body.value).toBe(55);

    const clearRes = await agent.put(`/api/dossiers/${dossier.id}/expense-template/${item.id}`).send({ car_id: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.car_id).toBeNull();
  });

  it('rejects tagging a distribution item with a car (400)', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const item = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'distribution' });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.put(`/api/dossiers/${dossier.id}/expense-template/${item.id}`).send({ car_id: car.id });
    expect(res.status).toBe(400);
  });

  it('rejects a car_id referencing another dossier (400)', async () => {
    const user = createUser(db);
    const dossierA = createDossier(db, { creatorId: user.id });
    const dossierB = createDossier(db, { creatorId: user.id });
    const carInB = createCar(db, { dossierId: dossierB.id });
    const item = createExpenseTemplateItem(db, { dossierId: dossierA.id, section: 'expense', type: 'Fixed', day_of_payment: 5 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.put(`/api/dossiers/${dossierA.id}/expense-template/${item.id}`).send({ car_id: carInB.id });
    expect(res.status).toBe(400);
  });

  it('tags an annual expense template item via PUT', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const item = createAnnualExpenseTemplateItem(db, { dossierId: dossier.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.put(`/api/dossiers/${dossier.id}/annual-expense-template/${item.id}`).send({ car_id: car.id });
    expect(res.status).toBe(200);
    expect(res.body.car_id).toBe(car.id);
  });

  it('preserves car_id across expense-template bulk-replace for same-named items, drops it for renamed ones', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', day_of_payment: 5, value: 40, car_id: car.id });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Gym', day_of_payment: 1, value: 20 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/expense-template/bulk-replace`).send({
      section: 'expense',
      items: [
        { name: 'Insurance', type: 'Fixed', value: 45, day_of_payment: 5 }, // same name -> re-tagged
        { name: 'Gym Renamed', type: 'Fixed', value: 20, day_of_payment: 1 }, // renamed -> stays untagged
      ],
    });
    expect(res.status).toBe(200);
    const insurance = res.body.find((i) => i.name === 'Insurance');
    expect(insurance.car_id).toBe(car.id);
    const gym = res.body.find((i) => i.name === 'Gym Renamed');
    expect(gym.car_id).toBeNull();
  });

  it('preserves car_id across annual-expense-template bulk-replace for same-named items', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Road Tax', car_id: car.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post(`/api/dossiers/${dossier.id}/annual-expense-template/bulk-replace`).send({
      items: [{ name: 'Road Tax', value: 130, num_installments: 1, installments: [{ month: 6, day: 1 }] }],
    });
    expect(res.status).toBe(200);
    const item = res.body.find((i) => i.name === 'Road Tax');
    expect(item.car_id).toBe(car.id);
  });

  it('tagging an item with a car leaves the cycle summary and Emergency Fund status unchanged', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id });
    const item = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', day_of_payment: 5, value: 40 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const efBefore = await agent.get(`/api/dossiers/${dossier.id}/emergency-fund/status`);
    expect(efBefore.status).toBe(200);

    const tagRes = await agent.put(`/api/dossiers/${dossier.id}/expense-template/${item.id}`).send({ car_id: car.id });
    expect(tagRes.status).toBe(200);

    const efAfter = await agent.get(`/api/dossiers/${dossier.id}/emergency-fund/status`);
    expect(efAfter.status).toBe(200);
    expect(efAfter.body).toEqual(efBefore.body);
  });
});

describe('End-to-end car cost', () => {
  it('computes total_cost from a paid Fixed item, a Budget item spent amount, and a paid annual installment, plus energy', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 25 });
    const car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 800 });

    const fixedItem = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', day_of_payment: 5, value: 40, car_id: car.id });
    const budgetItem = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Budget', name: 'Maintenance', value: 100, car_id: car.id });

    const { createExpenseCycle: mkCycle, createCycleItem: mkItem, createAnnualExpenseTemplateItem: mkAnnualTmpl, createAnnualExpenseYear: mkYear, createAnnualExpenseYearItem: mkYearItem, createAnnualExpensePayment: mkPayment } = require('../fixtures/builders');

    const cycle = mkCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 }); // Mar25-Apr24, named April
    mkItem(db, { cycleId: cycle.id, template_item_id: fixedItem.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, paid: true });
    mkItem(db, { cycleId: cycle.id, template_item_id: budgetItem.id, section: 'expense', type: 'Budget', name: 'Maintenance', value: 100, spent: 22 });

    mkAnnualTmpl(db, { dossierId: dossier.id, name: 'Road Tax', value: 120, car_id: car.id, installments: [{ month: 4, day: 10 }] });
    const year = mkYear(db, { dossierId: dossier.id, year: 2025 });
    const yearItem = mkYearItem(db, { yearId: year.id, name: 'Road Tax', budgeted_value: 120, from_template: true, installments: [{ month: 4, day: 10 }] });
    mkPayment(db, { installmentId: yearItem.installmentIds[0], cycleId: cycle.id, real_value: 120, paid: true });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent
      .post(`/api/dossiers/${dossier.id}/cars/${car.id}/months`)
      .send({ year: 2025, month: 4, mileage_km: 1000, avg_l_per_100km: 6, cost_per_l: 1.5 });

    expect(res.status).toBe(201);
    const expectedEnergy = (200 / 100) * 6 * 1.5;
    expect(res.body.total_cost).toBeCloseTo(expectedEnergy + 40 + 22 + 120, 5);
    expect(res.body.unknown_count).toBe(0);
  });
});
