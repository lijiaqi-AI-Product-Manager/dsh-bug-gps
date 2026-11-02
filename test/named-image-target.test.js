import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { candidatesOf } from '../src/core/locator.js';

let root; let env; let server;
before(async () => { root = await mkdtemp(join(tmpdir(), 'buggps-image-target-')); env = await launchBrowser(); server = await startStaticServer(root); });
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });
const html = (kind, labels, images = ['PostgreSQL', 'MySQL']) => '<!doctype html>' + labels.map((label, i) => {
  const attrs = `aria-label="${label}" onclick="document.querySelector('#out').textContent='${i}'" style="padding:20px"`;
  const child = `<span role="img" aria-label="${images[i]}">◉</span>`;
  return kind === 'button' ? `<button ${attrs}>${child}</button>` : `<div role="radio" ${attrs}>${child}</div>`;
}).join('') + '<output id="out"></output>';
const expectation = { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: '0' };

for (const kind of ['radio', 'button']) test(`a generic ${kind} is identified by its unique named image across label variants`, async (t) => {
  const file = kind + '.html';
  await writeFile(join(root, file), html(kind, ['Toggle bold', 'Toggle bold']));
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/' + file });
  t.after(() => rec.stop());
  await rec.page.getByRole(kind).filter({ has: rec.page.getByRole('img', { name: 'PostgreSQL', exact: true }) }).click();
  const steps = await rec.stop();
  const original = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(original.status, Status.NOT_REPRODUCED, JSON.stringify(original));
  await writeFile(join(root, file), html(kind, ['PostgreSQL Toggle bold', 'MySQL Toggle bold']));
  const changed = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(changed.status, Status.NOT_REPRODUCED, JSON.stringify(changed));
  assert.deepEqual(changed.resolutionProfile, original.resolutionProfile, 'The same uniquely named image must retain its exact identity without a loose-name fallback');
});

test('duplicate image names do not justify choosing one generic control', async (t) => {
  await writeFile(join(root, 'duplicate.html'), html('radio', ['Toggle bold', 'Toggle bold'], ['Database', 'Database']));
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/duplicate.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('radio').first().click(); // Construct an ambiguous input; replay must refuse it.
  const steps = await rec.stop();
  const result = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 250 });
  assert.equal(result.status, Status.TEST_INVALID);
});

test('a meaningful unique action name cannot be replaced by its image alone', async (t) => {
  await writeFile(join(root, 'action.html'), html('button', ['Delete PostgreSQL', 'Delete MySQL']));
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/action.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('button', { name: 'Delete PostgreSQL', exact: true }).click();
  const steps = await rec.stop();
  await writeFile(join(root, 'action.html'), html('button', ['Open PostgreSQL', 'Open MySQL']));
  const result = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 250 });
  assert.equal(result.status, Status.TEST_INVALID);
});

test('a repeated action name still rejects a different operation on the same image', async (t) => {
  await writeFile(join(root, 'verb.html'), html('button', ['Delete', 'Delete']));
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/verb.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('button').filter({ has: rec.page.getByRole('img', { name: 'PostgreSQL', exact: true }) }).click();
  const steps = await rec.stop();
  await writeFile(join(root, 'verb.html'), html('button', ['Open PostgreSQL', 'Delete']));
  const result = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 250 });
  assert.equal(result.status, Status.TEST_INVALID, 'Image identity alone cannot preserve the action meaning');
});

test('image and action names containing pattern characters remain literal', async (t) => {
  const image = 'PostgreSQL (16)+';
  const action = 'Toggle [bold]+';
  await writeFile(join(root, 'literal.html'), html('radio', [action, action], [image, 'MySQL']));
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/literal.html' });
  t.after(() => rec.stop());
  await rec.page.getByRole('radio').filter({ has: rec.page.getByRole('img', { name: image, exact: true }) }).click();
  const steps = await rec.stop();
  await writeFile(join(root, 'literal.html'), html('radio', [image + ' ' + action, action], [image, 'MySQL']));
  const result = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
  await writeFile(join(root, 'literal.html'), html('radio', ['PostgreSQL 16 Toggle bold', action], [image, 'MySQL']));
  const changed = await reproduce(env.browser, { steps, expectation, observeMs: 0 }, { baseUrl: server.url, runs: 1, stepTimeoutMs: 250 });
  assert.equal(changed.status, Status.TEST_INVALID);
});

test('image-name matching rejects incomplete or invalid definitions', () => {
  for (const target of [
    { by: 'role', role: 'button', name: 'Delete', nameWithChild: false },
    { by: 'role', role: 'button', name: 'Delete', nameWithChild: true },
    { by: 'role', role: 'button', child: { role: 'img', name: 'Database' }, nameWithChild: true },
    { by: 'role', role: 'button', name: 'Delete', child: { role: 'button', name: 'Database' }, nameWithChild: true },
  ]) assert.throws(() => candidatesOf(target), /nameWithChild/);
});
