import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('web export is deterministic for an unchanged archived run', () => {
  const root = mkdtempSync(join(tmpdir(), 'interface-wars-export-'));
  const first = join(root, 'first');
  const second = join(root, 'second');
  try {
    for (const out of [first, second]) {
      execFileSync(process.execPath, ['scripts/export-web-data.ts', 'main', '--out', out], { stdio: 'pipe' });
    }
    const files = ['meta.json', 'readout.json', 'jobs.json', 'trials.json', 'skill.md', 'findings.md', 'preregistration.md', 'deviations.md'];
    for (const file of files) assert.equal(readFileSync(join(first, file), 'utf8'), readFileSync(join(second, file), 'utf8'), file);
    assert.equal(readFileSync(join(first, 'meta.json'), 'utf8'), readFileSync(join(second, 'meta.json'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
