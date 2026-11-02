#!/usr/bin/env node
// Checks the frozen dataset against upstream patches. This runner makes no model calls.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { launchBrowser } from '../src/core/browser.js';
import { lockCase, verifyCase, withManagedServer, warmupPage } from '../src/core/caselock.js';
import { reproduce } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';
import { git } from '../src/core/snapshot.js';
import { freePort } from '../test/helpers.js';

const source = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./holdout-cases.json', import.meta.url), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const state = JSON.parse(await readFile(process.env.BUGGPS_HOLDOUT_STATE ?? join(source, '.buggps/holdout/workspaces.json'), 'utf8'));
if (hash(JSON.stringify(manifest)) !== state.manifestSha256) throw new Error('Frozen dataset does not match workspace preparation');
const root = await realpath(state.root);
if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith('bgh-')) throw new Error('Expected an owned short temporary workspace root');
const requested = process.argv.slice(2);
if (requested.some((id) => !manifest.cases.some((c) => c.id === id))) throw new Error('Unknown dataset case');
const selected = manifest.cases.filter((c) => !requested.length || requested.includes(c.id));
const outputDir = resolve(process.env.BUGGPS_HOLDOUT_OUT ?? join(source, 'bench/results'));
const inputDir = resolve(process.env.BUGGPS_HOLDOUT_INPUTS ?? join(source, 'bench/holdout-recordings'));
await mkdir(outputDir, { recursive: true });
const runtime = { commit: (await git(source, ['rev-parse', 'HEAD'])).trim(), node: process.version, platform: process.platform, arch: process.arch, ci: 'true' };
// Vite 4 otherwise exits when its noninteractive stdin closes. No application source is changed.
process.env.CI = 'true';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const results = [];
const safe = (value) => {
  if (typeof value === 'string') return value.replaceAll(root, '<fixture-root>').replaceAll(source, '<source-root>').replaceAll(process.execPath, '<node>').replaceAll(tmpdir(), '<temp>');
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, safe(v)]));
  return value;
};
const summary = (r) => r && ({ status: r.status, verdict: r.verdict, tally: r.tally ?? r.check?.tally, reason: r.reason ?? r.check?.reason, observed: r.observed ?? r.check?.observed, stepIndex: r.stepIndex ?? r.check?.stepIndex, reviewReasons: r.reviewReasons, signature: r.signature ?? r.check?.signature, baselineControl: r.baselineControl, durationMs: r.durationMs ?? r.check?.durationMs, caseSha256: r.caseSha256, lockSha256: r.lockSha256 });
const inRoot = (path) => { const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };

