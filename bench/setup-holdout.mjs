#!/usr/bin/env node
// Creates owned worktrees and locked dependencies; never reuses a developer checkout.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, cp, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./holdout-cases.json', import.meta.url), 'utf8'));
const requested = new Set(process.argv.slice(2));
if ([...requested].some((id) => !manifest.cases.some((spec) => spec.id === id))) throw new Error('Unknown dataset case');
const selected = manifest.cases.filter((spec) => !requested.size || requested.has(spec.id));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const stateFile = resolve(process.env.BUGGPS_HOLDOUT_STATE ?? join(source, '.buggps/holdout/workspaces.json'));
await mkdir(dirname(stateFile), { recursive: true });
const state = existsSync(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : { root: await mkdtemp(join(tmpdir(), 'bgh-')), dataset: manifest.dataset, manifestSha256: sha(JSON.stringify(manifest)), createdAt: new Date().toISOString(), cases: [] };
const root = await realpath(state.root);
if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith('bgh-') || state.manifestSha256 !== sha(JSON.stringify(manifest))) throw new Error('Workspace ownership or frozen manifest mismatch');
const save = () => writeFile(stateFile, JSON.stringify(state, null, 2) + '\n');
const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find((p) => p && existsSync(p));
if (!npmCli) throw new Error('npm CLI not found');
for (const d of ['repos', 'cases', 'deps']) await mkdir(join(root, d), { recursive: true });
const git = (args, cwd = root) => execFileSync('git', ['-c', 'core.longpaths=true', ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
for (const spec of selected) {
  let entry = state.cases.find((c) => c.id === spec.id);
  if (entry?.status === 'READY') continue;
  if (!entry) { entry = { id: spec.id, attempts: [] }; state.cases.push(entry); }
  else entry.attempts.push({ status: entry.status, reason: entry.reason });
  Object.assign(entry, { status: 'PREPARING', dir: join(root, 'cases', spec.id + '-' + Date.now()) });
  delete entry.reason; await save();
  try {
    const mirror = join(root, 'repos', spec.project + '.git');
    if (!existsSync(mirror)) {
      git(['init', '--bare', mirror]);
      git(['--git-dir', mirror, 'remote', 'add', 'origin', spec.repo + '.git']);
    }
    for (const revision of [spec.buggyCommit, spec.fixCommit]) {
      try { git(['--git-dir', mirror, 'cat-file', '-e', revision + '^{commit}']); }
      catch { git(['--git-dir', mirror, 'fetch', '--no-tags', '--depth=1', '--no-filter', 'origin', revision]); }
    }
    git(['--git-dir', mirror, 'worktree', 'add', '--detach', entry.dir, spec.buggyCommit]);
    const packageText = await readFile(join(entry.dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(packageText);
    if (pkg.workspaces?.length) throw new Error('Workspace packages need an explicit fixture layout');
    const manager = pkg.packageManager?.split('@')[0] ?? (existsSync(join(entry.dir, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(entry.dir, 'yarn.lock')) ? 'yarn' : 'npm');
    if (!['npm', 'pnpm', 'yarn'].includes(manager)) throw new Error('Unsupported package manager');
    const lock = manager === 'pnpm' ? 'pnpm-lock.yaml' : manager === 'yarn' ? 'yarn.lock' : 'package-lock.json';
    const lockText = await readFile(join(entry.dir, lock), 'utf8');
    const lockVersion = Number(lockText.match(/lockfileVersion:\s*['"]?([\d.]+)/)?.[1] ?? 0);
    const version = pkg.packageManager?.match(/^[a-z]+@([\d][\w.-]*)/)?.[1] ?? (manager === 'yarn' ? '1.22.22' : manager === 'pnpm' ? lockVersion >= 9 ? '10.34.9' : lockVersion >= 6 ? '8.15.9' : '7.33.7' : null);
    const configs = ['.npmrc', '.yarnrc', 'pnpm-workspace.yaml'].filter((f) => existsSync(join(entry.dir, f)));
    const configText = await Promise.all(configs.map((f) => readFile(join(entry.dir, f), 'utf8')));
    if (configText.some((t) => /_authToken|_password|_auth\s*=/.test(t))) throw new Error('Credential fields in package manager configuration');
    const depRoot = join(root, 'deps', sha(JSON.stringify({ repo: spec.repo, node: process.version, platform: process.platform, manager, version, packageText, lockText, configText })).slice(0, 16));
    await mkdir(depRoot, { recursive: true });
    for (const f of ['package.json', lock, ...configs]) await copyFile(join(entry.dir, f), join(depRoot, f));
    if (!existsSync(join(depRoot, '.installed'))) {
      const args = manager === 'npm' ? [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'] : [npmCli, 'exec', '--yes', '--package=' + manager + '@' + version, '--', manager, 'install', '--frozen-lockfile', '--ignore-scripts', ...(manager === 'pnpm' ? ['--store-dir', join(root, 'store', version), '--package-import-method=copy'] : ['--non-interactive'])];
      execFileSync(process.execPath, args, { cwd: depRoot, windowsHide: true, stdio: 'inherit' });
      if (!existsSync(join(depRoot, 'node_modules/vite/bin/vite.js'))) throw new Error('Missing Vite after locked install');
      await writeFile(join(depRoot, '.installed'), 'locked dependency installation completed\n');
    }
    // This historical build plugin reads git metadata relative to its own module directory.
    if (spec.project === 'qwerty-learner') await cp(join(depRoot, 'node_modules'), join(entry.dir, 'node_modules'), { recursive: true });
    else await symlink(join(depRoot, 'node_modules'), join(entry.dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    Object.assign(entry, { status: 'READY', depRoot, manager, managerVersion: version, lockSha256: sha(lockText), dependencyMode: spec.project === 'qwerty-learner' ? 'copied-into-worktree' : 'linked-cache' });
  } catch (error) { entry.status = 'ENV_BLOCKED'; entry.reason = String(error.message).replaceAll(root, '<fixture-root>').slice(0, 1200); }
  await save(); console.log(JSON.stringify({ case: spec.id, status: entry.status }));
}
const ready = selected.filter((spec) => state.cases.some((entry) => entry.id === spec.id && entry.status === 'READY')).length;
console.log(JSON.stringify({ cases: manifest.denominator, selected: selected.length, ready, stateFile }));
if (ready !== selected.length) process.exitCode = 1;
