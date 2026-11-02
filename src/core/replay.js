// Deterministic replay of one trial: fresh BrowserContext (no cookies/storage carry-over),
// steps executed in order, then the expectation is evaluated. No model calls happen here.
import { resolveTarget } from './locator.js';
import { evaluate } from './oracle.js';
import { resolveValue } from './secrets.js';
import { TestDefinitionError } from './errors.js';
import { browserOptions, validateViewport } from './browser-options.js';
import { canonicalJson } from './canonical.js';

const NETWORK_DOWN = /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_UNSAFE_PORT|ERR_INTERNET_DISCONNECTED/;

/**
 * One trial of the case contract:
 *   - after step i, `steps[i].check` (a checkpoint) must hold, or the trial is
 *     'precondition-fail': the recorded situation was not reached, so the end result says nothing;
 *   - after the last step the primary `expectation` is evaluated, then every check in `also`;
 *   - after initial success, checks are sampled throughout `observeMs` with a 50 ms target interval.
 * @returns {Promise<{outcome:'pass'|'fail'|'precondition-fail'|'step-error'|'env-error'|'test-invalid'|'aborted', ...}>}
 */
export async function runTrial(browser, { baseUrl, steps, expectation, also = [], observeMs = 0, browser: settings, stepTimeoutMs = 5000, navTimeoutMs = 45_000, settleMs = 250, signal, probe }) {
  const started = Date.now();
  const obs = { pageErrors: [], consoleErrors: [], failedRequests: [] };
  let context;
  try {
    context = await browser.newContext(browserOptions(settings));
  } catch (err) {
    if (err instanceof TestDefinitionError) return { outcome: 'test-invalid', reason: err.message, durationMs: Date.now() - started };
    return { outcome: 'env-error', reason: `newContext failed: ${err.message}`, durationMs: Date.now() - started };
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => obs.pageErrors.push(e?.name ? `${e.name}: ${e.message}` : String(e)));
  page.on('console', (m) => { if (m.type() === 'error') obs.consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) obs.failedRequests.push(`${r.status()} ${r.request().method()} ${requestUrl(r.url())}`); });
  page.on('requestfailed', (r) => obs.failedRequests.push(`${r.failure()?.errorText ?? 'request failed'} ${r.method()} ${requestUrl(r.url())}`));

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
  const done = (r) => ({ ...r, resolutionProfile, ...(disabledSteps.length ? { disabledSteps } : {}), ...(looseSteps.length ? { looseSteps } : {}), ...(looseChecks.size ? { looseChecks: [...looseChecks].sort() } : {}), ...(observation ? { observation } : {}), stepMs, durationMs: Date.now() - started, observations: obs });
  const checked = (key, value) => { resolved(key, value); if (value?.loose) looseChecks.add(key); };
  // Poll (not just between steps): content that renders asynchronously, then vanishes, would
  // otherwise be missed depending on timing.
  let poll;
  if (expectation?.kind === 'visible') {
    let busy = false;
    poll = setInterval(async () => {
      if (obs.seenTarget || busy) return;
      busy = true;
      obs.seenTarget = await isVisibleNow(page, expectation.target);
      busy = false;
    }, 100);
  }
  try {
    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) return done({ outcome: 'aborted', stepIndex: i });
      const step = steps[i];
      const t0 = Date.now();
      const r = await runStep(page, step, { baseUrl, stepTimeoutMs, navTimeoutMs });
      resolved(`step:${i}`, r.resolvedBy);
      stepMs.push(Date.now() - t0);
      if (!r.ok) {
        if (r.env) return done({ outcome: 'env-error', stepIndex: i, reason: r.reason });
        return done({ outcome: 'step-error', stepIndex: i, reason: r.reason });
      }
      if (r.disabled) disabledSteps.push(i);
      if (r.loose) looseSteps.push(i);
      await settle(page);
      if (step.check) {
        const c = await evaluate(page, step.check, obs, { settleMs: 1000, onResolution: (value) => checked(`checkpoint:${i}`, value) });
        if (!c.pass) return done({ outcome: 'precondition-fail', stepIndex: i, observed: c.observed ?? null, reason: `checkpoint after step ${i + 1} not met: ${c.invalid ?? c.observed}` });
      }
      // Deterministic check after every step, in addition to the background poll.
      if (expectation?.kind === 'visible' && !obs.seenTarget && i < steps.length - 1) obs.seenTarget = await isVisibleNow(page, expectation.target);
      if (probe) await probe(page, i);
    }
    const checks = [expectation, ...also];
    const onCheck = (index, value) => checked(`final:${index}`, value);
    const first = await evaluateAll(page, checks, obs, { settleMs, onCheck });
    if (first) return done(first);
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
        const late = await evaluateAll(page, checks, obs, { settleMs: 0, targetWaitMs: 0, late: true, onCheck });
        observation.elapsedMs = Math.ceil(performance.now() - start);
        if (late) return done({ ...late, late: true });
      } while (performance.now() < deadline);
    }
    return done({ outcome: 'pass', ...(observeMs > 0 ? { observedMs: observeMs } : {}) });
  } catch (err) {
    if (signal?.aborted) return done({ outcome: 'aborted' });
    if (err instanceof TestDefinitionError) return done({ outcome: 'test-invalid', reason: err.message });
    if (NETWORK_DOWN.test(err.message)) return done({ outcome: 'env-error', reason: firstLine(err) });
    return done({ outcome: 'step-error', reason: firstLine(err) });
  } finally {
    clearInterval(poll);
    await context.close().catch(() => {});
  }
}

// First failing check in order (primary first, so the RED signature is always the primary's),
// or null when all pass.
async function evaluateAll(page, checks, obs, { settleMs, targetWaitMs, late = false, onCheck }) {
  let failure = null;
  for (let k = 0; k < checks.length; k++) {
    const v = await evaluate(page, checks[k], obs, { settleMs, ...(targetWaitMs !== undefined ? { targetWaitMs } : {}), onResolution: (value) => onCheck?.(k, value) });
    if (v.pass) continue;
    if (v.invalid) {
      // Seen once and then gone is a real failure, not an unusable expectation.
      failure ??= late ? { outcome: 'fail', check: k, observed: v.invalid, signature: { kind: checks[k].kind, target: '', actual: `late:${v.invalid}` } } : { outcome: 'test-invalid', reason: v.invalid };
      continue;
    }
    failure ??= { outcome: 'fail', check: k, signature: v.signature, observed: v.observed };
  }
  return failure;
}

async function runStep(page, step, { baseUrl, stepTimeoutMs, navTimeoutMs }) {
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
  const value = resolveValue(step.value);
  if (!value.ok) return { ok: false, env: true, reason: value.reason };
  const t = await resolveTarget(page, step.target, { timeoutMs: stepTimeoutMs });
  if (!t.ok) return { ok: false, reason: `target ${t.reason}` };
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

// For "should be visible" expectations: was the target ever visible during this trial? A bug
// that removes an element and a replay that never reached it look identical at the end.
async function isVisibleNow(page, target) {
  const r = await resolveTarget(page, target, { timeoutMs: 0 }).catch(() => ({ ok: false }));
  return r.ok ? r.locator.isVisible().catch(() => false) : false;
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
