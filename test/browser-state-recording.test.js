import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { startStaticServer } from '../examples/serve.js';
import { tempRepo, serveSpec } from './helpers.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });

async function fixture(t, html) {
  const repo = await tempRepo();
  const file = join(repo.root, 'index.html');
  await writeFile(file, html);
  const server = await startStaticServer(repo.root);
  t.after(async () => { await server.close(); await repo.cleanup(); });
  return { ...repo, file, url: server.url };
}

test('Space retains its keyboard semantics without a duplicate synthesized click', async (t) => {
  const html = '<!doctype html><button onclick="document.querySelector(\'#out\').textContent=Number(document.querySelector(\'#out\').textContent)+1">Chapter</button><p id="out">0</p>';
  const app = await fixture(t, html);
  const rec = await startRecording(env.browser, { baseUrl: app.url });
  await rec.page.getByRole('button', { name: 'Chapter' }).press('Space');
  const steps = await rec.stop();
  assert.deepEqual(steps.map((s) => s.action), ['goto', 'press']);
  assert.equal(steps[1].value, 'Space');
  const definition = { steps, browser: rec.result.browser, expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: '0' }, observeMs: 0, serve: await serveSpec(app.root) };
  assert.equal((await lockCase(env.browser, env, app.root, definition, { id: 'space', runs: 1 })).caseId, 'space');
  await writeFile(app.file, html.replace('<button ', '<button onkeydown="if(event.key===\' \')event.preventDefault()" '));
  assert.equal((await verifyCase(env.browser, env, app.root, 'space', { runs: 1 })).verdict, Verdict.VERIFIED);
});

test('a browser fullscreen exit remains part of a successful recorded path', async (t) => {
  const app = await fixture(t, '<!doctype html><button onclick="document.documentElement.requestFullscreen()">Present</button><p id="mode">idle</p><script>document.addEventListener("fullscreenchange",()=>document.querySelector("#mode").textContent=document.fullscreenElement?"full":"normal")</script>');
  const rec = await startRecording(env.browser, { baseUrl: app.url });
  await rec.page.getByRole('button', { name: 'Present' }).click();
  await rec.page.waitForFunction(() => document.fullscreenElement !== null);
  await rec.page.evaluate(() => document.exitFullscreen());
  const steps = await rec.stop();
  assert.ok(steps.some((s) => s.action === 'exit-fullscreen' && s.pinned));
  const result = await reproduce(env.browser, { steps, browser: rec.result.browser, expectation: { kind: 'text', target: [{ by: 'css', value: '#mode' }], equals: 'normal' }, observeMs: 0 }, { baseUrl: app.url });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
});
