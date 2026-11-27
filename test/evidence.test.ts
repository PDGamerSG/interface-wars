import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvidence, matrix, openEvidence, recoveries, schemaFailures } from '../src/evidence/index.ts';

test('evidence index reproduces cross-trial answers and redacts credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interface-wars-evidence-'));
  const path = join(dir, 'evidence.sqlite');
  try {
    const built = buildEvidence('main', path);
    assert.equal(built.trials, 255);
    assert.match(built.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(matrix(path).map((row) => ({ ...row })), [
      { tool_errors: 0, correct: 0, trials: 7 },
      { tool_errors: 0, correct: 1, trials: 197 },
      { tool_errors: 1, correct: 0, trials: 19 },
      { tool_errors: 1, correct: 1, trials: 32 },
    ]);
    assert.deepEqual({ ...schemaFailures(path) }, {
      create_metric_calls: 13,
      calls_with_definition_input: 13,
      required_definition_errors: 13,
      trials: 5,
      correct_trials: 0,
    });
    assert.equal(recoveries(path).recovered_trials, 32);
    assert.ok(existsSync(path));
    const bytes = readFileSync(path).toString('utf8');
    assert.doesNotMatch(bytes, /Api-Key\s+[A-Za-z0-9._~+/=-]{8,}/);
    assert.doesNotMatch(bytes, /sk-ant-[A-Za-z0-9_-]{10,}/);
    const db = openEvidence(path);
    assert.throws(() => db.exec('CREATE TABLE forbidden (id INTEGER)'), /readonly|query.only/i);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
