const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const {
  resolveEnableBankingConfig,
  listAspsps,
  startAuth,
  getBalances,
  isConnectionExpired,
} = require('../lib/enablebanking');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

function connectionWithAccounts(connection) {
  const accounts = db
    .prepare('SELECT * FROM bank_connection_accounts WHERE connection_id = ?')
    .all(connection.id);
  return {
    ...connection,
    is_expired: connection.status === 'active' && isConnectionExpired(connection.valid_until),
    accounts,
  };
}

// GET /api/dossiers/:id/bank/aspsps?country=XX
router.get('/bank/aspsps', async (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveEnableBankingConfig(req.params.id);
  if (!config.configured) return res.status(400).json({ error: 'Enable Banking is not configured' });
  const country = req.query.country;
  if (!country) return res.status(400).json({ error: 'country query param is required' });
  try {
    const result = await listAspsps(config, country);
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// POST /api/dossiers/:id/bank/connections/start
router.post('/bank/connections/start', async (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveEnableBankingConfig(req.params.id);
  if (!config.configured) return res.status(400).json({ error: 'Enable Banking is not configured' });

  const { aspsp_name, aspsp_country, psu_type } = req.body;
  if (!aspsp_name || !aspsp_country) {
    return res.status(400).json({ error: 'aspsp_name and aspsp_country are required' });
  }

  const redirectUrl = config.redirectUri;
  const state = uuidv4();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  try {
    const authResult = await startAuth(config, {
      aspspName: aspsp_name,
      aspspCountry: aspsp_country,
      state,
      redirectUrl,
      psuType: psu_type,
    });
    db.prepare(
      'INSERT INTO bank_connection_requests (state, dossier_id, user_id, aspsp_name, aspsp_country, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(state, req.params.id, req.user.id, aspsp_name, aspsp_country, expiresAt);
    console.log(`[enable-banking] dossier=${req.params.id} started connection to ${aspsp_name}/${aspsp_country}`);
    res.json({ url: authResult.url });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// GET /api/dossiers/:id/bank/connections
router.get('/bank/connections', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const connections = db
    .prepare('SELECT * FROM bank_connections WHERE dossier_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  res.json(connections.map(connectionWithAccounts));
});

// PATCH /api/dossiers/:id/bank/connections/:connectionId/accounts/:bankAccountId
router.patch('/bank/connections/:connectionId/accounts/:bankAccountId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const connection = db
    .prepare('SELECT * FROM bank_connections WHERE id = ? AND dossier_id = ?')
    .get(req.params.connectionId, req.params.id);
  if (!connection) return res.status(404).json({ error: 'Bank connection not found' });
  const bankAccount = db
    .prepare('SELECT * FROM bank_connection_accounts WHERE id = ? AND connection_id = ?')
    .get(req.params.bankAccountId, req.params.connectionId);
  if (!bankAccount) return res.status(404).json({ error: 'Bank account not found' });

  const { account_id } = req.body;
  if (account_id !== null && account_id !== undefined) {
    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ? AND dossier_id = ?')
      .get(account_id, req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.archived) return res.status(400).json({ error: 'Cannot map an archived account' });
    const alreadyMapped = db
      .prepare(
        `SELECT bca.id FROM bank_connection_accounts bca
         JOIN bank_connections bc ON bc.id = bca.connection_id
         WHERE bc.dossier_id = ? AND bca.account_id = ? AND bca.id != ?`
      )
      .get(req.params.id, account_id, req.params.bankAccountId);
    if (alreadyMapped) {
      return res.status(409).json({ error: 'This account is already mapped to a different bank account' });
    }
  }

  db.prepare('UPDATE bank_connection_accounts SET account_id = ? WHERE id = ?').run(
    account_id || null,
    req.params.bankAccountId
  );
  const updated = db
    .prepare('SELECT * FROM bank_connection_accounts WHERE id = ?')
    .get(req.params.bankAccountId);
  res.json(updated);
});

// DELETE /api/dossiers/:id/bank/connections/:connectionId
router.delete('/bank/connections/:connectionId', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const connection = db
    .prepare('SELECT * FROM bank_connections WHERE id = ? AND dossier_id = ?')
    .get(req.params.connectionId, req.params.id);
  if (!connection) return res.status(404).json({ error: 'Bank connection not found' });
  db.prepare("UPDATE bank_connections SET status = 'revoked' WHERE id = ?").run(req.params.connectionId);
  console.log(`[enable-banking] dossier=${req.params.id} disconnected connection ${req.params.connectionId} (${connection.aspsp_name})`);
  res.status(204).end();
});

// GET /api/dossiers/:id/bank/months/:monthId/balances-preview
router.get('/bank/months/:monthId/balances-preview', async (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const config = resolveEnableBankingConfig(req.params.id);
  if (!config.configured) return res.status(400).json({ error: 'Enable Banking is not configured' });
  const month = db
    .prepare('SELECT * FROM months WHERE id = ? AND dossier_id = ?')
    .get(req.params.monthId, req.params.id);
  if (!month) return res.status(404).json({ error: 'Month not found' });

  const mappedAccounts = db
    .prepare(
      `SELECT bca.id AS bank_account_id, bca.external_account_uid, bca.display_name AS bank_display_name,
              bc.valid_until, bc.status, a.id AS account_id, a.name AS account_name,
              me.value AS current_value, me.comment AS current_comment
       FROM bank_connection_accounts bca
       JOIN bank_connections bc ON bc.id = bca.connection_id
       JOIN accounts a ON a.id = bca.account_id
       JOIN month_account_snapshot mas ON mas.account_id = a.id AND mas.month_id = ?
       LEFT JOIN month_entries me ON me.month_id = ? AND me.account_id = a.id
       WHERE bc.dossier_id = ? AND bc.status = 'active'`
    )
    .all(req.params.monthId, req.params.monthId, req.params.id);

  const results = [];
  const warnings = [];
  const prefix = `[enable-banking] dossier=${req.params.id} month=${req.params.monthId}`;

  for (const row of mappedAccounts) {
    if (isConnectionExpired(row.valid_until)) {
      warnings.push(`${row.account_name}: bank connection has expired — reconnect to refresh this balance`);
      continue;
    }
    try {
      const balanceResp = await getBalances(config, row.external_account_uid);
      const balance = (balanceResp.balances || [])[0];
      if (!balance) {
        warnings.push(`${row.account_name}: no balance returned by the bank`);
        continue;
      }
      results.push({
        account_id: row.account_id,
        account_name: row.account_name,
        current_value: row.current_value,
        current_comment: row.current_comment,
        proposed_value: parseFloat(balance.balance_amount.amount),
        bank_display_name: row.bank_display_name,
        as_of: balance.reference_date || balance.last_change_date_time || null,
      });
    } catch (err) {
      console.error(`${prefix} balance fetch failed for account=${row.account_id} — ${err.message}`);
      warnings.push(`${row.account_name}: could not fetch balance from the bank`);
    }
  }

  res.json({ results, warnings });
});

// POST /api/dossiers/:id/bank/months/:monthId/balances-apply
router.post('/bank/months/:monthId/balances-apply', (req, res) => {
  if (!canAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dossier not found' });
  const month = db
    .prepare('SELECT * FROM months WHERE id = ? AND dossier_id = ?')
    .get(req.params.monthId, req.params.id);
  if (!month) return res.status(404).json({ error: 'Month not found' });

  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries must be a non-empty array' });
  }
  for (const entry of entries) {
    if (!entry || typeof entry.account_id !== 'string' || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      return res.status(400).json({ error: 'Each entry needs account_id (string) and value (finite number)' });
    }
    const inSnapshot = db
      .prepare('SELECT 1 FROM month_account_snapshot WHERE month_id = ? AND account_id = ?')
      .get(req.params.monthId, entry.account_id);
    if (!inSnapshot) {
      return res.status(400).json({ error: `Account ${entry.account_id} is not part of this month` });
    }
  }

  const apply = db.transaction(() => {
    const update = db.prepare('UPDATE month_entries SET value = ? WHERE month_id = ? AND account_id = ?');
    for (const entry of entries) {
      update.run(entry.value, req.params.monthId, entry.account_id);
    }
  });
  apply();
  console.log(`[enable-banking] dossier=${req.params.id} month=${req.params.monthId} applied ${entries.length} balance(s)`);
  res.json({ updated: entries.length });
});

module.exports = router;
