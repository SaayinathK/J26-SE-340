const categorical=new Set(['SINGLE_OPTIONS','MULTIPLE_OPTIONS','RADIO','CHECKBOX']);
const clean=value=>typeof value==='string'&&value.trim().length<=160&&!/@|https?:|\+?\d[\d\s()-]{7,}/i.test(value)?value.trim():null;
function validateMapping(value,fields){
 const fail=()=>{throw Object.assign(new Error('Choose valid CRM fields and up to 10 campaign tags.'),{status:400});};
 if(!value||!Array.isArray(value.tags)||value.tags.length>10||!value.tags.every(v=>clean(v)))fail();
 const result={tags:[...new Set(value.tags)],segment_field:value.segment_field||'',pain_field:value.pain_field||'',goal_field:value.goal_field||''};
 for(const key of ['segment_field','pain_field','goal_field'])if(result[key]&&!fields.some(f=>f.id===result[key]&&categorical.has(f.dataType)&&f.options.length))fail();
 return result;
}
function summarize(contacts,opportunities,mapping,fields,business){
 const selected=contacts.filter(c=>!mapping.tags.length||mapping.tags.some(t=>(c.tags||[]).includes(t)));
 const selectedIds=new Set(selected.map(c=>c.id));
 const deals=opportunities.filter(o=>selectedIds.has(o.contactId||o.contact?.id));
 const countBy=(items,fn)=>{const map=new Map();for(const item of items)for(const value of new Set(fn(item).filter(Boolean))){const label=clean(value);if(label)map.set(label,(map.get(label)||0)+1);}return [...map].filter(([,count])=>count>=3).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,20).map(([value,count])=>({value,count}));};
 const fieldValues=(c,id)=>{const field=fields.find(f=>f.id===id);if(!field)return [];const stored=(c.customFields||[]).find(v=>v.id===id);const value=stored?.value??stored?.fieldValue;return (Array.isArray(value)?value:[value]).filter(v=>field.options.includes(v));};
 const segments=mapping.segment_field?countBy(selected,c=>fieldValues(c,mapping.segment_field)):countBy(selected,c=>c.tags||[]);
 return {business,contact_count:selected.length,account_contact_count:contacts.length,campaign_tags:mapping.tags,
  segments,recorded_pain_points:mapping.pain_field?countBy(selected,c=>fieldValues(c,mapping.pain_field)):[],recorded_goals:mapping.goal_field?countBy(selected,c=>fieldValues(c,mapping.goal_field)):[],
  opportunities:{total:deals.length,open:deals.filter(o=>o.status==='open').length,won:deals.filter(o=>o.status==='won').length,lost:deals.filter(o=>o.status==='lost').length,abandoned:deals.filter(o=>o.status==='abandoned').length},
  limitations:'CRM observations, not representative market research. Categories with fewer than three contacts are omitted. Contacts can appear in multiple categories. Won opportunities are not verified purchases or ad-attributed conversions. Unrecorded pain points remain hypotheses.'};
}
module.exports={categorical,clean,validateMapping,summarize};
