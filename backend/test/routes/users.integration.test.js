const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, loginAs } = require('../fixtures/builders');
const supertest = require('supertest');

describe('DELETE /api/users/:id', () => {
  it('refuses to delete a user who still owns dossiers, leaving the dossiers intact', async () => {
    const owner = createUser(db);
    const other = createUser(db);
    const dossier = createDossier(db, { creatorId: owner.id });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, other);

    const res = await agent.delete(`/api/users/${owner.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/own 1 dossier/);
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(owner.id)).toBeTruthy();
    expect(db.prepare('SELECT id FROM dossiers WHERE id = ?').get(dossier.id)).toBeTruthy();
  });

  it('still deletes a user who owns no dossiers', async () => {
    const target = createUser(db);
    const other = createUser(db);
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, other);

    const res = await agent.delete(`/api/users/${target.id}`);

    expect(res.status).toBe(204);
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(target.id)).toBeUndefined();
  });

  it('deleting a user who only has shared access keeps the dossier they were shared', async () => {
    const owner = createUser(db);
    const guest = createUser(db);
    const dossier = createDossier(db, { creatorId: owner.id });
    db.prepare('INSERT INTO dossier_access (dossier_id, user_id) VALUES (?, ?)').run(dossier.id, guest.id);
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, owner);

    const res = await agent.delete(`/api/users/${guest.id}`);

    expect(res.status).toBe(204);
    expect(db.prepare('SELECT id FROM dossiers WHERE id = ?').get(dossier.id)).toBeTruthy();
  });
});
