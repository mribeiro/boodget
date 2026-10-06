import { computeGlobalSummary } from './workbenchSummary';

describe('computeGlobalSummary', () => {
  const base = {
    income: [{ value: 3000 }],
    monthlyExpenses: [
      { classification: 'must', value: 800 },
      { classification: 'want', value: 200 },
    ],
    annualExpenses: [
      { classification: 'must', value: 1200 },
      { classification: 'want', value: 600 },
    ],
    distributions: [{ must_amount: 100, want_amount: 50, save_amount: 300 }],
  };

  it('sums must/want/save across monthly, annual (/12) and distributions', () => {
    expect(computeGlobalSummary(base)).toEqual({
      totalIncome: 3000, totalMust: 1000, totalWant: 300, totalSave: 300, totalUnclassified: 0, leftover: 1400,
    });
  });

  it('takes unclassified expenses off the leftover (#357)', () => {
    const s = computeGlobalSummary({
      ...base,
      monthlyExpenses: [...base.monthlyExpenses, { classification: null, value: 150 }],
      annualExpenses: [...base.annualExpenses, { value: 120 }],
    });
    expect(s.totalUnclassified).toBe(160);
    expect(s.totalMust).toBe(1000);
    expect(s.leftover).toBe(1400 - 160);
  });
});
