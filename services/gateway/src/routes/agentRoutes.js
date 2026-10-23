'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { requirePermission } = require('../policies/rbac');
const {contract,mutationPermission}=require('../services/agentContract');

module.exports = function agentRoutes({ id, setting, port, forwardAuthorization=false }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    {
      const permission = id === 'email-agent' ? 'email:generate' : mutationPermission(id,req.originalUrl.split('?')[0],req.method);
      let allowed = false;
      requirePermission(permission)(req, res, () => { allowed = true; });
      if (!allowed) return;
    }
    try {
      const origin = new URL(process.env[setting + '_INTERNAL_URL'] || `http://127.0.0.1:${port}`);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid service origin');
      const secret = process.env.AGENT_GATEWAY_SECRET;
      if (Buffer.byteLength(secret || '') < 32) throw new Error('Configure AGENT_GATEWAY_SECRET');
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {});
      const upstreamContract=contract(id,req);
      const token = jwt.sign({
        sub: req.user.user_id, tenant_id: req.user.tenant_id, role: req.user.role,
        email: req.user.email, display_name: req.user.display_name,
        workspace_name: req.user.workspace_name, method: req.method, path: upstreamContract.path,
        body_hash: crypto.createHash('sha256').update(body || '').digest('hex'),
      }, secret, { algorithm: 'HS256', issuer: 'ciftron-gateway', audience: id, expiresIn: '30s', jwtid: crypto.randomUUID() });
      const upstream = await fetch(new URL(upstreamContract.path, origin), {
        method: req.method, headers: { 'Content-Type': 'application/json', 'X-Gateway-Identity': token, ...upstreamContract.headers, ...(forwardAuthorization?{Authorization:req.headers.authorization}: {}) },
        ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(id==='content-agent' && req.path==='/generate' || id==='lead-intel' && req.path.endsWith('/recommendation')?330000:100000),
      });
      const content = await upstream.text();
      if (!upstream.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid service response');
      if(id!=='email-agent' && upstream.status===401)return res.status(502).json({error:'The agent connection needs administrator setup. Your workspace session is still signed in.',code:'AGENT_AUTHENTICATION_REQUIRED'});
      if(id!=='email-agent' && !upstream.ok){
        let data;try{data=JSON.parse(content);}catch{}
        const missing=data?.missing || data?.missing_fields;
        const detail=typeof data?.detail==='string'?data.detail:Array.isArray(data?.detail)?data.detail.map(item=>String(item.msg || 'Invalid input')).join('; '):null;
        return res.status(upstream.status).json({error:missing?.length?'Complete your business setup: '+missing.join(', ')+'.':data?.error || data?.message || detail || 'The agent could not complete this request.',code:data?.code || 'AGENT_REQUEST_FAILED'});
      }
      res.set('Cache-Control', 'no-store').status(upstream.status).type('json').send(content);
    } catch (error) {
      if([400,404].includes(error.status))return res.status(error.status).json({error:'Agent endpoint not found or invalid.'});
      console.error('Agent connection failed:', id, error.name);
      res.status(503).json({ error: 'This service is not available right now. Please try again.', code: 'SERVICE_UNAVAILABLE' });
    }
  });
  return router;
};
