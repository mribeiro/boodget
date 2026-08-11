const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { toIsoDate, fromIsoDate } = require('../utils/cycleDates');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// ── Amortization math ────────────────────────────────────────────────────────
// payment = P·r / (1 − (1+r)^−n), r = annual_pct/100/12; r = 0 → P/n
function computeMonthlyPayment(principal, ratePct, months) {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = (ratePct || 0) / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The first calendar month whose payment is still owed: this month, unless dayOfPayment is
// known and has already passed, in which case this month's payment is treated as already
// made and counting starts from next month (dayOfPayment clamped to the current month's
// length, so e.g. 31 means "last day" in a 30-day month).
// "Now" is read in UTC rather than the server's OS-local timezone, so this doesn't depend
// on where the server happens to be deployed relative to the user/dossier.
// Shared by computeMonthsLeft and computePaymentsMade so the two can never disagree about
// which month is the current one — see the identity in the balance-anchoring block below.
function effectiveCurrentPeriod(dayOfPayment) {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  if (dayOfPayment != null) {
    const effectiveDay = Math.min(dayOfPayment, daysInMonth(year, month));
    if (now.getUTCDate() >= effectiveDay) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }
  return { year, month };
}

// Months remaining until (and including) an "end_date" (YYYY-MM) — e.g. an end_date equal
// to the effective current month means 1 payment left. Never stored: always derived fresh
// so the user never has to update it.
function computeMonthsLeft(endDate, dayOfPayment) {
  if (!endDate) return null;
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const { year: curYear, month: curMonth } = effectiveCurrentPeriod(dayOfPayment);
  const months = (endYear * 12 + endMonth) - (curYear * 12 + curMonth) + 1;
  return Math.max(0, months);
}

// ── Balance anchoring ────────────────────────────────────────────────────────
// `remaining_balance` alone can't produce a stable payment: months_left shrinks every
// month while the stored balance doesn't, so the annuity over (balance ÷ months_left)
// climbs month after month. Dating the balance fixes that — `balance_as_of` is the month
// whose payment is the next one still owed on that balance, so the payment is computed
// once over the whole span from the anchor to the end date and never moves again.

// Payments scheduled from balanceAsOf through endDate, both months inclusive.
// null when either is missing; <= 0 means the anchor sits past the end date.
function computeTermFromAnchor(balanceAsOf, endDate) {
  if (!balanceAsOf || !endDate) return null;
  const [anchorYear, anchorMonth] = balanceAsOf.split('-').map(Number);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  return (endYear * 12 + endMonth) - (anchorYear * 12 + anchorMonth) + 1;
}

// How many of those scheduled payments are behind us, by the same "this month is already
// paid once day_of_payment passes" rule months_left uses — which is what makes
// `months_left === term_from_anchor - payments_made` hold identically rather than by
// coincidence. Clamped into [0, term]: a future anchor yields 0, and a loan left past its
// end date stops at the full term instead of running negative.
function computePaymentsMade(balanceAsOf, dayOfPayment, term) {
  const [anchorYear, anchorMonth] = balanceAsOf.split('-').map(Number);
  const { year, month } = effectiveCurrentPeriod(dayOfPayment);
  const elapsed = (year * 12 + month) - (anchorYear * 12 + anchorMonth);
  return Math.max(0, Math.min(elapsed, term));
}

// Walks a fixed annuity payment forward `periods` rows of a `totalPeriods`-row plan.
// Deliberately a loop rather than the closed form, so it mirrors the frontend amortization
// schedule's overshoot clamp row-for-row — the projected balance and the plan's own running
// balance must never disagree. `totalPeriods` is what lets the *final* row clamp to exactly
// zero (absorbing the float drift a fixed payment accumulates over a long term) rather than
// leaving a fraction-of-a-cent residue behind; it defaults to a walk that is the whole plan.
function projectBalance(balance, ratePct, payment, periods, totalPeriods = periods) {
  const r = (ratePct || 0) / 100 / 12;
  let bal = balance;
  for (let i = 0; i < periods; i++) {
    const interest = r > 0 ? bal * r : 0;
    const principal = payment - interest;
    // A payment that can't even cover the interest would make the balance *grow* every
    // iteration and project a nonsense figure. Only reachable from hand-edited data
    // (validation won't produce it), so hold the balance rather than compound it.
    if (!(principal > 0)) break;
    if (i === totalPeriods - 1 || principal >= bal) return 0;
    bal -= principal;
  }
  return Math.max(0, bal);
}

function computeLoanValues(loan, dossierId) {
  const isActive = loan.status === 'active';

  // An anchored active loan derives everything from (balance @ balance_as_of → end_date).
  // Without an anchor — an older row, a pre-v15 import, an already-matured loan the
  // migration skipped — every expression below collapses to exactly what this function
  // computed before anchoring existed, so nothing about those loans changes.
  const anchored = isActive && !!loan.balance_as_of && /^\d{4}-\d{2}$/.test(loan.balance_as_of);
  const termFromAnchor = anchored ? computeTermFromAnchor(loan.balance_as_of, loan.end_date) : null;
  // An anchor at or past the end date schedules nothing. Validation rejects it, so this is
  // only reachable from hand-edited data — fall back to the legacy branch rather than
  // emitting NaN through every downstream figure.
  const useAnchor = anchored && termFromAnchor != null && termFromAnchor >= 1;

  const paymentsMade = useAnchor
    ? computePaymentsMade(loan.balance_as_of, loan.day_of_payment, termFromAnchor)
    : null;

  const monthsLeft = !isActive
    ? null
    : useAnchor
      ? termFromAnchor - paymentsMade
      : computeMonthsLeft(loan.end_date, loan.day_of_payment);

  const monthlyPayment =
    loan.status === 'draft'
      ? computeMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
      : computeMonthlyPayment(
          loan.remaining_balance,
          loan.interest_rate,
          useAnchor ? termFromAnchor : monthsLeft
        );

  // The live figure. `remaining_balance` stays the dated anchor the user entered; this is
  // that balance walked forward by however many scheduled payments have since come due.
  const currentBalance = !isActive
    ? null
    : useAnchor
      ? projectBalance(loan.remaining_balance, loan.interest_rate, monthlyPayment, paymentsMade, termFromAnchor)
      : loan.remaining_balance;

  const salaryPct =
    loan.salary != null && loan.salary > 0 ? (monthlyPayment / loan.salary) * 100 : null;

  // Manually-set dossier setting, not derived from any cycle — a one-off bonus/prize
  // in a cycle's salary shouldn't silently skew loan prefills or the % of salary calc.
  const dossierRow = db.prepare('SELECT reference_salary FROM dossiers WHERE id = ?').get(dossierId);
  const referenceSalary = dossierRow?.reference_salary ?? null;

  let linkedItem = null;
  let covered = null;
  let coverageDifference = null;
  if (isActive && loan.expense_template_item_id) {
    const item = db
      .prepare('SELECT id, name, value FROM expense_template_items WHERE id = ? AND dossier_id = ?')
      .get(loan.expense_template_item_id, dossierId);
    if (item) {
      linkedItem = { id: item.id, name: item.name, value: item.value };
      covered = item.value >= monthlyPayment - 0.005;
      coverageDifference = item.value - monthlyPayment;
    }
  }

  // purchase_price / total_interest / total_amount_payable describe how the loan was
  // *originated* (principal + term_months, as set while it was a draft). Those two columns
  // are never cleared on promotion to active, so these stay available — as a historical
  // record — for any loan that started life as a draft, regardless of its current status.
  const purchasePrice =
    loan.principal != null && loan.down_payment != null ? loan.principal + loan.down_payment : null;

  const originationMonthlyPayment =
    loan.principal != null && loan.term_months != null
      ? computeMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
      : null;

  // Total interest paid over the full original term — principal + interest minus the
  // principal itself (excludes the opening fee, which isn't interest).
  const totalInterest =
    originationMonthlyPayment != null ? originationMonthlyPayment * loan.term_months - loan.principal : null;

  // Total amount payable (MTIC) — a simplified estimate (principal + total interest + the
  // one modeled fee); the official Portuguese MTIC can include other charges (stamp duty,
  // insurance) this app doesn't track.
  const totalAmountPayable =
    originationMonthlyPayment != null ? originationMonthlyPayment * loan.term_months + (loan.opening_fee || 0) : null;

  // An active loan whose end_date has passed (months_left down to 0) without the user
  // closing it out or pushing the end date. An anchored loan keeps reporting its real
  // monthly_payment here (it derives from term_from_anchor, not months_left) — a loan past
  // its end date isn't suddenly free — whereas an unanchored one still collapses to 0 via
  // the computeMonthlyPayment guard. Either way there is no meaningful forward-looking
  // interest figure left, so remaining_interest is nulled rather than computed.
  const isMatured = isActive && monthsLeft != null && monthsLeft <= 0;

  // Interest still left to pay from now to payoff, against the *live* balance — the
  // forward-looking counterpart to total_interest's backward-looking full-term figure.
  const remainingInterest =
    isActive && !isMatured ? monthlyPayment * monthsLeft - currentBalance : null;

  return {
    monthly_payment: monthlyPayment,
    months_left: monthsLeft,
    current_balance: currentBalance,
    term_from_anchor: useAnchor ? termFromAnchor : null,
    payments_made: paymentsMade,
    is_matured: isMatured,
    salary_pct: salaryPct,
    reference_salary: referenceSalary,
    linked_item: linkedItem,
    covered,
    coverage_difference: coverageDifference,
    purchase_price: purchasePrice,
    total_interest: totalInterest,
    total_amount_payable: totalAmountPayable,
    remaining_interest: remainingInterest,
  };
}

// down_payment, taeg, and opening_fee are all nullable, non-negative numerics that can only
// be explicitly *set* while draft — but once set, persist unchanged across status changes
// (shared parsing/validation). An explicit null on a non-draft loan is rejected the same way
// once a value is already on record, so a partial PUT can't silently erase this historical data
// — only omitting the field entirely carries the existing value forward unchanged.
function parseDraftOnlyNullableNumber(body, existing, field, status) {
  const existingValue = existing?.[field] ?? null;
  let value = existingValue;
  if (body[field] !== undefined) {
    const parsed = body[field] === null || body[field] === '' ? null : Number(body[field]);
    if (parsed != null) {
      if (isNaN(parsed) || parsed < 0) {
        return { error: `${field} must be null or a non-negative number` };
      }
      if (status !== 'draft') {
        return { error: `${field} can only be set on draft loans` };
      }
    } else if (status !== 'draft' && existingValue != null) {
      return { error: `${field} cannot be cleared on a loan that is not a draft` };
    }
    value = parsed;
  }
  return { value };
}

function validateLoanFields(body, existing, dossierId) {
  const name = body.name !== undefined ? String(body.name).trim() : existing?.name;
  if (!name) return { error: 'name is required' };

  const status = body.status !== undefined ? body.status : existing?.status ?? 'draft';
  if (!['draft', 'active'].includes(status)) return { error: 'status must be "draft" or "active"' };

  const interestRate = body.interest_rate !== undefined ? Number(body.interest_rate) : existing?.interest_rate ?? 0;
  if (isNaN(interestRate) || interestRate < 0 || interestRate > 100) {
    return { error: 'interest_rate must be a number between 0 and 100' };
  }

  let salary = existing?.salary ?? null;
  if (body.salary !== undefined) {
    salary = body.salary === null || body.salary === '' ? null : Number(body.salary);
    if (salary != null && (isNaN(salary) || salary < 0)) {
      return { error: 'salary must be null or a non-negative number' };
    }
  }

  const existingPrincipal = existing?.principal ?? null;
  let principal = existingPrincipal;
  if (body.principal !== undefined) {
    principal = body.principal === null || body.principal === '' ? null : Number(body.principal);
    if (principal != null && status !== 'draft') {
      return { error: 'principal can only be set on draft loans' };
    }
    if (principal === null && status !== 'draft' && existingPrincipal != null) {
      return { error: 'principal cannot be cleared on a loan that is not a draft' };
    }
  }

  const existingTermMonths = existing?.term_months ?? null;
  let termMonths = existingTermMonths;
  if (body.term_months !== undefined) {
    termMonths = body.term_months === null || body.term_months === '' ? null : Number(body.term_months);
    if (termMonths != null && status !== 'draft') {
      return { error: 'term_months can only be set on draft loans' };
    }
    if (termMonths === null && status !== 'draft' && existingTermMonths != null) {
      return { error: 'term_months cannot be cleared on a loan that is not a draft' };
    }
  }

  const remainingBalance = body.remaining_balance !== undefined ? (body.remaining_balance === null || body.remaining_balance === '' ? null : Number(body.remaining_balance)) : existing?.remaining_balance ?? null;

  let endDate = existing?.end_date ?? null;
  if (body.end_date !== undefined) {
    endDate = body.end_date === null || body.end_date === '' ? null : String(body.end_date);
    if (endDate != null && status !== 'active') {
      return { error: 'end_date can only be set on active loans' };
    }
  }

  let balanceAsOf = existing?.balance_as_of ?? null;
  if (body.balance_as_of !== undefined) {
    balanceAsOf = body.balance_as_of === null || body.balance_as_of === '' ? null : String(body.balance_as_of);
    if (balanceAsOf != null && !/^\d{4}-\d{2}$/.test(balanceAsOf)) {
      return { error: 'balance_as_of must be in YYYY-MM format' };
    }
    if (balanceAsOf != null && status !== 'active') {
      return { error: 'balance_as_of can only be set on active loans' };
    }
  }

  let dayOfPayment = existing?.day_of_payment ?? null;
  if (body.day_of_payment !== undefined) {
    dayOfPayment = body.day_of_payment === null || body.day_of_payment === '' ? null : Number(body.day_of_payment);
    if (dayOfPayment != null && (!Number.isInteger(dayOfPayment) || dayOfPayment < 1 || dayOfPayment > 31)) {
      return { error: 'day_of_payment must be an integer between 1 and 31' };
    }
    if (dayOfPayment != null && status !== 'active') {
      return { error: 'day_of_payment can only be set on active loans' };
    }
  }

  const downPaymentResult = parseDraftOnlyNullableNumber(body, existing, 'down_payment', status);
  if (downPaymentResult.error) return { error: downPaymentResult.error };
  let downPayment = downPaymentResult.value;

  const taegResult = parseDraftOnlyNullableNumber(body, existing, 'taeg', status);
  if (taegResult.error) return { error: taegResult.error };
  let taeg = taegResult.value;

  const openingFeeResult = parseDraftOnlyNullableNumber(body, existing, 'opening_fee', status);
  if (openingFeeResult.error) return { error: openingFeeResult.error };
  let openingFee = openingFeeResult.value;

  // expense_template_item_id: only settable on active loans. Whether a link is provided is
  // checked here rather than derived from `existing`/`status`, since POST (existing == null)
  // rejects an explicit link outright while PUT (existing != null) silently drops it.
  let expenseTemplateItemId = existing?.expense_template_item_id ?? null;
  const linkProvided = body.expense_template_item_id !== undefined && body.expense_template_item_id !== null;

  // Everything cleared when a loan is demoted to (or created as) draft — end_date,
  // day_of_payment, and expense_template_item_id — lives in this single branch, so a future
  // active-only field only has to be added to one place to be covered by demotion.
  if (status === 'draft') {
    if (!(principal > 0)) return { error: 'principal must be a positive number for draft loans' };
    if (!Number.isInteger(termMonths) || termMonths < 1) {
      return { error: 'term_months must be an integer ≥ 1 for draft loans' };
    }
    // A draft loan can never carry an expense-template link. Creating one directly with a
    // link is a user error; demoting an active loan (or re-saving an already-draft one)
    // clears it silently instead, since demotion is a deliberate, valid action.
    if (linkProvided && existing == null) {
      return { error: 'A draft loan cannot be linked to an expense template item' };
    }
    endDate = null;
    dayOfPayment = null;
    balanceAsOf = null;
    expenseTemplateItemId = null;
  } else {
    if (!(remainingBalance > 0)) return { error: 'remaining_balance must be a positive number for active loans' };
    if (!endDate || !/^\d{4}-\d{2}$/.test(endDate)) {
      return { error: 'end_date is required for active loans, in YYYY-MM format' };
    }
    if (!Number.isInteger(dayOfPayment) || dayOfPayment < 1 || dayOfPayment > 31) {
      return { error: 'day_of_payment is required for active loans (1-31)' };
    }
    if (computeMonthsLeft(endDate, dayOfPayment) < 1) {
      return { error: 'end_date must be the current month or later' };
    }
    if (balanceAsOf != null && computeTermFromAnchor(balanceAsOf, endDate) < 1) {
      return { error: 'balance_as_of must be the same month as end_date or earlier' };
    }

    // Auto-anchor. Dating the balance is what keeps the monthly payment stable, so no
    // active loan should be left without an anchor — but requiring one in the request
    // would 400 PromoteLoanModal's minimal PUT and every pre-v15 import for no gain.
    // Instead: anchor a loan that has none, and re-anchor whenever the balance itself
    // actually changes, which is exactly what entering a fresh balance means.
    // The comparison must be by value, not by presence: LoanFormModal resends its whole
    // payload on every save, so `body.remaining_balance !== undefined` alone would
    // silently re-anchor (and wipe the recorded plan) on an unrelated edit to the rate.
    const balanceChanged =
      body.remaining_balance !== undefined &&
      Number(body.remaining_balance) !== Number(existing?.remaining_balance ?? NaN);
    if (body.balance_as_of === undefined && (balanceAsOf == null || balanceChanged)) {
      const { year, month } = effectiveCurrentPeriod(dayOfPayment);
      balanceAsOf = `${year}-${String(month).padStart(2, '0')}`;
    }
    if (body.expense_template_item_id !== undefined) {
      if (body.expense_template_item_id === null) {
        expenseTemplateItemId = null;
      } else {
        const item = db
          .prepare("SELECT id FROM expense_template_items WHERE id = ? AND dossier_id = ? AND section = 'expense' AND type = 'Fixed'")
          .get(body.expense_template_item_id, dossierId);
        if (!item) return { error: 'expense_template_item_id must reference a Fixed expense in this dossier' };
        expenseTemplateItemId = item.id;
      }
    }
    // down_payment/taeg/opening_fee are NOT cleared here on promotion — they describe how
    // the loan was originated and survive as a historical record once it goes active. They
    // can still only be explicitly *set* while draft (parseDraftOnlyNullableNumber above);
    // an active loan just carries forward whatever value it already had.
  }

  return {
    name,
    status,
    interest_rate: interestRate,
    salary,
    principal,
    term_months: termMonths,
    end_date: endDate,
    day_of_payment: dayOfPayment,
    balance_as_of: balanceAsOf,
    remaining_balance: remainingBalance,
    down_payment: downPayment,
    taeg,
    opening_fee: openingFee,
    expense_template_item_id: expenseTemplateItemId,
  };
}

// Optional companion to a loan write: build the Fixed monthly expense that funds it and
// link the loan to it, in the same transaction as the loan itself. Doing this client-side
// would take two calls with no way to roll back the first, leaving an orphan expense
// sitting in the user's budget whenever the second fails.
// Returns { error } for a rejected request, { itemId } otherwise.
function resolveCreateExpenseItem(body, validated, dossierId) {
  const raw = body.create_expense_template_item;
  if (raw === undefined || raw === null || raw === false) return { itemId: null };
  if (raw !== true && typeof raw !== 'object') {
    return { error: 'create_expense_template_item must be true or an object' };
  }
  const overrides = raw === true ? {} : raw;

  if (validated.status !== 'active') {
    return { error: 'create_expense_template_item can only be used on active loans' };
  }
  // Refuse rather than pick a winner: silently ignoring one of the two would leave the
  // user looking at a link they didn't ask for, or a stray expense they can't explain.
  if (body.expense_template_item_id !== undefined && body.expense_template_item_id !== null) {
    return { error: 'Provide either expense_template_item_id or create_expense_template_item, not both' };
  }

  const name = overrides.name !== undefined ? String(overrides.name).trim() : validated.name;
  if (!name) return { error: 'create_expense_template_item.name cannot be empty' };

  // Default to the loan's own stable payment, so the coverage check starts out green.
  const defaultValue = computeMonthlyPayment(
    validated.remaining_balance,
    validated.interest_rate,
    computeTermFromAnchor(validated.balance_as_of, validated.end_date)
  );
  const value = overrides.value !== undefined ? Number(overrides.value) : Math.round(defaultValue * 100) / 100;
  if (isNaN(value) || value < 0) return { error: 'create_expense_template_item.value must be a non-negative number' };

  const dayOfPayment =
    overrides.day_of_payment !== undefined ? Number(overrides.day_of_payment) : validated.day_of_payment;
  if (!Number.isInteger(dayOfPayment) || dayOfPayment < 1 || dayOfPayment > 31) {
    return { error: 'create_expense_template_item.day_of_payment must be an integer between 1 and 31' };
  }

  const maxPos = db
    .prepare("SELECT MAX(position) as mp FROM expense_template_items WHERE dossier_id = ? AND section = 'expense'")
    .get(dossierId);
  const itemId = uuidv4();
  db.prepare(
    `INSERT INTO expense_template_items (id, dossier_id, section, name, type, value, day_of_payment, position, classification, paperless_tag_id, exclude_from_emergency_fund, account_id)
     VALUES (?, ?, 'expense', ?, 'Fixed', ?, ?, ?, 'must', NULL, 0, NULL)`
    // classification is 'must' by definition — a loan instalment is not discretionary.
  ).run(itemId, dossierId, name, value, dayOfPayment, (maxPos.mp ?? -1) + 1);

  return { itemId, name };
}

// GET /loans
router.get('/loans', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const loans = db
    .prepare('SELECT * FROM loans WHERE dossier_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json(loans.map((loan) => ({ ...loan, ...computeLoanValues(loan, req.params.id) })));
});

// POST /loans
router.post('/loans', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });

  const validated = validateLoanFields(req.body, null, req.params.id);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const id = uuidv4();
  let createdExpense = null;
  try {
    db.transaction(() => {
      const created = resolveCreateExpenseItem(req.body, validated, req.params.id);
      if (created.error) throw Object.assign(new Error(created.error), { status: 400 });
      if (created.itemId) {
        validated.expense_template_item_id = created.itemId;
        createdExpense = created;
      }
      db.prepare(
        `INSERT INTO loans (id, dossier_id, name, status, interest_rate, salary, principal, term_months, remaining_balance, end_date, day_of_payment, balance_as_of, expense_template_item_id, down_payment, taeg, opening_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.params.id,
        validated.name,
        validated.status,
        validated.interest_rate,
        validated.salary,
        validated.principal,
        validated.term_months,
        validated.remaining_balance,
        validated.end_date,
        validated.day_of_payment,
        validated.balance_as_of,
        validated.expense_template_item_id,
        validated.down_payment,
        validated.taeg,
        validated.opening_fee
      );
    })();
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    throw err;
  }

  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  console.log(
    `[loans] Created loan "${validated.name}" (${id}) in dossier ${req.params.id} by user ${req.user.username}` +
      (createdExpense ? ` with new Fixed expense "${createdExpense.name}" (${createdExpense.itemId})` : '')
  );
  res.status(201).json({ ...loan, ...computeLoanValues(loan, req.params.id) });
});

// GET /loans/:loanId
router.get('/loans/:loanId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const loan = db
    .prepare('SELECT * FROM loans WHERE id = ? AND dossier_id = ?')
    .get(req.params.loanId, req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  res.json({ ...loan, ...computeLoanValues(loan, req.params.id) });
});

// GET /loans/:loanId/payment-status
//
// Per-period tracking for the loan's payment plan. The plan itself stays client-side (it's
// a deterministic projection of fields the loan response already carries, and the scenario
// calculators need the same math per-keystroke anyway); what the client *can't* derive is
// whether a given month was actually paid, since that lives in expense_cycles/cycle_items.
//
// A loan's payment is tracked through the Fixed monthly expense funding it: the month counts
// as paid when the cycle covering its due date has that template item's cycle_items row
// ticked. `paid: null` means "unknowable" — no link, no cycle, or no matching item — and is
// deliberately distinct from `false` ("there is a row and it isn't ticked"). The UI must
// never render null as unpaid.
router.get('/loans/:loanId/payment-status', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const loan = db
    .prepare('SELECT * FROM loans WHERE id = ? AND dossier_id = ?')
    .get(req.params.loanId, req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  if (loan.status !== 'active' || !loan.expense_template_item_id) {
    return res.json({ tracking: 'unlinked', linked_item: null, shared_with: [], periods: [] });
  }
  const item = db
    .prepare('SELECT id, name, value FROM expense_template_items WHERE id = ? AND dossier_id = ?')
    .get(loan.expense_template_item_id, req.params.id);
  if (!item) {
    return res.json({ tracking: 'unlinked', linked_item: null, shared_with: [], periods: [] });
  }

  // Nothing stops two loans funding one direct debit, and the FK isn't unique. They then
  // share a single paid flag and each independently reads the same budgeted value as
  // "covering" it, so name the others rather than let the coverage badge quietly mislead.
  const sharedWith = db
    .prepare('SELECT name FROM loans WHERE dossier_id = ? AND expense_template_item_id = ? AND id != ?')
    .all(req.params.id, item.id, loan.id)
    .map((r) => r.name);

  const anchor = loan.balance_as_of && /^\d{4}-\d{2}$/.test(loan.balance_as_of)
    ? { year: Number(loan.balance_as_of.split('-')[0]), month: Number(loan.balance_as_of.split('-')[1]) }
    : effectiveCurrentPeriod(loan.day_of_payment);
  const current = effectiveCurrentPeriod(loan.day_of_payment);
  const termFromAnchor = computeTermFromAnchor(loan.balance_as_of, loan.end_date);

  // Anchor through the current period inclusive. Future months can never be paid, so
  // emitting them would only bloat the payload; the hard cap keeps a hand-edited anchor
  // from asking for thousands of rows.
  const anchorIdx = anchor.year * 12 + anchor.month;
  const span = Math.min(
    (current.year * 12 + current.month) - anchorIdx + 1,
    termFromAnchor != null && termFromAnchor >= 1 ? termFromAnchor : Infinity,
    240
  );

  // Cycles are loaded once and scanned in memory rather than queried per period — a 30-year
  // mortgage would otherwise be hundreds of round trips. actual_start_date/actual_end_date
  // are backfilled for every row by migration 039, but the recompute fallback matches what
  // annual-expenses.js does and costs nothing.
  const cycles = db
    .prepare(
      `SELECT id, year, month, is_closed, cycle_start_day, actual_start_date, actual_end_date
       FROM expense_cycles WHERE dossier_id = ? ORDER BY year, month`
    )
    .all(req.params.id)
    .map((c) => ({
      ...c,
      start: c.actual_start_date
        ? fromIsoDate(c.actual_start_date)
        : new Date(c.year, c.month - 1, c.cycle_start_day ?? 25),
      end: c.actual_end_date
        ? fromIsoDate(c.actual_end_date)
        : new Date(c.year, c.month, (c.cycle_start_day ?? 25) - 1),
    }));

  const findItemById = db.prepare(
    'SELECT id, paid, value FROM cycle_items WHERE cycle_id = ? AND template_item_id = ? LIMIT 1'
  );
  const findItemByName = db.prepare(
    "SELECT id, paid, value FROM cycle_items WHERE cycle_id = ? AND section = 'expense' AND name = ? LIMIT 1"
  );

  const periods = [];
  for (let i = 0; i < span; i++) {
    const idx = anchorIdx + i;
    const year = Math.floor((idx - 1) / 12);
    const month = ((idx - 1) % 12) + 1;
    const day = Math.min(loan.day_of_payment ?? 1, daysInMonth(year, month));
    const dueDate = new Date(year, month - 1, day);

    // First match wins: cycles can genuinely overlap via PATCH /cycles { resolve_overlap:
    // 'ignore' }, and a due date landing exactly on a cycle_start_day belongs to the cycle
    // starting that day — the same inclusive-start rule annual-expense installments use.
    const cycle = cycles.find((c) => dueDate >= c.start && dueDate <= c.end) ?? null;

    let cycleItem = null;
    let matchedBy = null;
    if (cycle) {
      cycleItem = findItemById.get(cycle.id, item.id) ?? null;
      if (cycleItem) {
        matchedBy = 'id';
      } else {
        // expense-template bulk-replace deletes and reinserts every item with fresh UUIDs
        // and re-links the loan by name, which would otherwise orphan all payment history
        // (surviving cycle_items still point at the deleted id). Fall back to the name.
        cycleItem = findItemByName.get(cycle.id, item.name) ?? null;
        if (cycleItem) matchedBy = 'name';
      }
    }

    periods.push({
      period: `${year}-${String(month).padStart(2, '0')}`,
      due_date: toIsoDate(dueDate),
      cycle_id: cycle?.id ?? null,
      cycle_year: cycle?.year ?? null,
      cycle_month: cycle?.month ?? null,
      cycle_is_closed: cycle ? !!cycle.is_closed : null,
      item_id: cycleItem?.id ?? null,
      item_value: cycleItem?.value ?? null,
      matched_by: matchedBy,
      paid: cycleItem ? !!cycleItem.paid : null,
    });
  }

  res.json({
    tracking: 'linked',
    linked_item: { id: item.id, name: item.name, value: item.value },
    shared_with: sharedWith,
    periods,
  });
});

// PUT /loans/:loanId
router.put('/loans/:loanId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const loan = db
    .prepare('SELECT * FROM loans WHERE id = ? AND dossier_id = ?')
    .get(req.params.loanId, req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const validated = validateLoanFields(req.body, loan, req.params.id);
  if (validated.error) return res.status(400).json({ error: validated.error });

  let createdExpense = null;
  try {
    db.transaction(() => {
      const created = resolveCreateExpenseItem(req.body, validated, req.params.id);
      if (created.error) throw Object.assign(new Error(created.error), { status: 400 });
      if (created.itemId) {
        validated.expense_template_item_id = created.itemId;
        createdExpense = created;
      }
      db.prepare(
        `UPDATE loans SET name = ?, status = ?, interest_rate = ?, salary = ?, principal = ?, term_months = ?,
         remaining_balance = ?, end_date = ?, day_of_payment = ?, balance_as_of = ?, expense_template_item_id = ?, down_payment = ?, taeg = ?, opening_fee = ? WHERE id = ?`
      ).run(
        validated.name,
        validated.status,
        validated.interest_rate,
        validated.salary,
        validated.principal,
        validated.term_months,
        validated.remaining_balance,
        validated.end_date,
        validated.day_of_payment,
        validated.balance_as_of,
        validated.expense_template_item_id,
        validated.down_payment,
        validated.taeg,
        validated.opening_fee,
        loan.id
      );
    })();
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    throw err;
  }

  const updated = db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id);
  console.log(
    `[loans] Updated loan "${validated.name}" (${loan.id}) in dossier ${req.params.id} by user ${req.user.username}` +
      (createdExpense ? ` with new Fixed expense "${createdExpense.name}" (${createdExpense.itemId})` : '')
  );
  res.json({ ...updated, ...computeLoanValues(updated, req.params.id) });
});

// DELETE /loans/:loanId
router.delete('/loans/:loanId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const loan = db
    .prepare('SELECT * FROM loans WHERE id = ? AND dossier_id = ?')
    .get(req.params.loanId, req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  db.prepare('DELETE FROM loans WHERE id = ?').run(loan.id);
  console.log(`[loans] Deleted loan "${loan.name}" (${loan.id}) in dossier ${req.params.id} by user ${req.user.username}`);
  res.status(204).end();
});

module.exports = router;
// Shared with the AI Advisor context builder
module.exports.computeLoanValues = computeLoanValues;
module.exports.computeMonthlyPayment = computeMonthlyPayment;
module.exports.computeMonthsLeft = computeMonthsLeft;
module.exports.daysInMonth = daysInMonth;
module.exports.validateLoanFields = validateLoanFields;
module.exports.effectiveCurrentPeriod = effectiveCurrentPeriod;
module.exports.computeTermFromAnchor = computeTermFromAnchor;
module.exports.computePaymentsMade = computePaymentsMade;
module.exports.projectBalance = projectBalance;
