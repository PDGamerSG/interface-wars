// Scans every file Git tracks, or the paths given, for credential-shaped values: trial records, the web export,
// docs and code. Prints the file, line and rule, never the value, and exits 1 on any finding.
//   npm run scan:secrets
//   node scripts/scan-secrets.ts runs/my-new-run
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findCredentials } from '../src/evidence/secrets.ts';

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

const args = process.argv.slice(2);
const files = args.length
  ? args.flatMap(walk)
  : execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const findings: string[] = [];
let scanned = 0;
for (const file of files) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  scanned++;
  const text = bytes.toString('utf8');
  // Tests may hold synthetic fixtures with a registered digest; nothing else may.
  for (const hit of findCredentials(text, file.startsWith('test/'))) {
    const line = text.slice(0, hit.index).split('\n').length;
    findings.push(`${file}:${line}: ${hit.rule} (${hit.length} characters)`);
  }
}

if (findings.length) {
  console.error(`Credential scan failed: ${findings.length} finding(s) in ${scanned} files.\n  ` + findings.join('\n  '));
  process.exit(1);
}
console.log(`Credential scan passed: ${scanned} files, no credential-shaped values.`);
