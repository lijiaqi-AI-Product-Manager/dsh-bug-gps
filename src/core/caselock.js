// Locked cases and the RED -> GREEN verdict. Layout under the user's repo:
//   .buggps/cases/<id>/case.json   steps + confirmed contract (what is being verified)
//   .buggps/cases/<id>/lock.json   case hash, baseline tree, RED evidence, environment
//   .buggps/runs/<runId>.json      one record per verification attempt
// The hash detects edits to the case; it is tamper-evidence, not an unforgeable proof.
//
// Binding. When the case has `serve` (a dev command + loopback URL), BugGPS starts that server
// itself from the working tree for every lock and verify run, and snapshots the tree before the
// start and after the stop. Before VERIFIED, an independent baseline must reproduce the locked
// failure again with the current runtime inputs. The patch is the diff of the two snapshots;
// untracked runtime inputs remain separately recorded limitations. Without `serve`
// BugGPS can only replay against whatever answers at the URL, so a pass is PASSED_UNBOUND,
// never VERIFIED.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { contractOf, reproduce, Status } from './reproduce.js';
import { runTrial } from './replay.js';
import { snapshotTree, diffTrees, diffStat, describeTreeChanges } from './snapshot.js';
import { DEFAULT_OBSERVE_MS, EVALUATOR_VERSION, hasPositiveCheck, validateCase } from './oracle.js';
import { parseCommand, startDevServer } from './devserver.js';
import { EnvBlockedError, TestDefinitionError } from './errors.js';
import { validateCaseId } from './case-id.js';
import { withBaseline } from './baseline.js';
import { canonicalJson, resolutionChanges } from './canonical.js';
export { canonicalJson } from './canonical.js';

export const CASE_SCHEMA = 'buggps.case/v1';
export const RUN_SCHEMA = 'buggps.run/v1';

export const Verdict = Object.freeze({
  // The recorded contract holds in every run, on code BugGPS started from the candidate tree.
  VERIFIED: 'VERIFIED',
  // The contract holds, but at the URL of a server BugGPS did not start: nothing ties the pass
  // to the patch.
  PASSED_UNBOUND: 'PASSED_UNBOUND',
  // The contract holds, but the evidence is weaker than the claim (see reviewReasons).
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  STILL_FAILING: 'STILL_FAILING',
  DIFFERENT_FAILURE: 'DIFFERENT_FAILURE',
  NO_CODE_CHANGE: 'NO_CODE_CHANGE',
  CASE_TAMPERED: 'CASE_TAMPERED',
  STALE: 'STALE',
  FLAKY: 'FLAKY',
  ENV_BLOCKED: 'ENV_BLOCKED',
  TEST_INVALID: 'TEST_INVALID',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  ABORTED: 'ABORTED',
});

export const ReviewReason = Object.freeze({
  // A recorded action hit a disabled control; the expectation may hold only because of that.
  DISABLED_CONTROL: 'disabled-control',
  // Only "no error" checks: deleting the feature would pass too.
  NEGATIVE_ONLY: 'negative-only',
  // An action or assertion used a locator candidate that was absent at lock time.
  LOCATOR_DRIFT: 'locator-drift',
  // A previous evaluator cannot supply the current evaluator's RED evidence.
  EVALUATOR_CHANGED: 'evaluator-changed',
  // A fresh baseline did not reproduce the locked failure with the current runtime inputs.
  BASELINE_NOT_REPRODUCED: 'baseline-not-reproduced',
});

export function hashLock(lock) {
  return createHash('sha256').update(canonicalJson(lock)).digest('hex');
}

export function hashCase(testCase) {
  const { steps, minimizedSteps, expectation, also, observeMs, serve, match, browser } = testCase;
  return createHash('sha256').update(canonicalJson({ schema: CASE_SCHEMA, steps, minimizedSteps, expectation, also, observeMs, serve, match: match ?? 'strict', browser })).digest('hex');
}

const casesDir = (repo) => join(repo, '.buggps', 'cases');

