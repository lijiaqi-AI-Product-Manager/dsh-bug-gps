import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { git } from '../src/core/snapshot.js';

export const EXAMPLE_DIR = fileURLToPath(new URL('../examples/cart-shop/', import.meta.url));

export async function withEnv(dir = EXAMPLE_DIR) {
  const env = await launchBrowser();
  const server = await startStaticServer(dir);
  return {
    ...env,
    url: server.url,
    async close() { await env.browser.close(); await server.close(); },
  };
}

/** Copies the example into a fresh git repo (path contains a space on purpose). */
export async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), 'buggps repo '));
  await cp(EXAMPLE_DIR, root, { recursive: true });
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'seeded']);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
