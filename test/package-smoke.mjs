import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createServer } from 'node:net';

const source = process.cwd();

const root = await mkdtemp(join(tmpdir(), 'buggps-package-check-'));
const npmCli = [process.env.npm_execpath,
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  .find((file) => file && existsSync(file));
assert.ok(npmCli, 'run this check through npm run test:package');
function node(args, cwd = source) {
  return execFileSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
try {
  const packed = JSON.parse(node([npmCli, 'pack', '--json', '--pack-destination', root]))[0];
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'buggps-package-check', private: true }));
  node([npmCli, 'install', join(root, packed.filename), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installed = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  const installedPackages = Object.keys(installed.packages).filter(p => p.startsWith('node_modules/')).length;
  const hostPackages = await readdir(join(consumer, 'node_modules', '@deepseek-ai')).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
  const audit = JSON.parse(node([npmCli, 'audit', '--omit=dev', '--json'], consumer));
  assert.equal(hostPackages.length, 0);
  assert.equal(audit.metadata.vulnerabilities.total, 0);
  const cli = join(consumer, 'node_modules', 'dsh-bug-gps', 'bin', 'buggps.js');
  const demo = join(root, 'demo');
  node([cli, 'demo', demo], consumer);
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const n = server.address().port; server.close(() => resolve(n)); });
  });
  await writeFile(join(demo, 'buggps.config.json'), JSON.stringify({ serve: { command: ['node', 'serve.js', '.', String(port)], url: 'http://127.0.0.1:' + port + '/' } }));
  const button = name => ({ action: 'click', target: [{ by: 'role', role: 'button', name }] });
  const testCase = { steps: [{ action: 'goto', url: '/' }, button('Add Apple'), button('Add Banana'),
    { action: 'fill', target: [{ by: 'role', role: 'textbox', name: 'Coupon' }], value: 'SAVE10' }, button('Apply coupon'), button('Remove Apple')],
    expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$18.00' } };
  const input = join(root, 'case.json');
  await writeFile(input, JSON.stringify(testCase));
  const locked = JSON.parse(node([cli, 'lock', '--case', input, '--repo', demo, '--id', 'package-smoke', '--json']));
  assert.equal(locked.caseId, 'package-smoke');
  const appPath = join(demo, 'app.js');
  const original = await readFile(appPath, 'utf8');
  const fixed = original.replace(/\/\/ SEEDED BUG 1: should call recompute\(\);[^\r\n]*\r?\n\s*renderCart\(\);/, '      recompute();');
  assert.notEqual(fixed, original);
  await writeFile(appPath, fixed);
  const verified = JSON.parse(node([cli, 'verify', '--repo', demo, '--id', 'package-smoke', '--json']));
  assert.equal(verified.verdict, 'VERIFIED');
  const summary = { installed_packages: installedPackages, host_packages: hostPackages.length, production_advisories: audit.metadata.vulnerabilities.total, packed_files: packed.files.length, installed_demo_locked: true, verdict: verified.verdict, tally: verified.check.tally };

  console.log(JSON.stringify(summary));
} finally {
  const target = await realpath(root);
  assert.equal(dirname(target), await realpath(tmpdir()));
  assert.ok(basename(target).startsWith('buggps-package-check-'));
  await rm(target, { recursive: true, force: true });
}