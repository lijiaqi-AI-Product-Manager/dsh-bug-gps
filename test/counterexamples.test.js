// Ways a "fix" can pass the checks without fixing anything (from an external review of the
// first prototype). Each must end in a verdict that does not claim the bug is fixed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withEnv, tempRepo, serveSpec } from './helpers.js';
import { recordSession } from '../bench/sessions.js';
import { startStaticServer } from '../examples/serve.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { Status } from '../src/core/reproduce.js';
import { git } from '../src/core/snapshot.js';
import { createToolSpecs } from '../src/dsh/tools.js';

const BUG1 = /\/\/ SEEDED BUG 1: should call recompute\(\);[^\r\n]*\r?\n\s*renderCart\(\);/;
const FIX1 = (src) => src.replace(BUG1, '      recompute();');
const BUG2_LINE = /\s*state\.changelog = undefined; \/\/ SEEDED BUG 2[^\r\n]*/;
const FIX2 = (src) => src.replace(BUG2_LINE, '');
const SECOND_CLICK = "  $('#changelog').textContent = state.changelog.join(', ');\n};";

let repo; let env; let serve;
const appJs = () => join(repo.root, 'app.js');
const edit = async (fn) => {
  const before = await readFile(appJs(), 'utf8');
  const after = fn(before.replace(/\r\n/g, '\n'));
  assert.notEqual(after, before.replace(/\r\n/g, '\n'), 'edit did not apply');
  await writeFile(appJs(), after);
};
const restore = () => git(repo.root, ['checkout', '-q', '--', 'app.js']);

before(async () => {
  repo = await tempRepo();
  env = await withEnv(repo.root);
  serve = await serveSpec(repo.root);
});
after(async () => { await env?.close(); await repo?.cleanup(); });

test('binding: a pass at a URL BugGPS did not start is PASSED_UNBOUND, never VERIFIED', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  const locked = await lockCase(env.browser, env, repo.root, s, { baseUrl: env.url, id: 'ext' });
  assert.equal(locked.status, Status.REPRODUCED);
  assert.equal(locked.lock.binding, 'external');
  // Repo keeps the bug; only a notes file changes. The URL now serves a different, fixed copy.
  await writeFile(join(repo.root, 'NOTES.md'), 'investigated\n');
  const fixed = await tempRepo();
  await writeFile(join(fixed.root, 'app.js'), FIX1((await readFile(join(fixed.root, 'app.js'), 'utf8')).replace(/\r\n/g, '\n')));
  const other = await startStaticServer(fixed.root);
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'ext', { baseUrl: other.url });
    assert.equal(r.verdict, Verdict.PASSED_UNBOUND);
    assert.equal(r.binding.mode, 'external');
    assert.match(r.patch.stat, /NOTES\.md/);
  } finally { await other.close(); await fixed.cleanup(); }
});

test('binding: with a serve command the same trick is STILL_FAILING (the served code is this tree)', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  const locked = await lockCase(env.browser, env, repo.root, { ...s, serve }, { baseUrl: env.url, id: 'managed' });
  assert.equal(locked.status, Status.REPRODUCED);
  assert.equal(locked.lock.binding, 'managed');
  await writeFile(join(repo.root, 'NOTES.md'), 'investigated again\n');
  const r = await verifyCase(env.browser, env, repo.root, 'managed', { baseUrl: 'http://127.0.0.1:9/' });
  assert.equal(r.verdict, Verdict.STILL_FAILING);
  assert.equal(r.binding.mode, 'managed');
  assert.equal(r.treeBefore, r.treeAfter);
});

test('binding: something else on the serve port is ENV_BLOCKED, not a verdict about that server', async () => {
  const squatter = await startStaticServer(repo.root, Number(new URL(serve.url).port));
  try {
    await edit(FIX1);
    const r = await verifyCase(env.browser, env, repo.root, 'managed', {});
    assert.equal(r.verdict, Verdict.ENV_BLOCKED);
    assert.match(r.check.reason, /already serving/);
  } finally { await squatter.close(); await restore(); }
});

test('"no error" only: deleting the feature removes the error but is NEEDS_REVIEW (negative-only)', async () => {
  const s = await recordSession(env.browser, env.url, 'changelog-crash');
  const locked = await lockCase(env.browser, env, repo.root, { ...s, serve }, { baseUrl: env.url, id: 'crash-neg' });
  assert.equal(locked.status, Status.REPRODUCED);
  await edit((src) => src.replace(/\$\('#changelog-btn'\)\.onclick = \(\) => \{[\s\S]*?\n\};/, "$('#changelog-btn').onclick = () => {};"));
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'crash-neg', {});
    assert.equal(r.verdict, Verdict.NEEDS_REVIEW);
    assert.deepEqual(r.reviewReasons, ['negative-only']);
  } finally { await restore(); }
});

