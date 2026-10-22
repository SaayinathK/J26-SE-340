// Local database integration test. CRM responses and inference are synthetic; no external CRM request is made.
require('dotenv').config();
const assert=require('node:assert/strict');
const request=require('supertest');
const crypto=require('crypto');
const db=require('../src/config/db');
const provider=require('../src/services/crmClient');
const crm=require('../src/services/crmService');
const llm=require('../src/services/llmService');
require('../src/services/crmWorker').tick=async()=>{};
const app=require('../src/index');
const ids=[];
process.env.CRM_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
let contacts=Array.from({length:4},(_,i)=>({id:String(i),tags:['students'],email:'private@example.com',customFields:[{id:'pain',value:'Need practice'}]}));
provider.metadata=async()=>({business:{business_name:'CRM business'},fields:[{id:'pain',name:'Pain',dataType:'SINGLE_OPTIONS',options:['Need practice']}]});
provider.fetchAll=async(token,location,kind)=>kind==='contacts'?contacts:[{id:'deal',contactId:'0',status:'won'}];
llm.getEmbedding=async()=>Array(768).fill(0.01);
async function account(){const res=await request(app).post('/api/auth/register').send({name:'CRM smoke',email:`crm-${crypto.randomUUID()}@example.com`,password:crypto.randomUUID()});assert.equal(res.status,201);const id=require('jsonwebtoken').decode(res.body.token).clientId;ids.push(id);return {id,auth:`Bearer ${res.body.token}`};}
(async()=>{
 const a=await account(),b=await account();
 async function call(method,path,body,status=200,auth=a.auth){const r=await request(app)[method](path).set('Authorization',auth).send(body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
 const c=(await call('post','/campaigns',{name:'CRM test',profile:{business_name:'Campaign business',offer_name:'Course',target_audience:'Students'}},201)).campaign;
 const location='fixture-'+crypto.randomUUID();await call('post','/crm/connect',{location_id:location,token:'synthetic-token-only'});
 await call('put',`/crm/campaigns/${c.id}`,{tags:['students'],pain_field:'pain'});
 await crm.sync(a.id);let context=await crm.context(a.id,c.id);assert.equal(context.summary.contact_count,4);assert.equal(context.summary.recorded_pain_points[0].count,4);
 let leads=await call('get','/crm/leads?q=private%40example.com');assert.equal(leads.total,4);assert.equal(leads.leads[0].details.email,'private@example.com');
 assert.equal((await call('get','/crm/leads',undefined,200,b.auth)).total,0);
 assert.equal((await call('get','/crm/leads?tag=missing')).total,0);
 assert.equal((await call('get',`/crm/leads?campaign_id=${c.id}`)).total,4);
 await call('get',`/crm/leads?campaign_id=${c.id}`,undefined,404,b.auth);
 const revision=context.revision;await crm.sync(a.id);assert.equal((await crm.context(a.id,c.id)).revision,revision);
 const status=await call('get','/crm');assert.ok(!JSON.stringify(status).includes('synthetic-token'));assert.ok(!JSON.stringify(status).includes('private@example'));
 await call('put',`/crm/campaigns/${c.id}`,{tags:[]},404,b.auth);assert.equal(await crm.context(b.id,c.id),null);
 await call('post','/crm/connect',{location_id:location,token:'synthetic-token-only'},409,b.auth);
 const ctx=await require('../src/services/contextEngine').buildContext(a.id,'meta_ad','',null,c);assert.equal(ctx.crm_context.revision,revision);assert.ok(require('../src/services/metaCampaignService').buildMetaCampaignPrompt(ctx,'').userPrompt.includes('Need practice'));
 const original=provider.fetchAll;provider.fetchAll=async()=>{throw Object.assign(new Error('CRM unavailable'),{status:502});};await assert.rejects(crm.sync(a.id));assert.equal((await crm.context(a.id,c.id)).revision,revision);assert.equal((await crm.status(a.id)).connection.status,'error');provider.fetchAll=original;
 contacts=contacts.slice(0,2);await crm.sync(a.id);assert.equal((await crm.context(a.id,c.id)).summary.recorded_pain_points.length,0);assert.equal((await call('get','/crm/leads')).total,2);
 await db.query("UPDATE crm_campaign_context SET synced_at=now()-interval '25 hours' WHERE tenant_id=$1",[a.id],a.id);assert.equal(await crm.context(a.id,c.id),null);
 await call('post','/crm/disconnect',{});assert.equal((await call('get','/crm/leads')).total,0);assert.equal(await crm.context(a.id,c.id),null);
 console.log('PASS: encrypted connection, campaign mapping, sync, stable revisions, safe API, tenant isolation, prompt grounding, failure retention, deletion refresh, expiry and disconnect.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const id of ids)await db.pool.query('DELETE FROM clients WHERE id=$1',[id]);await db.pool.end();});
