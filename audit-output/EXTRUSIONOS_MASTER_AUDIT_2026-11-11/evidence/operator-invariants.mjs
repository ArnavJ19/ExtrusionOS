import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
if (process.argv.includes('--camera')) {
  const { chromium } = require('@playwright/test');
  const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
  const policy = config.match(/key: "Permissions-Policy", value: "([^"]+)"/)[1];
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const browserContext = await browser.newContext({ permissions: ['camera'] });
    const page = await browserContext.newPage();
    for (const [route, value] of [['/control', 'camera=(self)'], ['/policy', policy]]) {
      await page.route('http://127.0.0.1:65505' + route, (handler) => handler.fulfill({
        contentType: 'text/html', headers: { 'Permissions-Policy': value }, body: '<title>Camera control fixture</title>'
      }));
    }
    async function probe(path) {
      await page.goto('http://127.0.0.1:65505' + path);
      return page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          const tracks = stream.getVideoTracks();
          tracks.forEach((track) => track.stop());
          return { allowed: true, tracks: tracks.length };
        } catch (error) {
          return { allowed: false, reason: error.name };
        }
      });
    }
    const control = await probe('/control');
    const fromConfig = await probe('/policy');
    assert.equal(control.allowed, true, 'Synthetic camera must work with the control policy');
    assert.equal(fromConfig.allowed, false);
    console.log(JSON.stringify({ id: 'MFA-009', policy, control, fromConfig, reproduced: true }));
  } finally {
    await browser.close();
  }
} else {
  const { createPressFixture } = await import(pathToFileURL(join(root, 'scripts/lib/autopilot-batch2-fixture.mjs')).href);
  const f = await createPressFixture();
  const { db, ids } = f;
  await f.start();
  try {
    // Seed the partial-issue state only. The public completion call uses active guards and the operator role.
    await db.exec("set session_replication_role = replica");
    await db.query("update public.foundry_billets set status='allocated' where id=any($1)", [ids.billets.slice(1)]);
    await db.exec("set session_replication_role = origin");
    let response;
    try {
      response = await f.asUser("select public.complete_production_job_atomic($1,57,10,60,3,'Audit partial issue')", [ids.jobA], ids.production);
    } catch (error) {
      response = { code: error.code, message: error.message };
    }
    const input = await f.one("select sum(weight_kg) filter(where status='issued') as issued_kg,sum(weight_kg) filter(where status='allocated') as only_allocated_kg from public.foundry_billets where production_job_id=$1", [ids.jobA]);
    const job = await f.one("select status from public.production_jobs where id=$1", [ids.jobA]);
    console.log(JSON.stringify({ id: 'MFA-004', expectedInputKg: 60, submitted: { goodKg: 57, scrapKg: 3 }, input, response, job,
      reproduced: response.code === '23514' && /linked input 240/.test(response.message) && job.status === 'in_progress' }));
  } finally {
    await f.rollback();
    await f.close();
  }
}
