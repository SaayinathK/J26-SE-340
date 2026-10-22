const router=require('express').Router();
const db=require('../config/db');
const {protect}=require('../middleware/auth');
const {getCampaign,lockCampaign}=require('../services/campaignService');
const learning=require('../services/performanceLearning');
const meta=require('../services/metaInsights');
router.use(protect);
router.get('/summary',async(req,res,next)=>{try{
 const {rows}=await db.query(`SELECT count(*) FILTER(WHERE is_champion) AS approved_prompts,COALESCE(sum(positive_ratings),0) AS positive_ratings,COALESCE(sum(negative_ratings),0) AS negative_ratings FROM prompt_performance WHERE tenant_id=$1`,[req.tenant_id],req.tenant_id);
 res.json({success:true,summary:rows[0]});
}catch(e){next(e);}});
router.get('/meta',async(req,res,next)=>{try{
 const {rows}=await db.query('SELECT account_id,token_env,last_synced_at,last_error FROM meta_connections WHERE tenant_id=$1',[req.tenant_id],req.tenant_id);
 const c=rows[0];res.json({success:true,meta:{connected:!!(c&&process.env[c.token_env]),account_id:c?.account_id,last_synced_at:c?.last_synced_at,last_error:c?.last_error}});
}catch(e){next(e);}});
router.post('/meta/sync',async(req,res,next)=>{try{res.json({success:true,...await meta.syncTenant(req.tenant_id)});}catch(e){next(e);}});
router.get('/:id',async(req,res,next)=>{try{
 const campaign=await getCampaign(req.tenant_id,req.params.id);
 const data=await db.transaction(req.tenant_id,async run=>{
  const rows=await learning.rowsFor(req.tenant_id,campaign.id,run);
  const variants=(await run('SELECT * FROM creative_variants WHERE tenant_id=$1 AND campaign_id=$2 AND persona_set_id=$3 ORDER BY created_at DESC',[req.tenant_id,campaign.id,campaign.persona_set_id])).rows;
  const revisions=(await run('SELECT * FROM learning_revisions WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY revision DESC LIMIT 20',[req.tenant_id,campaign.id])).rows;
  const report=learning.evaluate(campaign,rows);
  const matched=rows.filter(r=>r.persona_set_id===campaign.persona_set_id&&r.day>=report.window.start&&r.day<=report.window.end);
  const scored=variants.map(v=>({...v,metrics:learning.rates(learning.sum(matched.filter(r=>r.variant_id===v.id))),currencies:[...new Set(matched.filter(r=>r.variant_id===v.id).map(r=>r.currency))]}));
  return {report,variants:scored,revisions,metrics:rows.filter(r=>r.persona_set_id===campaign.persona_set_id)};
 });res.json({success:true,campaign,...data});
}catch(e){next(e);}});
// Serialize edits and evaluation against generation to prevent stale decisions changing its context.
function mutate(fn){return async(req,res,next)=>{let unlock;try{
 await getCampaign(req.tenant_id,req.params.id);unlock=await lockCampaign(req.tenant_id,req.params.id);
 const campaign=await getCampaign(req.tenant_id,req.params.id);
 res.json({success:true,...await fn(req,campaign)});
}catch(e){if(e.code==='23505')e=Object.assign(new Error('This ad or creative combination is already registered'),{status:409});next(e);}finally{if(unlock)await unlock();}};}
router.post('/:id/variants',mutate(async(req,c)=>({variant:await learning.registerVariant(req.tenant_id,c,req.body)})));
router.post('/:id/metrics',mutate(async(req,c)=>({report:await learning.saveMetrics(req.tenant_id,c,req.body.variant_id,req.body.metrics)})));
router.post('/:id/evaluate',mutate(async(req,c)=>({report:await db.transaction(req.tenant_id,run=>learning.evaluateAndSave(req.tenant_id,c,run))})));
router.post('/:id/automatic',mutate(async(req,c)=>{
 if(typeof req.body.enabled!=='boolean')throw Object.assign(new Error('enabled must be a boolean'),{status:400});
 const {rows}=await db.query(`UPDATE content_campaigns SET auto_learning=$3,draft=NULL,version=version+1,
 winner_index=CASE WHEN winner_source='automatic' THEN NULL ELSE winner_index END,
 winner_source=CASE WHEN winner_source='automatic' THEN NULL ELSE winner_source END WHERE tenant_id=$1 AND id=$2 RETURNING *`,[req.tenant_id,c.id,req.body.enabled],req.tenant_id);
 return {report:await db.transaction(req.tenant_id,run=>learning.evaluateAndSave(req.tenant_id,rows[0],run))};
}));
router.post('/:id/link-ad',mutate(async(req,c)=>{
 if(!db.validTenant(req.body.variant_id))throw Object.assign(new Error('Valid variant ID required'),{status:400});
 return {variant:await meta.linkAd(req.tenant_id,c,req.body.variant_id,req.body.ad_id)};
}));
module.exports=router;
