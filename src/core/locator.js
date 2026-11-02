// Step targets are recorded as an ordered list of candidate locators. Replay uses the first
// candidate that resolves to exactly one element; coordinates and indices are never used.
import { TestDefinitionError } from './errors.js';

export function candidateLocator(page, c, { loose = false } = {}) {
  switch (c.by) {
    case 'testId': return page.getByTestId(c.value);
    case 'role': {
      const scope = c.within ? page.getByRole(c.within.role, { name: c.within.name, exact: true }) : page;
      let loc = scope.getByRole(c.role, c.name ? { name: c.name, exact: !loose } : {});
      if (c.child) loc = loc.filter({ has: page.getByRole(c.child.role, { name: c.child.name, exact: true }) });
      return c.within && Number.isInteger(c.index) ? loc.nth(c.index) : loc;
    }
    case 'label': return page.getByLabel(c.value, { exact: true });
    case 'text': {
      if (!c.within) return page.getByText(c.value, { exact: true });
      return page.getByRole(c.within.role, { name: c.within.name, exact: true }).getByText(c.value, { exact: true }).nth(c.index);
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

/** Resolves a target to a unique locator, or reports why it could not. */
// The loose fallback only kicks in after exact candidates kept failing this long: while a menu
// or dialog animates in, the exact name can be briefly absent, and a loose match taken in that
// moment would be reported as locator drift although nothing about the element changed.
const LOOSE_AFTER_MS = 1500;

export async function resolveTarget(page, target, { timeoutMs = 2000 } = {}) {
  const candidates = candidatesOf(target);
  const started = Date.now();
  const deadline = started + timeoutMs;
  let lastCounts = [];
  do {
    lastCounts = [];
    for (const c of candidates) {
      const loc = candidateLocator(page, c);
      const n = await loc.count();
      lastCounts.push(n);
      if (n === 1) return { ok: true, locator: loc, used: c };
    }
    // Weaker fallback: a recorded role name that is a substring of the real accessible name
    // (e.g. icon labels prepended). Still must be unique.
    const now = Date.now();
    const looseAllowed = timeoutMs <= 0 || now - started >= LOOSE_AFTER_MS || now + 50 >= deadline;
    for (const c of looseAllowed ? candidates : []) {
      if (c.by !== 'role' || !c.name) continue;
      const loc = candidateLocator(page, c, { loose: true });
      if ((await loc.count()) === 1) return { ok: true, locator: loc, used: { ...c, loose: true } };
    }
    if (timeoutMs <= 0) break;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  const reason = lastCounts.some((n) => n > 1) ? 'ambiguous' : 'not-found';
  return { ok: false, reason, counts: lastCounts };
}

export function targetKey(target) {
  const c = candidatesOf(target)[0];
  switch (c.by) {
    case 'role': return `${c.within ? `${c.within.role}[name=${c.within.name}] >> ` : ''}role=${c.role}[name=${c.name ?? ''}]${c.child ? `>>${c.child.role}[name=${c.child.name}]` : ''}${c.within ? `#${c.index}` : ''}`;
    case 'page': return 'page';
    default: return `${c.by}=${c.value}`;
  }
}
