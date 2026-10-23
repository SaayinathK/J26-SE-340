'use strict';
const request=require('supertest');
const crypto=require('node:crypto');
const app=require('../../src/main');
const pool=require('../../src/config/db');
const {withTenant,hash}=require('../../src/services/session');
const suffix=crypto.randomBytes(5).toString('hex');
const password='InvitationTestPass123!';
let admin,other;
const mailKeys=['SMTP_HOST','SMTP_FROM','PUBLIC_APP_URL'];
const previousMail=Object.fromEntries(mailKeys.map(key=>[key,process.env[key]]));
const auth=account=>({Authorization:'Bearer '+account.access_token});
const token=result=>new URLSearchParams(result.body.invitation_url.split('?')[1]).get('invite');
const invite=(label,extra={})=>request(app).post('/api/team/invitations').set(auth(admin)).send({email:`${label}-${suffix}@example.com`,role:'marketer',...extra});
const register=(label,extra={})=>request(app).post('/api/auth/register').send({name:'Invitation '+label,email:`${label}-${suffix}@example.com`,workspace_name:'Invitation '+label,password,...extra});
beforeAll(async()=>{
  for(const key of mailKeys)delete process.env[key];
  if(!/^c4_auth_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME||''))throw new Error('Use the isolated gateway verify-accounts runner.');
  admin=(await register('admin')).body;other=(await register('other')).body;
});
afterAll(()=>{for(const key of mailKeys){if(previousMail[key]===undefined)delete process.env[key];else process.env[key]=previousMail[key];}return pool.end();});
test('invitation preview identifies the recipient, workspace and role without exposing its hash',async()=>{
  const created=await invite('preview',{email:` PREVIEW-${suffix}@EXAMPLE.COM `});expect(created.status).toBe(201);
  const info=await request(app).get('/api/auth/invitations/'+token(created));expect(info.status).toBe(200);
  expect(info.body).toMatchObject({email:`preview-${suffix}@example.com`,workspace_id:admin.workspace.id,workspace_name:admin.workspace.name,role:'marketer',account_status:'new'});
  expect(info.body).not.toHaveProperty('token_hash');
});
test('links use the allowed browser origin and can use a configured public application origin',async()=>{
  const previousOrigins=process.env.CLIENT_ORIGINS,previousPublic=process.env.PUBLIC_APP_URL;
  try{
    process.env.CLIENT_ORIGINS='http://localhost:5173,http://127.0.0.1:5173';delete process.env.PUBLIC_APP_URL;
    const csrf='a'.repeat(64);
    const create=()=>request(app).post('/api/team/invitations').set({...auth(admin),Origin:'http://127.0.0.1:5173',Cookie:'c4_csrf='+csrf,'X-CSRF-Token':csrf}).send({email:`origin-${suffix}@example.com`,role:'viewer'});
    expect((await create()).body.invitation_url).toMatch(/^http:\/\/127\.0\.0\.1:5173\/#register\?invite=/);
    process.env.PUBLIC_APP_URL='https://app.example.com';expect((await create()).body.invitation_url).toMatch(/^https:\/\/app\.example\.com\/#register\?invite=/);
  }finally{if(previousOrigins===undefined)delete process.env.CLIENT_ORIGINS;else process.env.CLIENT_ORIGINS=previousOrigins;if(previousPublic===undefined)delete process.env.PUBLIC_APP_URL;else process.env.PUBLIC_APP_URL=previousPublic;}
});
test('acceptance joins the intended tenant once and removes the pending invite',async()=>{
  const created=await invite('accept');
  const accepted=await register('accept',{invitation_token:token(created)});expect(accepted.status).toBe(201);
  expect(accepted.body.workspace.id).toBe(admin.workspace.id);expect(accepted.body.user.role).toBe('marketer');
  expect((await request(app).get('/api/auth/invitations/'+token(created))).status).toBe(410);
  expect((await register('accept',{invitation_token:token(created)})).status).toBe(400);
  const team=(await request(app).get('/api/team').set(auth(admin))).body;
  expect(team.members.some(user=>user.email===accepted.body.user.email)).toBe(true);
  expect(team.invitations.some(invitation=>invitation.id===created.body.id)).toBe(false);
});
test('wrong-email and forged-role attempts cannot consume an invitation',async()=>{
  const created=await invite('intended');
  expect((await register('wrong',{invitation_token:token(created)})).status).toBe(400);
  expect((await register('intended',{invitation_token:token(created),role:'agency_admin',tenant_id:other.workspace.id})).status).toBe(400);
  expect((await request(app).get('/api/auth/invitations/'+token(created))).status).toBe(200);
});
test('replacement invalidates the old link and another tenant cannot revoke the new one',async()=>{
  const first=await invite('replace'),second=await invite('replace');
  expect((await request(app).get('/api/auth/invitations/'+token(first))).status).toBe(410);
  expect((await request(app).get('/api/auth/invitations/'+token(second))).status).toBe(200);
  expect((await request(app).delete('/api/team/invitations/'+second.body.id).set(auth(other)).send({})).status).toBe(404);
  expect((await request(app).delete('/api/team/invitations/'+second.body.id).set(auth(admin)).send({})).status).toBe(200);
  expect((await request(app).get('/api/auth/invitations/'+token(second))).status).toBe(410);
  expect((await register('replace',{invitation_token:token(second)})).status).toBe(400);
});
test('expired links and invitations from a demoted administrator cannot be accepted',async()=>{
  const expired=await invite('expired');
  await withTenant(admin.workspace.id,async client=>{await client.query('DELETE FROM workspace_invitations WHERE invitation_id=$1',[expired.body.id]);await client.query("INSERT INTO workspace_invitations(invitation_id,tenant_id,email,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,'marketer',$4,$5,now()-interval '1 second')",[expired.body.id,admin.workspace.id,expired.body.email,hash(token(expired)),admin.user.user_id]);});
  expect((await request(app).get('/api/auth/invitations/'+token(expired))).status).toBe(410);
  expect((await register('expired',{invitation_token:token(expired)})).status).toBe(400);
  const demoted=await invite('demoted');
  try{
    await withTenant(admin.workspace.id,client=>client.query("UPDATE users SET role='viewer' WHERE user_id=$1",[admin.user.user_id]));
    expect((await request(app).get('/api/auth/invitations/'+token(demoted))).status).toBe(410);
    expect((await register('demoted',{invitation_token:token(demoted)})).status).toBe(400);
    expect((await invite('blocked')).status).toBe(403);
  }finally{await withTenant(admin.workspace.id,client=>client.query("UPDATE users SET role='agency_admin' WHERE user_id=$1",[admin.user.user_id]));}
});
test('existing account invites fail clearly without changing an existing membership',async()=>{
  expect((await invite('member',{email:admin.user.email})).status).toBe(409);
  const elsewhere=await invite('elsewhere',{email:other.user.email});expect(elsewhere.status).toBe(409);expect(elsewhere.body.error).toContain('another workspace');
  expect((await request(app).get('/api/auth/me').set(auth(other))).body.workspace.id).toBe(other.workspace.id);
});
test('SMTP delivery sends the real invitation message and persists delivery status',async()=>{
  const catcher=await require('../helpers/smtp.cjs').createMailCatcher();
  const keys=['SMTP_HOST','SMTP_PORT','SMTP_FROM','SMTP_USER','SMTP_PASS','SMTP_SECURE','SMTP_REQUIRE_TLS','INVITATION_MAIL_DISABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    Object.assign(process.env,{SMTP_HOST:'127.0.0.1',SMTP_PORT:String(catcher.port),SMTP_FROM:'invitations@example.test',SMTP_USER:'',SMTP_PASS:'',SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'false',INVITATION_MAIL_DISABLED:'false'});
    const created=await invite('smtp');expect(created.status).toBe(201);expect(created.body.delivery.status).toBe('sent');
    expect(catcher.messages).toHaveLength(1);
    const email=catcher.messages[0].replace(/=\r\n/g,'').replace(/=3D/g,'=');
    expect(email).toContain(created.body.email);expect(email).toContain(created.body.invitation_url);expect(email).toContain('Join workspace');
    const listed=(await request(app).get('/api/team').set(auth(admin))).body;
    expect(listed.invitations.find(row=>row.id===created.body.id)).toMatchObject({delivery_status:'sent'});
    expect((await request(app).get('/api/auth/invitations/'+token(created))).status).toBe(200);
    await catcher.close();
    const failure=await invite('smtp-failure');expect(failure.status).toBe(201);expect(failure.body.delivery.status).toBe('failed');
    expect((await request(app).get('/api/auth/invitations/'+token(failure))).status).toBe(200);
  }finally{
    if(catcher.port){try{await catcher.close();}catch{}}
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
});
