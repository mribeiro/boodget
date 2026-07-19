const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');

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
  return new Date(year, month, 0).getDate();
}

// Months remaining until (and including) an "end_date" (YYYY-MM), counted from the
// current calendar month — e.g. an end_date equal to this month means 1 payment left.
// Never stored: always derived fresh from "now" so the user never has to update it.
// When dayOfPayment is known, the current month only counts as still-owing if that day
// hasn't passed yet — once it has, this month's payment is treated as already made, and
// counting starts from next month instead (dayOfPayment clamped to the current month's
// length, so e.g. 31 means "last day" in a 30-day month).
function computeMonthsLeft(endDate, dayOfPayment) {
  if (!endDate) return null;
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const now = new Date();
  let curYear = now.getFullYear();
  let curMonth = now.getMonth() + 1;
  if (dayOfPayment != null) {
    const effectiveDay = Math.min(dayOfPayment, daysInMonth(curYear, curMonth));
    if (now.getDate() >= effectiveDay) {
      curMonth += 1;
      if (curMonth > 12) { curMonth = 1; curYear += 1; }
    }
  }
  const months = (endYear * 12 + endMonth) - (curYear * 12 + curMonth) + 1;
  return Math.max(0, months);
}

function computeLoanValues(loan, dossierId) {
  const monthsLeft = loan.status === 'active' ? computeMonthsLeft(loan.end_date, loan.day_of_payment) : null;

  const monthlyPayment =
    loan.status === 'draft'
      ? computeMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
      : computeMonthlyPayment(loan.remaining_balance, loan.interest_rate, monthsLeft);

  const salaryPct =
    loan.salary != null && loan.salary > 0 ? (monthlyPayment / loan.salary) * 100 : null;

  // Manually-set dossier setting, not derived from any cycle — a one-off bonus/prize
  // in a cycle's salary shouldn't silently skew loan prefills or the % of salary calc.
  const dossierRow = db.prepare('SELECT reference_salary FROM dossiers WHERE id = ?').get(dossierId);
  const referenceSalary = dossierRow?.reference_salary ?? null;

  let linkedItem = null;
  let covered = null;
  let coverageDifference = null;
  if (loan.status === 'active' && loan.expense_template_item_id) {
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

  // Interest still left to pay from now to payoff, using the loan's *current* balance/term —
  // the forward-looking counterpart to total_interest's backward-looking full-term figure.
  const remainingInterest =
    loan.status === 'active' ? monthlyPayment * monthsLeft - loan.remaining_balance : null;

  return {
    monthly_payment: monthlyPayment,
    months_left: monthsLeft,
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
// (shared parsing/validation). An explicit null while active is rejected too whenever a value
// already exists, since PUT is a partial update and an unrelated field edit must never
// silently erase this historical-record data (only omitting the field entirely carries it
// forward unchanged).
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
      return { error: `${field} cannot be cleared on an active loan` };
    }
    value = parsed;
  }
  return { value };
}

function validateLoanFields(body, existing) {
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
  const principal = body.principal !== undefined ? (body.principal === null || body.principal === '' ? null : Number(body.principal)) : existingPrincipal;
  if (body.principal !== undefined && principal == null && status !== 'draft' && existingPrincipal != null) {
    return { error: 'principal cannot be cleared on an active loan' };
  }

  const existingTermMonths = existing?.term_months ?? null;
  const termMonths = body.term_months !== undefined ? (body.term_months === null || body.term_months === '' ? null : Number(body.term_months)) : existingTermMonths;
  if (body.term_months !== undefined && termMonths == null && status !== 'draft' && existingTermMonths != null) {
    return { error: 'term_months cannot be cleared on an active loan' };
  }

  const remainingBalance = body.remaining_balance !== undefined ? (body.remaining_balance === null || body.remaining_balance === '' ? null : Number(body.remaining_balance)) : existing?.remaining_balance ?? null;

  let endDate = existing?.end_date ?? null;
  if (body.end_date !== undefined) {
    endDate = body.end_date === null || body.end_date === '' ? null : String(body.end_date);
    if (endDate != null && status !== 'active') {
      return { error: 'end_date can only be set on active loans' };
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

  if (status === 'draft') {
    if (!(principal > 0)) return { error: 'principal must be a positive number for draft loans' };
    if (!Number.isInteger(termMonths) || termMonths < 1) {
      return { error: 'term_months must be an integer ≥ 1 for draft loans' };
    }
    endDate = null;
    dayOfPayment = null;
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
    remaining_balance: remainingBalance,
    down_payment: downPayment,
    taeg,
    opening_fee: openingFee,
  };
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

  const validated = validateLoanFields(req.body, null);
  if (validated.error) return res.status(400).json({ error: validated.error });

  let expenseTemplateItemId = null;
  if (req.body.expense_template_item_id !== undefined && req.body.expense_template_item_id !== null) {
    if (validated.status === 'draft') {
      return res.status(400).json({ error: 'A draft loan cannot be linked to an expense template item' });
    }
    const item = db
      .prepare("SELECT id FROM expense_template_items WHERE id = ? AND dossier_id = ? AND section = 'expense' AND type = 'Fixed'")
      .get(req.body.expense_template_item_id, req.params.id);
    if (!item) return res.status(400).json({ error: 'expense_template_item_id must reference a Fixed expense in this dossier' });
    expenseTemplateItemId = item.id;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO loans (id, dossier_id, name, status, interest_rate, salary, principal, term_months, remaining_balance, end_date, day_of_payment, expense_template_item_id, down_payment, taeg, opening_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    expenseTemplateItemId,
    validated.down_payment,
    validated.taeg,
    validated.opening_fee
  );

  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  console.log(`[loans] Created loan "${validated.name}" (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
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

// PUT /loans/:loanId
router.put('/loans/:loanId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const loan = db
    .prepare('SELECT * FROM loans WHERE id = ? AND dossier_id = ?')
    .get(req.params.loanId, req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const validated = validateLoanFields(req.body, loan);
  if (validated.error) return res.status(400).json({ error: validated.error });

  // Demoting active → draft always clears the expense link.
  let expenseTemplateItemId = loan.expense_template_item_id;
  if (validated.status === 'draft') {
    expenseTemplateItemId = null;
  } else if (req.body.expense_template_item_id !== undefined) {
    if (req.body.expense_template_item_id === null) {
      expenseTemplateItemId = null;
    } else {
      const item = db
        .prepare("SELECT id FROM expense_template_items WHERE id = ? AND dossier_id = ? AND section = 'expense' AND type = 'Fixed'")
        .get(req.body.expense_template_item_id, req.params.id);
      if (!item) return res.status(400).json({ error: 'expense_template_item_id must reference a Fixed expense in this dossier' });
      expenseTemplateItemId = item.id;
    }
  }

  db.prepare(
    `UPDATE loans SET name = ?, status = ?, interest_rate = ?, salary = ?, principal = ?, term_months = ?,
     remaining_balance = ?, end_date = ?, day_of_payment = ?, expense_template_item_id = ?, down_payment = ?, taeg = ?, opening_fee = ? WHERE id = ?`
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
    expenseTemplateItemId,
    validated.down_payment,
    validated.taeg,
    validated.opening_fee,
    loan.id
  );

  const updated = db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id);
  console.log(`[loans] Updated loan "${validated.name}" (${loan.id}) in dossier ${req.params.id} by user ${req.user.username}`);
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
