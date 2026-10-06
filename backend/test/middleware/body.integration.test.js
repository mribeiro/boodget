const zlib = require('zlib');
const supertest = require('supertest');
const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, loginAs } = require('../fixtures/builders');

// #371: JSON bodies used to be parsed (and gzip inflated) for every request before the rate
// limiter and requireAuth ran, so an anonymous client could make the server inflate and parse
// up to 25MB per request. Now the parser runs per router, after both.
describe('JSON body parsing (#371)', () => {
  it('never parses an anonymous request body on an authenticated route', async () => {
    const app = buildTestApp();
    // Malformed and oversized bodies used to be answered 400/413 — i.e. parsed — before auth.
    const malformed = await supertest(app)
      .post('/api/dossiers').set('Content-Type', 'application/json').send('{"name":');
    const huge = await supertest(app)
      .post('/api/dossiers/import').set('Content-Type', 'application/json').send(`{"x":"${'a'.repeat(5 * 1024 * 1024)}"}`);

    expect(malformed.status).toBe(401);
    expect(huge.status).toBe(401);
  });

  it('refuses compressed bodies instead of inflating them', async () => {
    const user = createUser(db);
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, user);
    const gz = zlib.gzipSync(JSON.stringify({ name: 'Zipped' }));

    const res = await agent
      .post('/api/dossiers').set('Content-Type', 'application/json').set('Content-Encoding', 'gzip').send(gz);

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/Compressed request bodies/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM dossiers WHERE name = 'Zipped'").get().n).toBe(0);
  });

  it('gives the anonymous login only a small body', async () => {
    const res = await supertest(buildTestApp())
      .post('/api/auth/login').send({ username: 'x', password: 'p'.repeat(32 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/limit 16KB/);
  });

  it('still parses the login, and the signed-in routes under /api/auth at their full limit', async () => {
    const user = createUser(db);
    const agent = supertest.agent(buildTestApp());
    expect((await agent.post('/api/auth/login').send({ username: user.username, password: user.password })).status).toBe(200);

    // A 100KB body is over the pre-auth limit but well within the signed-in one: it reaches the
    // avatar route, which rejects it as an invalid image rather than as too large.
    const res = await agent.post('/api/auth/avatar').send({ image: 'x'.repeat(100 * 1024) });

    expect(res.status).toBe(400);
  });
});
