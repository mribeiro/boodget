const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const {
  createUser,
  createDossier,
  createAccount,
  createMonth,
  createBankConnection,
  createBankConnectionAccount,
  createBankConnectionRequest,
} = require('../fixtures/builders');
const supertest = require('supertest');

async function loggedInAgent(app, user) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
  return agent;
}

describe('Bank connections — settings gating', () => {
  it('GET /bank/aspsps returns 400 when Enable Banking is not configured', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/bank/aspsps?country=FI`);
    expect(res.status).toBe(400);
  });

  it('POST /bank/connections/start returns 400 when Enable Banking is not configured', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/bank/connections/start`)
      .send({ aspsp_name: 'Test Bank', aspsp_country: 'FI' });
    expect(res.status).toBe(400);
  });

  it('POST /bank/connections/start returns 503 when configured but ENABLE_BANKING_REDIRECT_URI is unset', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, {
      creatorId: user.id,
      enablebanking_application_id: 'app-id',
      enablebanking_private_key: 'not-a-real-key',
    });
    delete process.env.ENABLE_BANKING_REDIRECT_URI;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/bank/connections/start`)
      .send({ aspsp_name: 'Test Bank', aspsp_country: 'FI' });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/bank/callback', () => {
  it('returns 410 for an unknown state', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post('/api/bank/callback').send({ code: 'abc', state: 'does-not-exist' });
    expect(res.status).toBe(410);
  });

  it('returns 410 for an expired state', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const request = createBankConnectionRequest(db, {
      dossierId: dossier.id,
      userId: user.id,
      expires_at: new Date(Date.now() - 60000).toISOString(),
    });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.post('/api/bank/callback').send({ code: 'abc', state: request.state });
    expect(res.status).toBe(410);
  });

  it('returns 403 when the logged-in user lacks access to the pending request\'s dossier', async () => {
    const owner = createUser(db);
    const outsider = createUser(db);
    const dossier = createDossier(db, { creatorId: owner.id });
    const request = createBankConnectionRequest(db, { dossierId: dossier.id, userId: owner.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, outsider);

    const res = await agent.post('/api/bank/callback').send({ code: 'abc', state: request.state });
    expect(res.status).toBe(403);
  });

  it('is single-use — a second call with the same state also 410s', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const request = createBankConnectionRequest(db, { dossierId: dossier.id, userId: user.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    // First call fails past the state lookup (no real Enable Banking config to exchange
    // against), but must still consume the pending row.
    await agent.post('/api/bank/callback').send({ code: 'abc', state: request.state });
    const second = await agent.post('/api/bank/callback').send({ code: 'abc', state: request.state });
    expect(second.status).toBe(410);
  });
});

describe('PATCH /bank/connections/:connectionId/accounts/:bankAccountId', () => {
  it('returns 400 when mapping to an archived account', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id, archived: true });
    const connection = createBankConnection(db, { dossierId: dossier.id });
    const bankAccount = createBankConnectionAccount(db, { connectionId: connection.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/bank/connections/${connection.id}/accounts/${bankAccount.id}`)
      .send({ account_id: account.id });
    expect(res.status).toBe(400);
  });

  it('returns 409 when the account is already mapped to a different bank account', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const connection = createBankConnection(db, { dossierId: dossier.id });
    createBankConnectionAccount(db, { connectionId: connection.id, account_id: account.id });
    const secondBankAccount = createBankConnectionAccount(db, { connectionId: connection.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/bank/connections/${connection.id}/accounts/${secondBankAccount.id}`)
      .send({ account_id: account.id });
    expect(res.status).toBe(409);
  });

  it('returns 404 when the account belongs to a different dossier', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const otherDossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: otherDossier.id });
    const connection = createBankConnection(db, { dossierId: dossier.id });
    const bankAccount = createBankConnectionAccount(db, { connectionId: connection.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/bank/connections/${connection.id}/accounts/${bankAccount.id}`)
      .send({ account_id: account.id });
    expect(res.status).toBe(404);
  });

  it('sets the mapping on a valid, unmapped, non-archived account in the same dossier', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const connection = createBankConnection(db, { dossierId: dossier.id });
    const bankAccount = createBankConnectionAccount(db, { connectionId: connection.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/bank/connections/${connection.id}/accounts/${bankAccount.id}`)
      .send({ account_id: account.id });
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe(account.id);
  });

  it('clears the mapping when account_id is null', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const connection = createBankConnection(db, { dossierId: dossier.id });
    const bankAccount = createBankConnectionAccount(db, { connectionId: connection.id, account_id: account.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .patch(`/api/dossiers/${dossier.id}/bank/connections/${connection.id}/accounts/${bankAccount.id}`)
      .send({ account_id: null });
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBeNull();
  });
});

describe('DELETE /bank/connections/:connectionId', () => {
  it('marks the connection revoked but leaves the account mapping untouched', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const connection = createBankConnection(db, { dossierId: dossier.id });
    const bankAccount = createBankConnectionAccount(db, { connectionId: connection.id, account_id: account.id });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.delete(`/api/dossiers/${dossier.id}/bank/connections/${connection.id}`);
    expect(res.status).toBe(204);

    const updatedConnection = db.prepare('SELECT * FROM bank_connections WHERE id = ?').get(connection.id);
    expect(updatedConnection.status).toBe('revoked');
    const updatedBankAccount = db.prepare('SELECT * FROM bank_connection_accounts WHERE id = ?').get(bankAccount.id);
    expect(updatedBankAccount.account_id).toBe(account.id);
  });
});

describe('Month bank-balance endpoints', () => {
  it('GET balances-preview returns 400 when not configured', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1 });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent.get(`/api/dossiers/${dossier.id}/bank/months/${month.id}/balances-preview`);
    expect(res.status).toBe(400);
  });

  it('POST balances-apply returns 400 when an account is not part of the month snapshot', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, accountIds: [] });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/bank/months/${month.id}/balances-apply`)
      .send({ entries: [{ account_id: account.id, value: 100 }] });
    expect(res.status).toBe(400);
  });

  it('POST balances-apply only updates existing month_entries rows, never inserts', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, accountIds: [account.id] });
    const before = db.prepare('SELECT COUNT(*) AS c FROM month_entries WHERE month_id = ?').get(month.id).c;
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/bank/months/${month.id}/balances-apply`)
      .send({ entries: [{ account_id: account.id, value: 1234.56 }] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const after = db.prepare('SELECT COUNT(*) AS c FROM month_entries WHERE month_id = ?').get(month.id).c;
    expect(after).toBe(before);
    const entry = db
      .prepare('SELECT value FROM month_entries WHERE month_id = ? AND account_id = ?')
      .get(month.id, account.id);
    expect(entry.value).toBe(1234.56);
  });

  it('POST balances-apply rejects a non-finite value', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, accountIds: [account.id] });
    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);

    const res = await agent
      .post(`/api/dossiers/${dossier.id}/bank/months/${month.id}/balances-apply`)
      .send({ entries: [{ account_id: account.id, value: 'not-a-number' }] });
    expect(res.status).toBe(400);
  });
});

describe('GET /months/:monthId bankable_accounts_count', () => {
  it('counts only accounts mapped via an active connection and present in this month\'s snapshot', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const mappedAccount = createAccount(db, { dossierId: dossier.id });
    const unmappedAccount = createAccount(db, { dossierId: dossier.id });
    const month = createMonth(db, {
      dossierId: dossier.id,
      year: 2026,
      month: 1,
      accountIds: [mappedAccount.id, unmappedAccount.id],
    });
    const connection = createBankConnection(db, { dossierId: dossier.id, status: 'active' });
    createBankConnectionAccount(db, { connectionId: connection.id, account_id: mappedAccount.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/months/${month.id}`);
    expect(res.status).toBe(200);
    expect(res.body.bankable_accounts_count).toBe(1);
  });

  it('does not count accounts mapped via a revoked connection', async () => {
    const user = createUser(db);
    const dossier = createDossier(db, { creatorId: user.id });
    const account = createAccount(db, { dossierId: dossier.id });
    const month = createMonth(db, { dossierId: dossier.id, year: 2026, month: 1, accountIds: [account.id] });
    const connection = createBankConnection(db, { dossierId: dossier.id, status: 'revoked' });
    createBankConnectionAccount(db, { connectionId: connection.id, account_id: account.id });

    const app = buildTestApp();
    const agent = await loggedInAgent(app, user);
    const res = await agent.get(`/api/dossiers/${dossier.id}/months/${month.id}`);
    expect(res.status).toBe(200);
    expect(res.body.bankable_accounts_count).toBe(0);
  });
});
