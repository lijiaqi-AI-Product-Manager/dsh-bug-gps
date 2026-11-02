// Deterministic replay of one trial: fresh BrowserContext (no cookies/storage carry-over),
// steps executed in order, then the expectation is evaluated. No model calls happen here.
import { resolveTarget, targetFailureReason } from './locator.js';
import { evaluate } from './oracle.js';
import { resolveValue } from './secrets.js';
import { TestDefinitionError } from './errors.js';
import { browserOptions, validateViewport } from './browser-options.js';
import { canonicalJson } from './canonical.js';
import { executionBudget } from './execution-budget.js';

const NETWORK_DOWN = /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_UNSAFE_PORT|ERR_INTERNET_DISCONNECTED/;

/**
 * One trial of the case contract:
 *   - after step i, `steps[i].check` (a checkpoint) must hold, or the trial is
 *     'precondition-fail': the recorded situation was not reached, so the end result says nothing;
 *   - after the last step the primary `expectation` is evaluated, then every check in `also`;
 *   - after initial success, checks are sampled throughout `observeMs` with a 50 ms target interval.
 * maxMs covers the whole trial. Closing its own context gets at most 2 s of cleanup
 * grace; an unfinished cleanup is reported, never hidden behind a passing result.
 * @returns {Promise<{outcome:'pass'|'fail'|'precondition-fail'|'step-error'|'env-error'|'test-invalid'|'aborted'|'budget-exhausted', ...}>}
 */
