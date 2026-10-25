// Live integration check: real Ollama + PostgreSQL, disposable account only.
require('dotenv').config();
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const request = require('supertest');
const app = require('../src/index');
const db = require('../src/config/db');
const {validateMetaCampaign} = require('../src/services/metaCampaignService');
let tenant;
(async () => {
  const registration = await request(app).post('/api/auth/register').send({name:'Generation smoke',email:`generation-smoke-${randomUUID()}@example.com`,password:randomUUID()});
  assert.equal(registration.status,201,JSON.stringify(registration.body));
  tenant = require('jsonwebtoken').decode(registration.body.token).clientId;
  const auth = `Bearer ${registration.body.token}`;
  const created = await request(app).post('/campaigns').set('Authorization',auth).send({name:'Disposable live generation',profile:{business_name:'Example Learning',offer_name:'Introductory Java course',target_audience:'IT students learning Java',offer_location:'Colombo',brand_voice:'Clear, concise and practical'}});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const campaignId = created.body.campaign.id;
  async function generate(mode,count) {
    console.log(`Starting real ${mode} generation`);
    const started = Date.now();
    const res = await request(app).post('/content/generate').set('Authorization',auth).set('Accept','application/x-ndjson').send({campaign_id:campaignId,content_type:'meta_ad',generation_mode:mode});
    assert.equal(res.status,200,JSON.stringify(res.body));
    const events = res.text.trim().split('\n').map(JSON.parse);
    const failure = events.find(e=>e.type==='error');
    assert.equal(failure,undefined,JSON.stringify(failure));
    const result = events.find(e=>e.type==='complete')?.data;
    assert.ok(result?.content_id,'No persisted completion');
    assert.deepEqual(validateMetaCampaign(result,count),[]);
    const history = await request(app).get(`/content/history?campaign_id=${campaignId}`).set('Authorization',auth);
    const saved = history.body.history.find(row=>row.id===result.content_id);
    assert.ok(saved,'Generation missing from history');
    assert.deepEqual(validateMetaCampaign(typeof saved.output==='string'?JSON.parse(saved.output):saved.output,count),[]);
    console.log(`PASS ${mode}: ${count} personas, ${count*10} hooks, ${count*3} bodies, persisted history; ${Math.round((Date.now()-started)/1000)}s, ${result.attempts} model calls`);
  }
  await generate('initial',3);
  const campaigns = await request(app).get('/campaigns').set('Authorization',auth);
  const campaign = campaigns.body.campaigns.find(c=>c.id===campaignId);
  assert.equal(campaign.draft,null);
  const selected = await request(app).post(`/campaigns/${campaignId}/winner`).set('Authorization',auth).send({persona_index:0,version:campaign.version});
  assert.equal(selected.status,200,JSON.stringify(selected.body));
  await generate('winner',1);
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  if(tenant) await db.transaction(tenant,async run=>{
    await run('DELETE FROM prompt_performance WHERE tenant_id=$1',[tenant]);
    await run('DELETE FROM generations WHERE tenant_id=$1',[tenant]);
    await run('DELETE FROM clients WHERE id=$1',[tenant]);
  });
  await db.pool.end();
});
