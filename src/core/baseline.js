import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { git } from './snapshot.js';
import { EnvBlockedError } from './errors.js';

const checkSignal = (signal) => { signal?.throwIfAborted(); };

function relocated(argv, source, target) {
  return argv.map((arg) => {
    if (!isAbsolute(arg)) return arg;
    const rel = relative(source, arg);
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) ? join(target, rel) : arg;
  });
}

/** Runs a baseline snapshot without replacing candidate files or the user's index. */
export async function withBaseline(repoDir, tree, serve, run, { signal } = {}) {
  checkSignal(signal);
  // Align the application cwd with Node's canonical module paths, including Windows TEMP aliases.
  const container = await realpath(await mkdtemp(join(tmpdir(), 'buggps-baseline-')));
  const root = join(container, 'worktree');
  const links = [];
  const runtimeInputs = [];
  let registered = false;
  try {
    const commit = (await git(repoDir, ['-c', 'user.name=BugGPS', '-c', 'user.email=baseline@buggps.invalid', '-c', 'commit.gpgSign=false', 'commit-tree', tree, '-m', 'BugGPS verification baseline'])).trim();
    checkSignal(signal);
    await git(repoDir, ['worktree', 'add', '--detach', root, commit]);
    registered = true;
    checkSignal(signal);
    // Share installed dependencies, not generated application builds. The lockfiles
    // belong to the baseline tree; this link is an explicit, separately recorded input.
    const modules = join(repoDir, 'node_modules');
    const exists = (file) => lstat(file).then(() => true, (err) => { if (err.code === 'ENOENT') return false; throw err; });
    if (await exists(modules) && !(await exists(join(root, 'node_modules')))) {
      const link = join(root, 'node_modules');
      await symlink(await realpath(modules), link, process.platform === 'win32' ? 'junction' : 'dir');
      links.push(link);
      runtimeInputs.push({ path: 'node_modules', mode: 'shared-dependencies' });
    }
    for (const entry of await readdir(repoDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^\.env(?:\.|$)/.test(entry.name) || await exists(join(root, entry.name))) continue;
      const source = join(repoDir, entry.name);
      const stat = await lstat(source);
      if (stat.size > 1024 * 1024) throw new EnvBlockedError('baseline environment input exceeds 1 MiB', 'Use a small explicit development environment file.');
      const bytes = await readFile(source);
      await writeFile(join(root, entry.name), bytes, { flag: 'wx' });
      runtimeInputs.push({ path: entry.name, mode: 'copied-environment', sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    checkSignal(signal);
    const result = await run(root, { ...serve, command: relocated(serve.command, repoDir, root) });
    return { result, runtimeInputs };
  } finally {
    // Unlink owned junctions before removing the worktree; dependency targets remain intact.
    for (const link of links) {
      const stat = await lstat(link).catch((err) => { if (err.code === 'ENOENT') return null; throw err; });
      if (stat?.isSymbolicLink()) await unlink(link);
    }
    if (registered) {
      const actual = await realpath(root);
      if (dirname(actual) !== await realpath(container) || basename(actual) !== 'worktree') throw new EnvBlockedError('baseline worktree path changed during execution', 'Inspect the owned baseline directory before removing it.');
      await git(repoDir, ['worktree', 'remove', '--force', root]);
    }
    const actual = await realpath(container);
    if (dirname(actual) !== await realpath(tmpdir()) || !basename(actual).startsWith('buggps-baseline-')) throw new Error('Unexpected baseline cleanup path');
    await rm(actual, { recursive: true, force: true });
  }
}
