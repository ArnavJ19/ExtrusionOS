import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('@playwright/test');
const { createServerClient } = require('@supabase/ssr');
let authNetworkCalls = 0;
const anonymous = createServerClient('http://127.0.0.1:65499', 'fixture-only-noncredential', {
  cookies: { getAll: () => [], setAll: () => {} },
  global: { fetch: async () => { authNetworkCalls++; throw new Error('Unexpected anonymous network request'); } },
});
const { data: anonymousAuth, error: anonymousError } = await anonymous.auth.getUser();
assert.equal(anonymousAuth.user, null);
assert.equal(anonymousError?.name, 'AuthSessionMissingError');
assert.equal(authNetworkCalls, 0);
const origin = 'http://127.0.0.1:59473';
const server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '59473'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
server.stdout.on('data', (data) => { boot += data; });
server.stderr.on('data', (data) => { boot += data; });
let browser;
try {
  for (let i = 0; i < 160 && !/Ready in/.test(boot); i++) {
    if (server.exitCode !== null) throw new Error(boot);
    await setTimeout(250);
  }
  assert.match(boot, /Ready in/);
  const signup = await fetch(origin + '/signup', { redirect: 'manual' });
  const scanner = await fetch(origin + '/scan', { redirect: 'manual' });
  const login = await fetch(origin + '/login', { redirect: 'manual' });
  const signupLocation = signup.headers.get('location');
  const scannerLocation = scanner.headers.get('location');
  assert.ok([302, 303, 307, 308].includes(signup.status));
  assert.equal(new URL(signupLocation, origin).pathname, '/login');
  assert.ok([302, 303, 307, 308].includes(scanner.status));
  assert.equal(new URL(scannerLocation, origin).pathname, '/account-unavailable');
  assert.equal(login.status, 200);
  console.log(JSON.stringify({ signup: signup.status, signupLocation, scanner: scanner.status, scannerLocation,
    expectedAnonymousScannerLocation: '/login', anonymousAuthError: anonymousError.name, authNetworkCalls,
    login: login.status, cameraPolicy: login.headers.get('permissions-policy') }));

  browser = await chromium.launch();
  for (const width of [375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 920 } });
    await page.goto(origin + '/login');
    assert.equal(await page.locator('input[type=email]').count(), 1);
    assert.equal(await page.locator('input[type=password]').count(), 1);
    assert.equal(await page.locator('button[type=submit]').isVisible(), true);
    const measured = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(measured.content <= measured.viewport + 1);
    console.log(JSON.stringify({ route: '/login', width, ...measured, emailPasswordAndSubmit: 'present' }));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) server.kill();
}
