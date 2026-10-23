// The gateway supplies permissions; the browser does not infer them from role names.
export const pagePermissions = Object.freeze({
  overview:'campaigns:read', integrations:'campaigns:read', campaigns:'campaigns:read',
  knowledge:'knowledge:read', 'email-agent':'email:generate',
  'lead-intel':'campaigns:read', 'strategy-fl':'campaigns:read', 'content-agent':'campaigns:read',
  team:'team:manage', monitoring:'monitoring:read', settings:null,
});
export function canAccessPage(page,can){
  return Object.hasOwn(pagePermissions,page) && (pagePermissions[page]===null || can(pagePermissions[page]));
}
export function assertPermission(can,permission){
  if(!permission || !can(permission)){
    const error=new Error('Your current workspace role does not allow this action.');
    error.status=403;throw error;
  }
}
export function emailMutationPermission(path,method){
  const route=path.replace(/^\/email(?=\/)/,'');
  if(method==='POST' && route==='/sequence')return 'email:generate';
  if(/^\/sequences(?:\/[a-f0-9-]+)?$/.test(route) && ['POST','PUT','DELETE'].includes(method))return 'email:generate';
  if(/^\/sequences\/[a-f0-9-]+\/(?:review|outcomes\/[123])$/.test(route) && method==='PUT')return 'email:generate';
  if(/^\/knowledge(?:\/[a-f0-9-]+)?$/.test(route) && ['POST','PATCH','DELETE'].includes(method))return 'knowledge:write';
  if(method==='PUT' && /^\/(?:learning\/settings|integrations\/(?:gohighlevel|meta))$/.test(route))return 'workspace:manage';
  if(method==='POST' && /^\/learning\/(?:train|runs\/[a-f0-9-]+\/activate)$/.test(route))return 'workspace:manage';
  if(method==='PUT' && /^\/finetuning\/(?:settings|active-model)$/.test(route))return 'workspace:manage';
  if(method==='POST' && /^\/finetuning\/(?:jobs|workers|jobs\/[a-f0-9-]+\/retry)$/.test(route))return 'workspace:manage';
  if(method==='DELETE' && /^\/finetuning\/(?:jobs|workers)\/[a-f0-9-]+$/.test(route))return 'workspace:manage';
  return null;
}
export function workspaceMutationPermission(path,method){
  if(path==='/platform/campaigns' && method==='POST' || /^\/platform\/campaigns\/[a-f0-9-]+$/.test(path) && method==='PATCH')return 'campaigns:write';
  if(path==='/platform/knowledge' && method==='POST' || /^\/platform\/knowledge\/[a-f0-9-]+$/.test(path) && method==='DELETE')return 'knowledge:write';
  return null;
}
