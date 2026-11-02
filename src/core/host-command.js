import { stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { EnvBlockedError } from './errors.js';

/** Resolve executable identity before passing literal argv to the host provider. */
export async function hostCommand(argv, cwd, subprocess, env, signal) {
  const [requested, ...args] = argv;
  let executable;
  try {
    const command = requested === 'node' ? process.execPath
      : !isAbsolute(requested) && /[\\/]/.test(requested) ? resolve(cwd, requested) : requested;
    executable = await subprocess.resolveExecutable(command, env, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new EnvBlockedError('cannot resolve the configured server executable', 'Check the command and PATH, or use an absolute executable path.');
  }
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) return [executable, ...args];

  // Package-manager shims are launchers for these JS entrypoints. Running Node
  // directly avoids mixing cmd.exe's quoting rules with literal host argv.
  const name = basename(executable, extname(executable)).toLowerCase();
  const packageName = name === 'npx' ? 'npm' : name;
  const entry = { npm: 'npm-cli.js', npx: 'npx-cli.js', pnpm: 'pnpm.cjs' }[name];
  if (entry) {
    const dir = dirname(executable);
    const candidates = [join(dir, 'node_modules', packageName, 'bin', entry), join(dir, '..', packageName, 'bin', entry), join(dir, 'node_modules', 'corepack', 'dist', name + '.js'), join(dir, '..', 'corepack', 'dist', name + '.js')];
    for (const file of candidates) {
      if (await stat(file).then((s) => s.isFile(), () => false)) return [process.execPath, file, ...args];
    }
  }
  throw new EnvBlockedError('the configured Windows script has no supported executable entrypoint', 'Use an .exe command, or configure Node plus the package manager or server JS entrypoint as separate arguments.');
}
