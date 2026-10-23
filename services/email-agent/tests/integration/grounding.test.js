'use strict';
const request = require('supertest');
const crypto = require('node:crypto');
const app = require('../../src/main');
const pool = require('../../src/config/db');
const { withTenant } = require('../../src/lib/tenant');
const suffix = crypto.randomBytes(5).toString('hex');
const accounts = {};
const sources = {};
const context = 'First month free. Refer a friend, earn $20 credit. No joining fee.';
const invented = 'Use code FIRSTMONTH or YOUNGPRO26. Save 10% off all services, first 10 sign-ups only, until tomorrow at midnight.';
const footer = '\n\nTo unsubscribe from these emails, reply STOP or click here.';
const emails = first => [0,3,7].map((day,index) => ({ email_index:index + 1,send_at_days:day,subject:'A useful introduction',body:(index === 0 ? first : 'Hello {{first_name}}, explore our services at {{cta_link}}.') + footer }));
const manual = (first,source) => ({ name:'A grounded introduction',audience:'New subscribers',tone:'Professional',source,emails:emails(first) });
const headers = tenant => ({ Authorization:'Bearer ' + accounts[tenant].access_token });
const mockModel = first => { global.fetch = jest.fn().mockResolvedValue({ ok:true,json:async () => ({ response:JSON.stringify({ emails:emails(first) }) }) }); };
const originalFetch = global.fetch;
let sequence;
jest.setTimeout(30000);
beforeAll(async () => {
  if (!/^email_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME || '')) throw new Error('Use the isolated verify-accounts.ps1 runner.');
  for (const tenant of ['a','b','retry']) {
    const result = await request(app).post('/api/auth/register').send({ name:'Grounding ' + tenant,email:`grounding-${tenant}-${suffix}@example.com`,workspace_name:'Grounding ' + tenant,password:'GroundingTestPass123!' });
    expect(result.status).toBe(201); accounts[tenant] = result.body;
    const knowledge = await request(app).post('/api/email/knowledge').set(headers(tenant)).send({ name:'Approved offers',type:'Business context',text:tenant !== 'b' ? context : invented });
    expect(knowledge.status).toBe(201); sources[tenant] = knowledge.body.id;
  }
});
afterEach(() => { global.fetch = originalFetch; });
afterAll(() => pool.end());
test('generated inventions retry once, then return a saved reviewable draft with flags',async () => {
  mockModel(invented);
  const result = await request(app).post('/api/email/sequence').set(headers('a')).send({ campaign_goal:'Introduce our gym',audience_segment:'Young professionals',source:sources.a,context:invented });
  expect(result.status).toBe(200);
  expect(result.body.review_status).toBe('Needs review');
  expect(result.body.generation.attempts).toBe(2);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(result.body.guardrail_flags.filter(flag => flag.check === 'HALLUCINATION')).toHaveLength(5);
  expect(result.body.guardrail_flags.every(flag => flag.email_index === 1)).toBe(true);
  expect(result.body.guardrail_flags.some(flag => flag.occurrences.some(item => item.text === 'FIRSTMONTH'))).toBe(true);
  const prompt = JSON.parse(global.fetch.mock.calls[0][1].body).prompt;
  expect(prompt).toContain(context);
  expect(prompt).not.toContain('YOUNGPRO26');
  expect((await request(app).get('/api/email/snapshot').set(headers('a'))).body.sequences[0].id).toBe(result.body.id);
});
test('supported first-month-free and referral credit offers pass and persist',async () => {
  mockModel(context);
  const result = await request(app).post('/api/email/sequence').set(headers('a')).send({ campaign_goal:'Introduce our gym',audience_segment:'New members',source:sources.a });
  expect(result.status).toBe(200);
  expect(result.body.guardrail_flags).toEqual([]);
  expect(result.body).not.toHaveProperty('grounding_context');
  sequence = result.body;
});
test('campaign goals and caller-supplied context do not authorize an offer without knowledge',async () => {
  mockModel('Use code FIRSTMONTH for 10% off.');
  const result = await request(app).post('/api/email/sequence').set(headers('a')).send({ campaign_goal:'Use code FIRSTMONTH for 10% off',audience_segment:'New members',source:'none',grounding_context:invented });
  expect(result.status).toBe(200);
  expect(result.body.guardrail_flags.filter(flag => flag.check === 'HALLUCINATION')).toHaveLength(2);
});
test('grounding respects the selected source, even when another own source contains the offer',async () => {
  const other = await request(app).post('/api/email/knowledge').set(headers('a')).send({ name:'Another campaign',type:'Business context',text:'Use code FIRSTMONTH for 10% off.' });
  expect(other.status).toBe(201);
  mockModel('Use code FIRSTMONTH for 10% off.');
  const result = await request(app).post('/api/email/sequence').set(headers('a')).send({ campaign_goal:'Introduce our gym',audience_segment:'New members',source:sources.a });
  expect(result.status).toBe(200);
  expect(result.body.guardrail_flags.filter(flag => flag.check === 'HALLUCINATION')).toHaveLength(2);
});
test('flagged manual drafts can be saved, corrected, and approved only after checks pass',async () => {
  const create = await request(app).post('/api/email/sequences').set(headers('a')).send({ ...manual(invented,sources.a),context:invented });
  expect(create.status).toBe(201); expect(create.body.guardrail_flags).toHaveLength(5);
  const update = await request(app).put('/api/email/sequences/' + sequence.id).set(headers('a')).send({ ...manual(invented,sources.a),version:sequence.version });
  expect(update.status).toBe(200); expect(update.body.guardrail_flags).toHaveLength(5);
  expect(update.body.review_status).toBe('Needs review');
  expect(update.body.version).toBe(sequence.version + 1);
  const review = verdict => request(app).put('/api/email/sequences/' + sequence.id + '/review').set(headers('a')).send({ version:update.body.version,rating:4,verdict });
  expect((await review('Reviewed')).status).toBe(422);
  expect((await review('Needs changes')).status).toBe(200);
  const corrected = await request(app).put('/api/email/sequences/' + sequence.id).set(headers('a')).send({ ...manual(context,sources.a),version:update.body.version });
  expect(corrected.status).toBe(200); expect(corrected.body.guardrail_flags).toEqual([]); expect(corrected.body.review_status).toBe('Draft');
  expect((await request(app).put('/api/email/sequences/' + sequence.id + '/review').set(headers('a')).send({ version:corrected.body.version,rating:5,verdict:'Reviewed' })).status).toBe(200);
  const none = await request(app).post('/api/email/sequences').set(headers('a')).send(manual('Earn $20.','none'));
  expect(none.status).toBe(201); expect(none.body.guardrail_flags[0].check).toBe('HALLUCINATION');
});
test('existing ungrounded legacy drafts cannot be marked reviewed',async () => {
  const row = await withTenant(accounts.a.workspace.id,async client => (await client.query("INSERT INTO email_sequences (tenant_id,name,audience,tone,source,emails,origin) VALUES ($1,'Legacy draft','Members','Professional',$2,$3,'manual') RETURNING id",[accounts.a.workspace.id,sources.a,JSON.stringify(emails(invented))])).rows[0]);
  const result = await request(app).put('/api/email/sequences/' + row.id + '/review').set(headers('a')).send({ version:1,rating:5,verdict:'Reviewed' });
  expect(result.status).toBe(422); expect(result.body.guardrail_flags).toHaveLength(5);
  const saved = await withTenant(accounts.a.workspace.id,async client => (await client.query('SELECT review_status FROM email_sequences WHERE id=$1',[row.id])).rows[0]);
  expect(saved.review_status).toBe('Needs review');
});
test('source access remains isolated before any model call',async () => {
  global.fetch = jest.fn();
  const result = await request(app).post('/api/email/sequence').set(headers('a')).send({ campaign_goal:'Introduce our gym',audience_segment:'New members',source:sources.b });
  expect(result.status).toBe(404); expect(global.fetch).not.toHaveBeenCalled();
});

