
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const express = require('express');
const helmet = require('helmet');
const authenticate = require('./middleware/auth');
const authorize = require('./middleware/authorize');
const audit = require('./middleware/audit');
const { requestProtection, withTenant, identity } = require('./services/session');
const { requirePermission } = require('./policies/rbac');
if (!process.env.JWT_SECRET || !process.env.DB_PASSWORD) throw new Error('Missing required environment variables');
const app = express();
app.use(helmet());
app.use('/api/training-worker',express.json({limit:'2mb'}));
app.use(express.json({ limit: '300kb' }));
app.use('/api', require('express-rate-limit').rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api', requestProtection);
app.use('/api/training-worker',require('./routes/trainingWorkerRoutes'));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'c4-gateway' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/team', require('./routes/teamRoutes'));
app.use('/api/platform', authenticate, require('./routes/platformRoutes'));
app.use('/api/services', authenticate, require('./routes/serviceRoutes'));
for (const service of [
  { path: 'email', id: 'email-agent', setting: 'EMAIL_AGENT', port: 4001 },
  { path: 'content', id: 'content-agent', setting: 'CONTENT_AGENT', port: 4002 },
  { path: 'lead-intel', id: 'lead-intel', setting: 'LEAD_INTEL', port: 4003 },
  { path: 'strategy', id: 'strategy-fl', setting: 'STRATEGY_FL', port: 4004 },
]) app.use('/api/' + service.path, authenticate, require('./routes/agentRoutes')(service));
app.get('/api/tenant/context', authenticate, (req, res) => res.json({ tenant_id: req.user.tenant_id, role: req.user.role, workspace: identity(req.user).workspace }));
app.patch('/api/tenant/profile', authenticate, requirePermission('workspace:manage'), audit('workspace_profile'), async (req, res) => {
  const { name, domain } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof domain !== 'string' || domain.length > 253 || (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))) return res.status(400).json({ error: 'Enter a valid workspace name and business domain.' });
  await withTenant(req.user.tenant_id, client => client.query('UPDATE tenants SET name = $1, domain = $2 WHERE tenant_id = $3', [name.trim(), domain.toLowerCase(), req.user.tenant_id]));
  res.json({ message: 'Workspace profile updated.' });
});
app.get('/api/admin/dashboard', authenticate, audit('admin_dashboard_access'), authorize('agency_admin'), (req, res) => res.json({ message: 'Admin access granted', role: req.user.role }));
app.get('/api/campaigns/manage', authenticate, audit('campaign_manage_access'), authorize('agency_admin', 'marketer'), (req, res) => res.json({ message: 'Campaign management access granted', role: req.user.role }));
app.get('/api/campaigns/view', authenticate, audit('campaign_view_access'), authorize('agency_admin', 'marketer', 'viewer'), (req, res) => res.json({ message: 'Campaign viewing access granted', role: req.user.role }));
app.use((_req, res) => res.status(404).json({ error: 'Gateway endpoint not found.' }));
app.use((error, _req, res, _next) => {
  console.error('Gateway request failed:', error.code || error.name);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request contains invalid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (error.status === 404) return res.status(404).json({ error: 'Resource not found.' });
  return res.status(503).json({ error: 'The service is temporarily unavailable. Please try again.' });
});
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';
if (require.main === module) app.listen(PORT, HOST, () => console.log('C4 Gateway listening on ' + HOST + ':' + PORT));
module.exports = app;
