const BASE='https://services.leadconnectorhq.com';
const fail=message=>Object.assign(new Error(message),{status:502});
async function request(token,path,{method='GET',query={},body}={}){
 const url=new URL(path,BASE);if(url.origin!==BASE)throw fail('Invalid CRM endpoint');
 for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
 for(let attempt=0;attempt<3;attempt++){
  let response;try{response=await fetch(url,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,Version:process.env.CRM_API_VERSION||'v3',Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}catch{if(attempt===2)throw fail('CRM connection timed out or is unavailable.');continue;}
  if((response.status===429||response.status>=500)&&attempt<2){const seconds=Math.min(5,Math.max(1,Number(response.headers.get('retry-after'))||attempt+1));await new Promise(r=>setTimeout(r,seconds*1000));continue;}
  if(!response.ok)throw Object.assign(new Error(response.status===401?'CRM token expired or invalid. Reconnect with a valid token.':response.status===403?'CRM access denied. Check the account ID and read permissions.':`CRM request failed (HTTP ${response.status}). Check API version and account permissions.`),{status:502});
  const data=await response.json().catch(()=>null);if(!data||typeof data!=='object')throw fail('CRM returned invalid JSON.');return data;
 }
}
async function metadata(token,location){
 const result=await request(token,`/locations/${encodeURIComponent(location)}`);
 if(result.location?.id!==location)throw fail('CRM account identity does not match the requested account.');
 const fields=await request(token,`/locations/${encodeURIComponent(location)}/customFields`,{query:{model:'contact'}});
 if(!Array.isArray(fields.customFields))throw fail('CRM custom-field metadata is incomplete.');
 if(fields.customFields.some(f=>f.locationId&&f.locationId!==location))throw fail('CRM returned fields from another account.');
 const b=result.location.business||result.location;
 return {business:{business_name:b.name||result.location.name||'',website_url:b.website||result.location.website||'',city:b.city||'',country:b.country||''},fields:fields.customFields.map(f=>({id:f.id,name:f.name,dataType:f.dataType,options:Array.isArray(f.picklistOptions)?f.picklistOptions.filter(x=>typeof x==='string').slice(0,100):[]}))};
}
async function fetchAll(token,location,kind){
 const values=new Map();let expected;let cursor;
 for(let page=1;page<=50;page++){
  const data=kind==='contacts'?await request(token,'/contacts/search',{method:'POST',body:{locationId:location,page,pageLimit:100}}):await request(token,'/opportunities/search',{query:{locationId:location,limit:100,...(cursor?cursor:{page})}});
  const rows=data[kind];if(!Array.isArray(rows))throw fail(`CRM ${kind} response is incomplete.`);
  const total=data.total??data.meta?.total;
  if(total!=null){const count=Number(total);if(!Number.isSafeInteger(count)||count<0||count>5000)throw fail('CRM sync supports up to 5,000 records per resource. Narrow the connected account or extend the sync worker.');if(expected!=null&&expected!==count)throw fail('CRM records changed during pagination. Retry for a consistent snapshot.');expected=count;}
  const before=values.size;
  for(const row of rows){if(!row.id||row.locationId&&row.locationId!==location)throw fail('CRM returned an invalid or cross-account record.');values.set(row.id,row);}
  if(rows.length&&values.size===before)throw fail('CRM pagination repeated a page. Snapshot was not replaced.');
  if(expected!=null&&values.size>=expected)return [...values.values()];
  if(!rows.length){if(expected!=null&&values.size<expected)throw fail('CRM pagination ended before all records arrived.');return [...values.values()];}
  if(expected==null&&rows.length<100&&!data.meta?.nextPageUrl&&!data.meta?.nextPage)return [...values.values()];
  if(kind==='opportunities'&&data.meta?.startAfterId&&data.meta?.startAfter)cursor={startAfterId:data.meta.startAfterId,startAfter:data.meta.startAfter};
 }
 throw fail('CRM sync limit reached. Partial results were not saved.');
}
module.exports={request,metadata,fetchAll};
