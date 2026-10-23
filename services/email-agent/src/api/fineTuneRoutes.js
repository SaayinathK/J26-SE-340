'use strict';
const router=require('express').Router();
const {withTenant}=require('../lib/tenant');
const {requirePermission}=require('../policies/rbac');
const {uuid}=require('../repositories/sequenceStore');
const store=require('../repositories/fineTuneStore');
router.use(requirePermission('email:generate'),(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}};
router.get('/',handle(async(req,res)=>res.json(await withTenant(req.user.tenant_id,client=>store.snapshot(client,req.user.tenant_id)))));
router.put('/settings',requirePermission('workspace:manage'),handle(async(req,res)=>res.json(await withTenant(req.user.tenant_id,client=>store.saveSettings(client,req.user,req.body || {})))));
router.post('/jobs',requirePermission('workspace:manage'),handle(async(req,res)=>res.status(201).json(await withTenant(req.user.tenant_id,client=>store.queue(client,req.user)))));
router.post('/workers',requirePermission('workspace:manage'),handle(async(req,res)=>res.status(201).json(await withTenant(req.user.tenant_id,client=>store.issueWorker(client,req.user)))));
router.delete('/workers/:id',requirePermission('workspace:manage'),handle(async(req,res)=>{
 if(!uuid(req.params.id))return res.status(400).json({error:'Invalid worker.'});
 const result=await withTenant(req.user.tenant_id,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+req.user.tenant_id]);
  const result=await client.query('UPDATE email_finetune_workers SET revoked_at=now() WHERE id=$1 RETURNING id',[req.params.id]);
  await client.query("UPDATE email_finetune_jobs SET status='cancelled',stage='Worker access revoked',lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE worker_id=$1 AND status='running'",[req.params.id]);
  return result;
 });
 if(!result.rowCount)return res.status(404).json({error:'Worker not found.'});res.json({revoked:true});
}));
router.post('/jobs/:id/retry',requirePermission('workspace:manage'),handle(async(req,res)=>{
 if(!uuid(req.params.id))return res.status(400).json({error:'Invalid job.'});
 const result=await withTenant(req.user.tenant_id,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+req.user.tenant_id]);
  if(!(await store.settings(client)).enabled)throw store.fail('Enable fine-tuning consent before retrying.');
  if((await client.query("SELECT 1 FROM email_finetune_jobs WHERE status IN ('queued','running')")).rowCount)throw store.fail('A job is already queued or running.');
  const current=await require('../services/fineTuneDataset').collect(client,req.user.tenant_id);
  const job=(await client.query("UPDATE email_finetune_jobs SET status='queued',stage='Queued for retry',attempts=0,worker_id=NULL,error=NULL,lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND dataset_hash=$2 AND status IN ('failed','cancelled') RETURNING id,status",[req.params.id,current.hash])).rows[0];
  if(!current.readiness.ready || !job)throw store.fail('Only failed or cancelled jobs with unchanged eligible data can be retried. Otherwise queue a new dataset.');
  return job;
 });res.json(result);
}));
router.put('/active-model',requirePermission('workspace:manage'),handle(async(req,res)=>{
 if(req.body?.job_id!==null && !uuid(req.body?.job_id) || !Number.isInteger(req.body?.version))return res.status(422).json({error:'Choose a valid candidate or the configured default and current settings version.'});
 res.json(await withTenant(req.user.tenant_id,client=>store.activate(client,req.user,req.body.job_id,req.body.version)));
}));
router.delete('/jobs/:id',requirePermission('workspace:manage'),handle(async(req,res)=>{
 if(!uuid(req.params.id))return res.status(400).json({error:'Invalid job.'});
 const row=await withTenant(req.user.tenant_id,async client=>{await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+req.user.tenant_id]);return client.query("UPDATE email_finetune_jobs SET status='cancelled',stage='Cancelled by administrator',lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING id",[req.params.id]);});
 if(!row.rowCount)return res.status(409).json({error:'Only queued or running jobs can be cancelled.'});res.json({cancelled:true});
}));
module.exports={router,handle};
