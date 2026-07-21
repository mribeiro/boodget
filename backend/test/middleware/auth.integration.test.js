const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser } = require('../fixtures/builders');
const supertest = require('supertest');

describe('requireAuth', () => {
  it('returns 401 when there is no session', async () => {
    const app = buildTestApp();
    const res = await supertest(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('passes through and sets req.user on a valid session', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = supertest.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: user.password });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(user.username);
  });

  it('returns 401 and destroys the session when it references a deleted user', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const agent = supertest.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: user.password });

    // Delete the user out from under the live session.
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    const res = await agent.get('/api/users');
    expect(res.status).toBe(401);

    // The session should have been destroyed — a subsequent request is still unauthenticated
    // even though the cookie is still being sent.
    const res2 = await agent.get('/api/auth/me');
    expect(res2.status).toBe(401);
  });
});
