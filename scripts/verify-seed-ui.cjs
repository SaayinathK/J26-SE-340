'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const credentials = JSON.parse(fs.readFileSync(path.join(root,'.local/seed-credentials.json'),'utf8'));
const account = credentials.find(row => row.role === 'marketer') || credentials.find(row => row.role === 'agency_admin');
if(!account) throw new Error('No newly seeded account is available in the local credentials file.');
function playwrightPath() {
  if(process.env.CIFTRON_PLAYWRIGHT_PATH) return process.env.CIFTRON_PLAYWRIGHT_PATH;
  try{return require.resolve('playwright');}catch{}
  const links=path.join(process.env.LOCALAPPDATA || '','ms-playwright/.links');
  if(fs.existsSync(links)) for(const entry of fs.readdirSync(links)) {const value=fs.readFileSync(path.join(links,entry),'utf8').trim();if(fs.existsSync(value)) return value;}
  throw new Error('Install Playwright or set CIFTRON_PLAYWRIGHT_PATH.');
}
const {chromium}=require(playwrightPath());
(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  const base='http://127.0.0.1:5173';
  try{
    const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/#sign-in',{waitUntil:'domcontentloaded'});
    await page.getByLabel('Work email',{exact:true}).fill(account.email);
    await page.getByLabel('Password',{exact:true}).fill(account.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('heading',{name:/^Good things are growing/}).waitFor();
    await page.goto(base+'/#email-agent?view=performance');
    await page.getByRole('heading',{name:'Every result adds perspective.',exact:true}).waitFor();
    const insights=await (await context.request.get(base+'/api/email/insights')).json();
    assert.equal(insights.outcomes.filter(row=>row.provenance==='synthetic').length,9);
    assert.equal(await page.locator('.studio-metric').first().locator('strong').innerText(),'0');
    await page.getByRole('button',{name:'Sample data',exact:true}).click();
    await page.getByRole('heading',{name:'Sample email outcomes',exact:true}).waitFor();
    await page.getByText('Synthetic demo data. These counts do not represent actual sends or engagement and are excluded from continuous learning.',{exact:true}).waitFor();
    assert.equal(await page.locator('.studio-table tbody tr').count(),9);
    assert.equal(await page.locator('.studio-metric').first().locator('strong').innerText(),'1890');
    assert.equal(await page.locator('.studio-table-link:disabled').count(),9);
    const evidence=path.join(root,'.local/e2e');fs.mkdirSync(evidence,{recursive:true});
    await page.locator('.email-workspace').screenshot({path:path.join(evidence,'seed-sample-performance.png')});
    await page.getByRole('navigation',{name:'Email studio pages'}).getByRole('button',{name:'Learning center',exact:true}).click();
    await page.getByText('Sample evaluation',{exact:true}).waitFor();
    if(account.role==='agency_admin')assert.equal(await page.getByRole('button',{name:'Activate',exact:true}).isDisabled(),true);
    else assert.equal(await page.getByRole('button',{name:'Activate',exact:true}).count(),0);
    const learning=await (await context.request.get(base+'/api/email/learning')).json();
    assert.deepEqual(learning.dataset,{records:0,sequences:0,delivered:0});
    assert.equal(learning.settings.enabled,false);
    assert.equal(learning.runs.filter(row=>row.evaluation.synthetic).length,1);
    await page.getByRole('heading',{name:'Mistral fine-tuning',exact:true}).waitFor();
    const fineTuningResponse=await context.request.get(base+'/api/email/finetuning');
    assert.equal(fineTuningResponse.status(),200);
    const fineTuning=await fineTuningResponse.json();
    assert.equal(fineTuning.settings.enabled,false);
    assert.equal(fineTuning.readiness.ready,false);
    assert.equal(fineTuning.readiness.eligible,0);
    assert.equal(fineTuning.jobs.length,0);
    assert.equal(fineTuning.workers.length,0);
    if(account.role!=='agency_admin'){
      for(const name of ['Save training consent','Queue QLoRA training','Create Colab worker token'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
    }
    assert.equal((await context.request.get(base+'/downloads/colab-ft-worker.zip')).status(),200);
    await page.setViewportSize({width:390,height:900});
    await page.getByRole('navigation',{name:'Email studio pages'}).getByRole('button',{name:'Performance',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: seeded account login, sample performance labelled and separated from measured totals, nine read-only sample outcome rows, sample learning blocked, measured dataset zero, mobile layout and no browser errors.');
  }finally{
    try{const config=await(await context.request.get(base+'/api/auth/config')).json();await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':config.csrf_token},data:{}});}catch{}
    await browser.close();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
