'use strict';
const jwt=require('jsonwebtoken');

// Adapt the teammates' existing service contracts without relaying browser identity headers.
function contract(id,req){
 const incoming=new URL(req.originalUrl,'http://gateway.local');
 const headers={};let path=incoming.pathname;
 if(id==='content-agent'){
  const suffix=path.replace(/^\/api\/content(?=\/|$)/,'') || '/';
  if(!/^\/(?:history|generate|feedback|campaigns|settings|knowledge|learning\/summary|crm)$/.test(suffix))throw Object.assign(new Error('Unknown content endpoint'),{status:404});
  path=/^\/(history|generate|feedback)$/.test(suffix)?'/content'+suffix:suffix;
  if(Buffer.byteLength(process.env.CONTENT_AGENT_JWT_SECRET || '')>=32){
   headers.Authorization='Bearer '+jwt.sign({clientId:req.user.tenant_id,sub:req.user.user_id,tenant_id:req.user.tenant_id,role:req.user.role},process.env.CONTENT_AGENT_JWT_SECRET,{algorithm:'HS256',issuer:'ciftron-gateway',audience:id,expiresIn:'60s'});
  }
 }
 if(id==='lead-intel'){
  const suffix=path.replace(/^\/api\/lead-intel(?=\/|$)/,'') || '/dashboard';
  if(!/^\/(?:dashboard|analytics|monitoring|model-quality|history|score|[A-Za-z0-9_.:%-]{1,192}\/(?:profile|history|recommendation|outcome))$/.test(suffix))throw Object.assign(new Error('Unknown lead endpoint'),{status:404});
  const segments=suffix.split('/');if(segments.length>2){let key;try{key=decodeURIComponent(segments[1]);}catch{}if(!key || !/^[A-Za-z0-9_.:-]{1,64}$/.test(key) || key==='.' || key==='..')throw Object.assign(new Error('Invalid lead ID'),{status:400});}
  path='/leads'+suffix;
  // C3 uses dataset tenant keys. Only server-owned workspace slugs may select that key.
  // Unknown workspaces get an upstream 404; there is no fallback to a demo tenant.
  headers['X-Tenant-Id']=req.user.workspace_slug || req.user.tenant_id;
 }
 return {path:path+incoming.search,headers};
}
function mutationPermission(id,path,method){
 if(id==='lead-intel' && /\/recommendation$/.test(path))return 'campaigns:write';
 if(['GET','HEAD'].includes(method))return 'campaigns:read';
 if(id==='content-agent' && /^\/api\/content\/(?:settings|knowledge|crm(?:\/|$)|learning\/(?:meta(?:\/|$)|[^/]+\/automatic))/.test(path))return 'workspace:manage';
 return 'campaigns:write';
}
module.exports={contract,mutationPermission};
