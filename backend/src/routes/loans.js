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

function computeLoanValues(loan, dossierId) {
  const monthlyPayment =
    loan.status === 'draft'
      ? computeMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
      : computeMonthlyPayment(loan.remaining_balance, loan.interest_rate, loan.months_left);

  const salaryPct =
    loan.salary != null && loan.salary > 0 ? (monthlyPayment / loan.salary) * 100 : null;

  const latestCycle = db
    .prepare('SELECT salary FROM expense_cycles WHERE dossier_id = ? ORDER BY year DESC, month DESC LIMIT 1')
    .get(dossierId);
  const latestCycleSalary = latestCycle ? latestCycle.salary : null;

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

  const purchasePrice =
    loan.status === 'draft' && loan.down_payment != null ? loan.principal + loan.down_payment : null;

  // Total amount payable (MTIC) — a simplified estimate (principal + total interest + the
  // one modeled fee); the official Portuguese MTIC can include other charges (stamp duty,
  // insurance) this app doesn't track.
  const totalAmountPayable =
    loan.status === 'draft' ? monthlyPayment * loan.term_months + (loan.opening_fee || 0) : null;

  return {
    monthly_payment: monthlyPayment,
    salary_pct: salaryPct,
    latest_cycle_salary: latestCycleSalary,
    linked_item: linkedItem,
    covered,
    coverage_difference: coverageDifference,
    purchase_price: purchasePrice,
    total_amount_payable: totalAmountPayable,
  };
}

// down_payment, taeg, and opening_fee are all nullable, draft-only, non-negative numerics
// with the same "cleared on promotion to active" behavior — shared parsing/validation.
function parseDraftOnlyNullableNumber(body, existing, field, status) {
  let value = existing?.[field] ?? null;
  if (body[field] !== undefined) {
    const parsed = body[field] === null || body[field] === '' ? null : Number(body[field]);
    if (parsed != null) {
      if (isNaN(parsed) || parsed < 0) {
        return { error: `${field} must be null or a non-negative number` };
      }
      if (status !== 'draft') {
        return { error: `${field} can only be set on draft loans` };
      }
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

  const principal = body.principal !== undefined ? (body.principal === null || body.principal === '' ? null : Number(body.principal)) : existing?.principal ?? null;
  const termMonths = body.term_months !== undefined ? (body.term_months === null || body.term_months === '' ? null : Number(body.term_months)) : existing?.term_months ?? null;
  const remainingBalance = body.remaining_balance !== undefined ? (body.remaining_balance === null || body.remaining_balance === '' ? null : Number(body.remaining_balance)) : existing?.remaining_balance ?? null;
  const monthsLeft = body.months_left !== undefined ? (body.months_left === null || body.months_left === '' ? null : Number(body.months_left)) : existing?.months_left ?? null;

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
  } else {
    if (!(remainingBalance > 0)) return { error: 'remaining_balance must be a positive number for active loans' };
    if (!Number.isInteger(monthsLeft) || monthsLeft < 1) {
      return { error: 'months_left must be an integer ≥ 1 for active loans' };
    }
    downPayment = null;
    taeg = null;
    openingFee = null;
  }

  return {
    name,
    status,
    interest_rate: interestRate,
    salary,
    principal,
    term_months: termMonths,
    remaining_balance: remainingBalance,
    months_left: monthsLeft,
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
    `INSERT INTO loans (id, dossier_id, name, status, interest_rate, salary, principal, term_months, remaining_balance, months_left, expense_template_item_id, down_payment, taeg, opening_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    validated.months_left,
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
     remaining_balance = ?, months_left = ?, expense_template_item_id = ?, down_payment = ?, taeg = ?, opening_fee = ? WHERE id = ?`
  ).run(
    validated.name,
    validated.status,
    validated.interest_rate,
    validated.salary,
    validated.principal,
    validated.term_months,
    validated.remaining_balance,
    validated.months_left,
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
