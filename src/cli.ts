#!/usr/bin/env node
// interface-wars: one entry point for the lab, the experiment and the human ship gate.
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrap } from './lab/bootstrap.ts';
import { loadEnvFile, readLab, RUNS, FLAGSMITH_URL } from './lab/config.ts';
import { setupExperiment, startExperiment, experimentState, completeExperiment, FLAG } from './experiment/control.ts';
import { buildReadout, renderMarkdown } from './experiment/readout.ts';
import type { ArmName } from './arms/types.ts';

loadEnvFile();
const [command, ...rest] = process.argv.slice(2);

async function ship(run: string) {
  const readoutFile = join(RUNS, run, 'readout.json');
  if (!existsSync(readoutFile)) throw new Error(`No readout for ${run}. Run: node src/cli.ts readout ${run}`);
  const r = JSON.parse(readFileSync(readoutFile, 'utf8'));
  console.log(renderMarkdown(r));
  const state = await experimentState();
  if (state?.status !== 'running') throw new Error(`Experiment status is ${state?.status}; only a running experiment can be shipped.`);
  const suggested: ArmName = r.recommendation.ship ?? 'mcp';
  const approveIdx = rest.indexOf('--approve');
  let choice = approveIdx >= 0 ? (rest[approveIdx + 1] as ArmName) : undefined;
  const byIdx = rest.indexOf('--by');
  let approver = byIdx >= 0 ? rest[byIdx + 1] : undefined;
  if (!choice) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\nThe readout recommends shipping: ${suggested}${r.recommendation.ship ? '' : ' (the control, because no arm met the bar)'}.`);
    const typed = (await rl.question(`Type the arm to roll out to every agent (mcp | cli | cli_skill), or anything else to abort: `)).trim();
    if (!['mcp', 'cli', 'cli_skill'].includes(typed)) { rl.close(); console.log('Aborted. Nothing changed in Flagsmith.'); return; }
    choice = typed as ArmName;
    approver = (await rl.question('Your name for the approval record: ')).trim() || 'unknown';
    rl.close();
  }
  if (choice !== suggested) console.log(`Note: you chose ${choice}, the readout suggested ${suggested}. Recording both.`);
  const completed = await completeExperiment(choice);
  const record = { run, approvedArm: choice, suggested, approver: approver ?? 'unknown', at: new Date().toISOString(), experiment: { id: completed.id, status: completed.status, rollout_decision: completed.rollout_decision } };
  writeFileSync(join(RUNS, run, 'approval.json'), JSON.stringify(record, null, 2));
  console.log(`Shipped. Flagsmith experiment ${completed.id} is ${completed.status} with rollout_decision=${completed.rollout_decision}.`);
  console.log(`Every agent that reads the "${FLAG}" flag now gets "${choice}". Check: node src/cli.ts which`);
}

async function which() {
  // What a newly started agent session would use: the flag's current value, read like any app reads a flag.
  const lab = readLab();
  const res = await fetch(`${FLAGSMITH_URL}/api/v1/flags/`, { headers: { 'X-Environment-Key': lab.control.serverKey } });
  const flags = await res.json();
  const f = flags.find((x: any) => x.feature.name === FLAG);
  const state = await experimentState();
  console.log(JSON.stringify({ flag: FLAG, value: f?.feature_state_value, enabled: f?.enabled, experiment: state?.status, rollout_decision: state?.rollout_decision ?? null }, null, 2));
}

switch (command) {
  case 'lab:bootstrap':
    console.log(JSON.stringify((await bootstrap()).control, null, 2));
    break;
  case 'experiment:setup':
    console.log(JSON.stringify(await setupExperiment(), null, 2));
    break;
  case 'experiment:start': {
    const x = await startExperiment();
    console.log(`Experiment ${x.id} is ${x.status}.`);
    break;
  }
  case 'experiment:status':
    console.log(JSON.stringify(await experimentState(), null, 2));
    break;
  case 'readout': {
    const r = await buildReadout(rest[0] ?? 'main', { withFlagsmith: !rest.includes('--offline') });
    console.log(renderMarkdown(r));
    break;
  }
  case 'ship':
    await ship(rest[0] ?? 'main');
    break;
  case 'which':
    await which();
    break;
  default:
    console.log(`Usage:
  node src/cli.ts lab:bootstrap            create the lab admin and control organisation
  node src/cli.ts experiment:setup         create the agent_interface flag, metrics and experiment
  node src/cli.ts experiment:start         start the experiment (Flagsmith begins assigning arms)
  node src/run.ts --run main --count 240   run trials (see src/run.ts for options)
  node src/cli.ts readout main             Flagsmith results + template bootstrap + pre-registered verdict
  node src/cli.ts ship main                human approval, then complete the experiment and roll out the winner
  node src/cli.ts which                    what interface a new agent session gets from the flag`);
}
