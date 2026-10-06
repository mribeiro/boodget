// A lightweight Express app mirroring src/index.js's router wiring, without the
// process-level concerns (app.listen, OIDC init, push/cron scheduler, ephemeral DB wipe)
// that only matter for a real running server. Each call builds a fresh app bound to the
// current (already `require`d, in-memory) db module's session store.
const express = require('express');
const session = require('express-session');
const { SQLiteSessionStore } = require('../../src/db');
const { mountApi } = require('../../src/api');

function buildTestApp() {
  const app = express();
  // This app is only ever driven in-process by supertest — it's never bound to a real
  // port or exposed to real network traffic, so there's no CSRF surface to protect and no
  // transport to secure. secure:true would also break every session-based integration test:
  // supertest's cookie jar won't resend a secure cookie over the plain HTTP it uses internally.
  app.use(
    session({
      store: new SQLiteSessionStore(),
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 72 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
      // codeql[js/missing-csrf-middleware]
      // codeql[js/clear-text-cookie]
    })
  );

  // The exact /api wiring src/index.js uses: rate limiter, then auth, then the JSON parser per
  // router (#371). apiLimiter's ceiling (300/min) comfortably exceeds the request count of any
  // single test file, so it doesn't throttle the suite — middleware/rate-limit.test.js covers
  // the limiter's own config directly.
  mountApi(app);

  return app;
}

module.exports = { buildTestApp };
