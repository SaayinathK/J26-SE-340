const root=require('node:path').resolve(__dirname,'..');
require(root+'/node_modules/dotenv').config({path:root+'/.env'});
const assert=require('node:assert/strict'),request=require(root+'/node_modules/supertest');
const db=require(root+'/src/config/db'),llm=require(root+'/src/services/llmService'),app=require(root+'/src/index');
const {dayAt}=require(root+'/src/services/performanceLearning');
const personas=[0,1,2].map(i=>({name:`Segment ${i}`,description:`Need ${i}`,pain_points:['Getting started','Choosing a path','Practicing skills']}));
const creative=i=>({hooks:Array.from({length:10},(_,n)=>`Audience ${i} angle ${n}`),body_copies:Array.from({length:3},(_,n)=>({body:`Practical Java option ${n} for segment ${i}`,primary_text:`Explore Java option ${n}`,headline:`Learn Java ${n}`,cta:'LEARN MORE'}))});
let queue=[],prompts=[];llm.getEmbedding=async()=>Array(768).fill(0.01);llm.callLLM=async args=>{prompts.push(args.prompt);const value=queue.shift();if(!value)throw new Error('Unexpected model call');return {output:JSON.stringify(value),tokensUsed:1};};
const ids=[];
async function account(){const res=await request(app).post('/api/auth/register').send({name:'Learning smoke',email:`learning-smoke-${require('crypto').randomUUID()}@example.com`,password:require('crypto').randomUUID()});assert.equal(res.status,201);ids.push(require(root+'/node_modules/jsonwebtoken').decode(res.body.token).clientId);return `Bearer ${res.body.token}`;}
(async()=>{
 const auth=await account(),foreign=await account();
 const send=async(path,body,expected=200)=>{const r=await request(app).post(path).set('Authorization',auth).send(body);assert.equal(r.status,expected,JSON.stringify(r.body));return r.body;};
 const campaign=(await send('/campaigns',{name:'Purchase test',profile:{business_name:'Example Learning',offer_name:'Java',target_audience:'IT students'}},201)).campaign;
 const path=`/learning/${campaign.id}`;
 queue=[{personas},creative(0),creative(1),creative(2)];
 const generated=await send('/content/generate',{campaign_id:campaign.id,content_type:'meta_ad'});
 assert.equal(generated.personas.length,3);
 const variants=[];
 for(let i=0;i<3;i++)variants.push((await send(`${path}/variants`,{generation_id:generated.content_id,persona_index:i,hook_index:0,body_index:0})).variant);
 const metrics=i=>[3,4,5].map(offset=>({day:dayAt(-offset),impressions:1000,link_clicks:100,purchases:20,spend:i===0?20:200+i*100,currency:'USD'}));
 for(let i=0;i<3;i++)await send(`${path}/metrics`,{variant_id:variants[i].id,metrics:metrics(i)});
 let data=(await request(app).get(path).set('Authorization',auth)).body;
 assert.equal(data.report.status,'winner');assert.equal(data.campaign.winner_index,0);assert.equal(data.campaign.winner_source,'automatic');assert.equal(data.revisions.length,1);
 await send(`${path}/metrics`,{variant_id:variants[0].id,metrics:metrics(0)});
 data=(await request(app).get(path).set('Authorization',auth)).body;
 assert.equal(data.metrics.length,9);assert.equal(data.revisions.length,1);
 assert.equal((await request(app).get(path).set('Authorization',foreign)).status,404);
 assert.equal((await request(app).post(`${path}/metrics`).set('Authorization',foreign).send({variant_id:variants[0].id,metrics:metrics(0)})).status,404);
 queue=[creative(0)];prompts=[];
 await send('/content/generate',{campaign_id:campaign.id,content_type:'meta_ad',generation_mode:'winner'});
 assert.equal(prompts.length,1);assert.ok(prompts[0].includes('performance_guidance'));assert.ok(prompts[0].includes('Prioritize this audience'));
 // Same rating and changed rating: never count the same generation twice.
 const rate=feedback=>send('/content/feedback',{generation_id:generated.content_id,feedback});
 await Promise.all([rate('positive'),rate('positive')]);
 let row=(await db.query('SELECT * FROM prompt_performance WHERE tenant_id=$1 AND prompt_hash=(SELECT prompt_hash FROM generations WHERE id=$2 AND tenant_id=$1)',[ids[0],generated.content_id],ids[0])).rows[0];
 assert.equal(row.positive_ratings,1);assert.equal(row.negative_ratings,0);
 await rate('negative');row=(await db.query('SELECT * FROM prompt_performance WHERE tenant_id=$1 AND prompt_hash=(SELECT prompt_hash FROM generations WHERE id=$2 AND tenant_id=$1)',[ids[0],generated.content_id],ids[0])).rows[0];assert.equal(row.positive_ratings,0);assert.equal(row.negative_ratings,1);
 // Correction removes the lead, withdraws guidance, and logs a new revision.
 await send(`${path}/metrics`,{variant_id:variants[0].id,metrics:metrics(0).map(m=>({...m,spend:1000}))});
 data=(await request(app).get(path).set('Authorization',auth)).body;
 assert.equal(data.campaign.winner_index,null);assert.equal(data.campaign.learning_guidance,null);assert.equal(data.revisions.length,2);
 await send(`/campaigns/${campaign.id}/winner`,{persona_index:2,version:data.campaign.version});
 await send(`${path}/metrics`,{variant_id:variants[0].id,metrics:metrics(0)});
 data=(await request(app).get(path).set('Authorization',auth)).body;assert.equal(data.campaign.winner_index,2);assert.equal(data.campaign.auto_learning,false);
 const meta=(await request(app).get('/learning/meta').set('Authorization',auth)).body;assert.equal(meta.meta.connected,false);
 console.log('PASS: real DB/API purchase winner, guidance reaches generation, correction withdrawal, revision dedupe, manual override, tenant isolation, concurrent feedback idempotency, unconnected Meta status');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 for(const id of ids){await db.pool.query('DELETE FROM prompt_performance WHERE tenant_id=$1',[id]);await db.pool.query('DELETE FROM generations WHERE tenant_id=$1',[id]);await db.pool.query('DELETE FROM clients WHERE id=$1',[id]);}
 await db.pool.end();
});
