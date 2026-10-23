'use strict';
function applicationOrigin(req) {
  const origins = (process.env.CLIENT_ORIGINS || 'http://localhost:5173').split(',').map(value=>value.trim()).filter(Boolean);
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const value = configured || (origins.includes(req.get('origin')) ? req.get('origin') : origins[0]);
  const origin = new URL(value);
  if(!['http:','https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash) throw new Error('Configure PUBLIC_APP_URL as an application origin.');
  return origin.origin;
}
module.exports={applicationOrigin};
