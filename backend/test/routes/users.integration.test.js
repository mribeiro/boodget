const { db } = require('../../src/db');
const { buildTestApp } = require('../helpers/app');
const { createUser, createDossier, loginAs } = require('../fixtures/builders');
const supertest = require('supertest');

describe('DELETE /api/users/:id', () => {
  it('refuses to delete a user who still owns dossiers, leaving the dossiers intact', async () => {
    const owner = createUser(db);
    const other = createUser(db, { is_admin: true });
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
    const other = createUser(db, { is_admin: true });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, other);

    const res = await agent.delete(`/api/users/${target.id}`);

    expect(res.status).toBe(204);
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(target.id)).toBeUndefined();
  });

  it('deleting a user who only has shared access keeps the dossier they were shared', async () => {
    const owner = createUser(db, { is_admin: true });
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

describe('user management is admin-only', () => {
  it('lets a non-admin list users but not create, delete or promote them', async () => {
    const member = createUser(db);
    const target = createUser(db);
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, member);

    expect((await agent.get('/api/users')).status).toBe(200);
    const created = await agent.post('/api/users').send({ username: 'newbie', password: 'Test-Password-1234!' });
    expect(created.status).toBe(403);
    expect((await agent.delete(`/api/users/${target.id}`)).status).toBe(403);
    expect((await agent.patch(`/api/users/${member.id}`).send({ is_admin: true })).status).toBe(403);
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(target.id)).toBeTruthy();
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(member.id).is_admin).toBe(0);
  });

  it('lets an admin create users (as non-admins) and grant/revoke admin', async () => {
    const admin = createUser(db, { is_admin: true });
    const agent = supertest.agent(buildTestApp());
    const me = await loginAs(agent, admin);
    expect(me.is_admin).toBe(1);

    const created = await agent.post('/api/users').send({ username: 'second-user', password: 'Test-Password-1234!' });
    expect(created.status).toBe(201);
    expect(created.body.is_admin).toBe(0);

    const granted = await agent.patch(`/api/users/${created.body.id}`).send({ is_admin: true });
    expect(granted.status).toBe(200);
    expect(granted.body.is_admin).toBe(1);
    const revoked = await agent.patch(`/api/users/${created.body.id}`).send({ is_admin: false });
    expect(revoked.body.is_admin).toBe(0);
  });

  it('refuses to let an admin revoke their own admin role', async () => {
    const admin = createUser(db, { is_admin: true });
    const agent = supertest.agent(buildTestApp());
    await loginAs(agent, admin);

    const res = await agent.patch(`/api/users/${admin.id}`).send({ is_admin: false });

    expect(res.status).toBe(400);
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(admin.id).is_admin).toBe(1);
  });
});
