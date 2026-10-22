const db=require('../config/db');
const {dayAt,saveMetrics,evaluateAndSave,validateMetric}=require('./performanceLearning');
const {getCampaign,lockCampaign}=require('./campaignService');
async function connection(tenant) {
 const {rows}=await db.query('SELECT * FROM meta_connections WHERE tenant_id=$1',[tenant],tenant);
 const row=rows[0];
 if(!row||!process.env[row.token_env])throw Object.assign(new Error('Meta is not connected. Configure a server-side account and read-only token first.'),{status:409});
 return row;
}
async function graph(config,path,params={}) {
 if(!/^v\d+\.\d+$/.test(config.api_version)||!/^\d+$/.test(config.account_id))throw new Error('Invalid Meta server configuration');
 const url=new URL(`https://graph.facebook.com/${config.api_version}/${path}`);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,typeof value==='string'?value:JSON.stringify(value));
 let response;
 try {response=await fetch(url,{headers:{Authorization:`Bearer ${process.env[config.token_env]}`},signal:AbortSignal.timeout(30000)});}catch {throw Object.assign(new Error('Meta network request failed. Retry sync later.'),{status:502});}
 const data=await response.json();
 // Never return tokens, raw API errors or request URLs to logs/UI.
 if(!response.ok||data.error)throw Object.assign(new Error(`Meta read failed (HTTP ${response.status}, code ${Number(data.error?.code)||0}). Check token permissions and account access.`),{status:502});
 return data;
}
function convert(row) {
 const purchases=(row.actions||[]).find(action=>action.action_type==='purchase');
 return {day:row.date_start,impressions:Number(row.impressions||0),link_clicks:Number(row.inline_link_clicks||0),purchases:Number(purchases?.value||0),spend:Number(row.spend||0),currency:row.account_currency};
}
async function linkAd(tenant,campaign,variantId,adId) {
 if(!/^\d{5,30}$/.test(adId))throw Object.assign(new Error('Valid Meta ad ID required'),{status:400});
 const config=await connection(tenant);
 const ad=await graph(config,adId,{fields:'id,account_id'});
 if(String(ad.account_id)!==config.account_id)throw Object.assign(new Error('Ad belongs to a different configured account'),{status:400});
 const {rows}=await db.query(`UPDATE creative_variants SET meta_ad_id=$4 WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3
 AND persona_set_id=$5 AND (meta_ad_id IS NULL OR meta_ad_id=$4) RETURNING *`,[tenant,campaign.id,variantId,adId,campaign.persona_set_id],tenant);
 if(!rows.length)throw Object.assign(new Error('Current variant not found or already linked to a different ad'),{status:409});
 return rows[0];
}
async function syncTenant(tenant) {
 const config=await connection(tenant);
 const {rows:variants}=await db.query(`SELECT v.* FROM creative_variants v JOIN content_campaigns c ON c.id=v.campaign_id AND c.tenant_id=v.tenant_id
 WHERE v.tenant_id=$1 AND v.meta_ad_id IS NOT NULL AND v.persona_set_id=c.persona_set_id`,[tenant],tenant);
 let synced=0;
 try {
  // Stage ALL reads before writes. Pagination follows cursors on our fixed host, never arbitrary next URLs.
  const batches=[];
  for(const v of variants) {
   const ad=await graph(config,v.meta_ad_id,{fields:'id,account_id'});
   if(String(ad.account_id)!==config.account_id)throw new Error('Mapped ad account changed');
   const metrics=[];let after;
   for(let page=0;page<20;page++) {
    const data=await graph(config,`${v.meta_ad_id}/insights`,{fields:'date_start,date_stop,account_id,account_currency,impressions,inline_link_clicks,spend,actions',time_range:{since:dayAt(-30),until:dayAt(-1)},time_increment:1,action_report_time:'impression',action_attribution_windows:['7d_click','1d_view'],limit:100,...(after?{after}:{})});
    if(!Array.isArray(data.data))throw new Error('Invalid Meta insights response');
    for(const row of data.data){if(String(row.account_id)!==config.account_id)throw new Error('Unexpected insights account');metrics.push(convert(row));}
    if(!data.paging?.next)break;
    after=data.paging?.cursors?.after;
    if(!after||page===19)throw new Error('Meta pagination incomplete; nothing was imported');
   }
   batches.push({v,metrics});
  }
  for(const {metrics} of batches)metrics.forEach(validateMetric);
  for(const campaignId of new Set(batches.map(b=>b.v.campaign_id))) {
   const unlock=await lockCampaign(tenant,campaignId);
   try {
    const campaign=await getCampaign(tenant,campaignId);
    await db.transaction(tenant,async run=>{
     for(const {v,metrics} of batches.filter(b=>b.v.campaign_id===campaignId)) {
      await run('DELETE FROM creative_metrics WHERE tenant_id=$1 AND variant_id=$2 AND day BETWEEN $3 AND $4',[tenant,v.id,dayAt(-30),dayAt(-1)]);
      await saveMetrics(tenant,campaign,v.id,metrics,'meta',run,true);synced++;
     }
     await evaluateAndSave(tenant,campaign,run);
    });
   } finally {await unlock();}
  }
  await db.query('UPDATE meta_connections SET last_synced_at=now(),last_error=NULL WHERE tenant_id=$1',[tenant],tenant);
  return {synced};
 } catch(error) {
  await db.query('UPDATE meta_connections SET last_error=$2 WHERE tenant_id=$1',[tenant,error.status?error.message:'Sync failed; retry after checking account mappings.'],tenant);
  throw error;
 }
}
module.exports={connection,graph,convert,linkAd,syncTenant};
