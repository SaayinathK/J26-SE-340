'use strict';
// Explicit test-only service fixtures. These are not production records or model predictions.
const crypto=require('node:crypto'),jwt=require('../../../services/gateway/node_modules/jsonwebtoken');
function create(){
 const secret=crypto.randomBytes(48).toString('hex'),stores=new Map(),requests=[];
 function store(key){if(!stores.has(key)){
  const prefix=crypto.createHash('sha256').update(key).digest('hex').slice(0,8);
  const leads=Array.from({length:18},(_,index)=>({lead_id:'fixture-'+prefix+'-'+(index+1),name:'Fixture lead '+String(index+1).padStart(2,'0'),score:90-index*4,segment:index<6?'hot':index<13?'warm':'cold',source:index%2?'Website':'Referral',last_activity:index%2?'Opened email':'Visited website',city:'Colombo',occupation:'Professional',specialization:'Career coaching',total_visits:index+1,time_on_site_sec:180,pages_per_visit:2}));
  stores.set(key,{leads,outcomes:[],history:[{id:crypto.randomUUID(),agent_type:'social_post',input_params:{brief:'Fixture community content'},output:{body:'Fixture content output for integration testing.'},created_at:'2026-10-21T08:00:00Z'}]});
 }return stores.get(key);}
 function handle(req,res){
  const url=new URL(req.url,'http://fixture.local');
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/health'){req.resume();send(200,{ok:true,model_version:'test-fixture-only'});return true;}
  if(!/^\/(content|campaigns|settings|learning|crm|leads)(\/|$)/.test(url.pathname))return false;
  let key;
  if(url.pathname.startsWith('/leads/'))key=req.headers['x-tenant-id'];
  else{try{key=jwt.verify((req.headers.authorization || '').slice(7),secret,{audience:'content-agent',issuer:'ciftron-gateway'}).clientId;}catch{req.resume();send(401,{error:'Fixture service authentication required'});return true;}}
  if(!key){req.resume();send(401,{error:'Fixture workspace required'});return true;}
  requests.push({path:url.pathname,tenant:key,method:req.method});
  let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
   let body;try{body=raw?JSON.parse(raw):{};}catch{return send(400,{error:'Invalid test JSON'});}
   const own=store(key),match=/^\/leads\/([^/]+)\/(profile|recommendation|history|outcome)$/.exec(url.pathname),lead=match?own.leads.find(row=>row.lead_id===decodeURIComponent(match[1])):null;
   if(match && !lead)return send(404,{detail:'Lead not found for this tenant'});
   if(url.pathname==='/content/history')return send(200,{success:true,history:own.history});
   if(url.pathname==='/content/generate' && req.method==='POST'){
    const row={id:crypto.randomUUID(),agent_type:body.content_type,input_params:{brief:body.brief},output:{headline:'Fixture creative headline',primary_text:'Fixture output produced by the integration test service.',cta:'Learn more'},created_at:'2026-10-23T10:00:00Z'};own.history.unshift(row);return send(200,{success:true,content_id:row.id,...row.output});
   }
   if(url.pathname==='/content/feedback' && req.method==='POST'){const row=own.history.find(item=>item.id===body.generation_id);if(!row)return send(404,{error:'Fixture creation not found'});row.rating=body.feedback;return send(200,{success:true});}
   if(url.pathname==='/campaigns')return send(200,{success:true,campaigns:[{id:'11111111-1111-4111-8111-111111111111',name:'Fixture content campaign'}]});
   if(url.pathname==='/learning/summary')return send(200,{success:true,summary:{approved_prompts:1,positive_ratings:3,negative_ratings:1}});
   if(url.pathname==='/settings')return send(200,{success:true,settings:{business_name:'Fixture business',industry:'Coaching',brand_voice:'Friendly',target_audience:'Young professionals'}});
   if(url.pathname==='/crm')return send(200,{connected:false,status:'Not connected'});
   if(url.pathname==='/leads/dashboard')return send(200,{tenant_leads:own.leads.length,leads:own.leads,segments:['hot','warm','cold'].map(segment=>({segment,leads:own.leads.filter(lead=>lead.segment===segment).length})),note:'Integration test fixture data; no real model inference.'});
   if(url.pathname==='/leads/history')return send(200,{totals:{leads:1,scores:1,recommendations:1,outcomes:own.outcomes.length},leads:[{lead_id:own.leads[0].lead_id,scores:1,recommendations:1,outcomes:own.outcomes.length}]});
   if(url.pathname==='/leads/model-quality')return send(200,{model_version:'fixture-only',tested_on:'Fixture held-out split',this_tenant:{leads:100,auc:.86,accuracy:.82,precision:.8,recall:.75,brier:.13},threshold:.5});
   if(url.pathname==='/leads/monitoring')return send(200,{tenant_outcomes:own.outcomes.length,won_rate:own.outcomes.length?1:null,auc:null});
   if(url.pathname==='/leads/score')return send(200,{lead_id:body.lead_id,score:78,segment:'hot',what_if:false,top_factors:[{feature:'total_visits',impact:.2}],confidence:{level:'high'}});
   if(match?.[2]==='profile')return send(200,lead);
   if(match?.[2]==='recommendation')return send(200,{lead_id:lead.lead_id,grounded:true,next_best_action:'Send a helpful follow-up email.',policy_rule:'Give them an email with a useful coaching resource.',message_draft:'Fixture follow-up message for this lead.',talking_points:['Opened a recent email.'],sources:[{kind:'rule',text:'Fixture business follow-up policy.'}],confidence:.8});
   if(match?.[2]==='history')return send(200,{lead_id:lead.lead_id,events:[{type:'score',score:lead.score,created_at:'2026-10-22T08:00:00Z'}]});
   if(match?.[2]==='outcome'){own.outcomes.push(body.outcome);return send(200,{outcome:body.outcome});}
   return send(404,{error:'Fixture endpoint not implemented'});
  });
  return true;
 }
 return {secret,handle,requests};
}
module.exports={create};
