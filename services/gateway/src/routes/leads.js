const router = require('express').Router();
const pool = require('../db');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const audit = require('../middleware/audit');

router.use(authenticate);

function forward(path, method = 'GET') {
  return async (req, res) => {
    try {
      const tenant = await pool.query('SELECT slug FROM tenants WHERE tenant_id = $1', [req.user.tenant_id]);
      if (tenant.rows.length !== 1) return res.status(403).json({ error: 'Unknown tenant' });
      const upstream = await fetch((process.env.C3_URL || 'http://127.0.0.1:4003') + path(req), {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant.rows[0].slug },
        body: method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
        signal: AbortSignal.timeout(300000)
      });
      res.status(upstream.status).type('application/json').send(await upstream.text());
    } catch (error) {
      console.error('Lead upstream failed:', error.message);
      res.status(502).json({ error: 'Lead Intelligence service unavailable' });
    }
  };
}

const readers = ['agency_admin', 'marketer', 'viewer'];
const writers = ['agency_admin', 'marketer'];

router.post('/score', audit('c3_lead_score'), authorize(...writers), forward(() => '/leads/score', 'POST'));
for (const endpoint of ['analytics', 'dashboard', 'monitoring', 'history']) {
  router.get('/' + endpoint, audit('c3_lead_' + endpoint), authorize(...readers), forward(() => '/leads/' + endpoint));
}
router.get('/:leadId/recommendation', audit('c3_lead_recommendation'), authorize(...writers),
  forward(req => '/leads/' + encodeURIComponent(req.params.leadId) + '/recommendation'));
router.post('/:leadId/outcome', audit('c3_lead_outcome'), authorize(...writers),
  forward(req => '/leads/' + encodeURIComponent(req.params.leadId) + '/outcome', 'POST'));
// C3 FR10: output history of one lead (scores, advice, outcomes) - read-only
router.get('/:leadId/history', audit('c3_lead_history'), authorize(...readers),
  forward(req => '/leads/' + encodeURIComponent(req.params.leadId) + '/history'));

module.exports = router;
