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
import { localCredentials, redactCredentials } from './evidence/redact.ts';
import { strictGrade, STRICT_GRADER } from './jobs/strict.ts';
import { auditMark, auditWrites, namesFrom, settledAuditRows, type WriteAudit } from './lab/audit.ts';

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
  grader?: string;
  // Writes Flagsmith logged while the agent ran (absent on trials recorded before the audit existed).
  // Out-of-scope writes fail the trial even when the agent reverted them before the final snapshot.
  writeAudit?: WriteAudit;
  // cli_skill trials recorded after skill revisions existed: which SKILL.md the agent could read.
  skill?: { name: string; sha256: string };
};

// IW_WRITE_AUDIT=0 reproduces the registered protocol exactly, which graded the final snapshot only.
const WRITE_AUDIT_ON = process.env.IW_WRITE_AUDIT !== '0';

export async function runTrial(opts: { run: string; index: number; trialId: string; arm: ArmName }): Promise<TrialRecord> {
  const job = jobFor(opts.index, opts.trialId);
  const startedAt = new Date().toISOString();
  const sandbox = await createSandbox(opts.trialId, job.seed);
  let arm: Arm | undefined;
  try {
    const before = await snapshot(sandbox);
    const mark = WRITE_AUDIT_ON ? auditMark() : '';
    arm = opts.arm === 'mcp' ? await openMcpArm(sandbox) : await openCliArm(sandbox, opts.arm === 'cli_skill');
    const result: AgentResult = DRY_RUN ? await dryRunAgent(opts.arm, job, sandbox) : await runAgent(arm, sandbox, job.task);
    const after = await snapshot(sandbox);
    const changes = diff(before, after);
    const grader = process.env.IW_GRADER ?? 'registered-v1';
    if (grader !== 'registered-v1' && grader !== STRICT_GRADER) throw new Error(`Unknown grader ${grader}`);
    const g = grader === STRICT_GRADER ? strictGrade(job, before, after, changes) : grade(job, before, after, changes);
    const writeAudit = WRITE_AUDIT_ON
      ? auditWrites(sandbox, await settledAuditRows(sandbox, mark), namesFrom(before, after), job.allowed)
      : undefined;
    const writesInScope = !writeAudit || writeAudit.outOfScope.length === 0;
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
      correct: g.correct && writesInScope && result.outcome !== 'api_error',
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
      grader,
      ...(writeAudit ? { writeAudit } : {}),
      ...(arm.skill ? { skill: arm.skill } : {}),
    };
    const dir = join(RUNS, opts.run, 'trials');
    mkdirSync(dir, { recursive: true });
    const safeRecord = redactCredentials(record, [
      ...localCredentials(), sandbox.apiKey, sandbox.env.Development.key, sandbox.env.Production.key,
    ]);
    writeFileSync(join(dir, `${opts.trialId}.json`), JSON.stringify(safeRecord, null, 2));
    return safeRecord;
  } finally {
    await arm?.close();
    await destroySandbox(sandbox);
  }
}
