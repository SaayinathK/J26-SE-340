'use strict';
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const pool=require('../config/db');
const {cookies,cookieName,cookieOptions,hash,withTenant}=require('./session');
const purpose={algorithm:'HS256',issuer:'c4-gateway',audience:'c4-google-link',expiresIn:'5m'};
async function prepare(res,account,payload){
  const nonce=crypto.randomBytes(32).toString('hex');
  const token=jwt.sign({sub:account.user_id,email:payload.email.toLowerCase(),google_sub:payload.sub,jti:nonce},process.env.JWT_SECRET,purpose);
  await pool.query("INSERT INTO auth_google_challenges(challenge_hash,intent) VALUES($1,'link')",[hash(nonce)]);
  res.cookie(cookieName('google_link'),token,{...cookieOptions(),maxAge:300000});
}
async function complete(req,res,account){
  let proof;
  try{
    proof=jwt.verify(cookies(req)[cookieName('google_link')] || '',process.env.JWT_SECRET,{algorithms:['HS256'],issuer:purpose.issuer,audience:purpose.audience});
    if(proof.sub!==account.user_id || proof.email!==account.email.toLowerCase() || typeof proof.google_sub!=='string' || !/^[a-f0-9]{64}$/.test(proof.jti))throw new Error('Wrong account');
  }catch{return {status:400,error:'Your Google confirmation expired or belongs to another account. Choose Google sign-in again.',code:'GOOGLE_LINK_EXPIRED'};}
  const result=await withTenant(account.tenant_id,async client=>{
    const user=(await client.query('SELECT email,google_sub FROM users WHERE user_id=$1 AND is_active FOR UPDATE',[account.user_id])).rows[0];
    if(!user || user.email.toLowerCase()!==proof.email)return {status:400,error:'Choose the Google account with your registered email address.'};
    if(user.google_sub && user.google_sub!==proof.google_sub)return {status:409,error:'A different Google identity is already connected. Use your existing sign-in method.'};
    const used=await client.query("DELETE FROM auth_google_challenges WHERE challenge_hash=$1 AND intent='link' AND expires_at>now() RETURNING challenge_hash",[hash(proof.jti)]);
    if(!used.rowCount)return {status:400,error:'This Google confirmation has expired or was already used. Choose Google sign-in again.',code:'GOOGLE_LINK_EXPIRED'};
    await client.query('UPDATE users SET google_sub=$1 WHERE user_id=$2',[proof.google_sub,account.user_id]);
    return null;
  });
  if(!result)res.clearCookie(cookieName('google_link'),cookieOptions());
  return result;
}
module.exports={prepare,complete};
