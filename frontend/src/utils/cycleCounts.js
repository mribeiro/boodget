// "Paid / total" for a cycle's Fixed Expenses section. The list shows the cycle's Fixed items
// and the annual-expense installments due in it side by side, so both sides of the count cover
// both kinds — counting annual payments only in the total left a fully-paid cycle at e.g. 11/13.
export function fixedExpensesPaidCount(fixedItems = [], annualPayments = []) {
  const all = [...fixedItems, ...annualPayments];
  return { paid: all.filter((i) => i.paid).length, total: all.length };
}
