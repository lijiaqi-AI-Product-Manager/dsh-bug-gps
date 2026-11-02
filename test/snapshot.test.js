import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { git, snapshotTree } from '../src/core/snapshot.js';

async function repository(t, { committed = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'buggps snapshot '));
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps snapshot '));
    await rm(target, { recursive: true, force: true });
  });
  await git(root, ['init', '-q']);
  await writeFile(join(root, '.gitignore'), '.buggps/\n.env\nnode_modules/\n');
  await writeFile(join(root, 'app.js'), 'baseline\n');
  if (committed) {
    await git(root, ['add', '-A']);
    await git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  }
  return root;
}

async function files(root, tree) {
  return (await git(root, ['ls-tree', '-r', '--name-only', '-z', tree])).split('\0').filter(Boolean).sort();
}

for (const committed of [false, true]) {
  test('snapshot excludes ignored run artifacts ' + (committed ? 'with HEAD' : 'without HEAD'), async (t) => {
    const root = await repository(t, { committed });
    await mkdir(join(root, '.buggps', 'runs'), { recursive: true });
    await writeFile(join(root, '.buggps', 'runs', 'run.json'), '{"status":"running"}');
    await writeFile(join(root, '.env'), 'PRIVATE_FIXTURE_VALUE=local\n');
    await writeFile(join(root, 'vite.config.js.timestamp-123.mjs'), 'transient\n');
    const before = await git(root, ['status', '--porcelain=v1', '-uall']);
    const tree = await snapshotTree(root);
    assert.deepEqual(await files(root, tree), ['.gitignore', 'app.js']);
    assert.equal(await git(root, ['status', '--porcelain=v1', '-uall']), before);
    assert.equal(await readFile(join(root, '.buggps', 'runs', 'run.json'), 'utf8'), '{"status":"running"}');
  });
}

test('snapshot keeps staged and unstaged edits, additions and deletions without changing the index', async (t) => {
  const root = await repository(t, { committed: true });
  await writeFile(join(root, 'app.js'), 'staged\n');
  await git(root, ['add', '--', 'app.js']);
  await writeFile(join(root, 'app.js'), 'working\n');
  await writeFile(join(root, 'new file.txt'), 'untracked\n');
  await rm(join(root, '.gitignore'));
  await mkdir(join(root, '.buggps', 'runs'), { recursive: true });
  await writeFile(join(root, '.buggps', 'runs', 'run.json'), '{}');
  const indexBefore = await readFile(join(root, '.git', 'index'));
  const tree = await snapshotTree(root);
  assert.deepEqual(await files(root, tree), ['app.js', 'new file.txt']);
  assert.equal(await git(root, ['show', tree + ':app.js']), 'working\n');
  assert.equal(await git(root, ['show', ':app.js']), 'staged\n');
  assert.deepEqual(await readFile(join(root, '.git', 'index')), indexBefore);
});

test('snapshot retains explicitly tracked ignored files and removes tracked run artifacts', async (t) => {
  const root = await repository(t, { committed: true });
  await writeFile(join(root, '.gitignore'), '.buggps/\ncache.txt\n');
  await writeFile(join(root, 'cache.txt'), 'tracked input\n');
  await mkdir(join(root, '.buggps'), { recursive: true });
  await writeFile(join(root, '.buggps', 'old.json'), '{}');
  await git(root, ['add', '-f', '--', 'cache.txt', '.buggps/old.json']);
  const indexBefore = await readFile(join(root, '.git', 'index'));
  const tree = await snapshotTree(root);
  assert.deepEqual(await files(root, tree), ['.gitignore', 'app.js', 'cache.txt']);
  assert.deepEqual(await readFile(join(root, '.git', 'index')), indexBefore);
});

test('snapshot reads modified tracked content even when marked assume-unchanged', async (t) => {
  const root = await repository(t, { committed: true });
  await git(root, ['update-index', '--assume-unchanged', '--', 'app.js']);
  await writeFile(join(root, 'app.js'), 'actual content\n');
  const indexBefore = await readFile(join(root, '.git', 'index'));
  const tree = await snapshotTree(root);
  assert.equal(await git(root, ['show', tree + ':app.js']), 'actual content\n');
  assert.deepEqual(await readFile(join(root, '.git', 'index')), indexBefore);
});
