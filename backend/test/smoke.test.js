const { db } = require('../src/db');

describe('smoke', () => {
  it('opens an in-memory database with the schema applied', () => {
    expect(db.prepare('SELECT 1 as ok').get().ok).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dossiers'")
      .all();
    expect(tables).toHaveLength(1);
  });
});
