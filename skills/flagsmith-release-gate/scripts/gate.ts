// Standalone Agent Skill. All promotion and restoration writes pass through the same guarded path.
import { createHash, createPublicKey, sign, verify } from 'node:crypto';

export type ReleaseState = {
  target: { server: string; environmentId: number; projectId: number; experimentId: number; featureId: number; feature: string };
  status: string;
  hypothesis: string;
  metrics: { id: number; direction: string }[];
  rollout: {
    enabled: boolean; percentage: number;
    control: { type: string; value: string };
    variants: { id: number; weight: number; value: string | number | boolean | null }[];
    audience: { match: string; segmentIds: number[] };
  };
};
export type Probe = {
  cohort: 'member' | 'nonmember'; identifier: string; traits: string[];
  enabled: boolean; value: string | number | boolean | null;
};
export type Stage = { percentage: number; probes: Probe[] };
type Policy = { permitted: boolean; remoteCapUsd: number; localCapUsd: number; spentUsd: number };
export type ReleaseAdapter = {
  read(): Promise<ReleaseState>;
  policy(): Promise<Policy>;
  start(): Promise<void>;
  rollout(enabled: boolean, percentage: number): Promise<void>;
  evaluate(probe: Probe): Promise<{ enabled: boolean; value: unknown }>;
};

