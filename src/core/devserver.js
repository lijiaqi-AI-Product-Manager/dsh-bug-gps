// Starts an owned dev server, using the host's process range when available. The local
// fallback confirms shutdown and reports a blocked environment if descendants remain.
import { spawn, execFile } from 'node:child_process';
import { EnvBlockedError } from './errors.js';
import { hostCommand } from './host-command.js';

export async function startDevServer({ cwd, argv, url, readyTimeoutMs = 60_000, env, logLimit = 64 * 1024, signal, subprocess }) {
  signal?.throwIfAborted();
  // Something already answering on the URL would make "ready" meaningless: replay would hit
  // that server, not ours, and the result would not belong to this code.
  if (await answers(url)) {
    throw new EnvBlockedError(`something is already serving ${url}; BugGPS needs that port free to start its own server from this working tree`, 'Stop the other server or give BugGPS a different port in its serve command (e.g. vite --port 5199 --strictPort).');
  }
  signal?.throwIfAborted();
  let log = '';
  const append = (b) => { log = (log + b.toString()).slice(-logLimit); }; // bounded tail
  let exited = null;
  let pid;
  let terminate;
  let waitForExit;
  let readLog;
  if (subprocess) {
    // The host owns the process range, including detached descendants on Windows.
    // Only explicit application environment is forwarded; the provider scrubs credentials.
    const command = await hostCommand(argv, cwd, subprocess, env, signal);
    signal?.throwIfAborted();
    const handle = subprocess.spawn({ argv: command, cwd, env: { BROWSER: 'none', ...env }, stdio: { stdin: 'ignore', stdout: { maxBytes: logLimit }, stderr: { maxBytes: logLimit } }, graceMs: 1000, signal });
    handle.done.then((outcome) => { exited = outcome; }, (err) => { exited = { error: err.message }; });
    terminate = () => handle.terminate();
    waitForExit = () => handle.waitForExit();
    readLog = () => [handle.collected.stdout, handle.collected.stderr].map((reader) => reader?.readFrom(0).text ?? '').join('\n').slice(-logLimit);
  } else {
    const { cmd, args, opts } = spawnSpec(argv);
    const child = spawn(cmd, args, { cwd, env: { ...process.env, BROWSER: 'none', ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', ...opts });
    pid = child.pid;
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('exit', (code, sig) => { exited = { code, sig }; });
    child.once('error', (err) => { exited = { error: err.message }; });
    let killed;
    terminate = () => { killed ??= killTree(child); };
    waitForExit = () => killed ?? Promise.resolve();
    readLog = () => log;
  }
  const onAbort = () => { terminate(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  let stopping;
  const stop = () => stopping ??= (async () => {
    signal?.removeEventListener('abort', onAbort);
    terminate();
    let timer;
    try {
      await Promise.race([waitForExit(), new Promise((_, reject) => { timer = setTimeout(() => reject(new EnvBlockedError('owned process range did not stop', 'Inspect the task-owned server before retrying.')), 5000); })]);
    } finally { clearTimeout(timer); }
    const deadline = Date.now() + 5000;
    while (await answers(url, 500)) {
      if (Date.now() >= deadline) throw new EnvBlockedError(`server still answers at ${url} after stop`, 'The local runner could not confirm cleanup. Use the DSH subprocess service for commands that leave background descendants.');
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  try {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (await answers(url, 500)) {
        signal?.throwIfAborted();
        return { url, pid, stop, log: readLog, runner: subprocess ? 'host' : 'local' };
      }
      if (exited) throw new EnvBlockedError(`dev server exited early: ${JSON.stringify(exited)}\n${readLog().slice(-2000)}`, 'Check that dependencies are installed and the dev command works on its own.');
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new EnvBlockedError(`dev server did not answer at ${url} within ${readyTimeoutMs} ms\n${readLog().slice(-2000)}`, 'Increase readyTimeoutMs or check the port.');
  } catch (err) {
    await stop();
    throw err;
  }
}

async function answers(url, timeoutMs = 1000) {
  try { await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }); return true; } catch { return false; }
}

// "node" runs this Node binary directly. On Windows, npm/npx/pnpm are .cmd shims that
// child_process cannot spawn without a shell; run them through cmd.exe with each argument quoted.
function spawnSpec(argv) {
  const [cmd, ...args] = argv;
  if (cmd === 'node') return { cmd: process.execPath, args, opts: {} };
  if (process.platform === 'win32' && !/\.(exe|com)$/i.test(cmd)) {
    const line = argv.map(quoteWin).join(' ');
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], opts: { windowsVerbatimArguments: true } };
  }
  return { cmd, args, opts: {} };
}

function quoteWin(a) {
  return /^[A-Za-z0-9_\-.:/\\=@+]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`;
}

/**
 * Splits a command line into argv: double or single quotes group, nothing is expanded, and a
 * backslash is an ordinary character (Windows paths).
 */
export function parseCommand(line) {
  if (Array.isArray(line)) return line.map(String);
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(line)))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function killTree(child) {
  return new Promise((resolve) => {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!child.pid || process.platform === 'win32' && exited) return resolve();
    child.once('exit', () => resolve());
    if (process.platform === 'win32') {
      // /T kills the tree rooted at OUR child pid only.
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      if (exited) return resolve();
    }
    setTimeout(resolve, 5000).unref();
  });
}
