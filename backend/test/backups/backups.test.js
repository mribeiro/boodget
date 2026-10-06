const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const request = require('supertest');
const { db } = require('../../src/db');
const backups = require('../../src/backups');
const push = require('../../src/notifications/push');
const { buildTestApp } = require('../helpers/app');
const { createUser, loginAs } = require('../fixtures/builders');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boodget-backups-'));
  process.env.BACKUP_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_KEEP;
});

describe('getConfig', () => {
  it('defaults to weekly, keeping 12, next to the database', () => {
    const config = backups.getConfig({ NODE_ENV: 'production' });
    expect(config).toMatchObject({ enabled: true, cron: '0 3 * * 0', keep: 12 });
    expect(path.basename(config.dir)).toBe('backups');
  });

  it('reads the environment and ignores a bad keep count', () => {
    expect(backups.getConfig({ BACKUP_DIR: '/x', BACKUP_CRON: '0 2 * * *', BACKUP_KEEP: '3' })).toMatchObject({ dir: '/x', cron: '0 2 * * *', keep: 3 });
    expect(backups.getConfig({ BACKUP_KEEP: '0' }).keep).toBe(12);
  });

  it('is off in ephemeral previews unless forced on, and can be switched off', () => {
    expect(backups.getConfig({ NODE_ENV: 'ephemeral' }).enabled).toBe(false);
    expect(backups.getConfig({ NODE_ENV: 'ephemeral', BACKUP_ENABLED: 'true' }).enabled).toBe(true);
    expect(backups.getConfig({ BACKUP_ENABLED: 'false' }).enabled).toBe(false);
  });
});

describe('runBackup', () => {
  it('writes a restorable, owner-only copy of the whole database and records the run', async () => {
    const user = createUser(db, { username: 'backed-up' });
    const result = await backups.runBackup({ now: new Date('2026-09-27T03:00:00Z') });

    expect(result).toMatchObject({ ok: true, file: 'boodget-2026-09-27_030000.db', trigger: 'scheduled' });
    const file = path.join(dir, result.file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare('SELECT username FROM users WHERE id = ?').get(user.id).username).toBe('backed-up');
    copy.close();
    expect(backups.getLastRun()).toEqual(result);
    expect(fs.readdirSync(dir)).toEqual([result.file]); // no partial file left behind
  });

  it('keeps only the newest N backups', async () => {
    process.env.BACKUP_KEEP = '2';
    for (const day of ['01', '08', '15']) {
      await backups.runBackup({ now: new Date(`2026-09-${day}T03:00:00Z`) });
    }
    expect(backups.listBackups(dir).map((b) => b.name)).toEqual(['boodget-2026-09-15_030000.db', 'boodget-2026-09-08_030000.db']);
  });

  it('records a failure, and a scheduled failure pushes to admins only', async () => {
    const admin = createUser(db, { is_admin: true });
    const regular = createUser(db);
    for (const u of [admin, regular]) {
      db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, 'k', 'a')").run(u.id, `https://push.example/${u.id}`);
    }
    const send = vi.spyOn(push, 'sendPush').mockResolvedValue({ success: true });
    fs.writeFileSync(path.join(dir, 'blocker'), '');
    process.env.BACKUP_DIR = path.join(dir, 'blocker'); // a file, so the directory can't be created

    expect(await backups.runScheduledBackup()).toBeNull();
    expect(backups.getLastRun()).toMatchObject({ ok: false, trigger: 'scheduled' });
    expect(send.mock.calls.map(([sub]) => sub.user_id)).toEqual([admin.id]);
    expect(send.mock.calls[0][1]).toMatchObject({ type: 'backup_failed', url: '/backups' });
    send.mockRestore();
  });

  it('ignores stray files and cleans up an interrupted partial copy when pruning', () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), '');
    fs.writeFileSync(path.join(dir, '.boodget-2026-09-01_030000.db.partial'), '');
    fs.writeFileSync(path.join(dir, 'boodget-2026-09-01_030000.db'), '');
    backups.pruneBackups(dir, 12);
    expect(fs.readdirSync(dir).sort()).toEqual(['boodget-2026-09-01_030000.db', 'notes.txt']);
  });
});

describe('/api/backups', () => {
  const app = buildTestApp();

  it('is admin-only', async () => {
    const user = createUser(db);
    const agent = request.agent(app);
    await loginAs(agent, user);
    expect((await agent.get('/api/backups')).status).toBe(403);
    expect((await agent.post('/api/backups')).status).toBe(403);
  });

  it('backs up on demand and lists', async () => {
    const admin = createUser(db, { is_admin: true });
    const agent = request.agent(app);
    await loginAs(agent, admin);

    const created = await agent.post('/api/backups');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ok: true, trigger: 'manual', by: admin.username });

    const list = await agent.get('/api/backups');
    expect(list.body).toMatchObject({ keep: 12, dir, last_run: { file: created.body.file } });
    expect(list.body.backups.map((b) => b.name)).toEqual([created.body.file]);
  });

  it('offers no way to download a backup, even to an admin (#372)', async () => {
    const admin = createUser(db, { is_admin: true });
    const agent = request.agent(app);
    await loginAs(agent, admin);
    const { body } = await agent.post('/api/backups');
    const res = await agent.get(`/api/backups/${body.file}/download`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).not.toMatch(/octet-stream|sqlite/);
  });
});