export function digest(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function createPlan(baseline: ReleaseState, stages: Stage[]) {
  if (baseline.status !== 'created' || baseline.rollout.enabled !== false || baseline.rollout.percentage !== 0)
    throw Error('Plan requires a created draft with disabled enrollment and zero rollout percentage.');
  if (baseline.rollout.audience.segmentIds.length !== 1) throw Error('Select one target audience segment on the draft.');
  if (!Array.isArray(stages) || !stages.length) throw Error('Provide at least one rollout stage.');
  let previous = 0;
  for (const stage of stages) {
    if (!Number.isFinite(stage.percentage) || stage.percentage <= previous || stage.percentage > 100)
      throw Error('Stage percentages must be strictly increasing in (0, 100].');
    previous = stage.percentage;
    const cohorts = new Set<string>();
    const identifiers = new Set<string>();
    for (const p of stage.probes) {
      if (!['member', 'nonmember'].includes(p.cohort) || typeof p.identifier !== 'string' || !p.identifier.trim() ||
          identifiers.has(p.identifier) || !Array.isArray(p.traits) ||
          !p.traits.every(t => typeof t === 'string' && /^[^=\s]+=.*/.test(t)) ||
          typeof p.enabled !== 'boolean' ||
          !(p.value === null || ['string', 'boolean'].includes(typeof p.value) || Number.isFinite(p.value)))
        throw Error('Each probe needs a unique synthetic identity, cohort, traits and expected flag state.');
      identifiers.add(p.identifier);
      cohorts.add(p.cohort);
    }
    if (cohorts.size !== 2) throw Error('Each stage needs a member and a nonmember probe.');
  }
  const body = { version: 1, baseline, stages };
  return { ...body, digest: digest(body) };
}
export type ReleasePlan = ReturnType<typeof createPlan>;
export type Approval = { by: string; digest: string; signature: string };

function verifiedDigest(plan: ReleasePlan) {
  if (plan.version !== 1 || createPlan(plan.baseline, plan.stages).digest !== plan.digest)
    throw Error('Plan digest mismatch.');
  return Buffer.from('flagsmith-release-gate/v1\n' + plan.digest);
}

export function signPlan(plan: ReleasePlan, by: string, privateKey: string): Approval {
  return { by, digest: plan.digest, signature: sign(null, verifiedDigest(plan), privateKey).toString('base64') };
}

function requireApprovals(plan: ReleasePlan, approvals: Approval[], trusted: Record<string, string>) {
  const message = verifiedDigest(plan);
  const keys = new Set<string>();
  for (const a of approvals) {
    if (!Object.hasOwn(trusted, a.by) || a.digest !== plan.digest) continue;
    const key = createPublicKey(trusted[a.by]);
    if (key.asymmetricKeyType === 'ed25519' && verify(null, message, key, Buffer.from(a.signature, 'base64')))
      keys.add(key.export({ type: 'spki', format: 'der' }).toString('base64'));
  }
  if (keys.size < 2) throw Error('Approval required from two trusted signers with distinct keys for this plan.');
}

function stateAt(plan: ReleasePlan, percentage: number, enabled = percentage > 0): ReleaseState {
  return { ...plan.baseline, status: 'running', rollout: { ...plan.baseline.rollout, enabled, percentage } };
}

async function guardedWrite(adapter: ReleaseAdapter, expected: ReleaseState, next: ReleaseState, write: () => Promise<void>) {
  if (digest(await adapter.read()) !== digest(expected)) throw Error('State drift before write. Read the target again.');
  const policy = await adapter.policy();
  if (policy.permitted !== true) throw Error('Release policy denied this write.');
  const amounts = [policy.localCapUsd, policy.remoteCapUsd, policy.spentUsd];
  if (!amounts.every(value => Number.isFinite(value) && value >= 0) ||
      policy.spentUsd >= Math.min(policy.localCapUsd, policy.remoteCapUsd)) throw Error('Release spend cap reached or unavailable.');
  await write();
  if (digest(await adapter.read()) !== digest(next)) throw Error('Read-back mismatch. Inspect the live state before retrying.');
}

export async function runStage(plan: ReleasePlan, action: 'apply' | 'rollback', percentage: number,
                               approvals: Approval[], signers: Record<string, string>, adapter: ReleaseAdapter) {
  requireApprovals(plan, approvals, signers);
  if (action !== 'apply' && action !== 'rollback') throw Error('Unknown release action.');
  const index = plan.stages.findIndex(stage => stage.percentage === percentage);
  if (index < 0) throw Error('Stage is absent from the signed plan.');
  const previous = stateAt(plan, plan.stages[index - 1]?.percentage ?? 0);
  const target = stateAt(plan, percentage);
  const armed = stateAt(plan, 0, true);
  const current = await adapter.read();
  const currentHash = digest(current);
  const at = (state: ReleaseState) => digest(state) === currentHash;
  const rollback = { planDigest: plan.digest, stage: percentage, percentage: previous.rollout.percentage,
    enabled: previous.rollout.enabled, expectedHash: digest(target), restoredHash: digest(previous) };
  const probes: { identifier: string; matched: boolean }[] = [];
  const receipt = (status: string, after: ReleaseState) => ({ status, before: currentHash, after: digest(after), rollback, probes });
  const restore = (from: ReleaseState) => guardedWrite(adapter, from, previous,
    () => adapter.rollout(previous.rollout.enabled, previous.rollout.percentage));

  // Starting is irreversible in the server's lifecycle. Its separate zero-percent state is a safe retry point.
  const first = index === 0;
  const draft = first && at(plan.baseline);
  const startedAtZero = first && at(armed);
  if (action === 'rollback') {
    if (at(previous) || draft) return receipt('ALREADY_ROLLED_BACK', current);
    if (!at(target) && !startedAtZero) throw Error('State drift or out-of-order rollback.');
    await restore(current);
    return receipt('ROLLED_BACK', previous);
  }

  if (!at(target)) {
    if (!(draft || startedAtZero || at(previous))) throw Error('State drift or out-of-order promotion.');
    if (draft) await guardedWrite(adapter, current, armed, () => adapter.start());
    await guardedWrite(adapter, draft ? armed : current, target, () => adapter.rollout(true, percentage));
  }
  for (const probe of plan.stages[index].probes) {
    // An unavailable evaluation also fails the guardrail. Restore only from the exact approved post-state.
    let matched = false;
    try {
      const observed = await adapter.evaluate(probe);
      matched = observed.enabled === probe.enabled && observed.value === probe.value;
    } catch { /* Guardrail read failed. */ }
    probes.push({ identifier: probe.identifier, matched });
  }
  if (probes.some(p => !p.matched)) {
    await restore(target);
    return receipt('GUARDRAIL_ROLLED_BACK', previous);
  }
  if (digest(await adapter.read()) !== digest(target)) throw Error('State drift during cohort evaluation.');
  return receipt(at(target) ? 'ALREADY_APPLIED' : 'APPLIED', target);
}
