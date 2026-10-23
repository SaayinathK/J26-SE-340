'use strict';
// Dependency-free production server. The browser has one API origin: /api -> gateway.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../dist');
const gateway = new URL(process.env.GATEWAY_URL || 'http://gateway:4000');
if (!['http:', 'https:'].includes(gateway.protocol) || gateway.pathname !== '/' || gateway.username || gateway.password || gateway.search || gateway.hash) throw new Error('GATEWAY_URL must be an HTTP(S) origin');
const html = fs.readFileSync(path.join(root, 'index.html'));
const hashes = [...html.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
const policy = "default-src 'self'; script-src 'self' https://accounts.google.com " + hashes.join(' ') + "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; img-src 'self' data: https://lh3.googleusercontent.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', policy);
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"status":"ok","service":"frontend"}'); }
  // Keep the original origin/cookie/CSRF headers for gateway validation. Never relay
  // a browser-supplied service identity, Host, forwarded or connection headers.
  if (/^\/api(?:\/|\?|$)/.test(req.url)) {
    const headers = { ...req.headers, host: gateway.host };
    for (const name of Object.keys(headers)) if (name.startsWith('x-forwarded-') || ['x-gateway-identity','connection','transfer-encoding','proxy-authorization'].includes(name)) delete headers[name];
    const upstream = (gateway.protocol === 'https:' ? https : http).request({ protocol: gateway.protocol, hostname: gateway.hostname, port: gateway.port, method: req.method, path: req.url, headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.setTimeout(115000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"The gateway is not available. Please try again."}'); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (path.extname(pathname) && pathname !== '/index.html') {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-store' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : html);
});
server.listen(Number(process.env.PORT || 80), process.env.HOST || '0.0.0.0', () => console.log('Frontend listening.'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close());
