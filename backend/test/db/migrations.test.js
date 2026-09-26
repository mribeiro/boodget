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

describe('047_add_is_admin_to_users', () => {
  const migration = migrations.find((m) => m.id === '047_add_is_admin_to_users');

  it('promotes the oldest local user when no admin exists, and nobody else', () => {
    db.prepare('UPDATE users SET is_admin = 0').run();
    db.prepare("UPDATE users SET created_at = '2030-01-01 00:00:00'").run();
    const sso = createUser(db, { is_oidc: true });
    const first = createUser(db);
    const second = createUser(db);
    db.prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(sso.id);
    db.prepare("UPDATE users SET created_at = '2021-01-01 00:00:00' WHERE id = ?").run(first.id);
    db.prepare("UPDATE users SET created_at = '2022-01-01 00:00:00' WHERE id = ?").run(second.id);

    migration.up();

    const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all().map((r) => r.id);
    expect(admins).toEqual([first.id]);
  });

  it('leaves existing admins alone when re-run', () => {
    const extra = createUser(db, { is_admin: true });
    const before = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id').all();

    migration.up();

    expect(db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id').all()).toEqual(before);
    expect(before.map((r) => r.id)).toContain(extra.id);
  });
});

describe('048_add_timezone_to_notification_settings', () => {
  const migration = migrations.find((m) => m.id === '048_add_timezone_to_notification_settings');
  afterEach(() => vi.useRealTimers());

  it("marks users whose UTC send time already passed today as done, so deploy day doesn't double-send", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const early = createUser(db);
    const late = createUser(db);
    const insert = db.prepare(
      'INSERT INTO user_notification_settings (user_id, send_hour, send_minute) VALUES (?, ?, ?)'
    );
    insert.run(early.id, 9, 0);
    insert.run(late.id, 18, 30);

    migration.up();

    const lastEvaluated = (id) =>
      db.prepare('SELECT last_evaluated_date FROM user_notification_settings WHERE user_id = ?').get(id).last_evaluated_date;
    expect(lastEvaluated(early.id)).toBe('2026-07-15');
    expect(lastEvaluated(late.id)).toBeNull();
  });
});
