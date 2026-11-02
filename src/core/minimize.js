// Shortens a reproduced case by replay only (zero model calls). Every candidate is judged by
// a three-valued test:
//   FAIL       - the candidate fails with the SAME signature as the original (keep it)
//   PASS       - the candidate no longer fails
//   UNRESOLVED - a step could not run, or it failed differently (never accepted)
// Strategies:
//   'units' (default) - probe which earlier step makes each step's target appear, delete a step
//                       together with its dependents, test all such deletions in parallel, then
//                       accept them jointly (or greedily). Ends 1-minimal w.r.t. those units.
//   'ddmin'           - classic delta debugging (Zeller & Hildebrandt 2002), kept for comparison.
// The result is the shortest case verified within budget, not a proven global minimum.
import { runTrial } from './replay.js';
import { signatureKey } from './oracle.js';
import { contractOf, reproduce, Status } from './reproduce.js';
import { resolveTarget } from './locator.js';

const FAIL = 'FAIL';
const PASS = 'PASS';
const UNRESOLVED = 'UNRESOLVED';

export async function minimize(browser, testCase, {
  baseUrl,
  signature,
  match = testCase.match ?? 'strict',
  strategy = 'units',
  maxTrials = 80,
  maxMs = 120_000,
  confirmRuns = 3,
  concurrency = 4,
  // A deleted precondition usually shows up as a missing target, so fail fast on it — but no
  // faster than the app needs: by default 3x the slowest non-navigation step of the original,
  // at least 2 s (a loaded machine makes single timings noisy; too short only wastes candidates).
  stepTimeoutMs,
  // Whether the original failure showed only during the observation window (reproduce's
  // `late`). If not, candidate trials skip the window: a candidate that would fail only later is
  // judged PASS, which keeps steps (never a wrong reduction), and a PASS stops costing the
  // window. The final k/k confirmation always uses the case's own window.
  late = false,
  signal,
} = {}) {
  const started = Date.now();
  const contract = { ...contractOf(testCase), ...(late ? {} : { observeMs: 0 }) };
  if (stepTimeoutMs === undefined) {
    const timing = await runTrial(browser, { baseUrl, steps: testCase.steps, ...contract, signal });
    const slowest = Math.max(0, ...timing.stepMs.filter((_, i) => testCase.steps[i]?.action !== 'goto'));
    stepTimeoutMs = Math.min(8000, Math.max(2000, 3 * slowest + 500));
  }
  const steps = testCase.steps;
  const want = signatureKey(signature, match);
  if (!want) throw new Error('minimize() needs the signature of a REPRODUCED case');

  // First goto is the precondition; steps the user pinned or attached a checkpoint to are kept
  // as well (a candidate must also still pass every checkpoint, see replay.runTrial).
  const pinned = new Set(steps.map((s, i) => (i === 0 || s.pinned || s.check ? i : -1)).filter((i) => i >= 0));
  const cache = new Map();
  const stats = { trials: 0, probeRuns: 0, cacheHits: 0, unresolved: 0, differentFailure: 0 };
  let exhausted = false;

  const build = (idx) => [...new Set([...pinned, ...idx])].sort((a, b) => a - b);

  async function trial(keep) {
    stats.trials++;
    const t = await runTrial(browser, { baseUrl, steps: keep.map((i) => steps[i]), ...contract, stepTimeoutMs, signal });
    if (process.env.BUGGPS_DEBUG) console.error(`[minimize] keep=${keep.join(',')} -> ${t.outcome} ${t.observed ?? t.reason ?? ''} (${t.durationMs}ms)`);
    if (t.outcome === 'pass') return PASS;
    if (t.outcome === 'fail' && signatureKey(t.signature, match) === want) return FAIL;
    if (t.outcome === 'fail') stats.differentFailure++;
    else stats.unresolved++;
    return UNRESOLVED;
  }

  // Tests candidates in parallel (each in its own BrowserContext); callers pick the first FAIL
  // in candidate order, so the result does not depend on scheduling.
  async function testMany(candidates) {
    const keys = candidates.map((idx) => build(idx).join(','));
    const todo = [...new Set(keys.filter((k) => !cache.has(k)))];
    stats.cacheHits += keys.length - todo.length;
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        if (stats.trials >= maxTrials || Date.now() - started > maxMs || signal?.aborted) { exhausted = true; return; }
        const key = todo[next++];
        cache.set(key, await trial(key.split(',').map(Number)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    return keys.map((k) => cache.get(k) ?? UNRESOLVED);
  }

  let current = steps.map((_, i) => i).filter((i) => !pinned.has(i));

  // Domain rule: of consecutive fills into the same target only the last one matters.
  const collapsed = collapseFills(steps, current);
  if (collapsed.length < current.length && (await testMany([collapsed]))[0] === FAIL) current = collapsed;

  if (strategy === 'ddmin') {
    current = await ddmin(current, testMany, () => exhausted);
  } else {
    // Dependencies are re-probed on the current reduced case each round: a step that was only
    // needed to undo an earlier (now deleted) step stops looking like a precondition.
    const depsFor = async (idx) => {
      stats.probeRuns++;
      const keep = build(idx);
      const local = await probeDependencies(browser, { baseUrl, steps: keep.map((i) => steps[i]), expectation: testCase.expectation, signal });
      const deps = new Map();
      local.forEach(({ all, last }, k) => deps.set(keep[k], { all: new Set([...all].map((j) => keep[j])), last: last === null ? null : keep[last] }));
      if (process.env.BUGGPS_DEBUG) console.error(`[minimize] deps ${[...deps].map(([k, d]) => `${k}<-{${[...d.all]}} last=${d.last}`).join('  ')}`);
      return deps;
    };
    current = await unitsPass(current, depsFor, pinned, testMany, () => exhausted);
  }

  const kept = build(current);
  const minimized = { ...testCase, steps: kept.map((i) => steps[i]) };
  // Re-confirm k/k: a candidate accepted on a single trial must hold up like the original.
  const confirm = await reproduce(browser, minimized, { baseUrl, runs: confirmRuns, match, signal });
  const confirmed = confirm.status === Status.REPRODUCED && confirm.signatureKey === want;
  return {
    status: exhausted ? Status.BUDGET_EXHAUSTED : 'DONE',
    strategy,
    confirmed,
    originalSteps: steps.length,
    minimizedSteps: confirmed ? kept.length : steps.length,
    keptIndices: confirmed ? kept : steps.map((_, i) => i),
    testCase: confirmed ? minimized : testCase,
    confirm: { status: confirm.status, tally: confirm.tally },
    stats: { ...stats, stepTimeoutMs, durationMs: Date.now() - started, modelCalls: 0 },
  };
}

async function ddmin(current, testMany, isExhausted) {
  let n = 2;
  while (current.length >= 2 && !isExhausted()) {
    const chunks = split(current, n);
    let reduced = false;
    const s = (await testMany(chunks)).indexOf(FAIL);
    if (s >= 0) { current = chunks[s]; n = 2; reduced = true; }
    if (!reduced && chunks.length > 2) {
      const complements = chunks.map((_, i) => chunks.filter((__, j) => j !== i).flat());
      const c = (await testMany(complements)).indexOf(FAIL);
      if (c >= 0) { current = complements[c]; n = Math.max(n - 1, 2); reduced = true; }
    }
    if (!reduced) {
      if (n >= current.length) break;
      n = Math.min(n * 2, current.length);
    }
  }
  if (current.length === 1 && !isExhausted() && (await testMany([[]]))[0] === FAIL) current = [];
  return current;
}

async function unitsPass(current, depsFor, pinned, testMany, isExhausted) {
  for (;;) {
    if (isExhausted()) return current;
    // closure(j): j plus every later step whose target became usable after j (transitively).
    // lastDependents(j): steps whose target became usable most recently because of j.
    const dependents = new Map();
    const lastDependents = new Map();
    (await depsFor(current)).forEach(({ all, last }, k) => {
      all.forEach((j) => dependents.set(j, [...(dependents.get(j) ?? []), k]));
      if (last !== null) lastDependents.set(last, [...(lastDependents.get(last) ?? []), k]);
    });
    const closure = (j) => {
      const out = new Set([j]);
      const stack = [j];
      while (stack.length) for (const k of dependents.get(stack.pop()) ?? []) if (!out.has(k)) { out.add(k); stack.push(k); }
      return out;
    };
    // Per step: the transitive closure, plus the step with only the steps it most recently
    // enabled. The latter catches open/close pairs: "close dialog" re-enables later targets, so
    // the transitive closure of "open dialog" would wrongly drag everything after it along.
    const keepable = (r) => [...r].filter((i) => current.includes(i) && !pinned.has(i)).sort((a, b) => a - b);
    const removals = [...current].reverse()
      .flatMap((j) => [keepable(closure(j)), keepable([j, ...(lastDependents.get(j) ?? [])])])
      .filter((r, i, all) => r.length && all.findIndex((x) => x.join() === r.join()) === i);
    const cands = removals.map((r) => current.filter((i) => !r.includes(i)));
    const verdicts = await testMany(cands);
    const ok = removals.filter((_, i) => verdicts[i] === FAIL);
    if (!ok.length) return current;
    const joint = current.filter((i) => !ok.some((r) => r.includes(i)));
    if ((await testMany([joint]))[0] === FAIL) { current = joint; continue; }
    // Removals interact: accept them one at a time, keeping each only if it still reproduces.
    let acc = current;
    for (const r of ok) {
      const cand = acc.filter((i) => !r.includes(i));
      if (cand.length < acc.length && (await testMany([cand]))[0] === FAIL) acc = cand;
      if (isExhausted()) break;
    }
    if (acc.length === current.length) return current;
    current = acc;
  }
}

/**
 * One instrumented replay of the original case. After each step it checks which later step
 * targets are usable (unique and visible); step k depends on step j when its target turned
 * usable right after j. Only an efficiency hint: every deletion is still tested by replay.
 */
export async function probeDependencies(browser, { baseUrl, steps, expectation, signal }) {
  const ready = steps.map(() => []);
  const probe = async (page, i) => {
    // Open/close transitions leave elements visible for a few hundred ms; wait them out so a
    // closing dialog does not look like it is still there.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 1500 }).catch(() => {});
    for (let k = i + 1; k < steps.length; k++) {
      if (!steps[k].target || steps[k].action === 'key') { ready[k][i] = true; continue; }
      const r = await resolveTarget(page, steps[k].target, { timeoutMs: 0 });
      ready[k][i] = r.ok && (await r.locator.isVisible().catch(() => false));
    }
  };
  await runTrial(browser, { baseUrl, steps, expectation, signal, probe });
  return steps.map((_, k) => {
    const all = new Set();
    let last = null;
    for (let j = 1; j < k; j++) if (ready[k][j] && !ready[k][j - 1]) { all.add(j); last = j; }
    return { all, last };
  });
}

function split(items, n) {
  const out = [];
  const size = Math.ceil(items.length / n);
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function collapseFills(steps, idx) {
  return idx.filter((i, k) => {
    const next = idx[k + 1];
    if (next === undefined) return true;
    const a = steps[i];
    const b = steps[next];
    return !(a.action === 'fill' && b.action === 'fill' && JSON.stringify(a.target) === JSON.stringify(b.target));
  });
}
