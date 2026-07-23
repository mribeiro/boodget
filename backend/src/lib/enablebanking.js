const crypto = require('crypto');
const { db } = require('../db');

const API_BASE = 'https://api.enablebanking.com';
const JWT_TTL_SECONDS = 300;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Pure — no crypto, no I/O. Kept separate so the claim shape is unit-testable
// without a real keypair.
function buildJwtClaims(applicationId, nowEpochSeconds, ttlSeconds = JWT_TTL_SECONDS) {
  return {
    iss: applicationId,
    aud: 'api.enablebanking.com',
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + ttlSeconds,
  };
}

function signJwt(applicationId, privateKeyPem, { now = Date.now(), ttlSeconds = JWT_TTL_SECONDS } = {}) {
  const header = { alg: 'RS256', typ: 'JWT', kid: applicationId };
  const claims = buildJwtClaims(applicationId, Math.floor(now / 1000), ttlSeconds);
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem);
  const encodedSignature = signature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${signingInput}.${encodedSignature}`;
}

function resolveEnableBankingConfig(dossierId) {
  const dossier = db
    .prepare(
      'SELECT enablebanking_application_id, enablebanking_private_key, enablebanking_redirect_uri FROM dossiers WHERE id = ?'
    )
    .get(dossierId);
  const applicationId = dossier?.enablebanking_application_id || process.env.ENABLE_BANKING_APPLICATION_ID || null;
  const privateKey = dossier?.enablebanking_private_key || process.env.ENABLE_BANKING_PRIVATE_KEY || null;
  const redirectUri = dossier?.enablebanking_redirect_uri || process.env.ENABLE_BANKING_REDIRECT_URI || null;
  return {
    applicationId,
    privateKey,
    redirectUri,
    configured: !!applicationId && !!privateKey && !!redirectUri,
  };
}

async function ebFetch(config, path, { method = 'GET', body, prefix = '[enable-banking]' } = {}) {
  const jwt = signJwt(config.applicationId, config.privateKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let resp;
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    console.error(`${prefix} connection failed — ${err.message}`);
    const e = new Error('Could not connect to Enable Banking');
    e.status = 502;
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`${prefix} error — Enable Banking returned HTTP ${resp.status} ${text}`);
    const e = new Error(`Enable Banking returned an error: ${resp.status}`);
    e.status = 502;
    throw e;
  }
  return resp.json();
}

function listAspsps(config, country) {
  return ebFetch(config, `/aspsps?country=${encodeURIComponent(country)}`, { prefix: '[enable-banking] aspsps' });
}

function startAuth(config, { aspspName, aspspCountry, state, redirectUrl, psuType = 'personal' }) {
  return ebFetch(config, '/auth', {
    method: 'POST',
    prefix: '[enable-banking] auth',
    body: {
      access: { valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() },
      aspsp: { name: aspspName, country: aspspCountry },
      state,
      redirect_url: redirectUrl,
      psu_type: psuType,
    },
  });
}

function exchangeSession(config, code) {
  return ebFetch(config, '/sessions', {
    method: 'POST',
    prefix: '[enable-banking] sessions',
    body: { code },
  });
}

function getBalances(config, accountUid) {
  return ebFetch(config, `/accounts/${encodeURIComponent(accountUid)}/balances`, {
    prefix: '[enable-banking] balances',
  });
}

function getAccountDetails(config, accountUid) {
  return ebFetch(config, `/accounts/${encodeURIComponent(accountUid)}/details`, {
    prefix: '[enable-banking] details',
  });
}

function isConnectionExpired(validUntil, now = new Date()) {
  return new Date(validUntil).getTime() <= now.getTime();
}

// Reconnect carry-forward: match new bank accounts to a prior connection's mappings.
// IBAN is the durable identifier across sessions; external_account_uid is not
// guaranteed stable for every ASPSP, so it's only a fallback when IBAN is absent.
function matchPriorMapping(newAccounts, priorAccounts) {
  const result = {};
  const priorByIban = new Map();
  const priorByUid = new Map();
  for (const prior of priorAccounts) {
    if (prior.account_id == null) continue;
    if (prior.iban) priorByIban.set(prior.iban, prior.account_id);
    priorByUid.set(prior.external_account_uid, prior.account_id);
  }
  for (const account of newAccounts) {
    let matched = null;
    if (account.iban && priorByIban.has(account.iban)) {
      matched = priorByIban.get(account.iban);
    } else if (priorByUid.has(account.external_account_uid)) {
      matched = priorByUid.get(account.external_account_uid);
    }
    if (matched != null) result[account.id] = matched;
  }
  return result;
}

module.exports = {
  buildJwtClaims,
  signJwt,
  resolveEnableBankingConfig,
  ebFetch,
  listAspsps,
  startAuth,
  exchangeSession,
  getBalances,
  getAccountDetails,
  isConnectionExpired,
  matchPriorMapping,
};
