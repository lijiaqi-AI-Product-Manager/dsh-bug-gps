import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareFixtureSource } from '../bench/fixture-source.mjs';
import { git } from '../src/core/snapshot.js';
import { tempRepo } from './helpers.js';

const original = "import AutoImport from 'unplugin-auto-import/vite';\nexport default { plugins: [AutoImport({ imports: ['vue'], eslintrc: { enabled: true } })] };\n";
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, configuration = original) {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  await writeFile(join(repo.root, 'vite.config.ts'), configuration);
  await writeFile(join(repo.root, '.eslintrc-auto-import.json'), '{}\n');
  await git(repo.root, ['add', '--', 'vite.config.ts', '.eslintrc-auto-import.json']);
  await git(repo.root, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'fixture configuration']);
  return repo.root;
}

test('historical fixture metadata is explicit, repeatable and limited to the generated ESLint option', async t => {
  const dir = await fixture(t);
  const before = await readFile(join(dir, 'app.js'));
  const first = await prepareFixtureSource(dir, 'it-tools');
  const configured = await readFile(join(dir, 'vite.config.ts'), 'utf8');
  assert.equal(configured, original.replace('enabled: true', 'enabled: false'));
  assert.deepEqual(await readFile(join(dir, 'app.js')), before);
  assert.equal(first.fixtureConfiguration.upstreamSha256, hash(original));
  assert.equal(first.fixtureConfiguration.configuredSha256, hash(configured));
  assert.equal((await git(dir, ['diff', '--name-only', 'HEAD'])).trim(), 'vite.config.ts');
  assert.deepEqual(await prepareFixtureSource(dir, 'it-tools'), first);
});

test('warmed declarations remain unchanged and their content is recorded', async t => {
  const dir = await fixture(t);
  const generated = '{"globals":{"ref":true}}\n';
  await writeFile(join(dir, '.eslintrc-auto-import.json'), generated);
  const result = await prepareFixtureSource(dir, 'it-tools');
  assert.equal(await readFile(join(dir, '.eslintrc-auto-import.json'), 'utf8'), generated);
  assert.deepEqual(result.generatedDeclarations, [{ path: '.eslintrc-auto-import.json', sha256: hash(generated) }]);
  assert.match(result.generatedPatchSha256, /^[a-f0-9]{64}$/);
});

test('unexpected config or application edits cannot be adopted as fixture preparation', async t => {
  const dir = await fixture(t);
  const extra = original + 'export const unexpected = true;\n';
  await writeFile(join(dir, 'vite.config.ts'), extra);
  await assert.rejects(prepareFixtureSource(dir, 'it-tools'), /beyond the recorded metadata option/);
  assert.equal(await readFile(join(dir, 'vite.config.ts'), 'utf8'), extra);
  await writeFile(join(dir, 'vite.config.ts'), original);
  await writeFile(join(dir, 'app.js'), 'throw new Error("changed application");\n');
  await assert.rejects(prepareFixtureSource(dir, 'it-tools'), /tracked application changes/);
  assert.equal(await readFile(join(dir, 'vite.config.ts'), 'utf8'), original);
});

test('an unknown upstream configuration fails closed instead of guessing an adapter', async t => {
  const dir = await fixture(t, original.replace('enabled: true', 'enabled: false'));
  await assert.rejects(prepareFixtureSource(dir, 'it-tools'), /Unsupported historical AutoImport/);
  await writeFile(join(dir, '.eslintrc-auto-import.json'), '{"changed":true}\n');
  await assert.rejects(prepareFixtureSource(dir, 'other-project'), /tracked application changes/);
});
