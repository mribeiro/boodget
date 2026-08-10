// Loan amortization math — a small deliberate duplication of the backend helpers in
// backend/src/routes/loans.js: computeMonthlyPayment, effectiveCurrentPeriod /
// computeMonthsLeft, and computeTermFromAnchor. The scenario calculators recompute on
// every keystroke and can't round-trip to the server, and the payment plan is a
// deterministic projection of fields the loan response already carries — so the client
// rebuilds it locally, while the server stays the source of truth for anything persisted.
// The two test suites deliberately mirror each other case for case, so drift shows up as
// a test failure rather than as a wrong number on screen.

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
export function effectiveCurrentPeriod(dayOfPayment) {
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

// Scheduled payments from balanceAsOf through endDate ('YYYY-MM'), both months inclusive.
// Mirrors computeTermFromAnchor in backend/src/routes/loans.js — the span a loan's stable
// monthly payment is computed over, so the form's live preview matches what gets saved.
export function computeTermFromAnchor(balanceAsOf, endDate) {
  if (!balanceAsOf || !endDate) return null;
  const [anchorYear, anchorMonth] = balanceAsOf.split('-').map(Number);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  return (endYear * 12 + endMonth) - (anchorYear * 12 + anchorMonth) + 1;
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

// Full month-by-month payment plan, splitting each fixed payment into its interest and
// principal portions. `startPeriod` is an explicit { year, month } — for an anchored loan
// that's balance_as_of (so the plan includes the months already paid, not just what's
// still owed), and for an unanchored one the caller passes effectiveCurrentPeriod().
// Taking it as a parameter rather than deriving it from dayOfPayment internally keeps this
// function pure: the same inputs always produce the same plan, whatever today's date is.
//
// The final payment (and any payment that would overshoot) has its principal clamped to
// exactly clear the balance, absorbing the floating-point drift a fixed annuity payment
// accumulates over a long term. Each row's `payment` is its own interest + principal, so
// that clamped last row reports the real short final payment rather than the nominal one.
export function computeAmortizationSchedule(balance, ratePct, months, payment, startPeriod) {
  const r = (ratePct || 0) / 100 / 12;
  const { year: startYear, month: startMonth } = startPeriod;
  let bal = balance;
  const schedule = [];
  for (let i = 0; i < months; i++) {
    const interest = r > 0 ? bal * r : 0;
    let principal = payment - interest;
    if (i === months - 1 || principal >= bal) principal = bal;
    bal = Math.max(0, bal - principal);
    const d = new Date(startYear, startMonth - 1 + i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    schedule.push({
      period: `${year}-${String(month).padStart(2, '0')}`,
      year,
      month,
      interest,
      principal,
      payment: interest + principal,
      balance: bal,
    });
  }
  return schedule;
}

// Groups a payment plan into per-calendar-year rollups (total interest, total principal,
// and the balance remaining at year end), each carrying its own month rows for on-demand
// expansion in the UI rather than rendering every payment up front. `paidCount`/
// `trackedCount` summarize each year's tracking state for the year row's badge — a row
// counts as tracked only when its paid state is actually known (`true`/`false`), since a
// null means "no cycle, or no matching expense item" and must never read as unpaid.
export function groupScheduleByYear(schedule) {
  const years = [];
  const byYear = new Map();
  for (const row of schedule) {
    let bucket = byYear.get(row.year);
    if (!bucket) {
      bucket = { year: row.year, interest: 0, principal: 0, endBalance: 0, paidCount: 0, trackedCount: 0, months: [] };
      byYear.set(row.year, bucket);
      years.push(bucket);
    }
    bucket.interest += row.interest;
    bucket.principal += row.principal;
    bucket.endBalance = row.balance;
    if (row.paid === true || row.paid === false) {
      bucket.trackedCount += 1;
      if (row.paid) bucket.paidCount += 1;
    }
    bucket.months.push(row);
  }
  return years;
}
