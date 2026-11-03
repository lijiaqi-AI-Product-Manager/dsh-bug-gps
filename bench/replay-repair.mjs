#!/usr/bin/env node
// Replays the published DBML repair fixture. This command makes no model calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { withBaseline } from '../src/core/baseline.js';
import { lockCase, verifyCase } from '../src/core/caselock.js';
import { canonicalJson } from '../src/core/canonical.js';
import { validateCase, EVALUATOR_VERSION } from '../src/core/oracle.js';
import { git } from '../src/core/snapshot.js';
import { freePort } from '../test/helpers.js';

const source = fileURLToPath(new URL('..', import.meta.url));
const data = fileURLToPath(new URL('./repairs/chartdb-dbml-index/', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const checkOnly = process.argv.includes('--check-only');
if (process.argv.slice(2).some((arg) => arg !== '--check-only')) throw new Error('Use node bench/replay-repair.mjs [--check-only]');
const manifest = JSON.parse(await readFile(new URL('./holdout-cases.json', import.meta.url), 'utf8'));
const spec = manifest.cases.find((entry) => entry.id === 'chartdb-1089');
const state = JSON.parse(await readFile(process.env.BUGGPS_HOLDOUT_STATE ?? join(source, '.buggps/holdout/workspaces.json'), 'utf8'));
assert.equal(state.manifestSha256, hash(JSON.stringify(manifest)), 'Frozen manifest changed');
const root = await realpath(state.root);
assert.equal(dirname(root), await realpath(tmpdir()));
assert.ok(basename(root).startsWith('bgh-'), 'Expected an owned dataset root');
const prepared = state.cases.find((entry) => entry.id === spec.id);
assert.equal(prepared?.status, 'READY', 'Run node bench/setup-holdout.mjs chartdb-1089 first');
const original = await realpath(prepared.dir);
assert.equal(dirname(original), join(root, 'cases'));
assert.equal((await git(original, ['rev-parse', 'HEAD'])).trim(), spec.buggyCommit);
assert.equal((await git(original, ['diff', 'HEAD', '--name-only'])).trim(), '', 'The prepared application contains tracked changes');
const fixture = JSON.parse(await readFile(join(data, 'fixture.json'), 'utf8'));
const input = JSON.parse(await readFile(join(data, 'input.json'), 'utf8'));
const patch = (await readFile(join(data, 'repair.patch'), 'utf8')).replace(/\r\n/g, '\n');
assert.equal(fixture.application.originalCommit, spec.buggyCommit);
assert.equal(hash(canonicalJson(input)), fixture.input.canonicalSha256, 'Executable input changed');
assert.equal(hash(patch), fixture.patch.sha256, 'Published patch changed');
assert.equal(hash((await readFile(join(source, fixture.startup.producer), 'utf8')).replace(/\r\n/g, '\n')), fixture.startup.sha256, 'Fixture startup entry changed');
validateCase(input);
await git(original, ['apply', '--check'], { input: patch });
if (checkOnly) {
  console.log(JSON.stringify({ status: 'READY', case: fixture.case, inputAndPatchMatch: true, originalTrackedFilesUnchanged: true }));
  process.exit(0);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const output = resolve(source, '.buggps/repair-replay', runId);
await mkdir(output, { recursive: true });
const started = Date.now();
const controller = new AbortController();
let budgetExpired = false;
const timer = setTimeout(() => { budgetExpired = true; controller.abort(); }, 15 * 60 * 1000);
const cancel = () => controller.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
const record = { schema: 'buggps.repair-replay/v1', at: new Date().toISOString(), evaluator: EVALUATOR_VERSION, case: fixture.case, inputCanonicalSha256: fixture.input.canonicalSha256, patchSha256: fixture.patch.sha256, modelCalls: 0, status: 'NOT_RUN' };
let env;
try {
  record.producerCommit = (await git(source, ['rev-parse', 'HEAD'])).trim();
  const port = await freePort();
  const serve = { command: [process.execPath, join(source, fixture.startup.producer), String(port)], url: `http://127.0.0.1:${port}/`, readyTimeoutMs: 120000 };
  env = await launchBrowser();
  record.browser = { channel: env.channel, version: env.browser.version() };
  const tree = (await git(original, ['rev-parse', spec.buggyCommit + '^{tree}'])).trim();
  const isolated = await withBaseline(original, tree, serve, async (repo, runtimeServe) => {
    const id = 'repair-' + randomUUID();
    const locked = await lockCase(env.browser, env, repo, { ...input, serve: runtimeServe }, { id, runs: 3, signal: controller.signal });
    record.lock = { status: locked.status, tally: locked.lock?.red?.tally };
    if (!locked.caseId) { record.status = locked.status; return; }
    const files = ['case.json', 'lock.json'];
    const caseDir = join(repo, '.buggps/cases', id);
    const before = await Promise.all(files.map(async (file) => hash(await readFile(join(caseDir, file)))));
    record.initialVerification = (await verifyCase(env.browser, env, repo, id, { runs: 3, signal: controller.signal })).verdict;
    const readme = join(repo, 'README.md');
    const bytes = await readFile(readme);
    try {
      await writeFile(readme, Buffer.concat([bytes, Buffer.from('\n<!-- repair negative control -->\n')]));
      const negative = await verifyCase(env.browser, env, repo, id, { runs: 3, signal: controller.signal });
      record.unrelatedChange = { verdict: negative.verdict, tally: negative.check?.tally };
    } finally { await writeFile(readme, bytes); }
    await git(repo, ['apply', '--check'], { input: patch });
    await git(repo, ['apply'], { input: patch });
    const fixed = await verifyCase(env.browser, env, repo, id, { runs: 3, signal: controller.signal });
    record.candidate = { verdict: fixed.verdict, tally: fixed.check?.tally, reviewReasons: fixed.reviewReasons ?? [] };
    record.freshOriginal = fixed.baselineControl ? { status: fixed.baselineControl.status, tally: fixed.baselineControl.tally, matches: fixed.baselineControl.matchesLockedFailure } : null;
    record.protectedInputsUnchanged = (await Promise.all(files.map(async (file) => hash(await readFile(join(caseDir, file)))))).every((value, index) => value === before[index]);
    for (const file of files) await copyFile(join(caseDir, file), join(output, file));
    if (fixed.runId) {
      await copyFile(join(repo, '.buggps/runs', fixed.runId + '.json'), join(output, 'verification.json'));
      if (fixed.patch) await copyFile(join(repo, '.buggps/runs', fixed.runId + '.patch'), join(output, 'verification.patch'));
    }
    record.status = fixed.verdict === 'VERIFIED' && record.initialVerification === 'NO_CODE_CHANGE' && record.unrelatedChange.verdict === 'STILL_FAILING' && record.protectedInputsUnchanged && record.freshOriginal?.matches ? 'VERIFIED' : 'NEEDS_REVIEW';
  }, { signal: controller.signal });
  record.runtimeInputs = isolated.runtimeInputs;
} catch (error) {
  record.status = controller.signal.aborted ? budgetExpired ? 'BUDGET_EXHAUSTED' : 'ABORTED' : 'FAILED';
  record.failure = { name: error.name, code: error.code ?? null };
} finally {
  clearTimeout(timer); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  await env?.browser.close();
  record.durationMs = Date.now() - started;
  record.artifacts = '.buggps/repair-replay/' + runId;
  await writeFile(join(output, 'summary.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(record));
}
if (record.status !== 'VERIFIED') process.exitCode = 1;
