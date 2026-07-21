// A lightweight Express app mirroring src/index.js's router wiring, without the
// process-level concerns (app.listen, OIDC init, push/cron scheduler, ephemeral DB wipe)
// that only matter for a real running server. Each call builds a fresh app bound to the
// current (already `require`d, in-memory) db module's session store.
const express = require('express');
const session = require('express-session');
const { SQLiteSessionStore } = require('../../src/db');
const requireAuth = require('../../src/middleware/auth');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new SQLiteSessionStore(),
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 72 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
    })
  );

  // Deliberately no apiLimiter here — it would throttle test suites making many requests
  // per file. The limiter's own config is covered by middleware/rate-limit.test.js instead.
  app.use('/api/setup', require('../../src/routes/setup'));
  app.use('/api/auth', require('../../src/routes/auth'));
  app.use('/api/users', requireAuth, require('../../src/routes/users'));
  app.use('/api/dossiers', requireAuth, require('../../src/routes/dossiers'));
  app.use('/api/push', requireAuth, require('../../src/routes/push'));
  app.use('/api/notifications', requireAuth, require('../../src/routes/notifications'));

  return app;
}

module.exports = { buildTestApp };
