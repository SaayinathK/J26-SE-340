'use strict';
// Real browser, gateway, email service and disposable DBs. Explicit fixture worker outputs; no GPU.
const assert=require('node:assert/strict'),path=require('node:path');
const {Client}=require('../../services/gateway/node_modules/pg');
const {groupFor}=require('../../services/email-agent/src/services/fineTuneDataset');
async function verify({browser,page,context,base,suffix,evidence,emailDatabase}){
 if(!/^email_flow_verify_[a-f0-9]{12}$/.test(emailDatabase.database))throw new Error('Only disposable flow databases are allowed.');
 const mutate=async(ctx,url,method,body={})=>{const config=await(await ctx.request.get(base+'/api/auth/config')).json();return ctx.request[method.toLowerCase()](base+'/api'+url,{headers:{Origin:base,'X-CSRF-Token':config.csrf_token},data:body});};
 await page.goto(base+'/#email-agent?view=learning');
 await page.getByRole('heading',{name:'Mistral fine-tuning',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Queue QLoRA training',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('checkbox',{name:'Allow reviewed text to train Mistral',exact:true}).isChecked(),false);
 const download=await context.request.get(base+'/downloads/colab-ft-worker.zip');assert.equal(download.status(),200);assert.equal((await download.body()).subarray(0,2).toString(),'PK');
 await page.getByRole('checkbox',{name:'Allow reviewed text to train Mistral',exact:true}).check();
 await page.getByRole('button',{name:'Save training consent',exact:true}).click();
 await page.getByText('Language-model training preferences saved.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Create Colab worker token',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 const credential=await dialog.getByLabel('Colab worker token',{exact:true}).inputValue();assert.ok(credential.length>100);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 // Project the admin identity once before inserting fixture reviews.
 await context.request.get(base+'/api/email/finetuning');
 const actor=(await(await context.request.get(base+'/api/auth/me')).json()).user;
 const client=new Client(emailDatabase);await client.connect();
 const emails=[0,3,7].map((day,index)=>({email_index:index+1,send_at_days:day,subject:'Explore a useful next step',body:'Hello {{first_name}}, explore our services: {{cta_link}}\nTo unsubscribe from these emails, reply STOP or click here.'}));
 try{
  let train=0,validation=0,index=0;
  while(train<20||validation<5){const name='Browser fixture brief '+index++,holdout=parseInt(groupFor({name,audience:'Subscribers',tone:'Professional'}).slice(0,8),16)%5===0;if(holdout?validation>=5:train>=20)continue;
   const row=(await client.query("INSERT INTO email_sequences(tenant_id,name,audience,tone,source,emails,origin,review_status) VALUES($1,$2,'Subscribers','Professional','none',$3,'manual','Reviewed') RETURNING id",[actor.tenant_id,name,JSON.stringify(emails)])).rows[0];
   await client.query("INSERT INTO email_reviews(tenant_id,sequence_id,sequence_version,user_id,rating,verdict) VALUES($1,$2,1,$3,5,'Reviewed')",[actor.tenant_id,row.id,actor.user_id]);holdout?validation++:train++;
  }
 }finally{await client.end();}
 await page.getByRole('button',{name:'Refresh training status',exact:true}).click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Queue QLoRA training')?.disabled);
 await page.getByRole('button',{name:'Queue QLoRA training',exact:true}).click();
 await page.getByText('Job queued. A connected Colab worker will pick it up.',{exact:true}).waitFor();
 const worker=async(operation,body={})=>{const result=await fetch(base+'/api/training-worker/'+operation,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:JSON.stringify(body)});const data=await result.json();assert.equal(result.status,200,JSON.stringify(data));return data;};
 const claimed=(await worker('claim')).job;assert.equal(claimed.tenant_id,actor.tenant_id);assert.equal(claimed.dataset.training.length,20);
 await worker('jobs/'+claimed.id+'/heartbeat',{lease:claimed.lease,stage:'Training QLoRA'});
 await page.getByRole('button',{name:'Refresh training status',exact:true}).click();
 await page.getByText('Training QLoRA',{exact:true}).waitFor();
 await page.screenshot({path:path.join(evidence,'finetuning-fixture-running.png'),fullPage:true});
 const outputs=[...claimed.dataset.validation,...claimed.dataset.regression].map(()=>JSON.stringify({emails}));
 const completed=await worker('jobs/'+claimed.id+'/complete',{lease:claimed.lease,candidate_outputs:outputs,baseline_outputs:outputs,artifact:{model:claimed.candidate_model,adapter_sha256:'f'.repeat(64),training_mode:'qlora'}});assert.equal(completed.status,'validated');
 await page.getByRole('button',{name:'Refresh training status',exact:true}).click();
 await page.getByRole('button',{name:'Use language model',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
 await page.getByText('Evaluated language model selected for this workspace.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Restore default model',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
 await page.getByText('Configured default model restored.',{exact:true}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Fine-tuning page overflow at '+width);}
 await page.screenshot({path:path.join(evidence,'finetuning-fixture-mobile.png'),fullPage:true});
 const email='ft-marketer-'+suffix+'@example.test';
 const invite=await mutate(context,'/team/invitations','POST',{email,role:'marketer'});assert.equal(invite.status(),201);
 const invitationToken=new URLSearchParams((await invite.json()).invitation_url.split('?')[1]).get('invite');
 const marketerContext=await browser.newContext();
 try{
  const registered=await mutate(marketerContext,'/auth/register','POST',{email,name:'Training Marketer',password:'TrainingBrowserPass123!',invitation_token:invitationToken});assert.equal(registered.status(),201);
  const marketer=await marketerContext.newPage();await marketer.goto(base+'/#email-agent?view=learning');await marketer.getByRole('heading',{name:'Mistral fine-tuning',exact:true}).waitFor();
  for(const name of ['Queue QLoRA training','Save training consent','Create Colab worker token','Use language model'])assert.equal(await marketer.getByRole('button',{name,exact:true}).count(),0);
  assert.equal(await marketer.getByRole('checkbox',{name:'Allow reviewed text to train Mistral',exact:true}).isDisabled(),true);
  assert.equal((await mutate(marketerContext,'/email/finetuning/workers','POST')).status(),403);
 }finally{await marketerContext.close();}
 // Revocation removes access even if a valid JWT is retained by a former worker.
 await page.getByRole('checkbox',{name:'Allow reviewed text to train Mistral',exact:true}).uncheck();await page.getByRole('button',{name:'Save training consent',exact:true}).click();
 await page.getByText('Training stopped, worker access revoked and default model restored.',{exact:true}).waitFor();
 assert.equal((await fetch(base+'/api/training-worker/claim',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:'{}'})).status,403);
 console.log('PASS: browser fine-tuning consent, setup download, queue, real gateway worker authentication, progress, server evaluation, activation, rollback, marketer read-only controls, mobile layout and revocation. Fixture outputs only; no GPU training.');
}
module.exports={verify};
