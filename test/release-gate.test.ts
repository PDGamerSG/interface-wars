import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createPlan, runStage, signPlan, type ReleaseAdapter, type ReleaseState } from '../skills/flagsmith-release-gate/scripts/gate.ts';

const baseline: ReleaseState = {
  target: { server: 'https://flags.example', environmentId: 8, projectId: 5, experimentId: 7, featureId: 14, feature: 'checkout_copy' },
  status: 'created', hypothesis: 'A shorter checkout label helps.', metrics: [{ id: 2, direction: 'increase' }],
  rollout: { enabled: false, percentage: 0, control: { type: 'string', value: 'control' },
    variants: [{ id: 10, weight: 100, value: 'variant' }], audience: { match: 'any', segmentIds: [4] } },
};
const probes = [
  { cohort: 'member' as const, identifier: 'member-1', traits: ['plan=beta'], enabled: true, value: 'variant' },
  { cohort: 'nonmember' as const, identifier: 'other-1', traits: ['plan=free'], enabled: true, value: 'control' },
];
const stages = [5, 25].map(percentage => ({ percentage, probes }));
const plan = createPlan(baseline, stages);
const key = () => generateKeyPairSync('ed25519', {
  publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
});
const alice = key();
const bob = key();
const signers = { alice: alice.publicKey, bob: bob.publicKey };
const signatures = [signPlan(plan, 'alice', alice.privateKey), signPlan(plan, 'bob', bob.privateKey)];

function fixture() {
  let state = structuredClone(baseline);
  const writes: string[] = [];
  const policy = { permitted: true, remoteCapUsd: 2, localCapUsd: 15, spentUsd: 1 };
  const adapter: ReleaseAdapter = {
    async read() { return structuredClone(state); },
    async policy() { return policy; },
    async start() {
      writes.push('start'); state.status = 'running'; state.rollout.enabled = true;
    },
    async rollout(enabled, percentage) {
      writes.push(`rollout ${enabled} ${percentage}`);
      state.rollout = { ...state.rollout, enabled, percentage };
    },
    async evaluate(p) { return { enabled: p.enabled, value: p.value }; },
  };
  const run = (action: 'apply' | 'rollback', percentage: number, estimatedCostUsd = 0.1) =>
    runStage(plan, action, percentage, signatures, signers, adapter, estimatedCostUsd);
  return { adapter, state, writes, policy, run };
}

test('only an off, zero-enrollment draft with increasing stages and both cohort probes can be planned', () => {
  assert.equal(createPlan(structuredClone(baseline), stages).digest, plan.digest);
  for (const rollout of [{ ...baseline.rollout, enabled: true }, { ...baseline.rollout, percentage: 5 }]) {
    assert.throws(() => createPlan({ ...baseline, rollout }, stages), /disabled.*zero/i);
  }
  assert.throws(() => createPlan(baseline, [stages[1], stages[0]]), /increasing/);
  assert.throws(() => createPlan(baseline, [{ percentage: 5, probes: [probes[0]] }]), /member/);
});

test('tampering, a stale signature, duplicate signers and two names for one key all leave the target untouched', async () => {
  const f = fixture();
  const changed = createPlan(baseline, [{ ...stages[0], percentage: 8 }]);
  await assert.rejects(runStage({ ...plan, stages: changed.stages }, 'apply', 5, signatures, signers, f.adapter), /digest/i);
  await assert.rejects(runStage(changed, 'apply', 8, signatures, signers, f.adapter), /approval/i);
  await assert.rejects(runStage(plan, 'apply', 5, signatures.slice(0, 1), signers, f.adapter), /approval/i);
  await assert.rejects(runStage(plan, 'apply', 5, [signatures[0], signatures[0]], signers, f.adapter), /approval/i);
  await assert.rejects(runStage(plan, 'apply', 5, [signatures[0], signPlan(plan, 'bob', alice.privateKey)],
    { alice: alice.publicKey, bob: alice.publicKey }, f.adapter), /approval/i);
  assert.deepEqual(f.writes, []);
});

