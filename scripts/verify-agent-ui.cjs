'use strict';
// Read-only live UI smoke. Uses a pre-existing seeded account; no records are saved or scored.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function playwrightPath(){try{return require.resolve('playwright');}catch{}const directory=path.join(process.env.LOCALAPPDATA || '','ms-playwright/.links');if(fs.existsSync(directory))for(const entry of fs.readdirSync(directory)){const value=fs.readFileSync(path.join(directory,entry),'utf8').trim();if(fs.existsSync(value))return value;}throw new Error('Install Playwright or set CIFTRON_PLAYWRIGHT_PATH.');}
const {chromium}=require(process.env.CIFTRON_PLAYWRIGHT_PATH || playwrightPath());
(async()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(root,'.local/seed-credentials.json'),'utf8')),account=rows.find(row=>row.role==='marketer') || rows.find(row=>row.role==='agency_admin');if(!account)throw new Error('No existing seeded account is available.');
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'}),base='http://127.0.0.1:5173';
 try{
  const page=await context.newPage();page.setDefaultTimeout(25000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#sign-in',{waitUntil:'domcontentloaded'});await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/^Good things are growing/}).waitFor();
  const evidence=path.join(root,'.local/e2e');fs.mkdirSync(evidence,{recursive:true});
  await page.goto(base+'/#content-agent',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Content studio',exact:true}).waitFor();await page.getByText('Your workspace is ready. The agent engine is not connected yet.',{exact:true}).waitFor();
  await page.screenshot({path:path.join(evidence,'live-content-studio.png'),fullPage:true});
  await page.getByRole('navigation',{name:'Content studio pages'}).getByRole('button',{name:'Create',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Generate meta ad',exact:true}).isDisabled(),true);
  await page.getByLabel('Your brief',{exact:true}).fill('Local smoke check: a manual content brief.');await page.getByRole('button',{name:'Write manually',exact:true}).click();await page.getByLabel('Manual content draft',{exact:true}).fill('Local smoke check: manual draft, not saved.');
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download brief',exact:true}).click();assert.equal((await downloaded).suggestedFilename(),'content-brief.json');
  await page.screenshot({path:path.join(evidence,'live-content-create.png'),fullPage:true});
  await page.goto(base+'/#lead-intel?view=leads',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Who should we contact first?',exact:true}).waitFor();assert.equal(await page.locator('.lead-table tbody tr').count(),0);await page.screenshot({path:path.join(evidence,'live-lead-workspace.png'),fullPage:true});
  await page.goto(base+'/#lead-intel?view=score',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Calculate lead score',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Calculate lead score',exact:true}).isDisabled(),true);
  await page.goto(base+'/#strategy-fl',{waitUntil:'domcontentloaded'});await page.getByLabel('Campaign goal',{exact:true}).fill('Local smoke check: prepare a campaign plan.');await page.getByLabel('Target audience',{exact:true}).fill('Workspace subscribers');const plan=page.waitForEvent('download');await page.getByRole('button',{name:'Export strategy brief',exact:true}).click();assert.equal((await plan).suggestedFilename(),'campaign-strategy-brief.json');
  for(const route of ['content-agent','content-agent?view=create','content-agent?view=brand','lead-intel','lead-intel?view=leads','lead-intel?view=score','strategy-fl'])for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await page.goto(base+'/#'+route,{waitUntil:'domcontentloaded'});await page.locator('.agent-workspace').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' overflow at '+width);}
  assert.deepEqual(errors,[]);
  console.log('PASS: live professional agent pages, honest disconnected states, manual content/strategy downloads, disabled model calls, responsive layouts and no browser errors. No content, leads or outcomes were saved.');
 }finally{try{const config=await(await context.request.get(base+'/api/auth/config')).json();await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':config.csrf_token},data:{}});}catch{}await browser.close();}
})().catch(error=>{console.error(error.name+': live UI verification failed. Inspect locally; credentials are not logged.');process.exitCode=1;});
