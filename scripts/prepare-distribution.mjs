#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const json = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));
const pkg = await json('package.json');
const entries = await json('distribution/entries.json');
const targets = await json('distribution/targets.json');
const screenshots = await json('screenshots.json');
const repository = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const slug = new URL(repository).pathname.slice(1);
const raster = new Set(['.png', '.jpg', '.jpeg', '.webp']);
assert.equal(targets.schema, 'buggps.distribution-targets/v1');
assert.equal(targets.release.version, pkg.version, 'Distribution targets must track the prepared package version');
assert.equal(new Set(targets.targets.map((target) => target.id)).size, targets.targets.length);
for (const target of targets.targets) {
  for (const value of [target.url, target.rules]) {
    const link = new URL(value);
    assert.equal(link.protocol, 'https:');
    assert.ok(!link.username && !link.password);
  }
  assert.ok(Array.isArray(target.requires));
  assert.ok(['entry', 'metadata', 'submission-fields', 'conditional', 'research-only'].includes(target.prepared));
}
for (const id of Object.keys(entries.catalogs)) assert.ok(targets.targets.some((target) => target.id === id && target.prepared === 'entry'));
async function asset(file, image = false) {
  assert.equal(typeof file, 'string');
  assert.ok(!isAbsolute(file) && !file.split(/[\\/]/).some((p) => p === '..' || p === '.'), 'Asset must stay in the repository');
  const target = await realpath(join(root, file));
  const rel = relative(root, target);
  assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep), 'Asset link leaves the repository');
  assert.ok((await stat(target)).isFile());
  if (image) assert.ok(raster.has(extname(file).toLowerCase()), 'Storefront assets must be raster images');
  return target;
}
await asset(pkg.dsh.bundle.patch.replace(/^\.\//, ''));
await asset(pkg.main.replace(/^\.\//, ''));
await asset('assets/buggps-icon.png', true);
assert.ok(pkg.files.includes('assets/buggps-icon.png'));
assert.ok(Array.isArray(screenshots) && screenshots.length >= 1 && screenshots.length <= 8);
assert.equal(new Set(screenshots).size, screenshots.length);
for (const file of screenshots) await asset(file, true);
assert.equal(pkg.engines.dsh, '0.2.1-rc.5');
assert.ok(Object.keys(pkg.dependencies ?? {}).every((name) => !name.startsWith('@deepseek-ai/')), 'Host interfaces belong in peer dependencies');
assert.deepEqual(pkg.dsh.marketplace.profiles, ['headless', 'web']);
assert.equal(pkg.dsh.marketplace.requiresBuildApproval, false);
assert.equal(pkg.dsh.marketplace.requiresRestart, true);
assert.equal(pkg.dsh.marketplace.manualSteps, true);
for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!pkg.scripts?.[name], 'Installation must not depend on lifecycle scripts');

const a = entries.catalogs['awesome-dsh-plugin'].entry;
assert.equal(a.url, repository); assert.equal(a.name, slug); assert.equal(a.category, 'browser');
assert.deepEqual(Object.keys(a).sort(), ['url', 'name', 'category', 'description', 'icon'].sort());
assert.ok(a.description.en.endsWith('.') && a.description.zh.endsWith('。'));
assert.ok(a.icon.startsWith('https://raw.githubusercontent.com/' + slug + '/main/'));
const b = entries.catalogs['1024-store'].entry;
assert.equal(b.id, slug); assert.equal(b.repository, repository); assert.equal(b.category, 'dev');
assert.equal(b.$schema, '../schema/plugin.schema.json');
assert.deepEqual(b.description, a.description);
const c = entries.catalogs.dshworks.entry;
assert.equal(c.repo, slug); assert.equal(c.category, 'bundle');
assert.equal(c.description, a.description.en);
assert.ok(c.description.length <= 200);
assert.equal(c.verifiedAgainst, pkg.engines.dsh);
assert.equal(c.status, 'unverified');
assert.ok(!Object.hasOwn(c, 'featured') && !Object.hasOwn(c, 'official'));
if (Object.hasOwn(c, 'npm')) {
  assert.equal(c.npm, pkg.name);
  assert.equal(pkg.private, false, 'Add an npm mapping only after the actual package is published');
  assert.equal(entries.npmPublication?.version, pkg.version);
  assert.ok(Number.isFinite(Date.parse(entries.npmPublication?.publishedAt)), 'Record the observed registry publication time');
}

const args = process.argv.slice(2);
if (args.length) {
  assert.ok(args.length === 2 && args[0] === '--out', 'Use --out <new directory>');
  const out = resolve(args[1]);
  const exportRoot = join(root, '.buggps');
  assert.equal(dirname(out), exportRoot, 'Export into a new directory directly under .buggps/');
  await mkdir(exportRoot, { recursive: true });
  assert.equal(relative(root, await realpath(exportRoot)), '.buggps', 'Export directory must not be a junction or link outside the repository');
  await mkdir(out);
  const quote = (value) => JSON.stringify(value);
  const yaml = ['url: ' + quote(a.url), 'name: ' + quote(a.name), 'category: ' + a.category,
    'description:', '  en: ' + quote(a.description.en), '  zh: ' + quote(a.description.zh), 'icon: ' + quote(a.icon)].join('\n') + '\n';
  await writeFile(join(out, 'lijiaqi-AI-Product-Manager__dsh-bug-gps.yml'), yaml, { flag: 'wx' });
  await writeFile(join(out, 'lijiaqi-ai-product-manager--dsh-bug-gps.json'), JSON.stringify(b, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(out, 'dshworks-entry.json'), JSON.stringify(c, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ package: pkg.name, version: pkg.version, catalogs: Object.keys(entries.catalogs), screenshots: screenshots.length,
  profiles: pkg.dsh.marketplace.profiles, targets: targets.targets.length, publication: entries.publication, exported: args.length > 0 }));
