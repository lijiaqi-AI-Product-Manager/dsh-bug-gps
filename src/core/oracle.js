// Evaluates the confirmed expectation after replay and turns an observed failure into a
// signature. A candidate reproduction only counts if its signature matches the original's:
// "it still fails somehow" is not enough (that is how wrong minimizations slip through).
import { resolveTarget, targetKey } from './locator.js';
import { TestDefinitionError } from './errors.js';

export const EXPECTATION_KINDS = ['text', 'value', 'visible', 'hidden', 'no-page-error', 'no-console-error', 'no-failed-request'];
// "Nothing went wrong" kinds. On their own they cannot show the feature works again (deleting
// the handler also removes the error), so a fix checked only by these is never VERIFIED.
export const NEGATIVE_KINDS = new Set(['no-page-error', 'no-console-error', 'no-failed-request']);
const STATE_KINDS = ['text', 'value', 'visible', 'hidden'];
// How long a passing result must keep passing after the last step. Recorded in the case.
export const DEFAULT_OBSERVE_MS = 1000;

export function validateExpectation(exp, { checkpoint = false } = {}) {
  const kinds = checkpoint ? STATE_KINDS : EXPECTATION_KINDS;
  if (!exp || !kinds.includes(exp.kind)) {
    throw new TestDefinitionError(`${checkpoint ? 'Checkpoint' : 'Expectation'} kind must be one of ${kinds.join(', ')}`);
  }
  if (STATE_KINDS.includes(exp.kind) && !exp.target) {
    throw new TestDefinitionError(`Expectation "${exp.kind}" needs a target`);
  }
  if (['text', 'value'].includes(exp.kind) && typeof exp.equals !== 'string') {
    throw new TestDefinitionError(`Expectation "${exp.kind}" needs a string "equals"`);
  }
}

/** Validates the whole contract of a case: primary expectation, extra checks, checkpoints. */
export function validateCase(testCase) {
  validateExpectation(testCase.expectation);
  for (const e of testCase.also ?? []) validateExpectation(e);
  for (const s of testCase.steps ?? []) if (s.check) validateExpectation(s.check, { checkpoint: true });
  if (testCase.observeMs !== undefined && !(Number.isInteger(testCase.observeMs) && testCase.observeMs >= 0 && testCase.observeMs <= 30_000)) {
    throw new TestDefinitionError('observeMs must be an integer between 0 and 30000');
  }
}

/** True when some final check proves a positive outcome (not just "no error"). */
export function hasPositiveCheck(testCase) {
  return [testCase.expectation, ...(testCase.also ?? [])].some((e) => e && !NEGATIVE_KINDS.has(e.kind));
}

/**
 * Polls the expectation for up to settleMs. Returns { pass: true } or
 * { pass: false, observed, signature } or { invalid: reason } when the target is unusable.
 */
export async function evaluate(page, exp, observations, { settleMs = 500, targetWaitMs = 3000 } = {}) {
  const started = Date.now();
  let last;
  for (;;) {
    last = await evaluateOnce(page, exp, observations);
    if (last.pass || last.invalid) return last;
    // A value/text target that is not there yet (popover still animating in) gets longer.
    const missing = String(last.signature?.actual ?? '').startsWith('target:');
    if (Date.now() - started >= (missing ? targetWaitMs : settleMs)) {
      // An expectation that cannot be observed is not a failure. Otherwise "never got there"
      // shares a signature with every broken replay and minimization deletes everything.
      return missing ? { invalid: `expectation ${last.observed}` } : last;
    }
    await page.waitForTimeout(50);
  }
}

async function evaluateOnce(page, exp, obs) {
  switch (exp.kind) {
    case 'text': {
      const r = await resolveTarget(page, exp.target, { timeoutMs: 0 });
      if (!r.ok) return fail(exp, `target ${r.reason}`, `target:${r.reason}`);
      const actual = normalizeSpace(await r.locator.textContent());
      return actual === exp.equals ? { pass: true } : fail(exp, actual, actual);
    }
    case 'value': {
      const r = await resolveTarget(page, exp.target, { timeoutMs: 0 });
      if (!r.ok) return fail(exp, `target ${r.reason}`, `target:${r.reason}`);
      const actual = await r.locator.inputValue().catch(() => null);
      if (actual === null) return { invalid: 'expectation target has no input value' };
      return actual === exp.equals ? { pass: true } : fail(exp, actual, actual);
    }
    case 'visible':
    case 'hidden': {
      const r = await resolveTarget(page, exp.target, { timeoutMs: 0 });
      if (!r.ok && r.reason === 'ambiguous') return { invalid: 'expectation target is ambiguous' };
      const visible = r.ok ? await r.locator.isVisible() : false;
      const want = exp.kind === 'visible';
      if (visible === want) return { pass: true };
      if (exp.kind === 'visible') {
        // "Disappeared" and "never reached" must not share a signature (see replay.isVisibleNow).
        const seen = obs.seenTarget ? 'was visible earlier' : 'never visible';
        return fail(exp, `not visible (${seen})`, `false:${seen}`);
      }
      return fail(exp, 'visible', 'true');
    }
    case 'no-page-error':
      return obs.pageErrors.length === 0 ? { pass: true }
        : fail(exp, obs.pageErrors[0], normalizeError(obs.pageErrors[0]));
    case 'no-console-error':
      return obs.consoleErrors.length === 0 ? { pass: true }
        : fail(exp, obs.consoleErrors[0], normalizeError(obs.consoleErrors[0]));
    case 'no-failed-request':
      return obs.failedRequests.length === 0 ? { pass: true }
        : fail(exp, obs.failedRequests[0], obs.failedRequests[0].replace(/\?.*$/, ''));
    default:
      throw new TestDefinitionError(`Unknown expectation kind ${exp.kind}`);
  }
}

function fail(exp, observed, actualKey) {
  const target = exp.target ? targetKey(exp.target) : '';
  return { pass: false, observed, signature: { kind: exp.kind, target, actual: actualKey } };
}

export function signatureKey(sig, match = 'strict') {
  if (!sig) return null;
  return match === 'loose' ? `${sig.kind}|${sig.target}` : `${sig.kind}|${sig.target}|${sig.actual}`;
}

function normalizeSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Strips volatile parts (line:col, URLs, long numbers) so the same error matches across runs. */
export function normalizeError(message) {
  return String(message)
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/:\d+:\d+/g, '')
    .replace(/\b\d{4,}\b/g, '<n>')
    .trim();
}
