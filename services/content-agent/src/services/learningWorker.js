const db=require('../config/db');
const {getCampaign,lockCampaign}=require('./campaignService');
const {evaluateAndSave}=require('./performanceLearning');
const {syncTenant}=require('./metaInsights');
let running=false;
async function tick() {
 if(running)return;running=true;
 try {
  // Active client IDs are the only cross-tenant discovery. Every data operation below is tenant-scoped.
  const {rows:clients}=await db.query('SELECT id FROM clients WHERE is_active=true');
  for(const {id:tenant} of clients) {
   try {
    const {rows:connections}=await db.query('SELECT token_env FROM meta_connections WHERE tenant_id=$1',[tenant],tenant);
    if(connections[0]&&process.env[connections[0].token_env])await syncTenant(tenant);
   } catch(error) {console.error('Learning sync:',error.status===409?'Campaign busy; retry next cycle':'Sync unavailable; inspect Learning dashboard');}
   const {rows:campaigns}=await db.query('SELECT id FROM content_campaigns WHERE tenant_id=$1 AND auto_learning=true',[tenant],tenant);
   for(const campaign of campaigns) {
    let unlock;
    try {unlock=await lockCampaign(tenant,campaign.id);await db.transaction(tenant,async run=>evaluateAndSave(tenant,await getCampaign(tenant,campaign.id),run));}
    catch(error){if(error.status!==409)console.error('Learning evaluation failed:',error.message);}
    finally{if(unlock)await unlock();}
   }
  }
 } catch(error){console.error('Learning worker unavailable:',error.message);}
 finally{running=false;}
}
function start() {
 const interval=setInterval(()=>void tick(),15*60*1000);interval.unref();
 const first=setTimeout(()=>void tick(),5000);first.unref();
 return ()=>{clearInterval(interval);clearTimeout(first);};
}
module.exports={tick,start};
