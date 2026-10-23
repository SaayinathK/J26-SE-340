'use strict';
const request = require('supertest');
const crypto = require('node:crypto');
const app = require('../../src/main');
const pool = require('../../src/config/db');
const { withTenant } = require('../../src/lib/tenant');
const suffix = crypto.randomBytes(5).toString('hex');
const accounts = {};
const sequences = [];
const originalFetch = global.fetch;
const headers = role => ({ Authorization:'Bearer ' + accounts[role].access_token });
const body = name => ({ name,audience:'Interested customers',tone:'Professional',source:'none',emails:[0,3,7].map((day,index) => ({ email_index:index + 1,send_at_days:day,subject:'A useful introduction',body:'Hello {{first_name}},\n\nExplore our services: {{cta_link}}\n\nTo unsubscribe from these emails, reply STOP or click here.' })) });
let candidate;
jest.setTimeout(30000);
beforeAll(async () => {
  if (!/^email_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME || '')) throw new Error('Use the isolated verify-accounts.ps1 runner.');
  for (const role of ['admin','other']) {
    const result = await request(app).post('/api/auth/register').send({ name:'Learning ' + role,email:`learn-${role}-${suffix}@example.com`,workspace_name:'Learning ' + role,password:'LearningTestPass123!' });
    expect(result.status).toBe(201); accounts[role] = result.body;
  }
  for (const role of ['marketer','viewer']) {
    const email = `learn-${role}-${suffix}@example.com`;
    const invite = await request(app).post('/api/team/invitations').set(headers('admin')).send({ email,role });
    expect(invite.status).toBe(201);
    const registered = await request(app).post('/api/auth/register').send({ email,name:'Learning ' + role,password:'LearningTestPass123!',invitation_token:new URLSearchParams(invite.body.invitation_url.split('?')[1]).get('invite') });
    expect(registered.status).toBe(201); accounts[role] = registered.body;
  }
  for (let index = 0; index < 3; index++) {
    const result = await request(app).post('/api/email/sequences').set(headers('admin')).send(body('Learning sequence ' + index));
    expect(result.status).toBe(201); sequences.push(result.body);
  }
});
afterEach(() => { global.fetch = originalFetch; });
afterAll(() => pool.end());

