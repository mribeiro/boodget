// "Paid / total" for a cycle's Fixed Expenses section. The list shows the cycle's Fixed items
// and the annual-expense installments due in it side by side, so both sides of the count cover
// both kinds — counting annual payments only in the total left a fully-paid cycle at e.g. 11/13.
export function fixedExpensesPaidCount(fixedItems = [], annualPayments = []) {
  const all = [...fixedItems, ...annualPayments];
  return { paid: all.filter((i) => i.paid).length, total: all.length };
}

// Badge for a cycle's Budgets section. Unlike its neighbours this isn't "done / total": a
// budget can't be "done", and counting fully-spent ones as complete made 3/3 — every budget
// maxed out — read like the good state (#370). So: how many budgets there are, plus how many
// are used up. A 0 € budget isn't "maxed out", it was never meant to be spent.
export function budgetsBadge(budgets = []) {
  const maxed = budgets.filter((b) => b.value > 0 && (b.spent ?? 0) >= b.value).length;
  return maxed > 0 ? `${budgets.length} · ${maxed} maxed out` : `${budgets.length}`;
}
