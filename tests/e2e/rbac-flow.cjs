'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {Client}=require('../../services/gateway/node_modules/pg');
const password='RbacBrowserPass123!';
async function verify({browser,page,context,base,suffix,evidence,emailDatabase}){
  const errors=[];
  const mutate=async(ctx,url,method,body)=>{
    const config=await(await ctx.request.get(base+'/api/auth/config')).json();
    return ctx.request[method.toLowerCase()](base+'/api'+url,{headers:{Origin:base,'X-CSRF-Token':config.csrf_token},data:body});
  };
  const owner=await(await context.request.get(base+'/api/auth/me')).json();
  const sidebar=page.getByRole('complementary',{name:'Main navigation'});
  assert.equal(await sidebar.getByRole('link',{name:'Dashboard',exact:true}).count(),1);
  assert.equal(await sidebar.getByRole('link',{name:'Services',exact:true}).count(),0);
  for(const name of ['Team & access','Monitoring'])assert.equal(await sidebar.getByRole('link',{name,exact:true}).count(),0);
  const disclosure=sidebar.getByRole('button',{name:'AI agents',exact:true});
  assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
  await disclosure.click();
  assert.equal(await sidebar.locator('.nav-child:visible').count(),4);
  await sidebar.getByRole('link',{name:'Email Agent',exact:true}).click();
  await page.getByRole('heading',{name:'Email studio.',exact:true}).waitFor();
  assert.equal(await sidebar.getByRole('link',{name:'Email Agent',exact:true}).getAttribute('aria-current'),'page');
  await disclosure.click();
  await sidebar.getByRole('link',{name:'Dashboard',exact:true}).click();
  await page.goto(base+'/#integrations');
  await page.getByRole('heading',{name:'From audience insights to your next campaign.',exact:true}).waitFor();
  assert.equal(await sidebar.getByRole('link',{name:'Dashboard',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await page.locator('.service-card').count(),4);
  await page.screenshot({path:path.join(evidence,'navigation-dashboard.png'),fullPage:true});
  await sidebar.getByRole('link',{name:'Settings',exact:true}).click();
  const settingsNav=page.getByRole('navigation',{name:'Settings sections'});
  await settingsNav.getByRole('link',{name:'Team & access',exact:true}).click();
  await page.getByRole('heading',{name:'Great work is a team effort.',exact:true}).waitFor();
  assert.equal(await sidebar.getByRole('link',{name:'Settings',exact:true}).getAttribute('aria-current'),'page');
  await settingsNav.getByRole('link',{name:'Monitoring',exact:true}).click();
  await page.getByRole('heading',{name:'Platform monitoring',exact:true}).waitFor();
  await settingsNav.getByRole('link',{name:'Account & workspace',exact:true}).click();
  await page.getByRole('heading',{name:'Make yourself at home.',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:900});
  await sidebar.screenshot({path:path.join(evidence,'navigation-sidebar.png')});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Settings overflow at '+width);
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await sidebar.getByRole('link',{name:'Dashboard',exact:true}).click();
    await page.getByRole('heading',{name:/^Good things are growing/}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Dashboard overflow at '+width);
    if(width===390)await page.screenshot({path:path.join(evidence,'navigation-mobile.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1100});
  const campaign=await mutate(context,'/platform/campaigns','POST',{name:'Role access campaign',audience:'Subscribers'});assert.equal(campaign.status(),201);
  for(const target of ['/platform/knowledge','/email/knowledge'])assert.equal((await mutate(context,target,'POST',{name:'Role access facts',type:'Business context',text:'Our team helps businesses plan marketing campaigns.'})).status(),201);
  const draft=await mutate(context,'/email/sequences','POST',{name:'Role access sequence',audience:'Subscribers',tone:'Friendly',source:'all',emails:[0,3,7].map((day,index)=>({email_index:index+1,send_at_days:day,subject:'Explore our services',body:'Hello {{first_name}},\n\nExplore our services: {{cta_link}}\n\nTo unsubscribe, reply STOP or click here.'}))});assert.equal(draft.status(),201);
  assert.equal((await mutate(context,'/email/integrations/gohighlevel','PUT',{account_reference:'rbac-location',version:0})).status(),200);
  assert.match(emailDatabase.database,/^email_flow_verify_[a-f0-9]{12}$/);
  const client=new Client(emailDatabase);await client.connect();
  try{await client.query("INSERT INTO email_learning_runs(tenant_id,status,dataset_hash,sample_count,sequence_count,model,evaluation) VALUES($1,'validated','rbac-test',9,3,'{}',$2)",[owner.workspace.id,JSON.stringify({synthetic:true,training_records:6,validation_records:3,candidate:.01,baseline:.02})]);}finally{await client.end();}

  const members={};
  for(const role of ['viewer','marketer']){
    const email=role+'-rbac-'+suffix+'@example.test';
    const invitation=await mutate(context,'/team/invitations','POST',{email,role});assert.equal(invitation.status(),201);
    const token=new URLSearchParams((await invitation.json()).invitation_url.split('?')[1]).get('invite');
    const registrationContext=await browser.newContext();
    const registration=await mutate(registrationContext,'/auth/register','POST',{email,name:role==='viewer'?'Viewer Role':'Marketer Role',password,invitation_token:token});assert.equal(registration.status(),201);
    members[role]=(await registration.json()).user;
    await registrationContext.close();
  }
  await page.reload();await page.getByRole('heading',{name:/^Good things are growing/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'View workspace activity',exact:true}).count(),1);
  await page.getByRole('link',{name:'Knowledge base',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Add knowledge',exact:true}).count(),1);
  await page.goto(base+'/#email-agent?view=learning');await page.getByRole('heading',{name:'Learning, with a clear feedback loop.',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Train & evaluate',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Activate',exact:true}).count(),1);
  await page.screenshot({path:path.join(evidence,'rbac-admin.png'),fullPage:true});
  async function openMember(role){
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),target=await ctx.newPage();target.on('pageerror',error=>errors.push(error.message));
    await target.goto(base+'/#sign-in');await target.getByLabel('Work email',{exact:true}).fill(members[role].email);await target.getByLabel('Password',{exact:true}).fill(password);await target.getByRole('button',{name:'Sign in',exact:true}).click();await target.getByRole('heading',{name:/^Good things are growing/}).waitFor();
    return {ctx,target};
  }
  const {ctx:viewerContext,target:viewer}=await openMember('viewer');
  for(const name of ['Email Agent','Knowledge base','Team & access','Monitoring'])assert.equal(await viewer.getByRole('link',{name,exact:true}).count(),0,name);
  for(const name of ['New campaign','Create with Email Agent','Open Email Agent','View workspace activity'])assert.equal(await viewer.getByRole('button',{name,exact:true}).count(),0,name);
  await viewer.getByRole('button',{name:'View campaigns',exact:true}).click();
  await viewer.getByRole('button',{name:'Role access campaign Subscribers',exact:true}).click();
  assert.equal(await viewer.getByRole('button',{name:'Archive',exact:true}).count(),0);assert.equal(await viewer.getByRole('button',{name:'Build a sequence',exact:true}).count(),0);await viewer.getByRole('button',{name:'Close dialog',exact:true}).click();
  const forbiddenRequests=[];viewer.on('request',request=>{if(/\/api\/(?:email\/|team(?:\?|$|\/)|platform\/status)/.test(request.url()))forbiddenRequests.push(request.url());});
  for(const route of ['team','monitoring','knowledge','email-agent?view=builder']){await viewer.goto(base+'/#'+route);await viewer.getByRole('heading',{name:'This area needs a different role',exact:true}).waitFor();}
  assert.deepEqual(forbiddenRequests,[],'Denied pages must not mount privileged data hooks');
  await viewer.goto(base+'/#settings');await viewer.getByRole('heading',{name:'Make yourself at home.',exact:true}).waitFor();
  assert.equal(await viewer.getByRole('navigation',{name:'Settings sections'}).getByRole('link').count(),1);
  assert.equal(await viewer.getByLabel('Workspace name',{exact:true}).getAttribute('readonly'),'');assert.equal(await viewer.getByRole('button',{name:'Save workspace',exact:true}).count(),0);assert.equal(await viewer.getByRole('button',{name:'Save profile',exact:true}).count(),1);
  await viewer.screenshot({path:path.join(evidence,'rbac-viewer.png'),fullPage:true});

  const {ctx:marketerContext,target:marketer}=await openMember('marketer');
  assert.equal(await marketer.getByRole('button',{name:'View workspace activity',exact:true}).count(),0);
  assert.equal(await marketer.getByRole('button',{name:'New campaign',exact:true}).count(),1);
  for(const name of ['Team & access','Monitoring'])assert.equal(await marketer.getByRole('link',{name,exact:true}).count(),0);
  for(const route of ['knowledge','email-agent?view=knowledge']){
    await marketer.goto(base+'/#'+route);await marketer.getByText('You have read-only access. An administrator manages knowledge sources.',{exact:true}).waitFor();
    for(const name of ['Add knowledge','Upload text','Archive','Restore'])assert.equal(await marketer.getByRole('button',{name,exact:true}).count(),0);
    assert.equal(await marketer.getByRole('button',{name:'Delete Role access facts',exact:true}).count(),0);
  }
  await marketer.goto(base+'/#email-agent?view=library');await marketer.getByRole('heading',{name:'Role access sequence',exact:true}).waitFor();
  assert.equal(await marketer.getByRole('button',{name:'Duplicate Role access sequence',exact:true}).count(),1);
  await marketer.getByRole('button',{name:'Open',exact:true}).click();await marketer.getByRole('button',{name:'Review sequence',exact:true}).waitFor();
  await marketer.getByRole('button',{name:'Review sequence',exact:true}).click();await marketer.getByRole('dialog').waitFor();await marketer.getByRole('button',{name:'Close dialog',exact:true}).click();
  await marketer.goto(base+'/#email-agent?view=performance');await marketer.getByRole('heading',{name:'Every result adds perspective.',exact:true}).waitFor();assert.equal(await marketer.getByRole('button',{name:'Record outcomes',exact:true}).isDisabled(),false);
  await marketer.goto(base+'/#email-agent?view=learning');await marketer.getByText('Sample evaluation',{exact:true}).waitFor();
  for(const name of ['Save preferences','Train & evaluate','Activate'])assert.equal(await marketer.getByRole('button',{name,exact:true}).count(),0);
  assert.equal(await marketer.getByRole('checkbox',{name:/^Use aggregate outcomes for learning/}).isDisabled(),true);
  await marketer.screenshot({path:path.join(evidence,'rbac-marketer.png'),fullPage:true});
  await marketer.goto(base+'/#email-agent?view=integrations');await marketer.getByRole('heading',{name:'Your next connections, in one place.',exact:true}).waitFor();await marketer.getByText('rbac-location',{exact:true}).waitFor();
  assert.equal(await marketer.getByRole('button',{name:/Set up connection|Connection settings/}).count(),0);
  // Direct HTTP calls remain forbidden even if someone changes the DOM.
  assert.equal((await mutate(marketerContext,'/email/knowledge','POST',{name:'Forbidden',type:'Business context',text:'No write access.'})).status(),403);
  assert.equal((await mutate(marketerContext,'/email/learning/settings','PUT',{enabled:true,auto_train:true,version:0})).status(),403);
  assert.equal((await mutate(viewerContext,'/platform/campaigns','POST',{name:'Forbidden',audience:'None'})).status(),403);

  async function changeRole(role){assert.equal((await mutate(context,'/team/'+members.marketer.user_id,'PATCH',{role})).status(),200);}
  await changeRole('agency_admin');await marketer.evaluate(()=>window.dispatchEvent(new Event('focus')));await marketer.locator('.sidebar-user small').filter({hasText:'Administrator'}).waitFor();
  await marketer.goto(base+'/#knowledge');await marketer.getByRole('button',{name:'Add knowledge',exact:true}).click();await marketer.getByLabel('Source name',{exact:true}).fill('Must not be saved');await marketer.getByLabel('What should your agent know?',{exact:true}).fill('This permission was revoked.');
  await changeRole('viewer');await marketer.getByRole('button',{name:'Add source',exact:true}).click();
  await marketer.getByRole('heading',{name:'This area needs a different role',exact:true}).waitFor();assert.equal(await marketer.getByRole('dialog').count(),0);assert.equal(await marketer.getByRole('link',{name:'Email Agent',exact:true}).count(),0);
  assert.equal((await(await context.request.get(base+'/api/platform/snapshot')).json()).documents.some(item=>item.name==='Must not be saved'),false);

  // A late administrator response must not undo a newer role refresh.
  await changeRole('agency_admin');await marketer.evaluate(()=>window.dispatchEvent(new Event('focus')));await marketer.locator('.sidebar-user small').filter({hasText:'Administrator'}).waitFor();await marketer.goto(base+'/#overview');await marketer.getByRole('heading',{name:/^Good things are growing/}).waitFor();
  let release,capturedResolve,held=false;
  const gate=new Promise(resolve=>release=resolve),captured=new Promise(resolve=>capturedResolve=resolve);
  await marketer.route(base+'/api/auth/me',async route=>{if(held)return route.continue();held=true;const response=await route.fetch();assert.equal((await response.json()).user.role,'agency_admin');capturedResolve();await gate;await route.fulfill({response});});
  await marketer.evaluate(()=>window.dispatchEvent(new Event('focus')));await captured;
  await changeRole('viewer');await marketer.evaluate(()=>window.dispatchEvent(new Event('focus')));await marketer.locator('.sidebar-user small').filter({hasText:'Administrator'}).waitFor({state:'detached'});
  const staleResponse=marketer.waitForResponse(response=>response.url()===base+'/api/auth/me' && response.status()===200);release();await staleResponse;
  await marketer.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await marketer.getByRole('link',{name:'Team & access',exact:true}).count(),0);assert.equal(await marketer.getByRole('button',{name:'New campaign',exact:true}).count(),0);
  await marketer.unroute(base+'/api/auth/me');
  for(const target of [viewer,marketer]){await target.setViewportSize({width:390,height:900});await target.goto(base+'/#overview');await target.getByRole('heading',{name:/^Good things are growing/}).waitFor();assert.equal(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);await viewerContext.close();await marketerContext.close();
  console.log('PASS: Administrator, Marketer and Viewer page/action access, direct-link denial without restricted fetches, knowledge read-only controls, protected learning/integrations, personal settings, backend 403 enforcement, role promotion/demotion, revoked open forms, stale authorization response rejection and mobile layout.');
}
module.exports={verify};
