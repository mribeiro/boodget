const { db, migrations } = require('../../src/db');
const { createUser, createDossier, createLoan } = require('../fixtures/builders');
const { computeLoanValues, effectiveCurrentPeriod } = require('../../src/routes/loans');

// A fresh test database already has every migration applied, so a backfill's behaviour is
// otherwise unreachable: these tests hand-build the pre-migration state (a NULL anchor) and
// re-run the migration's up(), which is idempotent by design.
describe('042_add_balance_as_of_to_loans', () => {
  const migration = migrations.find((m) => m.id === '042_add_balance_as_of_to_loans');

  function activeLoanWithNoAnchor(overrides = {}) {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const loan = createLoan(db, {
      dossierId: dossier.id, status: 'active', interest_rate: 4.5,
      remaining_balance: 9000, end_date: '2099-12', day_of_payment: 8,
      balance_as_of: null, ...overrides,
    });
    return { dossier, loan };
  }

  it('is registered in the migrations list', () => {
    // Deliberately not asserting it's *last*: any migration merged in alongside this one
    // would break that with nothing actually wrong (which is exactly what happened when
    // 041_add_avatar_to_users landed on main first). Existence is the part that matters.
    expect(migration).toBeDefined();
  });

  it('backfills an active loan with its own effective current period', () => {
    const { loan } = activeLoanWithNoAnchor();
    migration.up();

    const after = db.prepare('SELECT balance_as_of FROM loans WHERE id = ?').get(loan.id);
    const { year, month } = effectiveCurrentPeriod(8);
    expect(after.balance_as_of).toBe(`${year}-${String(month).padStart(2, '0')}`);
  });

  it('is a visual no-op: every computed figure reads the same before and after', () => {
    // This is the whole justification for backfilling rather than leaving the column NULL —
    // nothing on any screen may move on deploy day; loans merely stop drifting afterwards.
    const { dossier, loan } = activeLoanWithNoAnchor();
    const before = computeLoanValues(db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id), dossier.id);

    migration.up();

    const after = computeLoanValues(db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id), dossier.id);
    expect(after.monthly_payment).toBe(before.monthly_payment);
    expect(after.months_left).toBe(before.months_left);
    expect(after.current_balance).toBe(before.current_balance);
    expect(after.payments_made).toBe(0);
  });

  it('leaves draft loans alone', () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const loan = createLoan(db, { dossierId: dossier.id, status: 'draft' });

    migration.up();

    expect(db.prepare('SELECT balance_as_of FROM loans WHERE id = ?').get(loan.id).balance_as_of).toBeNull();
  });

  it('skips an already-matured loan, which has no plan left to anchor', () => {
    const { loan } = activeLoanWithNoAnchor({ end_date: '2000-01' });
    migration.up();
    expect(db.prepare('SELECT balance_as_of FROM loans WHERE id = ?').get(loan.id).balance_as_of).toBeNull();
  });

  it('never overwrites an anchor already on record', () => {
    const { loan } = activeLoanWithNoAnchor({ balance_as_of: '2024-01' });
    migration.up();
    expect(db.prepare('SELECT balance_as_of FROM loans WHERE id = ?').get(loan.id).balance_as_of).toBe('2024-01');
  });
});
