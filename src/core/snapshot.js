// Content-addresses the working tree (tracked, modified and untracked-but-not-ignored files)
// as a git tree SHA, using a throwaway index so the user's index and worktree stay untouched.
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Filter before adding files, so run artifacts never enter the object database.
const excluded = (file) => file === '.buggps' || file.startsWith('.buggps/')
  || /(?:^|\/)vite\.config\.[^/]*\.timestamp-[^/]*\.mjs$/.test(file);
const nulList = (files) => Buffer.from(files.join('\0') + '\0');

export function git(cwd, args, { env, input, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((ok, fail) => {
    const child = execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; fail(err); } else ok(stdout);
    });
    child.stdin.on('error', fail);
    child.stdin.end(input);
  });
}

export async function snapshotTree(repoDir) {
  const root = (await git(repoDir, ['rev-parse', '--show-toplevel'])).trimEnd();
  const dir = await mkdtemp(join(tmpdir(), 'buggps-idx-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    // Copy the current index so staged tracked files remain tracked even if ignored.
    // Reading the source index never refreshes or rewrites the user's staging area.
    const index = (await git(root, ['rev-parse', '--git-path', 'index'])).trimEnd();
    try { await copyFile(resolve(root, index), env.GIT_INDEX_FILE); } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await git(root, ['read-tree', '--empty'], { env });
    }
    const [tracked, untracked] = await Promise.all([
      git(root, ['ls-files', '--cached', '-z'], { env }),
      git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { env }),
    ]);
    const trackedNames = [...new Set(tracked.split('\0').filter(Boolean))];
    const names = [...new Set([...trackedNames, ...untracked.split('\0').filter(Boolean)])];
    const removed = names.filter(excluded);
    const included = names.filter((file) => !excluded(file));
    if (removed.length) await git(root, ['update-index', '--force-remove', '-z', '--stdin'], { env, input: nulList(removed) });
    const refresh = trackedNames.filter((file) => !excluded(file));
    if (refresh.length) await git(root, ['update-index', '--no-assume-unchanged', '--no-fsmonitor-valid', '-z', '--stdin'], { env, input: nulList(refresh) });
    // Literal NUL-delimited paths preserve whitespace and pathspec-looking filenames,
    // and avoid both command-line size limits and explicit ignored-directory errors.
    if (included.length) await git(root, ['--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: nulList(included) });
    return (await git(root, ['write-tree'], { env })).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Binary-safe patch between two snapshot trees. Returns the full text; never truncated. */
export async function diffTrees(repoDir, fromTree, toTree) {
  return git(repoDir, ['diff', '--binary', '--no-color', fromTree, toTree]);
}

export async function diffStat(repoDir, fromTree, toTree) {
  return (await git(repoDir, ['diff', '--stat', '--no-color', fromTree, toTree])).trim();
}
