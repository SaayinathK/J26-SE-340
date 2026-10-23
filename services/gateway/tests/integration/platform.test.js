'use strict';
// Uses an isolated PostgreSQL database. Only external model responses are test doubles.
const request = require('supertest');
const crypto = require('node:crypto');
const app = require('../../src/main');
const pool = require('../../src/config/db');
const { withTenant } = require('../../src/services/session');
const suffix = crypto.randomBytes(5).toString('hex');
const password = 'WorkspaceTestPass123!';
const accounts = {};
const saved = {};
const originalFetch = global.fetch;
const fixtureEmails = [0, 3, 7].map((day, index) => ({ email_index: index + 1, send_at_days: day, subject: 'A useful next step', body: 'Hello {{first_name}},\n\nTell us about your business goals.\n\nTo unsubscribe from these emails, reply STOP or click here.' }));
const sequenceBody = () => ({ name: 'Actual saved draft', audience: 'Subscribers', tone: 'Professional', source: 'all', emails: structuredClone(fixtureEmails) });
const headers = role => ({ Authorization: 'Bearer ' + accounts[role].token });
jest.setTimeout(30000);
async function register(label, extras = {}) {
  const result = await request(app).post('/api/auth/register').send({ name: label, email: `${label}-${suffix}@example.com`, workspace_name: label + ' Workspace', password, ...extras });
  expect(result.status).toBe(201);
  return { token: result.body.access_token, user: result.body.user };
}
beforeAll(async () => {
  if (!/^c4_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME || '')) throw new Error('Use scripts/verify-accounts.ps1 with an isolated database.');
  accounts.admin = await register('workspace-admin');
  accounts.other = await register('other-admin');
  for (const role of ['marketer', 'viewer']) {
    const email = `${role}-${suffix}@example.com`;
    const invitation = await request(app).post('/api/team/invitations').set(headers('admin')).send({ email, role });
    expect(invitation.status).toBe(201);
    accounts[role] = await register(role, { email, invitation_token: new URLSearchParams(invitation.body.invitation_url.split('?')[1]).get('invite') });
  }
});
afterEach(() => { global.fetch = originalFetch; });
afterAll(async () => {
  await pool.end();
});

test('service discovery requires authentication and excludes email for viewers', async () => {
  expect((await request(app).get('/api/services')).status).toBe(401);
  global.fetch = jest.fn(async url => String(url).endsWith('/health') ? { ok: false, json: async () => ({ status: 'not_implemented', ready: false }) } : {});
  const result = await request(app).get('/api/services').set(headers('viewer'));
  expect(result.status).toBe(200);
  expect(result.body.services).toHaveLength(3);
  expect(result.body.services.some(service => service.id === 'email-agent')).toBe(false);
  expect(result.body.services.every(service => !service.available)).toBe(true);
});
test('snapshot requires a real session and starts with no seeded marketing records', async () => {
  expect((await request(app).get('/api/platform/snapshot')).status).toBe(401);
  const result = await request(app).get('/api/platform/snapshot').set(headers('admin'));
  expect(result.status).toBe(200);
  for (const key of ['campaigns', 'documents', 'sequences', 'activities']) expect(result.body[key]).toEqual([]);
  expect(result.body.delivery_connected).toBe(false);
});

test('monitoring status follows the administrator-only monitoring permission',async()=>{
  expect((await request(app).get('/api/platform/status').set(headers('admin'))).status).toBe(200);
  for(const role of ['marketer','viewer'])expect((await request(app).get('/api/platform/status').set(headers(role))).status).toBe(403);
});
test('campaign creates a persistent tenant record, real activity, and no fabricated metrics', async () => {
  const result = await request(app).post('/api/platform/campaigns').set(headers('admin')).send({ name: 'First campaign', audience: 'Our subscribers', tenant_id: accounts.other.user.tenant_id, sent: 9000 });
  expect(result.status).toBe(201); saved.campaign = result.body;
  expect(result.body.tenant_id).toBe(accounts.admin.user.tenant_id);
  const snapshot = await request(app).get('/api/platform/snapshot').set(headers('admin'));
  expect(snapshot.body.campaigns[0]).toMatchObject({ id: result.body.id, sent: null, open: null, click: null });
  expect(snapshot.body.activities[0].title).toBe('Campaign created');
  expect(snapshot.body.totals.campaigns).toBe(1);
  expect(snapshot.body.daily.campaigns[0].count).toBe(1);
  expect((await request(app).get('/api/platform/snapshot').set(headers('other'))).body.campaigns).toEqual([]);
});
test('viewer can read campaigns but cannot write; marketer can create', async () => {
  expect((await request(app).post('/api/platform/campaigns').set(headers('viewer')).send({ name: 'Forbidden', audience: 'None' })).status).toBe(403);
  expect((await request(app).get('/api/platform/snapshot').set(headers('viewer'))).body.campaigns).toHaveLength(1);
  expect((await request(app).post('/api/platform/campaigns').set(headers('marketer')).send({ name: 'Marketer draft', audience: 'Customers' })).status).toBe(201);
});
test('campaign changes reject stale versions, foreign workspace IDs, and unsupported sending states', async () => {
  const path = '/api/platform/campaigns/' + saved.campaign.id;
  expect((await request(app).patch(path).set(headers('other')).send({ status: 'Archived', version: 1 })).status).toBe(409);
  expect((await request(app).patch(path).set(headers('admin')).send({ status: 'Active', version: 1 })).status).toBe(400);
  expect((await request(app).patch(path).set(headers('admin')).send({ status: 'Archived', version: 1 })).body.version).toBe(2);
  expect((await request(app).patch(path).set(headers('admin')).send({ status: 'Draft', version: 1 })).status).toBe(409);
});
test('knowledge writes enforce administrator policy and persist actual content', async () => {
  const body = { name: 'Product facts', type: 'Product knowledge', text: 'We provide accessible website design.' };
  expect((await request(app).post('/api/platform/knowledge').set(headers('marketer')).send(body)).status).toBe(403);
  const result = await request(app).post('/api/platform/knowledge').set(headers('admin')).send(body);
  expect(result.status).toBe(201); saved.document = result.body;
  const data = (await request(app).get('/api/platform/snapshot').set(headers('marketer'))).body;
  expect(data.documents[0]).toMatchObject(body);
  expect((await request(app).get('/api/platform/snapshot').set(headers('viewer'))).body.documents).toEqual([]);
  expect((await request(app).delete('/api/platform/knowledge/' + result.body.id).set(headers('other')).send({})).status).toBe(404);
});
test('database row policies prevent unscoped and cross-tenant reads', async () => {
  expect((await pool.query('SELECT * FROM campaigns')).rows).toEqual([]);
  expect((await pool.query('SELECT * FROM email_sequences')).rows).toEqual([]);
  const result = await withTenant(accounts.other.user.tenant_id, client => client.query('SELECT * FROM campaigns WHERE id=$1', [saved.campaign.id]));
  expect(result.rows).toEqual([]);
});
test('knowledge deletion and recorded activity persist', async () => {
  expect((await request(app).delete('/api/platform/knowledge/' + saved.document.id).set(headers('admin')).send({})).status).toBe(200);
  const snapshot = (await request(app).get('/api/platform/snapshot').set(headers('admin'))).body;
  expect(snapshot.documents).toEqual([]);
  expect(snapshot.activities.some(event => event.title === 'Knowledge source removed')).toBe(true);
});
