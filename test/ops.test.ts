import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpsFlags, trialGate, type OpsFlags } from '../src/experiment/ops.ts';

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

const flags = (over: Partial<OpsFlags> = {}): OpsFlags => ({ trialsEnabled: true, spendCapUsd: null, source: 'flagsmith', ...over });
const paid = { dryRun: false, allowOffline: false };

test('the gate stops paid trials when the kill switch is off, in every mode', () => {
  for (const mode of [paid, { dryRun: true, allowOffline: false }, { dryRun: false, allowOffline: true }]) {
    assert.equal(trialGate(flags({ trialsEnabled: false }), mode).start, false);
  }
});

test('the gate fails closed for paid trials when the ops flags cannot be read', () => {
  const outage = flags({ source: 'unavailable' });
  const blocked = trialGate(outage, paid);
  assert.equal(blocked.start, false);
  assert.match(!blocked.start ? blocked.reason : '', /IW_OPS_OFFLINE=1/);
  assert.equal(trialGate(outage, { dryRun: false, allowOffline: true }).start, true);
  assert.equal(trialGate(outage, { dryRun: true, allowOffline: false }).start, true);
  assert.equal(trialGate(flags(), paid).start, true);
});
