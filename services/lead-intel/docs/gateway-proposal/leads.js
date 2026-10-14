// services/gateway/src/routes/leads.js — C4 -> C3 proxy (PROPOSAL from C3 for Saayinath to review)
// The gateway checks the JWT, role and audit, then calls C3 on port 3001 with the tenant
// taken ONLY from the token. Any X-Tenant-Id sent by the client is ignored.
const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const audit = require('../middleware/audit');

const C3_URL = process.env.C3_URL || 'http://127.0.0.1:3001';
const router = express.Router();
const slugs = new Map();                       // tenant UUID -> 'tenant_a' (C3 uses the slug)

async function tenantSlug(tenantId) {
  if (!slugs.has(tenantId)) {
    const r = await pool.query('SELECT slug FROM tenants WHERE tenant_id = $1', [tenantId]);
    if (r.rows.length !== 1) return null;
    slugs.set(tenantId, r.rows[0].slug);
  }
  return slugs.get(tenantId);
}

function forward(path, method = 'GET') {
  return async (req, res) => {
    let slug;
    try {
      slug = await tenantSlug(req.user.tenant_id);
    } catch (e) {
      return res.status(500).json({ error: 'Tenant lookup failed' });
    }
    if (!slug) return res.status(403).json({ error: 'Unknown tenant' });
    try {
      const r = await fetch(C3_URL + path(req), {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': slug },
        body: method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
        signal: AbortSignal.timeout(180000)      // RAG on CPU can take up to ~2 minutes
      });
      res.status(r.status).type('application/json').send(await r.text());
    } catch {
      res.status(502).json({ error: 'C3 Lead Intelligence service unavailable' });
    }
  };
}

const ALL = ['agency_admin', 'marketer', 'viewer'];
const WRITE = ['agency_admin', 'marketer'];

router.post('/score', authenticate, audit('c3_lead_score'), authorize(...WRITE),
  forward(() => '/leads/score', 'POST'));
router.get('/analytics', authenticate, audit('c3_lead_analytics'), authorize(...ALL),
  forward(() => '/leads/analytics'));
router.get('/dashboard', authenticate, audit('c3_lead_dashboard'), authorize(...ALL),
  forward(() => '/leads/dashboard'));
router.get('/:leadId/recommendation', authenticate, audit('c3_lead_recommendation'), authorize(...WRITE),
  forward(req => `/leads/${encodeURIComponent(req.params.leadId)}/recommendation`));

module.exports = router;