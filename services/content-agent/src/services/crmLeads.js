const db=require('../config/db');
const text=value=>typeof value==='string'?value.slice(0,500):'';
function leadDetails(contact,opportunities){
 return {name:text(contact.contactName||contact.name||[contact.firstName,contact.lastName].filter(Boolean).join(' ')),email:text(contact.email),phone:text(contact.phone),company:text(contact.companyName),city:text(contact.city),state:text(contact.state),country:text(contact.country),source:text(contact.source),type:text(contact.type),date_added:text(contact.dateAdded),tags:Array.isArray(contact.tags)?[...new Set(contact.tags.filter(t=>typeof t==='string').map(text))]:[],opportunities:opportunities.filter(o=>(o.contactId||o.contact?.id)===contact.id).map(o=>({name:text(o.name),status:text(o.status)}))};
}
async function list(tenant,{q='',tag='',page='1',campaign_id}={}){
 if(typeof q!=='string'||q.length>200||typeof tag!=='string'||tag.length>500||!/^\d+$/.test(String(page))||Number(page)<1||Number(page)>100000)throw Object.assign(new Error('Invalid lead filters.'),{status:400});
 let tags=[];if(campaign_id){await require('./campaignService').getCampaign(tenant,campaign_id);const {rows}=await db.query('SELECT mapping FROM crm_campaign_context WHERE tenant_id=$1 AND campaign_id=$2',[tenant,campaign_id],tenant);if(!rows.length)return {leads:[],total:0,page:Number(page),page_size:25};tags=rows[0].mapping.tags||[];}
 return db.transaction(tenant,async run=>{
 const params=[tenant,q,tag,tags];
 const where=`tenant_id=$1 AND EXISTS(SELECT 1 FROM crm_connections c WHERE c.tenant_id=$1 AND c.enabled=true) AND ($2='' OR strpos(lower(concat_ws(' ',details->>'name',details->>'email',details->>'phone',details->>'company')),lower($2))>0) AND ($3='' OR (details->'tags') ? $3) AND (cardinality($4::text[])=0 OR (details->'tags') ?| $4::text[])`;
 const {rows:count}=await run(`SELECT count(*)::int AS total FROM crm_leads WHERE ${where}`,params);
 const {rows}=await run(`SELECT contact_id,details,synced_at FROM crm_leads WHERE ${where} ORDER BY lower(details->>'name'),contact_id LIMIT 25 OFFSET $5`,[...params,(Number(page)-1)*25]);
 return {leads:rows,total:count[0].total,page:Number(page),page_size:25};
 });
}
module.exports={leadDetails,list};
