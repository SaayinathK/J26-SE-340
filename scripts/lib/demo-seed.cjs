'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'../..');
const bcrypt = require(path.join(root,'services/gateway/node_modules/bcryptjs'));
const pp1 = require(path.join(root,'services/email-agent/db/seed/pp1-demo.json'));
const {validateSequence} = require(path.join(root,'services/email-agent/src/repositories/sequenceStore'));
const engagement = require(path.join(root,'services/email-agent/src/services/engagementModel'));
const {retrieveKnowledge} = require(path.join(root,'services/email-agent/src/repositories/knowledgeContext'));
const SEED = 'system-demo-v1';
const tenants = [...pp1.tenants.map(item => ({...item,tier:'starter'})),{
  slug:'tenant_c',name:'EventSpark Agency',tier:'starter',sources:[
    {key:'business',name:'EventSpark: business',text:'EventSpark Agency plans corporate events and workshops in Colombo.'},
    {key:'services',name:'EventSpark: services',text:'Services include event planning, venue coordination and workshop logistics.'},
    {key:'audience',name:'EventSpark: audience',text:'EventSpark Agency works with business teams, event organisers and workshop hosts.'},
    {key:'consultation',name:'EventSpark: enquiries',text:'Clients can request an online discovery call to discuss their event requirements.'},
  ]
}];
function id(key) {
  const bytes = crypto.createHash('sha256').update(SEED + ':' + key).digest().subarray(0,16);
  bytes[6] = bytes[6] & 15 | 80; bytes[8] = bytes[8] & 63 | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function sequence(tenant,variant) {
  const names = ['Welcome','Service discovery','Reconnect'];
  const subjects = ['A useful introduction','Explore your next step','Continue the conversation'];
  const emails = [0,3,7].map((day,index) => ({email_index:index+1,send_at_days:day,subject:subjects[(index+variant)%3],body:`Hello {{first_name}},\n\n${tenant.sources[index % Math.min(3,tenant.sources.length)].text}\n\nExplore your options with ${tenant.name}: {{cta_link}}\n\nTo unsubscribe from these emails, reply STOP or click here.`}));
  return {name:`[Sample] ${tenant.name}: ${names[variant]}`,audience:'Demo subscribers',tone:['Friendly','Professional','Formal'][variant],source:'all',emails,origin:'manual',generation:{sample:true,seed:SEED,provenance:'Manually authored sample; not model inference.'}};
}
async function insert(client,table,record,counts) {
  const columns = Object.keys(record);
  if (![table,...columns].every(value => /^[a-z_]+$/.test(value))) throw new Error('Invalid seed identifier');
  const result = await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_value,index)=>'$'+(index+1)).join(',')}) ON CONFLICT DO NOTHING RETURNING 1`,Object.values(record));
  counts[table] = (counts[table] || 0) + result.rowCount;
  return result.rowCount;
}
function workspaceSamples(workspace) {
  return {slug:workspace.slug,name:workspace.name,tier:workspace.tier,existingOnly:true,invitation:false,sources:[
    {key:'sample-business',name:'[Sample] Demo business context',text:`Sample scenario for the ${workspace.name} workspace: a fictional marketing team helps small businesses plan digital campaigns. This is demonstration content, not a statement about the workspace owner's real services.`},
    {key:'sample-services',name:'[Sample] Demo services',text:'In this sample scenario, the team helps with campaign planning, content preparation and email sequence drafting. These are fictional services for testing the platform.'},
    {key:'sample-audience',name:'[Sample] Demo audience',text:'The sample audience is small business owners and marketing coordinators exploring digital campaign tools. No real contact records or customer identities are included.'},
    {key:'sample-voice',name:'[Sample] Demo brand voice',text:'For this demonstration, use a friendly, clear and professional tone. Invite readers to learn more. Do not invent discounts, promo codes, scarcity or deadlines.'},
  ]};
}
async function projectUser(client,user,counts) {
  const existing=(await client.query('SELECT user_id,tenant_id FROM users WHERE lower(email)=$1 OR user_id=$2',[user.email.toLowerCase(),user.user_id])).rows;
  if(existing.some(row=>row.user_id!==user.user_id || row.tenant_id!==user.tenant_id))throw new Error('Account identity differs between services: '+user.email);
  await insert(client,'users',{user_id:user.user_id,tenant_id:user.tenant_id,email:user.email,display_name:user.display_name,role:user.role,is_active:user.is_active,password_hash:null},counts);
}
async function seedSystem({gateway,email,workspaces=tenants,passwordFor = () => 'Demo-' + crypto.randomBytes(20).toString('base64url') + '-7aA!'} = {}) {
  const report = {seed:SEED,created:{gateway:{},email:{}},credentials:[],tenants:[],skipped_services:['content-agent','lead-intel','strategy-fl']};
  await gateway.query("SELECT pg_advisory_xact_lock(hashtext('system-demo-seed'))");
  await email.query("SELECT pg_advisory_xact_lock(hashtext('system-demo-seed'))");
  for (const tenant of workspaces) {
    let workspace = (await gateway.query('SELECT * FROM tenants WHERE slug=$1',[tenant.slug])).rows[0];
    if(!workspace && tenant.existingOnly)throw new Error('Sample target workspace does not exist: '+tenant.slug);
    if (!workspace) {
      await insert(gateway,'tenants',{tenant_id:id(tenant.slug),name:tenant.name,slug:tenant.slug,tier:tenant.tier},report.created.gateway);
      workspace = (await gateway.query('SELECT * FROM tenants WHERE slug=$1',[tenant.slug])).rows[0];
    }
    if (workspace.name !== tenant.name) throw new Error('Demo tenant name differs; refusing to change ' + tenant.slug);
    const projected = (await email.query('SELECT tenant_id,name,slug FROM tenants WHERE tenant_id=$1 OR slug=$2',[workspace.tenant_id,tenant.slug])).rows;
    if (projected.some(row => row.tenant_id !== workspace.tenant_id || row.name !== tenant.name)) throw new Error('Demo tenant identity differs between services: ' + tenant.slug);
    await insert(email,'tenants',{tenant_id:workspace.tenant_id,name:tenant.name,slug:tenant.slug,tier:workspace.tier},report.created.email);
    for (const client of [gateway,email]) await client.query("SELECT set_config('app.current_tenant',$1,true)",[workspace.tenant_id]);
    const users = [];
    if(tenant.existingOnly){
      users.push(...(await gateway.query("SELECT user_id,tenant_id,email,display_name,role,is_active FROM users WHERE tenant_id=$1 ORDER BY CASE WHEN role='agency_admin' AND is_active THEN 0 ELSE 1 END,created_at",[workspace.tenant_id])).rows);
      if(!users.some(user=>user.role==='agency_admin' && user.is_active))throw new Error('An active administrator is required for sample attribution.');
      for(const user of users)await projectUser(email,user,report.created.email);
    } else {
    for (const [role,prefix,label] of [['agency_admin','admin','Administrator'],['marketer','marketer','Marketer'],['viewer','viewer','Viewer']]) {
      const address = `${prefix}@${tenant.slug.replace('_','-')}.com`;
      let user = (await gateway.query('SELECT user_id,tenant_id,email,display_name,role,is_active FROM users WHERE lower(email)=$1',[address])).rows[0];
      if (user && user.tenant_id !== workspace.tenant_id) throw new Error('Demo account belongs to another workspace: ' + address);
      if (!user) {
        const password = passwordFor(address);
        await insert(gateway,'users',{user_id:id(address),tenant_id:workspace.tenant_id,email:address,display_name:`${tenant.name} ${label}`,role,password_hash:await bcrypt.hash(password,12)},report.created.gateway);
        report.credentials.push({workspace:tenant.name,email:address,password,role});
        user = (await gateway.query('SELECT user_id,tenant_id,email,display_name,role,is_active FROM users WHERE email=$1',[address])).rows[0];
      }
      await projectUser(email,user,report.created.email);
      users.push(user);
    }
    }
    const admin = users[0];
    for (const source of tenant.sources) for (const [client,key] of [[gateway,'gateway'],[email,'email']]) {
      if (!(await client.query('SELECT 1 FROM knowledge_base WHERE tenant_id=$1 AND text=$2',[workspace.tenant_id,source.text])).rowCount) await insert(client,'knowledge_base',{entry_id:id(tenant.slug + ':knowledge:' + source.key),tenant_id:workspace.tenant_id,type:'Business context',text:source.text,metadata:JSON.stringify({name:source.name,seed:SEED,archived:false})},report.created[key]);
    }
    for (let index=0;index<4;index++) {
      const createdAt = new Date(Date.now() - (21-index*5)*86400000).toISOString();
      const campaign = {id:id(tenant.slug + ':campaign:' + index),tenant_id:workspace.tenant_id,name:`[Sample] ${tenant.name}: ${['Welcome campaign','Service discovery','Reconnect campaign','Past campaign'][index]}`,audience:['New subscribers','Interested prospects','Past clients','Previous subscribers'][index],status:index===3?'Archived':'Draft',created_at:createdAt,updated_at:createdAt};
      for (const [client,key] of [[gateway,'gateway'],[email,'email']]) await insert(client,'campaigns',campaign,report.created[key]);
    }
    const context = await retrieveKnowledge(email,workspace.tenant_id);
    const samples = [];
    for (let index=0;index<3;index++) {
      const draft = sequence(tenant,index);
      const validation = validateSequence(draft,context.facts);
      if (validation.error) throw new Error('Sample sequence failed current knowledge checks: ' + tenant.name + ': ' + validation.error);
      const sequenceId = id(tenant.slug + ':sequence:' + index);
      const row = {id:sequenceId,tenant_id:workspace.tenant_id,name:draft.name,audience:draft.audience,tone:draft.tone,source:draft.source,emails:JSON.stringify(draft.emails),origin:draft.origin};
      await insert(gateway,'email_sequences',row,report.created.gateway);
      await insert(email,'email_sequences',{...row,generation:JSON.stringify(draft.generation),review_status:'Needs changes',guardrail_flags:'[]',guardrail_checked_at:new Date().toISOString()},report.created.email);
      const saved = (await email.query('SELECT * FROM email_sequences WHERE id=$1 AND tenant_id=$2',[sequenceId,workspace.tenant_id])).rows[0];
      if (!saved || !saved.generation?.sample) throw new Error('Sample sequence ID collision');
      await insert(email,'email_reviews',{id:id(tenant.slug + ':review:' + index),tenant_id:workspace.tenant_id,sequence_id:sequenceId,sequence_version:saved.version,user_id:admin.user_id,rating:4,verdict:'Needs changes',note:'[Sample] Fictional review: refine the audience and confirm brand voice before approval. This is seeded feedback.'},report.created.email);
      for (let step=1;step<=3;step++) {
        const delivered = [240,210,180][step-1];
        await insert(email,'email_outcomes',{id:id(tenant.slug + ':outcome:' + index + ':' + step),tenant_id:workspace.tenant_id,sequence_id:sequenceId,email_index:step,sequence_version:saved.version,delivered,opened:delivered/3,clicked:delivered/10,replied:[6,5,4][step-1],unsubscribed:step===3?0:1,features:JSON.stringify(engagement.features(saved,step)),provenance:'synthetic'},report.created.email);
      }
      samples.push(sequenceId);
    }
    const rows = (await email.query("SELECT id,sequence_id,delivered,clicked,features FROM email_outcomes WHERE sequence_id=ANY($1::uuid[]) AND provenance='synthetic' ORDER BY id",[samples])).rows;
    const evaluated = engagement.train(rows);
    await insert(email,'email_learning_runs',{id:id(tenant.slug + ':learning'),tenant_id:workspace.tenant_id,status:evaluated.status,algorithm:'beta-binomial-v1',dataset_hash:evaluated.dataset_hash,sample_count:evaluated.sample_count,sequence_count:evaluated.sequence_count,model:JSON.stringify(evaluated.model),evaluation:JSON.stringify({...evaluated.evaluation,synthetic:true,provenance:'Fictional seed outcomes; evaluation is for UI demonstration and cannot be activated.'})},report.created.email);
    await insert(email,'email_learning_settings',{tenant_id:workspace.tenant_id,enabled:false,auto_train:false,active_run_id:null},report.created.email);
    for (const provider of ['gohighlevel','meta']) await insert(email,'email_integration_preferences',{tenant_id:workspace.tenant_id,provider,account_reference:''},report.created.email);
    if(tenant.invitation!==false){
    const invitationToken = crypto.randomBytes(32).toString('base64url');
    await insert(gateway,'workspace_invitations',{invitation_id:id(tenant.slug + ':invitation'),tenant_id:workspace.tenant_id,email:`new-teammate@${tenant.slug.replace('_','-')}.example.test`,role:'marketer',token_hash:crypto.createHash('sha256').update(invitationToken).digest('hex'),created_by:admin.user_id},report.created.gateway);
    }
    for (const [client,key] of [[gateway,'gateway'],[email,'email']]) {
      for (const [index,title,icon] of [[0,'Sample campaigns prepared','mail'],[1,'Sample workspace data added','book'],[2,'Sample feedback available','checks']]) await insert(client,'workspace_events',{id:id(tenant.slug + ':event:' + index),tenant_id:workspace.tenant_id,user_id:admin.user_id,title:'[Sample] ' + title,description:'Demo records seeded explicitly. Synthetic engagement is not measured delivery and is excluded from continuous learning.',icon},report.created[key]);
      await insert(client,'audit_log',{log_id:id(tenant.slug + ':audit'),tenant_id:workspace.tenant_id,user_id:admin.user_id,route:'cli:seed-all',action:'seed_demo_data',decision:'allowed',status_code:200},report.created[key]);
    }
    report.tenants.push({slug:tenant.slug,name:tenant.name,accounts:users.map(user => ({email:user.email,role:user.role})),sample_campaigns:4,sample_sequences:3,sample_reviews:3,synthetic_outcomes:rows.length,sample_learning_runs:1});
  }
  return report;
}
module.exports = {seedSystem,tenants,sequence,id,SEED,workspaceSamples};
