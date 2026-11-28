import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinalText } from '../src/agent/loop.ts';

test('only exact standalone DONE and FAILED lines classify a final response', () => {
  assert.equal(classifyFinalText('DONE: the flag is enabled'), 'done');
  assert.equal(classifyFinalText('FAILED: the API rejected the update'), 'failed');
  assert.equal(classifyFinalText('DONE? No, the experiment is still created'), 'incomplete');
  assert.equal(classifyFinalText('I could not finish the rollout.'), 'incomplete');
  assert.equal(classifyFinalText('DONE: it ran\nFAILED: the read-back was wrong'), 'incomplete');
  assert.equal(classifyFinalText('The word FAILED: appears in an explanation.'), 'incomplete');
});
