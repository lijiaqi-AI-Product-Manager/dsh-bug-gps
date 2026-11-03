import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { git, snapshotTree, describeTreeChanges } from '../src/core/snapshot.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { freePort, serveSpec } from './helpers.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });
const html = (text) => '<!doctype html><meta charset="utf-8"><p data-testid="result">' + text + '</p>';
const contract = { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'text', target: [{ by: 'testId', value: 'result' }], equals: 'GOOD' }, observeMs: 0 };

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'buggps-baseline-test-'));
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps-baseline-test-'));
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(join(root, 'index.html'), html('BAD'));
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  return root;
}

test('a command serving another directory cannot bind a passing result to this patch', async (t) => {
  const root = await repository(t);
  const other = await repository(t);
  const serve = await serveSpec(other);
  const locked = await lockCase(env.browser, env, root, { ...contract, serve }, { id: 'external-source', runs: 1 });
  assert.equal(locked.caseId, 'external-source');
  await writeFile(join(root, 'notes.txt'), 'unrelated change\n');
  await writeFile(join(other, 'index.html'), html('GOOD'));
  const result = await verifyCase(env.browser, env, root, locked.caseId, { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.reviewReasons.includes('baseline-not-reproduced'));
  assert.equal(result.baselineControl.status, 'NOT_REPRODUCED');
  assert.match(await readFile(join(root, 'index.html'), 'utf8'), />BAD</);
});

test('a real fix replays its baseline without changing the user index or candidate files', async (t) => {
  const root = await repository(t);
  const serve = await serveSpec(root);
  const locked = await lockCase(env.browser, env, root, { ...contract, serve }, { id: 'real-fix', runs: 1 });
  await writeFile(join(root, 'index.html'), html('GOOD'));
  const index = await readFile(join(root, '.git', 'index'));
  const before = await git(root, ['worktree', 'list', '--porcelain']);
  const result = await verifyCase(env.browser, env, root, locked.caseId, { runs: 1 });
  assert.equal(result.verdict, Verdict.VERIFIED, JSON.stringify(result));
  assert.equal(result.baselineControl.status, 'REPRODUCED');
  assert.equal(result.baselineControl.matchesLockedFailure, true);
  assert.deepEqual(await readFile(join(root, '.git', 'index')), index);
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), html('GOOD'));
  assert.equal(await git(root, ['worktree', 'list', '--porcelain']), before);
});

test('a baseline source mutation remains reviewable and names the changed file', async (t) => {
  const root = await repository(t);
  await writeFile(join(root, 'generated-types.d.ts'), 'export {};\n');
  const port = await freePort();
  const directoryHash = createHash('sha256').update(await realpath(root)).digest('hex');
  const serve = { command: [process.execPath, fileURLToPath(new URL('./fixtures/baseline-drift-server.js', import.meta.url)), directoryHash, String(port)], url: `http://127.0.0.1:${port}/` };
  const locked = await lockCase(env.browser, env, root, { ...contract, serve }, { id: 'generated-drift', runs: 1 });
  assert.equal(locked.caseId, 'generated-drift');
  await writeFile(join(root, 'index.html'), html('GOOD'));
  const result = await verifyCase(env.browser, env, root, locked.caseId, { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.equal(result.baselineControl.status, Verdict.STALE);
  assert.equal(result.baselineControl.matchesLockedFailure, false);
  assert.deepEqual(result.baselineControl.treeChanges.files, ['generated-types.d.ts']);
  assert.notEqual(result.baselineControl.treeChanges.before, result.baselineControl.treeChanges.after);
  assert.equal(result.baselineControl.treeChanges.availability, 'available');
  assert.equal(await readFile(join(root, 'generated-types.d.ts'), 'utf8'), 'export {};\n');
});

test('tree-change diagnostics are bounded and unavailable inspection is not an empty diff', async (t) => {
  const root = await repository(t);
  const before = await snapshotTree(root);
  await Promise.all(Array.from({ length: 51 }, (_, i) => writeFile(join(root, `generated-${String(i).padStart(2, '0')}.d.ts`), 'export {};\n')));
  const after = await snapshotTree(root);
  const changes = await describeTreeChanges(root, before, after);
  assert.equal(changes.availability, 'available');
  assert.equal(changes.total, 51);
  assert.equal(changes.files.length, 50);
  assert.equal(changes.truncated, true);
  const unavailable = await describeTreeChanges(root, '0'.repeat(40), '1'.repeat(40));
  assert.equal(unavailable.availability, 'unavailable');
  assert.equal(unavailable.files, null);
  assert.equal(unavailable.total, null);
});

test('baseline runtime links are cleaned without deleting original dependencies', async (t) => {
  const root = await repository(t);
  await writeFile(join(root, '.gitignore'), 'node_modules/\n.env\n');
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules', 'sentinel.txt'), 'keep me');
  await writeFile(join(root, '.env'), 'TEST_ONLY_RUNTIME_INPUT=present\n');
  const serve = await serveSpec(root);
  const locked = await lockCase(env.browser, env, root, { ...contract, serve }, { id: 'runtime-inputs', runs: 1 });
  await writeFile(join(root, 'index.html'), html('GOOD'));
  const result = await verifyCase(env.browser, env, root, locked.caseId, { runs: 1 });
  assert.equal(result.verdict, Verdict.VERIFIED, JSON.stringify(result));
  assert.ok(result.baselineControl.runtimeInputs.some((input) => input.path === 'node_modules'));
  assert.ok(result.baselineControl.runtimeInputs.some((input) => input.path === '.env'));
  assert.equal(await readFile(join(root, 'node_modules', 'sentinel.txt'), 'utf8'), 'keep me');
  assert.doesNotMatch(JSON.stringify(result), /TEST_ONLY_RUNTIME_INPUT=present/);
});
