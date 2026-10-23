'use strict';
const crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const {collect,digest,evaluate}=require('../services/fineTuneDataset');
const {event}=require('./sequenceStore');
const {request:modelRequest}=require('../clients/model_client');
const BASE=process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_K_M';
const workerPurpose={issuer:'ciftron-email-agent',audience:'ciftron-colab-worker'};
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
async function settings(client){return (await client.query('SELECT * FROM email_finetune_settings')).rows[0] || {enabled:false,auto_queue:false,auto_activate:false,active_job_id:null,version:0};}
async function selectedModel(client){const config=await settings(client);if(!config.enabled || !config.active_job_id)return BASE;return (await client.query("SELECT candidate_model FROM email_finetune_jobs WHERE id=$1 AND status='validated'",[config.active_job_id])).rows[0]?.candidate_model || BASE;}
async function snapshot(client,tenantId){
 const config=await settings(client),data=await collect(client,tenantId);
 const jobs=(await client.query('SELECT id,status,dataset_hash,example_count,candidate_model,baseline_model,stage,evaluation,artifact,error,created_at,updated_at,lease_expires_at FROM email_finetune_jobs ORDER BY created_at DESC LIMIT 20')).rows;
 const workers=(await client.query('SELECT id,name,expires_at,revoked_at,last_seen_at FROM email_finetune_workers ORDER BY created_at DESC LIMIT 10')).rows;
 return {settings:config,readiness:data.readiness,jobs,workers,selected_model:await selectedModel(client),base_model:BASE,worker_token_hours:8,automatic_cooldown_hours:24};
}
async function saveSettings(client,user,body){
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+user.tenant_id]);
 const {enabled,auto_queue,auto_activate,version}=body;
 if(![enabled,auto_queue,auto_activate].every(value=>typeof value==='boolean') || !Number.isInteger(version) || version<0 || !enabled && (auto_queue || auto_activate))throw fail('Provide valid consent, automation preferences and version.',422);
 const result=version===0?await client.query('INSERT INTO email_finetune_settings(tenant_id,enabled,auto_queue,auto_activate) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',[user.tenant_id,enabled,auto_queue,auto_activate]):await client.query('UPDATE email_finetune_settings SET enabled=$1,auto_queue=$2,auto_activate=$3,active_job_id=CASE WHEN $1 THEN active_job_id ELSE NULL END,version=version+1,updated_at=now() WHERE version=$4 RETURNING *',[enabled,auto_queue,auto_activate,version]);
 if(!result.rows[0])throw fail('Fine-tuning preferences changed. Refresh and try again.');
 if(!enabled){await client.query("UPDATE email_finetune_jobs SET status='cancelled',stage='Consent withdrawn',lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE status IN ('queued','running')");await client.query('UPDATE email_finetune_workers SET revoked_at=now() WHERE revoked_at IS NULL');}
 await event(client,user,'Language-model training preferences updated',enabled?'Reviewed workspace text may be processed in the connected Colab runtime.':'Fine-tuning consent withdrawn; pending jobs cancelled and worker access revoked.','shield');
 return result.rows[0];
}
async function queue(client,user,{automatic=false}={}){
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+user.tenant_id]);
 const config=await settings(client);
 if(!config.enabled)throw fail('Enable language-model fine-tuning consent first.');
 if(automatic && !config.auto_queue)return null;
 const open=(await client.query("SELECT id FROM email_finetune_jobs WHERE status IN ('queued','running') LIMIT 1")).rows[0];
 if(open){if(automatic)return null;throw fail('A fine-tuning job is already queued or running.');}
 const previous=(await client.query('SELECT dataset,created_at FROM email_finetune_jobs ORDER BY created_at DESC LIMIT 1')).rows[0];
 if(automatic && previous && Date.now()-new Date(previous.created_at).getTime()<86400000)return null;
 const data=await collect(client,user.tenant_id);
 if(!data.readiness.ready){if(automatic)return null;throw fail('Need at least 20 training and 5 held-out campaign groups with current 4/5-or-better reviews and clean guardrails.',422);}
 if(automatic && previous){const old=new Set([...previous.dataset.training,...previous.dataset.validation].map(row=>row.id));if([...data.dataset.training,...data.dataset.validation].filter(row=>!old.has(row.id)).length<10)return null;}
 if((await client.query('SELECT 1 FROM email_finetune_jobs WHERE dataset_hash=$1',[data.hash])).rowCount){if(automatic)return null;throw fail('This dataset already has a job. Retry a failed or cancelled job, or add reviewed examples.');}
 const id=crypto.randomUUID(),model='c4ft-'+user.tenant_id+'-'+id;
 const row=(await client.query('INSERT INTO email_finetune_jobs(id,tenant_id,created_by,dataset_hash,dataset,example_count,candidate_model,baseline_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status,candidate_model',[id,user.tenant_id,user.user_id,data.hash,JSON.stringify(data.dataset),data.readiness.training+data.readiness.validation,model,await selectedModel(client)])).rows[0];
 await event(client,user,'QLoRA job queued','Tenant-specific reviewed examples. Waiting for a connected Colab worker.','refresh');return row;
}
async function issueWorker(client,user){
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+user.tenant_id]);
 if(!(await settings(client)).enabled)throw fail('Enable fine-tuning consent before connecting Colab.');
 if((await client.query('SELECT count(*)::int AS count FROM email_finetune_workers WHERE revoked_at IS NULL AND expires_at>now()')).rows[0].count>=3)throw fail('Revoke an unused Colab connection before creating another.');
 if(Buffer.byteLength(process.env.AGENT_GATEWAY_SECRET || '')<32)throw fail('The gateway training connection is not configured.',503);
 const id=crypto.randomUUID(),token=jwt.sign({sub:user.user_id,tenant_id:user.tenant_id,jti:id},process.env.AGENT_GATEWAY_SECRET,{algorithm:'HS256',...workerPurpose,expiresIn:'8h'});
 await client.query("INSERT INTO email_finetune_workers(id,tenant_id,created_by,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",[id,user.tenant_id,user.user_id,digest(token)]);
 return {id,token,expires_in:28800};
}
async function authenticateWorker(client,user,token){
 let claims;try{claims=jwt.verify(token,process.env.AGENT_GATEWAY_SECRET,{algorithms:['HS256'],...workerPurpose});}catch{throw fail('Invalid or expired Colab worker token.',401);}
 if(claims.sub!==user.user_id || claims.tenant_id!==user.tenant_id)throw fail('Worker identity does not match this workspace.',403);
 const row=(await client.query('SELECT * FROM email_finetune_workers WHERE id=$1 AND created_by=$2 AND token_hash=$3 AND revoked_at IS NULL AND expires_at>now()',[claims.jti,user.user_id,digest(token)])).rows[0];
 if(!row || !(await settings(client)).enabled)throw fail('Colab access was revoked or training consent is disabled.',403);
 await client.query('UPDATE email_finetune_workers SET last_seen_at=now() WHERE id=$1',[row.id]);return row;
}
async function claim(client,user,worker){
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+user.tenant_id]);
 if(!(await settings(client)).enabled)throw fail('Fine-tuning consent is disabled.',403);
 await client.query("UPDATE email_finetune_jobs SET status=CASE WHEN attempts<2 THEN 'queued' ELSE 'failed' END,stage=CASE WHEN attempts<2 THEN 'Retry after worker disconnect' ELSE 'Worker disconnected twice' END,worker_id=NULL,lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE status='running' AND lease_expires_at<=now()");
 if(!(await client.query("SELECT 1 FROM email_finetune_jobs WHERE status IN ('queued','running')")).rowCount)await queue(client,user,{automatic:true});
 const job=(await client.query("SELECT * FROM email_finetune_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
 if(!job)return null;
 await client.query("SELECT pg_advisory_xact_lock(hashtext('email-finetune-shared-gpu'))");
 // One shared GPU: defer another tenant until the current lease is finished.
 if((await client.query('SELECT auth_private.finetune_gpu_busy() AS busy')).rows[0].busy)return null;
 const lease=crypto.randomBytes(32).toString('hex');
 await client.query("UPDATE email_finetune_jobs SET status='running',stage='Worker connected',worker_id=$1,lease_hash=$2,lease_expires_at=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE id=$3",[worker.id,digest(lease),job.id]);
 return {id:job.id,tenant_id:job.tenant_id,lease,dataset:job.dataset,dataset_hash:job.dataset_hash,candidate_model:job.candidate_model,baseline_model:job.baseline_model,base_hf_model:'unsloth/mistral-7b-instruct-v0.3',ollama_base:'mistral:7b-instruct-v0.3-q4_K_M'};
}
async function leasedJob(client,worker,id,lease){
 if(typeof lease!=='string' || !/^[a-f0-9]{64}$/.test(lease))throw fail('Invalid job lease.',403);
 const row=(await client.query("SELECT * FROM email_finetune_jobs WHERE id=$1 AND worker_id=$2 AND lease_hash=$3 AND status='running' AND lease_expires_at>now() FOR UPDATE",[id,worker.id,digest(lease)])).rows[0];
 if(!row)throw fail('Job is no longer assigned to this worker.',409);return row;
}
async function activate(client,user,id,version){
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['email-finetune-'+user.tenant_id]);
 const config=await settings(client);if(!config.enabled || config.version!==version)throw fail('Enable training consent and refresh the current preferences.');
 if(id){
  const row=(await client.query("SELECT * FROM email_finetune_jobs WHERE id=$1 AND status='validated'",[id])).rows[0];
  if(!row?.evaluation?.passed)throw fail('Choose a validated model from this workspace.');
  const response=await modelRequest('/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:row.candidate_model}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw fail('The candidate is not available on the configured model server. Keep the Colab runtime and inference tunnel running.',503);
 }
 await client.query('UPDATE email_finetune_settings SET active_job_id=$1,version=version+1,updated_at=now() WHERE tenant_id=$2',[id,user.tenant_id]);
 await event(client,user,id?'Tenant language model activated':'Language model rolled back to configured default','Only this workspace model selection was changed.','sparkles');return {active_job_id:id};
}
async function complete(client,user,worker,id,body){
 const job=await leasedJob(client,worker,id,body.lease);
 if(!body.artifact || !/^[a-f0-9]{64}$/.test(body.artifact.adapter_sha256 || '') || body.artifact.model!==job.candidate_model || body.artifact.training_mode!=='qlora')throw fail('Provide the trained adapter checksum and assigned candidate model.',422);
 const evaluation=evaluate(job.dataset,body.candidate_outputs,body.baseline_outputs),status=evaluation.passed?'validated':'rejected';
 const artifact={adapter_sha256:body.artifact.adapter_sha256,model:job.candidate_model,training_mode:'qlora'};
 await client.query('UPDATE email_finetune_jobs SET status=$1,stage=$2,evaluation=$3,artifact=$4,lease_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$5',[status,evaluation.passed?'Evaluation passed':'Evaluation rejected candidate',JSON.stringify(evaluation),JSON.stringify(artifact),id]);
 await event(client,user,'QLoRA candidate evaluated',evaluation.passed?'Candidate passed grounding, safety and regression thresholds.':'Candidate failed evaluation. Active model unchanged.','checks');
 const config=await settings(client);let activation_error=null;
 if(evaluation.passed && config.auto_activate){await client.query('SAVEPOINT activation');try{await activate(client,user,id,config.version);}catch(error){await client.query('ROLLBACK TO SAVEPOINT activation');activation_error='Candidate saved, but activation failed. Check the model connection and activate manually.';}}
 return {status,evaluation,activation_error};
}
module.exports={settings,selectedModel,snapshot,saveSettings,queue,issueWorker,authenticateWorker,claim,leasedJob,activate,complete,workerPurpose,fail};
