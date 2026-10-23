'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const {Client} = require(path.join(root,'services/gateway/node_modules/pg'));
const dotenv = require(path.join(root,'services/gateway/node_modules/dotenv'));
const {seedSystem,id,workspaceSamples} = require('./lib/demo-seed.cjs');
const suffix = crypto.randomBytes(6).toString('hex');
const configs = [['gateway',5433],['email-agent',5434]].map(([service,port],index) => ({service,port,name:`ciftron_seed_verify_${suffix}_${index}`,password:dotenv.parse(fs.readFileSync(path.join(root,'services',service,'db/.env'))).POSTGRES_PASSWORD}));
const owners = [],clients = [],created = [];
(async () => {
  try {
    for (const config of configs) {
      assert.match(config.name,/^ciftron_seed_verify_[a-f0-9]{12}_[01]$/);
      const owner = new Client({host:'127.0.0.1',port:config.port,user:'admin',password:config.password,database:'postgres'});
      await owner.connect();owners.push(owner);
      await owner.query('CREATE DATABASE ' + config.name);created.push(config.name);
      const client = new Client({host:'127.0.0.1',port:config.port,user:'admin',password:config.password,database:config.name});
      await client.connect();clients.push(client);
      const migrations = path.join(root,'services',config.service,'db/migrations');
      for(const file of fs.readdirSync(migrations).filter(file=>/^\d+.*\.sql$/.test(file)).sort()) await client.query(fs.readFileSync(path.join(migrations,file),'utf8'));
      await client.query("INSERT INTO tenants (tenant_id,name,slug) VALUES ($1,'Unrelated workspace','unrelated-preserved')",[id('unrelated')]);
      await client.query("INSERT INTO campaigns (id,tenant_id,name,audience) VALUES ($1,$2,'User campaign','Existing customers')",[id('unrelated-campaign'),id('unrelated')]);
    }
    const run = async apply => {
      for(const client of clients) await client.query('BEGIN');
      try {
        const report = await seedSystem({gateway:clients[0],email:clients[1],passwordFor:()=> 'TemporarySeedPass123!'});
        for(const client of clients) await client.query(apply?'COMMIT':'ROLLBACK');
        return report;
      } catch(error){for(const client of clients) await client.query('ROLLBACK').catch(()=>{});throw error;}
    };
    const preview = await run(false); assert.equal(preview.credentials.length,9);
    assert.equal((await clients[0].query('SELECT count(*)::int AS n FROM users')).rows[0].n,0);
    const first = await run(true); assert.equal(first.credentials.length,9);
    assert.equal(first.created.gateway.campaigns,12);assert.equal(first.created.email.email_outcomes,27);
    const hashes = (await clients[0].query('SELECT user_id,password_hash FROM users ORDER BY user_id')).rows;
    await clients[0].query("UPDATE campaigns SET name='User edited sample' WHERE id=$1",[id('tenant_a:campaign:0')]);
    const repeated = await run(true);
    assert.equal(repeated.credentials.length,0);
    for(const counts of Object.values(repeated.created)) assert.ok(Object.values(counts).every(count=>count===0));
    assert.equal((await clients[0].query('SELECT name FROM campaigns WHERE id=$1',[id('tenant_a:campaign:0')])).rows[0].name,'User edited sample');
    assert.deepEqual((await clients[0].query('SELECT user_id,password_hash FROM users ORDER BY user_id')).rows,hashes);
    for(const client of clients) {
      assert.equal((await client.query('SELECT name FROM campaigns WHERE id=$1',[id('unrelated-campaign')])).rows[0].name,'User campaign');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM auth_sessions')).rows[0].n,0);
      await client.query('BEGIN');await client.query('SET LOCAL ROLE c4_app');
      await client.query("SELECT set_config('app.current_tenant',$1,true)",[id('tenant_a')]);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM campaigns')).rows[0].n,4);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM users')).rows[0].n,3);
      await client.query('ROLLBACK');
    }
    assert.equal((await clients[1].query("SELECT count(*)::int AS n FROM email_outcomes WHERE provenance='synthetic'")).rows[0].n,27);
    assert.equal((await clients[1].query("SELECT count(*)::int AS n FROM email_outcomes WHERE provenance='manual'")).rows[0].n,0);
    assert.equal((await clients[1].query("SELECT count(*)::int AS n FROM email_learning_runs WHERE evaluation->>'synthetic'='true'")).rows[0].n,3);
    assert.equal((await clients[1].query('SELECT count(*)::int AS n FROM email_learning_settings WHERE enabled OR auto_train OR active_run_id IS NOT NULL')).rows[0].n,0);
    const gatewayIds=(await clients[0].query('SELECT user_id,tenant_id,email FROM users ORDER BY email')).rows;
    const emailIds=(await clients[1].query('SELECT user_id,tenant_id,email FROM users ORDER BY email')).rows;
    assert.deepEqual(gatewayIds,emailIds);
    // Explicit workspace seeding must preserve accounts, edits and other tenants.
    await clients[0].query("INSERT INTO users(user_id,tenant_id,email,display_name,role,password_hash) VALUES($1,$2,'existing@example.test','Existing admin','agency_admin','unchanged-hash')",[id('existing-admin'),id('unrelated')]);
    const target=(await clients[0].query('SELECT * FROM tenants WHERE tenant_id=$1',[id('unrelated')])).rows[0];
    const othersBefore=(await clients[0].query('SELECT * FROM campaigns WHERE tenant_id<>$1 ORDER BY id',[target.tenant_id])).rows;
    async function seedExisting(){
      for(const client of clients)await client.query('BEGIN');
      try{
        const result=await seedSystem({gateway:clients[0],email:clients[1],workspaces:[workspaceSamples(target)]});
        for(const client of clients)await client.query('COMMIT');return result;
      }catch(error){for(const client of clients)await client.query('ROLLBACK');throw error;}
    }
    const targeted=await seedExisting();
    assert.equal(targeted.credentials.length,0);
    assert.equal(targeted.created.gateway.campaigns,4);
    assert.equal(targeted.created.gateway.users,undefined);
    assert.equal(targeted.created.gateway.workspace_invitations,undefined);
    assert.equal((await clients[0].query('SELECT password_hash FROM users WHERE user_id=$1',[id('existing-admin')])).rows[0].password_hash,'unchanged-hash');
    assert.equal((await clients[0].query('SELECT count(*)::int AS n FROM users WHERE tenant_id=$1',[target.tenant_id])).rows[0].n,1);
    assert.equal((await clients[0].query('SELECT name FROM campaigns WHERE id=$1',[id('unrelated-campaign')])).rows[0].name,'User campaign');
    assert.deepEqual((await clients[0].query('SELECT * FROM campaigns WHERE tenant_id<>$1 ORDER BY id',[target.tenant_id])).rows,othersBefore);
    assert.ok((await clients[1].query('SELECT metadata FROM knowledge_base WHERE tenant_id=$1',[target.tenant_id])).rows.every(row=>row.metadata.name.startsWith('[Sample]')));
    const again=await seedExisting();
    for(const counts of Object.values(again.created))assert.ok(Object.values(counts).every(count=>count===0));
    console.log('PASS: seed preview rolls back; 3 demo tenants, 9 accounts, 12 campaigns, 9 sequences and 27 synthetic outcomes; repeat inserts zero rows, preserves edits/passwords, keeps identities aligned, enforces tenant isolation and leaves learning disabled.');
    console.log('PASS: explicit existing-workspace samples preserve its account/password, prior campaign and all other tenants; create no accounts or invitations; knowledge is labelled; repeat inserts zero rows.');
  } finally {
    for(const client of clients) await client.end();
    for(let index=0;index<owners.length;index++) {if(created[index] && /^ciftron_seed_verify_[a-f0-9]{12}_[01]$/.test(created[index])) await owners[index].query('DROP DATABASE ' + created[index] + ' WITH (FORCE)');await owners[index].end();}
  }
})().catch(error=>{console.error('Seed verification failed:',error.message);process.exitCode=1;});
