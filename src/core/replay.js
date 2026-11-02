// Deterministic replay of one trial: fresh BrowserContext (no cookies/storage carry-over),
// steps executed in order, then the expectation is evaluated. No model calls happen here.
import { resolveTarget } from './locator.js';
import { evaluate } from './oracle.js';
import { TestDefinitionError } from './errors.js';

const NETWORK_DOWN = /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_UNSAFE_PORT|ERR_INTERNET_DISCONNECTED/;

/**
 * @returns {Promise<{outcome:'pass'|'fail'|'step-error'|'env-error'|'test-invalid', ...}>}
 */
export async function runTrial(browser, { baseUrl, steps, expectation, stepTimeoutMs = 5000, navTimeoutMs = 15_000, settleMs = 250, signal, probe }) {
  const started = Date.now();
  const obs = { pageErrors: [], consoleErrors: [], failedRequests: [] };
  let context;
  try {
    context = await browser.newContext();
  } catch (err) {
    return { outcome: 'env-error', reason: `newContext failed: ${err.message}`, durationMs: Date.now() - started };
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => obs.pageErrors.push(e?.name ? `${e.name}: ${e.message}` : String(e)));
  page.on('console', (m) => { if (m.type() === 'error') obs.consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) obs.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

  const disabledSteps = [];
  const stepMs = [];
  const done = (r) => ({ ...r, ...(disabledSteps.length ? { disabledSteps } : {}), stepMs, durationMs: Date.now() - started, observations: obs });
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
      stepMs.push(Date.now() - t0);
      if (!r.ok) {
        if (r.env) return done({ outcome: 'env-error', stepIndex: i, reason: r.reason });
        return done({ outcome: 'step-error', stepIndex: i, reason: r.reason });
      }
      if (r.disabled) disabledSteps.push(i);
      await settle(page);
      // Deterministic check after every step, in addition to the background poll.
      if (expectation?.kind === 'visible' && !obs.seenTarget && i < steps.length - 1) obs.seenTarget = await isVisibleNow(page, expectation.target);
      if (probe) await probe(page, i);
    }
    const verdict = await evaluate(page, expectation, obs, { settleMs });
    if (verdict.invalid) return done({ outcome: 'test-invalid', reason: verdict.invalid });
    if (verdict.pass) return done({ outcome: 'pass' });
    return done({ outcome: 'fail', signature: verdict.signature, observed: verdict.observed });
  } catch (err) {
    if (err instanceof TestDefinitionError) return done({ outcome: 'test-invalid', reason: err.message });
    if (NETWORK_DOWN.test(err.message)) return done({ outcome: 'env-error', reason: firstLine(err) });
    return done({ outcome: 'step-error', reason: firstLine(err) });
  } finally {
    clearInterval(poll);
    await context.close().catch(() => {});
  }
}

async function runStep(page, step, { baseUrl, stepTimeoutMs, navTimeoutMs }) {
  if (step.action === 'goto') {
    try {
      await page.goto(new URL(step.url, baseUrl).href, { waitUntil: 'load', timeout: navTimeoutMs });
      return { ok: true };
    } catch (err) {
      return { ok: false, env: NETWORK_DOWN.test(err.message), reason: firstLine(err) };
    }
  }
  if (step.action === 'key') {
    await page.keyboard.press(String(step.value));
    return { ok: true };
  }
  const t = await resolveTarget(page, step.target, { timeoutMs: stepTimeoutMs });
  if (!t.ok) return { ok: false, reason: `target ${t.reason}` };
  const opts = { timeout: stepTimeoutMs };
  // A user acting on a disabled control gets no effect; replay does the same but reports it,
  // so "fixed by disabling the trigger" can never pass silently.
  if (['click', 'fill', 'select', 'check', 'press'].includes(step.action) && (await t.locator.isDisabled().catch(() => false))) {
    return { ok: true, disabled: true };
  }
  try {
    switch (step.action) {
      case 'click': await t.locator.click(opts); break;
      case 'hover': await t.locator.hover(opts); break;
      case 'fill': await t.locator.fill(String(step.value ?? ''), opts); break;
      case 'select': await t.locator.selectOption(String(step.value), opts); break;
      case 'check': await t.locator.setChecked(Boolean(step.value), opts); break;
      case 'press': await t.locator.press(String(step.value), opts); break;
      default: throw new TestDefinitionError(`Unknown action "${step.action}"`);
    }
  } catch (err) {
    if (err instanceof TestDefinitionError) throw err;
    return { ok: false, reason: firstLine(err) };
  }
  return { ok: true };
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
