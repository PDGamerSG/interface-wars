import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../agent/loop.ts';
import { writeJson } from '../agent/project.ts';
import { openMcpArm } from '../arms/mcp.ts';
import { redact } from '../evidence/index.ts';
import { grade, type Job } from '../jobs/catalog.ts';
import { solve } from '../jobs/reference.ts';
import { createSandbox, destroySandbox, diff, snapshot } from '../lab/sandbox.ts';
import type { Lab } from '../lab/config.ts';
import type { Control } from './control.ts';
import { trialBilling } from './billing.ts';
import { guide, hash, manifest, toolHash, type Phase, type Assignment, type Outcome } from './study.ts';

export async function executeTrial(dir: string, phase: Phase, synthetic: boolean, lab: Lab, control: Control,
  ledger: string, cap: number, row: Assignment, job: Job): Promise<Outcome> {
  const evidence = join(dir, phase, 'trials');
  mkdirSync(evidence, { recursive: true });
  const path = join(evidence, row.id + '.json');
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (saved.id !== row.id || saved.caseHash !== row.caseHash || saved.arm !== row.arm || saved.synthetic !== synthetic) throw new Error('Checkpoint evidence mismatch');
    return saved.result;
  }
  const attempt = row.attempts.length;
  const sandbox = await createSandbox(row.id + '-a' + attempt, job.seed, lab);
  const secrets = [sandbox.apiKey, sandbox.env.Development.key, sandbox.env.Production.key, control.serverKey, control.environmentKey,
    lab.admin.token, lab.admin.password, lab.control.masterKey, lab.control.serverKey, lab.control.environmentKey];
  try {
    const before = await snapshot(sandbox);
    const arm = await openMcpArm(sandbox);
    try {
      if (arm.tools.length !== 54 || hash(JSON.stringify(arm.tools)) !== toolHash) throw new Error('Official 54-tool schema fingerprint mismatch');
      let costUsd = 0, toolCalls = 0, toolErrors = 0, turns = 0, outcome = 'synthetic-reference';
      let transcript: unknown = [], usage: unknown = null, finalText = '';
      if (synthetic) {
        await solve(job, sandbox);
      } else {
        const billing = trialBilling(ledger, row.id, cap);
        const agent = await runAgent(arm, sandbox, job.task, new Anthropic({ maxRetries: 0 }), {
          model: manifest.model, guide: row.arm === 'mcp_guided' ? guide : undefined, billing,
        });
        costUsd = billing.total(); toolCalls = agent.toolCalls; toolErrors = agent.toolErrors;
        turns = agent.turns.length; outcome = agent.outcome; transcript = agent.turns; usage = agent.usage; finalText = agent.finalText;
        if (outcome === 'api_error') {
          writeJson(join(evidence, row.id + '-attempt-' + attempt + '.json'), redact({ id: row.id, attempt, outcome, finalText, transcript, usage, costUsd }, '', secrets));
          throw new Error('Model API interruption; inspect the saved attempt and project reservation');
        }
      }
      const after = await snapshot(sandbox), changes = diff(before, after);
      const scored = grade(job, before, after, changes);
      const result = { outcome, correct: scored.correct, scoped: scored.collateral.length === 0, costUsd, turns, toolCalls, toolErrors };
      writeJson(path, redact({ study: manifest.id, id: row.id, arm: row.arm, phase, synthetic, rank: row.rank,
        caseHash: row.caseHash, caseSeed: row.caseSeed, template: job.template, task: job.task, attempt, model: synthetic ? 'dry-run' : manifest.model,
        toolHash, guideHash: row.arm === 'mcp_guided' ? hash(guide) : null, result, changes, reasons: scored.reasons, collateral: scored.collateral,
        usage, finalText, transcript, commands: arm.commands }, '', secrets));
      return result;
    } finally { await arm.close(); }
  } catch (error) {
    throw new Error(String(redact((error as Error).message, '', secrets)));
  } finally { await destroySandbox(sandbox); }
}
