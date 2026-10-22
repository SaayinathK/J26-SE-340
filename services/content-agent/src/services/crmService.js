const db=require('../config/db');
const api=require('./crmClient');
const vault=require('./crmVault');
const {randomUUID,createHash}=require('crypto');
const {validateMapping,summarize,clean}=require('./crmSummary');
const {getCampaign,lockCampaign}=require('./campaignService');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
async function locked(tenant,work){
 const client=await db.pool.connect();let acquired=false;
 try{acquired=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`crm:${tenant}`])).rows[0].locked;if(!acquired)throw error('CRM sync is busy. Try again shortly.',409);return await work(client);}
 finally{if(acquired)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`crm:${tenant}`]);client.release();}
}
async function status(tenant){
 const connection=(await db.query('SELECT location_id,enabled,status,business,catalog,last_synced_at,last_attempt_at,last_error,contact_count,opportunity_count FROM crm_connections WHERE tenant_id=$1',[tenant],tenant)).rows[0]||null;
 const campaigns=(await db.query('SELECT c.id,c.name,x.mapping,x.summary,x.synced_at FROM content_campaigns c LEFT JOIN crm_campaign_context x ON x.campaign_id=c.id AND x.tenant_id=c.tenant_id WHERE c.tenant_id=$1 ORDER BY c.created_at',[tenant],tenant)).rows;
 return {connection,campaigns};
}
async function connect(tenant,{location_id,token}){return locked(tenant,async()=>{
 if(typeof location_id!=='string'||!/^[a-zA-Z0-9_-]{5,100}$/.test(location_id)||typeof token!=='string'||token.length<10||token.length>4096)throw error('Provide a valid account ID and private integration token.');
 const old=(await db.query('SELECT location_id FROM crm_connections WHERE tenant_id=$1',[tenant],tenant)).rows[0];
 if(old&&old.location_id!==location_id)throw error('Disconnect the existing CRM account before changing accounts.');
 const meta=await api.metadata(token,location_id);
 try{await db.query(`INSERT INTO crm_connections(tenant_id,location_id,token_cipher,business,catalog,status) VALUES($1,$2,$3,$4,$5,'queued') ON CONFLICT(tenant_id) DO UPDATE SET token_cipher=$3,business=$4,catalog=$5,enabled=true,status='queued',last_error=NULL`,[tenant,location_id,vault.encrypt(token,tenant),meta.business,{fields:meta.fields,tags:[]}],tenant);}catch(e){if(e.code==='23505')throw error('This CRM account is already connected to another workspace.',409);throw e;}
 return status(tenant);
});}
async function mapCampaign(tenant,id,mapping){return locked(tenant,async()=>{
 await getCampaign(tenant,id);const connection=(await status(tenant)).connection;if(!connection?.enabled)throw error('Connect CRM first.');
 const valid=validateMapping(mapping,connection.catalog.fields||[]);
 const unlock=await lockCampaign(tenant,id);try{await db.transaction(tenant,async run=>{
 await run(`INSERT INTO crm_campaign_context(tenant_id,campaign_id,mapping) VALUES($1,$2,$3) ON CONFLICT(campaign_id) DO UPDATE SET mapping=$3,summary=NULL,revision=NULL,synced_at=NULL`,[tenant,id,valid]);
 await run('UPDATE content_campaigns SET draft=NULL WHERE tenant_id=$1 AND id=$2',[tenant,id]);
 await run("UPDATE crm_connections SET status='queued' WHERE tenant_id=$1",[tenant]);
 });}finally{await unlock();}return status(tenant);
});}
async function queue(tenant){return locked(tenant,async()=>{const result=await db.query("UPDATE crm_connections SET status='queued' WHERE tenant_id=$1 AND enabled=true RETURNING tenant_id",[tenant],tenant);if(!result.rowCount)throw error('Connect CRM first.');});}
async function sync(tenant){return locked(tenant,async(lockClient)=>{
 const connection=(await db.query('SELECT * FROM crm_connections WHERE tenant_id=$1 AND enabled=true',[tenant],tenant)).rows[0];if(!connection)return;
 const runId=randomUUID();const unlocks=[];
 await db.transaction(tenant,async run=>{await run("UPDATE crm_connections SET status='syncing',last_attempt_at=now(),last_error=NULL WHERE tenant_id=$1",[tenant]);await run("INSERT INTO crm_sync_runs(id,tenant_id,status) VALUES($1,$2,'syncing')",[runId,tenant]);});
 try{
 const token=vault.decrypt(connection.token_cipher,tenant);
 const meta=await api.metadata(token,connection.location_id);
 const contacts=await api.fetchAll(token,connection.location_id,'contacts');
 const opportunities=await api.fetchAll(token,connection.location_id,'opportunities');
 const mappings=(await db.query('SELECT * FROM crm_campaign_context WHERE tenant_id=$1 ORDER BY campaign_id',[tenant],tenant)).rows;
 for(const item of mappings){const key=`${tenant}:${item.campaign_id}`;const acquired=(await lockClient.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked;if(!acquired)throw error('A campaign is generating. Retry sync when it finishes.',409);unlocks.push(()=>lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]));}
 const snapshots=mappings.map(item=>{validateMapping(item.mapping,meta.fields);const summary=summarize(contacts,opportunities,item.mapping,meta.fields,meta.business);return {...item,summary,nextRevision:createHash('sha256').update(JSON.stringify(summary)).digest('hex')};});
 const tags=[...new Set(contacts.flatMap(c=>c.tags||[]).map(clean).filter(Boolean))].sort().slice(0,500);
 await db.transaction(tenant,async run=>{
 await run('DELETE FROM crm_leads WHERE tenant_id=$1',[tenant]);
 const leads=contacts.map(c=>({contact_id:c.id,details:require('./crmLeads').leadDetails(c,opportunities)}));
 await run(`INSERT INTO crm_leads(tenant_id,contact_id,details) SELECT $1,x.contact_id,x.details FROM jsonb_to_recordset($2::jsonb) AS x(contact_id text,details jsonb)`,[tenant,JSON.stringify(leads)]);
 for(const item of snapshots){await run('UPDATE crm_campaign_context SET summary=$3,revision=$4,synced_at=now() WHERE tenant_id=$1 AND campaign_id=$2',[tenant,item.campaign_id,item.summary,item.nextRevision]);if(item.revision!==item.nextRevision)await run('UPDATE content_campaigns SET draft=NULL WHERE tenant_id=$1 AND id=$2',[tenant,item.campaign_id]);}
 await run("UPDATE crm_connections SET business=$2,catalog=$3,status='ready',last_synced_at=now(),last_error=NULL,contact_count=$4,opportunity_count=$5 WHERE tenant_id=$1",[tenant,meta.business,{fields:meta.fields,tags},contacts.length,opportunities.length]);
 await run("UPDATE crm_sync_runs SET status='complete',finished_at=now(),contact_count=$3,opportunity_count=$4 WHERE id=$1 AND tenant_id=$2",[runId,tenant,contacts.length,opportunities.length]);
 });
 }catch(e){const message=e.status?e.message:'CRM sync failed. Check the server configuration and retry.';await db.transaction(tenant,async run=>{await run("UPDATE crm_connections SET status='error',last_error=$2 WHERE tenant_id=$1",[tenant,message]);await run("UPDATE crm_sync_runs SET status='error',finished_at=now(),error=$3 WHERE id=$1 AND tenant_id=$2",[runId,tenant,message]);});throw e;}
 finally{for(const unlock of unlocks.reverse())await unlock();}
});}
async function disconnect(tenant){return locked(tenant,async(client)=>{const keys=[];try{
 const {rows}=await db.query('SELECT id FROM content_campaigns WHERE tenant_id=$1 ORDER BY id',[tenant],tenant);
 for(const {id} of rows){const key=`${tenant}:${id}`;if(!(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked)throw error('Wait for campaign generation to finish before disconnecting.',409);keys.push(key);}
 await db.transaction(tenant,async run=>{await run('DELETE FROM crm_leads WHERE tenant_id=$1',[tenant]);await run('DELETE FROM crm_campaign_context WHERE tenant_id=$1',[tenant]);await run('DELETE FROM crm_connections WHERE tenant_id=$1',[tenant]);await run('UPDATE content_campaigns SET draft=NULL WHERE tenant_id=$1',[tenant]);});}finally{for(const key of keys)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}});}
async function context(tenant,campaign){if(!campaign)return null;return (await db.query(`SELECT x.summary,x.revision,x.synced_at FROM crm_campaign_context x JOIN crm_connections c ON c.tenant_id=x.tenant_id WHERE x.tenant_id=$1 AND x.campaign_id=$2 AND c.enabled=true AND x.synced_at>now()-interval '24 hours'`,[tenant,campaign],tenant)).rows[0]||null;}
module.exports={status,connect,mapCampaign,queue,sync,disconnect,context};
