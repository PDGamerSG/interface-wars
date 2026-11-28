#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createPlan, runStage, signPlan, type ReleasePlan } from './gate.ts';
import { flagsmithAdapter, requiredEnv } from './flagsmith.ts';
import { demo } from './demo.ts';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const [command, ...args] = process.argv.slice(2);

async function main() {
  if (command === 'demo' && !args.length) return demo();
  if (command === 'plan' && args.length === 2) return createPlan(await flagsmithAdapter(Number(args[0])).read(), read(args[1]));
  if (command === 'sign' && args.length === 2) return signPlan(read(args[0]), args[1], readFileSync(requiredEnv('IW_RELEASE_SIGNING_KEY'), 'utf8'));
  if ((command === 'apply' || command === 'rollback') && args.length >= 4) {
    const plan: ReleasePlan = read(args[0]);
    const adapter = flagsmithAdapter(plan.baseline.target.experimentId, plan.baseline);
    const result = await runStage(plan, command, Number(args[1]), args.slice(2).map(read), read(requiredEnv('IW_RELEASE_SIGNERS')), adapter);
    if (result.status === 'GUARDRAIL_ROLLED_BACK') process.exitCode = 2;
    return result;
  }
  throw Error('Usage: release.ts demo | plan EXPERIMENT_ID STAGES.json | sign PLAN.json NAME | apply|rollback PLAN.json PERCENT APPROVAL.json APPROVAL.json');
}

try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) { console.error(error instanceof Error ? error.message : 'Release gate failed.'); process.exitCode = 1; }
