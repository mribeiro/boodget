const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { fromIsoDate } = require('../utils/cycleDates');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// ── Cycle-window resolution ─────────────────────────────────────────────────
// A third inline copy of the "load every cycle, reconstruct actual_start/end, scan in
// memory" idiom Loans (payment-status) and Annual Expenses (createAnnualPaymentsForCycle)
// each already carry independently. Not extracted into utils/cycleDates.js, which is
// deliberately DB-free — see migration 042's comment on why a DB-reading helper doesn't
// belong there. A future unification across all three copies is tracked as a separate
// tech-debt issue.
function buildCarCostContext(dossierId) {
  const cycles = db
    .prepare(
      `SELECT id, year, month, is_closed, cycle_start_day, actual_start_date, actual_end_date
       FROM expense_cycles WHERE dossier_id = ? ORDER BY year, month`
    )
    .all(dossierId)
    .map((c) => ({
      ...c,
      start: c.actual_start_date
        ? fromIsoDate(c.actual_start_date)
        : new Date(c.year, c.month - 1, c.cycle_start_day ?? 25),
      end: c.actual_end_date
        ? fromIsoDate(c.actual_end_date)
        : new Date(c.year, c.month, (c.cycle_start_day ?? 25) - 1),
    }));
  return { dossierId, cycles };
}

// A cycle is named after the month it ends in (existing business rule), so "the cycle
// representing calendar month M" is the cycle whose actual_end_date falls in M. Two cycles
// can end in the same month only after a PATCH /cycles { resolve_overlap: 'ignore' } —
// the later-ending one is the one that actually closes the month out.
function findCycleForCalendarMonth(cycles, year, month) {
  const matches = cycles.filter((c) => c.end.getFullYear() === year && c.end.getMonth() + 1 === month);
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.end > a.end ? b : a));
}

