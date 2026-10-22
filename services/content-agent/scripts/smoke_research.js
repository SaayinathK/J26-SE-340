const root=require('node:path').resolve(__dirname,'..');
require(root+'/node_modules/dotenv').config({path:root+'/.env'});
const assert=require('node:assert/strict'),request=require(root+'/node_modules/supertest');
const db=require(root+'/src/config/db'),llm=require(root+'/src/services/llmService'),app=require(root+'/src/index');
const {claimsFor}=require(root+'/src/services/personaResearch');
const personas=[0,1,2].map(i=>({name:`Segment ${i}`,description:`Goal ${i}`,pain_points:['Need practice','Need starting point','Need explanations']}));
const creative=i=>({hooks:Array.from({length:10},(_,n)=>`Audience ${i} angle ${n}`),body_copies:Array.from({length:3},(_,n)=>({body:`Java option ${n} for segment ${i}`,primary_text:`Explore Java option ${n}`,headline:`Learn Java ${n}`,cta:'LEARN MORE'}))});
let queue=[],prompts=[];llm.getEmbedding=async()=>Array(768).fill(0.01);llm.callLLM=async args=>{prompts.push(args.prompt);const value=queue.shift();if(!value)throw new Error('Unexpected model call');return {output:JSON.stringify(value),tokensUsed:1};};
const ids=[];
async function account(){const res=await request(app).post('/api/auth/register').send({name:'Research smoke',email:`research-${require('crypto').randomUUID()}@example.com`,password:require('crypto').randomUUID()});assert.equal(res.status,201);ids.push(require(root+'/node_modules/jsonwebtoken').decode(res.body.token).clientId);return `Bearer ${res.body.token}`;}
(async()=>{
 const auth=await account(),foreign=await account();
 const post=async(path,body,status=200)=>{const r=await request(app).post(path).set('Authorization',auth).send(body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
 const campaign=(await post('/campaigns',{name:'CRM test',profile:{business_name:'Example',offer_name:'Java',target_audience:'IT students'}},201)).campaign;
 const path=`/research/${campaign.id}`;
 const record={source_reference:'Disposable test report',collected_on:'2026-01-01',sample_size:12,audience:'Test cohort',finding:'Goal 0. Need practice. Need starting point. Need explanations.',limitations:'Synthetic fixture used only in this software test.'};
 const imported=await post(`${path}/import-crm`,{records:[record],confirm_source:true});assert.equal(imported.imported,1);
 assert.equal((await post(`${path}/import-crm`,{records:[record],confirm_source:true})).skipped,1);
 queue=[{personas},creative(0),creative(1),creative(2)];await post('/content/generate',{content_type:'meta_ad',campaign_id:campaign.id});
 assert.ok(prompts[0].includes(record.finding));
 let data=(await request(app).get(path).set('Authorization',auth)).body;assert.equal(data.personas[0].status,'inferred');
 const evidence=data.evidence[0],setId=data.campaign.persona_set_id;
 const links=claimsFor(personas[0]).map(c=>({claim_key:c.key,evidence_id:evidence.id,stance:'supports',excerpt:c.text,reason:'Fixture source contains this claim'}));
 await post(`${path}/review`,{persona_index:0,persona_set_id:setId,links,reviewer_note:'Synthetic test review',confirm_review:true});
 data=(await request(app).get(path).set('Authorization',auth)).body;assert.equal(data.personas[0].status,'research_supported');assert.equal(data.reviews.length,1);
 assert.equal((await request(app).get(path).set('Authorization',foreign)).status,404);
 await post(`/campaigns/${campaign.id}/winner`,{persona_index:0,version:data.campaign.version});
 queue=[creative(0)];const winner=await post('/content/generate',{content_type:'meta_ad',campaign_id:campaign.id,generation_mode:'winner'});assert.equal(winner.personas[0].research_status,'research_supported');
 await post(`${path}/evidence/${evidence.id}/withdraw`,{});
 data=(await request(app).get(path).set('Authorization',auth)).body;assert.equal(data.personas[0].status,'inferred');
 queue=[creative(0)];const withdrawn=await post('/content/generate',{content_type:'meta_ad',campaign_id:campaign.id,generation_mode:'winner'});assert.equal(withdrawn.personas[0].research_status,'inferred');
 queue=[{personas},creative(0),creative(1),creative(2)];await post('/content/generate',{content_type:'meta_ad',campaign_id:campaign.id});
 await post(`${path}/review`,{persona_index:0,persona_set_id:setId,links,reviewer_note:'Stale review',confirm_review:true},409);
 console.log('PASS: CRM duplicate import, research in generation context, human claim review, winner support label, withdrawal downgrade, tenant isolation, stale persona review rejection');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 for(const id of ids){await db.pool.query('DELETE FROM prompt_performance WHERE tenant_id=$1',[id]);await db.pool.query('DELETE FROM generations WHERE tenant_id=$1',[id]);await db.pool.query('DELETE FROM clients WHERE id=$1',[id]);}await db.pool.end();
});
