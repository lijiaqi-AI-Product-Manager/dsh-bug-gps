import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/buggps.js', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const windows = process.platform === 'win32';

test('CLI reports its manifest version before any browser or project checks', () => {
  for (const flag of ['--version', '-v']) {
    const child = spawnSync(process.execPath, [cli, flag, '--browser-path', 'missing-browser'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(child.status, 0);
    assert.equal(child.stdout.trim(), pkg.version);
    assert.equal(child.stderr, '');
  }
  const child = spawnSync(process.execPath, [cli, '--version', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { name: pkg.name, version: pkg.version });
});

test('CLI rejects an unknown command before browser startup', () => {
  const child = spawnSync(process.execPath, [cli, 'nonexistent-command', '--browser-path', 'missing-browser'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 64);
  assert.match(child.stderr, /buggps <command>/);
  assert.doesNotMatch(child.stderr, /ENV_BLOCKED|TEST_INVALID/);
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'buggps-doctor-'));
  const bin = join(root, 'tools with spaces');
  await mkdir(bin);
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps-doctor-'));
    await rm(target, { recursive: true, force: true });
  });
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = bin + delimiter + (env[pathKey] ?? '');
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const tool = async (name, source) => {
    const script = join(bin, name + '-fixture.cjs');
    await writeFile(script, source);
    const launcher = windows ? '@echo off\r\n"' + process.execPath + '" "' + script + '"\r\n'
      : '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(script) + '\n';
    await writeFile(join(bin, name + (windows ? '.cmd' : '')), launcher, { mode: 0o755 });
  };
  await tool('pnpm', 'console.log("10.34.9");\n');
  const run = (repo = root) => spawnSync(process.execPath, [cli, 'doctor', '--repo', repo, '--browser-path', join(root, 'missing-browser'), '--json'],
    { encoding: 'utf8', windowsHide: true, env, timeout: 30000, maxBuffer: 1024 * 1024 });
  return { root, tool, run };
}

for (const [version, compatible] of [['0.2.1-rc.5', true], ['v0.2.1-rc.5+fixture', true], ['0.2.1-rc.3', false], ['0.2.1-rc.50', false], ['0.2.1', false], ['unexpected output', false]]) {
  test(`doctor reports host compatibility for ${version}`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t);
    await f.tool('dsh', 'console.log(' + JSON.stringify(version) + ');\n');
    const child = f.run();
    assert.equal(child.error, undefined);
    const record = JSON.parse(child.stdout);
    const host = record.checks.find((check) => check.name.startsWith('dsh'));
    assert.equal(host.ok, compatible, JSON.stringify({ version, host }));
  });
}

test('doctor stops a stalled version probe and its owned child', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const pidFile = join(f.root, 'version-child.pid');
  await f.tool('dsh', 'require("node:fs").writeFileSync(' + JSON.stringify(pidFile) + ', String(process.pid)); setTimeout(() => process.exit(0), 15000);\n');
  const child = f.run();
  assert.equal(child.error, undefined);
  const record = JSON.parse(child.stdout);
  const host = record.checks.find((check) => check.name.startsWith('dsh'));
  assert.equal(host.ok, false);
  assert.match(host.detail, /timed out/i);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('doctor reports a missing repository without crashing its JSON response', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.tool('dsh', 'console.log("0.2.1-rc.5");\n');
  const child = f.run(join(f.root, 'missing-project'));
  assert.equal(child.error, undefined);
  const record = JSON.parse(child.stdout);
  assert.equal(record.status, 'PROBLEMS');
  assert.equal(record.checks.find((check) => check.name.startsWith('project is a git')).ok, false);
});
