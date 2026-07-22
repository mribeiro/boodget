const express = require('express');
const fs = require('fs');
const session = require('express-session');
const path = require('path');

// Wipe DB on every restart in ephemeral environments so seed data stays fresh
if (process.env.NODE_ENV === 'ephemeral') {
  const dbPath = process.env.DB_PATH || './capital-tracker.db';
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('[ephemeral] Database wiped — will re-seed on startup.');
  }
}

const { db, SQLiteSessionStore } = require('./db');

const app = express();
app.set('trust proxy', 1);

app.use(express.json());

app.use(
  session({
    store: new SQLiteSessionStore(),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 72 * 60 * 60 * 1000, // 72 hours
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

const requireAuth = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rate-limit');

app.use('/api/setup', apiLimiter, require('./routes/setup'));
app.use('/api/auth', apiLimiter, require('./routes/auth'));
app.use('/api/users', apiLimiter, requireAuth, require('./routes/users'));
app.use('/api/dossiers', apiLimiter, requireAuth, require('./routes/dossiers'));
app.use('/api/push', apiLimiter, requireAuth, require('./routes/push'));
app.use('/api/notifications', apiLimiter, requireAuth, require('./routes/notifications'));

// Serve the built frontend when available (production, dev, ephemeral, etc.)
const frontendDist = path.join(__dirname, '..', 'frontend-dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false }));
  app.get('*', apiLimiter, (req, res) => {
    const html = fs.readFileSync(path.join(frontendDist, 'index.html'), 'utf8');
    const appEnv = process.env.NODE_ENV || 'production';
    const injected = html.replace('<head>', `<head><script>window.__APP_ENV__="${appEnv}";</script>`);
    res.setHeader('Content-Type', 'text/html');
    res.send(injected);
  });
}

async function start() {
  if (process.env.OIDC_ENABLED === 'true') {
    try {
      await require('./routes/auth').initOIDC();
    } catch (err) {
      console.error('Failed to initialize OIDC:', err.message);
      process.exit(1);
    }
  }
  if (process.env.SEED_ON_EMPTY === 'true') {
    require('./db/seed')();
  }

  // Initialize VAPID keys for Web Push
  const { initVapid } = require('./notifications/push');
  initVapid();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`boodget running on port ${PORT}`);

    // Start push notification scheduler (runs every minute)
    const cron = require('node-cron');
    const { runNotificationScheduler } = require('./notifications/scheduler');
    cron.schedule('* * * * *', () => {
      runNotificationScheduler().catch((err) =>
        console.error('[push] Scheduler error:', err.message)
      );
    });
    console.log('[push] Notification scheduler started');
  });
}

start().catch(console.error);
