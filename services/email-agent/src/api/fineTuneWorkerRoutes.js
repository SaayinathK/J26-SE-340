'use strict';
const router=require('express').Router();
const {withTenant}=require('../lib/tenant');
const {requirePermission}=require('../policies/rbac');
const {uuid}=require('../repositories/sequenceStore');
const store=require('../repositories/fineTuneStore');
const {handle}=require('./fineTuneRoutes');
router.use(requirePermission('workspace:manage'));
router.use((req,res,next)=>{if(!req.gatewayAuthenticated)return res.status(401).json({error:'Connect workers through the platform gateway.'});res.set('Cache-Control','no-store');next();});
router.post('/claim',handle(async(req,res)=>{
 const result=await withTenant(req.user.tenant_id,async client=>{await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+req.user.tenant_id]);const worker=await store.authenticateWorker(client,req.user,(req.headers.authorization || '').replace(/^Bearer /,''));return store.claim(client,req.user,worker);});
 res.json({job:result});
}));
for(const operation of ['heartbeat','complete','fail'])router.post('/jobs/:id/'+operation,handle(async(req,res)=>{
 if(!uuid(req.params.id))return res.status(400).json({error:'Invalid job.'});
 const result=await withTenant(req.user.tenant_id,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+req.user.tenant_id]);
  const worker=await store.authenticateWorker(client,req.user,(req.headers.authorization || '').replace(/^Bearer /,''));
  if(operation==='complete')return store.complete(client,req.user,worker,req.params.id,req.body || {});
  await store.leasedJob(client,worker,req.params.id,req.body?.lease);
  if(operation==='fail'){
   await client.query("UPDATE email_finetune_jobs SET status='failed',stage='Worker failed',error=$1,lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$2",[typeof req.body.error==='string'?req.body.error.slice(0,500):'Worker could not complete training.',req.params.id]);return {status:'failed'};
  }
  const stages=['Preparing','Evaluating baseline','Training QLoRA','Registering candidate','Evaluating candidate'];
  if(!stages.includes(req.body.stage))throw store.fail('Invalid progress stage.',422);
  await client.query("UPDATE email_finetune_jobs SET stage=$1,lease_expires_at=now()+interval '5 minutes',updated_at=now() WHERE id=$2",[req.body.stage,req.params.id]);return {status:'running'};
 });res.json(result);
}));
module.exports=router;
