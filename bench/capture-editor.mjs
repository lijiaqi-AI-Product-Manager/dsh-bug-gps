#!/usr/bin/env node
// Fresh scripted captures of historical editor imports. Existing inputs are never overwritten.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { startDevServer } from '../src/core/devserver.js';
import { EVALUATOR_VERSION } from '../src/core/oracle.js';
import { git } from '../src/core/snapshot.js';
import { freePort } from '../test/helpers.js';

const source = fileURLToPath(new URL('..', import.meta.url));
const id = process.argv[2];
assert.ok(['chartdb-1031', 'chartdb-1089'].includes(id), 'Select chartdb-1031 or chartdb-1089');
const revision = Number(process.env.BUGGPS_EDITOR_REVISION ?? 2);
assert.ok(Number.isSafeInteger(revision) && revision >= 2, 'BUGGPS_EDITOR_REVISION must be an integer >= 2');
const manifest = JSON.parse(await readFile(new URL('./holdout-cases.json', import.meta.url), 'utf8'));
const state = JSON.parse(await readFile(process.env.BUGGPS_HOLDOUT_STATE ?? join(source, '.buggps/holdout/workspaces.json'), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(hash(JSON.stringify(manifest)), state.manifestSha256);
const root = await realpath(state.root);
assert.equal(dirname(root), await realpath(tmpdir()));
assert.ok(basename(root).startsWith('bgh-'));
const spec = manifest.cases.find((entry) => entry.id === id);
const entry = state.cases.find((entry) => entry.id === id);
assert.equal(entry?.status, 'READY');
const dir = await realpath(entry.dir);
assert.equal(dirname(dir), join(root, 'cases'));
assert.equal((await git(dir, ['rev-parse', 'HEAD'])).trim(), spec.buggyCommit);
assert.equal((await git(dir, ['diff', '--name-only', 'HEAD'])).trim(), '', 'Historical source must be unchanged');
const output = resolve(process.argv[3] ?? join(source, 'bench/holdout-recordings', 'v' + revision, id + '.json'));
const previous = await readFile(join(source, 'bench/holdout-recordings', ...(revision > 2 ? ['v' + (revision - 1)] : []), id + '.json'));
const label = id === 'chartdb-1031' ? 'SQL Script' : 'DBML Script';
const table = id === 'chartdb-1031' ? 'invoice' : 'documents';
const content = id === 'chartdb-1031' ? 'CREATE TABLE invoice (amount decimal(15,2));' : "Table documents {\n id int [pk]\n body jsonb\n indexes {\n body [type: gin, name: 'body_search']\n }\n}";
process.env.CI = 'true';
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
let server; let env; let rec;
const timer = setTimeout(cancel, 180_000);
const onAbort = () => { void env?.browser.close(); };
controller.signal.addEventListener('abort', onAbort, { once: true });
try {
  const port = await freePort();
  server = await startDevServer({ cwd: dir, argv: [process.execPath, join(source, 'bench/vite-chartdb-serve.mjs'), String(port)], url: `http://127.0.0.1:${port}/`, readyTimeoutMs: 120_000, signal: controller.signal });
  env = await launchBrowser();
  controller.signal.throwIfAborted();
  rec = await startRecording(env.browser, { baseUrl: server.url });
  const page = rec.page;
  page.setDefaultTimeout(60_000);
  await page.getByRole('radio').filter({ has: page.getByRole('img', { name: 'PostgreSQL', exact: true }) }).click();
  await page.getByRole('radio', { name: id === 'chartdb-1031' ? 'SQL Script' : 'DBML', exact: true }).click();
  const editor = page.locator(`div:has(> div:text-is("${label}")) textarea[aria-label="Editor content"]`);
  await editor.waitFor({ state: 'visible' });
  assert.equal(await editor.count(), 1);
  await editor.press('ControlOrMeta+A');
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, content);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Import' && !button.disabled));
  assert.equal(await editor.inputValue(), content, 'The application must retain the exact input before import');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('.react-flow__node').getByText(table, { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('complementary').getByRole('button', { name: table, exact: true }).click();
  let expectation; let also;
  if (id === 'chartdb-1031') {
    await page.getByRole('textbox', { name: 'Name', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'amount');
    if (revision >= 4) {
      const actions = page.getByRole('region', { name: 'Fields', exact: true }).locator('button:has(svg.lucide-ellipsis)');
      assert.equal(await actions.count(), 1);
      await actions.click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
      const precision = '[role="dialog"] label:text-is("Precision") + input';
      const scale = '[role="dialog"] label:text-is("Scale") + input';
      assert.equal(await page.locator(precision).count(), 1);
      assert.equal(await page.locator(scale).count(), 1);
      assert.equal(await page.locator(precision).inputValue(), '', 'The original code loses the declared precision');
      assert.equal(await page.locator(scale).inputValue(), '', 'The original code loses the declared scale');
      expectation = { kind: 'value', target: [{ by: 'css', value: scale }], equals: '2' };
      also = [
        { kind: 'value', target: [{ by: 'css', value: precision }], equals: '15' },
        { kind: 'value', target: [{ by: 'role', role: 'textbox', name: 'Name' }], equals: 'amount' },
      ];
    } else {
      expectation = { kind: 'count', target: [{ by: 'css', value: 'aside :text-is("numeric(15,2)")' }], equals: 1 };
      also = [{ kind: 'value', target: [{ by: 'role', role: 'textbox', name: 'Name' }], equals: 'amount' }];
    }
  } else {
    await page.getByRole('heading', { name: 'Indexes', exact: true }).click();
    const actions = page.getByRole('region', { name: 'Indexes', exact: true }).locator('button:not([disabled]):has(svg.lucide-ellipsis)');
    assert.equal(await actions.count(), 1);
    await actions.click();
    await page.locator('label[for="indexType"] + button').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('dialog').getByRole('textbox').inputValue(), 'body_search');
    expectation = { kind: 'text', target: [{ by: 'css', value: 'label[for="indexType"] + button' }], equals: 'GIN' };
    also = [{ kind: 'value', target: [{ by: 'role', role: 'textbox', within: { role: 'dialog' } }], equals: 'body_search' }];
  }
  const steps = await rec.stop();
  assert.deepEqual(rec.result.captureIssues, []);
  assert.equal(rec.dropped.length, 0);
  const rawSteps = structuredClone(steps);
  const pasteIndex = steps.findIndex((step) => step.action === 'paste');
  assert.ok(pasteIndex >= 0);
  assert.equal(steps[pasteIndex].value, content);
  if (revision >= 3) {
    assert.equal(steps[pasteIndex].wasEnabled, true);
    assert.ok(steps.some((step) => step.action === 'click' && step.wasEnabled === true && step.target.some((target) => target.by === 'role' && target.role === 'button' && target.name === table || target.by === 'text' && target.value === table && target.within?.role === 'button' && target.within.name === table)), 'The table action must retain its unique button scope');
  }
  if (revision >= 4) {
    const database = steps.find((step) => step.action === 'click' && step.target.some((target) => target.child?.name === 'PostgreSQL'));
    assert.ok(database?.target.some((target) => target.nameWithChild === true && target.name && target.child?.name === 'PostgreSQL'), 'Retain both the database option label and its exact named image');
  }
  if (revision >= 5) {
    const action = steps.find((step) => step.action === 'click' && step.target.some((target) => target.by === 'text' && target.value === table && target.within?.role === 'button' && target.within.name === table));
    assert.equal(action?.target.length, 1, 'A named table button must not fall back to unrelated full-page text');
  }
  steps[pasteIndex].check = { kind: 'value', target: structuredClone(steps[pasteIndex].target), equals: content };
  let note = id === 'chartdb-1031'
    ? revision >= 4 ? 'Verify precision 15 and scale 2 in the amount field properties, as required by the upstream regression test. The previous sidebar count used numeric(15,2), while the fixed UI displays numeric(15, 2); retain that failed definition and establish a new original-code basis.' : 'Preserve the original precision/scale expectation. Replace an ambiguous hidden textarea fill with captured editor paste.'
    : 'Use a valid PostgreSQL JSONB field for the GIN index; verify the named imported index in its actual properties.';
  if (revision >= 5) note += ' Keep the exact named table-button scope while it mounts; do not adopt a same-text editor token or canvas label.';
  const input = { schema: 'buggps.draft/v1', source: 'scripted', definitionRevision: revision, definitionBasis: { repository: spec.repo, commit: spec.buggyCommit, upstream: spec.pr, previousInputSha256: hash(previous), inputMethod: 'Select All and a scripted ClipboardEvent; not native clipboard capture', note, producer: 'bench/capture-editor.mjs', producerSha256: hash(await readFile(fileURLToPath(import.meta.url))), recorderSha256: hash(await readFile(join(source, 'src/core/recorder.js'))), evaluator: EVALUATOR_VERSION, runtimeCommit: (await git(source, ['rev-parse', 'HEAD'])).trim() }, browser: rec.result.browser, steps, rawSteps, expectation, also, observeMs: 1000, authoredCheckpoints: [{ afterStepIndex: pasteIndex, check: steps[pasteIndex].check }], targetOverrides: [], dropped: 0 };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ case: id, revision, steps: steps.length, pasteIndex, captureIssues: 0, output: relative(source, output).replaceAll('\\', '/') }));
} finally {
  clearTimeout(timer);
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  controller.signal.removeEventListener('abort', onAbort);
  await rec?.stop();
  await env?.browser.close();
  await server?.stop();
}
