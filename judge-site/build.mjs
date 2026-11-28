import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, '..', 'web', 'public', 'data');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
for (const name of ['readout.json', 'meta.json', 'trials.json']) cpSync(join(source, name), join(dist, name));
writeFileSync(join(dist, 'index.html'), readFileSync(join(root, 'index.html')));
// The deploy workflow polls this file to confirm which commit the live site serves.
// Render sets RENDER_GIT_COMMIT during a build. Local builds fall back to git.
function commit() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
writeFileSync(join(dist, 'version.json'), JSON.stringify({ commit: commit(), builtAt: new Date().toISOString() }) + '\n');
console.log(`Built ${dist}`);
