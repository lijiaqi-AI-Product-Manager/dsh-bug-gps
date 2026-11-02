import { TestDefinitionError } from './errors.js';

// One monotonic deadline for an operation. A parent signal may stop it sooner;
// the caller can still distinguish that cancellation from its own deadline.
export function executionBudget(maxMs, signal) {
  if (!Number.isFinite(maxMs) || maxMs < 0) throw new TestDefinitionError('maxMs must be a finite non-negative number');
  const deadline = performance.now() + maxMs;
  const controller = new AbortController();
  let stopped;
  let timer;
  const stop = (reason) => {
    if (stopped) return;
    stopped = reason;
    clearTimeout(timer);
    controller.abort();
  };
  const cancel = () => stop('aborted');
  const check = () => {
    if (!stopped && performance.now() >= deadline) stop('budget-exhausted');
    return stopped;
  };
  const schedule = () => {
    if (check()) return;
    timer = setTimeout(schedule, Math.min(2_147_483_647, Math.max(1, deadline - performance.now())));
  };
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  schedule();
  return {
    signal: controller.signal,
    stopped: check,
    remainingMs: () => Math.max(0, deadline - performance.now()),
    dispose() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
  };
}

export function integerOption(value, name, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TestDefinitionError(`${name} must be an integer >= ${minimum}`);
}
