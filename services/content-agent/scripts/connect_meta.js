require('dotenv').config();
const {pool,validTenant,query}=require('../src/config/db');
const {graph}=require('../src/services/metaInsights');
(async()=>{
 const [tenant,account,tokenEnv,version]=process.argv.slice(2);
 if(!validTenant(tenant)||!/^\d+$/.test(account||'')||!/^META_TOKEN_[A-Z0-9_]+$/.test(tokenEnv||'')||!/^v\d+\.\d+$/.test(version||'')||!process.env[tokenEnv])throw new Error('Usage: node scripts/connect_meta.js TENANT_UUID ACCOUNT_ID META_TOKEN_NAME vXX.0. Set that token environment variable first.');
 const config={tenant_id:tenant,account_id:account,token_env:tokenEnv,api_version:version};
 const verified=await graph(config,`act_${account}`,{fields:'account_id,currency'});
 if(String(verified.account_id)!==account)throw new Error('Account verification failed');
 await query(`INSERT INTO meta_connections(tenant_id,account_id,token_env,api_version) VALUES($1,$2,$3,$4)
 ON CONFLICT(tenant_id) DO UPDATE SET token_env=EXCLUDED.token_env,api_version=EXCLUDED.api_version,last_error=NULL
 WHERE meta_connections.account_id=EXCLUDED.account_id RETURNING tenant_id`,[tenant,account,tokenEnv,version],tenant).then(r=>{if(!r.rows.length)throw new Error('Account changes require reviewing existing ad mappings; existing account was preserved.');});
 console.log('Read-only Meta account connection verified and saved. Restart the server if its environment changed.');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
