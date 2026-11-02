// Content-addresses the working tree (tracked, modified and untracked-but-not-ignored files)
// as a git tree SHA, using a throwaway index so the user's index and worktree stay untouched.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXCLUDE = [
  ':(exclude).buggps',
  // Vite 4 writes its bundled config next to vite.config.* while the server runs and deletes it
  // on exit; a killed server can leave it behind. Never part of a fix.
  ':(exclude,glob)**/vite.config.*.timestamp-*.mjs',
];

export function git(cwd, args, { env, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((ok, fail) => {
    execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; fail(err); } else ok(stdout);
    });
  });
}

export async function snapshotTree(repoDir) {
  const dir = await mkdtemp(join(tmpdir(), 'buggps-idx-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const hasHead = await git(repoDir, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
    if (hasHead) await git(repoDir, ['read-tree', 'HEAD'], { env });
    await git(repoDir, ['add', '-A', '--', '.', ...EXCLUDE], { env });
    return (await git(repoDir, ['write-tree'], { env })).trim();
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
