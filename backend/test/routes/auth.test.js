const { db } = require('../../src/db');
const { parseAvatarDataUrl } = require('../../src/routes/auth');
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
