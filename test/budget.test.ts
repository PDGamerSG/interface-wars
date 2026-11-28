// The machine spend cap must be a finite dollar amount before any paid request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExceeded, parseMachineCap } from '../src/agent/budget.ts';

test('a finite non-negative machine cap parses', () => {
  assert.equal(parseMachineCap('15'), 15);
  assert.equal(parseMachineCap(' 0.25 '), 0.25);
  assert.equal(parseMachineCap('0'), 0);
});

test('an unset, empty, infinite, negative or malformed machine cap stops the run', () => {
  for (const raw of [undefined, '', '  ', 'Infinity', '-1', 'abc', '15usd', 'NaN']) {
    assert.throws(() => parseMachineCap(raw), BudgetExceeded, String(raw));
  }
});
