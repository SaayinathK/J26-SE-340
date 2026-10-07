'use strict';
const { permissionsFor } = require('../policies/rbac');

const definitions = [
  { id: 'lead-intel', name: 'Lead Intelligence', icon: 'users', step: 'Understand your audience', description: 'Explore lead insights and identify the people to reach.', port: 4003, permission: 'campaigns:read', setting: 'LEAD_INTEL' },
  { id: 'strategy-fl', name: 'Strategy Agent', icon: 'overview', step: 'Plan your campaign', description: 'Turn business goals into a clear campaign direction.', port: 4004, permission: 'campaigns:read', setting: 'STRATEGY_FL' },
  { id: 'content-agent', name: 'Content Agent', icon: 'file', step: 'Create your content', description: 'Develop content that carries your campaign message.', port: 4002, permission: 'campaigns:read', setting: 'CONTENT_AGENT' },
  { id: 'email-agent', name: 'Email Agent', icon: 'sparkles', step: 'Build your email journey', description: 'Write, generate and review email sequences using your business knowledge.', port: 4001, permission: 'email:generate', setting: 'EMAIL_AGENT' },
];
const cache = new Map();

function endpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Service URLs must be HTTP(S) origins.');
  return url.origin;
}
function configuration(service) {
  return {
    internal: endpoint(process.env[service.setting + '_INTERNAL_URL'] || `http://127.0.0.1:${service.port}`),
  };
}
async function probe(service) {
  let config;
  try { config = configuration(service); } catch { return { available: false, state: 'not_available', reason: 'configuration' }; }
  const key = service.id + config.internal;
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return previous.promise;
  const promise = (async () => {
    try {
      const health = await fetch(config.internal + '/health', { signal: AbortSignal.timeout(2500), redirect: 'error' });
      const body = await health.json();
      if (body.ready === false || body.status === 'not_implemented') return { available: false, state: 'not_available', reason: 'not_implemented' };
      if (!health.ok || !['ok', 'ready', 'healthy'].includes(body.status)) return { available: false, state: 'not_available', reason: 'offline' };
      return { available: true, state: 'available', reason: null };
    } catch { return { available: false, state: 'not_available', reason: 'offline' }; }
  })();
  cache.set(key, { promise, expires: Date.now() + 5000 });
  return promise;
}
async function directory(user) {
  const permissions = permissionsFor(user.role);
  const visible = definitions.filter(service => permissions.includes(service.permission));
  return Promise.all(visible.map(async service => {
    const status = await probe(service);
    return { id: service.id, name: service.name, description: service.description, icon: service.icon, step: service.step, ...status };
  }));
}
module.exports = { directory };