/** Normalizes and checks a serve spec: { command: argv, url (loopback), readyTimeoutMs? }. */
export function normalizeServe(serve) {
  if (!serve) return undefined;
  const command = parseCommand(serve.command);
  if (!command.length) throw new TestDefinitionError('serve.command is empty');
  let url;
  try { url = new URL(serve.url); } catch { throw new TestDefinitionError(`serve.url is not a URL: ${serve.url}`); }
  if (!/^https?:$/.test(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new TestDefinitionError('serve.url must be an http(s) URL on localhost / 127.0.0.1 / [::1]');
  }
  return { command, url: url.href, ...(serve.readyTimeoutMs ? { readyTimeoutMs: Number(serve.readyTimeoutMs) } : {}) };
}

/**
 * Runs fn(url) against a server BugGPS starts from repoDir, between two tree snapshots.
 * Returns { result, treeBefore, treeAfter }; the caller decides what a changed tree means.
 * `warmup(url)` runs once before fn (see warmupPage).
 */
export async function withManagedServer(repoDir, serve, fn, { warmup, subprocess, signal } = {}) {
  const treeBefore = await snapshotTree(repoDir);
  const server = await startDevServer({ cwd: repoDir, argv: serve.command, url: serve.url, readyTimeoutMs: serve.readyTimeoutMs ?? 120_000, subprocess, signal });
  let result;
  try {
    if (warmup) await warmup(serve.url);
    result = await fn(serve.url);
  } finally {
    await server.stop();
  }
  return { result, treeBefore, treeAfter: await snapshotTree(repoDir) };
}

/**
 * A freshly started dev server (Vite) compiles modules on demand, including chunks that are
 * lazy-loaded only when the recorded path reaches them; the first replay can then exceed step
 * timeouts that later replays meet easily. So every managed run starts with one full replay of
 * the recording with generous timeouts, whose result is discarded (never counted as evidence).
 */
export function warmupPage(browser, testCase, { signal } = {}) {
  return async (url) => {
    await runTrial(browser, { baseUrl: url, steps: testCase.steps, ...contractOf(testCase), observeMs: 0, stepTimeoutMs: 15_000, navTimeoutMs: 120_000, signal }).catch(() => {});
  };
}
/**
 * Reproduces on the current (baseline) code and, only if REPRODUCED, writes case + lock.
 * `steps` is the user's recording and stays authoritative. `minimizedSteps` (optional) is kept
 * for reading and localization only: a shortened case can lose the trigger while still showing
 * the same symptom, so it never decides a verdict. With `serverReady`, the caller already runs
 * this case's managed server (and owns the binding snapshots). Returns { status, caseId?, lock? }.
 */
export async function lockCase(browser, env, repoDir, testCase, { baseUrl, runs = 3, id = shortId(), signal, serverReady = false } = {}) {
  validateCaseId(id);
  validateCase(testCase);
  const serve = normalizeServe(testCase.serve);
  if (serve && !serverReady) {
    try {
      const b = await withManagedServer(repoDir, serve, (url) => lockCase(browser, env, repoDir, { ...testCase, serve }, { baseUrl: url, runs, id, signal, serverReady: true }), { warmup: warmupPage(browser, testCase, { signal }), subprocess: env?.subprocess, signal });
      if (b.treeAfter !== b.treeBefore) return { status: Verdict.STALE, reason: 'files changed while locking' };
      return b.result;
    } catch (err) {
      if (signal?.aborted) return { status: Status.ABORTED, reason: err.message };
      if (err instanceof EnvBlockedError) return { status: Status.ENV_BLOCKED, reason: err.message, hint: err.hint };
      throw err;
    }
  }
  const observeMs = testCase.observeMs ?? DEFAULT_OBSERVE_MS;
  const baselineTree = await snapshotTree(repoDir);
  const contract = { ...testCase, observeMs };
  const red = await reproduce(browser, contract, { baseUrl, runs, signal });
  if (red.status !== Status.REPRODUCED) return { status: red.status, reason: red.reason, red };
  let minimizedSteps;
  let redMinimized;
  if (testCase.minimizedSteps) {
    redMinimized = await reproduce(browser, { ...contract, steps: testCase.minimizedSteps }, { baseUrl, runs, signal });
    if (redMinimized.status === Status.REPRODUCED && redMinimized.signatureKey === red.signatureKey) minimizedSteps = testCase.minimizedSteps;
  }
  if ((await snapshotTree(repoDir)) !== baselineTree) return { status: Verdict.STALE, reason: 'files changed while locking' };
  const dir = join(casesDir(repoDir), id);
  await mkdir(casesDir(repoDir), { recursive: true });
  try { await mkdir(dir); } catch (err) {
    if (err.code === 'EEXIST') throw new TestDefinitionError(`case "${id}" already exists; choose a new id to preserve the saved contract`);
    throw err;
  }
  const body = {
    schema: CASE_SCHEMA,
    id,
    steps: testCase.steps,
    ...(minimizedSteps ? { minimizedSteps } : {}),
    expectation: testCase.expectation,
    ...(testCase.browser ? { browser: testCase.browser } : {}),
    ...(testCase.also?.length ? { also: testCase.also } : {}),
    observeMs,
    ...(serve ? { serve } : {}),
    match: testCase.match ?? 'strict',
  };
  const lock = {
    schema: 'buggps.lock/v1',
    caseId: id,
    caseSha256: hashCase(body),
    baselineTree,
    binding: serve ? 'managed' : 'external',
    red: { evaluator: EVALUATOR_VERSION, runs: red.runs, tally: red.tally, signature: red.signature, signatureKey: red.signatureKey, observed: red.observed, late: red.late, looseSteps: red.looseSteps, looseChecks: red.looseChecks, resolutionProfile: red.resolutionProfile, visibilityHistory: red.visibilityHistory, observation: red.observation },
    ...(redMinimized ? { redMinimized: { status: redMinimized.status, tally: redMinimized.tally, kept: Boolean(minimizedSteps) } } : {}),
    env: envFingerprint(env, baseUrl),
    lockedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, 'case.json'), JSON.stringify(body, null, 2));
  await writeFile(join(dir, 'lock.json'), JSON.stringify(lock, null, 2));
  return { status: Status.REPRODUCED, caseId: id, lock, red };
}

