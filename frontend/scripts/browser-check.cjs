/* Run against the isolated test environment created by verify-auth.ps1.
 * Requires Playwright via CIFTRON_PLAYWRIGHT_PATH or an installed playwright package.
 */
const { chromium } = require(process.env.CIFTRON_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  if (process.env.CIFTRON_AUTH_TEST_DATABASE !== 'isolated') throw new Error('Use scripts/verify-auth.ps1: this check creates accounts and must run against an isolated test database.');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.CIFTRON_BASE_URL || 'http://127.0.0.1:5175';
  const evidence = path.resolve(__dirname, '../.local/screenshots');
  const suffix = crypto.randomBytes(5).toString('hex');
  const adminEmail = 'browser-admin-' + suffix + '@example.com';
  const viewerEmail = 'browser-viewer-' + suffix + '@example.com';
  const password = 'SecureBrowserPass123!';
  await fs.mkdir(evidence, { recursive: true });
  try {
    await page.goto(base + '/#overview');
    await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.getByRole('link', { name: 'Team & access', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(evidence, 'sign-in-light.png'), fullPage: true });
    await page.getByRole('link', { name: 'Create an account', exact: true }).click();
    await page.getByRole('heading', { name: 'Create your account.', exact: true }).waitFor();
    await page.getByLabel('Full name', { exact: true }).fill('Alex Browser');
    await page.getByLabel('Workspace name', { exact: true }).fill('Browser Studio');
    await page.getByLabel('Work email', { exact: true }).fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill('DifferentPassword123');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Your passwords do not match.' }).waitFor();
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.screenshot({ path: path.join(evidence, 'register-light.png'), fullPage: true });
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();
    const cookies = await context.cookies();
    assert.ok(cookies.find(cookie => cookie.name === 'c4_session' && cookie.httpOnly));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /access.token|refresh.token|jwt/i.test(key))), false);
    await page.screenshot({ path: path.join(evidence, 'authenticated-overview-light.png'), fullPage: true });

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Full name', { exact: true }).fill('Alex Updated');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.locator('.sidebar-user strong').filter({ hasText: 'Alex Updated' }).waitFor();

    await page.getByRole('link', { name: 'Team & access', exact: true }).click();
    await page.getByRole('button', { name: 'Invite member', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill(viewerEmail);
    await page.getByLabel('Workspace role', { exact: true }).selectOption('viewer');
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const invitationInput = page.getByLabel('Single-use invitation link', { exact: true });
    await invitationInput.waitFor();
    const invitation = await invitationInput.inputValue();
    await page.keyboard.press('Escape');
    const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const viewer = await viewerContext.newPage();
    viewer.on('pageerror', error => errors.push(error.message));
    await viewer.goto(invitation);
    await viewer.getByRole('heading', { name: 'Join your workspace.', exact: true }).waitFor();
    assert.equal(await viewer.getByLabel('Workspace name', { exact: true }).count(), 0);
    await viewer.getByLabel('Full name', { exact: true }).fill('Viewer Member');
    await viewer.getByLabel('Work email', { exact: true }).fill(viewerEmail);
    await viewer.getByLabel('Password', { exact: true }).fill(password);
    await viewer.getByLabel('Confirm password', { exact: true }).fill(password);
    await viewer.getByRole('button', { name: 'Join workspace', exact: true }).click();
    await viewer.getByRole('heading', { name: 'Good things are growing, Viewer', exact: true }).waitFor();
    assert.equal(await viewer.getByRole('link', { name: 'Email Agent', exact: true }).count(), 0);
    assert.equal(await viewer.getByRole('link', { name: 'Team & access', exact: true }).count(), 0);
    assert.equal(await viewer.getByRole('button', { name: 'New campaign', exact: true }).first().isDisabled(), true);
    assert.equal((await viewerContext.request.get(base + '/api/team')).status(), 403);
    await viewer.goto(base + '/#team');
    await viewer.getByRole('heading', { name: 'This area needs a different role', exact: true }).waitFor();

    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const role = page.getByLabel('Role for Viewer Member', { exact: true });
    await role.waitFor();
    await Promise.all([page.waitForResponse(response => response.url().includes('/api/team/') && response.request().method() === 'PATCH' && response.status() === 200), role.selectOption('marketer')]);
    await page.getByRole('status').filter({ hasText: 'Member access updated' }).waitFor();
    await viewer.evaluate(() => window.dispatchEvent(new Event('focus')));
    await viewer.getByRole('link', { name: 'Email Agent', exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'live-team-access.png'), fullPage: true });
    await Promise.all([page.waitForResponse(response => response.url().includes('/api/team/') && response.request().method() === 'PATCH' && response.status() === 200), role.selectOption('viewer')]);
    await page.getByRole('status').filter({ hasText: 'Member access updated' }).waitFor();
    await viewer.evaluate(() => window.dispatchEvent(new Event('focus')));
    await viewer.getByRole('link', { name: 'Email Agent', exact: true }).waitFor({ state: 'detached' });

    await page.getByRole('link', { name: 'Email Agent', exact: true }).click();
    assert.equal(await page.getByRole('link', { name: 'Email Agent', exact: true }).getAttribute('aria-current'), 'page');
    // Live embedding and unavailable states are covered by verify-service-flow.cjs.
    await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
    const observer = await context.newPage();
    await observer.goto(base + '/#campaigns');
    await observer.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor();
    await page.getByRole('button', { name: 'New campaign', exact: true }).first().click();
    await page.getByLabel('Campaign name', { exact: true }).fill('Live database campaign');
    await page.getByLabel('Audience segment', { exact: true }).fill('Our subscribers');
    await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await page.getByRole('button', { name: 'Live database campaign Our subscribers', exact: true }).waitFor();
    await observer.getByRole('button', { name: 'Live database campaign Our subscribers', exact: true }).waitFor({ timeout: 12000 });
    await observer.reload();
    await observer.getByRole('button', { name: 'Live database campaign Our subscribers', exact: true }).waitFor();
    await observer.close();
    await page.getByRole('link', { name: 'Knowledge base', exact: true }).click();
    await page.getByRole('button', { name: 'Add knowledge', exact: true }).click();
    await page.getByLabel('Source name', { exact: true }).fill('Verified business facts');
    await page.getByLabel('What should your agent know?', { exact: true }).fill('We provide accessible website design and ongoing support.');
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await page.getByRole('button', { name: /^Verified business facts/ }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: /^Verified business facts/ }).waitFor();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /marketing-previews/.test(key))), false);

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    await page.getByRole('switch', { name: 'Interface animations', exact: true }).click();
    await page.reload();
    await page.getByRole('heading', { name: 'Make yourself at home.', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
    assert.equal(await page.getByRole('switch', { name: 'Interface animations', exact: true }).getAttribute('aria-checked'), 'false');
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'authenticated-overview-dark.png'), fullPage: true });

    const sessionBeforeLogout = (await context.cookies()).find(cookie => cookie.name === 'c4_session').value;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'sign-in-dark.png'), fullPage: true });
    const fresh = await browser.newContext();
    assert.equal((await fresh.request.get(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + sessionBeforeLogout } })).status(), 401);
    await fresh.close();
    await page.getByLabel('Work email', { exact: true }).fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill('WrongPassword123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' }).waitFor();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Good things are growing, Alex', exact: true }).waitFor();

    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ['overview', 'email-agent', 'campaigns', 'knowledge', 'integrations', 'team', 'monitoring', 'settings']) {
        await page.goto(base + '/#' + route);
        await page.locator('main').waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, route + ' must fit ' + width + 'px');
      }
      const anonymous = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const login = await anonymous.newPage();
      for (const route of ['sign-in', 'register']) {
        await login.goto(base + '/#' + route);
        await login.locator('.signin-form').waitFor();
        await login.evaluate(() => document.fonts.ready);
        assert.equal(await login.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, route + ' must fit ' + width + 'px');
        if (width === 390) await login.screenshot({ path: path.join(evidence, route + '-mobile.png'), fullPage: true });
      }
      await anonymous.close();
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: real registration, cookie session restoration, profile save, invitation acceptance, live role changes, viewer restrictions, server RBAC, independent Email Agent link, cross-tab campaign refresh, persistent knowledge, no marketing browser storage, logout revocation, login errors, black theme and motion persistence, responsive authenticated/login/register pages at 320/390/768px.');
    console.log('Screenshots: ' + evidence);
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, 'account-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
