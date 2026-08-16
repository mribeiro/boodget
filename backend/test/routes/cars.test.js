const { db } = require('../../src/db');
const {
  findCycleForCalendarMonth,
  buildCarCostContext,
  computeCarMonthValues,
  summarizeCarMonths,
  validateCarFields,
  validateCarMonthFields,
} = require('../../src/routes/cars');
const {
  createUser,
  createDossier,
  createCar,
  createCarMonth,
  createExpenseTemplateItem,
  createExpenseCycle,
  createCycleItem,
  createAnnualExpenseTemplateItem,
  createAnnualExpenseYear,
  createAnnualExpenseYearItem,
  createAnnualExpensePayment,
} = require('../fixtures/builders');

describe('findCycleForCalendarMonth', () => {
  function cycle({ id, endYear, endMonth, endDay = 24 }) {
    return { id, end: new Date(endYear, endMonth - 1, endDay) };
  }

  it('resolves a cycle_start_day=25 cycle stored as month 3 to calendar month 4, not 3', () => {
    const cycles = [cycle({ id: 'c1', endYear: 2025, endMonth: 4, endDay: 24 })];
    expect(findCycleForCalendarMonth(cycles, 2025, 4)?.id).toBe('c1');
    expect(findCycleForCalendarMonth(cycles, 2025, 3)).toBeNull();
  });

  it('resolves a cycle_start_day=1 cycle stored as month 3 to calendar month 3', () => {
    const cycles = [cycle({ id: 'c1', endYear: 2025, endMonth: 3, endDay: 31 })];
    expect(findCycleForCalendarMonth(cycles, 2025, 3)?.id).toBe('c1');
  });

  it('returns null when no cycle ends in the requested month', () => {
    const cycles = [cycle({ id: 'c1', endYear: 2025, endMonth: 4 })];
    expect(findCycleForCalendarMonth(cycles, 2025, 5)).toBeNull();
  });

  it('picks the later-ending cycle when two cycles end in the same month (resolve_overlap: ignore)', () => {
    const cycles = [
      cycle({ id: 'earlier', endYear: 2025, endMonth: 4, endDay: 10 }),
      cycle({ id: 'later', endYear: 2025, endMonth: 4, endDay: 24 }),
    ];
    expect(findCycleForCalendarMonth(cycles, 2025, 4)?.id).toBe('later');
  });
});

describe('summarizeCarMonths', () => {
  function month(year, month_, overrides = {}) {
    return {
      year,
      month: month_,
      km_driven: 0,
      energy_cost: 0,
      monthly_expenses_total: 0,
      annual_expenses_total: 0,
      total_cost: 0,
      unknown_count: 0,
      ...overrides,
    };
  }

  it('groups months by year and sums each field', () => {
    const months = [
      month(2024, 11, { total_cost: 100 }),
      month(2024, 12, { total_cost: 150 }),
      month(2025, 1, { total_cost: 200 }),
    ];
    const summary = summarizeCarMonths(months, new Date(2025, 0, 15));
    const y2024 = summary.per_year.find((y) => y.year === 2024);
    const y2025 = summary.per_year.find((y) => y.year === 2025);
    expect(y2024.total_cost).toBe(250);
    expect(y2024.snapshot_count).toBe(2);
    expect(y2025.total_cost).toBe(200);
  });

  it('computes ytd against the current year only', () => {
    const months = [month(2024, 12, { total_cost: 999 }), month(2025, 1, { total_cost: 50 }), month(2025, 2, { total_cost: 60 })];
    const summary = summarizeCarMonths(months, new Date(2025, 1, 15));
    expect(summary.ytd.total_cost).toBe(110);
    expect(summary.ytd.snapshot_count).toBe(2);
  });

  it('computes last_12_months as an inclusive rolling window and avg_monthly_cost', () => {
    const months = [
      month(2024, 1, { total_cost: 1000 }), // outside the window
      month(2024, 3, { total_cost: 90 }),
      month(2024, 6, { total_cost: 60 }),
      month(2025, 2, { total_cost: 150 }),
    ];
    const summary = summarizeCarMonths(months, new Date(2025, 1, 15)); // Feb 2025 "now"
    expect(summary.last_12_months.snapshot_count).toBe(3);
    expect(summary.last_12_months.total_cost).toBe(300);
    expect(summary.avg_monthly_cost).toBeCloseTo(100, 5);
  });

  it('returns avg_monthly_cost null when there are no snapshots in the last 12 months', () => {
    const summary = summarizeCarMonths([], new Date(2025, 1, 15));
    expect(summary.avg_monthly_cost).toBeNull();
    expect(summary.per_year).toEqual([]);
  });
});

