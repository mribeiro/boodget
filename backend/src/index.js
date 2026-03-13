const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, SQLiteSessionStore } = require('./db');

const app = express();

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

app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/dossiers', requireAuth, require('./routes/dossiers'));

// Serve the built frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '..', 'frontend-dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
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
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Capital Tracker running on port ${PORT}`));
}

start().catch(console.error);
