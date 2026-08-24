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
} = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('Dossier export/import — cars (v17)', () => {
  it('exports cars with nested months, adhoc_expenses, and car_name on tagged template items', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id, name: 'Daily Driver', fuel_type: 'gas', initial_mileage_km: 500, license_plate: 'AB-12-CD' });
    createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 700, avg_l_per_100km: 6, cost_per_l: 1.6 });
    createCarAdhocExpense(db, { carId: car.id, name: 'Insurance (wife pays)', value: 45, recurrence: 'monthly' });
    createCarAdhocExpense(db, { carId: car.id, name: 'Road Tax', value: 180, recurrence: 'one_off', year: 2025, month: 3 });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', day_of_payment: 5, value: 40, car_id: car.id });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Road Tax', car_id: car.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/export`);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(17);
    expect(res.body.cars).toHaveLength(1);
    expect(res.body.cars[0].name).toBe('Daily Driver');
    expect(res.body.cars[0].months).toHaveLength(1);
    expect(res.body.cars[0].months[0]).toMatchObject({ year: 2025, month: 3, mileage_km: 700 });
    expect(res.body.cars[0].adhoc_expenses).toHaveLength(2);
    expect(res.body.cars[0].adhoc_expenses.find((e) => e.recurrence === 'monthly')).toMatchObject({ name: 'Insurance (wife pays)', value: 45, status: 'active' });
    expect(res.body.cars[0].adhoc_expenses.find((e) => e.recurrence === 'one_off')).toMatchObject({ name: 'Road Tax', value: 180, year: 2025, month: 3 });

    const insurance = res.body.expense_template.find((i) => i.name === 'Insurance');
    expect(insurance.car_name).toBe('Daily Driver');
    const roadTax = res.body.annual_expense_template.find((i) => i.name === 'Road Tax');
    expect(roadTax.car_name).toBe('Daily Driver');
  });

  it('round-trips cars, snapshots, ad-hoc expenses, and both car_id tags by name on re-import', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id, name: 'Daily Driver', fuel_type: 'hybrid', initial_mileage_km: 500 });
    createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 700 });
    createCarAdhocExpense(db, { carId: car.id, name: 'Insurance (wife pays)', value: 45, recurrence: 'monthly' });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', day_of_payment: 5, value: 40, car_id: car.id });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Road Tax', car_id: car.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const exportRes = await agent.get(`/api/dossiers/${dossier.id}/export`);
    expect(exportRes.status).toBe(200);

    const importRes = await agent.post('/api/dossiers/import').send(exportRes.body);
    expect(importRes.status).toBe(201);
    const newDossierId = importRes.body.id;

    const carsRes = await agent.get(`/api/dossiers/${newDossierId}/cars`);
    expect(carsRes.status).toBe(200);
    expect(carsRes.body).toHaveLength(1);
    const newCar = carsRes.body[0];
    expect(newCar.name).toBe('Daily Driver');
    expect(newCar.fuel_type).toBe('hybrid');

    const detailRes = await agent.get(`/api/dossiers/${newDossierId}/cars/${newCar.id}`);
    expect(detailRes.body.months).toHaveLength(1);
    expect(detailRes.body.months[0].mileage_km).toBe(700);
    expect(detailRes.body.adhoc_expenses).toHaveLength(1);
    expect(detailRes.body.adhoc_expenses[0]).toMatchObject({ name: 'Insurance (wife pays)', value: 45, recurrence: 'monthly', status: 'active' });

    const templateRes = await agent.get(`/api/dossiers/${newDossierId}/expense-template`);
    const newInsurance = templateRes.body.find((i) => i.name === 'Insurance');
    expect(newInsurance.car_id).toBe(newCar.id);

    const annualRes = await agent.get(`/api/dossiers/${newDossierId}/annual-expense-template`);
    const newRoadTax = annualRes.body.find((i) => i.name === 'Road Tax');
    expect(newRoadTax.car_id).toBe(newCar.id);
  });

  it('imports a pre-v17 export with cars but no adhoc_expenses field, with zero ad-hoc expenses', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const car = createCar(db, { dossierId: dossier.id, name: 'Daily Driver', fuel_type: 'gas', initial_mileage_km: 500 });
    createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 700 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const exportRes = await agent.get(`/api/dossiers/${dossier.id}/export`);

    // Simulate a v16 export: cars present, but no adhoc_expenses field on each entry.
    const v16Export = { ...exportRes.body, version: 16 };
    v16Export.cars = v16Export.cars.map(({ adhoc_expenses, ...rest }) => rest);

    const importRes = await agent.post('/api/dossiers/import').send(v16Export);
    expect(importRes.status).toBe(201);

    const carsRes = await agent.get(`/api/dossiers/${importRes.body.id}/cars`);
    expect(carsRes.body).toHaveLength(1);
    const detailRes = await agent.get(`/api/dossiers/${importRes.body.id}/cars/${carsRes.body[0].id}`);
    expect(detailRes.body.adhoc_expenses).toEqual([]);
  });

  it('imports a pre-v16 export with zero cars and no errors', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const v15Export = {
      version: 15,
      dossier: { name: 'Legacy Dossier', currency: 'EUR' },
      accounts: [],
      months: [],
      expense_template: [],
      income_template: [],
      annual_expense_template: [],
      workbench_snapshots: [],
      cycles: [],
      goals: [],
      emergency_fund_accounts: [],
      emergency_fund_extra_values: [],
      annual_expense_years: [],
      annual_expense_accounts: [],
      annual_expense_distributions: [],
      loans: [],
      subscriptions: [],
    };

    const importRes = await agent.post('/api/dossiers/import').send(v15Export);
    expect(importRes.status).toBe(201);

    const carsRes = await agent.get(`/api/dossiers/${importRes.body.id}/cars`);
    expect(carsRes.status).toBe(200);
    expect(carsRes.body).toEqual([]);
  });
});
