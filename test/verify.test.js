import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withEnv, tempRepo, serveSpec } from './helpers.js';
import { recordSession } from '../bench/sessions.js';
import { lockCase, loadCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { Status } from '../src/core/reproduce.js';
import { git, snapshotTree } from '../src/core/snapshot.js';

// Regex so the edits work whether git checked app.js out with LF or CRLF.
const BUG = /\/\/ SEEDED BUG 1: should call recompute\(\);[^\r\n]*\r?\n\s*renderCart\(\);/;
// Plausible but wrong attempt: clamps a negative total, the stale discount remains.
const WRONG_FIX = (src) => src.replace('let total = subtotal() - state.discount;', 'let total = Math.max(0, subtotal() - state.discount);');
// Wrong in a different way: drops the discount entirely after removal.
const DIFFERENT_FIX = (src) => src.replace(BUG, '      state.discount = 0;\n      renderCart();');
const REAL_FIX = (src) => src.replace(BUG, '      recompute();');

let repo;
let env;
let caseId;
let serve; // BugGPS starts this server itself for every lock/verify run (managed binding)
const appJs = () => join(repo.root, 'app.js');
const edit = async (fn) => writeFile(appJs(), fn(await readFile(appJs(), 'utf8')));

before(async () => {
  repo = await tempRepo();
  env = await withEnv(repo.root);
  serve = await serveSpec(repo.root);
});
after(async () => { await env?.close(); await repo?.cleanup(); });

test('snapshot does not touch the index or worktree and sees untracked files', async () => {
  const statusBefore = await git(repo.root, ['status', '--porcelain']);
  const a = await snapshotTree(repo.root);
  await writeFile(join(repo.root, 'untracked.txt'), 'x');
  const b = await snapshotTree(repo.root);
  assert.notEqual(a, b);
  await git(repo.root, ['clean', '-fq', '--', 'untracked.txt']);
  assert.equal(await snapshotTree(repo.root), a);
  assert.equal(await git(repo.root, ['status', '--porcelain']), statusBefore);
});

test('lock requires a real reproduction on the baseline', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  const locked = await lockCase(env.browser, env, repo.root, { ...s, serve }, { baseUrl: env.url });
  assert.equal(locked.status, Status.REPRODUCED);
  caseId = locked.caseId;
  const { lock } = await loadCase(repo.root, caseId);
  assert.equal(lock.red.observed, '$17.00');
});

test('no code change cannot be VERIFIED', async () => {
  const r = await verifyCase(env.browser, env, repo.root, caseId, { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.NO_CODE_CHANGE);
});

test('wrong fix attempt is STILL_FAILING', async () => {
  await edit(WRONG_FIX);
  const r = await verifyCase(env.browser, env, repo.root, caseId, { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.STILL_FAILING);
  await git(repo.root, ['checkout', '-q', '--', 'app.js']);
});

test('fix that changes the symptom is DIFFERENT_FAILURE, not VERIFIED', async () => {
  await edit(DIFFERENT_FIX);
  const r = await verifyCase(env.browser, env, repo.root, caseId, { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.DIFFERENT_FAILURE);
  assert.equal(r.check.observed, '$20.00');
  await git(repo.root, ['checkout', '-q', '--', 'app.js']);
});

test('weakening the locked expectation is CASE_TAMPERED even with a real fix', async () => {
  await edit(REAL_FIX);
  const file = join(repo.root, '.buggps', 'cases', caseId, 'case.json');
  const original = await readFile(file, 'utf8');
  const weakened = JSON.parse(original);
  weakened.expectation = { kind: 'visible', target: weakened.expectation.target };
  await writeFile(file, JSON.stringify(weakened, null, 2));
  const r = await verifyCase(env.browser, env, repo.root, caseId, { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.CASE_TAMPERED);
  await writeFile(file, original);
});

test('"fixed" by disabling the triggering control is NEEDS_REVIEW, never VERIFIED', async () => {
  const s = await recordSession(env.browser, env.url, 'changelog-crash');
  const locked = await lockCase(env.browser, env, repo.root, { ...s, serve }, { baseUrl: env.url, id: 'crash' });
  assert.equal(locked.status, Status.REPRODUCED);
  // Disable the button after its first click: the error can no longer happen.
  await edit((src) => src.replace("state.changelog = undefined; // SEEDED BUG 2: second click dereferences undefined.",
    "state.changelog = undefined; $('#changelog-btn').disabled = true;"));
  const r = await verifyCase(env.browser, env, repo.root, 'crash', { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(r.check.disabledSteps.length >= 1);
  assert.ok(r.reviewReasons.includes('disabled-control'));
  await git(repo.root, ['checkout', '-q', '--', 'app.js']);
});

test('a shortened case that lost the trigger never decides the verdict', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  // The verdict comes from the full recording; the shortened case is re-checked and reported
  // alongside (agreesWithRecording) so a lossy shortening is visible.
  const short =s.steps.filter((st) => st.action === 'goto' || ['Add Apple', 'Add Banana', 'Coupon', 'Apply coupon', 'Remove Apple'].includes(st.target?.[0]?.name));
  const locked = await lockCase(env.browser, env, repo.root, { ...s, serve, minimizedSteps: short }, { baseUrl: env.url, id: 'with-min' });
  assert.equal(locked.lock.redMinimized.kept, true);
  await edit(REAL_FIX);
  const r = await verifyCase(env.browser, env, repo.root, 'with-min', { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.VERIFIED);
  assert.equal(r.minimizedCheck.agreesWithRecording, true);
  await git(repo.root, ['checkout', '-q', '--', 'app.js']);
});

test('real fix is VERIFIED with a binary-safe patch that excludes .buggps', async () => {
  await edit(REAL_FIX);
  const r =await verifyCase(env.browser, env, repo.root, caseId, { baseUrl: env.url });
  assert.equal(r.verdict, Verdict.VERIFIED);
  assert.deepEqual(r.check.tally, { pass: 3 });
  const patch = await readFile(join(repo.root, '.buggps', 'runs', `${r.runId}.patch`), 'utf8');
  assert.match(patch, /\+\s+recompute\(\);/);
  assert.doesNotMatch(patch, /\.buggps/);
});
