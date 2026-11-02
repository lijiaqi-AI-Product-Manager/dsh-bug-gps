// Step targets are recorded as an ordered list of candidate locators. Replay uses the first
// candidate that resolves to exactly one element. Indices only apply inside a unique
// recorded container; coordinates are never used.
import { TestDefinitionError } from './errors.js';
import { canonicalJson } from './canonical.js';

export function targetScope(page, c) {
  if (c.index !== undefined && (!c.within || !Number.isInteger(c.index))) throw new TestDefinitionError('A locator index needs an integer and an explicit container');
  if (!c.within) return null;
  if (!['role', 'text'].includes(c.by)) throw new TestDefinitionError('within is supported only on role/text locators');
  if (typeof c.within.role !== 'string' || !c.within.role || (c.within.name !== undefined && typeof c.within.name !== 'string')) throw new TestDefinitionError('A locator container needs a role and an optional string name');
  return page.getByRole(c.within.role, { name: c.within.name, exact: true });
}

export function candidateLocator(page, c, { loose = false } = {}) {
  const scope = targetScope(page, c) ?? page;
  switch (c.by) {
    case 'testId': return page.getByTestId(c.value);
    case 'role': {
      let loc = scope.getByRole(c.role, c.name ? { name: c.name, exact: !loose } : {});
      if (c.child) loc = loc.filter({ has: page.getByRole(c.child.role, { name: c.child.name, exact: true }) });
      return c.within && Number.isInteger(c.index) ? loc.nth(c.index) : loc;
    }
    case 'label': return page.getByLabel(c.value, { exact: true });
    case 'text': {
      if (!c.within) return page.getByText(c.value, { exact: true });
      const loc = scope.getByText(c.value, { exact: true });
      return Number.isInteger(c.index) ? loc.nth(c.index) : loc;
    }
    case 'css': return page.locator(c.value);
    default: throw new TestDefinitionError(`Unknown locator kind: ${JSON.stringify(c)}`);
  }
}

export function candidatesOf(target) {
  if (!target) throw new TestDefinitionError('Step has no target');
  const list = Array.isArray(target) ? target : [target];
  if (list.length === 0) throw new TestDefinitionError('Step target has no candidates');
  return list;
}

export function targetFailureReason(result) {
  return result.reason === 'ambiguous' && result.scopeCounts?.some((n) => n > 1) ? 'scope ambiguous' : result.reason;
}

/** Resolves a target to a unique locator, or reports why it could not. */
// Give a recorded scope or exact name a bounded chance to appear before weakening the
// query. A zero-time snapshot never waits, and a shorter caller deadline takes precedence.
const PREFERRED_MATCH_MS = 1500;
const withoutScope = ({ within, index, ...rest }) => canonicalJson(rest);

export async function resolveTarget(page, target, { timeoutMs = 2000, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TestDefinitionError('Locator timeoutMs must be a finite, non-negative number');
  const candidates = candidatesOf(target);
  const started = Date.now();
  const deadline = started + timeoutMs;
  let lastCounts = [];
  let scopeCounts = [];
  const fallbackReady = () => timeoutMs <= 0 || Date.now() - started >= PREFERRED_MATCH_MS || Date.now() + 50 >= deadline;
  for (;;) {
    const finalProbe = timeoutMs <= 0 || Date.now() >= deadline;
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    lastCounts = [];
    scopeCounts = [];
    const pendingScopes = new Set();
    for (const c of candidates) {
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      const scope = targetScope(page, c);
      const size = scope ? await scope.count() : 1;
      scopeCounts.push(size);
      if (size !== 1) {
        lastCounts.push(0);
        if (size === 0) pendingScopes.add(withoutScope(c));
        continue;
      }
      const loc = candidateLocator(page, c);
      const n = await loc.count();
      lastCounts.push(n);
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      if (n === 1 && (c.within || !pendingScopes.has(withoutScope(c)) || fallbackReady())) return { ok: true, locator: loc, used: c };
      if (c.within && n === 0) pendingScopes.add(withoutScope(c));
    }
    // Weaker fallback: a recorded role name that is a substring of the real accessible name
    // (e.g. icon labels prepended). Still must be unique.
    const looseAllowed = fallbackReady();
    for (const c of looseAllowed ? candidates : []) {
      if (c.by !== 'role' || !c.name) continue;
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      const scope = targetScope(page, c);
      if (scope && (await scope.count()) !== 1) continue;
      const loc = candidateLocator(page, c, { loose: true });
      const n = await loc.count();
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      if (n === 1) return { ok: true, locator: loc, used: { ...c, loose: true } };
    }
    const remaining = deadline - Date.now();
    if (finalProbe) break;
    // A late timer must not discard an exact candidate deferred on the previous pass.
    // Recheck once at the deadline without adding another wait.
    if (remaining > 0) await page.waitForTimeout(Math.min(50, remaining));
  }
  if (signal?.aborted) return { ok: false, reason: 'aborted' };
  const reason = lastCounts.some((n) => n > 1) || scopeCounts.some((n) => n > 1) ? 'ambiguous' : 'not-found';
  return { ok: false, reason, counts: lastCounts, scopeCounts };
}

export function targetKey(target) {
  const c = candidatesOf(target)[0];
  switch (c.by) {
    case 'role': return `${c.within ? `${c.within.role}[name=${c.within.name}] >> ` : ''}role=${c.role}[name=${c.name ?? ''}]${c.child ? `>>${c.child.role}[name=${c.child.name}]` : ''}${c.within ? `#${c.index}` : ''}`;
    case 'page': return 'page';
    default: return `${c.by}=${c.value}`;
  }
}
