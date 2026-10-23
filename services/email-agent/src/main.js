'use strict';
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const express = require('express');
const helmet = require('helmet');
const authenticate = require('./middleware/auth');
const { requestProtection } = require('./services/session');
const { requirePermission } = require('./policies/rbac');
if (!process.env.DB_PASSWORD || Buffer.byteLength(process.env.JWT_SECRET || '') < 32) {
  throw new Error('Set DB_PASSWORD and an independent JWT_SECRET of at least 32 bytes.');
}
const app = express();
app.use(helmet());
app.use('/api/training-worker',express.json({limit:'2mb'}));
app.use(express.json({ limit: '300kb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'c4-email-agent' }));
app.use('/api', requestProtection);
app.use('/api/training-worker',require('./middleware/gatewayIdentity'),authenticate,require('./api/fineTuneWorkerRoutes'));
app.use('/api/auth', require('./api/authRoutes'));
app.use('/api/team', require('./api/teamRoutes'));
app.use('/api/email', require('./middleware/gatewayIdentity'));
app.use('/api/email/finetuning',authenticate,require('./api/fineTuneRoutes').router);
app.use('/api/email', authenticate, require('./api/learningRoutes'));
app.use('/api/email/sequence', authenticate, requirePermission('email:generate'), require('./api/generationRoutes'));
app.use('/api/email/sequences', authenticate, requirePermission('email:generate'), require('./api/sequenceRoutes'));
app.use('/api/email', authenticate, require('./api/workspaceRoutes'));
app.use((_req, res) => res.status(404).json({ error: 'Email Agent endpoint not found.' }));
app.use((error, _req, res, _next) => {
  console.error('Email Agent request failed:', error.code || error.name);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request contains invalid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (error.status === 404) return res.status(404).json({ error: 'Resource not found.' });
  res.status(503).json({ error: 'The Email Agent is temporarily unavailable. Please try again.' });
});
if (require.main === module) {
  const server = app.listen(Number(process.env.PORT || 4001), process.env.HOST || '127.0.0.1', () => console.log('Email Agent is listening.'));
  const stop = () => server.close(() => require('./config/db').end().finally(() => process.exit(0)));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
module.exports = app;
