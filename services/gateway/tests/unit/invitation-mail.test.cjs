'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applicationOrigin}=require('../../src/services/invitations');
const {configuration,message}=require('../../src/services/invitationMail');
test('mail message escapes workspace markup and contains the recipient-bound single-use link',()=>{
  const value=message({email:'recipient@example.test',workspace_name:'<img src=x> & Team',role:'viewer',invitation_url:'https://app.example.test/#register?invite=token',expires_at:'2026-11-01T00:00:00Z'},{SMTP_FROM:'sender@example.test'});
  assert.ok(!value.html.includes('<img src=x>'));assert.ok(value.html.includes('&lt;img src=x&gt; &amp; Team'));
  assert.ok(value.text.includes('recipient@example.test'));assert.equal(value.disableFileAccess,true);assert.equal(value.disableUrlAccess,true);
});
test('SMTP settings auto-detect TLS for port 465 and require STARTTLS by default for 587',()=>{
  assert.equal(configuration({SMTP_HOST:'smtp.example.test',SMTP_FROM:'sender@example.test',SMTP_PORT:'465'}).secure,true);
  assert.equal(configuration({SMTP_HOST:'smtp.example.test',SMTP_FROM:'sender@example.test',SMTP_PORT:'587'}).requireTLS,true);
  assert.equal(configuration({}),null);
  assert.throws(()=>configuration({SMTP_HOST:'smtp.example.test',SMTP_FROM:'sender@example.test',SMTP_USER:'user'}));
});
test('untrusted request origins cannot choose the invitation deployment URL',()=>{
  const saved={CLIENT_ORIGINS:process.env.CLIENT_ORIGINS,PUBLIC_APP_URL:process.env.PUBLIC_APP_URL};
  try{process.env.CLIENT_ORIGINS='https://trusted.example.test';delete process.env.PUBLIC_APP_URL;assert.equal(applicationOrigin({get:()=> 'https://attacker.example.test'}),'https://trusted.example.test');}
  finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
