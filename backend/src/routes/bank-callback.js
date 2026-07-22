const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { resolveEnableBankingConfig, exchangeSession, matchPriorMapping } = require('../lib/enablebanking');

function canAccess(dossierId, userId) {
  const dossier = db.prepare('SELECT creator_id FROM dossiers WHERE id = ?').get(dossierId);
  if (!dossier) return false;
  if (dossier.creator_id === userId) return true;
  return !!db
    .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
    .get(dossierId, userId);
}

// POST /api/bank/callback — dossier-agnostic: the whitelisted redirect_url carries only
// `code`/`state`, so the initiating dossier is recovered from the pending request row.
router.post('/callback', async (req, res) => {
  const { code, state } = req.body;
  if (!code || !state) return res.status(400).json({ error: 'code and state are required' });

  const pending = db.prepare('SELECT * FROM bank_connection_requests WHERE state = ?').get(state);
  if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) {
    if (pending) db.prepare('DELETE FROM bank_connection_requests WHERE state = ?').run(state);
    return res.status(410).json({ error: 'This connection attempt has expired or is invalid. Please try connecting again.' });
  }

  // Single-use: delete immediately regardless of outcome below.
  db.prepare('DELETE FROM bank_connection_requests WHERE state = ?').run(state);

  if (!canAccess(pending.dossier_id, req.user.id)) {
    return res.status(403).json({ error: 'You no longer have access to the dossier that started this connection' });
  }

  const config = resolveEnableBankingConfig(pending.dossier_id);
  if (!config.configured) {
    return res.status(400).json({ error: 'Enable Banking is not configured for this dossier' });
  }

  let sessionResult;
  try {
    sessionResult = await exchangeSession(config, code);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }

  const connectionId = uuidv4();
  const newAccounts = (sessionResult.accounts || []).map((acc) => ({
    id: uuidv4(),
    external_account_uid: acc.uid,
    iban: acc.account_id?.iban || null,
    currency: acc.currency || null,
    display_name: acc.name || acc.product || null,
  }));

  const priorConnection = db
    .prepare(
      "SELECT id FROM bank_connections WHERE dossier_id = ? AND aspsp_name = ? AND aspsp_country = ? AND status != 'active' ORDER BY created_at DESC LIMIT 1"
    )
    .get(pending.dossier_id, pending.aspsp_name, pending.aspsp_country);
  const priorAccounts = priorConnection
    ? db.prepare('SELECT * FROM bank_connection_accounts WHERE connection_id = ?').all(priorConnection.id)
    : [];
  const carryForward = matchPriorMapping(newAccounts, priorAccounts);

  const insert = db.transaction(() => {
    db.prepare(
      'INSERT INTO bank_connections (id, dossier_id, aspsp_name, aspsp_country, session_id, status, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      connectionId,
      pending.dossier_id,
      pending.aspsp_name,
      pending.aspsp_country,
      sessionResult.session_id,
      'active',
      sessionResult.access?.valid_until || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    );
    const insertAccount = db.prepare(
      'INSERT INTO bank_connection_accounts (id, connection_id, external_account_uid, iban, currency, display_name, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const acc of newAccounts) {
      insertAccount.run(
        acc.id,
        connectionId,
        acc.external_account_uid,
        acc.iban,
        acc.currency,
        acc.display_name,
        carryForward[acc.id] || null
      );
    }
  });
  insert();

  console.log(
    `[enable-banking] dossier=${pending.dossier_id} connected ${pending.aspsp_name}/${pending.aspsp_country} — ${newAccounts.length} account(s)`
  );
  res.json({ dossier_id: pending.dossier_id, connection_id: connectionId });
});

module.exports = router;
