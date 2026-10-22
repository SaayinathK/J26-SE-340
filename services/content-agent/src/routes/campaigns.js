const router = require('express').Router();
const {randomUUID} = require('node:crypto');
const db = require('../config/db');
const {protect} = require('../middleware/auth');
const {cleanProfile,getCampaign,lockCampaign} = require('../services/campaignService');
router.use(protect);
router.get('/', async(req,res,next)=>{
  try {
    const {rows} = await db.query('SELECT * FROM content_campaigns WHERE tenant_id = $1 ORDER BY updated_at DESC, id', [req.tenant_id],req.tenant_id);
    res.json({success:true,campaigns:rows});
  } catch(error) {next(error);}
});
router.post('/', async(req,res,next)=>{
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length>120) return res.status(400).json({success:false,error:'Campaign name (1–120 characters) required'});
    const profile = cleanProfile(req.body.profile);
    const {rows} = await db.query('INSERT INTO content_campaigns (id,tenant_id,name,profile) VALUES ($1,$2,$3,$4) RETURNING *',[randomUUID(),req.tenant_id,name,JSON.stringify(profile)],req.tenant_id);
    res.status(201).json({success:true,campaign:rows[0]});
  } catch(error) {next(error);}
});
router.put('/:id', async(req,res,next)=>{
  let unlock;
  try {
    const current = await getCampaign(req.tenant_id,req.params.id);
    unlock = await lockCampaign(req.tenant_id,current.id);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length>120 || !Number.isInteger(req.body.version)) return res.status(400).json({success:false,error:'Valid name and campaign version required'});
    const profile=cleanProfile(req.body.profile);
    const {rows}=await db.query(`UPDATE content_campaigns SET name=$3, profile=$4, personas='[]', winner_index=NULL, winner_source=NULL, learning_guidance=NULL, learning_evidence=NULL, persona_set_id=$6, draft=NULL, version=version+1, updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND version=$5 RETURNING *`,[req.tenant_id,current.id,name,JSON.stringify(profile),req.body.version,randomUUID()],req.tenant_id);
    if(!rows.length) return res.status(409).json({success:false,error:'Campaign changed. Reload before saving.'});
    res.json({success:true,campaign:rows[0]});
  } catch(error) {next(error);} finally {if(unlock)await unlock();}
});
router.post('/:id/winner', async(req,res,next)=>{
  let unlock;
  try {
    await getCampaign(req.tenant_id,req.params.id);
    unlock=await lockCampaign(req.tenant_id,req.params.id);
    const campaign=await getCampaign(req.tenant_id,req.params.id);
    const index=req.body.persona_index;
    if(!Number.isInteger(index)||campaign.personas.length!==3||!campaign.personas[index]||req.body.version!==campaign.version) return res.status(400).json({success:false,error:'Choose a persona from the current completed initial campaign'});
    const {rows}=await db.query(`UPDATE content_campaigns SET winner_index=$3, winner_source='manual', auto_learning=false, learning_guidance=NULL, learning_evidence=NULL, draft=NULL, version=version+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[req.tenant_id,campaign.id,index],req.tenant_id);
    res.json({success:true,campaign:rows[0]});
  } catch(error) {next(error);} finally {if(unlock)await unlock();}
});
module.exports=router;