export async function runTrial(browser, { baseUrl, steps, expectation, also = [], observeMs = 0, browser: settings, stepTimeoutMs = 5000, navTimeoutMs = 45_000, settleMs = 250, maxMs = 180_000, signal: parentSignal, probe }) {
  const started = performance.now();
  const budget = executionBudget(maxMs, parentSignal);
  const signal = budget.signal;
  const obs = { pageErrors: [], consoleErrors: [], failedRequests: [] };
  let context;
  let page;
  let opening = false;
  let closing;
  const closeContext = () => {
    if (!context) return undefined;
    closing ??= Promise.resolve().then(() => context.close());
    // A late context may arrive after the caller has already returned.
    void closing.catch(() => {});
    return closing;
  };

  const disabledSteps = [];
  // Steps whose target only resolved through the loose (substring) fallback: weaker evidence
  // that the same element was used. caselock compares them with the lock-time runs.
  const looseSteps = [];
  const looseChecks = new Set();
  const resolutionProfile = {};
  const resolved = (key, value) => {
    if (!value) return;
    const encoded = canonicalJson(value);
    resolutionProfile[key] = [...new Set([...(resolutionProfile[key] ?? []), encoded])].sort();
  };
  let observation;
  const stepMs = [];
  const done = (r) => ({ ...r, resolutionProfile, ...(disabledSteps.length ? { disabledSteps } : {}), ...(looseSteps.length ? { looseSteps } : {}), ...(looseChecks.size ? { looseChecks: [...looseChecks].sort() } : {}), ...(observation ? { observation } : {}), stepMs, durationMs: Math.ceil(performance.now() - started), observations: obs });
  const checked = (key, value) => { resolved(key, value); if (value?.loose) looseChecks.add(key); };
  const checks = [expectation, ...also];
  const history = checks.map((check) => check?.kind === 'visible' ? { seen: false } : null);
  let active = true;
  let currentStep = -1;
  const sawVisible = (index, candidate, source) => {
    if (!active || !history[index]) return;
    Object.assign(history[index], { seen: true, candidate, source, stepIndex: currentStep, elapsedMs: Math.ceil(performance.now() - started) });
  };
  const checkObservations = checks.map((_, index) => ({
    ...obs,
    get seenTarget() { return history[index]?.seen ?? false; },
    get seenTargetResolution() { return history[index]?.candidate; },
    observeVisible: (candidate) => sawVisible(index, candidate, 'final-check'),
  }));
  let pendingSample;
  // Each visible condition owns its history. Earlier substring matches are not evidence
  // that the recorded target appeared; only an actual final check may use that fallback.
  const sampleVisibility = () => {
    if (!active) return Promise.resolve();
    return pendingSample ??= (async () => {
      for (let index = 0; index < checks.length; index++) {
        if (!active) break;
        if (!history[index]) continue;
        const r = await resolveTarget(page, checks[index].target, { timeoutMs: 0 }).catch(() => ({ ok: false }));
        if (!r.ok || r.used?.loose) continue;
        if (await r.locator.isVisible().catch(() => false)) sawVisible(index, r.used, 'replay-sample');
      }
    })().finally(() => { pendingSample = null; });
  };
  const visibilityHistory = () => Object.fromEntries(history.flatMap((value, index) => value ? [[`final:${index}`, { ...value }]] : []));
  // Poll between actions as well as after them: an asynchronous element may disappear
  // before the next action completes. Only a missing final target uses the earlier candidate.
  let poll;
  const complete = (r) => done({ ...r, ...(history.some(Boolean) ? { visibilityHistory: visibilityHistory() } : {}) });
  const interrupted = () => complete({ outcome: budget.stopped() ?? 'aborted', ...(currentStep >= 0 ? { stepIndex: currentStep } : {}) });
  let interrupt;
  const interruption = new Promise((resolve) => { interrupt = resolve; });
  const onAbort = () => { active = false; void closeContext(); interrupt(interrupted()); };
  signal.addEventListener('abort', onAbort, { once: true });

  const execute = async () => {
    if (budget.stopped()) return interrupted();
    try {
      opening = true;
      context = await browser.newContext(browserOptions(settings));
      opening = false;
      if (budget.stopped()) { void closeContext(); return interrupted(); }
    } catch (err) {
      opening = false;
      if (budget.stopped()) return interrupted();
      if (err instanceof TestDefinitionError) return done({ outcome: 'test-invalid', reason: err.message });
      return done({ outcome: 'env-error', reason: `newContext failed: ${firstLine(err)}` });
    }
    try {
      page = await context.newPage();
    } catch (err) {
      if (budget.stopped()) return interrupted();
      return done({ outcome: 'env-error', reason: `newPage failed: ${firstLine(err)}` });
    }
    if (budget.stopped()) return interrupted();
    page.on('pageerror', (e) => obs.pageErrors.push(e?.name ? `${e.name}: ${e.message}` : String(e)));
    page.on('console', (m) => { if (m.type() === 'error') obs.consoleErrors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) obs.failedRequests.push(`${r.status()} ${r.request().method()} ${requestUrl(r.url())}`); });
    page.on('requestfailed', (r) => obs.failedRequests.push(`${r.failure()?.errorText ?? 'request failed'} ${r.method()} ${requestUrl(r.url())}`));
    if (history.some(Boolean)) poll = setInterval(() => { void sampleVisibility().catch(() => {}); }, 100);
    for (let i = 0; i < steps.length; i++) {
      currentStep = i;
      if (signal?.aborted) return done({ outcome: 'aborted', stepIndex: i });
      const step = steps[i];
      const t0 = performance.now();
      const r = await runStep(page, step, { baseUrl, stepTimeoutMs, navTimeoutMs, signal });
      resolved(`step:${i}`, r.resolvedBy);
      stepMs.push(Math.ceil(performance.now() - t0));
      if (signal?.aborted) return done({ outcome: 'aborted', stepIndex: i });
      if (!r.ok) {
        if (r.env) return done({ outcome: 'env-error', stepIndex: i, reason: r.reason });
        return done({ outcome: 'step-error', stepIndex: i, reason: r.reason });
      }
      if (r.disabled) disabledSteps.push(i);
      if (r.loose) looseSteps.push(i);
      await settle(page);
      if (budget.stopped()) return interrupted();
      if (step.check) {
        const c = await evaluate(page, step.check, obs, { settleMs: 1000, onResolution: (value) => checked(`checkpoint:${i}`, value) });
        if (!c.pass) return done({ outcome: 'precondition-fail', stepIndex: i, observed: c.observed ?? null, reason: `checkpoint after step ${i + 1} not met: ${c.invalid ?? c.observed}` });
      }
      await sampleVisibility();
      if (probe) await probe(page, i);
    }
    const onCheck = (index, value) => checked(`final:${index}`, value);
    const first = await evaluateAll(page, checks, checkObservations, { settleMs, onCheck });
    if (first) return complete(first);
    if (observeMs > 0) {
      const start = performance.now();
      const deadline = start + observeMs;
      let previous = start;
      observation = { method: 'poll', intervalMs: 50, samples: 1, elapsedMs: 0, maxGapMs: 0 };
      do {
        if (signal?.aborted) return done({ outcome: 'aborted' });
        await page.waitForTimeout(Math.min(50, Math.max(0, deadline - performance.now())));
        if (signal?.aborted) return done({ outcome: 'aborted' });
        const now = performance.now();
        observation.maxGapMs = Math.max(observation.maxGapMs, Math.ceil(now - previous));
        previous = now;
        observation.samples++;
        const late = await evaluateAll(page, checks, checkObservations, { settleMs: 0, targetWaitMs: 0, late: true, onCheck });
        observation.elapsedMs = Math.ceil(performance.now() - start);
        if (late) return complete({ ...late, late: true });
      } while (performance.now() < deadline);
    }
    return complete({ outcome: 'pass', ...(observeMs > 0 ? { observedMs: observeMs } : {}) });
  };
  let result;
  let cleanup;
  try {
    result = await Promise.race([execute(), interruption]);
  } catch (err) {
    if (budget.stopped()) result = interrupted();
    else if (err instanceof TestDefinitionError) result = done({ outcome: 'test-invalid', reason: err.message });
    else if (NETWORK_DOWN.test(err.message)) result = done({ outcome: 'env-error', reason: firstLine(err) });
    else result = done({ outcome: 'step-error', reason: firstLine(err) });
  } finally {
    active = false;
    clearInterval(poll);
    signal.removeEventListener('abort', onAbort);
    // Closing only this trial's context cancels pending DOM reads, including a frozen
    // renderer. Do not close the browser shared with unrelated tasks.
    const close = closeContext();
    cleanup = close ? await finishCleanup(close) : opening ? { status: 'pending', reason: 'context creation has not finished; late contexts will be closed' } : null;
    void pendingSample?.catch(() => {});
    const stopped = budget.stopped();
    budget.dispose();
    if (stopped) result = interrupted();
  }
  if (cleanup && cleanup.status !== 'closed') {
    if (!['aborted', 'budget-exhausted'].includes(result.outcome)) result = complete({ outcome: 'env-error', reason: `context cleanup ${cleanup.status}` });
    result.cleanup = cleanup;
  }
  return { ...result, durationMs: Math.ceil(performance.now() - started) };
}

