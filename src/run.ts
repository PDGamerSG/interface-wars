// Runs a batch of trials in parallel.
//   node src/run.ts --run pilot --count 30 --pilot            # arms rotate, no experiment events
//   node src/run.ts --run main --from 0 --count 240           # Flagsmith assigns arms and receives events
//   node src/run.ts --run after-ship --count 6 --follow-flag  # agents take the interface the flag serves now;
//                                                             # no events (the experiment is complete)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTrial, type TrialRecord } from './trial.ts';
import { ARMS, type ArmName } from './arms/types.ts';
import { createAssigner, experimentState } from './experiment/control.ts';
import { loadEnvFile, RUNS } from './lab/config.ts';
import { BudgetExceeded, capUsd, checkBudget, setRemoteCap, spentUsd } from './agent/budget.ts';
import { lockProject } from './agent/project.ts';
import { readOpsFlags, trialGate, SPEND_CAP } from './experiment/ops.ts';

loadEnvFile();
const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const run = opt('run', 'main')!;
const from = Number(opt('from', '0'));
const count = Number(opt('count', '16'));
const concurrency = Number(opt('concurrency', '6'));
const pilot = flag('pilot');
const forcedArm = opt('arm') as ArmName | undefined;
const templateFilter = opt('template');
const followFlag = flag('follow-flag');
const grader = opt('grader', process.env.IW_GRADER ?? 'registered-v1')!;
if (!['registered-v1', 'strict-draft-v1'].includes(grader)) throw new Error(`Unknown grader ${grader}`);
process.env.IW_GRADER = grader;

if (process.env.IW_DRY_RUN !== '1' && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('Set ANTHROPIC_API_KEY in .env first.');
  process.exit(2);
}

// The matched study and legacy batches use the same project ledger and paid-coordinator lock.
if (process.env.IW_DRY_RUN !== '1') {
  const release = lockProject();
  process.once('exit', release);
}

// The ops flags in Flagsmith: the kill switch and the remote spend cap (src/experiment/ops.ts). During an outage the
// last cap read from Flagsmith stays in force, so a lowered cap cannot be lost by losing the connection.
const gateMode = { dryRun: process.env.IW_DRY_RUN === '1', allowOffline: process.env.IW_OPS_OFFLINE === '1' };
async function refreshOps() {
  const ops = await readOpsFlags();
  if (ops.source === 'flagsmith') setRemoteCap(ops.spendCapUsd);
  return ops;
}
const ops = await refreshOps();
const gate = trialGate(ops, gateMode);
if (!gate.start) {
  console.error(`No trials started: ${gate.reason}.`);
  process.exit(2);
}
if (ops.source === 'unavailable') console.log(`Ops flags unavailable in Flagsmith; ${gateMode.dryRun ? 'dry run, no model calls' : 'IW_OPS_OFFLINE=1, machine cap only'}.`);

if (process.env.IW_DRY_RUN !== '1') {
  try {
    checkBudget();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  console.log(`Spend so far: $${spentUsd().toFixed(4)} of cap $${capUsd()}${ops.spendCapUsd !== null ? ` (${SPEND_CAP} in Flagsmith: $${ops.spendCapUsd})` : ''}.`);
}

const assigner = pilot || forcedArm ? null : createAssigner();
// Experiment events are sent only while the experiment runs; a follow-flag batch reads the flag and nothing else.
const sendEvents = Boolean(assigner) && !followFlag;
if (sendEvents) {
  const state = await experimentState();
  if (state?.status !== 'running') {
    console.error(`Experiment is not running (status: ${state?.status ?? 'missing'}). Run: node src/cli.ts experiment:start`);
    process.exit(2);
  }
}

const queue: number[] = [];
for (let i = from; i < from + count; i++) queue.push(i);
const results: TrialRecord[] = [];
let active = 0;

async function worker() {
  while (queue.length) {
    const index = queue.shift()!;
    const trialId = `${run}-${String(index).padStart(4, '0')}`;
    if (existsSync(join(RUNS, run, 'trials', `${trialId}.json`))) {
      results.push(JSON.parse(readFileSync(join(RUNS, run, 'trials', `${trialId}.json`), 'utf8')));
      continue;
    }
    const { jobFor } = await import('./jobs/catalog.ts');
    if (templateFilter && jobFor(index, trialId).template !== templateFilter) continue;
    // Read the ops flags before every trial, so a change in the dashboard takes effect within one trial.
    const now = trialGate(await refreshOps(), gateMode);
    if (!now.start) {
      console.log(`${trialId} PAUSED: ${now.reason}. No new trials will start; rerun the same --run to resume.`);
      queue.length = 0;
      break;
    }
    active++;
    try {
      const arm: ArmName = forcedArm ?? (assigner ? await assigner.assign(trialId) : ARMS[index % ARMS.length]);
      const r = await runTrial({ run, index, trialId, arm });
      if (assigner && sendEvents) {
        if (r.correct) assigner.track('job_correct', trialId);
        if (r.collateral.length === 0) assigner.track('no_collateral', trialId);
        assigner.track('cost_usd', trialId, r.costUsd);
      }
      results.push(r);
      console.log(
        `${trialId} ${r.arm.padEnd(9)} ${r.template.padEnd(31)} ${r.correct ? 'CORRECT' : 'wrong  '} ` +
        `collateral=${r.collateral.length} cost=$${r.costUsd.toFixed(4)} turns=${r.turns} ${Math.round(r.ms / 1000)}s` +
        (r.correct ? '' : `  ${[...r.reasons, ...r.collateral.map((c) => 'collateral ' + c.path)].join('; ').slice(0, 160)}`),
      );
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        // Not an agent failure: the trial is not recorded, so a later run with a higher cap retries it.
        console.log(`${trialId} STOPPED ${error.message} No new trials will start.`);
        queue.length = 0;
      } else {
        console.log(`${trialId} ERROR ${(error as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
    } finally {
      active--;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
await assigner?.close();

const byArm: Record<string, { n: number; correct: number; collateral: number; cost: number }> = {};
for (const r of results) {
  const a = (byArm[r.arm] ??= { n: 0, correct: 0, collateral: 0, cost: 0 });
  a.n++; a.correct += Number(r.correct); a.collateral += Number(r.collateral.length > 0); a.cost += r.costUsd;
}
console.log('\nSummary (this batch, raw counts):');
for (const [arm, a] of Object.entries(byArm)) {
  console.log(`  ${arm.padEnd(9)} n=${a.n} correct=${a.correct} (${((100 * a.correct) / a.n).toFixed(0)}%) collateral=${a.collateral} mean cost=$${(a.cost / a.n).toFixed(4)}`);
}
if (process.env.IW_DRY_RUN !== '1') console.log(`\nTotal real spend (all runs): $${spentUsd().toFixed(4)} of cap $${capUsd()}.`);
void active;
