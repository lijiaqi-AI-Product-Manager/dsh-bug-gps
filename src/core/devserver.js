// Starts a dev server BugGPS owns (argv array, no shell string), waits until its URL answers,
// and stops the whole process tree it created — and nothing else.
import { spawn, execFile } from 'node:child_process';
import { EnvBlockedError } from './errors.js';

export async function startDevServer({ cwd, argv, url, readyTimeoutMs = 60_000, env, logLimit = 64 * 1024 }) {
  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, { cwd, env: { ...process.env, BROWSER: 'none', ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const append = (b) => { log = (log + b.toString()).slice(-logLimit); }; // bounded tail
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let exited = null;
  child.once('exit', (code, sig) => { exited = { code, sig }; });
  child.once('error', (err) => { exited = { error: err.message }; });

  const stop = () => killTree(child);
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new EnvBlockedError(`dev server exited early: ${JSON.stringify(exited)}\n${log.slice(-2000)}`, 'Check that dependencies are installed and the dev command works on its own.');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return { url, pid: child.pid, stop, log: () => log };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  await stop();
  throw new EnvBlockedError(`dev server did not answer at ${url} within ${readyTimeoutMs} ms\n${log.slice(-2000)}`, 'Increase readyTimeoutMs or check the port.');
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
