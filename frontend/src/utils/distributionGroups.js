// Groups a cycle's distributions by destination (funding) account, for the
// cycle editor's Distributions list.
//
// Groups follow the accounts' own order (as returned by the API, i.e. by
// position); an account missing from `accounts` sorts after the known ones,
// and the "Unassigned" group (no `account_id`) always comes last. Items keep
// their original order within a group.
export function groupDistributionsByAccount(distributions, accounts) {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const order = new Map(accounts.map((a, i) => [a.id, i]));
  const byKey = new Map();
  for (const item of distributions) {
    const key = item.account_id ?? null;
    if (!byKey.has(key)) {
      const account = key != null ? accountsById.get(key) : null;
      byKey.set(key, {
        accountId: key,
        label: key == null
          ? 'Unassigned'
          : account ? `${account.group_name} — ${account.name}` : 'Unknown account',
        items: [],
        total: 0,
        doneCount: 0,
      });
    }
    const group = byKey.get(key);
    group.items.push(item);
    group.total += Number(item.value) || 0;
    if (item.done) group.doneCount += 1;
  }
  const rank = (g) => {
    if (g.accountId == null) return accounts.length + 1;
    return order.get(g.accountId) ?? accounts.length;
  };
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b));
}