// ── Cost computation ────────────────────────────────────────────────────────
// Given a snapshot + the previous one (for the mileage baseline) + a cost context, returns
// the derived figures for that month. Never mutates/persists — merged onto the row by the
// route handler, the same computeLoanValues contract.
function computeCarMonthValues(car, snapshot, prevSnapshot, ctx) {
  const baselineMileage = prevSnapshot ? prevSnapshot.mileage_km : car.initial_mileage_km;
  const baselineSource = prevSnapshot ? 'previous_snapshot' : 'car_initial';
  const rawDelta = snapshot.mileage_km - baselineMileage;
  const mileageAnomaly = rawDelta < 0;
  const kmDriven = Math.max(0, rawDelta);

  const fuelApplies = car.fuel_type === 'gas' || car.fuel_type === 'hybrid';
  const elecApplies = car.fuel_type === 'electric' || car.fuel_type === 'hybrid';

  // null = the user hasn't entered these inputs yet; 0 = doesn't apply to this fuel type.
  let fuelCost = 0;
  if (fuelApplies) {
    fuelCost =
      snapshot.avg_l_per_100km == null || snapshot.cost_per_l == null
        ? null
        : (kmDriven / 100) * snapshot.avg_l_per_100km * snapshot.cost_per_l;
  }
  let electricCost = 0;
  if (elecApplies) {
    electricCost =
      snapshot.avg_kwh_per_100km == null || snapshot.cost_per_kwh == null
        ? null
        : (kmDriven / 100) * snapshot.avg_kwh_per_100km * snapshot.cost_per_kwh;
  }
  const energyIncomplete = fuelCost === null || electricCost === null;
  const energyCost = (fuelCost ?? 0) + (electricCost ?? 0);

  const cycle = findCycleForCalendarMonth(ctx.cycles, snapshot.year, snapshot.month);

  // Monthly items (Fixed/Budget) tagged to this car. Without a cycle for this calendar
  // month, nothing about it has been budgeted yet — every linked item is genuinely
  // unknowable, not zero.
  const monthlyItems = db
    .prepare(
      "SELECT id, name, type FROM expense_template_items WHERE dossier_id = ? AND car_id = ? AND section = 'expense' ORDER BY position"
    )
    .all(ctx.dossierId, car.id);

  const monthlyBreakdown = [];
  let monthlyTotal = 0;
  let monthlyUnknownCount = 0;
  for (const item of monthlyItems) {
    if (!cycle) {
      monthlyBreakdown.push({
        template_item_id: item.id,
        name: item.name,
        type: item.type,
        amount: null,
        status: 'no_cycle',
        matched_by: null,
        cycle_item_id: null,
      });
      monthlyUnknownCount++;
      continue;
    }
    let ci = db
      .prepare('SELECT id, type, value, paid, spent FROM cycle_items WHERE cycle_id = ? AND template_item_id = ? LIMIT 1')
      .get(cycle.id, item.id);
    let matchedBy = ci ? 'id' : null;
    if (!ci) {
      // expense-template bulk-replace reinserts every item with a fresh UUID, orphaning
      // surviving cycle_items.template_item_id values — same name fallback Loans'
      // payment-status uses for the identical reason.
      ci = db
        .prepare("SELECT id, type, value, paid, spent FROM cycle_items WHERE cycle_id = ? AND section = 'expense' AND name = ? LIMIT 1")
        .get(cycle.id, item.name);
      if (ci) matchedBy = 'name';
    }
    if (!ci) {
      monthlyBreakdown.push({
        template_item_id: item.id,
        name: item.name,
        type: item.type,
        amount: null,
        status: 'no_cycle_item',
        matched_by: null,
        cycle_item_id: null,
      });
      monthlyUnknownCount++;
      continue;
    }
    const amount = ci.type === 'Fixed' ? (ci.paid ? ci.value : 0) : ci.spent ?? 0;
    const status = ci.type === 'Fixed' ? (ci.paid ? 'paid' : 'unpaid') : 'spent';
    monthlyBreakdown.push({
      template_item_id: item.id,
      name: item.name,
      type: item.type,
      amount,
      status,
      matched_by: matchedBy,
      cycle_item_id: ci.id,
    });
    monthlyTotal += amount;
  }

  // Annual items tagged to this car. Resolved to their per-year instance by name (the same
  // match mergeYearFromTemplate already uses), then summed from the actual paid payments
  // landing in this cycle. Within a resolved cycle, "nothing paid" is a real 0 — annual
  // items aren't expected every month, so no installment being due this period is a fact,
  // not a data gap. Only the absence of a cycle at all is genuinely unknown.
  const annualItems = db
    .prepare('SELECT id, name FROM annual_expense_template_items WHERE dossier_id = ? AND car_id = ? ORDER BY position')
    .all(ctx.dossierId, car.id);

  const annualBreakdown = [];
  let annualTotal = 0;
  let annualUnknownCount = 0;
  for (const item of annualItems) {
    if (!cycle) {
      annualBreakdown.push({ template_item_id: item.id, name: item.name, amount: null, status: 'no_cycle' });
      annualUnknownCount++;
      continue;
    }
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(p.real_value), 0) as total
         FROM annual_expense_payments p
         JOIN annual_expense_year_installments ins ON ins.id = p.installment_id
         JOIN annual_expense_year_items ayi ON ayi.id = ins.year_item_id
         JOIN annual_expense_years ay ON ay.id = ayi.year_id
         WHERE ay.dossier_id = ? AND ayi.name = ? AND ayi.from_template = 1
           AND p.cycle_id = ? AND p.paid = 1`
      )
      .get(ctx.dossierId, item.name, cycle.id);
    const amount = row.total || 0;
    annualBreakdown.push({
      template_item_id: item.id,
      name: item.name,
      amount,
      status: amount > 0 ? 'paid' : 'none_due',
    });
    annualTotal += amount;
  }

  const totalCost = energyCost + monthlyTotal + annualTotal;
  const unknownCount = monthlyUnknownCount + (energyIncomplete ? 1 : 0) + annualUnknownCount;

  return {
    km_driven: kmDriven,
    baseline_mileage_km: baselineMileage,
    baseline_source: baselineSource,
    mileage_anomaly: mileageAnomaly,
    fuel_cost: fuelCost,
    electric_cost: electricCost,
    energy_cost: energyCost,
    energy_incomplete: energyIncomplete,
    cycle: cycle ? { id: cycle.id, year: cycle.year, month: cycle.month, is_closed: !!cycle.is_closed } : null,
    monthly_expenses: monthlyBreakdown,
    monthly_expenses_total: monthlyTotal,
    monthly_expenses_unknown_count: monthlyUnknownCount,
    annual_expenses: annualBreakdown,
    annual_expenses_total: annualTotal,
    total_cost: totalCost,
    unknown_count: unknownCount,
  };
}

// Pure grouping — no DB. Input is an array of car_months rows already merged with their
// computeCarMonthValues output, oldest first.
function summarizeGroup(months, year) {
  const base = {
    year,
    km_driven: 0,
    energy_cost: 0,
    monthly_expenses_total: 0,
    annual_expenses_total: 0,
    total_cost: 0,
    snapshot_count: 0,
    unknown_count: 0,
  };
  for (const m of months) {
    base.km_driven += m.km_driven;
    base.energy_cost += m.energy_cost;
    base.monthly_expenses_total += m.monthly_expenses_total;
    base.annual_expenses_total += m.annual_expenses_total;
    base.total_cost += m.total_cost;
    base.snapshot_count += 1;
    base.unknown_count += m.unknown_count;
  }
  return base;
}

function summarizeCarMonths(monthsWithValues, now = new Date()) {
  const perYearMap = new Map();
  for (const m of monthsWithValues) {
    if (!perYearMap.has(m.year)) perYearMap.set(m.year, []);
    perYearMap.get(m.year).push(m);
  }
  const perYear = [...perYearMap.entries()]
    .map(([year, months]) => summarizeGroup(months, year))
    .sort((a, b) => b.year - a.year);

  const currentYear = now.getFullYear();
  const ytd = summarizeGroup(
    monthsWithValues.filter((m) => m.year === currentYear),
    currentYear
  );

  const nowIdx = now.getFullYear() * 12 + (now.getMonth() + 1);
  const cutoffIdx = nowIdx - 11;
  const last12Months = monthsWithValues.filter((m) => {
    const idx = m.year * 12 + m.month;
    return idx >= cutoffIdx && idx <= nowIdx;
  });
  const last12 = summarizeGroup(last12Months, null);
  const avgMonthlyCost = last12Months.length > 0 ? last12.total_cost / last12Months.length : null;

  return { per_year: perYear, ytd, last_12_months: last12, avg_monthly_cost: avgMonthlyCost };
}

// ── Validation ───────────────────────────────────────────────────────────────
function validateCarFields(body, existing) {
  const name = body.name !== undefined ? String(body.name).trim() : existing?.name;
  if (!name) return { error: 'name is required' };

  const fuelType = body.fuel_type !== undefined ? body.fuel_type : existing?.fuel_type;
  if (!['electric', 'hybrid', 'gas'].includes(fuelType)) {
    return { error: 'fuel_type must be "electric", "hybrid" or "gas"' };
  }

  let initialMileage = existing?.initial_mileage_km;
  if (body.initial_mileage_km !== undefined) {
    initialMileage = Number(body.initial_mileage_km);
  }
  if (initialMileage == null || isNaN(initialMileage) || initialMileage < 0) {
    return { error: 'initial_mileage_km must be a non-negative number' };
  }

  const licensePlate =
    body.license_plate !== undefined ? String(body.license_plate).trim() || null : existing?.license_plate ?? null;
  const make = body.make !== undefined ? String(body.make).trim() || null : existing?.make ?? null;
  const model = body.model !== undefined ? String(body.model).trim() || null : existing?.model ?? null;

  return { name, fuel_type: fuelType, initial_mileage_km: initialMileage, license_plate: licensePlate, make, model };
}

function optionalNonNegative(body, existing, field) {
  let value = existing?.[field] ?? null;
  if (body[field] !== undefined) {
    value = body[field] === null || body[field] === '' ? null : Number(body[field]);
    if (value != null && (isNaN(value) || value < 0)) {
      return { error: `${field} must be null or a non-negative number` };
    }
  }
  return { value };
}

// year/month are immutable once created — moving a snapshot's period would silently
// reshuffle every downstream km_driven baseline in the carry-forward chain, so the caller
// must delete and recreate instead.
function validateCarMonthFields(body, existing, carId) {
  let year, month;
  if (existing) {
    if (body.year !== undefined && Number(body.year) !== existing.year) {
      return { error: 'year cannot be changed; delete and recreate the snapshot' };
    }
    if (body.month !== undefined && Number(body.month) !== existing.month) {
      return { error: 'month cannot be changed; delete and recreate the snapshot' };
    }
    year = existing.year;
    month = existing.month;
  } else {
    year = Number(body.year);
    month = Number(body.month);
    if (!Number.isInteger(year) || year < 1900 || year > 2999) {
      return { error: 'year must be an integer between 1900 and 2999' };
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { error: 'month must be an integer between 1 and 12' };
    }
    const dup = db.prepare('SELECT id FROM car_months WHERE car_id = ? AND year = ? AND month = ?').get(carId, year, month);
    if (dup) return { error: 'A snapshot for this month already exists' };
  }

  let mileage = existing?.mileage_km;
  if (body.mileage_km !== undefined) mileage = Number(body.mileage_km);
  if (mileage == null || isNaN(mileage) || mileage < 0) {
    return { error: 'mileage_km must be a non-negative number' };
  }

  const avgL = optionalNonNegative(body, existing, 'avg_l_per_100km');
  if (avgL.error) return avgL;
  const costL = optionalNonNegative(body, existing, 'cost_per_l');
  if (costL.error) return costL;
  const avgKwh = optionalNonNegative(body, existing, 'avg_kwh_per_100km');
  if (avgKwh.error) return avgKwh;
  const costKwh = optionalNonNegative(body, existing, 'cost_per_kwh');
  if (costKwh.error) return costKwh;

  const notes = body.notes !== undefined ? String(body.notes).trim() || null : existing?.notes ?? null;

  return {
    year,
    month,
    mileage_km: mileage,
    avg_l_per_100km: avgL.value,
    cost_per_l: costL.value,
    avg_kwh_per_100km: avgKwh.value,
    cost_per_kwh: costKwh.value,
    notes,
  };
}

// ── Helpers shared across route handlers ───────────────────────────────────
function loadCarMonthsWithValues(car, ctx) {
  const snapshots = db.prepare('SELECT * FROM car_months WHERE car_id = ? ORDER BY year, month').all(car.id);
  const monthsAsc = [];
  let prev = null;
  for (const s of snapshots) {
    monthsAsc.push({ ...s, ...computeCarMonthValues(car, s, prev, ctx) });
    prev = s;
  }
  return monthsAsc;
}

function findPrevSnapshot(carId, year, month) {
  return db
    .prepare(
      'SELECT * FROM car_months WHERE car_id = ? AND (year < ? OR (year = ? AND month < ?)) ORDER BY year DESC, month DESC LIMIT 1'
    )
    .get(carId, year, year, month);
}

// ── Routes: cars ─────────────────────────────────────────────────────────────

router.get('/cars', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const cars = db.prepare('SELECT * FROM cars WHERE dossier_id = ? ORDER BY created_at ASC').all(req.params.id);
  const ctx = buildCarCostContext(req.params.id);
  const currentYear = new Date().getFullYear();

  const result = cars.map((car) => {
    const monthsAsc = loadCarMonthsWithValues(car, ctx);
    const latest = monthsAsc.length ? monthsAsc[monthsAsc.length - 1] : null;
    const summary = summarizeCarMonths(monthsAsc);
    const ytdRow = summary.per_year.find((y) => y.year === currentYear);

    const linkedMonthlyCount = db
      .prepare("SELECT COUNT(*) as c FROM expense_template_items WHERE dossier_id = ? AND car_id = ? AND section = 'expense'")
      .get(req.params.id, car.id).c;
    const linkedAnnualCount = db
      .prepare('SELECT COUNT(*) as c FROM annual_expense_template_items WHERE dossier_id = ? AND car_id = ?')
      .get(req.params.id, car.id).c;

    return {
      ...car,
      latest_snapshot: latest ? { year: latest.year, month: latest.month, mileage_km: latest.mileage_km } : null,
      latest_month: latest,
      linked_monthly_count: linkedMonthlyCount,
      linked_annual_count: linkedAnnualCount,
      ytd_total_cost: ytdRow ? ytdRow.total_cost : 0,
    };
  });

  res.json(result);
});

router.post('/cars', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const validated = validateCarFields(req.body, null);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO cars (id, dossier_id, name, license_plate, make, model, fuel_type, initial_mileage_km)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.params.id,
    validated.name,
    validated.license_plate,
    validated.make,
    validated.model,
    validated.fuel_type,
    validated.initial_mileage_km
  );

  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(id);
  console.log(`[cars] Created car "${validated.name}" (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(201).json({
    ...car,
    latest_snapshot: null,
    latest_month: null,
    linked_monthly_count: 0,
    linked_annual_count: 0,
    ytd_total_cost: 0,
  });
});

