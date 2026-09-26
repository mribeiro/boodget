const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, loginAs } = require('../fixtures/builders');
const supertest = require('supertest');

const sidCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='))?.split(';')[0];

describe('session hardening', () => {
  it('issues a new session id on login instead of authenticating the existing one', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    // A pre-login session the attacker could have planted: create one via a request that
    // stores something in it (a failed OIDC start isn't available, so seed the store directly).
    const planted = 'planted-session-id';
    db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(
      planted, JSON.stringify({ cookie: { originalMaxAge: 100000 } }), Date.now() + 100000
    );
    const signed = require('cookie-signature').sign(planted, 'test-secret');

    const res = await supertest(app)
      .post('/api/auth/login')
      .set('Cookie', `connect.sid=s%3A${encodeURIComponent(signed)}`)
      .send({ username: user.username, password: user.password });

    expect(res.status).toBe(200);
    const issued = sidCookie(res);
    expect(issued).toBeTruthy();
    expect(issued).not.toContain(encodeURIComponent(signed));
    // The planted id is gone and was never authenticated.
    expect(db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(planted)).toBeUndefined();
  });

  it('signs out other sessions on password change, keeping the current one', async () => {
    const user = createUser(db);
    const app = buildTestApp();
    const laptop = supertest.agent(app);
    const phone = supertest.agent(app);
    await loginAs(laptop, user);
    await loginAs(phone, user);
    expect((await phone.get('/api/auth/me')).status).toBe(200);

    const res = await laptop
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: 'Another-Password-5678!' });

    expect(res.status).toBe(200);
    expect((await laptop.get('/api/auth/me')).status).toBe(200);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
  });

  it("leaves other users' sessions alone on password change", async () => {
    const alice = createUser(db);
    const bob = createUser(db);
    const app = buildTestApp();
    const aliceAgent = supertest.agent(app);
    const bobAgent = supertest.agent(app);
    await loginAs(aliceAgent, alice);
    await loginAs(bobAgent, bob);

    await aliceAgent
      .post('/api/auth/change-password')
      .send({ currentPassword: alice.password, newPassword: 'Another-Password-5678!' });

    expect((await bobAgent.get('/api/auth/me')).status).toBe(200);
  });
});
