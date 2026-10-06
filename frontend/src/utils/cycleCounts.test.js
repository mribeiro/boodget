import { fixedExpensesPaidCount, budgetsBadge } from './cycleCounts';

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

describe('budgetsBadge (#370)', () => {
  it('shows just the number of budgets while none is used up', () => {
    expect(budgetsBadge([{ value: 100, spent: 20 }, { value: 50, spent: 0 }])).toBe('2');
  });

  it('calls out the budgets that are used up', () => {
    expect(budgetsBadge([{ value: 100, spent: 100 }, { value: 50, spent: 10 }, { value: 30, spent: 30 }])).toBe('3 · 2 maxed out');
  });

  it('does not count a 0 € budget as maxed out', () => {
    expect(budgetsBadge([{ value: 0, spent: 0 }])).toBe('1');
  });
});
