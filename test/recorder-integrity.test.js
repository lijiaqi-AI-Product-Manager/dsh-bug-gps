import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';

let root; let server; let env;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'buggps-recording-'));
  await writeFile(join(root, 'index.html'), `<!doctype html><meta charset="utf-8">
    <h1>Recording fixture</h1><label>User <input id="user"></label>
    <label>Amount <input id="first"></label><label>Amount <input id="second"></label>
    <button id="run">Run</button><p id="out">Summary</p>
    <script>document.getElementById('run').onclick=()=>{document.getElementById('out').textContent=
      document.getElementById('user').value||document.getElementById('first').value+'|'+document.getElementById('second').value;};</script>`);
  server = await startStaticServer(root);
  env = await launchBrowser();
});
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });

async function recording(t) {
  const rec = await startRecording(env.browser, { baseUrl: server.url, toolbar: true });
  t.after(() => rec.stop());
  rec.page.on('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  return rec;
}

test('typing after a checkpoint preserves both values and replays the original situation', async (t) => {
  const rec = await recording(t);
  const page = rec.page;
  await page.getByLabel('User').fill('alice');
  await page.getByRole('button', { name: /此刻应为/ }).click();
  await page.getByLabel('User').click();
  await page.getByLabel('User').fill('bob');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: /预期文本/ }).click();
  await page.locator('#out').click();
  const steps = await rec.stop();
  assert.deepEqual(steps.filter((s) => s.action === 'fill').map((s) => s.value), ['alice', 'bob']);
  const replay = await reproduce(env.browser, { steps, expectation: rec.result.expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(replay.status, Status.NOT_REPRODUCED, JSON.stringify(replay));
});

test('different fields with the same accessible name retain both inputs', async (t) => {
  const rec = await recording(t);
  await rec.page.locator('#first').fill('one');
  await rec.page.locator('#second').fill('two');
  await rec.page.getByRole('button', { name: 'Run', exact: true }).click();
  await rec.page.getByRole('button', { name: /预期文本/ }).click();
  await rec.page.locator('#out').click();
  const steps = await rec.stop();
  assert.deepEqual(steps.filter((s) => s.action === 'fill').map((s) => s.value), ['one', 'two']);
  const replay = await reproduce(env.browser, { steps, expectation: rec.result.expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(replay.status, Status.NOT_REPRODUCED, JSON.stringify(replay));
});

test('independent positive expectations are retained and selecting the same one updates it', async (t) => {
  const rec = await recording(t);
  await rec.page.getByRole('button', { name: /预期文本/ }).click();
  await rec.page.locator('#out').click();
  await rec.page.getByRole('button', { name: /应可见/ }).click();
  await rec.page.getByRole('heading', { name: 'Recording fixture' }).click();
  await rec.page.getByRole('button', { name: /预期文本/ }).click();
  await rec.page.locator('#out').click();
  await rec.stop();
  assert.equal(rec.result.expectation.kind, 'text');
  assert.equal(rec.result.expectation.equals, 'Summary');
  assert.deepEqual(rec.result.also.map((e) => e.kind), ['visible']);
});

test('Escape cancels picking without recording an application keypress', async (t) => {
  const rec = await recording(t);
  await rec.page.getByRole('button', { name: /预期文本/ }).click();
  await rec.page.keyboard.press('Escape');
  assert.equal(await rec.page.evaluate(() => window.__buggpsPickKind), null);
  await rec.page.keyboard.press('Escape');
  const steps = await rec.stop();
  assert.equal(steps.filter((s) => s.action === 'key' && s.value === 'Escape').length, 1);
});

test('typing after pinning does not overwrite the pinned input', async (t) => {
  const rec = await recording(t);
  await rec.page.getByLabel('User').fill('first');
  await rec.page.getByRole('button', { name: /上一步是关键/ }).click();
  await rec.page.getByLabel('User').fill('second');
  const fills = (await rec.stop()).filter((s) => s.action === 'fill');
  assert.deepEqual(fills.map((s) => s.value), ['first', 'second']);
  assert.equal(fills[0].pinned, true);
});
