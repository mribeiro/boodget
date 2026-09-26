const { db } = require('../../src/db');
const { parseAvatarDataUrl, resolveOidcUser } = require('../../src/routes/auth');
const { buildTestApp } = require('../helpers/app');
const { createUser, loginAs } = require('../fixtures/builders');
const supertest = require('supertest');

// A minimal 1x1 PNG, base64-encoded — small enough to keep fixtures readable while still
// exercising the real data-URL parsing path.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

describe('parseAvatarDataUrl', () => {
  it('accepts a valid PNG data URL', () => {
    const { mime } = parseAvatarDataUrl(TINY_PNG_DATA_URL);
    expect(mime).toBe('image/png');
  });

  it('accepts JPEG and WebP mime types', () => {
    expect(parseAvatarDataUrl(`data:image/jpeg;base64,${TINY_PNG_BASE64}`).mime).toBe('image/jpeg');
    expect(parseAvatarDataUrl(`data:image/webp;base64,${TINY_PNG_BASE64}`).mime).toBe('image/webp');
  });

  it('rejects a non-string value', () => {
    expect(() => parseAvatarDataUrl(undefined)).toThrow('Image is required');
  });

  it('rejects a disallowed mime type', () => {
    expect(() => parseAvatarDataUrl(`data:image/gif;base64,${TINY_PNG_BASE64}`)).toThrow(/PNG, JPEG, or WebP/);
  });

  it('rejects a value that is not a data URL at all', () => {
    expect(() => parseAvatarDataUrl('not-a-data-url')).toThrow(/PNG, JPEG, or WebP/);
  });

  it('rejects an image over the 2MB decoded cap', () => {
    // Base64 of ~2.1MB of raw bytes — comfortably over the 2MB decoded limit.
    const oversized = 'A'.repeat(Math.ceil((2.1 * 1024 * 1024 * 4) / 3));
    expect(() => parseAvatarDataUrl(`data:image/png;base64,${oversized}`)).toThrow('smaller than 2MB');
  });
});

describe('POST /api/auth/avatar', () => {
  it('stores the avatar and returns it from /me and future logins', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = supertest.agent(app);
    await loginAs(agent, user);

    const uploadRes = await agent.post('/api/auth/avatar').send({ image: TINY_PNG_DATA_URL });
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.avatar).toBe(TINY_PNG_DATA_URL);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.avatar).toBe(TINY_PNG_DATA_URL);

    const freshAgent = supertest.agent(app);
    const loginRes = await freshAgent
      .post('/api/auth/login')
      .send({ username: user.username, password: user.password });
    expect(loginRes.body.avatar).toBe(TINY_PNG_DATA_URL);
  });

  it('rejects an invalid image with 400 and leaves the stored avatar unchanged', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = supertest.agent(app);
    await loginAs(agent, user);

    const res = await agent.post('/api/auth/avatar').send({ image: 'not-a-data-url' });
    expect(res.status).toBe(400);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.avatar).toBeNull();
  });

  it('requires authentication', async () => {
    const app = buildTestApp();
    const res = await supertest(app).post('/api/auth/avatar').send({ image: TINY_PNG_DATA_URL });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/avatar', () => {
  it('clears a previously set avatar', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = supertest.agent(app);
    await loginAs(agent, user);
    await agent.post('/api/auth/avatar').send({ image: TINY_PNG_DATA_URL });

    const delRes = await agent.delete('/api/auth/avatar');
    expect(delRes.status).toBe(204);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.avatar).toBeNull();
  });
});

describe('resolveOidcUser', () => {
  const ISSUER = 'https://idp.example.com';

  it('refuses an SSO login whose username matches a local account', () => {
    const local = createUser(db, { username: 'oidc-victim' });

    const result = resolveOidcUser({ issuer: ISSUER, subject: 'attacker-sub', username: 'oidc-victim' });

    expect(result.error).toMatch(/local account/);
    expect(result.user).toBeUndefined();
    const row = db.prepare('SELECT is_oidc, oidc_subject FROM users WHERE id = ?').get(local.id);
    expect(row).toEqual({ is_oidc: 0, oidc_subject: null });
  });

  it('creates a new SSO user bound to its issuer and subject', () => {
    const { user } = resolveOidcUser({ issuer: ISSUER, subject: 'sub-new', username: 'fresh-sso' });

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    expect(row).toMatchObject({ username: 'fresh-sso', is_oidc: 1, is_admin: 0, oidc_issuer: ISSUER, oidc_subject: 'sub-new' });
  });

  it('finds a bound user by subject even after their username changes at the IdP', () => {
    const { user } = resolveOidcUser({ issuer: ISSUER, subject: 'sub-stable', username: 'before-rename' });

    const again = resolveOidcUser({ issuer: ISSUER, subject: 'sub-stable', username: 'after-rename' });

    expect(again.user.id).toBe(user.id);
  });

  it('refuses a different subject claiming an already-bound SSO username', () => {
    resolveOidcUser({ issuer: ISSUER, subject: 'sub-owner', username: 'taken-sso' });

    const result = resolveOidcUser({ issuer: ISSUER, subject: 'sub-intruder', username: 'taken-sso' });

    expect(result.error).toMatch(/different SSO identity/);
  });

  it('binds a pre-existing unbound SSO user on their next login', () => {
    const legacy = createUser(db, { username: 'legacy-sso', is_oidc: true });

    const { user } = resolveOidcUser({ issuer: ISSUER, subject: 'sub-legacy', username: 'legacy-sso' });

    expect(user.id).toBe(legacy.id);
    const row = db.prepare('SELECT oidc_issuer, oidc_subject FROM users WHERE id = ?').get(legacy.id);
    expect(row).toEqual({ oidc_issuer: ISSUER, oidc_subject: 'sub-legacy' });
  });

  it('refuses a login with no subject', () => {
    expect(resolveOidcUser({ issuer: ISSUER, subject: undefined, username: 'x' }).error).toBeTruthy();
  });
});
