// Runs once per test file (Vitest's `pool: 'forks'` + `isolate: true` gives each test file its
// own process), before any application module is imported — so every `require('../src/db')`
// throughout the run opens a fresh, private in-memory SQLite database with the full schema and
// migrations applied.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
