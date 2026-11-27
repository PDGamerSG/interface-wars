// DRY RUN ONLY. A scripted stand-in for Claude that exercises the whole pipeline (sandbox, Flagsmith
// assignment, events, results, readout, ship) without an API key. It solves the job with the reference
// solution at a fixed rate per arm and sometimes damages a decoy, so the numbers are made up by design.
// Dry-run records carry model "dry-run" and must never be reported as experiment results.
import type { Job } from '../jobs/catalog.ts';
import { solve } from '../jobs/reference.ts';
import type { Sandbox } from '../lab/sandbox.ts';
import type { AgentResult } from './loop.ts';
import type { ArmName } from '../arms/types.ts';

export const DRY_RUN = process.env.IW_DRY_RUN === '1';
const SOLVE_RATE: Record<ArmName, number> = { mcp: 0.55, cli: 0.65, cli_skill: 0.85 };
const DAMAGE_RATE: Record<ArmName, number> = { mcp: 0.15, cli: 0.1, cli_skill: 0.03 };

export async function dryRunAgent(arm: ArmName, job: Job, s: Sandbox): Promise<AgentResult> {
  const t0 = Date.now();
  if (Math.random() < SOLVE_RATE[arm]) await solve(job, s);
  if (Math.random() < DAMAGE_RATE[arm]) {
    const decoy = job.seed.features.at(-1)?.name;
    if (decoy && decoy !== job.seed.features[0]?.name) {
      const states = await s.admin.list(`/api/v1/environments/${s.env.Development.key}/featurestates/`);
      const target = states.find((x: any) => x.feature_segment === null && x.identity === null);
      if (target) await s.admin.put(`/api/v1/environments/${s.env.Development.key}/featurestates/${target.id}/`, { ...target, enabled: !target.enabled });
    }
  }
  const cost = { mcp: 0.14, cli: 0.07, cli_skill: 0.08 }[arm] * (0.7 + Math.random() * 0.6);
  return {
    outcome: 'done', finalText: 'DONE (dry run)', turns: [], toolCalls: 0, toolErrors: 0, ms: Date.now() - t0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: cost,
  };
}
