// Recorder: secret inputs never enter a recording; checkpoints and "no error + positive check"
// are captured from the toolbar and replay as part of the case contract.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { secretEnvVar } from '../src/core/secrets.js';

// Fictional value for a local test page.
const PASSWORD = 'correct-horse-battery';
const PAGE = `<!doctype html><meta charset="utf-8"><title>login</title>
<label>User <input id="u"></label>
<label>Password <input id="p" type="password"></label>
<button id="go">Sign in</button><p id="out"></p>
<script>document.getElementById('go').onclick = () => { document.getElementById('out').textContent = document.getElementById('p').value === ${JSON.stringify(PASSWORD)} ? 'Welcome' : 'Denied'; };</script>`;

let dir; let server; let env;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'buggps-login-'));
  await writeFile(join(dir, 'index.html'), PAGE);
  server = await startStaticServer(dir);
  env = await launchBrowser();
});
after(async () => { await env?.browser.close(); await server?.close(); await rm(dir, { recursive: true, force: true }); });

test('password is stored as a secret reference, checkpoint and also-check are recorded', async () => {
  const rec = await startRecording(env.browser, { baseUrl: server.url, toolbar: true });
  const { page } = rec;
  page.on('dialog', (d) => d.accept(d.defaultValue())); // the user confirms what is shown
  await page.getByRole('textbox', { name: 'User' }).fill('alice');
  await page.locator('#__buggps_toolbar summary').click();
  await page.getByRole('button', { name: /此刻应为/ }).click();
  await page.getByRole('textbox', { name: 'User' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#__buggps_toolbar summary').click();
  await page.getByRole('button', { name: /不应报错/ }).click();
  await page.getByRole('button', { name: /预期文本/ }).click();
  await page.locator('#out').click();
  await page.getByRole('button', { name: /结束/ }).click();
  await rec.finished;
  const steps = await rec.stop();

  assert.doesNotMatch(JSON.stringify({ steps, result: rec.result }), new RegExp(PASSWORD));
  const pw = steps.find((s) => s.action === 'fill' && s.value?.secret);
  assert.deepEqual(pw.value, { secret: 'PASSWORD' });
  const user = steps.find((s) => s.action === 'fill' && s.value === 'alice');
  assert.deepEqual(user.check.kind, 'value');
  assert.equal(user.check.equals, 'alice');
  assert.equal(rec.result.expectation.kind, 'no-page-error');
  assert.deepEqual(rec.result.also.map((e) => [e.kind, e.equals]), [['text', 'Welcome']]);

  const testCase = { steps, expectation: rec.result.expectation, also: rec.result.also, observeMs: 200 };
  const name = secretEnvVar('PASSWORD');
  const saved = process.env[name];
  delete process.env[name];
  try {
    const blocked = await reproduce(env.browser, testCase, { baseUrl: server.url, runs: 1 });
    assert.equal(blocked.status, Status.ENV_BLOCKED);
    assert.match(blocked.reason, /BUGGPS_SECRET_PASSWORD/);
    process.env[name] = PASSWORD;
    const ok = await reproduce(env.browser, testCase, { baseUrl: server.url, runs: 2 });
    assert.equal(ok.status, Status.NOT_REPRODUCED, JSON.stringify(ok.trials));
    process.env[name] = 'wrong';
    const bad = await reproduce(env.browser, testCase, { baseUrl: server.url, runs: 2 });
    assert.equal(bad.status, Status.REPRODUCED);
    assert.equal(bad.observed, 'Denied');
  } finally {
    if (saved === undefined) delete process.env[name]; else process.env[name] = saved;
  }
});
