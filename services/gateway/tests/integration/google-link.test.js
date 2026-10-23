'use strict';
jest.mock('google-auth-library',()=>({OAuth2Client:jest.fn().mockImplementation(()=>({verifyIdToken:(...args)=>mockVerifyGoogle(...args)}))}));
const mockVerifyGoogle=jest.fn();
const request=require('supertest'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const app=require('../../src/main'),pool=require('../../src/config/db');
const {hash,withTenant}=require('../../src/services/session');
const suffix=crypto.randomBytes(6).toString('hex'),password='GoogleLinkPass123!';
const accounts={};
beforeAll(async()=>{
  if(!/^c4_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME||''))throw new Error('Use the isolated gateway verification runner.');
  process.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';
  for(const label of ['primary','other','expired','replay','conflict']){
    const result=await request(app).post('/api/auth/register').send({name:'Google '+label,email:label+'-'+suffix+'@gmail.com',password,workspace_name:'Existing '+label});
    expect(result.status).toBe(201);accounts[label]=result.body;
  }
});
afterAll(()=>pool.end());
async function begin(label){
  const account=accounts[label],agent=request.agent(app),csrf=(await agent.get('/api/auth/config')).body.csrf_token;
  const challenge=await agent.get('/api/auth/google/challenge?intent=login');expect(challenge.status).toBe(200);
  const subject='subject-'+label+'-'+suffix;
  mockVerifyGoogle.mockResolvedValueOnce({getPayload:()=>({sub:subject,email:account.user.email,email_verified:true,nonce:challenge.body.nonce})});
  const result=await agent.post('/api/auth/google').set('X-CSRF-Token',csrf).send({credential:'provider-verified-test-token',intent:'login'});
  expect(result.status).toBe(409);expect(result.body).toMatchObject({code:'GOOGLE_LINK_REQUIRED',password_confirmation_required:true,email:account.user.email});
  const cookie=result.headers['set-cookie'].find(value=>value.startsWith('c4_google_link=')).split(';')[0];
  return {agent,csrf,cookie,subject,account,login:(extra={})=>agent.post('/api/auth/login').set('X-CSRF-Token',csrf).send({email:account.user.email,password,link_google:true,...extra})};
}
async function linked(account){return withTenant(account.user.tenant_id,async client=>(await client.query('SELECT google_sub FROM users WHERE user_id=$1',[account.user.user_id])).rows[0].google_sub);}
test('registered Gmail connects only after its password and returns the original workspace and role',async()=>{
  const flow=await begin('primary');expect(await linked(flow.account)).toBeNull();
  expect((await flow.login({password:'WrongPassword123!'})).status).toBe(401);
  expect((await flow.login({email:accounts.other.user.email})).status).toBe(400);
  expect(await linked(flow.account)).toBeNull();
  const complete=await flow.login();expect(complete.status).toBe(200);
  expect(complete.body.workspace.id).toBe(flow.account.workspace.id);
  expect(complete.body.user.user_id).toBe(flow.account.user.user_id);expect(complete.body.user.google_linked).toBe(true);
  expect(complete.body.user.role).toBe(flow.account.user.role);expect(await linked(flow.account)).toBe(flow.subject);
  // Subsequent verified Google sign-in needs no password and cannot create another workspace.
  const challenge=await flow.agent.get('/api/auth/google/challenge?intent=login');
  mockVerifyGoogle.mockResolvedValueOnce({getPayload:()=>({sub:flow.subject,email:flow.account.user.email,email_verified:true,nonce:challenge.body.nonce})});
  const again=await flow.agent.post('/api/auth/google').set('X-CSRF-Token',flow.csrf).send({credential:'provider-token',intent:'login'});
  expect(again.status).toBe(200);expect(again.body.workspace.id).toBe(flow.account.workspace.id);
});
test('missing or forged Google confirmation cannot link an account with a valid password',async()=>{
  const account=accounts.other,agent=request.agent(app),csrf=(await agent.get('/api/auth/config')).body.csrf_token;
  const body={email:account.user.email,password,link_google:true};
  expect((await agent.post('/api/auth/login').set('X-CSRF-Token',csrf).send(body)).status).toBe(400);
  const fake=jwt.sign({sub:account.user.user_id,email:account.user.email,google_sub:'forged',jti:'a'.repeat(64)},'wrong-signing-secret',{audience:'c4-google-link',issuer:'c4-gateway'});
  expect((await request(app).post('/api/auth/login').set({Cookie:'c4_google_link='+fake}).send(body)).status).toBe(400);
  expect(await linked(account)).toBeNull();
});
test('an expired server-side confirmation cannot link the account',async()=>{
  const flow=await begin('expired');const token=decodeURIComponent(flow.cookie.slice(flow.cookie.indexOf('=')+1));
  const challengeHash=hash(jwt.decode(token).jti);
  await pool.query('DELETE FROM auth_google_challenges WHERE challenge_hash=$1',[challengeHash]);
  await pool.query("INSERT INTO auth_google_challenges(challenge_hash,intent,expires_at) VALUES($1,'link',now()-interval '1 second')",[challengeHash]);
  const response=await flow.login();expect(response.status).toBe(400);expect(response.body.code).toBe('GOOGLE_LINK_EXPIRED');
  expect(await linked(flow.account)).toBeNull();
});
test('a copied confirmation cookie cannot be replayed after successful linking',async()=>{
  const flow=await begin('replay');expect((await flow.login()).status).toBe(200);
  const replay=await request(app).post('/api/auth/login').set({Cookie:flow.cookie}).send({email:flow.account.user.email,password,link_google:true});
  expect(replay.status).toBe(400);expect(replay.body.code).toBe('GOOGLE_LINK_EXPIRED');
});
test('confirmation cannot overwrite a different linked identity or steal another account identity',async()=>{
  const flow=await begin('conflict');
  await withTenant(flow.account.user.tenant_id,client=>client.query('UPDATE users SET google_sub=$1 WHERE user_id=$2',['different-existing-identity',flow.account.user.user_id]));
  expect((await flow.login()).status).toBe(409);expect(await linked(flow.account)).toBe('different-existing-identity');
  await withTenant(flow.account.user.tenant_id,client=>client.query('UPDATE users SET google_sub=NULL WHERE user_id=$1',[flow.account.user.user_id]));
  await withTenant(accounts.other.user.tenant_id,client=>client.query('UPDATE users SET google_sub=$1 WHERE user_id=$2',[flow.subject,accounts.other.user.user_id]));
  expect((await flow.login()).status).toBe(409);expect(await linked(flow.account)).toBeNull();
});
