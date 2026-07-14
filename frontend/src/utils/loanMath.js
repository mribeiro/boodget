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

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// The calendar month counting for "months left" starts from — this month, unless
// dayOfPayment is known and has already passed, in which case this month's payment is
// treated as already made and counting starts from next month instead (dayOfPayment
// clamped to the current month's length, so e.g. 31 means "last day" in a 30-day month).
function effectiveCurrentPeriod(dayOfPayment) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (dayOfPayment != null) {
    const effectiveDay = Math.min(dayOfPayment, daysInMonth(year, month));
    if (now.getDate() >= effectiveDay) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }
  return { year, month };
}

// Months remaining until (and including) an "end_date" (YYYY-MM), counted from the
// current calendar month — e.g. an end_date equal to this month means 1 payment left.
export function computeMonthsLeft(endDate, dayOfPayment) {
  if (!endDate) return null;
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const { year: curYear, month: curMonth } = effectiveCurrentPeriod(dayOfPayment);
  const months = (endYear * 12 + endMonth) - (curYear * 12 + curMonth) + 1;
  return Math.max(0, months);
}

// Inverse of computeMonthsLeft: the YYYY-MM end date that a given number of months-left
// (counted from the current calendar month, inclusive) corresponds to.
export function endDateFromMonthsLeft(monthsLeft, dayOfPayment) {
  const { year, month } = effectiveCurrentPeriod(dayOfPayment);
  const d = new Date(year, month - 1 + monthsLeft - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

// Rate-change scenario: what if the interest rate changed to newRatePct (e.g.
// refinancing, or a variable-rate reset), holding the remaining balance and term fixed.
export function scenarioRateChange(balance, currentRatePct, monthsLeft, newRatePct) {
  const currentPayment = computeMonthlyPayment(balance, currentRatePct, monthsLeft);
  const newPayment = computeMonthlyPayment(balance, newRatePct, monthsLeft);
  const currentTotalInterest = currentPayment * monthsLeft - balance;
  const newTotalInterest = newPayment * monthsLeft - balance;

  return {
    newPayment,
    paymentDifference: newPayment - currentPayment,
    newTotalInterest,
    interestDifference: newTotalInterest - currentTotalInterest,
  };
}

// Full month-by-month amortization schedule from the first still-owed calendar month until
// payoff, splitting each fixed payment into its interest and principal portions. Starts
// from next month rather than this one when dayOfPayment shows this month is already paid
// (see effectiveCurrentPeriod), keeping the schedule's dates aligned with monthsLeft's own
// count. The last payment (or any payment that would overshoot) has its principal clamped
// to exactly clear the balance, absorbing the floating-point drift a fixed annuity payment
// accumulates over time.
export function computeAmortizationSchedule(balance, ratePct, monthsLeft, payment, dayOfPayment) {
  const r = (ratePct || 0) / 100 / 12;
  const { year: startYear, month: startMonth } = effectiveCurrentPeriod(dayOfPayment);
  let bal = balance;
  const schedule = [];
  for (let i = 0; i < monthsLeft; i++) {
    const interest = r > 0 ? bal * r : 0;
    let principal = payment - interest;
    if (i === monthsLeft - 1 || principal >= bal) principal = bal;
    bal = Math.max(0, bal - principal);
    const d = new Date(startYear, startMonth - 1 + i, 1);
    schedule.push({ year: d.getFullYear(), month: d.getMonth() + 1, interest, principal, balance: bal });
  }
  return schedule;
}

// Groups an amortization schedule into per-calendar-year rollups (total interest, total
// principal, and the balance remaining at year end), each carrying its own month rows for
// on-demand expansion in the UI rather than rendering every payment up front.
export function groupScheduleByYear(schedule) {
  const years = [];
  const byYear = new Map();
  for (const row of schedule) {
    let bucket = byYear.get(row.year);
    if (!bucket) {
      bucket = { year: row.year, interest: 0, principal: 0, endBalance: 0, months: [] };
      byYear.set(row.year, bucket);
      years.push(bucket);
    }
    bucket.interest += row.interest;
    bucket.principal += row.principal;
    bucket.endBalance = row.balance;
    bucket.months.push(row);
  }
  return years;
}
