import { generateKeyPairSync } from 'node:crypto';
import { createPlan, runStage, signPlan, type ReleaseAdapter, type ReleaseState, type Probe } from './gate.ts';

// A deterministic rehearsal of the operator workflow. Keys exist only for this invocation.
export async function demo() {
  const baseline: ReleaseState = {
    target: { server: 'https://demo.invalid', environmentId: 1, projectId: 1, experimentId: 1, featureId: 1, feature: 'checkout_copy' },
    status: 'created', hypothesis: 'Shorter labels increase checkouts.', metrics: [{ id: 1, direction: 'increase' }],
    rollout: { enabled: false, percentage: 0, control: { type: 'string', value: 'Checkout' }, variants: [{ id: 2, weight: 100, value: 'Pay' }],
      audience: { match: 'any', segmentIds: [7] } },
  };
  const probes: Probe[] = [
    { cohort: 'member', identifier: 'demo-canary', traits: ['plan=beta'], enabled: true, value: 'Pay' },
    { cohort: 'nonmember', identifier: 'demo-outside', traits: ['plan=free'], enabled: true, value: 'Checkout' },
  ];
  const plan = createPlan(baseline, [5, 25].map(percentage => ({ percentage, probes })));
  const state = structuredClone(baseline);
  const adapter: ReleaseAdapter = {
    async read() { return structuredClone(state); },
    async policy() { return { permitted: true, localCapUsd: 15, remoteCapUsd: 2, spentUsd: 0 }; },
    async start() { state.status = 'running'; state.rollout.enabled = true; },
    async rollout(enabled, percentage) { Object.assign(state.rollout, { enabled, percentage }); },
    async evaluate(probe) {
      const canary = state.rollout.enabled && state.rollout.percentage >= 5 && probe.traits.includes('plan=beta');
      return { enabled: true, value: canary ? 'Pay' : 'Checkout' };
    },
  };
  const trust: Record<string, string> = {};
  const signatures = ['demo-operator', 'demo-reviewer'].map(name => {
    const pair = generateKeyPairSync('ed25519', { publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
    trust[name] = pair.publicKey;
    return signPlan(plan, name, pair.privateKey);
  });
  const receipts = [];
  for (const stage of plan.stages) receipts.push(await runStage(plan, 'apply', stage.percentage, signatures, trust, adapter));
  for (const stage of plan.stages.toReversed()) receipts.push(await runStage(plan, 'rollback', stage.percentage, signatures, trust, adapter));
  return { mode: 'offline rehearsal', plan: plan.digest, receipts, finalEnrollment: { enabled: state.rollout.enabled, percentage: state.rollout.percentage } };
}
