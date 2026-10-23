import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {canAccessPage,emailMutationPermission,workspaceMutationPermission,assertPermission} from '../src/lib/access.js';
const require=createRequire(import.meta.url);
const {permissionsFor}=require('../../services/gateway/src/policies/rbac.js');
const emailPolicy=require('../../services/email-agent/src/policies/rbac.js');
const canFor=role=>permission=>permissionsFor(role).includes(permission);
test('page access matches the server roles and unknown routes are denied',()=>{
  for(const role of ['agency_admin','marketer','viewer']){
    const can=canFor(role);
    for(const page of ['overview','campaigns','integrations','settings'])assert.equal(canAccessPage(page,can),true,role+': '+page);
    for(const page of ['knowledge','email-agent'])assert.equal(canAccessPage(page,can),role!=='viewer',role+': '+page);
    for(const page of ['team','monitoring'])assert.equal(canAccessPage(page,can),role==='agency_admin',role+': '+page);
    assert.equal(canAccessPage('unregistered-page',can),false);
    assert.deepEqual(permissionsFor(role),emailPolicy.permissionsFor(role));
  }
});
test('email mutation guards distinguish marketer work from administrator management',()=>{
  const cases=[
    ['/sequence','POST','email:generate'],['/sequences','POST','email:generate'],
    ['/sequences/ab12-cd34','PUT','email:generate'],['/sequences/ab12-cd34','DELETE','email:generate'],
    ['/sequences/ab12-cd34/review','PUT','email:generate'],['/sequences/ab12-cd34/outcomes/1','PUT','email:generate'],
    ['/email/knowledge','POST','knowledge:write'],['/email/knowledge/ab12-cd34','PATCH','knowledge:write'],['/knowledge/ab12-cd34','DELETE','knowledge:write'],
    ['/learning/settings','PUT','workspace:manage'],['/learning/train','POST','workspace:manage'],['/learning/runs/ab12-cd34/activate','POST','workspace:manage'],['/integrations/meta','PUT','workspace:manage'],
    ['/finetuning/settings','PUT','workspace:manage'],['/finetuning/active-model','PUT','workspace:manage'],['/finetuning/jobs','POST','workspace:manage'],['/finetuning/workers','POST','workspace:manage'],['/finetuning/jobs/ab12-cd34/retry','POST','workspace:manage'],['/finetuning/jobs/ab12-cd34','DELETE','workspace:manage'],['/finetuning/workers/ab12-cd34','DELETE','workspace:manage'],
  ];
  for(const[path,method,permission]of cases){
    assert.equal(emailMutationPermission(path,method),permission);
    for(const role of ['agency_admin','marketer','viewer']){
      const allowed=role==='agency_admin' || role==='marketer' && permission==='email:generate';
      if(allowed)assert.doesNotThrow(()=>assertPermission(canFor(role),permission));
      else assert.throws(()=>assertPermission(canFor(role),permission),error=>error.status===403);
    }
  }
  assert.equal(emailMutationPermission('/unregistered-action','POST'),null);
  assert.throws(()=>assertPermission(canFor('agency_admin'),null));
});
test('campaign and knowledge mutations require their distinct server permissions',()=>{
  for(const[path,method,permission]of [['/platform/campaigns','POST','campaigns:write'],['/platform/campaigns/ab12-cd34','PATCH','campaigns:write'],['/platform/knowledge','POST','knowledge:write'],['/platform/knowledge/ab12-cd34','DELETE','knowledge:write']]){
    assert.equal(workspaceMutationPermission(path,method),permission);
    assert.throws(()=>assertPermission(canFor('viewer'),permission));
    if(permission==='knowledge:write')assert.throws(()=>assertPermission(canFor('marketer'),permission));
    else assert.doesNotThrow(()=>assertPermission(canFor('marketer'),permission));
  }
  assert.equal(workspaceMutationPermission('/platform/unregistered','POST'),null);
});
