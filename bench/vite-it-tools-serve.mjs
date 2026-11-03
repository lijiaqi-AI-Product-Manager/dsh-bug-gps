// IT-Tools fixture: prepare the cold Vite4 dependency cache before serving requests.
// Each checkout keeps its own cache; application source and checks remain unchanged.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Expected a local benchmark port');
process.env.CI = 'true';
const require = createRequire(join(process.cwd(), 'package.json'));
const imported = await import(pathToFileURL(require.resolve('vite')).href);
const vite = imported.createServer ? imported : imported.default;
if (!vite?.resolveConfig || !vite.optimizeDeps || !vite.createServer) throw new Error('Expected the verified Vite4 dependency-preparation API');
const input = {
  root: process.cwd(), cacheDir: join(process.cwd(), '.buggps/vite-cache'), clearScreen: false,
  optimizeDeps: { include: ['marked', 'dompurify'] },
  server: { host: '127.0.0.1', port, strictPort: true, open: false },
};
const started = Date.now();
await vite.optimizeDeps(await vite.resolveConfig(input, 'serve'), false, true);
console.log(JSON.stringify({ phase: 'dependency-preparation', durationMs: Date.now() - started }));
const server = await vite.createServer(input);
await server.listen(); server.printUrls();
let stopping;
const stop = () => stopping ??= server.close().then(() => process.exit(0));
process.on('SIGTERM', stop); process.on('SIGINT', stop);
