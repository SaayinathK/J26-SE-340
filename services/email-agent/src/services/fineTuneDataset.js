'use strict';
const crypto=require('node:crypto');
const {buildEmailPrompt,BRAND_CONTEXT_LINE}=require('../agent/prompts/emailPrompt');
const {validateSequence}=require('../repositories/sequenceStore');
const {retrieveKnowledge}=require('../repositories/knowledgeContext');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const MIN_TRAIN=20,MIN_VALIDATION=5;
const FOOTER='To unsubscribe from these emails, reply STOP or click here.';
const contacts=/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s().-]*){9,}/i;
function groupFor(row){return digest([row.name,row.audience,row.tone].map(value=>value.trim().toLowerCase()).join('|'));}
function regressionCases(){
 const cases=[
  ['No offer','Maple Studio offers design consultations. No discounts, promo codes, free services or deadlines are offered.','Introduce the consultation service.'],
  ['Referral','Harbor Workshop offers a $20 referral credit. No promo code is required. There is no deadline.','Explain the referral credit.'],
  ['Verified code','Willow Tools offers 15% off with promo code GROW15. There is no deadline.','Introduce the current offer.'],
  ['Pricing','Cedar Workspace Starter costs $29/mo. No joining fee. No promo code or deadline.','Explain the Starter plan.'],
  ['Sessions','Lumen Coaching provides 45-minute sessions and 24/7 booking support. No promotional offer.','Introduce coaching sessions.'],
  ['Scarcity','Northpeak Studio offers ongoing discovery calls. There are no limited places and no offer end date.','Invite interested readers to learn more.'],
 ];
 return cases.map(([name,facts,goal],index)=>({id:'regression-'+index,facts,prompt:buildEmailPrompt(goal,'Interested subscribers',facts+'\n---\n'+BRAND_CONTEXT_LINE)}));
}
async function collect(client,tenantId){
 const workspace=(await client.query('SELECT name FROM tenants WHERE tenant_id=$1',[tenantId])).rows[0];
 const rows=(await client.query(`SELECT s.* FROM email_sequences s WHERE s.review_status='Reviewed'
  AND coalesce(s.generation->>'sample','false')<>'true' AND s.name NOT ILIKE '[Sample]%'
  AND EXISTS(SELECT 1 FROM email_reviews r WHERE r.sequence_id=s.id AND r.sequence_version=s.version AND r.verdict='Reviewed' AND r.rating>=4 AND r.note NOT ILIKE '[Sample]%')
  AND NOT EXISTS(SELECT 1 FROM email_outcomes o WHERE o.sequence_id=s.id AND o.provenance='synthetic')
  ORDER BY s.created_at DESC,s.id LIMIT 500`)).rows;
 const examples=[],seen=new Set();let excluded=0;
 for(const row of rows){
  try{
   const sourceRows=(await client.query("SELECT metadata FROM knowledge_base WHERE coalesce(metadata->>'archived','false')<>'true' AND ($1::uuid IS NULL OR entry_id=$1) ORDER BY created_at DESC,entry_id LIMIT 10",[row.source==='all'?null:row.source==='none'?null:row.source])).rows;
   if(row.source!=='none' && sourceRows.some(source=>source.metadata?.seed || /^\[Sample\]/i.test(source.metadata?.name || ''))){excluded++;continue;}
   const {facts}=await retrieveKnowledge(client,tenantId,row.source);
   if(validateSequence(row,facts).error || row.emails.some(email=>email.subject.length>60 || email.body.trim().split(/\s+/).length>150 || !email.body.trimEnd().endsWith(FOOTER) || !email.body.includes('{{first_name}}') || !email.body.includes('{{cta_link}}'))){excluded++;continue;}
   const context=[`${workspace.name} uses a ${row.tone.toLowerCase()} tone.`,facts,BRAND_CONTEXT_LINE].filter(Boolean).join('\n---\n');
   const prompt=buildEmailPrompt(row.name,row.audience,context),answer=JSON.stringify({emails:row.emails});
   if(contacts.test(prompt+' '+answer) || prompt.length+answer.length>12000){excluded++;continue;}
   const key=groupFor(row);if(seen.has(key)){excluded++;continue;}seen.add(key);
   examples.push({id:row.id+':'+row.version,group:groupFor(row),facts,prompt,messages:[{role:'user',content:prompt},{role:'assistant',content:answer}]});
  }catch(error){if(error.status===404){excluded++;continue;}throw error;}
 }
 // Stable campaign-group membership keeps the same brief out of training across runs.
 const validation=examples.filter(row=>parseInt(row.group.slice(0,8),16)%5===0).slice(0,24);
 const training=examples.filter(row=>parseInt(row.group.slice(0,8),16)%5!==0).slice(0,96);
 const ready=training.length>=MIN_TRAIN && validation.length>=MIN_VALIDATION;
 const dataset={training,validation,regression:regressionCases()};
 return {dataset,hash:digest(JSON.stringify(dataset)),readiness:{eligible:examples.length,training:training.length,validation:validation.length,excluded,minimum_training:MIN_TRAIN,minimum_validation:MIN_VALIDATION,ready}};
}
function score(outputs,cases){
 if(!Array.isArray(outputs) || outputs.length!==cases.length)throw Object.assign(new Error('Return one unmodified output for every evaluation case.'),{status:422});
 let passed=0,grounded=0,safe=0;
 const results=cases.map((item,index)=>{
  const output=outputs[index];if(typeof output!=='string' || output.length>16000)throw Object.assign(new Error('Invalid evaluation output.'),{status:422});
  let flags=[{check:'FORMAT'}],valid=false;
  try{const parsed=JSON.parse(output);const check=validateSequence({name:'Evaluation',audience:'Subscribers',tone:'Professional',source:'all',emails:parsed.emails},item.facts);flags=check.error && !check.flags.length?[{check:'FORMAT'}]:check.flags;if(Array.isArray(parsed.emails) && parsed.emails.some(email=>typeof email.body!=='string' || !email.body.trimEnd().endsWith(FOOTER)))flags.push({check:'UNSUBSCRIBE'});valid=!check.error && !flags.length && parsed.emails.every(email=>email.subject.length<=60 && email.body.split(/\s+/).length<=150 && email.body.includes('{{first_name}}') && email.body.includes('{{cta_link}}'));}catch{}
  const factSafe=!flags.some(flag=>['FORMAT','HALLUCINATION'].includes(flag.check));
  const safety=!flags.some(flag=>['FORMAT','PII','SPAM','TONE','UNSUBSCRIBE'].includes(flag.check));
  if(valid)passed++;if(factSafe)grounded++;if(safety)safe++;
  return {id:item.id,passed:valid,checks:[...new Set(flags.map(flag=>flag.check))]};
 });
 return {count:cases.length,pass_rate:passed/cases.length,grounding_rate:grounded/cases.length,safety_rate:safe/cases.length,results};
}
function evaluate(dataset,candidate,baseline){
 const cases=[...dataset.validation,...dataset.regression];
 const next=score(candidate,cases),before=score(baseline,cases);
 const passed=next.pass_rate>=.8 && next.pass_rate>=before.pass_rate && next.grounding_rate===1 && next.safety_rate===1;
 return {passed,candidate:next,baseline:before,criteria:{minimum_pass_rate:.8,grounding_rate:1,safety_rate:1,no_pass_rate_regression:true},limitation:'Pattern-based grounding; qualitative facts require human review.'};
}
module.exports={collect,evaluate,score,digest,groupFor,regressionCases};
