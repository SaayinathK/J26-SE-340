const db=require('../config/db');
const {personaKey}=require('./performanceLearning');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function text(value,label,max=5000){if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label} is required (maximum ${max} characters)`);return value.trim();}
function validateEvidence(body){
 if(!['interview','survey','crm'].includes(body.source_type))fail('Use interview, survey or CRM evidence');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(body.collected_on)||!Number.isFinite(Date.parse(body.collected_on))||new Date(body.collected_on).toISOString().slice(0,10)!==body.collected_on||body.collected_on>new Date().toISOString().slice(0,10))fail('Use a valid collection date, not in the future');
 if(!Number.isInteger(body.sample_size)||body.sample_size<1||body.sample_size>10000000)fail('Enter the number of participants or customer records represented');
 if(body.confirm_source!==true)fail('Confirm this finding comes from actual research or customer records');
 return {source_type:body.source_type,collected_on:body.collected_on,sample_size:body.sample_size,source_reference:text(body.source_reference,'Source reference',500),audience:text(body.audience,'Sample audience',1000),finding:text(body.finding,'Finding'),limitations:text(body.limitations,'Research limitations',2000)};
}
function claimsFor(persona){return [{key:'description',text:persona.description},...persona.pain_points.map((pain,i)=>({key:`pain_${i}`,text:pain}))];}
function validateReview(persona,body,evidence){
 if(body.confirm_review!==true)fail('Confirm you reviewed the source and its relevance to these claims');
 const note=text(body.reviewer_note,'Review rationale',2000);
 if(!Array.isArray(body.links)||body.links.length>50)fail('Provide up to 50 claim-to-evidence links');
 const claims=claimsFor(persona),seen=new Set();
 const links=body.links.map(link=>{
  const source=evidence.find(e=>e.id===link.evidence_id&&!e.withdrawn_at);
  if(!source||!claims.some(c=>c.key===link.claim_key)||!['supports','contradicts'].includes(link.stance))fail('Choose an active campaign source and a valid persona claim');
  const identity=`${link.claim_key}:${link.evidence_id}`;if(seen.has(identity))fail('A source may be linked to a claim only once');seen.add(identity);
  const excerpt=text(link.excerpt,'Source excerpt',2000);
  if(!source.finding.includes(excerpt))fail('The excerpt must appear exactly in the recorded finding');
  return {claim_key:link.claim_key,evidence_id:source.id,stance:link.stance,excerpt,reason:text(link.reason,'Why this evidence supports or contradicts the claim',1000)};
 });
 return {links,reviewer_note:note};
}
function assess(persona,review,evidence){
 const claims=claimsFor(persona).map(claim=>{
  const links=(review?.links||[]).filter(l=>l.claim_key===claim.key).map(link=>({ ...link,source:evidence.find(e=>e.id===link.evidence_id&&!e.withdrawn_at)})).filter(l=>l.source);
  return {...claim,links,status:links.some(l=>l.stance==='contradicts')?'conflicting':links.some(l=>l.stance==='supports')?'supported':'unverified'};
 });
 const supported=claims.filter(c=>c.status==='supported').length;
 return {status:claims.some(c=>c.status==='conflicting')?'conflicting':supported===claims.length?'research_supported':supported?'partially_supported':'inferred',supported_claims:supported,total_claims:claims.length,claims,reviewed_at:review?.created_at||null,reviewer_note:review?.reviewer_note||null};
}
async function getResearch(tenant,campaign){
 const [evidence,reviews]=await Promise.all([
  db.query("SELECT *,to_char(collected_on,'YYYY-MM-DD') AS collected_on FROM persona_evidence WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC,id",[tenant,campaign.id],tenant),
  db.query('SELECT * FROM persona_research_reviews WHERE tenant_id=$1 AND campaign_id=$2 AND persona_set_id=$3 ORDER BY created_at DESC,id DESC',[tenant,campaign.id,campaign.persona_set_id],tenant),
 ]);
 return {evidence:evidence.rows,reviews:reviews.rows,personas:campaign.personas.map((p,index)=>({index,name:p.name,...assess(p,reviews.rows.find(r=>r.persona_key===personaKey(p)),evidence.rows)}))};
}
module.exports={validateEvidence,validateReview,claimsFor,assess,getResearch};
