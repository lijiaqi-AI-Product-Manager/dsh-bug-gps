import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { jsonSha256, selectRegressionInputs } from '../bench/regression-inputs.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

async function ownedTemp(t, prefix = 'buggps-inputs-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  return root;
}

async function fixture(t) {
  const root = await ownedTemp(t);
  const recordings = join(root, 'bench/holdout-recordings');
  await mkdir(recordings, { recursive: true });
  const manifest = { dataset: 'test-inputs', denominator: 2, cases: [{ id: 'one' }, { id: 'two' }] };
  const definition = { definitionRevision: 3, steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$18.00' } };
  const index = {
    schema: 'buggps.regression-inputs/v1', dataset: manifest.dataset, denominator: 2,
    manifestCanonicalSha256: jsonSha256(manifest),
    cases: manifest.cases.map(({ id }) => ({ id, file: `bench/holdout-recordings/${id}.json`, definitionRevision: 3, canonicalSha256: jsonSha256(definition) })),
  };
  const indexFile = join(root, 'bench/regression-inputs.json');
  await Promise.all(index.cases.map(({ id }) => save(join(recordings, id + '.json'), definition)));
  await save(indexFile, index);
  return { source: root, manifest, recordings, definition, index, indexFile };
}

test('regression index selects every declared definition and records its identity', async (t) => {
  const f = await fixture(t);
  const selection = await selectRegressionInputs(f);
  assert.equal(selection.mode, 'versioned-index');
  assert.equal(selection.index.canonicalSha256, jsonSha256(f.index));
  for (const id of ['one', 'two']) {
    const loaded = await selection.load(id);
    assert.deepEqual(loaded.draft, f.definition);
    assert.equal(loaded.definitionFile, `bench/holdout-recordings/${id}.json`);
  }
  await assert.rejects(selection.load('missing'), /unknown case/);
});

test('the repository default resolves all twelve current versioned inputs', async () => {
  const manifest = JSON.parse(await readFile(join(source, 'bench/holdout-cases.json'), 'utf8'));
  const selection = await selectRegressionInputs({ source, manifest });
  assert.equal(selection.mode, 'versioned-index');
  assert.equal(selection.index.file, 'bench/regression-inputs.json');
  const loaded = await Promise.all(manifest.cases.map((spec) => selection.load(spec.id)));
  assert.equal(loaded.length, 12);
  assert.equal(loaded[manifest.cases.findIndex((x) => x.id === 'drawdb-1031')].draft.definitionRevision, 3);
  assert.equal(loaded[manifest.cases.findIndex((x) => x.id === 'chartdb-1089')].draft.definitionRevision, 5);
});

test('JSON whitespace and Windows line endings do not change the selected input', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.recordings, 'one.json'), JSON.stringify(f.definition, null, 4).replaceAll('\n', '\r\n'));
  assert.deepEqual((await (await selectRegressionInputs(f)).load('one')).draft, f.definition);
});

test('changed business expectations and mismatched revisions cannot use an old index', async (t) => {
  const f = await fixture(t);
  const changed = structuredClone(f.definition);
  changed.expectation.equals = '$20.00';
  await save(join(f.recordings, 'one.json'), changed);
  await assert.rejects((await selectRegressionInputs(f)).load('one'), /content or revision differs/);
  await save(join(f.recordings, 'one.json'), f.definition);
  f.index.cases[0].definitionRevision = 4;
  await save(f.indexFile, f.index);
  await assert.rejects((await selectRegressionInputs(f)).load('one'), /content or revision differs/);
});

test('a frozen input index rejects incomplete, duplicate and foreign case lists', async (t) => {
  const f = await fixture(t);
  for (const change of [
    (x) => x.cases.pop(),
    (x) => { x.cases[1] = structuredClone(x.cases[0]); },
    (x) => { x.cases[1].id = 'foreign'; },
    (x) => { x.dataset = 'other'; },
    (x) => { x.manifestCanonicalSha256 = '0'.repeat(64); },
  ]) {
    const index = structuredClone(f.index);
    change(index);
    await save(f.indexFile, index);
    await assert.rejects(selectRegressionInputs(f), { name: 'TestDefinitionError' });
  }
});

