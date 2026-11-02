// Runs a case k times and classifies the result. Only k/k failures with one identical
// signature count as REPRODUCED; anything mixed is FLAKY, never a reproduction.
import { runTrial } from './replay.js';
import { DEFAULT_OBSERVE_MS, signatureKey } from './oracle.js';

export const Status = Object.freeze({
  REPRODUCED: 'REPRODUCED',
  NOT_REPRODUCED: 'NOT_REPRODUCED',
  // A recorded checkpoint did not hold in every run: the situation the user recorded was not
  // reached, so the final result is not evidence either way.
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  ENV_BLOCKED: 'ENV_BLOCKED',
  TEST_INVALID: 'TEST_INVALID',
  FLAKY: 'FLAKY',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  ABORTED: 'ABORTED',
});

/** Trial options that come from the case contract itself (see replay.runTrial). */
export function contractOf(testCase) {
  return { expectation: testCase.expectation, also: testCase.also ?? [], observeMs: testCase.observeMs ?? DEFAULT_OBSERVE_MS };
}

// stepTimeoutMs only costs time when a target is really missing; heavy apps on a loaded machine
// can need several seconds for a lazily loaded view, which must not read as a broken replay.
export async function reproduce(browser, testCase, { baseUrl, runs = 3, match = testCase.match ?? 'strict', maxMs = 180_000, stepTimeoutMs = 10_000, signal } = {}) {
  const started = Date.now();
  const trials = [];
  for (let i = 0; i < runs; i++) {
    if (signal?.aborted) return summarize(Status.ABORTED, trials, started);
    if (Date.now() - started > maxMs) return summarize(Status.BUDGET_EXHAUSTED, trials, started);
    const t = await runTrial(browser, { baseUrl, steps: testCase.steps, ...contractOf(testCase), stepTimeoutMs, signal });
    trials.push(t);
    // An environment failure makes later runs meaningless; stop early.
    if (t.outcome === 'env-error') break;
    if (t.outcome === 'aborted') return summarize(Status.ABORTED, trials, started);
  }
  return summarize(classify(trials, runs, match), trials, started, match);
}

export function classify(trials, runs, match = 'strict') {
  if (trials.some((t) => t.outcome === 'env-error')) return Status.ENV_BLOCKED;
  if (trials.length < runs) return Status.BUDGET_EXHAUSTED;
  if (trials.some((t) => t.outcome === 'test-invalid')) return Status.TEST_INVALID;
  const outcomes = new Set(trials.map((t) => t.outcome));
  if (outcomes.size === 1 && outcomes.has('step-error')) {
    const where = new Set(trials.map((t) => t.stepIndex));
    return where.size === 1 ? Status.TEST_INVALID : Status.FLAKY;
  }
  if (outcomes.size === 1 && outcomes.has('precondition-fail')) {
    return new Set(trials.map((t) => t.stepIndex)).size === 1 ? Status.PRECONDITION_FAILED : Status.FLAKY;
  }
  if (outcomes.size === 1 && outcomes.has('pass')) return Status.NOT_REPRODUCED;
  if (outcomes.size === 1 && outcomes.has('fail')) {
    const sigs = new Set(trials.map((t) => signatureKey(t.signature, match)));
    return sigs.size === 1 ? Status.REPRODUCED : Status.FLAKY;
  }
  return Status.FLAKY;
}

function summarize(status, trials, started, match = 'strict') {
  const tally = {};
  for (const t of trials) tally[t.outcome] = (tally[t.outcome] ?? 0) + 1;
  const firstFail = trials.find((t) => t.outcome === 'fail');
  const blocked = trials.find((t) => t.outcome === 'env-error');
  const invalid = trials.find((t) => ['test-invalid', 'step-error', 'precondition-fail'].includes(t.outcome));
  return {
    status,
    runs: trials.length,
    tally,
    signature: status === Status.REPRODUCED ? firstFail.signature : null,
    signatureKey: status === Status.REPRODUCED ? signatureKey(firstFail.signature, match) : null,
    // Which check failed (0 = primary expectation, k = also[k-1]) and whether only late.
    failedCheck: status === Status.REPRODUCED ? firstFail.check ?? 0 : null,
    late: status === Status.REPRODUCED ? Boolean(firstFail.late) : null,
    observed: firstFail?.observed ?? (status === Status.PRECONDITION_FAILED ? invalid?.observed ?? null : null),
    reason: blocked?.reason ?? invalid?.reason ?? null,
    stepIndex: invalid?.stepIndex ?? blocked?.stepIndex ?? null,
    looseSteps: [...new Set(trials.flatMap((t) => t.looseSteps ?? []))].sort((a, b) => a - b),
    durationMs: Date.now() - started,
    trials: trials.map(({ observations, ...rest }) => ({ ...rest, pageErrors: observations?.pageErrors?.length ?? 0 })),
  };
}
