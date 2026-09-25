import { groupDistributionsByAccount } from './distributionGroups';

const accounts = [
  { id: 'a1', group_name: 'Bank A', name: 'Savings' },
  { id: 'a2', group_name: 'Bank B', name: 'Current' },
];

describe('groupDistributionsByAccount', () => {
  it('groups by account following account order, with Unassigned last', () => {
    const groups = groupDistributionsByAccount([
      { id: 'd1', account_id: null, value: 10, done: 0 },
      { id: 'd2', account_id: 'a2', value: 20, done: 1 },
      { id: 'd3', account_id: 'a1', value: 30, done: 0 },
      { id: 'd4', account_id: 'a2', value: 5.5, done: 0 },
    ], accounts);

    expect(groups.map((g) => g.accountId)).toEqual(['a1', 'a2', null]);
    expect(groups.map((g) => g.label)).toEqual(['Bank A — Savings', 'Bank B — Current', 'Unassigned']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['d2', 'd4']);
    expect(groups[1].total).toBe(25.5);
    expect(groups[1].doneCount).toBe(1);
  });

  it('treats an undefined account_id as unassigned', () => {
    const groups = groupDistributionsByAccount([{ id: 'd1', value: 1 }], accounts);
    expect(groups).toHaveLength(1);
    expect(groups[0].accountId).toBeNull();
  });

  it('places an account missing from the list after known accounts but before Unassigned', () => {
    const groups = groupDistributionsByAccount([
      { id: 'd1', account_id: null, value: 1 },
      { id: 'd2', account_id: 'gone', value: 1 },
      { id: 'd3', account_id: 'a1', value: 1 },
    ], accounts);
    expect(groups.map((g) => g.accountId)).toEqual(['a1', 'gone', null]);
    expect(groups[1].label).toBe('Unknown account');
  });

  it('returns no groups for an empty list', () => {
    expect(groupDistributionsByAccount([], accounts)).toEqual([]);
  });
});
