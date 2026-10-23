'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
async function verify({browser,page,context,base,suffix,evidence,requests}){
 const mutate=async(ctx,url,method,body={})=>{const config=await(await ctx.request.get(base+'/api/auth/config')).json();return ctx.request[method.toLowerCase()](base+'/api'+url,{headers:{Origin:base,'X-CSRF-Token':config.csrf_token},data:body});};
 await page.goto(base+'/#content-agent');await page.getByRole('heading',{name:'Content studio',exact:true}).waitFor();
 await page.getByText('Fixture community content',{exact:true}).waitFor();assert.equal(await page.locator('.sidebar').count(),1);assert.equal(await page.locator('iframe').count(),0);
 // Screenshots label fixture provenance in the page rather than representing this as live AI evidence.
 await page.evaluate(()=>{const banner=document.createElement('div');banner.id='fixture-evidence-label';banner.textContent='INTEGRATION TEST · fixture service data · no model inference';banner.style.cssText='position:fixed;bottom:8px;left:260px;z-index:9999;background:#122b29;color:white;padding:7px 12px;border-radius:6px;font:11px sans-serif;max-width:calc(100vw - 20px)';document.body.append(banner);});
 await page.screenshot({path:path.join(evidence,'content-studio-fixture.png'),fullPage:true});
 await page.getByRole('navigation',{name:'Content studio pages'}).getByRole('button',{name:'Create',exact:true}).click();
 await page.getByLabel('Your brief',{exact:true}).fill('Create a helpful introduction for new coaching clients.');
 await page.getByRole('button',{name:'Generate meta ad',exact:true}).click();
 await page.getByText('Fixture creative headline',{exact:true}).waitFor();
 assert.ok(requests.some(item=>item.path==='/content/generate' && item.method==='POST'));
 await page.getByRole('navigation',{name:'Content studio pages'}).getByRole('button',{name:'Library',exact:true}).click();
 await page.getByLabel('Search content',{exact:true}).fill('helpful introduction');
 await page.getByRole('button',{name:/Create a helpful introduction/}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Useful content',exact:true}).click();await page.getByText('Your content feedback was recorded.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('navigation',{name:'Content studio pages'}).getByRole('button',{name:'Learning',exact:true}).click();
 assert.equal(await page.locator('.agent-metrics article').nth(2).locator('strong').innerText(),'Prompt guidance');
 await page.getByRole('navigation',{name:'Content studio pages'}).getByRole('button',{name:'Brand & connections',exact:true}).click();await page.getByLabel('Business name',{exact:true}).waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(input=>input.value==='Fixture business'));
 await page.getByRole('button',{name:'Save business profile',exact:true}).click();await page.getByText('Content business profile saved.',{exact:true}).waitFor();
 await page.goto(base+'/#lead-intel?view=leads');await page.getByRole('heading',{name:'Who should we contact first?',exact:true}).waitFor();await page.getByText('Fixture lead 01',{exact:true}).waitFor();
 assert.equal(await page.locator('.lead-table tbody tr').count(),10);
 await page.getByRole('button',{name:/^Warm/}).click();assert.equal(await page.locator('.lead-table tbody tr').count(),7);
 await page.getByRole('button',{name:/^All leads/}).click();await page.getByLabel('Search leads',{exact:true}).fill('Fixture lead 01');assert.equal(await page.locator('.lead-table tbody tr').count(),1);
 await page.getByRole('button',{name:'View lead Fixture lead 01',exact:true}).click();const drawer=page.getByRole('dialog');
 await drawer.getByRole('button',{name:'Get next-step advice',exact:true}).click();await drawer.getByText('Give them an email with a useful coaching resource.',{exact:true}).waitFor();
 await drawer.getByRole('button',{name:'Became a customer',exact:true}).click();await drawer.getByText('Recorded: won',{exact:true}).waitFor();
 await page.screenshot({path:path.join(evidence,'lead-details-fixture.png'),fullPage:true});await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('navigation',{name:'Lead intelligence pages'}).getByRole('button',{name:'Score a lead',exact:true}).click();
 await page.getByLabel('Lead ID',{exact:true}).fill('fixture-new-lead');await page.getByLabel('Website visits',{exact:true}).fill('3');await page.getByLabel('Pages per visit',{exact:true}).fill('2');await page.getByRole('button',{name:'Calculate lead score',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('navigation',{name:'Lead intelligence pages'}).getByRole('button',{name:'Model quality',exact:true}).click();await page.getByText('fixture-only',{exact:true}).waitFor();
 await page.evaluate(()=>document.getElementById('fixture-evidence-label')?.remove());
 for(const route of ['content-agent','content-agent?view=create','content-agent?view=library','content-agent?view=learning','lead-intel','lead-intel?view=leads','lead-intel?view=score','lead-intel?view=quality','strategy-fl']){
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await page.goto(base+'/#'+route);await page.locator('.agent-workspace').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' overflow at '+width);}
 }
 await page.setViewportSize({width:1440,height:1100});
 await page.goto(base+'/#content-agent');await page.getByRole('heading',{name:'Content studio',exact:true}).waitFor();await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();
 // A viewer can inspect the pages and data, but cannot generate, ask for advice or record outcomes.
 const email='agent-viewer-'+suffix+'@example.test',invited=await mutate(context,'/team/invitations','POST',{email,role:'viewer'});assert.equal(invited.status(),201);
 const token=new URLSearchParams((await invited.json()).invitation_url.split('?')[1]).get('invite'),viewerContext=await browser.newContext();
 try{
  assert.equal((await mutate(viewerContext,'/auth/register','POST',{name:'Agent Viewer',email,password:'AgentViewerPass123!',invitation_token:token})).status(),201);
  const viewer=await viewerContext.newPage();await viewer.goto(base+'/#content-agent?view=create');await viewer.getByRole('heading',{name:'Content studio',exact:true}).waitFor();assert.equal(await viewer.getByRole('button',{name:'Generate meta ad',exact:true}).count(),0);
  assert.equal((await mutate(viewerContext,'/content/generate','POST',{content_type:'social_post',brief:'Forbidden'})).status(),403);
  const leadDash=await(await viewerContext.request.get(base+'/api/lead-intel/dashboard')).json(),ownLead=leadDash.leads[0];
  assert.equal((await viewerContext.request.get(base+'/api/lead-intel/'+ownLead.lead_id+'/recommendation')).status(),403);
  const forged=await context.request.get(base+'/api/lead-intel/dashboard',{headers:{'X-Tenant-Id':'foreign-tenant'}});assert.equal((await forged.json()).leads[0].lead_id,ownLead.lead_id);
 }finally{await viewerContext.close();}
 // Separate workspace identity reaches the services; the first workspace's lead is not readable there.
 const other=await browser.newContext();try{const created=await mutate(other,'/auth/register','POST',{name:'Other Agent Workspace',email:'agent-other-'+suffix+'@example.test',workspace_name:'Other Agent Tenant',password:'AgentOtherPass123!'});assert.equal(created.status(),201);const foreign=(await(await context.request.get(base+'/api/lead-intel/dashboard')).json()).leads[0].lead_id;assert.equal((await other.request.get(base+'/api/lead-intel/'+foreign+'/profile')).status(),404);}finally{await other.close();}
 console.log('PASS: teammate contract proxy, content creation/history/feedback, lead filters/drawer/advice/outcomes/scoring, workspace isolation, forged-header rejection, viewer restrictions and responsive agent pages. Explicit fixture services; no live model inference.');
}
module.exports={verify};
