export {};
/** Fresh-boot audit: validates migrations v1-v5 + core flows on a brand-new DB. */
process.env.APP_SECRET = 'fresh-boot-test-secret-0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';

const { openDatabase } = await import('../src/db/database.js');
const { runMigrations } = await import('../src/db/schema.js');
const db = openDatabase(':memory:');
runMigrations(db);
const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
console.log('migrations applied → user_version =', v.user_version);
const cols = db.prepare('PRAGMA table_info(stories)').all().map((c) => c.name);
console.log('stories has assignee_user_id:', cols.includes('assignee_user_id'), '| due_date:', cols.includes('due_date'));
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as Array<{ name: string }>;
const names = tables.map((t) => t.name);
console.log(
  'tables:', names.length,
  '| workspace_members:', names.includes('workspace_members'),
  '| outgoing_webhooks:', names.includes('outgoing_webhooks'),
  '| comments:', names.includes('comments'),
  '| labels:', names.includes('labels')
);

const { createApp } = await import('../src/app.js');
const request = (await import('supertest')).default;
const a = createApp();
const reg = await request(a)
  .post('/api/auth/register')
  .send({ name: 'Fresh User', email: 'fresh@test.io', password: 'password-123' });
console.log('register on fresh DB:', reg.status);
const token = reg.body.data.token;
const proj = await request(a)
  .post('/api/projects')
  .set('Authorization', `Bearer ${token}`)
  .send({ name: 'Fresh Project', description: '', techStack: [] });
console.log('create project:', proj.status);
const story = await request(a)
  .post(`/api/projects/${proj.body.data.id}/stories`)
  .set('Authorization', `Bearer ${token}`)
  .send({ title: 'Fresh story', description: '', points: 2, priority: 'medium', acceptanceCriteria: [] });
console.log('create story:', story.status);
const backlog = await request(a)
  .get(`/api/projects/${proj.body.data.id}/backlog`)
  .set('Authorization', `Bearer ${token}`);
console.log('backlog labels field present:', 'labels' in backlog.body.data);
const roadmap = await request(a)
  .get(`/api/projects/${proj.body.data.id}/roadmap`)
  .set('Authorization', `Bearer ${token}`);
console.log('roadmap:', roadmap.status, '| items:', roadmap.body.data.items.length);
const mywork = await request(a).get('/api/my-work').set('Authorization', `Bearer ${token}`);
console.log('my-work:', mywork.status);
const roster = await request(a).get('/api/workspace/roster').set('Authorization', `Bearer ${token}`);
console.log('workspace roster:', roster.status);
const search = await request(a).get('/api/search?q=fresh').set('Authorization', `Bearer ${token}`);
console.log('search:', search.status, '| projects:', search.body.data.projects.length);
console.log('FRESH_BOOT_OK');
process.exit(0);
