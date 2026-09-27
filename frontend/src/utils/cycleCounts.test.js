import { fixedExpensesPaidCount } from './cycleCounts';

describe('fixedExpensesPaidCount', () => {
  it('counts paid annual payments alongside paid Fixed items', () => {
    const fixed = [{ paid: 1 }, { paid: 1 }, { paid: 0 }];
    const annual = [{ paid: 1 }, { paid: 1 }];
    expect(fixedExpensesPaidCount(fixed, annual)).toEqual({ paid: 4, total: 5 });
  });

  it('reads all-paid as complete', () => {
    expect(fixedExpensesPaidCount([{ paid: 1 }], [{ paid: 1 }])).toEqual({ paid: 2, total: 2 });
  });

  it('handles no annual payments', () => {
    expect(fixedExpensesPaidCount([{ paid: 0 }])).toEqual({ paid: 0, total: 1 });
  });
});
