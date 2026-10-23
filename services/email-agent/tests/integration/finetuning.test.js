'use strict';
// Isolated PostgreSQL + real routes. Model outputs below are explicit fixtures, not GPU evidence.
const request=require('supertest'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
process.env.AGENT_GATEWAY_SECRET=crypto.randomBytes(48).toString('hex');
const app=require('../../src/main'),pool=require('../../src/config/db');
const {withTenant}=require('../../src/lib/tenant');
const store=require('../../src/repositories/fineTuneStore');
const {groupFor,collect,score,regressionCases}=require('../../src/services/fineTuneDataset');
const accounts={},suffix=crypto.randomBytes(5).toString('hex');
const auth=role=>({Authorization:'Bearer '+accounts[role].access_token});
const emailBody='Hello {{first_name}},\nExplore our services: {{cta_link}}\nTo unsubscribe from these emails, reply STOP or click here.';
const emails=()=>[0,3,7].map((day,index)=>({email_index:index+1,send_at_days:day,subject:'Explore a useful next step',body:emailBody}));
const path='/api/email/finetuning';
let job,token,lease,workerId;
const originalFetch=global.fetch;
async function settings(role,changes){const current=(await request(app).get(path).set(auth(role))).body.settings;return request(app).put(path+'/settings').set(auth(role)).send({enabled:true,auto_queue:false,auto_activate:false,...changes,version:current.version});}
async function worker(operation,body={},credential=token,role='admin'){
 const url='/api/training-worker/'+operation,user=accounts[role].user;
 const identity=jwt.sign({sub:user.user_id,tenant_id:user.tenant_id,role:user.role,email:user.email,workspace_name:accounts[role].workspace.name,method:'POST',path:url,body_hash:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')},process.env.AGENT_GATEWAY_SECRET,{algorithm:'HS256',issuer:'ciftron-gateway',audience:'email-agent',expiresIn:'30s',jwtid:crypto.randomUUID()});
 return request(app).post(url).set({'X-Gateway-Identity':identity,Authorization:'Bearer '+credential}).send(body);
}
async function fixture(client,actor,name,extras={}){
 const row={name,audience:'Subscribers',tone:'Professional',source:'none',...extras};
 const result=(await client.query("INSERT INTO email_sequences(tenant_id,name,audience,tone,source,emails,origin,review_status,generation) VALUES($1,$2,$3,$4,$5,$6,'manual','Reviewed',$7) RETURNING *",[actor.tenant_id,row.name,row.audience,row.tone,row.source,JSON.stringify(row.emails||emails()),JSON.stringify(row.generation||{})])).rows[0];
 await client.query("INSERT INTO email_reviews(tenant_id,sequence_id,sequence_version,user_id,rating,verdict) VALUES($1,$2,$3,$4,5,'Reviewed')",[actor.tenant_id,result.id,extras.stale?0:1,actor.user_id]);return result;
}
jest.setTimeout(60000);
beforeAll(async()=>{
 if(!/^email_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME||''))throw new Error('Use the isolated verify-accounts.ps1 runner.');
 for(const role of ['admin','other']){const result=await request(app).post('/api/auth/register').send({name:'Training '+role,email:`ft-${role}-${suffix}@example.com`,workspace_name:'Training '+role,password:'FineTuneTestPass123!'});expect(result.status).toBe(201);accounts[role]=result.body;}
 for(const role of ['marketer','viewer']){
  const email=`ft-${role}-${suffix}@example.com`,invite=await request(app).post('/api/team/invitations').set(auth('admin')).send({email,role});expect(invite.status).toBe(201);
  const result=await request(app).post('/api/auth/register').send({email,name:'Training '+role,password:'FineTuneTestPass123!',invitation_token:new URLSearchParams(invite.body.invitation_url.split('?')[1]).get('invite')});expect(result.status).toBe(201);accounts[role]=result.body;
 }
});
afterEach(()=>{global.fetch=originalFetch;});
afterAll(()=>pool.end());
test('consent is independent, versioned, admin-only, and empty workspaces cannot train',async()=>{
 expect((await request(app).get(path)).status).toBe(401);
 expect((await request(app).get(path).set(auth('viewer'))).status).toBe(403);
 const initial=(await request(app).get(path).set(auth('marketer'))).body;
 expect(initial.settings).toMatchObject({enabled:false,version:0});expect(initial.readiness.ready).toBe(false);
 expect((await request(app).post(path+'/jobs').set(auth('admin')).send({})).status).toBe(409);
 expect((await request(app).put(path+'/settings').set(auth('marketer')).send({enabled:true,auto_queue:false,auto_activate:false,version:0})).status).toBe(403);
 expect((await settings('admin',{})).status).toBe(200);
 expect((await request(app).put(path+'/settings').set(auth('admin')).send({enabled:true,auto_queue:false,auto_activate:false,version:0})).status).toBe(409);
 expect((await request(app).post(path+'/jobs').set(auth('admin')).send({})).status).toBe(422);
 expect((await request(app).post(path+'/workers').set(auth('other')).send({})).status).toBe(409);
});
test('collects only current grounded reviewed non-sample text, deduplicates briefs and isolates stable holdouts',async()=>{
 await withTenant(accounts.admin.workspace.id,async client=>{
  let train=0,val=0,index=0;
  while(train<24||val<7){
   const name='Introduce a useful service '+index++,isVal=parseInt(groupFor({name,audience:'Subscribers',tone:'Professional'}).slice(0,8),16)%5===0;
   if(isVal?val>=7:train>=24)continue;
   await fixture(client,accounts.admin.user,name);isVal?val++:train++;
  }
  await fixture(client,accounts.admin.user,'Introduce a useful service 0');
  await fixture(client,accounts.admin.user,'[Sample] Fictional example',{generation:{sample:true}});
  await fixture(client,accounts.admin.user,'Stale review',{stale:true});
  await fixture(client,accounts.admin.user,'Write to person@example.com');
  await fixture(client,accounts.admin.user,'Invented offer',{emails:emails().map(e=>({...e,body:e.body.replace('Explore','Save 15% off. Explore')}))});
  const first=await collect(client,accounts.admin.workspace.id),second=await collect(client,accounts.admin.workspace.id);
  expect(first.readiness).toMatchObject({ready:true,training:24,validation:7});expect(first.readiness.excluded).toBeGreaterThanOrEqual(3);expect(first.hash).toBe(second.hash);
  expect(first.dataset.training.some(row=>first.dataset.validation.some(holdout=>holdout.group===row.group))).toBe(false);
  expect(JSON.stringify(first.dataset)).not.toContain('person@example.com');expect(JSON.stringify(first.dataset)).not.toContain('[Sample]');
 });
 expect((await request(app).get(path).set(auth('other'))).body.readiness.eligible).toBe(0);
});
test('worker tokens are scoped credentials, leases cannot be forged and generation pauses for the GPU',async()=>{
 const queued=await request(app).post(path+'/jobs').set(auth('admin')).send({});expect(queued.status).toBe(201);job=queued.body;
 expect((await request(app).post(path+'/jobs').set(auth('admin')).send({})).status).toBe(409);
 const issued=await request(app).post(path+'/workers').set(auth('admin')).send({});expect(issued.status).toBe(201);token=issued.body.token;workerId=issued.body.id;
 expect((await request(app).get(path).set({Authorization:'Bearer '+token})).status).toBe(401);
 expect((await request(app).post('/api/training-worker/claim').set({Authorization:'Bearer '+token}).send({})).status).toBe(401);
 expect((await worker('claim',{},token,'other')).status).toBe(403);
 expect((await worker('claim',{},token,'marketer')).status).toBe(403);
 const claimed=await worker('claim');expect(claimed.status).toBe(200);lease=claimed.body.job.lease;job={...job,...claimed.body.job};expect(job.tenant_id).toBe(accounts.admin.workspace.id);expect(job.dataset.training).toHaveLength(24);
 expect((await worker('claim')).body.job).toBeNull();
 expect((await worker('jobs/'+job.id+'/heartbeat',{lease:'a'.repeat(64),stage:'Training QLoRA'})).status).toBe(409);
 expect((await worker('jobs/'+job.id+'/heartbeat',{lease,stage:'Training QLoRA'})).status).toBe(200);
 const status=await request(app).get('/api/email/status').set(auth('admin'));expect(status.body.ai.status).toBe('training');
 expect((await request(app).get(path).set(auth('admin'))).body.jobs[0]).not.toHaveProperty('dataset');
});
test('server scores raw outputs, rejects hallucinations and never repairs missing unsubscribe footers',async()=>{
 const cases=[...job.dataset.validation,...job.dataset.regression],clean=cases.map(()=>JSON.stringify({emails:emails()}));
 const changed=clean.slice();changed[0]=JSON.stringify({emails:emails().map(e=>({...e,body:e.body.replace('Explore','Use FIRSTMONTH to save 10% off. Explore')}))});
 const result=await worker('jobs/'+job.id+'/complete',{lease,baseline_outputs:clean,candidate_outputs:changed,artifact:{model:job.candidate_model,adapter_sha256:'a'.repeat(64),training_mode:'qlora'},claimed_passed:true});
 expect(result.status).toBe(200);expect(result.body.status).toBe('rejected');expect(result.body.evaluation.passed).toBe(false);
 expect((await request(app).put(path+'/active-model').set(auth('admin')).send({job_id:job.id,version:1})).status).toBe(409);
 const unsubs=JSON.stringify({emails:emails().map(e=>({...e,body:'Hi {{first_name}}, visit {{cta_link}}. Reply STOP to unsubscribe.'}))});
 expect(score([unsubs],[regressionCases()[0]]).safety_rate).toBe(0);
});
test('validated tenant model activates only when served; rollback and withdrawal revoke the worker',async()=>{
 // A new, real reviewed fixture changes the dataset for a second job.
 await withTenant(accounts.admin.workspace.id,client=>fixture(client,accounts.admin.user,'A new reviewed campaign brief'));
 const queued=await request(app).post(path+'/jobs').set(auth('admin')).send({});expect(queued.status).toBe(201);
 const claim=await worker('claim');job=claim.body.job;lease=job.lease;
 const clean=[...job.dataset.validation,...job.dataset.regression].map(()=>JSON.stringify({emails:emails()}));
 const done=await worker('jobs/'+job.id+'/complete',{lease,baseline_outputs:clean,candidate_outputs:clean,artifact:{model:job.candidate_model,adapter_sha256:'b'.repeat(64),training_mode:'qlora'}});expect(done.body.status).toBe('validated');
 global.fetch=async()=>({ok:false});
 expect((await request(app).put(path+'/active-model').set(auth('admin')).send({job_id:job.id,version:1})).status).toBe(503);
 global.fetch=async()=>({ok:true,json:async()=>({})});
 expect((await request(app).put(path+'/active-model').set(auth('other')).send({job_id:job.id,version:1})).status).toBe(409);
 expect((await request(app).put(path+'/active-model').set(auth('admin')).send({job_id:job.id,version:1})).status).toBe(200);
 await withTenant(accounts.admin.workspace.id,async client=>expect(await store.selectedModel(client)).toBe(job.candidate_model));
 await withTenant(accounts.other.workspace.id,async client=>expect(await store.selectedModel(client)).not.toBe(job.candidate_model));
 expect((await request(app).put(path+'/active-model').set(auth('admin')).send({job_id:null,version:2})).status).toBe(200);
 expect((await settings('admin',{enabled:false})).status).toBe(200);
 expect((await worker('claim')).status).toBe(403);
 expect((await request(app).get(path).set(auth('admin'))).body.workers.find(row=>row.id===workerId).revoked_at).toBeTruthy();
});
test('disconnect retry, explicit cancellation and worker revocation invalidate old leases',async()=>{
 expect((await settings('admin',{})).status).toBe(200);
 const issued=await request(app).post(path+'/workers').set(auth('admin')).send({});token=issued.body.token;workerId=issued.body.id;
 await withTenant(accounts.admin.workspace.id,client=>fixture(client,accounts.admin.user,'One more fresh campaign brief'));
 expect((await request(app).post(path+'/jobs').set(auth('admin')).send({})).status).toBe(201);
 const first=(await worker('claim')).body.job;
 await withTenant(accounts.admin.workspace.id,client=>client.query("UPDATE email_finetune_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[first.id]));
 const second=(await worker('claim')).body.job;expect(second.id).toBe(first.id);expect(second.lease).not.toBe(first.lease);
 expect((await worker('jobs/'+first.id+'/heartbeat',{lease:first.lease,stage:'Preparing'})).status).toBe(409);
 expect((await request(app).delete(path+'/jobs/'+second.id).set(auth('other')).send({})).status).toBe(409);
 expect((await request(app).delete(path+'/jobs/'+second.id).set(auth('admin')).send({})).status).toBe(200);
 expect((await request(app).post(path+'/jobs/'+second.id+'/retry').set(auth('admin')).send({})).status).toBe(200);
 expect((await worker('claim')).body.job.id).toBe(second.id);
 expect((await request(app).delete(path+'/workers/'+workerId).set(auth('admin')).send({})).status).toBe(200);
 expect((await worker('claim')).status).toBe(403);
 expect((await request(app).get(path).set(auth('admin'))).body.jobs.find(row=>row.id===second.id).status).toBe('cancelled');
});
test('automatic queue and activation require fresh data, cooldown and exclusive shared GPU access',async()=>{
 await withTenant(accounts.other.workspace.id,async client=>{for(let index=0;index<65;index++)await fixture(client,accounts.other.user,'Independent campaign '+index);});
 expect((await settings('other',{auto_queue:true,auto_activate:true})).status).toBe(200);
 const otherToken=(await request(app).post(path+'/workers').set(auth('other')).send({})).body.token;
 // A connected worker queues its own eligible dataset automatically.
 const claimed=await worker('claim',{},otherToken,'other');expect(claimed.status).toBe(200);const otherJob=claimed.body.job;expect(otherJob).toBeTruthy();
 expect(otherJob.tenant_id).toBe(accounts.other.workspace.id);
 const adminToken=(await request(app).post(path+'/workers').set(auth('admin')).send({})).body.token;
 const last=(await request(app).get(path).set(auth('admin'))).body.jobs[0];
 expect((await request(app).post(path+'/jobs/'+last.id+'/retry').set(auth('admin')).send({})).status).toBe(200);
 expect((await worker('claim',{},adminToken)).body.job).toBeNull();
 const clean=[...otherJob.dataset.validation,...otherJob.dataset.regression].map(()=>JSON.stringify({emails:emails()}));
 // Autoactivation cannot select an adapter missing from the current inference server.
 global.fetch=async()=>({ok:false});
 const done=await worker('jobs/'+otherJob.id+'/complete',{lease:otherJob.lease,candidate_outputs:clean,baseline_outputs:clean,artifact:{model:otherJob.candidate_model,adapter_sha256:'c'.repeat(64),training_mode:'qlora'}},otherToken,'other');
 expect(done.body.status).toBe('validated');expect(done.body.activation_error).toBeTruthy();
 expect((await request(app).get(path).set(auth('other'))).body.settings.active_job_id).toBeNull();
 // No immediate retraining and no duplicate dataset while waiting for the next cycle.
 expect((await worker('claim',{},otherToken,'other')).body.job).toBeNull();
 const adminClaim=(await worker('claim',{},adminToken)).body.job;expect(adminClaim.id).toBe(last.id);
 await request(app).delete(path+'/jobs/'+last.id).set(auth('admin')).send({});
 // A changed dataset with sufficient novelty can pass cooldown once 24 hours elapsed.
 await withTenant(accounts.other.workspace.id,async client=>{await client.query("UPDATE email_finetune_jobs SET created_at=now()-interval '25 hours'");for(let index=0;index<12;index++)await fixture(client,accounts.other.user,'Additional fresh campaign '+index);});
 const next=(await worker('claim',{},otherToken,'other')).body.job;expect(next).toBeTruthy();expect(next.id).not.toBe(otherJob.id);
 global.fetch=async()=>({ok:true});
 const outputs=[...next.dataset.validation,...next.dataset.regression].map(()=>JSON.stringify({emails:emails()}));
 const passed=await worker('jobs/'+next.id+'/complete',{lease:next.lease,candidate_outputs:outputs,baseline_outputs:outputs,artifact:{model:next.candidate_model,adapter_sha256:'d'.repeat(64),training_mode:'qlora'}},otherToken,'other');
 expect(passed.body.status).toBe('validated');expect(passed.body.activation_error).toBeNull();
 expect((await request(app).get(path).set(auth('other'))).body.settings.active_job_id).toBe(next.id);
});
