const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
function key(){
 let encoded=process.env.CRM_ENCRYPTION_KEY;
 if(!encoded){
  if(process.env.NODE_ENV==='production')throw Object.assign(new Error('Configure CRM_ENCRYPTION_KEY on the server before connecting CRM.'),{status:503});
  const directory=join(__dirname,'../../.local-secrets');mkdirSync(directory,{recursive:true,mode:0o700});
  const file=join(directory,'crm.key');
  try{encoded=readFileSync(file,'utf8').trim();}catch(e){if(e.code!=='ENOENT')throw e;try{writeFileSync(file,randomBytes(32).toString('base64'),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}encoded=readFileSync(file,'utf8').trim();}
 }
 const result=Buffer.from(encoded,'base64');if(result.length!==32)throw Object.assign(new Error('CRM encryption key must be 32 bytes encoded as base64.'),{status:503});return result;
}
function encrypt(token,tenant){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(tenant));const value=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),value].map(x=>x.toString('base64')).join('.');}
function decrypt(value,tenant){try{const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(tenant));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}catch{throw Object.assign(new Error('CRM credentials cannot be decrypted. Restore the server encryption key or reconnect.'),{status:503});}}
module.exports={encrypt,decrypt};
