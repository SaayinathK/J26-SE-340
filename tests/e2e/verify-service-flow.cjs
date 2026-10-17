'use strict';
// Single web app -> gateway -> Email Agent. All account writes use temporary databases.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const gateway = path.join(root, 'services/gateway');
const frontend = path.join(root, 'frontend');
const email = path.resolve(gateway, '../email-agent');
const { Client } = require(path.join(gateway, 'node_modules/pg'));
const dotenv = require(path.join(gateway, 'node_modules/dotenv'));
const evidence = path.join(root, '.local/e2e');
fs.mkdirSync(evidence, { recursive: true });
function playwrightPath() {
  if (process.env.CIFTRON_PLAYWRIGHT_PATH) return process.env.CIFTRON_PLAYWRIGHT_PATH;
  try { return require.resolve('playwright'); } catch {}
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/.links');
  if (fs.existsSync(links)) for (const file of fs.readdirSync(links)) { const value = fs.readFileSync(path.join(links, file), 'utf8').trim(); if (fs.existsSync(value)) return value; }
  throw new Error('Install Playwright or set CIFTRON_PLAYWRIGHT_PATH.');
}
const { chromium } = require(playwrightPath());
const environments = [gateway, email].map(folder => dotenv.parse(fs.readFileSync(path.join(folder, '.env'))));
const suffix = crypto.randomBytes(6).toString('hex');
const databases = ['c4_flow_verify_' + suffix, 'email_flow_verify_' + suffix];
const ownerConfigs = [gateway, email].map((folder, index) => ({ host: '127.0.0.1', port: 5433 + index, database: 'postgres', user: 'admin', password: dotenv.parse(fs.readFileSync(path.join(folder, 'db/.env'))).POSTGRES_PASSWORD, connectionTimeoutMillis: 10000 }));
const owners = ownerConfigs.map(configuration => new Client(configuration));
const created = [false, false];
const children = [];
let fixture, browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}
function start(folder, environment, name, entry = 'src/main.js') {
  const output = fs.openSync(path.join(evidence, name + '.log'), 'a');
  const child = spawn(process.execPath, [entry], { cwd: folder, windowsHide: true, env: { ...process.env, ...environment }, stdio: ['ignore', output, output] });
  fs.closeSync(output); children.push(child); return child;
}
async function ready(base, child) {
  for (let count = 0; count < 50; count++) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Test server exited: ' + base);
    try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(200);
  }
  throw new Error('Test application did not start: ' + base);
}
async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function register(page, address, workspace) {
  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Alex Flow');
  await page.getByLabel('Workspace name', { exact: true }).fill(workspace);
  await page.getByLabel('Work email', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill('SecureFlowPass123!');
  await page.getByLabel('Confirm password', { exact: true }).fill('SecureFlowPass123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}
(async () => {
  try {
    for (let index = 0; index < owners.length; index++) {
      await owners[index].connect();
      assert.match(databases[index], /^(?:c4|email)_flow_verify_[a-f0-9]{12}$/);
      await owners[index].query('CREATE DATABASE ' + databases[index]); created[index] = true;
      const folder = [gateway, email][index];
      const target = new Client({ ...ownerConfigs[index], database: databases[index] });
      await target.connect();
      try { for (const file of fs.readdirSync(path.join(folder, 'db/migrations')).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await target.query(fs.readFileSync(path.join(folder, 'db/migrations', file), 'utf8')); }
      finally { await target.end(); }
    }
    fixture = http.createServer((_req, res) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'not_implemented', ready: false })); });
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const pending = 'http://127.0.0.1:' + fixture.address().port;
    const gatewayPort = await freePort();
    let emailPort = await freePort();
    while (emailPort === gatewayPort) emailPort = await freePort();
    const frontendPort = await freePort();
    const gatewayBase = 'http://127.0.0.1:' + gatewayPort;
    const emailBase = 'http://127.0.0.1:' + emailPort;
    const frontendBase = 'http://127.0.0.1:' + frontendPort;
    const secret = crypto.randomBytes(48).toString('hex');
    const emailEnvironment = { ...environments[1], AGENT_GATEWAY_SECRET: secret, DB_NAME: databases[1], DB_HOST: '127.0.0.1', DB_PORT: '5434', HOST: '127.0.0.1', PORT: String(emailPort), CLIENT_ORIGINS: frontendBase, OLLAMA_HOST: 'http://127.0.0.1:1', GOOGLE_CLIENT_ID: '' };
    let emailChild = start(email, emailEnvironment, 'email');
    const gatewayChild = start(gateway, { ...environments[0], AGENT_GATEWAY_SECRET: secret, DB_NAME: databases[0], DB_HOST: '127.0.0.1', DB_PORT: '5433', HOST: '127.0.0.1', PORT: String(gatewayPort), CLIENT_ORIGINS: frontendBase, EMAIL_AGENT_INTERNAL_URL: emailBase, CONTENT_AGENT_INTERNAL_URL: pending, LEAD_INTEL_INTERNAL_URL: pending, STRATEGY_FL_INTERNAL_URL: pending, GOOGLE_CLIENT_ID: '' }, 'gateway');
    const frontendChild = start(frontend, { HOST: '127.0.0.1', PORT: String(frontendPort), GATEWAY_URL: gatewayBase }, 'frontend', 'scripts/serve.cjs');
    await Promise.all([ready(gatewayBase, gatewayChild), ready(emailBase, emailChild), ready(frontendBase, frontendChild)]);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], violations = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.exposeBinding('recordCspFailure', (_source, directive) => violations.push(directive));
    await context.addInitScript(() => window.addEventListener('securitypolicyviolation', event => window.recordCspFailure(event.violatedDirective + ':' + event.blockedURI)));
    await page.goto(frontendBase);
    await register(page, 'platform-' + suffix + '@example.com', 'Flow Platform');
    await page.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Services', exact: true }).click();
    await page.getByRole('heading', { name: 'One place for your next campaign.', exact: true }).waitFor();
    await page.locator('.service-card').filter({ hasText: 'Email Agent' }).getByText('Available', { exact: true }).waitFor();
    assert.equal(await page.locator('.service-card').count(), 4);
    await page.screenshot({ path: path.join(evidence, 'services.png'), fullPage: true });
    for (const name of ['Content Agent', 'Strategy Agent', 'Lead Intelligence']) {
      await page.getByRole('link', { name, exact: true }).click();
      await page.getByRole('heading', { name: name + ' is not available', exact: true }).waitFor();
    }
    await page.screenshot({ path: path.join(evidence, 'not-available.png'), fullPage: true });
    await page.goto(frontendBase + '/#unknown-page');
    await page.getByRole('heading', { name: 'This page is not available', exact: true }).waitFor();
    await page.goto(frontendBase + '/missing-page');
    await page.getByRole('heading', { name: 'This page is not available', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to services', exact: true }).click();
    await page.getByRole('heading', { name: 'One place for your next campaign.', exact: true }).waitFor();
    await page.getByRole('link', { name: /^Email Agent/ }).click();
    const frame = page;
    await page.getByRole('heading', { name: 'Your ideas. Beautifully delivered.', exact: true }).waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'All services', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Open separately', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Manage knowledge', exact: true }).click();
    await page.getByRole('heading', { name: 'Your business, understood.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to sequences', exact: true }).click();
    await frame.getByText('AI generation is not available', { exact: true }).waitFor();
    assert.equal(await frame.getByRole('button', { name: 'Generate with AI', exact: true }).isDisabled(), true);
    await frame.getByRole('button', { name: 'Write manually', exact: true }).click();
    await frame.locator('textarea[maxlength="500"]').fill('A connected email journey');
    await frame.getByLabel('Who are we talking to?', { exact: true }).fill('Subscribers');
    for (let index = 0; index < 3; index++) {
      await frame.getByRole('tab', { name: new RegExp('^' + (index + 1)) }).click();
      await frame.getByLabel('Email subject', { exact: true }).fill('Introduction ' + (index + 1));
      await frame.getByLabel('Email message', { exact: true }).fill('Hello {{first_name}},\n\nTell us about your goals.\n\nTo unsubscribe from these emails, reply STOP or click here.');
    }
    await frame.getByRole('button', { name: 'Save sequence', exact: true }).click();
    await frame.getByText('Sequence saved to your workspace.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await frame.locator('html[data-theme="dark"]').waitFor();
    await page.screenshot({ path: path.join(evidence, 'email-connected.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await frame.locator('html').evaluate(element => element.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(evidence, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.reload();
    await page.getByRole('tab', { name: /Saved sequences/ }).click();
    await page.getByRole('heading', { name: 'A connected email journey', exact: true }).waitFor();
    await stop(emailChild);
    await delay(5200);
    await page.getByRole('link', { name: 'Services', exact: true }).click();
    await page.getByRole('button', { name: 'Check availability', exact: true }).click();
    await page.locator('.service-card').filter({ hasText: 'Email Agent' }).getByText('Not available', { exact: true }).waitFor();
    await page.getByRole('link', { name: /^Email Agent/ }).click();
    await page.getByRole('heading', { name: 'Email Agent is not available', exact: true }).waitFor();
    emailChild = start(email, emailEnvironment, 'email-restarted');
    await ready(emailBase); await delay(5200);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('heading', { name: 'Your ideas. Beautifully delivered.', exact: true }).waitFor();
    // Direct APIs cannot accept a browser-provided user/tenant identity.
    assert.equal((await fetch(emailBase + '/api/email/snapshot')).status, 401);
    assert.equal((await fetch(emailBase + '/api/email/snapshot', {headers:{'X-Gateway-Identity':'forged'}})).status, 401);
    const savedSnapshot = await context.request.get(frontendBase + '/api/email/snapshot');
    const savedSequence = (await savedSnapshot.json()).sequences[0];
    assert.ok(savedSequence);
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await other.goto(frontendBase);
    await register(other, 'other-' + suffix + '@example.com', 'Other Workspace');
    await other.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();
    const isolated = await otherContext.request.get(frontendBase + '/api/email/snapshot');
    assert.equal(isolated.status(), 200);
    assert.deepEqual((await isolated.json()).sequences, []);
    assert.equal((await otherContext.request.get(frontendBase + '/api/email/sequences/' + savedSequence.id)).status(), 404);
    assert.equal((await context.cookies()).some(cookie=>cookie.name.startsWith('email_agent_')), false);
    await otherContext.close();
    assert.deepEqual(errors, []); assert.deepEqual(violations, []);
    console.log('PASS: one frontend, gateway-only API access, single sign-in, unavailable pages, knowledge navigation, draft persistence, tenant isolation, spoofed identity rejection, mobile layout, theme and outage recovery. No CSP violations.');
  } finally {
    if (browser) await browser.close();
    for (const child of children) await stop(child);
    if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
    for (let index = 0; index < owners.length; index++) {
      if (created[index] && /^(?:c4|email)_flow_verify_[a-f0-9]{12}$/.test(databases[index])) await owners[index].query('DROP DATABASE ' + databases[index] + ' WITH (FORCE)');
      await owners[index].end();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
