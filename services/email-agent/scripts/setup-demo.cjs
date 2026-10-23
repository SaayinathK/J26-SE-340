'use strict';
// Explicit demo setup. Never invoked at application startup; existing passwords
// and non-demo workspaces are untouched. Old gym sources are recoverably archived.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const fixture = require('../db/seed/pp1-demo.json');
const { retrieveKnowledge } = require('../src/repositories/knowledgeContext');
async function setup(client,{apply = false} = {}) {
  const report = [];
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('email_pp1_demo_setup'))");
    for (const tenant of fixture.tenants) {
      const workspace = (await client.query('SELECT tenant_id,name FROM tenants WHERE slug=$1',[tenant.slug])).rows[0];
      if (!workspace || workspace.name !== tenant.name) throw new Error('Expected demo workspace is missing or renamed: ' + tenant.slug);
      await client.query("SELECT set_config('app.current_tenant',$1,true)",[workspace.tenant_id]);
      const old = tenant.slug === 'tenant_a' ? (await client.query("SELECT entry_id FROM knowledge_base WHERE text=ANY($1::text[]) AND coalesce(metadata->>'archived','false') <> 'true'",[fixture.legacy_gym_sources])).rowCount : 0;
      if (apply && old) await client.query("UPDATE knowledge_base SET type=coalesce(type,'Legacy demo'),metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('archived',true,'archive_reason','Superseded gym demo facts; preserved for reference','name',coalesce(metadata->>'name','Archived gym demo source')) WHERE text=ANY($1::text[])",[fixture.legacy_gym_sources]);
      let added = 0, restored = 0;
      for (const source of tenant.sources) {
        const key = fixture.version + ':' + source.key;
        const existing = (await client.query("SELECT entry_id,text,metadata FROM knowledge_base WHERE text=$1 OR metadata->>'demo_key'=$2 ORDER BY created_at LIMIT 1",[source.text,key])).rows[0];
        if (existing && existing.text !== source.text) throw new Error('A demo source was edited. Review it before replacing: ' + source.name);
        if (existing) {
          if (existing.metadata?.archived === true) {
            restored++;
            if (apply) await client.query("UPDATE knowledge_base SET metadata=coalesce(metadata,'{}'::jsonb) || '{\"archived\":false}'::jsonb WHERE entry_id=$1",[existing.entry_id]);
          }
        } else {
          added++;
          if (apply) await client.query('INSERT INTO knowledge_base (tenant_id,type,text,metadata) VALUES ($1,$2,$3,$4)',[workspace.tenant_id,'Business context',source.text,JSON.stringify({name:source.name,demo_key:key,archived:false})]);
        }
      }
      const actor = (await client.query("SELECT user_id FROM users WHERE lower(email)=$1 AND role='agency_admin' LIMIT 1",[tenant.account])).rows[0];
      if (apply && actor && (added || old || restored)) await client.query('INSERT INTO workspace_events (tenant_id,user_id,title,description,icon) VALUES ($1,$2,$3,$4,$5)',[workspace.tenant_id,actor.user_id,'PP1 demo knowledge prepared',`Operator setup: ${added} sources added; ${old} legacy gym sources archived; ${restored} sources restored.`,'book']);
      const active = await retrieveKnowledge(client,workspace.tenant_id);
      if (apply && (!tenant.sources.every(source => active.facts.includes(source.text)) || fixture.legacy_gym_sources.some(text => active.facts.includes(text)))) throw new Error('Active knowledge does not match the demo facts. No demo changes were committed.');
      report.push({workspace:workspace.name,account:tenant.account,sources_added:added,legacy_sources_archived:old,sources_restored:restored,active_sources:apply ? active.count : null,knowledge_ready:apply ? tenant.sources.every(source => active.facts.includes(source.text)) && !fixture.legacy_gym_sources.some(text => active.facts.includes(text)) : null});
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return {mode:apply ? 'applied' : 'preview',workspaces:report};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function main() {
  const dotenv = require('dotenv');
  const env = {...dotenv.parse(fs.readFileSync(path.join(__dirname,'../.env'))),...process.env};
  const client = new Client({host:env.DEMO_DB_HOST || '127.0.0.1',port:Number(env.DEMO_DB_PORT || 5434),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,connectionTimeoutMillis:10000});
  try { await client.connect(); console.log(JSON.stringify(await setup(client,{apply:process.argv.includes('--apply')}),null,2)); }
  catch (error) {console.error('Demo setup failed:',error.code || error.message); process.exitCode = 1;}
  finally { await client.end(); }
}
if (require.main === module) void main();
module.exports = { setup, main };
