'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
async function verify({browser,page,context,base,mailCatcher,suffix,evidence}){
  const owner=(await (await context.request.get(base+'/api/auth/me')).json());
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByRole('link',{name:'Team & access',exact:true}).click();
  await page.getByRole('heading',{name:'Great work is a team effort.',exact:true}).waitFor();
  const email='join-'+suffix+'@example.test';
  async function invite(address){
    await page.getByRole('button',{name:'Invite member',exact:true}).click();
    await page.getByLabel('Email address',{exact:true}).fill(address);
    await page.getByLabel('Workspace role',{exact:true}).selectOption('marketer');
    await page.getByRole('button',{name:'Send invitation',exact:true}).click();
    await page.getByRole('heading',{name:'Invitation email sent',exact:true}).waitFor();
    return page.locator('#invitation-link').inputValue();
  }
  const link=await invite(email);
  assert.ok(link.startsWith(base+'/#register?invite='));
  assert.equal(mailCatcher.messages.length,1);
  const mime=mailCatcher.messages[0].replace(/=\r\n/g,'').replace(/=([0-9A-F]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
  assert.ok(mime.includes(email)); assert.ok(mime.includes(link));
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  await page.getByRole('button',{name:'Copy invitation',exact:true}).click();
  await page.getByRole('button',{name:'Copied',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),link);
  await page.screenshot({path:path.join(evidence,'invitation-sent.png'),fullPage:true});
  await page.goto(link);
  await page.getByRole('button',{name:'Switch account to join',exact:true}).waitFor();
  await page.getByRole('button',{name:'Keep current workspace',exact:true}).click();
  await page.getByRole('heading',{name:'Good things are growing, Alex',exact:true}).waitFor();

  const recipientContext=await browser.newContext({viewport:{width:1440,height:1000}});
  const recipient=await recipientContext.newPage();
  const recipientErrors=[];recipient.on('pageerror',error=>recipientErrors.push(error.message));
  await recipient.goto(link);
  await recipient.getByRole('button',{name:'Join workspace',exact:true}).waitFor();
  assert.equal(await recipient.getByLabel('Work email',{exact:true}).inputValue(),email);
  assert.equal(await recipient.getByLabel('Work email',{exact:true}).getAttribute('readonly'),'');
  assert.equal(await recipient.getByLabel('Workspace name',{exact:true}).count(),0);
  for(const width of [390,1440]){
    await recipient.setViewportSize({width,height:1000});
    assert.equal(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await recipient.screenshot({path:path.join(evidence,'invitation-join.png'),fullPage:true});
  async function join(target,name){
    await target.getByLabel('Full name',{exact:true}).fill(name);
    await target.getByLabel('Password',{exact:true}).fill('InviteFlowPass123!');
    await target.getByLabel('Confirm password',{exact:true}).fill('InviteFlowPass123!');
    await target.getByRole('button',{name:'Join workspace',exact:true}).click();
    await target.getByRole('heading',{name:'Good things are growing, '+name.split(' ')[0],exact:true}).waitFor();
  }
  await join(recipient,'Jamie Invite');
  const member=await (await recipientContext.request.get(base+'/api/auth/me')).json();
  assert.equal(member.user.tenant_id,owner.user.tenant_id);assert.equal(member.user.role,'marketer');
  const replay=await browser.newContext();const replayPage=await replay.newPage();
  await replayPage.goto(link);
  await replayPage.getByRole('heading',{name:'This invitation needs attention',exact:true}).waitFor();
  await page.goto(base+'/#team');
  await page.getByText(email,{exact:true}).waitFor();
  assert.equal(await page.locator('.pending-invitations').getByText(email,{exact:true}).count(),0);

  const replacementEmail='replace-'+suffix+'@example.test';
  const oldLink=await invite(replacementEmail);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  const row=page.locator('.pending-invitations tr').filter({hasText:replacementEmail});
  await row.getByRole('button',{name:'Send new invitation',exact:true}).click();
  await page.getByRole('heading',{name:'Invitation email sent',exact:true}).waitFor();
  const replacementLink=await page.locator('#invitation-link').inputValue();
  assert.notEqual(replacementLink,oldLink);
  await replayPage.goto(oldLink);
  await replayPage.getByRole('heading',{name:'This invitation needs attention',exact:true}).waitFor();
  await replayPage.goto(replacementLink);
  await replayPage.getByRole('button',{name:'Join workspace',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await row.getByRole('button',{name:'Revoke',exact:true}).click();
  await row.waitFor({state:'detached'});
  await replayPage.reload();
  await replayPage.getByRole('heading',{name:'This invitation needs attention',exact:true}).waitFor();

  const switchLink=await invite('switch-'+suffix+'@example.test');
  await page.goto(switchLink);
  await page.getByRole('button',{name:'Switch account to join',exact:true}).click();
  await page.getByRole('button',{name:'Join workspace',exact:true}).waitFor();
  await join(page,'Taylor Invite');
  const switched=await (await context.request.get(base+'/api/auth/me')).json();
  assert.equal(switched.user.tenant_id,owner.user.tenant_id);assert.equal(switched.user.role,'marketer');
  assert.equal(mailCatcher.messages.length,4);
  assert.deepEqual(recipientErrors,[]);
  await recipientContext.close();await replay.close();
  console.log('PASS: SMTP invitation email, correct link origin, clipboard, recipient-bound registration, workspace and role assignment, signed-in account switching, single use, reissue, revocation and responsive layout. Test messages stayed local.');
}
module.exports={verify};
