import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, '..', 'web', 'public', 'data');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
for (const name of ['readout.json', 'meta.json', 'trials.json']) cpSync(join(source, name), join(dist, name));
writeFileSync(join(dist, 'index.html'), readFileSync(join(root, 'index.html')));
console.log(`Built ${dist}`);