describe('validateCarFields', () => {
  it('requires a name', () => {
    expect(validateCarFields({ fuel_type: 'gas', initial_mileage_km: 0 }, null).error).toMatch(/name/);
  });

  it('requires a valid fuel_type', () => {
    expect(validateCarFields({ name: 'X', fuel_type: 'diesel', initial_mileage_km: 0 }, null).error).toMatch(/fuel_type/);
  });

  it('requires a non-negative initial_mileage_km on create', () => {
    expect(validateCarFields({ name: 'X', fuel_type: 'gas' }, null).error).toMatch(/initial_mileage_km/);
    expect(validateCarFields({ name: 'X', fuel_type: 'gas', initial_mileage_km: -1 }, null).error).toMatch(/initial_mileage_km/);
  });

  it('carries forward existing values when fields are omitted on update', () => {
    const existing = { name: 'Car', fuel_type: 'gas', initial_mileage_km: 500, license_plate: 'AB-12-CD', make: 'X', model: 'Y' };
    const result = validateCarFields({ name: 'New Name' }, existing);
    expect(result.fuel_type).toBe('gas');
    expect(result.initial_mileage_km).toBe(500);
    expect(result.license_plate).toBe('AB-12-CD');
  });

  it('allows changing fuel_type on an existing car without touching other fields', () => {
    const existing = { name: 'Car', fuel_type: 'gas', initial_mileage_km: 500 };
    const result = validateCarFields({ fuel_type: 'hybrid' }, existing);
    expect(result.fuel_type).toBe('hybrid');
  });

  it('normalizes empty optional strings to null', () => {
    const result = validateCarFields({ name: 'X', fuel_type: 'gas', initial_mileage_km: 0, license_plate: '  ' }, null);
    expect(result.license_plate).toBeNull();
  });
});

describe('validateCarMonthFields', () => {
  let dossier, car;
  beforeEach(() => {
    const user = createUser(db);
    dossier = createDossier(db, { creatorId: user.id });
    car = createCar(db, { dossierId: dossier.id });
  });

  it('requires year and month on create', () => {
    expect(validateCarMonthFields({ mileage_km: 100 }, null, car.id).error).toMatch(/year/);
    expect(validateCarMonthFields({ year: 2025, mileage_km: 100 }, null, car.id).error).toMatch(/month/);
  });

  it('rejects a duplicate (car_id, year, month)', () => {
    createCarMonth(db, { carId: car.id, year: 2025, month: 3, mileage_km: 100 });
    const result = validateCarMonthFields({ year: 2025, month: 3, mileage_km: 200 }, null, car.id);
    expect(result.error).toMatch(/already exists/);
  });

  it('requires a non-negative mileage_km', () => {
    expect(validateCarMonthFields({ year: 2025, month: 3 }, null, car.id).error).toMatch(/mileage_km/);
    expect(validateCarMonthFields({ year: 2025, month: 3, mileage_km: -5 }, null, car.id).error).toMatch(/mileage_km/);
  });

  it('rejects changing year or month on an existing snapshot', () => {
    const existing = { year: 2025, month: 3, mileage_km: 100 };
    expect(validateCarMonthFields({ year: 2025, month: 4, mileage_km: 100 }, existing, car.id).error).toMatch(/month cannot be changed/);
    expect(validateCarMonthFields({ year: 2026, month: 3, mileage_km: 100 }, existing, car.id).error).toMatch(/year cannot be changed/);
  });

  it('accepts optional averages as null or a non-negative number', () => {
    const result = validateCarMonthFields(
      { year: 2025, month: 3, mileage_km: 100, avg_l_per_100km: 6.5, cost_per_l: 1.7 },
      null,
      car.id
    );
    expect(result.avg_l_per_100km).toBe(6.5);
    expect(result.avg_kwh_per_100km).toBeNull();
  });

  it('rejects a negative average', () => {
    const result = validateCarMonthFields({ year: 2025, month: 3, mileage_km: 100, avg_l_per_100km: -1 }, null, car.id);
    expect(result.error).toMatch(/avg_l_per_100km/);
  });
});