test('both gates are checked immediately before each write and a retry resumes at zero', async () => {
  const f = fixture();
  f.adapter.start = async () => {
    f.writes.push('start'); f.state.status = 'running'; f.state.rollout.enabled = true;
    f.policy.permitted = false;
  };
  await assert.rejects(f.run('apply', 5), /policy/i);
  assert.deepEqual(f.writes, ['start']);
  f.policy.permitted = true; f.policy.remoteCapUsd = 1;
  await assert.rejects(f.run('apply', 5), /cap/i);
  f.policy.remoteCapUsd = 9; f.policy.localCapUsd = 0.5;
  await assert.rejects(f.run('apply', 5), /cap/i);
  f.policy.localCapUsd = 15;
  assert.equal((await f.run('apply', 5)).status, 'APPLIED');
  assert.deepEqual(f.writes, ['start', 'rollout true 5']);
});

test('an unreachable policy, skipped stage, wrong target or changed variant blocks every write', async () => {
  const f = fixture();
  await assert.rejects(f.run('apply', 25), /drift|order/i);
  f.state.target.environmentId = 10;
  await assert.rejects(f.run('apply', 5), /drift/i);
  f.state.target.environmentId = 8; f.state.rollout.variants[0].weight = 75;
  await assert.rejects(f.run('apply', 5), /drift/i);
  f.state.rollout.variants[0].weight = 100; f.adapter.policy = async () => { throw Error('policy unavailable'); };
  await assert.rejects(f.run('apply', 5), /policy/);
  assert.deepEqual(f.writes, []);
});

test('stages can be retried, verified and rolled back in reverse order to disabled enrollment', async () => {
  const f = fixture();
  assert.equal((await f.run('apply', 5)).probes.length, 2);
  assert.equal((await f.run('apply', 5)).status, 'ALREADY_APPLIED');
  const second = await f.run('apply', 25);
  assert.equal(second.status, 'APPLIED');
  assert.equal(second.rollback.percentage, 5);
  await assert.rejects(f.run('rollback', 5), /drift|order/i);
  await f.run('rollback', 25);
  await f.run('rollback', 5);
  assert.equal((await f.run('rollback', 5)).status, 'ALREADY_ROLLED_BACK');
  assert.deepEqual(f.writes, ['start', 'rollout true 5', 'rollout true 25', 'rollout true 5', 'rollout false 0']);
  assert.equal(f.state.status, 'running');
  assert.equal(f.state.rollout.enabled, false);
});

test('a cohort mismatch restores and verifies the previous enrollment; unrelated drift blocks restoration', async () => {
  const f = fixture();
  f.adapter.evaluate = async () => ({ enabled: true, value: 'control' });
  const result = await f.run('apply', 5);
  assert.equal(result.status, 'GUARDRAIL_ROLLED_BACK');
  assert.equal(result.probes[0].matched, false);
  assert.equal(f.state.rollout.percentage, 0);
  assert.equal(f.state.rollout.enabled, false);
  f.adapter.evaluate = async p => {
    f.state.rollout.variants[0].weight = 70;
    return { enabled: false, value: p.value };
  };
  await assert.rejects(f.run('apply', 5), /drift/i);
  assert.equal(f.writes.at(-1), 'rollout true 5');
});

test('an unacknowledged or partial write never receives a successful receipt', async () => {
  const f = fixture();
  f.adapter.rollout = async () => {};
  await assert.rejects(f.run('apply', 5), /read.back/i);
  assert.equal(f.state.rollout.percentage, 0);
});

test('the installed skill can run an offline rehearsal from outside the repository', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { tmpdir } = await import('node:os');
  const script = fileURLToPath(new URL('../skills/flagsmith-release-gate/scripts/release.ts', import.meta.url));
  const output = execFileSync(process.execPath, [script, 'demo'], { cwd: tmpdir(), env: {}, encoding: 'utf8' });
  const rehearsal = JSON.parse(output);
  assert.equal(rehearsal.mode, 'offline rehearsal');
  assert.deepEqual(rehearsal.receipts.map((r: { status: string }) => r.status), ['APPLIED', 'APPLIED', 'ROLLED_BACK', 'ROLLED_BACK']);
  assert.deepEqual(rehearsal.finalEnrollment, { enabled: false, percentage: 0 });
});

test('a write reserves its estimated cost against the lower available cap', async () => {
  const f = fixture();
  f.policy.spentUsd = 1.95;
  await assert.rejects(f.run('apply', 5), /estimated|cap/i);
});
