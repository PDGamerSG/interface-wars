import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpsFlags } from '../src/experiment/ops.ts';

test('ops flags parse a disabled kill switch and a numeric remote cap', () => {
  assert.deepEqual(parseOpsFlags([
    { feature: { name: 'trials_enabled' }, enabled: false, feature_state_value: null },
    { feature: { name: 'spend_cap_usd' }, enabled: true, feature_state_value: '2.50' },
  ]), { trialsEnabled: false, spendCapUsd: 2.5 });
});

test('missing or invalid ops values use safe runner defaults', () => {
  assert.deepEqual(parseOpsFlags([]), { trialsEnabled: true, spendCapUsd: null });
  assert.deepEqual(parseOpsFlags([{ feature: { name: 'spend_cap_usd' }, enabled: true, feature_state_value: 'not-a-number' }]), { trialsEnabled: true, spendCapUsd: null });
});
