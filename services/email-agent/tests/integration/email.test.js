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
  if (!/^email_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME || '')) throw new Error('Use scripts/verify-accounts.ps1 with an isolated database.');
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
test('snapshot requires a real session and starts with no seeded marketing records', async () => {
  expect((await request(app).get('/api/email/snapshot')).status).toBe(401);
  const result = await request(app).get('/api/email/snapshot').set(headers('admin'));
  expect(result.status).toBe(200);
  for (const key of ['campaigns', 'documents', 'sequences', 'activities']) expect(result.body[key]).toEqual([]);
  expect(result.body.delivery_connected).toBe(false);
});
test('knowledge writes enforce administrator policy and persist actual content', async () => {
  const body = { name: 'Product facts', type: 'Product knowledge', text: 'We provide accessible website design.' };
  expect((await request(app).post('/api/email/knowledge').set(headers('marketer')).send(body)).status).toBe(403);
  const result = await request(app).post('/api/email/knowledge').set(headers('admin')).send(body);
  expect(result.status).toBe(201); saved.document = result.body;
  const data = (await request(app).get('/api/email/snapshot').set(headers('marketer'))).body;
  expect(data.documents[0]).toMatchObject(body);
  expect((await request(app).get('/api/email/snapshot').set(headers('viewer'))).body.documents).toEqual([]);
  expect((await request(app).delete('/api/email/knowledge/' + result.body.id).set(headers('other')).send({})).status).toBe(404);
});
test('manual sequence saves, survives a new login, and cannot leak to viewers or another workspace', async () => {
  const result = await request(app).post('/api/email/sequences').set(headers('marketer')).send(sequenceBody());
  expect(result.status).toBe(201); saved.sequence = result.body;
  const login = await request(app).post('/api/auth/login').send({ email: `marketer-${suffix}@example.com`, password });
  expect(login.status).toBe(200);
  const snapshot = await request(app).get('/api/email/snapshot').set('Authorization', 'Bearer ' + login.body.access_token);
  expect(snapshot.body.sequences[0].id).toBe(result.body.id);
  expect((await request(app).get('/api/email/snapshot').set(headers('viewer'))).body.sequences).toEqual([]);
  expect((await request(app).get('/api/email/snapshot').set(headers('other'))).body.sequences).toEqual([]);
});
test('saving sequences rejects malformed content, unsafe copy, and foreign knowledge sources', async () => {
  const unsafe = sequenceBody();
  unsafe.emails[0].body = 'A message without a preference footer.';
  expect((await request(app).post('/api/email/sequences').set(headers('admin')).send(unsafe)).status).toBe(422);
  expect((await request(app).post('/api/email/sequences').set(headers('admin')).send({ ...sequenceBody(), emails: [null, null, null] })).status).toBe(422);
  expect((await request(app).post('/api/email/sequences').set(headers('viewer')).send(sequenceBody())).status).toBe(403);
  expect((await request(app).post('/api/email/sequences').set(headers('other')).send({ ...sequenceBody(), source: saved.document.id })).status).toBe(409);
});
test('sequence updates and deletes enforce tenant ownership and optimistic concurrency', async () => {
  const path = '/api/email/sequences/' + saved.sequence.id;
  expect((await request(app).put(path).set(headers('other')).send({ ...sequenceBody(), version: 1 })).status).toBe(409);
  expect((await request(app).put(path).set(headers('admin')).send({ ...sequenceBody(), name: 'Reviewed draft', version: 1 })).body.version).toBe(2);
  expect((await request(app).put(path).set(headers('marketer')).send({ ...sequenceBody(), version: 1 })).status).toBe(409);
  expect((await request(app).delete(path).set(headers('other')).send({ version: 2 })).status).toBe(409);
  expect((await request(app).delete(path).set(headers('admin')).send({ version: 2 })).status).toBe(200);
});
test('AI outage returns an explicit failure and creates no mock sequence', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
  const result = await request(app).post('/api/email/sequence').set(headers('admin')).send({ campaign_goal: 'Explain our services', audience_segment: 'Subscribers' });
  expect(result.status).toBe(503); expect(result.body.emails).toBeUndefined();
  expect((await request(app).get('/api/email/snapshot').set(headers('admin'))).body.sequences).toEqual([]);
});
test('AI generation uses only tenant business facts and persists validated output', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ response: JSON.stringify({ emails: fixtureEmails }) }) });
  const result = await request(app).post('/api/email/sequence').set(headers('admin')).send({ campaign_goal: 'Explain our services', audience_segment: 'Subscribers', tone: 'Friendly', source: saved.document.id });
  expect(result.status).toBe(200); expect(result.body.origin).toBe('ollama');
  expect(result.body.emails).toHaveLength(3);
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.prompt).toContain('accessible website design'); expect(payload.format).toBe('json');
  expect((await request(app).get('/api/email/snapshot').set(headers('admin'))).body.sequences[0].id).toBe(result.body.id);
});
test('AI malformed output is rejected rather than substituted or persisted', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ response: 'invalid JSON' }) });
  const result = await request(app).post('/api/email/sequence').set(headers('admin')).send({ campaign_goal: 'Explain our services', audience_segment: 'Subscribers' });
  expect(result.status).toBe(502);
  expect((await request(app).get('/api/email/snapshot').set(headers('admin'))).body.sequences).toHaveLength(1);
});
test('AI cannot read a source from another tenant', async () => {
  global.fetch = jest.fn();
  const result = await request(app).post('/api/email/sequence').set(headers('other')).send({ campaign_goal: 'Read foreign content', audience_segment: 'Subscribers', source: saved.document.id });
  expect(result.status).toBe(404); expect(global.fetch).not.toHaveBeenCalled();
});
test('AI output receives the required unsubscribe footer before safety checks and persistence', async () => {
  const emails = fixtureEmails.map(email => ({ ...email, body: 'Hello {{first_name}},\n\nTell us about your website needs.' }));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ response: JSON.stringify({ emails }) }) });
  const result = await request(app).post('/api/email/sequence').set(headers('admin')).send({ campaign_goal: 'Explain our services', audience_segment: 'Subscribers' });
  expect(result.status).toBe(200);
  expect(result.body.emails.every(email => email.body.endsWith('To unsubscribe from these emails, reply STOP or click here.'))).toBe(true);
});
test('knowledge deletion and recorded activity persist', async () => {
  expect((await request(app).delete('/api/email/knowledge/' + saved.document.id).set(headers('admin')).send({})).status).toBe(200);
  const snapshot = (await request(app).get('/api/email/snapshot').set(headers('admin'))).body;
  expect(snapshot.documents).toEqual([]);
  expect(snapshot.activities.some(event => event.title === 'Knowledge source removed')).toBe(true);
});
