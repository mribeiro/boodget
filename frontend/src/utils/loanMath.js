// Loan amortization math — small deliberate duplication of the backend helper in
// backend/src/routes/loans.js. Scenarios need per-keystroke recompute in the UI;
// the server remains the source of truth for the persisted monthly_payment.

// Annuity formula: payment = P·r / (1 − (1+r)^−n), r = annual_pct/100/12; r = 0 → P/n
export function computeMonthlyPayment(principal, ratePct, months) {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = (ratePct || 0) / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

// Downpayment scenario: paying X now against an active loan with the given balance,
// rate, and months left. Returns both outcomes — keeping the term (lower payment) and
// keeping the payment (shorter term) — plus the interest saved by the second option.
export function scenarioDownpayment(balance, ratePct, monthsLeft, downpayment) {
  const r = (ratePct || 0) / 100 / 12;
  const currentPayment = computeMonthlyPayment(balance, ratePct, monthsLeft);
  const X = Math.max(0, Number(downpayment) || 0);

  if (X >= balance) {
    return {
      paidOff: true,
      newPaymentSameTerm: 0,
      newTermSamePayment: 0,
      interestSaved: currentPayment * monthsLeft - balance,
    };
  }

  const newBalance = balance - X;
  const newPaymentSameTerm = computeMonthlyPayment(newBalance, ratePct, monthsLeft);

  let newTermExact;
  if (r === 0) {
    newTermExact = currentPayment > 0 ? newBalance / currentPayment : 0;
  } else {
    const denom = currentPayment - newBalance * r;
    newTermExact = denom > 0 ? Math.log(currentPayment / denom) / Math.log(1 + r) : monthsLeft;
  }
  const newTermSamePayment = Math.ceil(newTermExact);

  const totalInterestBefore = currentPayment * monthsLeft - balance;
  const totalInterestAfter = currentPayment * newTermExact - newBalance;
  const interestSaved = totalInterestBefore - totalInterestAfter;

  return {
    paidOff: false,
    newPaymentSameTerm,
    newTermSamePayment,
    interestSaved,
  };
}

// Target-payment scenario: how much of a lump sum is needed now so that the monthly
// payment drops to Y (over the same remaining term).
export function scenarioTargetPayment(balance, ratePct, monthsLeft, targetPayment) {
  const r = (ratePct || 0) / 100 / 12;
  const currentPayment = computeMonthlyPayment(balance, ratePct, monthsLeft);
  const Y = Number(targetPayment) || 0;

  let lumpSumNeeded;
  if (r === 0) {
    lumpSumNeeded = balance - Y * monthsLeft;
  } else {
    lumpSumNeeded = balance - (Y * (1 - Math.pow(1 + r, -monthsLeft))) / r;
  }
  lumpSumNeeded = Math.max(0, lumpSumNeeded);

  return {
    lumpSumNeeded,
    alreadyMet: Y >= currentPayment,
  };
}