test('synthetic samples cannot satisfy learning readiness, be overwritten as measurements, or become active guidance',async () => {
  const sample = await request(app).post('/api/email/sequences').set(headers('other')).send(body('[Sample] Test sequence'));
  expect(sample.status).toBe(201);
  let runId;
  await withTenant(accounts.other.workspace.id,async client => {
    await client.query("INSERT INTO email_outcomes (tenant_id,sequence_id,email_index,sequence_version,delivered,opened,clicked,replied,unsubscribed,features,provenance) VALUES ($1,$2,1,1,1000,300,100,20,0,'{}','synthetic')",[accounts.other.workspace.id,sample.body.id]);
    runId = (await client.query("INSERT INTO email_learning_runs (tenant_id,status,dataset_hash,sample_count,sequence_count,model,evaluation) VALUES ($1,'validated','sample-fixture',9,3,'{}','{\"synthetic\":true}') RETURNING id",[accounts.other.workspace.id])).rows[0].id;
  });
  const learning = (await request(app).get('/api/email/learning').set(headers('other'))).body;
  expect(learning.dataset).toMatchObject({records:0,sequences:0,delivered:0});
  expect((await request(app).put('/api/email/learning/settings').set(headers('other')).send({enabled:true,auto_train:false,version:0})).status).toBe(200);
  expect((await request(app).post('/api/email/learning/train').set(headers('other')).send({})).status).toBe(422);
  expect((await request(app).post('/api/email/learning/runs/' + runId + '/activate').set(headers('other')).send({})).status).toBe(409);
  expect((await request(app).put(`/api/email/sequences/${sample.body.id}/outcomes/1`).set(headers('other')).send({sequence_version:1,version:1,delivered:100,opened:30,clicked:10,replied:2,unsubscribed:0})).status).toBe(409);
  await withTenant(accounts.other.workspace.id,async client => {
    await client.query('UPDATE email_learning_settings SET active_run_id=$1',[runId]);
    expect(await require('../../src/repositories/learningStore').learningContext(client)).toBeNull();
    await client.query('DELETE FROM email_learning_settings');
    await client.query('DELETE FROM email_outcomes WHERE sequence_id=$1',[sample.body.id]);
    await client.query('DELETE FROM email_learning_runs WHERE id=$1',[runId]);
  });
});
test('learning starts disabled, enforces roles, and keeps snapshot compatibility',async () => {
  expect((await request(app).get('/api/email/learning')).status).toBe(401);
  expect((await request(app).get('/api/email/learning').set(headers('viewer'))).status).toBe(403);
  expect((await request(app).get('/api/email/snapshot').set(headers('viewer'))).status).toBe(200);
  const initial = await request(app).get('/api/email/learning').set(headers('admin'));
  expect(initial.body.settings).toMatchObject({ enabled:false,auto_train:false,version:0 });
  expect((await request(app).post('/api/email/learning/train').set(headers('admin')).send({})).status).toBe(409);
  expect((await request(app).put('/api/email/learning/settings').set(headers('marketer')).send({ enabled:true,auto_train:false,version:0 })).status).toBe(403);
  expect((await request(app).put('/api/email/learning/settings').set(headers('admin')).send({ enabled:true,auto_train:false,version:0 })).status).toBe(200);
  expect((await request(app).put('/api/email/learning/settings').set(headers('admin')).send({ enabled:true,auto_train:false,version:0 })).status).toBe(409);
  expect((await request(app).post('/api/email/learning/train').set(headers('admin')).send({})).status).toBe(422);
  expect((await request(app).get('/api/email/learning').set(headers('other'))).body.settings.enabled).toBe(false);
});
test('reviews are versioned, scoped, and editing returns a sequence to Draft',async () => {
  const endpoint = '/api/email/sequences/' + sequences[0].id + '/review';
  expect((await request(app).put(endpoint).set(headers('other')).send({ version:1,rating:5,verdict:'Reviewed' })).status).toBe(409);
  expect((await request(app).put(endpoint).set(headers('admin')).send({ version:1,rating:6,verdict:'Reviewed' })).status).toBe(422);
  expect((await request(app).put(endpoint).set(headers('marketer')).send({ version:1,rating:4,verdict:'Reviewed',note:'A useful introduction.' })).status).toBe(200);
  expect((await request(app).get('/api/email/snapshot').set(headers('admin'))).body.sequences.find(row => row.id === sequences[0].id).review_status).toBe('Reviewed');
  const update = await request(app).put('/api/email/sequences/' + sequences[0].id).set(headers('admin')).send({ ...body('Learning sequence 0'),version:1 });
  expect(update.body.review_status).toBe('Draft'); sequences[0] = update.body;
  expect((await request(app).put(endpoint).set(headers('admin')).send({ version:1,rating:5,verdict:'Reviewed' })).status).toBe(409);
  expect((await request(app).get('/api/email/insights').set(headers('other'))).body.reviews).toEqual([]);
});
test('measured outcomes validate counters, ownership and concurrency without double counting',async () => {
  for (const sequence of sequences) for (const index of [1,2]) {
    const endpoint = `/api/email/sequences/${sequence.id}/outcomes/${index}`;
    const payload = { sequence_version:sequence.version,version:0,delivered:100,opened:30,clicked:10,replied:2,unsubscribed:0 };
    expect((await request(app).put(endpoint).set(headers('other')).send(payload)).status).toBe(409);
    expect((await request(app).put(endpoint).set(headers('admin')).send({ ...payload,clicked:101 })).status).toBe(422);
    expect((await request(app).put(endpoint).set(headers('admin')).send(payload)).status).toBe(200);
    expect((await request(app).put(endpoint).set(headers('admin')).send(payload)).status).toBe(409);
  }
  const learning = (await request(app).get('/api/email/learning').set(headers('admin'))).body;
  expect(learning.dataset).toMatchObject({ records:6,sequences:3,delivered:600 });
  expect(learning.runs).toEqual([]);
  expect((await request(app).get('/api/email/insights').set(headers('other'))).body.outcomes).toEqual([]);
});
test('training persists evaluated aggregate models and only validated own runs can be activated',async () => {
  const result = await request(app).post('/api/email/learning/train').set(headers('admin')).send({});
  expect(result.status).toBe(200); candidate = result.body;
  expect(candidate.status).toBe('validated');
  expect(candidate.model).not.toHaveProperty('emails');
  expect(candidate.evaluation.training_records).toBe(4);
  expect(candidate.evaluation.validation_records).toBe(2);
  const repeated = await request(app).post('/api/email/learning/train').set(headers('admin')).send({});
  expect(repeated.body.id).toBe(candidate.id);
  expect((await request(app).post(`/api/email/learning/runs/${candidate.id}/activate`).set(headers('other')).send({})).status).toBe(409);
  expect((await request(app).post(`/api/email/learning/runs/${candidate.id}/activate`).set(headers('marketer')).send({})).status).toBe(403);
  expect((await request(app).post(`/api/email/learning/runs/${candidate.id}/activate`).set(headers('admin')).send({})).status).toBe(200);
});
test('active guidance reaches real generation prompts and revoking consent stops its use',async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok:true,json:async () => ({ response:JSON.stringify({ emails:body('x').emails }) }) });
  const generated = await request(app).post('/api/email/sequence').set(headers('admin')).send({ campaign_goal:'Introduce our services',audience_segment:'Interested customers',source:'none' });
  expect(generated.status).toBe(200);
  expect(generated.body.generation.learning_run_id).toBe(candidate.id);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).prompt).toContain('Workspace engagement guidance');
  const config = (await request(app).get('/api/email/learning').set(headers('admin'))).body.settings;
  expect((await request(app).put('/api/email/learning/settings').set(headers('admin')).send({ enabled:false,auto_train:false,version:config.version })).status).toBe(200);
  global.fetch.mockClear();
  const next = await request(app).post('/api/email/sequence').set(headers('admin')).send({ campaign_goal:'Introduce our services',audience_segment:'Interested customers',source:'none' });
  expect(next.body.generation.learning_run_id).toBe(null);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).prompt).not.toContain('Workspace engagement guidance');
});
test('continuous updates evaluate changed outcomes and activate a passing candidate',async () => {
  const config = (await request(app).get('/api/email/learning').set(headers('admin'))).body.settings;
  await request(app).put('/api/email/learning/settings').set(headers('admin')).send({ enabled:true,auto_train:true,version:config.version });
  const outcome = (await request(app).get('/api/email/insights').set(headers('admin'))).body.outcomes[0];
  const sequence = sequences.find(row => row.id === outcome.sequence_id);
  const update = await request(app).put(`/api/email/sequences/${sequence.id}/outcomes/${outcome.email_index}`).set(headers('admin')).send({ sequence_version:sequence.version,version:outcome.version,delivered:200,opened:60,clicked:20,replied:4,unsubscribed:0 });
  expect(update.status).toBe(200);
  const learning = (await request(app).get('/api/email/learning').set(headers('admin'))).body;
  expect(learning.runs).toHaveLength(2);
  expect(learning.settings.active_run_id).toBe(learning.runs[0].id);
  expect(learning.guidance.suggestions.length).toBeGreaterThan(0);
});
test('integration references are tenant-scoped preferences, not fabricated connections',async () => {
  const endpoint = '/api/email/integrations/gohighlevel';
  expect((await request(app).put(endpoint).set(headers('marketer')).send({ account_reference:'location-123',version:0 })).status).toBe(403);
  expect((await request(app).put(endpoint).set(headers('admin')).send({ account_reference:'https://invalid',version:0 })).status).toBe(422);
  const saved = await request(app).put(endpoint).set(headers('admin')).send({ account_reference:'location-123',version:0 });
  expect(saved.body.connected).toBe(false);
  expect((await request(app).get('/api/email/integrations').set(headers('admin'))).body.preferences[0].account_reference).toBe('location-123');
  expect((await request(app).get('/api/email/integrations').set(headers('other'))).body.preferences).toEqual([]);
});
test('new learning tables enforce row-level security even for direct application queries',async () => {
  for (const table of ['email_outcomes','email_reviews','email_learning_runs','email_learning_settings','email_integration_preferences']) {
    expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    const own = await withTenant(accounts.admin.workspace.id, client => client.query(`SELECT * FROM ${table}`));
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every(row => row.tenant_id === accounts.admin.workspace.id)).toBe(true);
  }
});
