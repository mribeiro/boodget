const crypto = require('crypto');
const {
  buildJwtClaims,
  signJwt,
  isConnectionExpired,
  matchPriorMapping,
} = require('../../src/lib/enablebanking');

describe('buildJwtClaims', () => {
  it('sets iss/aud and an exp exactly ttlSeconds after iat', () => {
    const claims = buildJwtClaims('app-123', 1000, 300);
    expect(claims).toEqual({ iss: 'app-123', aud: 'api.enablebanking.com', iat: 1000, exp: 1300 });
  });

  it('defaults ttlSeconds to 300 when omitted', () => {
    const claims = buildJwtClaims('app-123', 1000);
    expect(claims.exp - claims.iat).toBe(300);
  });
});

describe('signJwt', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  it('produces a compact JWT with a header/payload/signature verifiable against the public key', () => {
    const jwt = signJwt('app-123', privateKey, { now: 1700000000000 });
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const decode = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const header = decode(parts[0]);
    const claims = decode(parts[1]);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'app-123' });
    expect(claims.iss).toBe('app-123');
    expect(claims.iat).toBe(1700000000);

    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingInput);
    expect(verifier.verify(publicKey, signature)).toBe(true);
  });

  it('fails verification against a different keypair', () => {
    const other = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const jwt = signJwt('app-123', privateKey);
    const parts = jwt.split('.');
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingInput);
    expect(verifier.verify(other.publicKey, signature)).toBe(false);
  });
});

describe('isConnectionExpired', () => {
  it('is false when valid_until is in the future', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isConnectionExpired(future, new Date())).toBe(false);
  });

  it('is true when valid_until is in the past', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(isConnectionExpired(past, new Date())).toBe(true);
  });

  it('is true when valid_until exactly equals now', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isConnectionExpired(now.toISOString(), now)).toBe(true);
  });
});

describe('matchPriorMapping', () => {
  it('matches by IBAN when available', () => {
    const newAccounts = [{ id: 'new-1', iban: 'FI123', external_account_uid: 'uid-new-1' }];
    const priorAccounts = [{ account_id: 'boodget-acc-1', iban: 'FI123', external_account_uid: 'uid-old-1' }];
    expect(matchPriorMapping(newAccounts, priorAccounts)).toEqual({ 'new-1': 'boodget-acc-1' });
  });

  it('falls back to external_account_uid when IBAN is absent', () => {
    const newAccounts = [{ id: 'new-1', iban: null, external_account_uid: 'uid-1' }];
    const priorAccounts = [{ account_id: 'boodget-acc-1', iban: null, external_account_uid: 'uid-1' }];
    expect(matchPriorMapping(newAccounts, priorAccounts)).toEqual({ 'new-1': 'boodget-acc-1' });
  });

  it('prefers an IBAN match over a uid match when both are present', () => {
    const newAccounts = [{ id: 'new-1', iban: 'FI123', external_account_uid: 'uid-shared' }];
    const priorAccounts = [
      { account_id: 'by-uid', iban: null, external_account_uid: 'uid-shared' },
      { account_id: 'by-iban', iban: 'FI123', external_account_uid: 'uid-other' },
    ];
    expect(matchPriorMapping(newAccounts, priorAccounts)).toEqual({ 'new-1': 'by-iban' });
  });

  it('does not include an entry when there is no match', () => {
    const newAccounts = [{ id: 'new-1', iban: 'FI999', external_account_uid: 'uid-999' }];
    const priorAccounts = [{ account_id: 'boodget-acc-1', iban: 'FI123', external_account_uid: 'uid-1' }];
    expect(matchPriorMapping(newAccounts, priorAccounts)).toEqual({});
  });

  it('ignores prior rows with no account_id mapping', () => {
    const newAccounts = [{ id: 'new-1', iban: 'FI123', external_account_uid: 'uid-1' }];
    const priorAccounts = [{ account_id: null, iban: 'FI123', external_account_uid: 'uid-1' }];
    expect(matchPriorMapping(newAccounts, priorAccounts)).toEqual({});
  });
});