test('index paths cannot escape the versioned recording directory', async (t) => {
  const f = await fixture(t);
  for (const file of ['../outside.json', 'bench/holdout-recordings/../outside.json', 'C:\\outside.json']) {
    const index = structuredClone(f.index);
    index.cases[0].file = file;
    await save(f.indexFile, index);
    await assert.rejects(selectRegressionInputs(f), /invalid index entry/);
  }
});

test('a directory link cannot redirect an indexed input outside its namespace', async (t) => {
  const f = await fixture(t);
  const outside = join(f.source, 'outside');
  await mkdir(outside);
  await save(join(outside, 'one.json'), f.definition);
  await symlink(outside, join(f.recordings, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  f.index.cases[0].file = 'bench/holdout-recordings/redirect/one.json';
  await save(f.indexFile, f.index);
  await assert.rejects((await selectRegressionInputs(f)).load('one'), /resolves outside/);
});

test('an explicit historical directory remains usable and cannot compete with an index', async (t) => {
  const f = await fixture(t);
  const selection = await selectRegressionInputs({ source: f.source, manifest: f.manifest, inputDir: f.recordings });
  assert.equal(selection.mode, 'directory-override');
  assert.equal(selection.index, null);
  assert.deepEqual((await selection.load('one')).draft, f.definition);
  await assert.rejects(selectRegressionInputs({ ...f, inputDir: f.recordings }), /not both/);
});

test('malformed and structurally invalid historical inputs are TEST_INVALID', async (t) => {
  const f = await fixture(t);
  const selection = await selectRegressionInputs({ source: f.source, manifest: f.manifest, inputDir: f.recordings });
  for (const bytes of ['{', 'null', '{}', '{"steps":"invalid"}']) {
    await writeFile(join(f.recordings, 'one.json'), bytes);
    await assert.rejects(selection.load('one'), { name: 'TestDefinitionError' });
  }
  await rm(join(f.recordings, 'one.json'));
  await assert.rejects(selection.load('one'), { name: 'TestDefinitionError' });
});

test('oversized definitions are rejected before execution', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.recordings, 'one.json'), Buffer.alloc(4 * 1024 * 1024 + 1, ' '));
  const selection = await selectRegressionInputs({ source: f.source, manifest: f.manifest, inputDir: f.recordings });
  await assert.rejects(selection.load('one'), /exceeds 4 MiB/);
});

test('invalid global inputs produce twelve TEST_INVALID records and a failing process status', async (t) => {
  const root = await ownedTemp(t, 'bgh-');
  const manifest = JSON.parse(await readFile(join(source, 'bench/holdout-cases.json'), 'utf8'));
  const state = join(root, 'state.json');
  const indexFile = join(root, 'invalid-index.json');
  const output = join(root, 'results');
  await save(state, { root, manifestSha256: jsonSha256(manifest), cases: [] });
  await save(indexFile, { schema: 'buggps.regression-inputs/v1', dataset: manifest.dataset, cases: [] });
  const env = { ...process.env, BUGGPS_HOLDOUT_STATE: state, BUGGPS_HOLDOUT_INDEX: indexFile, BUGGPS_HOLDOUT_OUT: output };
  delete env.BUGGPS_HOLDOUT_INPUTS;
  const result = spawnSync(process.execPath, [join(source, 'bench/holdout.mjs')], { cwd: source, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  const results = await Promise.all((await readdir(output)).map(async (file) => JSON.parse(await readFile(join(output, file), 'utf8'))));
  const cases = results.filter((x) => x.schema === 'buggps.holdout-result/v1');
  assert.equal(cases.length, manifest.denominator);
  assert.deepEqual(cases.map((x) => x.case).sort(), manifest.cases.map((x) => x.id).sort());
  for (const entry of cases) {
    assert.equal(entry.status, 'TEST_INVALID');
    assert.match(entry.reason, /frozen dataset/);
    assert.equal(entry.browser, undefined);
    assert.equal(entry.lock, undefined);
  }
  assert.equal(results.find((x) => x.schema === 'buggps.holdout-batch/v1').results.every((x) => !x.expectedOutcome), true);
});