test('"no error" + a positive check: deleting the feature is DIFFERENT_FAILURE, the real fix is VERIFIED', async () => {
  const s = await recordSession(env.browser, env.url, 'changelog-crash');
  const also = [{ kind: 'text', target: [{ by: 'css', value: '#changelog' }], equals: '0.1.0 initial' }];
  const locked = await lockCase(env.browser, env, repo.root, { ...s, also, serve }, { baseUrl: env.url, id: 'crash-pos' });
  assert.equal(locked.status, Status.REPRODUCED);
  // Delete the handler's content: no error any more, and no changelog either.
  await edit((src) => src.replace(/\$\('#changelog-btn'\)\.onclick = \(\) => \{[\s\S]*?\n\};/, "$('#changelog-btn').onclick = () => {};"));
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'crash-pos', {});
    assert.equal(r.verdict, Verdict.DIFFERENT_FAILURE);
  } finally { await restore(); }
  await edit(FIX2);
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'crash-pos', {});
    assert.equal(r.verdict, Verdict.VERIFIED, JSON.stringify(r.check));
  } finally { await restore(); }
});

test('timing: an error deferred by 800 ms still fails inside the observation window', async () => {
  const s = await recordSession(env.browser, env.url, 'changelog-crash');
  const also = [{ kind: 'text', target: [{ by: 'css', value: '#changelog' }], equals: '0.1.0 initial' }];
  const locked = await lockCase(env.browser, env, repo.root, { ...s, also, serve }, { baseUrl: env.url, id: 'crash-late' });
  assert.equal(locked.status, Status.REPRODUCED);
  await edit((src) => src.replace(SECOND_CLICK, "  setTimeout(() => { $('#changelog').textContent = state.changelog.join(', '); }, 800);\n};"));
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'crash-late', {});
    assert.equal(r.verdict, Verdict.STILL_FAILING);
    assert.equal(r.observeMs, 1000);
  } finally { await restore(); }
});

test('checkpoint: a fix that changes what happens before the symptom is DIFFERENT_FAILURE', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  const i = s.steps.findIndex((st) => st.target?.[0]?.name === 'Apply coupon');
  assert.ok(i > 0);
  const steps = s.steps.map((st, k) => (k === i ? { ...st, check: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$27.00' } } : st));
  const locked = await lockCase(env.browser, env, repo.root, { ...s, steps, serve }, { baseUrl: env.url, id: 'ckpt' });
  assert.equal(locked.status, Status.REPRODUCED, JSON.stringify(locked.red?.reason));
  // "Fix": coupons no longer apply at all, so the stale discount cannot happen.
  await edit((src) => src.replace("=== 'SAVE10' ? 'SAVE10' : null", "=== 'NEVER' ? 'SAVE10' : null"));
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'ckpt', {});
    assert.equal(r.verdict, Verdict.DIFFERENT_FAILURE);
    assert.equal(r.check.status, Status.PRECONDITION_FAILED);
    assert.match(r.check.reason, /checkpoint after step/);
  } finally { await restore(); }
});

test('locator drift: a real fix that also renames the clicked button is NEEDS_REVIEW', async () => {
  await edit((src) => FIX1(src).replace('rm.textContent = `Remove ${p.name}`;', 'rm.textContent = `Remove ${p.name} item`;'));
  try {
    const r = await verifyCase(env.browser, env, repo.root, 'managed', {});
    assert.equal(r.verdict, Verdict.NEEDS_REVIEW, JSON.stringify(r.check));
    assert.deepEqual(r.reviewReasons, ['locator-drift']);
  } finally { await restore(); }
});

test('same case id in two repositories: no false CASE_TAMPERED across projects', async () => {
  const other = await tempRepo();
  const otherEnv = await withEnv(other.root);
  try {
    const s = await recordSession(env.browser, env.url, 'stale-discount');
    for (const r of [repo, other]) {
      await mkdir(join(r.root, '.buggps', 'drafts'), { recursive: true });
      await writeFile(join(r.root, '.buggps', 'drafts', 'd.json'), JSON.stringify({ steps: s.steps, expectation: s.expectation }));
    }
    let cwd = repo.root;
    const tools = createToolSpecs({ resolveCwd: async () => cwd, guardActive: () => true });
    const run = (name, args) => tools.find((t) => t.name === name).execute(args, { signal: new AbortController().signal });
    const a = await run('buggps_lock', { draft: '.buggps/drafts/d.json', case_id: 'same', url: env.url, minimize: false });
    assert.equal(a.status, 'LOCKED', JSON.stringify(a));
    cwd = other.root;
    const b = await run('buggps_lock', { draft: '.buggps/drafts/d.json', case_id: 'same', url: otherEnv.url, minimize: false, observe_ms: 500 });
    assert.equal(b.status, 'LOCKED', JSON.stringify(b));
    cwd = repo.root;
    const v = await run('buggps_verify', { case_id: 'same', url: env.url });
    assert.equal(v.status, 'NO_CODE_CHANGE', JSON.stringify(v));
  } finally { await otherEnv.close(); await other.cleanup(); }
});
