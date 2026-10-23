'use strict';
const router=require('express').Router(),jwt=require('jsonwebtoken');
const {withTenant}=require('../services/session');
const proxy=require('./agentRoutes')({id:'email-agent',setting:'EMAIL_AGENT',port:4001,forwardAuthorization:true});
router.use(require('express-rate-limit').rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
router.use(async(req,res,next)=>{
 if(req.method!=='POST' || !/^\/(?:claim|jobs\/[a-f0-9-]{36}\/(?:heartbeat|complete|fail))$/.test(req.path))return res.status(404).json({error:'Worker endpoint not found.'});
 let claims;try{
  claims=jwt.verify((req.headers.authorization || '').replace(/^Bearer /,''),process.env.AGENT_GATEWAY_SECRET,{algorithms:['HS256'],issuer:'ciftron-email-agent',audience:'ciftron-colab-worker'});
  if(![claims.sub,claims.tenant_id,claims.jti].every(value=>typeof value==='string' && /^[a-f0-9-]{36}$/.test(value)))throw new Error('Invalid identity');
 }catch{return res.status(401).json({error:'Invalid or expired Colab worker token.'});}
 try{
  const actor=await withTenant(claims.tenant_id,async client=>(await client.query("SELECT u.user_id,u.tenant_id,u.email,u.display_name,u.role,t.name AS workspace_name FROM users u JOIN tenants t USING(tenant_id) WHERE u.user_id=$1 AND u.is_active AND u.role='agency_admin'",[claims.sub])).rows[0]);
  if(!actor)return res.status(403).json({error:'The worker administrator no longer has access.'});
  req.user=actor;next();
 }catch(error){next(error);}
});
router.use(proxy);
module.exports=router;