export async function loadCase(repoDir, id) {
  validateCaseId(id);
  const dir = join(casesDir(repoDir), id);
  const body = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(dir, 'lock.json'), 'utf8'));
  return { body, lock };
}

/**
 * Runs the locked case on the current code. Only this function may say VERIFIED.
 * `baseUrl` is used only for cases without `serve` (external binding).
 */
export async function verifyCase(browser, env, repoDir, id, { baseUrl, runs = 3, signal } = {}) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${shortId()}`;
  const { body, lock } = await loadCase(repoDir, id);
  const serve = body.serve;
  const url = serve ? serve.url : baseUrl;
  const record = { schema: RUN_SCHEMA, runId, caseId: id, producer: 'dsh-bug-gps', evaluator: EVALUATOR_VERSION, lockSha256: hashLock(lock), baselineTree: lock.baselineTree, binding: serve ? { mode: 'managed', command: serve.command, url } : { mode: 'external', url }, observeMs: body.observeMs ?? DEFAULT_OBSERVE_MS, env: envFingerprint(env, url) };
  const finish = async (verdict, extra = {}) => {
    Object.assign(record, { verdict, ...extra, finishedAt: new Date().toISOString() });
    await mkdir(join(repoDir, '.buggps', 'runs'), { recursive: true });
    await writeFile(join(repoDir, '.buggps', 'runs', `${runId}.json`), JSON.stringify(record, null, 2));
    return record;
  };

  const actualHash = hashCase(body);
  if (actualHash !== lock.caseSha256) {
    return finish(Verdict.CASE_TAMPERED, { expectedCaseSha256: lock.caseSha256, actualCaseSha256: actualHash });
  }
  record.caseSha256 = actualHash;
  const treeNow = await snapshotTree(repoDir);
  if (treeNow === lock.baselineTree) return finish(Verdict.NO_CODE_CHANGE, { treeBefore: treeNow });

  const replay = async (u) => {
    const result = await reproduce(browser, body, { baseUrl: u, runs, signal });
    let short;
    if (body.minimizedSteps) short = await reproduce(browser, { ...body, steps: body.minimizedSteps }, { baseUrl: u, runs, signal });
    return { result, short };
  };
  let bound;
  try {
    bound = serve
      ? await withManagedServer(repoDir, serve, replay, { warmup: warmupPage(browser, body, { signal }), subprocess: env?.subprocess, signal })
      : { treeBefore: treeNow, result: await replay(url), treeAfter: await snapshotTree(repoDir) };
  } catch (err) {
    if (signal?.aborted) return finish(Verdict.ABORTED, { check: { reason: err.message } });
    if (err instanceof EnvBlockedError) return finish(Verdict.ENV_BLOCKED, { check: { reason: err.message, hint: err.hint } });
    throw err;
  }
  const { result, short } = bound.result;
  Object.assign(record, { treeBefore: bound.treeBefore, treeAfter: bound.treeAfter });
  if (short) {
    // Advisory only. Disagreement with the full recording means the shortened case lost the
    // trigger (its symptom matched a state reachable without the bug).
    record.minimizedCheck = { status: short.status, tally: short.tally, observed: short.observed, agreesWithRecording: short.status === result.status && short.signatureKey === result.signatureKey };
  }
  record.check = { status: result.status, tally: result.tally, observed: result.observed, reason: result.reason, durationMs: result.durationMs, observation: result.observation, resolutionProfile: result.resolutionProfile, visibilityHistory: result.visibilityHistory };
  if (bound.treeAfter !== bound.treeBefore || bound.treeBefore !== treeNow) return finish(Verdict.STALE, { treeChanges: await describeTreeChanges(repoDir, treeNow, bound.treeAfter) });

  const sameFailure = result.trials.every((t) => t.outcome === 'fail') && result.signatureKey === lock.red.signatureKey;
  const disabledSteps = [...new Set(result.trials.flatMap((t) => t.disabledSteps ?? []))];
  if (disabledSteps.length) record.check.disabledSteps = disabledSteps.map((i) => ({ index: i, step: body.steps[i] }));
  const newLoose = result.looseSteps.filter((i) => !(lock.red.looseSteps ?? []).includes(i));
  if (newLoose.length) record.check.looseSteps = newLoose;
  const newLooseChecks = result.looseChecks.filter((key) => !(lock.red.looseChecks ?? []).includes(key));
  if (newLooseChecks.length) record.check.looseChecks = newLooseChecks;
  const changedResolutions = resolutionChanges(lock.red.resolutionProfile, result.resolutionProfile);
  const evaluatorChanged = lock.red.evaluator !== EVALUATOR_VERSION;
  if (evaluatorChanged) record.check.evaluatorChange = { locked: lock.red.evaluator ?? null, current: EVALUATOR_VERSION };
  if (changedResolutions.length) record.check.resolutionChanges = changedResolutions;
  let verdict;
  switch (result.status) {
    case Status.NOT_REPRODUCED: {
      const reasons = [];
      if (disabledSteps.length) reasons.push(ReviewReason.DISABLED_CONTROL);
      if (!hasPositiveCheck(body)) reasons.push(ReviewReason.NEGATIVE_ONLY);
      if (newLoose.length || newLooseChecks.length || changedResolutions.length) reasons.push(ReviewReason.LOCATOR_DRIFT);
      if (evaluatorChanged) reasons.push(ReviewReason.EVALUATOR_CHANGED);
      if (serve && reasons.length === 0) {
        try {
          const control = await withBaseline(repoDir, lock.baselineTree, serve, async (baselineDir, baselineServe) => {
            const checked = await withManagedServer(baselineDir, baselineServe, (u) => reproduce(browser, body, { baseUrl: u, runs, signal }), { warmup: warmupPage(browser, body, { signal }), subprocess: env?.subprocess, signal });
            return checked.treeBefore === checked.treeAfter ? checked.result : { status: Verdict.STALE, reason: 'baseline files changed while running', treeChanges: await describeTreeChanges(baselineDir, checked.treeBefore, checked.treeAfter) };
          }, { signal });
          const red = control.result;
          const changed = resolutionChanges(lock.red.resolutionProfile, red.resolutionProfile);
          const matchesLockedFailure = red.status === Status.REPRODUCED && red.signatureKey === lock.red.signatureKey && changed.length === 0;
          record.baselineControl = { status: red.status, tally: red.tally, observed: red.observed, signatureKey: red.signatureKey, matchesLockedFailure, resolutionChanges: changed, resolutionProfile: red.resolutionProfile, visibilityHistory: red.visibilityHistory, runtimeInputs: control.runtimeInputs, reason: red.reason, treeChanges: red.treeChanges, durationMs: red.durationMs };
          if (signal?.aborted || red.status === Status.ABORTED) return finish(Verdict.ABORTED);
          if (!matchesLockedFailure) reasons.push(ReviewReason.BASELINE_NOT_REPRODUCED);
        } catch (err) {
          if (signal?.aborted) return finish(Verdict.ABORTED);
          record.baselineControl = { status: Status.ENV_BLOCKED, matchesLockedFailure: false, reason: err.message, ...(err.hint ? { hint: err.hint } : {}) };
          reasons.push(ReviewReason.BASELINE_NOT_REPRODUCED);
        }
        if (await snapshotTree(repoDir) !== bound.treeAfter) return finish(Verdict.STALE);
      }
      if (reasons.length) record.reviewReasons = reasons;
      verdict = reasons.length ? Verdict.NEEDS_REVIEW : serve ? Verdict.VERIFIED : Verdict.PASSED_UNBOUND;
      break;
    }
    case Status.REPRODUCED: verdict = sameFailure ? Verdict.STILL_FAILING : Verdict.DIFFERENT_FAILURE; break;
    // The fix changed what happens BEFORE the symptom (a recorded checkpoint no longer holds).
    case Status.PRECONDITION_FAILED: verdict = Verdict.DIFFERENT_FAILURE; break;
    default: verdict = Verdict[result.status] ?? Verdict.FLAKY;
  }
  if ([Verdict.VERIFIED, Verdict.PASSED_UNBOUND, Verdict.NEEDS_REVIEW].includes(verdict)) {
    const patch = await diffTrees(repoDir, lock.baselineTree, bound.treeAfter);
    record.patch = { sha256: createHash('sha256').update(patch).digest('hex'), bytes: Buffer.byteLength(patch), stat: await diffStat(repoDir, lock.baselineTree, bound.treeAfter) };
    await mkdir(join(repoDir, '.buggps', 'runs'), { recursive: true });
    await writeFile(join(repoDir, '.buggps', 'runs', `${runId}.patch`), patch);
  }
  return finish(verdict);
}

export function envFingerprint(env, baseUrl) {
  return { browser: env?.channel, browserVersion: env?.version, baseUrl, os: `${os.platform()} ${os.release()}`, node: process.version };
}

function shortId() {
  return randomUUID().slice(0, 8);
}