test('an automatic correction can remove invented offers using the same knowledge snapshot',async () => {
  const response = text => ({ ok:true,json:async () => ({ response:JSON.stringify({ emails:emails(text) }) }) });
  global.fetch = jest.fn().mockResolvedValueOnce(response(invented)).mockResolvedValueOnce(response(context));
  const result = await request(app).post('/api/email/sequence').set(headers('retry')).send({ campaign_goal:'Introduce our gym',audience_segment:'New members',source:sources.retry });
  expect(result.status).toBe(200); expect(result.body.guardrail_flags).toEqual([]);
  expect(result.body.review_status).toBe('Draft'); expect(result.body.generation.attempts).toBe(2);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body).prompt).toContain('CORRECTION:');
});
test('a failed retry preserves the first usable flagged draft',async () => {
  mockModel(invented);
  global.fetch.mockResolvedValueOnce({ ok:true,json:async () => ({ response:JSON.stringify({ emails:emails(invented) }) }) }).mockRejectedValueOnce(new Error('Provider down'));
  const result = await request(app).post('/api/email/sequence').set(headers('retry')).send({ campaign_goal:'Introduce our gym',audience_segment:'New members',source:sources.retry });
  expect(result.status).toBe(200); expect(result.body.guardrail_flags).toHaveLength(5);
  expect(result.body.generation.retry_status).toBe('failed'); expect(result.body.review_status).toBe('Needs review');
});
test('a clean first attempt does not trigger a retry',async () => {
  mockModel(context);
  const result = await request(app).post('/api/email/sequence').set(headers('retry')).send({ campaign_goal:'Introduce our gym',audience_segment:'New members',source:sources.retry });
  expect(result.status).toBe(200); expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(result.body.generation.attempts).toBe(1);
});
test('approval verifies current knowledge instead of trusting previously saved flags',async () => {
  const document = await request(app).post('/api/email/knowledge').set(headers('retry')).send({name:'Temporary offer',type:'Business context',text:'Save 10%.'});
  const draft = await request(app).post('/api/email/sequences').set(headers('retry')).send(manual('Save 10%.',document.body.id));
  expect(draft.status).toBe(201); expect(draft.body.guardrail_flags).toEqual([]);
  await withTenant(accounts.retry.workspace.id,client => client.query('UPDATE knowledge_base SET text=$1 WHERE entry_id=$2',['Explore our services.',document.body.id]));
  const review = await request(app).put('/api/email/sequences/' + draft.body.id + '/review').set(headers('retry')).send({version:draft.body.version,rating:5,verdict:'Reviewed'});
  expect(review.status).toBe(422); expect(review.body.guardrail_flags[0].detail).toBe('Ungrounded: 10%');
});
test('safety flags other than hallucinations still block approval while allowing edits',async () => {
  const unsafe = manual('Contact person@example.com. GUARANTEED EXCLUSIVE AMAZING INCREDIBLE SERVICES.',sources.retry);
  unsafe.emails[0].body = 'Contact person@example.com. GUARANTEED EXCLUSIVE AMAZING INCREDIBLE SERVICES.';
  const result = await request(app).post('/api/email/sequences').set(headers('retry')).send(unsafe);
  expect(result.status).toBe(201);
  expect(new Set(result.body.guardrail_flags.map(flag => flag.check))).toEqual(new Set(['PII','TONE','UNSUBSCRIBE']));
  const review = await request(app).put('/api/email/sequences/' + result.body.id + '/review').set(headers('retry')).send({ version:result.body.version,rating:3,verdict:'Reviewed' });
  expect(review.status).toBe(422);
});
test('archived knowledge stays recoverable but cannot ground drafts or approve old offers',async () => {
  const created = await request(app).post('/api/email/knowledge').set(headers('retry')).send({name:'Retired price',type:'Business context',text:'Save 25%.'});
  const id = created.body.id;
  const draft = await request(app).post('/api/email/sequences').set(headers('retry')).send(manual('Save 25%.','all'));
  expect(draft.body.guardrail_flags).toEqual([]);
  const foreign = await request(app).patch('/api/email/knowledge/' + id).set(headers('b')).send({archived:true});
  expect(foreign.status).toBe(404);
  const archive = await request(app).patch('/api/email/knowledge/' + id).set(headers('retry')).send({archived:true});
  expect(archive.status).toBe(200);
  const snapshot = (await request(app).get('/api/email/snapshot').set(headers('retry'))).body;
  expect(snapshot.documents.some(document => document.id === id)).toBe(false);
  expect(snapshot.archived_documents.find(document => document.id === id).text).toBe('Save 25%.');
  const flagged = await request(app).post('/api/email/sequences').set(headers('retry')).send(manual('Save 25%.','all'));
  expect(flagged.body.guardrail_flags[0].detail).toBe('Ungrounded: 25%');
  const selected = await request(app).post('/api/email/sequences').set(headers('retry')).send(manual('Save 25%.',id));
  expect(selected.status).toBe(409);
  const approval = await request(app).put('/api/email/sequences/' + draft.body.id + '/review').set(headers('retry')).send({version:draft.body.version,rating:5,verdict:'Reviewed'});
  expect(approval.status).toBe(422);
  const restore = await request(app).patch('/api/email/knowledge/' + id).set(headers('retry')).send({archived:false});
  expect(restore.status).toBe(200);
  const clean = await request(app).post('/api/email/sequences').set(headers('retry')).send(manual('Save 25%.','all'));
  expect(clean.body.guardrail_flags).toEqual([]);
});