async function finishCleanup(close) {
  let timer;
  try {
    return await Promise.race([
      close.then(() => ({ status: 'closed' }), (err) => ({ status: 'failed', reason: firstLine(err) })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'pending', reason: 'context close exceeded 2000 ms cleanup grace' }), 2000); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Keep the first business failure for the summary, but bind its fingerprint to every
// check's outcome. An unusable definition cannot be hidden behind an earlier failure.
async function evaluateAll(page, checks, observations, { settleMs, targetWaitMs, late = false, onCheck }) {
  let failure = null;
  const results = [];
  for (let k = 0; k < checks.length; k++) {
    const v = await evaluate(page, checks[k], observations[k], { settleMs, ...(targetWaitMs !== undefined ? { targetWaitMs } : {}), onResolution: (value) => onCheck?.(k, value) });
    if (v.pass) {
      results.push({ check: k, outcome: 'pass', ...(v.resolvedBy ? { resolution: v.resolvedBy } : {}) });
      continue;
    }
    if (v.invalid) {
      if (!late) return { outcome: 'test-invalid', check: k, reason: v.invalid, checkResults: [...results, { check: k, outcome: 'invalid', reason: v.invalid }] };
      // Seen once and then gone is a real failure, not an unusable expectation.
      const signature = { kind: checks[k].kind, target: '', actual: `late:${v.invalid}` };
      results.push({ check: k, outcome: 'invalid', signature });
      failure ??= { outcome: 'fail', check: k, observed: v.invalid, signature };
      continue;
    }
    results.push({ check: k, outcome: 'fail', signature: v.signature });
    failure ??= { outcome: 'fail', check: k, signature: v.signature, observed: v.observed };
  }
  return failure ? { ...failure, signature: { ...failure.signature, check: failure.check, checks: results } } : null;
}

async function runStep(page, step, { baseUrl, stepTimeoutMs, navTimeoutMs, signal }) {
  if (step.action === 'goto') {
    try {
      await page.goto(new URL(step.url, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
      return { ok: true };
    } catch (err) {
      // A page that does not finish loading says something about the server or the machine,
      // not about the recording: environment, never TEST_INVALID.
      const timeout = err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(err?.message ?? '');
      return { ok: false, env: timeout || NETWORK_DOWN.test(err.message), reason: timeout ? `page load did not finish within ${navTimeoutMs} ms (server or machine too slow): ${firstLine(err)}` : firstLine(err) };
    }
  }
  if (step.action === 'key') {
    await page.keyboard.press(String(step.value));
    return { ok: true };
  }
  if (step.action === 'viewport') {
    await page.setViewportSize(validateViewport(step));
    return { ok: true };
  }
  if (step.action === 'exit-fullscreen') {
    await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
    return { ok: true };
  }
  const value = resolveValue(step.value);
  if (!value.ok) return { ok: false, env: true, reason: value.reason };
  const t = await resolveTarget(page, step.target, { timeoutMs: stepTimeoutMs, signal });
  if (signal?.aborted) return { ok: false, reason: 'aborted' };
  if (!t.ok) return { ok: false, reason: `target ${targetFailureReason(t)}` };
  const loose = Boolean(t.used?.loose);
  const opts = { timeout: stepTimeoutMs };
  // A user acting on a disabled control gets no effect; replay does the same but reports it,
  // so "fixed by disabling the trigger" can never pass silently.
  if (['click', 'fill', 'select', 'check', 'press'].includes(step.action) && (await t.locator.isDisabled().catch(() => false))) {
    return { ok: true, disabled: true, loose, resolvedBy: t.used };
  }
  try {
    switch (step.action) {
      case 'click': await t.locator.click(opts); break;
      case 'hover': await t.locator.hover(opts); break;
      case 'fill': await t.locator.fill(String(value.value ?? ''), opts); break;
      case 'select': await t.locator.selectOption(String(value.value), opts); break;
      case 'check': await t.locator.setChecked(Boolean(value.value), opts); break;
      case 'press': await t.locator.press(String(value.value), opts); break;
      default: throw new TestDefinitionError(`Unknown action "${step.action}"`);
    }
  } catch (err) {
    if (err instanceof TestDefinitionError) throw err;
    return { ok: false, reason: firstLine(err) };
  }
  return { ok: true, loose, resolvedBy: t.used };
}

function requestUrl(raw) {
  try { const url = new URL(raw); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '<unavailable URL>'; }
}

// Lets event handlers and one animation frame run, then waits (max 1 s) for running
// animations: a click during a popover's exit transition is often swallowed by its dismiss layer.
function settle(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const deadline = performance.now() + 1000;
    const tick = () => {
      const busy = document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations !== Infinity);
      if (!busy || performance.now() > deadline) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(() => setTimeout(tick, 0));
  })).catch(() => {});
}

function firstLine(err) {
  return String(err?.message ?? err).split('\n')[0];
}
