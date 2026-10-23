'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { directory } = require('../../src/services/serviceDirectory');

async function fixture(t, healthStatus, health, pageStatus = 200, html = '<!doctype html><html>Service</html>') {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(healthStatus, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(health)); }
    else { res.writeHead(pageStatus, { 'Content-Type': 'text/html' }); res.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const keys = ['EMAIL_AGENT', 'LEAD_INTEL', 'STRATEGY_FL', 'CONTENT_AGENT'].map(name => name + '_INTERNAL_URL');
  const previous = keys.map(key => process.env[key]);
  for (const key of keys) process.env[key] = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
}
test('a running scaffold is unavailable despite returning a root HTML page', async t => {
  await fixture(t, 503, { status: 'not_implemented', ready: false });
  const services = await directory({ role: 'agency_admin' });
  assert.equal(services.length, 4);
  assert.ok(services.every(service => !service.available && service.reason === 'not_implemented'));
});
test('healthy APIs do not need to serve a separate UI', async t => {
  await fixture(t, 200, { status: 'ok' }, 404);
  assert.ok((await directory({ role: 'agency_admin' })).every(service => service.available));
});
test('the teammate FastAPI health contract reports availability with ok=true',async t=>{
 await fixture(t,200,{ok:true,model_version:'fixture-only'});
 assert.ok((await directory({role:'agency_admin'})).every(service=>service.available));
});
test('a healthy service with an HTML page is available without disclosing private addresses', async t => {
  await fixture(t, 200, { status: 'ok' });
  const services = await directory({ role: 'agency_admin' });
  assert.ok(services.every(service => service.available));
  assert.ok(services.every(service => !('internal' in service) && !('internal_url' in service)));
});
test('the service directory preserves role restrictions', async t => {
  await fixture(t, 200, { status: 'ok' });
  const services = await directory({ role: 'viewer' });
  assert.equal(services.length, 3);
  assert.ok(services.every(service => service.id !== 'email-agent'));
  assert.deepEqual(await directory({ role: 'unrecognized' }), []);
});
test('unreachable services return unavailable instead of rejecting the directory request', async t => {
  await fixture(t, 200, { status: 'ok' });
  process.env.EMAIL_AGENT_INTERNAL_URL = 'http://127.0.0.1:1';
  const email = (await directory({ role: 'agency_admin' })).find(service => service.id === 'email-agent');
  assert.equal(email.available, false);
  assert.equal(email.reason, 'offline');
});
