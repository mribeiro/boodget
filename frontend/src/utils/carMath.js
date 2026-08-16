// Car energy-cost math — a small deliberate duplication of the fuel/electric leg of
// backend/src/routes/cars.js's computeCarMonthValues. The snapshot form shows a live
// "≈ X € this month" preview as the user types mileage and averages, which can't
// round-trip to the server per keystroke. Only the energy formula is duplicated here —
// the linked-expense/cycle-resolution logic stays server-only, since it needs tables the
// client doesn't have and isn't needed for a live preview.

// null = the user hasn't entered these inputs yet; 0 = doesn't apply to this fuel type —
// same convention as the backend.
export function computeEnergyCost({ fuelType, kmDriven, avgLPer100km, costPerL, avgKwhPer100km, costPerKwh }) {
  const fuelApplies = fuelType === 'gas' || fuelType === 'hybrid';
  const elecApplies = fuelType === 'electric' || fuelType === 'hybrid';

  let fuelCost = 0;
  if (fuelApplies) {
    fuelCost = avgLPer100km == null || costPerL == null ? null : (kmDriven / 100) * avgLPer100km * costPerL;
  }
  let electricCost = 0;
  if (elecApplies) {
    electricCost = avgKwhPer100km == null || costPerKwh == null ? null : (kmDriven / 100) * avgKwhPer100km * costPerKwh;
  }

  const energyIncomplete = fuelCost === null || electricCost === null;
  const energyCost = (fuelCost ?? 0) + (electricCost ?? 0);

  return { fuel_cost: fuelCost, electric_cost: electricCost, energy_cost: energyCost, energy_incomplete: energyIncomplete };
}
