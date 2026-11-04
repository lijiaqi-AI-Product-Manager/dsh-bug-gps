// Historical development builds can write tracked editor metadata while serving a page.
// Keep the fixture configuration explicit; the product's code-change guard stays strict.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { git } from '../src/core/snapshot.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\r\n/g, '\n');
const declarations = ['.eslintrc-auto-import.json', 'auto-imports.d.ts', 'components.d.ts'];

export async function prepareFixtureSource(dir, project) {
  const changed = (await git(dir, ['diff', '--name-only', 'HEAD'])).trim().split('\n').filter(Boolean);
  const historical = project === 'it-tools';
  if (changed.some(file => !historical || (!declarations.includes(file) && file !== 'vite.config.ts'))) {
    throw new Error('Fixture contains tracked application changes');
  }
  let fixtureConfiguration;
  if (historical) {
    const path = 'vite.config.ts';
    const original = normalized(await git(dir, ['show', 'HEAD:' + path]));
    const option = /(\beslintrc:\s*\{\s*enabled:\s*)true(\s*,?\s*\})/g;
    if (!original.includes("from 'unplugin-auto-import/vite'") || [...original.matchAll(option)].length !== 1) {
      throw new Error('Unsupported historical AutoImport ESLint configuration');
    }
    const configured = original.replace(option, '$1false$2');
    const current = await readFile(join(dir, path), 'utf8');
    if (![original, configured].includes(normalized(current))) {
      throw new Error('Fixture Vite configuration has changes beyond the recorded metadata option');
    }
    const bytes = current.includes('\r\n') ? configured.replace(/\n/g, '\r\n') : configured;
    if (bytes !== current) await writeFile(join(dir, path), bytes);
    fixtureConfiguration = {
      path,
      option: 'AutoImport.eslintrc.enabled=false',
      upstreamSha256: hash(original),
      configuredSha256: hash(configured),
      worktreeSha256: hash(bytes),
      patchSha256: hash(await git(dir, ['diff', 'HEAD', '--', path])),
      scope: 'Disable generated ESLint metadata only; the frozen snapshot carries this configuration into the candidate and fresh original-code control.',
    };
  }
  const generated = changed.filter(file => declarations.includes(file));
  return {
    generatedDeclarations: await Promise.all(generated.map(async path => ({ path, sha256: hash(await readFile(join(dir, path))) }))),
    ...(generated.length ? { generatedPatchSha256: hash(await git(dir, ['diff', 'HEAD', '--', ...generated])) } : {}),
    ...(fixtureConfiguration ? { fixtureConfiguration } : {}),
  };
}
