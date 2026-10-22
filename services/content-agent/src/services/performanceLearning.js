const {createHash,randomUUID}=require('node:crypto');
const db=require('../config/db');
const {getCampaign}=require('./campaignService');
const canonical=value=>JSON.stringify(value, function(key,item){return item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item;});
const POLICY={minImpressions:1000,minPurchases:10,minDays:3,minImprovement:0.2,windowDays:30,maturityDays:2};
const dayAt=(offset,now=new Date())=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())+offset*86400000).toISOString().slice(0,10);
const personaKey=p=>createHash('sha256').update(JSON.stringify([p.name,p.description,p.pain_points])).digest('hex');
const sum=rows=>rows.reduce((a,r)=>({impressions:a.impressions+Number(r.impressions),link_clicks:a.link_clicks+Number(r.link_clicks),purchases:a.purchases+Number(r.purchases),spend:a.spend+Number(r.spend)}),{impressions:0,link_clicks:0,purchases:0,spend:0});
const rates=t=>({...t,ctr:t.impressions?t.link_clicks/t.impressions*100:null,cost_per_purchase:t.purchases?t.spend/t.purchases:null});
function evaluate(campaign,rows,now=new Date()) {
 const start=dayAt(-POLICY.windowDays,now),end=dayAt(-POLICY.maturityDays,now);
 const base={objective:'purchase',policy:POLICY,window:{start,end},winner_index:null,personas:[],guidance:null};
 if(campaign.personas.length!==3) return {...base,status:'needs_initial_campaign',reason:'Generate the initial three personas first.'};
 const keys=campaign.personas.map(personaKey);
 const relevant=rows.filter(r=>String(r.persona_set_id)===String(campaign.persona_set_id)&&keys.includes(r.persona_key)&&r.day>=start&&r.day<=end);
 if(!relevant.length)return {...base,status:'collecting',reason:'Record completed daily results. The newest two days are held back for purchase attribution.'};
 if(new Set(relevant.map(r=>r.currency)).size!==1||new Set(relevant.map(r=>r.source)).size!==1)return {...base,status:'incomparable',reason:'Compare one currency and one data source across the current persona test.'};
 const commonDays=[...new Set(relevant.filter(r=>r.persona_key===keys[0]).map(r=>r.day))].filter(day=>keys.every(key=>relevant.some(r=>r.persona_key===key&&r.day===day))).sort();
 const matched=relevant.filter(r=>commonDays.includes(r.day));
 const personas=keys.map((key,index)=>({index,name:campaign.personas[index].name,...rates(sum(matched.filter(r=>r.persona_key===key)))}));
 const evidence={...base,personas,days:commonDays,currency:relevant[0].currency,source:relevant[0].source};
 if(commonDays.length<POLICY.minDays||personas.some(p=>p.impressions<POLICY.minImpressions||p.purchases<POLICY.minPurchases||p.spend<=0))return {...evidence,status:'collecting',reason:'Need 3 shared mature reporting days, 1,000 impressions and 10 purchases per persona, with positive spend.'};
 const ranked=[...personas].sort((a,b)=>a.cost_per_purchase-b.cost_per_purchase);
 const [best,runner]=ranked;
 // Conservative count uncertainty guard; an operational selection rule, not a causal experiment.
 const upperCPA=best.spend/Math.max(best.purchases-1.96*Math.sqrt(best.purchases),0.01);
 const lowerCPA=runner.spend/(runner.purchases+1.96*Math.sqrt(runner.purchases));
 if(best.cost_per_purchase>runner.cost_per_purchase*(1-POLICY.minImprovement)||upperCPA>=lowerCPA)return {...evidence,status:'inconclusive',reason:'The cost-per-purchase lead is not clear enough. Keep testing all personas.'};
 const variants=new Map();
 for(const row of matched.filter(r=>r.persona_key===keys[best.index])) {
  if(!variants.has(row.variant_id))variants.set(row.variant_id,[]);variants.get(row.variant_id).push(row);
 }
 const candidate=[...variants.values()].map(items=>({row:items[0],...rates(sum(items))})).filter(v=>v.purchases>=POLICY.minPurchases&&v.spend>0).sort((a,b)=>a.cost_per_purchase-b.cost_per_purchase)[0];
 const guidance={persona:campaign.personas[best.index],instruction:'Prioritize this audience’s documented pains and goals. Use the observed example as creative direction, not proof of product claims. Keep every claim grounded in the saved campaign facts.',...(candidate?{example:{hook:candidate.row.snapshot.hook,body:candidate.row.snapshot.body},variant_id:candidate.row.variant_id}:{} )};
 return {...evidence,status:'winner',reason:'Lowest cost per purchase, at least 20% ahead with the count uncertainty guard satisfied. Observational evidence; targeting and budget may also affect results.',winner_index:best.index,guidance};
}
function validateMetric(value) {
 if(!value||typeof value!=='object')throw Object.assign(new Error('Metric object required'),{status:400});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isFinite(Date.parse(value.day))||new Date(value.day).toISOString().slice(0,10)!==value.day||value.day>=dayAt(0))throw Object.assign(new Error('Use a valid completed reporting date (YYYY-MM-DD)'),{status:400});
 for(const field of ['impressions','link_clicks','purchases'])if(!Number.isSafeInteger(value[field])||value[field]<0||value[field]>1e12)throw Object.assign(new Error(`Invalid ${field}`),{status:400});
 if(typeof value.spend!=='number'||!Number.isFinite(value.spend)||value.spend<0||value.spend>1e10||!/^([A-Z]{3})$/.test(value.currency))throw Object.assign(new Error('Valid spend and three-letter currency required'),{status:400});
 return value;
}
async function rowsFor(tenant,id,run) {
 return (await run(`SELECT m.*,to_char(m.day,'YYYY-MM-DD') AS day,v.persona_set_id,v.persona_key,v.snapshot,v.hook_index,v.body_index,v.generation_id
 FROM creative_metrics m JOIN creative_variants v ON v.id=m.variant_id AND v.tenant_id=m.tenant_id
 WHERE m.tenant_id=$1 AND v.campaign_id=$2`,[tenant,id])).rows;
}
async function evaluateAndSave(tenant,campaign,run) {
 const evidence=evaluate(campaign,await rowsFor(tenant,campaign.id,run));
 const guidance=campaign.auto_learning&&evidence.status==='winner'?evidence.guidance:null;
 const changed=canonical(guidance)!==canonical(campaign.learning_guidance||null);
 const revision=campaign.learning_revision+(changed?1:0);
 const winner=campaign.auto_learning?evidence.winner_index:campaign.winner_index;
 const source=campaign.auto_learning?(winner==null?null:'automatic'):campaign.winner_source;
 await run(`UPDATE content_campaigns SET learning_evaluated_at=now(),learning_evidence=$3,learning_guidance=$4,learning_revision=$5,winner_index=$6,winner_source=$7,
  draft=CASE WHEN $8 THEN NULL ELSE draft END,version=version+CASE WHEN $8 THEN 1 ELSE 0 END
  WHERE tenant_id=$1 AND id=$2`,[tenant,campaign.id,JSON.stringify(evidence),guidance?JSON.stringify(guidance):null,revision,winner,source,changed||winner!==campaign.winner_index]);
 if(changed)await run('INSERT INTO learning_revisions(id,tenant_id,campaign_id,revision,guidance,evidence) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),tenant,campaign.id,revision,guidance?JSON.stringify(guidance):null,JSON.stringify(evidence)]);
 return evidence;
}
async function saveMetrics(tenant,campaign,variantId,metrics,source='manual',transactionRun,skipEvaluation=false) {
 if(!db.validTenant(variantId)||!Array.isArray(metrics)||(!metrics.length&&source!=='meta')||metrics.length>90)throw Object.assign(new Error('Variant ID and 1–90 daily metrics required'),{status:400});
 metrics.forEach(validateMetric);
 if(new Set(metrics.map(m=>m.day)).size!==metrics.length)throw Object.assign(new Error('Duplicate reporting dates in upload'),{status:400});
 const work=async run=>{
  const {rows}=await run('SELECT * FROM creative_variants WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3',[tenant,campaign.id,variantId]);
  if(!rows[0]||rows[0].persona_set_id!==campaign.persona_set_id)throw Object.assign(new Error('Variant does not belong to this current persona test'),{status:404});
  if(source==='manual'&&rows[0].meta_ad_id)throw Object.assign(new Error('This variant is linked to Meta. Sync its results instead of entering manual metrics.'),{status:409});
  for(const m of metrics)await run(`INSERT INTO creative_metrics(tenant_id,variant_id,day,impressions,link_clicks,purchases,spend,currency,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,variant_id,day) DO UPDATE SET
    impressions=EXCLUDED.impressions,link_clicks=EXCLUDED.link_clicks,purchases=EXCLUDED.purchases,spend=EXCLUDED.spend,currency=EXCLUDED.currency,source=EXCLUDED.source,updated_at=now()`,
    [tenant,variantId,m.day,m.impressions,m.link_clicks,m.purchases,m.spend,m.currency,source]);
  return skipEvaluation ? null : evaluateAndSave(tenant,campaign,run);
 };
 return transactionRun ? work(transactionRun) : db.transaction(tenant,work);
}
async function registerVariant(tenant,campaign,body) {
 const {generation_id,persona_index,hook_index,body_index}=body;
 if(!db.validTenant(generation_id)||![persona_index,hook_index,body_index].every(x=>Number.isInteger(x)&&x>=0))throw Object.assign(new Error('Select a generation, persona, hook and body option'),{status:400});
 const {rows}=await db.query('SELECT * FROM generations WHERE tenant_id=$1 AND id=$2',[tenant,generation_id],tenant);
 const gen=rows[0];
 if(!gen||gen.input_params?.campaign_id!==campaign.id||gen.input_params?.persona_set_id!==campaign.persona_set_id)throw Object.assign(new Error('Select content from the current persona test; generate an initial set if this is older content'),{status:400});
 let output=gen.output;
 if(typeof output==='string'){try{output=JSON.parse(output);}catch{throw Object.assign(new Error('Stored generation has invalid JSON'),{status:400});}}
 const p=output?.personas?.[persona_index],hook=p?.hooks?.[hook_index],copy=p?.body_copies?.[body_index];
 if(!p||!hook||!copy||!campaign.personas.some(x=>personaKey(x)===personaKey(p)))throw Object.assign(new Error('Invalid creative selection'),{status:400});
 const result=await db.query(`INSERT INTO creative_variants(id,tenant_id,campaign_id,generation_id,persona_set_id,persona_key,persona_index,hook_index,body_index,snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,generation_id,persona_index,hook_index,body_index) DO UPDATE SET snapshot=creative_variants.snapshot RETURNING *`,
 [randomUUID(),tenant,campaign.id,generation_id,campaign.persona_set_id,personaKey(p),persona_index,hook_index,body_index,JSON.stringify({persona:p.name,hook,body:copy})],tenant);
 return result.rows[0];
}
module.exports={POLICY,dayAt,personaKey,evaluate,validateMetric,rowsFor,evaluateAndSave,saveMetrics,registerVariant,rates,sum};