router.get('/cars/:carId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const car = db.prepare('SELECT * FROM cars WHERE id = ? AND dossier_id = ?').get(req.params.carId, req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const ctx = buildCarCostContext(req.params.id);
  const monthsAsc = loadCarMonthsWithValues(car, ctx);
  const months = [...monthsAsc].reverse();
  const summary = summarizeCarMonths(monthsAsc);

  const linkedMonthlyItems = db
    .prepare(
      "SELECT id, name, type, value, day_of_payment, classification FROM expense_template_items WHERE dossier_id = ? AND car_id = ? AND section = 'expense' ORDER BY position"
    )
    .all(req.params.id, car.id);
  const linkedAnnualItems = db
    .prepare('SELECT id, name, value, num_installments FROM annual_expense_template_items WHERE dossier_id = ? AND car_id = ? ORDER BY position')
    .all(req.params.id, car.id);

  res.json({ ...car, months, summary, linked_monthly_items: linkedMonthlyItems, linked_annual_items: linkedAnnualItems });
});

router.put('/cars/:carId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const car = db.prepare('SELECT * FROM cars WHERE id = ? AND dossier_id = ?').get(req.params.carId, req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const validated = validateCarFields(req.body, car);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.prepare('UPDATE cars SET name = ?, license_plate = ?, make = ?, model = ?, fuel_type = ?, initial_mileage_km = ? WHERE id = ?').run(
    validated.name,
    validated.license_plate,
    validated.make,
    validated.model,
    validated.fuel_type,
    validated.initial_mileage_km,
    car.id
  );

  const updated = db.prepare('SELECT * FROM cars WHERE id = ?').get(car.id);
  console.log(`[cars] Updated car "${validated.name}" (${car.id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.json(updated);
});

router.delete('/cars/:carId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const car = db.prepare('SELECT * FROM cars WHERE id = ? AND dossier_id = ?').get(req.params.carId, req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  db.prepare('DELETE FROM cars WHERE id = ?').run(car.id);
  console.log(`[cars] Deleted car "${car.name}" (${car.id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

// ── Routes: car-month snapshots ─────────────────────────────────────────────

router.post('/cars/:carId/months', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const car = db.prepare('SELECT * FROM cars WHERE id = ? AND dossier_id = ?').get(req.params.carId, req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const validated = validateCarMonthFields(req.body, null, car.id);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO car_months (id, car_id, year, month, mileage_km, avg_l_per_100km, avg_kwh_per_100km, cost_per_l, cost_per_kwh, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    car.id,
    validated.year,
    validated.month,
    validated.mileage_km,
    validated.avg_l_per_100km,
    validated.avg_kwh_per_100km,
    validated.cost_per_l,
    validated.cost_per_kwh,
    validated.notes
  );

  const snapshot = db.prepare('SELECT * FROM car_months WHERE id = ?').get(id);
  const ctx = buildCarCostContext(req.params.id);
  const prev = findPrevSnapshot(car.id, validated.year, validated.month);
  const values = computeCarMonthValues(car, snapshot, prev, ctx);

  console.log(
    `[cars] Snapshot created for car "${car.name}" (${car.id}) — ${validated.year}-${String(validated.month).padStart(2, '0')} — by user ${req.user.username}`
  );
  res.status(201).json({ ...snapshot, ...values });
});

router.put('/cars/:carId/months/:carMonthId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const car = db.prepare('SELECT * FROM cars WHERE id = ? AND dossier_id = ?').get(req.params.carId, req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  const snapshot = db.prepare('SELECT * FROM car_months WHERE id = ? AND car_id = ?').get(req.params.carMonthId, car.id);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  const validated = validateCarMonthFields(req.body, snapshot, car.id);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.prepare(
    'UPDATE car_months SET mileage_km = ?, avg_l_per_100km = ?, avg_kwh_per_100km = ?, cost_per_l = ?, cost_per_kwh = ?, notes = ? WHERE id = ?'
  ).run(
    validated.mileage_km,
    validated.avg_l_per_100km,
    validated.avg_kwh_per_100km,
    validated.cost_per_l,
    validated.cost_per_kwh,
    validated.notes,
    snapshot.id
  );

  const updated = db.prepare('SELECT * FROM car_months WHERE id = ?').get(snapshot.id);
  const ctx = buildCarCostContext(req.params.id);
  const prev = findPrevSnapshot(car.id, updated.year, updated.month);
  const values = computeCarMonthValues(car, updated, prev, ctx);

  console.log(
    `[cars] Snapshot updated for car "${car.name}" (${car.id}) — ${updated.year}-${String(updated.month).padStart(2, '0')} — by user ${req.user.username}`
  );
  res.json({ ...updated, ...values });
});

router.delete('/cars/:carId/months/:carMonthId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const car = db.prepare('SELECT * FROM cars WHERE id = ? AND dossier_id = ?').get(req.params.carId, req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  const snapshot = db.prepare('SELECT * FROM car_months WHERE id = ? AND car_id = ?').get(req.params.carMonthId, car.id);
  if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

  db.prepare('DELETE FROM car_months WHERE id = ?').run(snapshot.id);
  console.log(
    `[cars] Snapshot deleted for car "${car.name}" (${car.id}) — ${snapshot.year}-${String(snapshot.month).padStart(2, '0')} — by user ${req.user.username}`
  );
  res.status(204).end();
});

module.exports = router;
// Shared with the AI Advisor context builder and tests
module.exports.computeCarMonthValues = computeCarMonthValues;
module.exports.findCycleForCalendarMonth = findCycleForCalendarMonth;
module.exports.buildCarCostContext = buildCarCostContext;
module.exports.summarizeCarMonths = summarizeCarMonths;
module.exports.validateCarFields = validateCarFields;
module.exports.validateCarMonthFields = validateCarMonthFields;
