import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';

let root; let env; let server;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'buggps-enabled-'));
  await writeFile(join(root, 'index.html'), `<!doctype html><button id="run" disabled>Import</button><p id="out">READY</p>
    <script>const b=document.getElementById('run');b.onclick=()=>document.getElementById('out').textContent='IMPORTED';
    if(!new URL(location.href).searchParams.has('permanent'))setTimeout(()=>b.disabled=false,700);console.log('readiness-start');</script>`);
  env = await launchBrowser(); server = await startStaticServer(root);
});
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });
const input = (url = '/', wasEnabled = true, expected = 'IMPORTED') => ({ steps: [{ action: 'goto', url }, { action: 'click', target: [{ by: 'role', role: 'button', name: 'Import' }], wasEnabled }], expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: expected }, observeMs: 0 });

test('recording keeps the enabled state of a real action', async (t) => {
  const rec = await startRecording(env.browser, { baseUrl: server.url });
  t.after(() => rec.stop());
  await rec.page.getByRole('button', { name: 'Import' }).click();
  const steps = await rec.stop();
  assert.equal(steps.find((step) => step.action === 'click').wasEnabled, true);
});

test('a recorded enabled control waits for actual readiness before acting', async () => {
  const result = await reproduce(env.browser, input(), { baseUrl: server.url, runs: 1, stepTimeoutMs: 1500 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
  assert.equal(result.trials[0].disabledSteps, undefined);
});

test('a permanently disabled control remains reported after the bounded wait', async () => {
  const result = await reproduce(env.browser, input('/?permanent', true, 'READY'), { baseUrl: server.url, runs: 1, stepTimeoutMs: 250 });
  assert.equal(result.status, Status.NOT_REPRODUCED);
  assert.deepEqual(result.trials[0].disabledSteps, [1]);
  assert.ok(result.trials[0].stepMs[1] >= 220);
});

test('an originally disabled action does not wait for a state it never had', async () => {
  const result = await reproduce(env.browser, input('/?permanent', false, 'READY'), { baseUrl: server.url, runs: 1, stepTimeoutMs: 2000 });
  assert.equal(result.status, Status.NOT_REPRODUCED);
  assert.deepEqual(result.trials[0].disabledSteps, [1]);
  assert.ok(result.trials[0].stepMs[1] < 1000);
});

test('cancelling a readiness wait gives no passing verdict', async () => {
  const controller = new AbortController();
  let timer;
  const browser = { async newContext(options) {
    const context = await env.browser.newContext(options);
    context.on('page', (page) => page.on('console', (message) => { if (message.text() === 'readiness-start') timer = setTimeout(() => controller.abort(), 300); }));
    return context;
  } };
  try {
    const result = await reproduce(browser, input('/?permanent', true, 'READY'), { baseUrl: server.url, runs: 1, stepTimeoutMs: 2000, signal: controller.signal });
    assert.equal(result.status, Status.ABORTED);
  } finally { clearTimeout(timer); }
});

test('enabled-state metadata has an explicit boolean type', async () => {
  let opened = false;
  const browser = { newContext() { opened = true; throw new Error('must not open'); } };
  const result = await reproduce(browser, input('/', 'yes'), { runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID);
  assert.equal(opened, false);
});
