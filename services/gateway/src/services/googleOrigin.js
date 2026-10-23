'use strict';
function googleOrigin(){
  const configured=process.env.GOOGLE_SIGNIN_ORIGIN?.trim();
  if(!configured)return '';
  const url=new URL(configured);
  const allowed=(process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value=>value.trim());
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname!=='/' || url.search || url.hash || !allowed.includes(url.origin))throw new Error('GOOGLE_SIGNIN_ORIGIN must be an allowed frontend origin.');
  return url.origin;
}
module.exports={googleOrigin};
