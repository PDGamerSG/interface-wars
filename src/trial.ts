// One trial = one Flagsmith identity = one real agent run on one real Flagsmith job.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jobFor, grade } from './jobs/catalog.ts';
import { createSandbox, destroySandbox, diff, snapshot } from './lab/sandbox.ts';
import { openCliArm } from './arms/cli.ts';
import { openMcpArm } from './arms/mcp.ts';
import { runAgent, MODEL, EFFORT, type AgentResult } from './agent/loop.ts';
import { dryRunAgent, DRY_RUN } from './agent/dryrun.ts';
import type { ArmName, Arm } from './arms/types.ts';
import { RUNS } from './lab/config.ts';

export type TrialRecord = {
  trialId: string;
  index: number;
  arm: ArmName;
  model: string;
  effort: string;
  template: string;
  family: string;
  heldOut: boolean;
  task: string;
  correct: boolean;
  reasons: string[];
  collateral: { path: string; before: unknown; after: unknown }[];
  changes: { path: string; before: unknown; after: unknown }[];
  outcome: string;
  finalText: string;
  costUsd: number;
  usage: unknown;
  toolCalls: number;
  toolErrors: number;
  turns: number;
  ms: number;
  commands: string[];
  transcript: unknown;
  startedAt: string;
};

export async function runTrial(opts: { run: string; index: number; trialId: string; arm: ArmName }): Promise<TrialRecord> {
  const job = jobFor(opts.index, opts.trialId);
  const startedAt = new Date().toISOString();
  const sandbox = await createSandbox(opts.trialId, job.seed);
  let arm: Arm | undefined;
  try {
    const before = await snapshot(sandbox);
    arm = opts.arm === 'mcp' ? await openMcpArm(sandbox) : await openCliArm(sandbox, opts.arm === 'cli_skill');
    const result: AgentResult = DRY_RUN ? await dryRunAgent(opts.arm, job, sandbox) : await runAgent(arm, sandbox, job.task);
    const after = await snapshot(sandbox);
    const changes = diff(before, after);
    const g = grade(job, before, after, changes);
    const record: TrialRecord = {
      trialId: opts.trialId,
      index: opts.index,
      arm: opts.arm,
      model: DRY_RUN ? 'dry-run' : MODEL,
      effort: EFFORT,
      template: job.template,
      family: job.family,
      heldOut: job.heldOut,
      task: job.task,
      correct: g.correct && result.outcome !== 'api_error',
      reasons: g.reasons,
      collateral: g.collateral,
      changes,
      outcome: result.outcome,
      finalText: result.finalText,
      costUsd: Number(result.costUsd.toFixed(6)),
      usage: result.usage,
      toolCalls: result.toolCalls,
      toolErrors: result.toolErrors,
      turns: result.turns.length,
      ms: result.ms,
      commands: arm.commands,
      transcript: result.turns,
      startedAt,
    };
    const dir = join(RUNS, opts.run, 'trials');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${opts.trialId}.json`), JSON.stringify(record, null, 2));
    return record;
  } finally {
    await arm?.close();
    await destroySandbox(sandbox);
  }
}
