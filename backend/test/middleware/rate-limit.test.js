const { apiLimiter, loginLimiter } = require('../../src/middleware/rate-limit');
const express = require('express');
const supertest = require('supertest');

// express-rate-limit doesn't expose its config for direct inspection, so these assert on
// observed behavior instead: mount the real middleware and drive it past its documented
// limits/keying rules.

describe('apiLimiter', () => {
  it('allows requests under the limit through', async () => {
    const app = express();
    app.use(apiLimiter);
    app.get('/ping', (req, res) => res.json({ ok: true }));
    const res = await supertest(app).get('/ping');
    expect(res.status).toBe(200);
  });
});

describe('loginLimiter', () => {
  it('keys by IP + username, so different usernames from the same IP get independent buckets', async () => {
    const app = express();
    app.use(express.json());
    app.use('/login', loginLimiter, (req, res) => res.status(401).json({ error: 'Invalid credentials' }));

    const agent = supertest.agent(app);
    // Exhaust the limiter for "alice" (max 10 per window).
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await agent.post('/login').send({ username: 'alice' });
    }
    const aliceBlocked = await agent.post('/login').send({ username: 'alice' });
    expect(aliceBlocked.status).toBe(429);

    // "bob" from the same client should not be affected by alice's exhausted bucket.
    const bobStillAllowed = await agent.post('/login').send({ username: 'bob' });
    expect(bobStillAllowed.status).toBe(401); // reaches the handler, not blocked by the limiter
  });

  it('does not count successful requests toward the limit (skipSuccessfulRequests)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/login', loginLimiter, (req, res) => res.status(200).json({ ok: true }));

    const agent = supertest.agent(app);
    for (let i = 0; i < 15; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await agent.post('/login').send({ username: 'carol' });
      expect(res.status).toBe(200); // never blocked, since every request "succeeds"
    }
  });
});