for (const spec of selected) {
  const start = Date.now();
  const out = { schema: 'buggps.holdout-result/v1', dataset: manifest.dataset, denominator: manifest.denominator, case: spec.id, upstream: spec.pr, buggyCommit: spec.buggyCommit, fixCommit: spec.fixCommit, expectedFixedVerdict: spec.expectedFixedVerdict, at: new Date().toISOString(), runtime, modelCalls: 0 };
  let env;
  let readme;
  let applied = false;
  let dir;
  const oldSecrets = new Map();
  try {
    const entry = state.cases.find((c) => c.id === spec.id);
    out.preparation = { status: entry?.status ?? 'MISSING', attempts: (entry?.attempts ?? []).map((a) => ({ status: a.status, reason: a.reason?.replaceAll(root, '<fixture-root>') })), manager: entry?.manager, managerVersion: entry?.managerVersion, lockSha256: entry?.lockSha256 };
    if (entry?.status !== 'READY') { out.status = 'ENV_BLOCKED'; out.reason = 'Fixture preparation did not complete'; continue; }
    dir = await realpath(entry.dir);
    if (!inRoot(dir) || dirname(dir) !== join(root, 'cases')) throw new Error('Unexpected fixture path');
    if ((await git(dir, ['rev-parse', 'HEAD'])).trim() !== spec.buggyCommit) throw new Error('Fixture baseline changed');
    for (const name of spec.fixFiles) if (name.startsWith('/') || name.split(/[\\/]/).includes('..')) throw new Error('Invalid upstream path');
    const generatedTypes = spec.project === 'it-tools' ? ['.eslintrc-auto-import.json', 'auto-imports.d.ts', 'components.d.ts'] : [];
    const changed = (await git(dir, ['diff', '--name-only', 'HEAD'])).trim().split('\n').filter(Boolean);
    if (changed.some((f) => !generatedTypes.includes(f))) throw new Error('Fixture contains tracked application changes');
    // These files are generated by the historical dev build. Include the already-warmed
    // declarations in the snapshot; retain their patch hash instead of hiding the changes.
    out.preparation.generatedDeclarations = await Promise.all(changed.map(async (path) => ({ path, sha256: hash(await readFile(join(dir, path))) })));
    if (changed.length) out.preparation.generatedPatchSha256 = hash(await git(dir, ['diff', 'HEAD', '--', ...changed]));
    const bytes = await readFile(join(inputDir, spec.id + '.json'));
    const draft = JSON.parse(bytes);
    out.input = { source: draft.source, sha256: hash(bytes), steps: draft.steps.length, authoredTargets: draft.targetOverrides ?? [], dropped: draft.dropped ?? null, expectation: draft.expectation, also: draft.also ?? [] };
    for (const [name, value] of Object.entries(draft.fixtureSecrets ?? {})) {
      if (!/^BUGGPS_SECRET_HOLDOUT_[A-Z0-9_]+$/.test(name) || draft.fixtureKind !== 'synthetic') throw new Error('Only namespaced synthetic fixture secrets are accepted');
      oldSecrets.set(name, process.env[name]); process.env[name] = value;
    }
    const port = await freePort();
    const serve = { command: [process.execPath, join(source, 'bench/vite-serve.mjs'), String(port)], url: `http://127.0.0.1:${port}/`, readyTimeoutMs: 120_000 };
    out.fixtureRuntime = { entry: 'bench/vite-serve.mjs', sha256: hash(await readFile(join(source, 'bench/vite-serve.mjs'))), cache: 'per-checkout', dependencyMode: entry.dependencyMode ?? 'linked-cache' };
    const testCase = { steps: draft.steps, expectation: draft.expectation, also: draft.also ?? [], observeMs: draft.observeMs ?? 1000, browser: draft.browser, serve };
    env = await launchBrowser(); out.browser = { channel: env.channel, version: env.browser.version() };
    const raw = { ...testCase, steps: draft.rawSteps ?? draft.steps };
    const rawRun = await withManagedServer(dir, serve, (url) => reproduce(env.browser, raw, { baseUrl: url, runs: 1, stepTimeoutMs: 1500 }), { warmup: warmupPage(env.browser, raw) });
    out.rawRecording = summary(rawRun.result);
    const id = 'holdout-' + spec.id + '-' + randomUUID().slice(0, 8);
    const locked = await lockCase(env.browser, env, dir, testCase, { id, runs: 3 });
    out.lock = { status: locked.status, reason: locked.reason, red: summary(locked.red ?? locked.lock?.red) };
    if (!locked.caseId) { out.status = locked.status; continue; }
    const casePath = join(dir, '.buggps/cases', id, 'case.json');
    const lockPath = join(dir, '.buggps/cases', id, 'lock.json');
    const before = [hash(await readFile(casePath)), hash(await readFile(lockPath))];
    const reduced = await withManagedServer(dir, serve, (url) => minimize(env.browser, testCase, { baseUrl: url, signature: locked.lock.red.signature, late: locked.lock.red.late, maxMs: 30_000, maxTrials: 20, concurrency: 2 }), { warmup: warmupPage(env.browser, testCase) });
    const m = reduced.result;
    out.minimize = { status: m.status, confirmed: m.confirmed, original: m.originalSteps, shortened: m.minimizedSteps, stats: m.stats, steps: m.testCase.steps };
    // A nonfunctional tracked change must retain the original failure.
    const readmePath = join(dir, 'README.md');
    readme = await readFile(readmePath);
    await writeFile(readmePath, Buffer.concat([readme, Buffer.from('\n<!-- holdout negative control -->\n')]));
    try { out.negativeControl = summary(await verifyCase(env.browser, env, dir, id, { runs: 3 })); }
    finally { await writeFile(readmePath, readme); readme = undefined; }
    applied = true;
    await git(dir, ['--literal-pathspecs', 'restore', '--source', spec.fixCommit, '--worktree', '--', ...spec.fixFiles]);
    out.fixed = summary(await verifyCase(env.browser, env, dir, id, { runs: 3 }));
    const after = [hash(await readFile(casePath)), hash(await readFile(lockPath))];
    out.protectedInputs = { unchanged: before.every((h, i) => h === after[i]), caseSha256: before[0], lockSha256: before[1] };
    out.status = out.fixed.verdict;
    out.expectedOutcome = out.fixed.verdict === spec.expectedFixedVerdict && out.negativeControl.verdict === 'STILL_FAILING' && out.protectedInputs.unchanged;
  } catch (error) {
    out.status = error.name === 'EnvBlockedError' ? 'ENV_BLOCKED' : error.code === 'ENOENT' ? 'TEST_INVALID' : 'RUNNER_ERROR';
    out.reason = String(error.message).replaceAll(root, '<fixture-root>').replaceAll(source, '<source-root>').slice(0, 1600);
  } finally {
    if (readme && dir) await writeFile(join(dir, 'README.md'), readme);
    if (applied) await git(dir, ['--literal-pathspecs', 'restore', '--source', spec.buggyCommit, '--worktree', '--', ...spec.fixFiles]);
    for (const [name, value] of oldSecrets) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await env?.browser.close();
    out.durationMs = Date.now() - start;
    const clean = safe(out); results.push(clean);
    await writeFile(join(outputDir, `holdout-${spec.id}-${stamp}.json`), JSON.stringify(clean, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ case: spec.id, status: out.status, raw: out.rawRecording?.status, steps: out.minimize ? `${out.minimize.original}->${out.minimize.shortened}` : null, expectedOutcome: out.expectedOutcome ?? false }));
  }
}
await writeFile(join(outputDir, `holdout-batch-${stamp}.json`), JSON.stringify({ schema: 'buggps.holdout-batch/v1', dataset: manifest.dataset, denominator: manifest.denominator, attempted: results.length, runtime, results: results.map((r) => ({ case: r.case, status: r.status, expectedOutcome: r.expectedOutcome ?? false })) }, null, 2) + '\n', { flag: 'wx' });
