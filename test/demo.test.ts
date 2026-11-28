import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadDemo, renderDemo } from '../src/demo.ts';

test('offline demo replays the recorded comparison, safety sensitivity, approval and follow-up jobs', () => {
  const demo = loadDemo();
  const output = renderDemo(demo);

  assert.match(output, /offline archive demo/i);
  assert.match(output, /main-0138.*MCP.*start_experiment.*WRONG/s);
  assert.match(output, /main-0074.*CLI.*start_experiment.*WRONG/s);
  assert.match(output, /main-0154.*CLI \+ skill.*start_experiment.*CORRECT/s);
  assert.match(output, /Registered result: cli_skill WIN/);
  assert.match(output, /Strict staging-safe interpretation: mcp 64\/87, cli 75\/82, cli_skill 80\/86/);
  assert.match(output, /Skill vs MCP.*19\.5 \[0\.0, 42\.6\]/);
  assert.match(output, /Approval: Pallab Das approved cli_skill/);
  assert.match(output, /After ship: 6\/6 jobs passed on cli_skill/);
  for (const id of ['after-ship-0000', 'after-ship-0001', 'after-ship-0002', 'after-ship-0003', 'after-ship-0004', 'after-ship-0005']) {
    assert.match(output, new RegExp(id));
  }

  assert.doesNotMatch(output, /P4GoJMG3gBhyneTnj6PxUv|doY9WkJcgEQSjHdB9MtQiq|nsXh46vn6XMeUvfKSKeved/);
  assert.doesNotMatch(output, /Api-Key\s+[A-Za-z0-9._~+/=-]{8,}|sk-ant-[A-Za-z0-9_-]{10,}/i);
});

test('offline demo rejects a missing archived case instead of inventing evidence', () => {
  assert.throws(() => loadDemo('/tmp/interface-wars-demo-does-not-exist'), /No archived main trials/);
});

test('the demo command is offline and uses the archived formatter', () => {
  const output = execFileSync('npm', ['run', 'demo', '--silent'], { encoding: 'utf8' });
  assert.match(output, /Recorded evidence only/);
  assert.match(output, /After ship: 6\/6 jobs passed/);
});
