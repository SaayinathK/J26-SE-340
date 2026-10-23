'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const {Client} = require(path.join(root,'services/gateway/node_modules/pg'));
const dotenv = require(path.join(root,'services/gateway/node_modules/dotenv'));
const {seedSystem,workspaceSamples} = require('./lib/demo-seed.cjs');
async function main() {
  const apply = process.argv.includes('--apply');
  const clients = [['gateway',5433,'saas_platform'],['email-agent',5434,'email_agent']].map(([service,port,database]) => {
    const owner = dotenv.parse(fs.readFileSync(path.join(root,'services',service,'db/.env')));
    return new Client({host:process.env.SEED_DB_HOST || '127.0.0.1',port,database,user:'admin',password:owner.POSTGRES_PASSWORD,connectionTimeoutMillis:10000});
  });
  const connected = [];
  try {
    for (const client of clients) {await client.connect();connected.push(client);await client.query('BEGIN');}
    const targetIndex=process.argv.indexOf('--workspace-slug');
    let workspaces;
    if(targetIndex>=0){
      const slug=process.argv[targetIndex+1];
      if(!slug || slug.startsWith('--'))throw new Error('Provide the existing workspace slug after --workspace-slug.');
      const workspace=(await clients[0].query('SELECT * FROM tenants WHERE slug=$1',[slug])).rows[0];
      if(!workspace)throw new Error('Target workspace does not exist.');
      workspaces=[workspaceSamples(workspace)];
    }
    const report = await seedSystem({gateway:clients[0],email:clients[1],...(workspaces?{workspaces}:{})});
    const {credentials,...publicReport} = report;
    if (apply && credentials.length) {
      const filename = path.join(root,'.local/seed-credentials.json');
      fs.mkdirSync(path.dirname(filename),{recursive:true});
      const prior = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename,'utf8')) : [];
      fs.writeFileSync(filename,JSON.stringify([...prior.filter(row => !credentials.some(item => item.email===row.email)),...credentials],null,2)+'\n',{mode:0o600});
    }
    for (const client of clients) await client.query(apply?'COMMIT':'ROLLBACK');
    console.log(JSON.stringify({mode:apply?'applied':'preview',...publicReport,new_passwords:apply&&credentials.length?'.local/seed-credentials.json':'Existing passwords unchanged; no new credentials written.'},null,2));
    console.log('Pending agent databases have no business tables. No model inference, external API calls, email sending or active login sessions were seeded.');
  } catch(error) {
    for (const client of connected) await client.query('ROLLBACK').catch(()=>{});
    console.error('Seed failed:',error.code || error.message);process.exitCode=1;
  } finally {for(const client of connected) await client.end();}
}
if(require.main===module) void main();
module.exports = {main};
