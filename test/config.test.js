import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/core/snapshot.js';
import { serveSpec } from './helpers.js';

const cli = fileURLToPath(new URL('../bin/buggps.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });

test('standalone help exits successfully', () => {
  const result = run('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /buggps <command>/);
});

async function project(t, observeMs) {
  const root = await mkdtemp(join(tmpdir(), 'buggps-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'index.html'), '<!doctype html><p id="out">BAD</p>');
  const serve = await serveSpec(root);
  await writeFile(join(root, 'buggps.config.json'), JSON.stringify({ serve, observeMs }));
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  const file = join(root, 'input.json');
  await writeFile(file, JSON.stringify({ steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'GOOD' } }));
  return { root, file, serve };
}

test('CLI locks the configured observation window and verify retains it after config changes', async (t) => {
  const { root, file, serve } = await project(t, 4321);
  const locked = run('lock', '--repo', root, '--case', file, '--id', 'configured', '--runs', '1', '--json');
  assert.equal(locked.status, 0, locked.stderr + locked.stdout);
  const saved = JSON.parse(await readFile(join(root, '.buggps', 'cases', 'configured', 'case.json'), 'utf8'));
  assert.equal(saved.observeMs, 4321);
  await writeFile(join(root, 'buggps.config.json'), JSON.stringify({ serve, observeMs: 7 }));
  const verified = run('verify', '--repo', root, '--id', 'configured', '--runs', '1', '--json');
  assert.equal(JSON.parse(verified.stdout).observeMs, 4321);
});

test('invalid observation configuration is TEST_INVALID', async (t) => {
  const { root, file } = await project(t, -1);
  const result = run('lock', '--repo', root, '--case', file, '--id', 'invalid', '--runs', '1', '--json');
  assert.equal(result.status, 3, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).status, 'TEST_INVALID');
});

test('non-object project configuration is TEST_INVALID', async (t) => {
  const { root, file } = await project(t, 1000);
  await writeFile(join(root, 'buggps.config.json'), '[]');
  const result = run('lock', '--repo', root, '--case', file, '--id', 'invalid', '--url', 'http://127.0.0.1:9/', '--runs', '1', '--json');
  assert.equal(result.status, 3, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).status, 'TEST_INVALID');
});
