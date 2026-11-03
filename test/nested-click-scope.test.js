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
  root = await mkdtemp(join(tmpdir(), 'buggps-click-scope-'));
  for (const kind of ['native', 'role', 'duplicate']) {
    const child = '<div style="padding:20px" onclick="document.querySelector(\'#out\').textContent=\'selected\'">invoice</div>';
    const button = kind === 'native' ? `<button>${child}</button>` : `<div role="button" aria-label="invoice">${child}</div>`;
    await writeFile(join(root, kind + '.html'), '<!doctype html>' + button + (kind === 'duplicate' ? button : '') + '<p>invoice</p><output id="out"></output>');
  }
  env = await launchBrowser(); server = await startStaticServer(root);
});
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });

for (const kind of ['native', 'role']) test(`nested text retains its unique named ${kind} button scope`, async (t) => {
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/' + kind + '.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('button', { name: 'invoice', exact: true }).click();
  const steps = await rec.stop();
  const click = steps.find((step) => step.action === 'click');
  assert.equal(click.target[0].within?.role, 'button');
  assert.equal(click.target[0].within?.name, 'invoice');
  const result = await reproduce(env.browser, { steps, expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'selected' }, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
});

test('duplicate named buttons cannot become an indexed scope', async (t) => {
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/duplicate.html' });
  t.after(() => rec.stop());
  // Choosing a location here only constructs the ambiguous-recording counterexample.
  await rec.page.getByRole('button', { name: 'invoice', exact: true }).first().click();
  const steps = await rec.stop();
  assert.equal(steps.find((step) => step.action === 'click').target.some((target) => target.within?.role === 'button'), false);
  const result = await reproduce(env.browser, { steps, expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'selected' }, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 250 });
  assert.equal(result.status, Status.TEST_INVALID);
});

test('a delayed named button cannot be replaced by a matching code token', async (t) => {
  const button = '<div role="button" aria-label="invoice"><div style="padding:20px" onclick="document.querySelector(\'#out\').textContent=\'selected\'">invoice</div></div>';
  await writeFile(join(root, 'delayed.html'), '<!doctype html>' + button + '<output id="out"></output>');
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/delayed.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('button', { name: 'invoice', exact: true }).click();
  assert.equal(await rec.page.locator('#out').innerText(), 'selected', 'The captured original action must actually operate the page');
  const steps = await rec.stop();
  await writeFile(join(root, 'delayed.html'), '<!doctype html><code onclick="document.querySelector(\'#out\').textContent=\'decoy\'">invoice</code><output id="out"></output><script>setTimeout(()=>document.body.insertAdjacentHTML("beforeend",' + JSON.stringify(button) + '),1800)</script>');
  const result = await reproduce(env.browser, { steps, expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'selected' }, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 5000 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
});

test('a missing named button never adopts an unrelated same-text element', async (t) => {
  const button = '<div role="button" aria-label="invoice"><div style="padding:20px" onclick="document.querySelector(\'#out\').textContent=\'selected\'">invoice</div></div>';
  await writeFile(join(root, 'missing.html'), '<!doctype html>' + button + '<output id="out"></output>');
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/missing.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('button', { name: 'invoice', exact: true }).click();
  assert.equal(await rec.page.locator('#out').innerText(), 'selected', 'The captured original action must actually operate the page');
  const steps = await rec.stop();
  await writeFile(join(root, 'missing.html'), '<!doctype html><code onclick="document.querySelector(\'#out\').textContent=\'selected\'">invoice</code><output id="out"></output>');
  const result = await reproduce(env.browser, { steps, expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'selected' }, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 300 });
  assert.equal(result.status, Status.TEST_INVALID);
});
