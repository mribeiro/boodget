import { computeEnergyCost } from './carMath';

describe('computeEnergyCost', () => {
  it('computes fuel_cost only for a gas car, electric_cost 0', () => {
    const result = computeEnergyCost({ fuelType: 'gas', kmDriven: 200, avgLPer100km: 6, costPerL: 1.5, avgKwhPer100km: null, costPerKwh: null });
    expect(result.fuel_cost).toBeCloseTo((200 / 100) * 6 * 1.5, 5);
    expect(result.electric_cost).toBe(0);
    expect(result.energy_cost).toBe(result.fuel_cost);
    expect(result.energy_incomplete).toBe(false);
  });

  it('computes electric_cost only for an electric car, fuel_cost 0', () => {
    const result = computeEnergyCost({ fuelType: 'electric', kmDriven: 200, avgLPer100km: null, costPerL: null, avgKwhPer100km: 17, costPerKwh: 0.2 });
    expect(result.fuel_cost).toBe(0);
    expect(result.electric_cost).toBeCloseTo((200 / 100) * 17 * 0.2, 5);
    expect(result.energy_incomplete).toBe(false);
  });

  it('sums both legs for a hybrid car', () => {
    const result = computeEnergyCost({ fuelType: 'hybrid', kmDriven: 200, avgLPer100km: 4, costPerL: 1.6, avgKwhPer100km: 10, costPerKwh: 0.2 });
    const expectedFuel = (200 / 100) * 4 * 1.6;
    const expectedElectric = (200 / 100) * 10 * 0.2;
    expect(result.fuel_cost).toBeCloseTo(expectedFuel, 5);
    expect(result.electric_cost).toBeCloseTo(expectedElectric, 5);
    expect(result.energy_cost).toBeCloseTo(expectedFuel + expectedElectric, 5);
  });

  it('marks energy_incomplete and treats the missing leg as 0 in the total', () => {
    const result = computeEnergyCost({ fuelType: 'gas', kmDriven: 200, avgLPer100km: null, costPerL: null, avgKwhPer100km: null, costPerKwh: null });
    expect(result.fuel_cost).toBeNull();
    expect(result.energy_incomplete).toBe(true);
    expect(result.energy_cost).toBe(0);
  });

  it('a hybrid missing only one leg is still energy_incomplete even though the other leg resolves', () => {
    const result = computeEnergyCost({ fuelType: 'hybrid', kmDriven: 200, avgLPer100km: 4, costPerL: 1.6, avgKwhPer100km: null, costPerKwh: null });
    expect(result.fuel_cost).toBeCloseTo((200 / 100) * 4 * 1.6, 5);
    expect(result.electric_cost).toBeNull();
    expect(result.energy_incomplete).toBe(true);
    expect(result.energy_cost).toBe(result.fuel_cost);
  });

  it('returns zero cost for zero km driven', () => {
    const result = computeEnergyCost({ fuelType: 'gas', kmDriven: 0, avgLPer100km: 6, costPerL: 1.5 });
    expect(result.fuel_cost).toBe(0);
    expect(result.energy_cost).toBe(0);
  });
});
