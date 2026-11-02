// Locked cases and the RED -> GREEN verdict. Layout under the user's repo:
//   .buggps/cases/<id>/case.json   steps + confirmed expectation (what is being verified)
//   .buggps/cases/<id>/lock.json   case hash, baseline tree, RED evidence, environment
//   .buggps/runs/<runId>.json      one record per verification attempt
// The hash detects edits to the case; it is tamper-evidence, not an unforgeable proof.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { reproduce, Status } from './reproduce.js';
import { snapshotTree, diffTrees, diffStat } from './snapshot.js';
import { validateExpectation } from './oracle.js';

export const CASE_SCHEMA = 'buggps.case/v1';
export const RUN_SCHEMA = 'buggps.run/v1';

export const Verdict = Object.freeze({
  VERIFIED: 'VERIFIED',
  // Expectation holds, but only because a recorded action now hits a disabled control.
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

export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function hashCase(testCase) {
  const { steps, minimizedSteps, expectation, match } = testCase;
  return createHash('sha256').update(canonicalJson({ schema: CASE_SCHEMA, steps, minimizedSteps, expectation, match: match ?? 'strict' })).digest('hex');
}

const casesDir = (repo) => join(repo, '.buggps', 'cases');

/**
 * Reproduces on the current (baseline) code and, only if REPRODUCED, writes case + lock.
 * `steps` is the user's recording and stays authoritative. `minimizedSteps` (optional) is kept
 * for reading and localization only: a shortened case can lose the trigger while still showing
 * the same symptom, so it never decides a verdict. Returns { status, caseId?, lock? }.
 */
export async function lockCase(browser, env, repoDir, testCase, { baseUrl, runs = 3, id = shortId(), signal } = {}) {
  validateExpectation(testCase.expectation);
  const baselineTree = await snapshotTree(repoDir);
  const red = await reproduce(browser, testCase, { baseUrl, runs, signal });
  if (red.status !== Status.REPRODUCED) return { status: red.status, red };
  let minimizedSteps;
  let redMinimized;
  if (testCase.minimizedSteps) {
    redMinimized = await reproduce(browser, { ...testCase, steps: testCase.minimizedSteps }, { baseUrl, runs, signal });
    if (redMinimized.status === Status.REPRODUCED && redMinimized.signatureKey === red.signatureKey) minimizedSteps = testCase.minimizedSteps;
  }
  const dir = join(casesDir(repoDir), id);
  await mkdir(dir, { recursive: true });
  const body = { schema: CASE_SCHEMA, id, steps: testCase.steps, ...(minimizedSteps ? { minimizedSteps } : {}), expectation: testCase.expectation, match: testCase.match ?? 'strict' };
  const lock = {
    schema: 'buggps.lock/v1',
    caseId: id,
    caseSha256: hashCase(body),
    baselineTree,
    red: { runs: red.runs, tally: red.tally, signature: red.signature, signatureKey: red.signatureKey, observed: red.observed },
    ...(redMinimized ? { redMinimized: { status: redMinimized.status, tally: redMinimized.tally, kept: Boolean(minimizedSteps) } } : {}),
    env: envFingerprint(env, baseUrl),
    lockedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, 'case.json'), JSON.stringify(body, null, 2));
  await writeFile(join(dir, 'lock.json'), JSON.stringify(lock, null, 2));
  return { status: Status.REPRODUCED, caseId: id, lock, red };
}

export async function loadCase(repoDir, id) {
  const dir = join(casesDir(repoDir), id);
  const body = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(dir, 'lock.json'), 'utf8'));
  return { body, lock };
}

/** Runs the locked case on the current code. Only this function may say VERIFIED. */
export async function verifyCase(browser, env, repoDir, id, { baseUrl, runs = 3, signal } = {}) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${shortId()}`;
  const { body, lock } = await loadCase(repoDir, id);
  const record = { schema: RUN_SCHEMA, runId, caseId: id, producer: 'dsh-bug-gps', baselineTree: lock.baselineTree, env: envFingerprint(env, baseUrl) };
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
  const treeBefore = await snapshotTree(repoDir);
  record.treeBefore = treeBefore;
  if (treeBefore === lock.baselineTree) return finish(Verdict.NO_CODE_CHANGE);

  const result = await reproduce(browser, body, { baseUrl, runs, signal });
  if (body.minimizedSteps) {
    // Advisory only. Disagreement with the full recording means the shortened case lost the
    // trigger (its symptom matched a state reachable without the bug).
    const short = await reproduce(browser, { ...body, steps: body.minimizedSteps }, { baseUrl, runs, signal });
    record.minimizedCheck = { status: short.status, tally: short.tally, observed: short.observed, agreesWithRecording: short.status === result.status };
  }
  const treeAfter = await snapshotTree(repoDir);
  record.treeAfter = treeAfter;
  record.check = { status: result.status, tally: result.tally, observed: result.observed, reason: result.reason, durationMs: result.durationMs };
  if (treeAfter !== treeBefore) return finish(Verdict.STALE);

  const sameFailure = result.trials.every((t) => t.outcome === 'fail')
    && result.signatureKey === lock.red.signatureKey;
  const disabledSteps = [...new Set(result.trials.flatMap((t) => t.disabledSteps ?? []))];
  if (disabledSteps.length) record.check.disabledSteps = disabledSteps.map((i) => ({ index: i, step: body.steps[i] }));
  let verdict;
  switch (result.status) {
    case Status.NOT_REPRODUCED: verdict = disabledSteps.length ? Verdict.NEEDS_REVIEW : Verdict.VERIFIED; break;
    case Status.REPRODUCED: verdict = sameFailure ? Verdict.STILL_FAILING : Verdict.DIFFERENT_FAILURE; break;
    default: verdict = Verdict[result.status] ?? Verdict.FLAKY;
  }
  if (verdict === Verdict.VERIFIED || verdict === Verdict.NEEDS_REVIEW) {
    const patch = await diffTrees(repoDir, lock.baselineTree, treeAfter);
    record.patch = { sha256: createHash('sha256').update(patch).digest('hex'), bytes: Buffer.byteLength(patch), stat: await diffStat(repoDir, lock.baselineTree, treeAfter) };
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
