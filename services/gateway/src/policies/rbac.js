'use strict';
const policy = Object.freeze({
  agency_admin: ['campaigns:read', 'campaigns:write', 'email:generate', 'knowledge:read', 'knowledge:write', 'team:manage', 'monitoring:read', 'workspace:manage'],
  marketer: ['campaigns:read', 'campaigns:write', 'email:generate', 'knowledge:read'],
  viewer: ['campaigns:read'],
});
function permissionsFor(role) { return [...(policy[role] || [])]; }
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!permissionsFor(req.user.role).includes(permission)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}
module.exports = { permissionsFor, requirePermission };
