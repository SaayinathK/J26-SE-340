'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { requirePermission } = require('../policies/rbac');

module.exports = function agentRoutes({ id, setting, port }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    {
      const permission = id === 'email-agent' ? 'email:generate' : ['GET', 'HEAD'].includes(req.method) ? 'campaigns:read' : 'campaigns:write';
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
      const token = jwt.sign({
        sub: req.user.user_id, tenant_id: req.user.tenant_id, role: req.user.role,
        email: req.user.email, display_name: req.user.display_name,
        workspace_name: req.user.workspace_name, method: req.method, path: req.originalUrl,
        body_hash: crypto.createHash('sha256').update(body || '').digest('hex'),
      }, secret, { algorithm: 'HS256', issuer: 'ciftron-gateway', audience: id, expiresIn: '30s', jwtid: crypto.randomUUID() });
      const upstream = await fetch(new URL(req.originalUrl, origin), {
        method: req.method, headers: { 'Content-Type': 'application/json', 'X-Gateway-Identity': token },
        ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(100000),
      });
      const content = await upstream.text();
      if (!upstream.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid service response');
      res.set('Cache-Control', 'no-store').status(upstream.status).type('json').send(content);
    } catch (error) {
      console.error('Agent connection failed:', id, error.name);
      res.status(503).json({ error: 'This service is not available right now. Please try again.', code: 'SERVICE_UNAVAILABLE' });
    }
  });
  return router;
};
