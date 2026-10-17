'use strict';
// Initialize missing local settings only. Existing credentials are never replaced.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function read(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(line=>/^[A-Z_][A-Z0-9_]*=/.test(line)).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
}
function complete(file, defaults) {
  const current = read(file);
  const additions = Object.entries(defaults).filter(([key])=>current[key] === undefined);
  if (additions.length) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.appendFileSync(file, '\n'+additions.map(([key,value])=>key+'='+value).join('\n')+'\n'); }
}
const token = () => crypto.randomBytes(48).toString('base64url');
const gatewayFile=path.join(root,'services/gateway/.env');
const emailFile=path.join(root,'services/email-agent/.env');
const gatewaySecret=read(gatewayFile).AGENT_GATEWAY_SECRET;
const emailSecret=read(emailFile).AGENT_GATEWAY_SECRET;
if (gatewaySecret && emailSecret && gatewaySecret !== emailSecret) throw new Error('Gateway and Email Agent AGENT_GATEWAY_SECRET values must match. Existing files were preserved.');
const shared=gatewaySecret || emailSecret || token();
for (const [service,database,port] of [['gateway','saas_platform',5433],['email-agent','email_agent',5434],['content-agent','content_agent',5435],['lead-intel','lead_intel',5436],['strategy-fl','strategy_fl',5437]]) {
  const directory=path.join(root,'services',service);
  complete(path.join(directory,'db/.env'),{POSTGRES_PASSWORD:token()});
  complete(path.join(directory,'.env'),{DB_HOST:'127.0.0.1',DB_PORT:port,DB_NAME:database,DB_USER:'c4_app',DB_PASSWORD:token(),
    ...(service==='gateway'||service==='email-agent'?{JWT_SECRET:token(),AGENT_GATEWAY_SECRET:shared,CLIENT_ORIGINS:'http://localhost:5173,http://127.0.0.1:5173'}:{}),
    ...(service==='email-agent'?{OLLAMA_HOST:'http://127.0.0.1:11435',OLLAMA_MODEL:'mistral:7b-instruct-q4_K_M',EMBED_MODEL:'nomic-embed-text'}:{})});
}
console.log('Local configuration initialized. Existing credentials and database volumes were preserved.');
