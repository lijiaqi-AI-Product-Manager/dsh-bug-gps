// A new versioned capture; existing inputs, locked cases and results are never rewritten.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { startDevServer } from '../src/core/devserver.js';
import { git } from '../src/core/snapshot.js';
import { freePort } from '../test/helpers.js';
const source = fileURLToPath(new URL('..', import.meta.url));
const state = JSON.parse(await readFile(process.env.BUGGPS_HOLDOUT_STATE ?? join(source, '.buggps/holdout/workspaces.json'), 'utf8'));
const spec = JSON.parse(await readFile(new URL('./holdout-cases.json', import.meta.url), 'utf8')).cases.find((c) => c.id === 'drawdb-1066');
const entry = state.cases.find((c) => c.id === spec.id);
assert.equal(entry.status, 'READY');
assert.equal((await git(entry.dir, ['rev-parse', 'HEAD'])).trim(), spec.buggyCommit);
assert.equal((await git(entry.dir, ['diff', '--name-only', 'HEAD'])).trim(), '');
const previous = await readFile(new URL('./holdout-recordings/drawdb-1066.json', import.meta.url));
const output = fileURLToPath(new URL('./holdout-recordings/v2/drawdb-1066.json', import.meta.url));
const port = await freePort();
const server = await startDevServer({ cwd: entry.dir, argv: [process.execPath, join(source, 'bench/vite-serve.mjs'), String(port)], url: `http://127.0.0.1:${port}/`, readyTimeoutMs: 120_000 });
let env;
try {
  env = await launchBrowser();
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: '/editor' });
  const page = rec.page;
  await page.getByText('MySQL', { exact: true }).click();
  await page.getByRole('button', { name: 'confirm', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('nav .text-xl').click();
  await page.getByPlaceholder('名称', { exact: true }).fill('Original');
  await page.getByRole('button', { name: 'confirm', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /添加表/ }).click();
  // The buggy revision's three adjacent spans are Diagrams, /, and title. Read this
  // before Save As, independently of any fixed candidate or its output.
  const before = (await page.locator('nav .text-xl').textContent()).replace(/\s+/g, ' ').trim();
  assert.equal(before, 'Diagrams/Original');
  const checkpointAfter = rec.steps.length - 1;
  await page.getByText('文件', { exact: true }).hover();
  await page.getByRole('menuitem', { name: /^另存为/ }).click();
  await page.getByPlaceholder('名称', { exact: true }).fill('Copy');
  await page.getByRole('button', { name: 'confirm', exact: true }).click();
  const steps = await rec.stop();
  const rawSteps = structuredClone(steps);
  steps[checkpointAfter].check = { kind: 'text', target: [{ by: 'css', value: 'nav .text-xl' }], equals: before };
  const input = { schema: 'buggps.draft/v1', source: 'scripted', definitionRevision: 2, definitionBasis: { repository: spec.repo, commit: spec.buggyCommit, file: 'src/components/EditorHeader/ControlPanel.jsx', observedBeforeSaveAs: before, previousInputSha256: createHash('sha256').update(previous).digest('hex'), note: 'New capture from the buggy revision. The exact breadcrumb uses adjacent spans without spaces; require the pre-Save-As caption to stay identical and retain creation of the Copy link.' }, browser: rec.result.browser, steps, rawSteps, observeMs: 1000, expectation: { kind: 'text', target: [{ by: 'css', value: 'nav .text-xl' }], equals: before }, also: [{ kind: 'count', target: [{ by: 'css', value: 'a[href^="/editor/diagrams/"]:text-is("Copy")' }], equals: 1 }], authoredCheckpoints: [{ afterStepIndex: checkpointAfter, check: steps[checkpointAfter].check }], dropped: rec.dropped.length };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ case: spec.id, revision: 2, steps: steps.length, expectedUnchangedCaption: before }));
} finally { await env?.browser.close(); await server.stop(); }
