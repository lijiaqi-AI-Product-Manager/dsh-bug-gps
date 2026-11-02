// Starts a dev server BugGPS owns (argv array, no shell string from the model), waits until its
// URL answers, and stops the whole process tree it created — and nothing else.
import { spawn, execFile } from 'node:child_process';
import { EnvBlockedError } from './errors.js';

export async function startDevServer({ cwd, argv, url, readyTimeoutMs = 60_000, env, logLimit = 64 * 1024 }) {
  // Something already answering on the URL would make "ready" meaningless: replay would hit
  // that server, not ours, and the result would not belong to this code.
  if (await answers(url)) {
    throw new EnvBlockedError(`something is already serving ${url}; BugGPS needs that port free to start its own server from this working tree`, 'Stop the other server or give BugGPS a different port in its serve command (e.g. vite --port 5199 --strictPort).');
  }
  const { cmd, args, opts } = spawnSpec(argv);
  const child = spawn(cmd, args, { cwd, env: { ...process.env, BROWSER: 'none', ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', ...opts });
  let log = '';
  const append = (b) => { log = (log + b.toString()).slice(-logLimit); }; // bounded tail
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let exited = null;
  child.once('exit', (code, sig) => { exited = { code, sig }; });
  child.once('error', (err) => { exited = { error: err.message }; });

  const stop = async () => {
    await killTree(child);
    // Wait until the port is released so a following start does not see a dying server.
    for (let i = 0; i < 25 && (await answers(url)); i++) await new Promise((r) => setTimeout(r, 200));
  };
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new EnvBlockedError(`dev server exited early: ${JSON.stringify(exited)}\n${log.slice(-2000)}`, 'Check that dependencies are installed and the dev command works on its own.');
    if (await answers(url, 5000)) return { url, pid: child.pid, stop, log: () => log };
    await new Promise((r) => setTimeout(r, 300));
  }
  await stop();
  throw new EnvBlockedError(`dev server did not answer at ${url} within ${readyTimeoutMs} ms\n${log.slice(-2000)}`, 'Increase readyTimeoutMs or check the port.');
}

async function answers(url, timeoutMs = 1000) {
  try { const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }); return res.status < 500; } catch { return false; }
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
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    if (process.platform === 'win32') {
      // /T kills the tree rooted at OUR child pid only.
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
    setTimeout(resolve, 5000).unref();
  });
}