describe('computeCarMonthValues', () => {
  let dossier, car, ctx;

  beforeEach(() => {
    const user = createUser(db);
    dossier = createDossier(db, { creatorId: user.id, cycle_start_day: 25 });
  });

  function snapshot(overrides) {
    return { year: 2025, month: 4, mileage_km: 1000, avg_l_per_100km: null, avg_kwh_per_100km: null, cost_per_l: null, cost_per_kwh: null, ...overrides };
  }

  it('computes fuel_cost only for a gas car, electric_cost 0', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 800 });
    ctx = buildCarCostContext(dossier.id);
    const values = computeCarMonthValues(car, snapshot({ mileage_km: 1000, avg_l_per_100km: 6, cost_per_l: 1.5 }), null, ctx);
    expect(values.km_driven).toBe(200);
    expect(values.fuel_cost).toBeCloseTo((200 / 100) * 6 * 1.5, 5);
    expect(values.electric_cost).toBe(0);
    expect(values.energy_cost).toBe(values.fuel_cost);
  });

  it('computes electric_cost only for an electric car, fuel_cost 0', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'electric', initial_mileage_km: 800 });
    ctx = buildCarCostContext(dossier.id);
    const values = computeCarMonthValues(car, snapshot({ mileage_km: 1000, avg_kwh_per_100km: 17, cost_per_kwh: 0.2 }), null, ctx);
    expect(values.fuel_cost).toBe(0);
    expect(values.electric_cost).toBeCloseTo((200 / 100) * 17 * 0.2, 5);
  });

  it('sums both legs for a hybrid car', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'hybrid', initial_mileage_km: 800 });
    ctx = buildCarCostContext(dossier.id);
    const values = computeCarMonthValues(
      car,
      snapshot({ mileage_km: 1000, avg_l_per_100km: 4, cost_per_l: 1.6, avg_kwh_per_100km: 10, cost_per_kwh: 0.2 }),
      null,
      ctx
    );
    expect(values.fuel_cost).toBeCloseTo((200 / 100) * 4 * 1.6, 5);
    expect(values.electric_cost).toBeCloseTo((200 / 100) * 10 * 0.2, 5);
    expect(values.energy_cost).toBeCloseTo(values.fuel_cost + values.electric_cost, 5);
  });

  it('uses car.initial_mileage_km as the baseline when there is no previous snapshot', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 500 });
    ctx = buildCarCostContext(dossier.id);
    const values = computeCarMonthValues(car, snapshot({ mileage_km: 700 }), null, ctx);
    expect(values.baseline_mileage_km).toBe(500);
    expect(values.baseline_source).toBe('car_initial');
    expect(values.km_driven).toBe(200);
  });

  it('uses the previous snapshot mileage as the baseline, spanning a gap of untracked months', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    ctx = buildCarCostContext(dossier.id);
    const prev = { year: 2025, month: 1, mileage_km: 900 };
    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 1300 }), prev, ctx);
    expect(values.baseline_mileage_km).toBe(900);
    expect(values.baseline_source).toBe('previous_snapshot');
    expect(values.km_driven).toBe(400);
  });

  it('clamps a negative odometer delta to 0 and flags mileage_anomaly', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 1000 });
    ctx = buildCarCostContext(dossier.id);
    const values = computeCarMonthValues(car, snapshot({ mileage_km: 900 }), null, ctx);
    expect(values.km_driven).toBe(0);
    expect(values.mileage_anomaly).toBe(true);
    expect(values.total_cost).toBeGreaterThanOrEqual(0);
  });

  it('marks energy_incomplete and treats it as 0 in the total when averages are missing', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 800 });
    ctx = buildCarCostContext(dossier.id);
    const values = computeCarMonthValues(car, snapshot({ mileage_km: 1000 }), null, ctx);
    expect(values.fuel_cost).toBeNull();
    expect(values.energy_incomplete).toBe(true);
    expect(values.energy_cost).toBe(0);
    expect(values.unknown_count).toBeGreaterThanOrEqual(1);
  });

  it('marks every linked item unknown when there is no cycle for the calendar month', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, day_of_payment: 5, car_id: car.id });
    ctx = buildCarCostContext(dossier.id); // no cycles created
    const values = computeCarMonthValues(car, snapshot({}), null, ctx);
    expect(values.cycle).toBeNull();
    expect(values.monthly_expenses[0].amount).toBeNull();
    expect(values.monthly_expenses[0].status).toBe('no_cycle');
    expect(values.monthly_expenses_total).toBe(0);
    expect(values.unknown_count).toBeGreaterThanOrEqual(1);
  });

  it('resolves a Fixed item via template_item_id and reports paid ? value : 0', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, day_of_payment: 5, car_id: car.id });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 }); // ends April 24
    createCycleItem(db, { cycleId: cycle.id, template_item_id: tmpl.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, paid: true });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 100 }), null, ctx);
    expect(values.cycle.id).toBe(cycle.id);
    expect(values.monthly_expenses[0].amount).toBe(40);
    expect(values.monthly_expenses[0].status).toBe('paid');
    expect(values.monthly_expenses[0].matched_by).toBe('id');
    expect(values.monthly_expenses_total).toBe(40);
  });

  it('reports 0 (not null) for an unpaid Fixed item — a real, known non-payment', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, day_of_payment: 5, car_id: car.id });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 });
    createCycleItem(db, { cycleId: cycle.id, template_item_id: tmpl.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, paid: false });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 100 }), null, ctx);
    expect(values.monthly_expenses[0].amount).toBe(0);
    expect(values.monthly_expenses[0].status).toBe('unpaid');
  });

  it('reports a Budget item spent amount, defaulting to 0 when null', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Budget', name: 'Maintenance', value: 100, car_id: car.id });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 });
    createCycleItem(db, { cycleId: cycle.id, template_item_id: tmpl.id, section: 'expense', type: 'Budget', name: 'Maintenance', value: 100, spent: 35 });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 100 }), null, ctx);
    expect(values.monthly_expenses[0].amount).toBe(35);
    expect(values.monthly_expenses[0].status).toBe('spent');
  });

  it('falls back to matching by name when template_item_id is orphaned (bulk-replace)', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, day_of_payment: 5, car_id: car.id });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 });
    // Orphaned template_item_id, but name still matches — the bulk-replace re-link fallback.
    createCycleItem(db, { cycleId: cycle.id, template_item_id: 'deleted-id', section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, paid: true });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 100 }), null, ctx);
    expect(values.monthly_expenses[0].matched_by).toBe('name');
    expect(values.monthly_expenses[0].amount).toBe(40);
  });

  it('reports no_cycle_item when a cycle exists but nothing matches by id or name', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, day_of_payment: 5, car_id: car.id });
    createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 100 }), null, ctx);
    expect(values.monthly_expenses[0].amount).toBeNull();
    expect(values.monthly_expenses[0].status).toBe('no_cycle_item');
  });

  it('sums only the paid annual installment for the resolved cycle, treating unpaid as a real 0', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Road Tax', value: 120, car_id: car.id, installments: [{ month: 4, day: 10 }] });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 }); // Mar25-Apr24
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2025 });
    const yearItem = createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Road Tax', budgeted_value: 120, from_template: true, installments: [{ month: 4, day: 10 }] });
    createAnnualExpensePayment(db, { installmentId: yearItem.installmentIds[0], cycleId: cycle.id, real_value: 120, paid: true });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 100 }), null, ctx);
    expect(values.annual_expenses[0].amount).toBe(120);
    expect(values.annual_expenses[0].status).toBe('paid');
    expect(values.annual_expenses_total).toBe(120);
  });

  it('reports none_due (a real 0) when the annual installment for this cycle is unpaid', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Road Tax', value: 120, car_id: car.id, installments: [{ month: 4, day: 10 }] });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2025 });
    const yearItem = createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Road Tax', budgeted_value: 120, from_template: true, installments: [{ month: 4, day: 10 }] });
    createAnnualExpensePayment(db, { installmentId: yearItem.installmentIds[0], cycleId: cycle.id, real_value: 120, paid: false });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(
      car,
      snapshot({ year: 2025, month: 4, mileage_km: 100, avg_l_per_100km: 6, cost_per_l: 1.5 }),
      null,
      ctx
    );
    expect(values.annual_expenses[0].amount).toBe(0);
    expect(values.annual_expenses[0].status).toBe('none_due');
    expect(values.unknown_count).toBe(0); // a real 0, not unknown
  });

  it('searches both calendar years an installment cycle straddles (Dec/Jan)', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 0 });
    createAnnualExpenseTemplateItem(db, { dossierId: dossier.id, name: 'Road Tax', value: 120, car_id: car.id, installments: [{ month: 1, day: 3 }] });
    // cycle_start_day 25, stored (2025, 12) -> Dec 25 2025 - Jan 24 2026, named "January 2026"
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 12, cycle_start_day: 25 });
    const year = createAnnualExpenseYear(db, { dossierId: dossier.id, year: 2026 });
    const yearItem = createAnnualExpenseYearItem(db, { yearId: year.id, name: 'Road Tax', budgeted_value: 120, from_template: true, installments: [{ month: 1, day: 3 }] });
    createAnnualExpensePayment(db, { installmentId: yearItem.installmentIds[0], cycleId: cycle.id, real_value: 120, paid: true });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2026, month: 1, mileage_km: 100 }), null, ctx);
    expect(values.cycle.id).toBe(cycle.id);
    expect(values.annual_expenses[0].amount).toBe(120);
  });

  it('computes total_cost as energy + monthly + annual, and unknown_count across all three legs', () => {
    car = createCar(db, { dossierId: dossier.id, fuel_type: 'gas', initial_mileage_km: 800 });
    const tmpl = createExpenseTemplateItem(db, { dossierId: dossier.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, day_of_payment: 5, car_id: car.id });
    const cycle = createExpenseCycle(db, { dossierId: dossier.id, year: 2025, month: 3, cycle_start_day: 25 });
    createCycleItem(db, { cycleId: cycle.id, template_item_id: tmpl.id, section: 'expense', type: 'Fixed', name: 'Insurance', value: 40, paid: true });
    ctx = buildCarCostContext(dossier.id);

    const values = computeCarMonthValues(car, snapshot({ year: 2025, month: 4, mileage_km: 1000, avg_l_per_100km: 6, cost_per_l: 1.5 }), null, ctx);
    expect(values.total_cost).toBeCloseTo(values.energy_cost + 40, 5);
    expect(values.unknown_count).toBe(0);
  });
});
