const router=require('express').Router();
const {randomUUID}=require('node:crypto');
const db=require('../config/db');
const {protect}=require('../middleware/auth');
const {getCampaign,lockCampaign}=require('../services/campaignService');
const {personaKey}=require('../services/performanceLearning');
const research=require('../services/personaResearch');
router.use(protect);
router.get('/:id',async(req,res,next)=>{try{const c=await getCampaign(req.tenant_id,req.params.id);res.json({success:true,campaign:c,...await research.getResearch(req.tenant_id,c)});}catch(e){next(e);}});
function mutation(fn){return async(req,res,next)=>{let unlock;try{
 await getCampaign(req.tenant_id,req.params.id);unlock=await lockCampaign(req.tenant_id,req.params.id);
 const c=await getCampaign(req.tenant_id,req.params.id);const result=await fn(req,c);
 await db.query('UPDATE content_campaigns SET draft=NULL WHERE tenant_id=$1 AND id=$2',[req.tenant_id,c.id],req.tenant_id);
 res.json({success:true,...result});
}catch(e){next(e);}finally{if(unlock)await unlock();}};}
router.post('/:id/evidence',mutation(async(req,c)=>{
 const e=research.validateEvidence(req.body);
 const {rows}=await db.query(`INSERT INTO persona_evidence(id,tenant_id,campaign_id,source_type,source_reference,collected_on,sample_size,audience,finding,limitations)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),req.tenant_id,c.id,e.source_type,e.source_reference,e.collected_on,e.sample_size,e.audience,e.finding,e.limitations],req.tenant_id);
 return {evidence:rows[0]};
}));
router.post('/:id/import-crm',mutation(async(req,c)=>{
 if(req.body.confirm_source!==true||!Array.isArray(req.body.records)||!req.body.records.length||req.body.records.length>100)throw Object.assign(new Error('Confirm the CRM source and provide 1–100 anonymized summary rows'),{status:400});
 const records=req.body.records.map(row=>research.validateEvidence({...row,source_type:'crm',confirm_source:true}));
 let imported=0;
 await db.transaction(req.tenant_id,async run=>{
  for(const e of records){
   const existing=await run(`SELECT id FROM persona_evidence WHERE tenant_id=$1 AND campaign_id=$2 AND source_type='crm'
    AND source_reference=$3 AND collected_on=$4 AND sample_size=$5 AND audience=$6 AND finding=$7 AND limitations=$8`,[req.tenant_id,c.id,e.source_reference,e.collected_on,e.sample_size,e.audience,e.finding,e.limitations]);
   if(existing.rows.length)continue;
   await run(`INSERT INTO persona_evidence(id,tenant_id,campaign_id,source_type,source_reference,collected_on,sample_size,audience,finding,limitations)
    VALUES($1,$2,$3,'crm',$4,$5,$6,$7,$8,$9)`,[randomUUID(),req.tenant_id,c.id,e.source_reference,e.collected_on,e.sample_size,e.audience,e.finding,e.limitations]);imported++;
  }
 });return {imported,skipped:records.length-imported};
}));
router.post('/:id/evidence/:evidenceId/withdraw',mutation(async(req,c)=>{
 if(!db.validTenant(req.params.evidenceId))throw Object.assign(new Error('Invalid evidence ID'),{status:400});
 const {rows}=await db.query('UPDATE persona_evidence SET withdrawn_at=COALESCE(withdrawn_at,now()) WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3 RETURNING id',[req.tenant_id,c.id,req.params.evidenceId],req.tenant_id);
 if(!rows.length)throw Object.assign(new Error('Evidence not found'),{status:404});return {};
}));
router.post('/:id/review',mutation(async(req,c)=>{
 if(req.body.persona_set_id!==c.persona_set_id||!Number.isInteger(req.body.persona_index)||!c.personas[req.body.persona_index])throw Object.assign(new Error('Personas changed. Reload and review the current persona set.'),{status:409});
 const p=c.personas[req.body.persona_index],data=await research.getResearch(req.tenant_id,c);
 const review=research.validateReview(p,req.body,data.evidence);
 await db.query('INSERT INTO persona_research_reviews(id,tenant_id,campaign_id,persona_set_id,persona_key,links,reviewer_note) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),req.tenant_id,c.id,c.persona_set_id,personaKey(p),JSON.stringify(review.links),review.reviewer_note],req.tenant_id);
 return {assessment:research.assess(p,review,data.evidence)};
}));
module.exports=router;
