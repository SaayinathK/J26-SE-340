'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
const {contract,mutationPermission}=require('../../src/services/agentContract');
const user={tenant_id:'12345678-1234-4234-8234-123456789012',user_id:'98765432-1234-4234-8234-123456789012',role:'marketer',workspace_slug:'actual-workspace'};
test('teammate endpoints retain their real paths and queries, email identity path stays unchanged',()=>{
 for(const[input,output]of [['/api/content/history?campaign_id=abc','/content/history?campaign_id=abc'],['/api/content/generate','/content/generate'],['/api/content/campaigns','/campaigns'],['/api/content/learning/summary','/learning/summary']])assert.equal(contract('content-agent',{originalUrl:input,user}).path,output);
 assert.equal(contract('email-agent',{originalUrl:'/api/email/sequence',user}).path,'/api/email/sequence');
 assert.equal(contract('email-agent',{originalUrl:'/api/training-worker/claim',user}).path,'/api/training-worker/claim');
});
test('tenant routing uses only the authenticated workspace, never browser headers or a demo fallback',()=>{
 const result=contract('lead-intel',{originalUrl:'/api/lead-intel/L-1/profile',user,headers:{'x-tenant-id':'tenant_b'}});
 assert.equal(result.path,'/leads/L-1/profile');assert.equal(result.headers['X-Tenant-Id'],'actual-workspace');
 assert.equal(contract('lead-intel',{originalUrl:'/api/lead-intel/dashboard',user:{...user,workspace_slug:undefined}}).headers['X-Tenant-Id'],user.tenant_id);
});
test('service token is short-lived, server-signed and workspace-bound; browser authorization is not relayed',()=>{
 const before=process.env.CONTENT_AGENT_JWT_SECRET;process.env.CONTENT_AGENT_JWT_SECRET='test-only-content-agent-secret-32-characters';
 try{const result=contract('content-agent',{originalUrl:'/api/content/history',user,headers:{authorization:'Bearer forged'}});const claims=jwt.verify(result.headers.Authorization.slice(7),process.env.CONTENT_AGENT_JWT_SECRET,{issuer:'ciftron-gateway',audience:'content-agent'});assert.equal(claims.clientId,user.tenant_id);assert.equal(claims.exp-claims.iat,60);}finally{if(before===undefined)delete process.env.CONTENT_AGENT_JWT_SECRET;else process.env.CONTENT_AGENT_JWT_SECRET=before;}
});
test('unrecognized endpoints and traversal cannot escape the configured service origin',()=>{
 for(const id of ['content-agent','lead-intel'])for(const suffix of ['//evil.test','/../auth/login','/%2e%2e/auth/login','/auth/register','/L%2Fforeign/profile'])assert.throws(()=>contract(id,{originalUrl:'/api/'+(id==='content-agent'?'content':'lead-intel')+suffix,user}),error=>[400,404].includes(error.status));
});
test('viewers cannot trigger advice generation through a GET and connection settings stay admin-only',()=>{
 assert.equal(mutationPermission('lead-intel','/api/lead-intel/L-1/recommendation','GET'),'campaigns:write');
 assert.equal(mutationPermission('lead-intel','/api/lead-intel/dashboard','GET'),'campaigns:read');
 assert.equal(mutationPermission('content-agent','/api/content/settings','POST'),'workspace:manage');
 assert.equal(mutationPermission('content-agent','/api/content/generate','POST'),'campaigns:write');
});
