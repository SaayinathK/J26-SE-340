'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const jwt=require('../../services/gateway/node_modules/jsonwebtoken');
const script=`window.google={accounts:{id:{initialize(config){window.fixtureGoogleConfig=config;},renderButton(container){const button=document.createElement('button');button.type='button';button.textContent='Test Google sign-in';button.onclick=()=>window.fixtureGoogleConfig.callback({credential:window.fixtureGoogleCredential});container.appendChild(button);},disableAutoSelect(){}}}};`;
async function install(context){await context.route('https://accounts.google.com/gsi/client?hl=en',route=>route.fulfill({status:200,contentType:'text/javascript',body:script}));}
async function verify({page,context,base,secret,email,evidence}){
  const alternate=await context.browser().newContext();
  await install(alternate);
  const preferred=base.replace('127.0.0.1','localhost');
  await alternate.route(base+'/api/auth/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,google_signin_origin:preferred}});});
  const alternatePage=await alternate.newPage();await alternatePage.goto(base+'/#sign-in');
  const switchOrigin=alternatePage.getByRole('link',{name:'Continue with Google',exact:true});
  await switchOrigin.waitFor();assert.equal(await switchOrigin.getAttribute('href'),preferred+'/#sign-in');
  assert.equal(await alternatePage.getByRole('button',{name:'Test Google sign-in',exact:true}).count(),0);
  await switchOrigin.click();await alternatePage.getByRole('button',{name:'Test Google sign-in',exact:true}).waitFor();
  assert.equal(new URL(alternatePage.url()).origin,preferred);await alternate.close();
  const original=await(await context.request.get(base+'/api/auth/me')).json();
  async function signOut(){await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Test Google sign-in',exact:true}).waitFor();}
  async function chooseGoogle(){
    const config=await page.evaluate(()=>({nonce:window.fixtureGoogleConfig.nonce,fedcm:window.fixtureGoogleConfig.use_fedcm_for_button}));assert.equal(config.fedcm,true);
    const token=jwt.sign({sub:'browser-google-identity',email,email_verified:true,nonce:config.nonce,name:'Alex Flow'},secret,{algorithm:'HS256',audience:'test-client.apps.googleusercontent.com',issuer:'isolated-google-provider',expiresIn:'2m'});
    await page.evaluate(value=>window.fixtureGoogleCredential=value,token);
    await page.getByRole('button',{name:'Test Google sign-in',exact:true}).click();
  }
  await signOut();await chooseGoogle();
  await page.getByRole('heading',{name:'Connect your Google account.',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Work email',{exact:true}).inputValue(),email);
  assert.equal(await page.getByLabel('Work email',{exact:true}).getAttribute('readonly'),'');
  assert.equal(await page.getByLabel('Workspace name',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Test Google sign-in',exact:true}).count(),0);
  await page.getByLabel('Password',{exact:true}).fill('WrongPassword123!');
  await page.getByRole('button',{name:'Confirm password & connect Google',exact:true}).click();
  await page.getByRole('alert').getByText('Email or password is incorrect.',{exact:true}).waitFor();
  assert.equal((await context.request.get(base+'/api/auth/me')).status(),401);
  await page.getByLabel('Password',{exact:true}).fill('SecureFlowPass123!');
  await page.screenshot({path:path.join(evidence,'google-confirm-password.png'),fullPage:true});
  await page.getByRole('button',{name:'Confirm password & connect Google',exact:true}).click();
  await page.getByRole('heading',{name:'Good things are growing, Alex',exact:true}).waitFor();
  const linked=await(await context.request.get(base+'/api/auth/me')).json();
  assert.equal(linked.user.google_linked,true);assert.equal(linked.user.user_id,original.user.user_id);assert.equal(linked.workspace.id,original.workspace.id);
  await signOut();await chooseGoogle();
  await page.getByRole('heading',{name:'Good things are growing, Alex',exact:true}).waitFor();
  assert.equal((await(await context.request.get(base+'/api/auth/me')).json()).workspace.id,original.workspace.id);
  const headers=(await context.request.get(base)).headers();
  assert.equal(headers['cross-origin-opener-policy'],'same-origin-allow-popups');
  assert.equal(headers['referrer-policy'],'strict-origin-when-cross-origin');
  console.log('PASS: Google verification prompts one-time password confirmation for an existing account, rejects a wrong password, preserves account/workspace, links successfully and signs in with Google subsequently. Popup/referrer headers verified. Provider responses were simulated in isolated test databases.');
}
module.exports={install,verify};
