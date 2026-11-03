import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TestDefinitionError } from '../src/core/errors.js';

export const jsonSha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (message) => new TestDefinitionError(`Regression input: ${message}`);
const inside = (root, file) => {
  const rel = relative(root, file);
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
};

async function document(file, label) {
  try {
    if ((await stat(file)).size > 4 * 1024 * 1024) throw invalid(`${label} exceeds 4 MiB`);
    const bytes = await readFile(file);
    if (bytes.length > 4 * 1024 * 1024) throw invalid(`${label} exceeds 4 MiB`);
    return { bytes, draft: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    if (error instanceof TestDefinitionError) throw error;
    throw invalid(`${label}: ${error instanceof SyntaxError ? 'invalid JSON' : error.code ?? 'read failed'}`);
  }
}

async function definition(file, id) {
  const contents = await document(file, id);
  if (!contents.draft || typeof contents.draft !== 'object' || !Array.isArray(contents.draft.steps)) throw invalid(`${id}: expected a definition with steps`);
  return contents;
}

export async function selectRegressionInputs({ source, manifest, inputDir, indexFile }) {
  if (inputDir && indexFile) throw invalid('choose an input directory or an index, not both');
  const specs = new Map(manifest.cases.map((spec) => [spec.id, spec]));
  const known = (id) => { if (!specs.has(id)) throw invalid('unknown case'); };
  if (inputDir) {
    const directory = resolve(inputDir);
    return {
      mode: 'directory-override',
      index: null,
      async load(id) {
        known(id);
        const file = join(directory, id + '.json');
        const contents = await definition(file, id);
        return { ...contents, definitionFile: inside(source, file) ? relative(source, file).split(sep).join('/') : `<input-directory>/${id}.json` };
      },
    };
  }

  const file = resolve(indexFile ?? join(source, 'bench/regression-inputs.json'));
  const { draft: index } = await document(file, 'index');
  if (index?.schema !== 'buggps.regression-inputs/v1' || index.dataset !== manifest.dataset
    || index.denominator !== manifest.denominator || manifest.denominator !== specs.size
    || index.manifestCanonicalSha256 !== jsonSha256(manifest)
    || !Array.isArray(index.cases) || index.cases.length !== specs.size) {
    throw invalid('index does not match the frozen dataset and denominator');
  }
  const entries = new Map();
  for (const entry of index.cases) {
    if (!entry || !specs.has(entry.id) || entries.has(entry.id)) throw invalid('index contains a duplicate or unknown case');
    if (typeof entry.file !== 'string' || entry.file.length > 512 || !entry.file.startsWith('bench/holdout-recordings/')
      || !entry.file.endsWith('.json') || /[\\:]/.test(entry.file) || entry.file.split('/').some((part) => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/.test(entry.canonicalSha256 ?? '') || !Number.isSafeInteger(entry.definitionRevision) || entry.definitionRevision < 1) {
      throw invalid(`invalid index entry for ${entry.id}`);
    }
    entries.set(entry.id, entry);
  }
  const recordings = await realpath(join(source, 'bench/holdout-recordings'));
  return {
    mode: 'versioned-index',
    index: { file: inside(source, file) ? relative(source, file).split(sep).join('/') : '<custom-index>', canonicalSha256: jsonSha256(index) },
    async load(id) {
      known(id);
      const entry = entries.get(id);
      let target;
      try { target = await realpath(resolve(source, entry.file)); }
      catch (error) { throw invalid(`${id}: ${error.code ?? 'path unavailable'}`); }
      if (!inside(recordings, target)) throw invalid(`${id}: definition resolves outside the recording directory`);
      const contents = await definition(target, id);
      if (jsonSha256(contents.draft) !== entry.canonicalSha256 || (contents.draft.definitionRevision ?? 1) !== entry.definitionRevision) {
        throw invalid(`${id}: definition content or revision differs from the index`);
      }
      return { ...contents, definitionFile: entry.file };
    },
  };
}
