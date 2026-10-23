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
let fixture, browser, mailCatcher;
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
  await page.goto(new URL('/#register', page.url()).href);
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
    const agentFixture=process.argv.includes('--agent-ui-only')?require('./fixtures/agent-services.cjs').create():null;
    fixture = http.createServer((req, res) => {
      if(agentFixture?.handle(req,res))return;
      req.resume();
      if (req.url === '/api/tags') { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({models:[{name:'c4-09-replay'}]})); }
      if (req.url === '/api/show' && process.argv.includes('--finetune-only')) { res.writeHead(200,{'Content-Type':'application/json'}); return res.end('{}'); }
      if (req.url === '/api/generate') { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({response:JSON.stringify({emails:require('./guardrail-review.cjs').replayEmails})})); }
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'not_implemented', ready: false }));
    });
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
    const emailEnvironment = { ...environments[1], AGENT_GATEWAY_SECRET: secret, DB_NAME: databases[1], DB_HOST: '127.0.0.1', DB_PORT: '5434', HOST: '127.0.0.1', PORT: String(emailPort), CLIENT_ORIGINS: frontendBase, OLLAMA_HOST: process.argv.includes('--finetune-only') ? pending : 'http://127.0.0.1:1', GOOGLE_CLIENT_ID: '' };
    let emailChild = start(email, emailEnvironment, 'email');
    const invitationOnly = process.argv.includes('--invitation-only');
    const googleOnly = process.argv.includes('--google-only');
    const rbacOnly = process.argv.includes('--rbac-only');
    const googleSecret=crypto.randomBytes(32).toString('hex');
    if (invitationOnly) mailCatcher = await require('../../services/gateway/tests/helpers/smtp.cjs').createMailCatcher();
    const invitationEnvironment = invitationOnly ? {INVITATION_MAIL_DISABLED:'false',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(mailCatcher.port),SMTP_FROM:'invite@example.test',SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'false',SMTP_USER:'',SMTP_PASS:'',PUBLIC_APP_URL:''} : {INVITATION_MAIL_DISABLED:'true'};
    const googleEnvironment=googleOnly?{GOOGLE_SIGNIN_ORIGIN:'',GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com',CIFTRON_GOOGLE_FIXTURE_SECRET:googleSecret,NODE_OPTIONS:'--require="'+path.join(root,'tests/e2e/fixtures/google-provider.cjs').replaceAll('\\','/')+'"'}:{GOOGLE_CLIENT_ID:'',...(agentFixture?{CONTENT_AGENT_JWT_SECRET:agentFixture.secret}:{})};
    const gatewayChild = start(gateway, { ...environments[0], ...invitationEnvironment, AGENT_GATEWAY_SECRET: secret, DB_NAME: databases[0], DB_HOST: '127.0.0.1', DB_PORT: '5433', HOST: '127.0.0.1', PORT: String(gatewayPort), CLIENT_ORIGINS: frontendBase, EMAIL_AGENT_INTERNAL_URL: emailBase, CONTENT_AGENT_INTERNAL_URL: pending, LEAD_INTEL_INTERNAL_URL: pending, STRATEGY_FL_INTERNAL_URL: pending, ...googleEnvironment }, 'gateway');
    const frontendChild = start(frontend, { HOST: '127.0.0.1', PORT: String(frontendPort), GATEWAY_URL: gatewayBase }, 'frontend', 'scripts/serve.cjs');
    await Promise.all([ready(gatewayBase, gatewayChild), ready(emailBase, emailChild), ready(frontendBase, frontendChild)]);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    if(googleOnly)await require('./google-flow.cjs').install(context);
    const page = await context.newPage();
    const errors = [], violations = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.exposeBinding('recordCspFailure', (_source, directive) => violations.push(directive));
    await context.addInitScript(() => window.addEventListener('securitypolicyviolation', event => window.recordCspFailure(event.violatedDirective + ':' + event.blockedURI)));
    await page.goto(frontendBase);
    await register(page, 'platform-' + suffix + '@example.com', 'Flow Platform');
    await page.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();
    if (invitationOnly) {
      await require('./invitation-flow.cjs').verify({browser,page,context,base:frontendBase,mailCatcher,suffix,evidence});
    } else if(googleOnly){
      await require('./google-flow.cjs').verify({page,context,base:frontendBase,secret:googleSecret,email:'platform-'+suffix+'@example.com',evidence});
    } else if(rbacOnly){
      await require('./rbac-flow.cjs').verify({browser,page,context,base:frontendBase,suffix,evidence,emailDatabase:{...ownerConfigs[1],database:databases[1]}});
    } else if(process.argv.includes('--finetune-only')){
      await require('./finetuning-flow.cjs').verify({browser,page,context,base:frontendBase,suffix,evidence,emailDatabase:{...ownerConfigs[1],database:databases[1]}});
    } else if(agentFixture){
      await require('./agent-ui-flow.cjs').verify({browser,page,context,base:frontendBase,suffix,evidence,requests:agentFixture.requests});
    } else {
    if (!process.argv.includes('--guardrail-only')) {
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'From audience insights to your next campaign.', exact: true }).waitFor();
    await page.locator('.service-card').filter({ hasText: 'Email Agent' }).getByText('Engine connected', { exact: true }).waitFor();
    assert.equal(await page.locator('.service-card').count(), 4);
    await page.screenshot({ path: path.join(evidence, 'services.png'), fullPage: true });
    await page.getByRole('button', { name: 'AI agents', exact: true }).click();
    for (const name of ['Content Agent', 'Strategy Agent', 'Lead Intelligence']) {
      await page.getByRole('link', { name, exact: true }).click();
      await page.getByRole('heading', { name: { 'Content Agent':'Content studio', 'Strategy Agent':'Strategy planning', 'Lead Intelligence':'Lead intelligence' }[name], exact: true }).waitFor();
    }
    await page.screenshot({ path: path.join(evidence, 'not-available.png'), fullPage: true });
    await page.goto(frontendBase + '/#unknown-page');
    await page.getByRole('heading', { name: 'This page is not available', exact: true }).waitFor();
    await page.goto(frontendBase + '/missing-page');
    await page.getByRole('heading', { name: 'This page is not available', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'From audience insights to your next campaign.', exact: true }).waitFor();
    if (await page.getByRole('button', { name: 'AI agents', exact: true }).getAttribute('aria-expanded') === 'false') await page.getByRole('button', { name: 'AI agents', exact: true }).click();
    await page.getByRole('link', { name: /^Email Agent/ }).click();
    const frame = page;
    await page.getByRole('heading', { name: 'Email studio.', exact: true }).waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'All services', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Open separately', exact: true }).count(), 0);
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
    await page.getByRole('heading', { name: 'Your business, understood.', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: 'Sequence builder', exact: true }).click();
    await frame.getByText('AI writing offline · manual editing available', { exact: true }).waitFor();
    assert.equal(await frame.getByRole('button', { name: 'Generate with AI', exact: true }).isDisabled(), true);
    await frame.getByRole('button', { name: 'Write manually', exact: true }).click();
    await frame.locator('textarea[maxlength="500"]').fill('A connected email journey');
    await frame.getByLabel('Audience', { exact: true }).fill('Subscribers');
    for (let index = 0; index < 3; index++) {
      await frame.getByRole('tab', { name: new RegExp('^' + (index + 1)) }).click();
      await frame.getByLabel('Email subject', { exact: true }).fill('Introduction ' + (index + 1));
      await frame.getByLabel('Email message', { exact: true }).fill('Hello {{first_name}},\n\nTell us about your goals.\n\nTo unsubscribe from these emails, reply STOP or click here.');
    }
    await frame.getByRole('button', { name: 'Save sequence', exact: true }).click();
    await frame.getByText('Your sequence is saved.', { exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Review sequence', exact: true }).click();
    await frame.getByLabel('Feedback note', { exact: true }).pressSequentially('Clear message and a useful next step.');
    await frame.getByRole('button', { name: 'Save review', exact: true }).click();
    await frame.getByText('Your review has been recorded for this sequence version.', { exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Preview', exact: true }).click();
    await frame.getByLabel('Preview first name', { exact: true }).fill('Sam');
    await frame.getByText('Hello Sam,', { exact: false }).waitFor();
    await frame.getByRole('button', { name: 'Write', exact: true }).click();
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: 'Performance', exact: true }).click();
    await frame.getByRole('button', { name: 'Record outcomes', exact: true }).click();
    await frame.getByLabel('Delivered', { exact: true }).fill('100');
    await frame.getByLabel('Opened', { exact: true }).fill('35');
    await frame.getByLabel('Clicked', { exact: true }).fill('12');
    await frame.getByLabel('Replied', { exact: true }).fill('3');
    await frame.getByRole('button', { name: 'Save outcomes', exact: true }).click();
    await frame.getByText('Measured outcomes saved. Eligible continuous-learning updates have been evaluated.', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: 'Learning center', exact: true }).click();
    await frame.getByRole('checkbox', { name: /^Use aggregate outcomes for learning/ }).check();
    await frame.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await frame.getByText('Learning preferences updated.', { exact: true }).waitFor();
    assert.equal(await frame.getByRole('button', { name: 'Train & evaluate', exact: true }).isDisabled(), true);
    await page.screenshot({ path: path.join(evidence, 'email-learning.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: 'Integrations', exact: true }).click();
    await frame.locator('.studio-integration-card').filter({ hasText: 'GoHighLevel CRM' }).getByRole('button', { name: 'Set up connection', exact: true }).click();
    await frame.getByLabel('GoHighLevel location ID', { exact: true }).pressSequentially('location-test-123');
    await frame.getByRole('button', { name: 'Save connection preferences', exact: true }).click();
    await frame.getByText('location-test-123', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: 'Sequence builder', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await frame.locator('html[data-theme="dark"]').waitFor();
    await page.screenshot({ path: path.join(evidence, 'email-connected.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await frame.locator('html').evaluate(element => element.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(evidence, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    await page.screenshot({ path: path.join(evidence, 'email-studio-light.png'), fullPage: true });
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true, 'Studio overflow at ' + width);
      for (const name of ['Overview','Sequence builder','Library','Knowledge','Performance','Learning center','Integrations']) {
        await page.getByRole('navigation', { name:'Email studio pages' }).getByRole('button', { name: name === 'Library' ? /^Library/ : name, exact:name !== 'Library' }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true, name + ' overflow at ' + width);
      }
    }
    await page.setViewportSize({ width:1440,height:1100 });
    await page.reload();
    await page.getByRole('navigation', { name: 'Email studio pages' }).getByRole('button', { name: /^Library/ }).click();
    await page.getByRole('heading', { name: 'A connected email journey', exact: true }).waitFor();
    await stop(emailChild);
    await delay(5200);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Check availability', exact: true }).click();
    await page.locator('.service-card').filter({ hasText: 'Email Agent' }).getByText('Not available', { exact: true }).waitFor();
    if (await page.getByRole('button', { name: 'AI agents', exact: true }).getAttribute('aria-expanded') === 'false') await page.getByRole('button', { name: 'AI agents', exact: true }).click();
    await page.getByRole('link', { name: /^Email Agent/ }).click();
    await page.getByRole('heading', { name: 'Email Agent is not available', exact: true }).waitFor();
    emailChild = start(email, emailEnvironment, 'email-restarted');
    await ready(emailBase); await delay(5200);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('heading', { name: 'Email studio.', exact: true }).waitFor();
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
    }
    await stop(emailChild);
    emailChild = start(email,{...emailEnvironment,OLLAMA_HOST:pending,OLLAMA_MODEL:'c4-09-replay'},'email-guardrail-replay');
    await ready(emailBase,emailChild);
    await require('./guardrail-review.cjs').verify({page,context,base:frontendBase,output:path.join(root,'docs/evidence/c4-09')});
    }
    assert.deepEqual(errors, []); assert.deepEqual(violations, []);
    if (!invitationOnly && !googleOnly && !rbacOnly && !agentFixture && !process.argv.includes('--finetune-only') && !process.argv.includes('--guardrail-only')) console.log('PASS: one frontend, gateway-only API access, single sign-in, unavailable pages, knowledge navigation, draft persistence, tenant isolation, spoofed identity rejection, mobile layout, theme and outage recovery. No CSP violations.');
  } finally {
    if (browser) await browser.close();
    for (const child of children) await stop(child);
    if (mailCatcher) await mailCatcher.close();
    if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
    for (let index = 0; index < owners.length; index++) {
      if (created[index] && /^(?:c4|email)_flow_verify_[a-f0-9]{12}$/.test(databases[index])) await owners[index].query('DROP DATABASE ' + databases[index] + ' WITH (FORCE)');
      await owners[index].end();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
