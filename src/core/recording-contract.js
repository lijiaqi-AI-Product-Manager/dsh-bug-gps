import { TestDefinitionError } from './errors.js';
import { canonicalJson } from './canonical.js';

export const CAPTURE_VERSION = 'buggps.capture/v2';
export const CAPTURE_STATE_KINDS = ['text', 'value', 'visible', 'hidden'];
const stateKey = (check) => canonicalJson([check.kind, check.target]);

export function validateRecording(testCase) {
  if (testCase.source !== 'recorded') {
    if (testCase.captureVersion !== undefined) throw new TestDefinitionError('captureVersion requires source "recorded"');
    return;
  }
  if (testCase.captureVersion !== CAPTURE_VERSION) {
    throw new TestDefinitionError('This recording needs renewed capture. Start a new recording before locking it again.');
  }
  const checks = [testCase.expectation, ...(testCase.also ?? [])].filter((check) => CAPTURE_STATE_KINDS.includes(check?.kind));
  if (!Array.isArray(testCase.capturedChecks) || testCase.capturedChecks.length !== checks.length) throw new TestDefinitionError('Recorded checks need their captured original states. Start a new recording.');
  const states = new Map();
  for (const state of testCase.capturedChecks) {
    if (!state || !CAPTURE_STATE_KINDS.includes(state.kind) || typeof state.observed !== (['text', 'value'].includes(state.kind) ? 'string' : 'boolean') || !state.target) throw new TestDefinitionError('Invalid captured original state. Start a new recording.');
    const key = stateKey(state);
    if (states.has(key)) throw new TestDefinitionError('Duplicate captured original state. Start a new recording.');
    states.set(key, state.observed);
  }
  for (const check of checks) {
    if (!states.has(stateKey(check))) throw new TestDefinitionError('A check has no captured original state. Start a new recording.');
    if (check.comparison && check.comparison !== 'exact') throw new TestDefinitionError('Recorded state binding requires an exact text/value comparison.');
  }
  if (CAPTURE_STATE_KINDS.includes(testCase.expectation?.kind) && states.get(stateKey(testCase.expectation)) !== testCase.expectedFrom) throw new TestDefinitionError('The primary captured original state changed. Start a new recording.');
}

// A failure on another state cannot establish the original recording's baseline. This is
// checked only when locking: a repair is expected to change the observed failing state.
export function matchesRecordedState(testCase, red) {
  if (testCase.source !== 'recorded') return true;
  const checks = [testCase.expectation, ...(testCase.also ?? [])];
  return red.trials.length > 0 && red.trials.every((trial) => {
    return testCase.capturedChecks.every((state) => {
      const index = checks.findIndex((check) => stateKey(check) === stateKey(state));
      const result = trial.signature?.checks?.find((entry) => entry.check === index);
      if (['visible', 'hidden'].includes(state.kind)) {
        if (result?.outcome === 'pass') return state.observed === (state.kind === 'visible');
        return result?.outcome === 'fail' && state.observed === (state.kind === 'hidden') && String(result.signature?.actual).startsWith(state.kind === 'hidden' ? 'true' : 'false:');
      }
      if (result?.outcome === 'pass') return state.observed === checks[index].equals;
      return result?.outcome === 'fail' && result.signature?.actual === state.observed;
    });
  });
}
