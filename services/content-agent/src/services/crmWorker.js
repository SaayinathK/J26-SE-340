const db=require('../config/db');
const crm=require('./crmService');
let running=false;
async function tick(){if(running)return;running=true;try{
 const {rows}=await db.query('SELECT id FROM clients WHERE is_active=true');
 for(const {id} of rows){try{const {rows:due}=await db.query("SELECT tenant_id FROM crm_connections WHERE tenant_id=$1 AND enabled=true AND (status='queued' OR last_attempt_at IS NULL OR last_attempt_at<now()-interval '15 minutes')",[id],id);if(due.length)await crm.sync(id);}catch(e){if(e.status!==409)console.error('CRM sync unavailable; inspect CRM dashboard.');}}
 }catch{console.error('CRM worker unavailable. Run database migrations.');}finally{running=false;}}
function start(){const timer=setInterval(()=>void tick(),30000);timer.unref();const initial=setTimeout(()=>void tick(),2000);initial.unref();return()=>{clearInterval(timer);clearTimeout(initial);};}
module.exports={start,tick};
