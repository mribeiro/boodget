const requireAuth = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rate-limit');
const { preAuthJson, defaultJson, authRouteJson, dossierJson, jsonBodyErrorHandler } = require('./middleware/body');

// Mounts every /api router — shared by src/index.js and the test app, so tests exercise the
// real order. That order matters (#371): rate limiter first, then authentication, and only
// then the JSON body parser, so an anonymous or throttled request never gets its body parsed.
// Setup and login run before anyone is signed in, so they get a small pre-auth parser instead.
// Must be mounted after the session middleware (requireAuth and authRouteJson read it).
function mountApi(app) {
  app.use('/api/setup', apiLimiter, preAuthJson, require('./routes/setup'));
  app.use('/api/auth', apiLimiter, authRouteJson, require('./routes/auth'));
  app.use('/api/users', apiLimiter, requireAuth, defaultJson, require('./routes/users'));
  app.use('/api/dossiers', apiLimiter, requireAuth, dossierJson, require('./routes/dossiers'));
  app.use('/api/push', apiLimiter, requireAuth, defaultJson, require('./routes/push'));
  app.use('/api/notifications', apiLimiter, requireAuth, defaultJson, require('./routes/notifications'));
  app.use('/api/backups', apiLimiter, requireAuth, defaultJson, require('./routes/backups'));
  app.use('/api', jsonBodyErrorHandler);
}

module.exports = { mountApi };
