// Evaluates the confirmed expectation after replay and turns an observed failure into a
// signature. A candidate reproduction only counts if its signature matches the original's:
// "it still fails somehow" is not enough (that is how wrong minimizations slip through).
import { candidateLocator, candidatesOf, resolveTarget, targetKey, targetScope, targetFailureReason } from './locator.js';
import { TestDefinitionError } from './errors.js';
import { validateObserveMs } from './observation.js';
import { browserOptions, validateViewport } from './browser-options.js';
import { canonicalJson } from './canonical.js';
import { validatePasteStep } from './editor-input.js';

export const EVALUATOR_VERSION = 'buggps.oracle/v7';

export const EXPECTATION_KINDS = ['text', 'value', 'visible', 'hidden', 'count', 'no-page-error', 'no-console-error', 'no-failed-request'];
// "Nothing went wrong" kinds. On their own they cannot show the feature works again (deleting
// the handler also removes the error), so a fix checked only by these is never VERIFIED.
export const NEGATIVE_KINDS = new Set(['no-page-error', 'no-console-error', 'no-failed-request']);
const STATE_KINDS = ['text', 'value', 'visible', 'hidden', 'count'];
// How long a passing result must keep passing after the last step. Recorded in the case.
export { DEFAULT_OBSERVE_MS } from './observation.js';

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
  if (exp.comparison !== undefined && (!['text', 'value'].includes(exp.kind) || !['exact', 'startsWith'].includes(exp.comparison))) throw new TestDefinitionError('comparison must be exact or startsWith on a text/value check');
  if (exp.comparison === 'startsWith' && !exp.equals.length) throw new TestDefinitionError('startsWith needs a non-empty expected prefix');
  if (exp.kind === 'count') {
    if (!Number.isSafeInteger(exp.equals) || exp.equals < 0) throw new TestDefinitionError('count needs a non-negative integer equals');
    if (candidatesOf(exp.target).length !== 1) throw new TestDefinitionError('count needs one explicit collection selector');
  }
}

/** Validates the whole contract of a case: primary expectation, extra checks, checkpoints. */
export function validateCase(testCase) {
  if (testCase.captureIssues !== undefined && !Array.isArray(testCase.captureIssues)) throw new TestDefinitionError('captureIssues must be an array');
  if (testCase.captureIssues?.length) throw new TestDefinitionError('Recording is incomplete: ' + testCase.captureIssues.slice(0, 3).map((issue) => typeof issue?.message === 'string' ? issue.message.slice(0, 500) : 'unsupported input').join('; '));
  validateExpectation(testCase.expectation);
  for (const e of testCase.also ?? []) validateExpectation(e);
  for (const s of testCase.steps ?? []) if (s.check) validateExpectation(s.check, { checkpoint: true });
  validateObserveMs(testCase.observeMs);
  browserOptions(testCase.browser);
  for (const step of testCase.steps ?? []) if (step.action === 'viewport') validateViewport(step);
  for (const step of testCase.steps ?? []) if (step.action === 'paste') validatePasteStep(step);
}

/** True when some final check proves a positive outcome (not just "no error"). */
export function hasPositiveCheck(testCase) {
  return [testCase.expectation, ...(testCase.also ?? [])].some((e) => e && !NEGATIVE_KINDS.has(e.kind) && e.kind !== 'hidden' && (e.kind !== 'count' || e.equals > 0));
}

/**
 * Polls the expectation for up to settleMs. Returns { pass: true } or
 * { pass: false, observed, signature } or { invalid: reason } when the target is unusable.
 */
export async function evaluate(page, exp, observations, { settleMs = 500, targetWaitMs = 3000, onResolution } = {}) {
  const started = Date.now();
  let last;
  for (;;) {
    last = await evaluateOnce(page, exp, observations);
    if (last.resolvedBy) onResolution?.(last.resolvedBy);
    else if (last.priorResolution) onResolution?.(last.priorResolution);
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
      if (!r.ok) return fail(exp, `target ${targetFailureReason(r)}`, `target:${r.reason}`);
      const actual = normalizeSpace(await r.locator.textContent());
      return resolved(r, compareString(exp, actual));
    }
    case 'value': {
      const r = await resolveTarget(page, exp.target, { timeoutMs: 0 });
      if (!r.ok) return fail(exp, `target ${targetFailureReason(r)}`, `target:${r.reason}`);
      const actual = await r.locator.inputValue().catch(() => null);
      if (actual === null) return resolved(r, { invalid: 'expectation target has no input value' });
      return resolved(r, compareString(exp, actual));
    }
    case 'count': {
      const candidate = candidatesOf(exp.target)[0];
      const scope = targetScope(page, candidate);
      if (scope && (await scope.count()) > 1) return { invalid: 'expectation scope is ambiguous' };
      const count = await candidateLocator(page, candidate).count();
      return resolved({ ok: true, used: { ...candidate, collection: true } }, count === exp.equals ? { pass: true } : fail(exp, `${count} matching elements`, String(count)));
    }
    case 'visible':
    case 'hidden': {
      const r = await resolveTarget(page, exp.target, { timeoutMs: 0 });
      if (!r.ok && r.reason === 'ambiguous') return { invalid: r.scopeCounts?.some((n) => n > 1) ? 'expectation scope is ambiguous' : 'expectation target is ambiguous' };
      const visible = r.ok ? await r.locator.isVisible() : false;
      if (visible && exp.kind === 'visible') obs.observeVisible?.(r.used);
      const want = exp.kind === 'visible';
      if (visible === want) return resolved(r, { pass: true });
      if (exp.kind === 'visible') {
        // This condition's own history distinguishes disappearance from never reaching it.
        const seen = obs.seenTarget ? 'was visible earlier' : 'never visible';
        const failure = fail(exp, `not visible (${seen})`, `false:${seen}`);
        if (!r.ok && obs.seenTargetResolution) {
          // Historical evidence is explicit; it is not a claim that this candidate
          // still resolves in the current DOM.
          failure.priorResolution = obs.seenTargetResolution;
          failure.signature.priorResolution = obs.seenTargetResolution;
        }
        return resolved(r, failure);
      }
      return resolved(r, fail(exp, 'visible', 'true'));
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

function resolved(resolution, result) {
  return { ...result, ...(resolution.ok ? { resolvedBy: resolution.used, ...(result.signature ? { signature: { ...result.signature, resolution: resolution.used } } : {}) } : {}) };
}

function compareString(exp, actual) {
  if (exp.comparison === 'startsWith') {
    return actual.startsWith(exp.equals) ? { pass: true } : fail(exp, actual, { comparison: 'startsWith', value: actual.slice(0, exp.equals.length) });
  }
  return actual === exp.equals ? { pass: true } : fail(exp, actual, actual);
}

function fail(exp, observed, actualKey) {
  const target = exp.target ? targetKey(exp.target) : '';
  return { pass: false, observed, signature: { kind: exp.kind, target, actual: actualKey } };
}

export function signatureKey(sig, match = 'strict') {
  if (!sig) return null;
  const shape = (value) => ({
    kind: value.kind, target: value.target, resolution: value.resolution, priorResolution: value.priorResolution,
    check: value.check,
    ...(value.checks ? { checks: value.checks.map((entry) => ({ check: entry.check, outcome: entry.outcome, resolution: entry.resolution, ...(entry.signature ? { signature: shape(entry.signature) } : {}) })) } : {}),
    ...(match === 'loose' ? {} : { actual: value.actual }),
  });
  return canonicalJson(shape(sig));
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
