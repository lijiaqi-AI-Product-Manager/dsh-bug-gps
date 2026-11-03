import { createHash } from 'node:crypto';
import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startStaticServer } from '../../examples/serve.js';

const [originalDirectoryHash, port] = process.argv.slice(2);
const directory = await realpath(process.cwd());
const hash = createHash('sha256').update(directory).digest('hex');
if (hash !== originalDirectoryHash) await writeFile(join(directory, 'generated-types.d.ts'), '// regenerated during original control\nexport {};\n');
const server = await startStaticServer(directory, Number(port));
console.log(server.url);
