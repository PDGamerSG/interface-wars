// npm run matched -- <setup|pilot|start|registered|reconcile|readout|compare|settle> [--dry-run]
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { lockProject, projectRuns, writeJson } from '../agent/project.ts';
import { readSpend } from '../agent/budget.ts';
import { readOpsFlags } from '../experiment/ops.ts';
import { RUNS, type Lab } from '../lab/config.ts';
import { MAX_REQUEST_USD, settleReservation } from './billing.ts';
import { assigner, deliver, experimentPath, management, nativeResults, readControl, setup, warehouse, warehouseMatches } from './control.ts';
import { summarize } from './readout.ts';
import { design, manifest, matchedCase, phaseSize, readJournal, runPhase, type Phase } from './study.ts';
import { executeTrial } from './trial.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'dry-run': { type: 'boolean' }, phase: { type: 'string', default: 'registered' }, case: { type: 'string' },
  limit: { type: 'string' }, nonce: { type: 'string' }, usd: { type: 'string' },
} });
const [command] = positionals;
if (positionals.length !== 1 || !['setup', 'pilot', 'start', 'registered', 'reconcile', 'readout', 'compare', 'settle'].includes(command)) throw new Error('Usage: npm run matched -- setup|pilot|start|registered|reconcile|readout|compare|settle [--dry-run]');
const synthetic = values['dry-run'] === true;
if (!synthetic && process.env.IW_DRY_RUN === '1') throw new Error('Use --dry-run explicitly for a synthetic matched study');
const shared = synthetic ? RUNS : projectRuns();
const dir = join(shared, manifest.id + (synthetic ? '-dry' : ''));
const ledgerPath = join(shared, 'spend.local.json');
const phase = values.phase as Phase;
if (!['pilot', 'registered'].includes(phase)) throw new Error('Unknown phase');
if (values.limit !== undefined && (!synthetic || !['pilot', 'registered'].includes(command) || !/^\d+$/.test(values.limit))) throw new Error('--limit requires a nonnegative synthetic phase size');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const journal = (p: Phase) => readJournal(dir, p, synthetic);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main() {
  if (command === 'compare') {
    if (values.case === undefined || !/^\d+$/.test(values.case)) throw new Error('Pass a zero-based --case number');
    const rank = Number(values.case), c = matchedCase(phase, rank);
    const rows = journal(phase).rows.filter(r => r.rank === rank);
    print({ phase, rank, template: c.job.template, caseHash: c.caseHash, caseSeed: c.caseSeed, task: c.job.task, seed: c.job.seed,
      status: rows.length === 2 ? 'paired' : rows.length ? 'unmatched' : 'planned', assignments: rows });
    return;
  }
  if (command === 'readout') {
    const j = journal(phase);
    const nativeFile = join(dir, 'registered', 'native.json');
    const native = phase === 'registered' && existsSync(nativeFile) ? read(nativeFile) : undefined;
    const spend = !synthetic && existsSync(ledgerPath) ? readSpend(ledgerPath).matched?.totals : {};
    const r = summarize(j, native?.checks, spend);
    print(r);
    if (existsSync(join(dir, phase, 'assignments.json'))) writeJson(join(dir, phase, 'readout.json'), r);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const release = lockProject(synthetic ? dir : shared);
  try {
    if (command === 'settle') {
      if (synthetic || !values.nonce || values.usd === undefined || !/^\d+(\.\d+)?$/.test(values.usd)) throw new Error('Use --nonce <pending nonce> --usd <verified billed amount>');
      settleReservation(ledgerPath, values.nonce, Number(values.usd));
      return;
    }
    const lab: Lab = read(join(shared, 'lab.local.json'));
    const admin = management(lab);
    if (command === 'setup') {
      const c = await setup(dir, lab, admin, synthetic);
      print({ project: c.projectId, environment: c.environmentId, experiment: c.experimentId, feature: c.featureId, metricIds: c.metricIds, maxRequestUsd: MAX_REQUEST_USD });
      return;
    }
    const c = readControl(dir, lab), base = experimentPath(c);
    const state = await admin.get(base + '/');
    if (command === 'start') {
      if (state.status === 'running') { console.log('Study already running'); return; }
      if (state.status !== 'created') throw new Error('Expected a created matched experiment');
      const j = journal('pilot');
      if (j.rows.length !== phaseSize('pilot') || j.rows.some(r => !r.result || r.exposure !== 'none' || r.metrics !== 'none')) throw new Error('Complete all 12 forced pilot pairs before enrollment');
      const stored = warehouse(c);
      if (stored.length) throw new Error('Expected an empty matched warehouse before registration');
      writeJson(join(dir, 'pilot', 'zero-exposures.json'), { environmentId: c.environmentId, experimentId: c.experimentId, storedEvents: stored.length, at: new Date().toISOString() });
      const started = await admin.post(base + '/start/', {});
      print({ experiment: started.id, status: started.status });
      return;
    }
    if (command === 'reconcile') {
      if (state.status !== 'running' && state.status !== 'completed') throw new Error('Start the registered experiment first');
      const j = journal('registered');
      const raw = warehouseMatches(c, j.rows);
      const native = await nativeResults(c, admin, j.rows);
      const book = !synthetic && existsSync(ledgerPath) ? readSpend(ledgerPath) : undefined;
      const billingMatches = Boolean(book?.matched && !book.matched.pending && j.rows.every(r => r.result && book.matched!.totals[r.id] === r.result.costUsd));
      const checks = { warehouseMatches: raw.matches, aggregatesMatch: native.aggregatesMatch, excluded: native.excluded, billingMatches };
      const saved = { checks, raw, native, fingerprint: j.fingerprint, environmentId: c.environmentId, experimentId: c.experimentId };
      mkdirSync(join(dir, 'registered'), { recursive: true });
      writeJson(join(dir, 'registered', 'native.json'), saved);
      print(checks);
      if (!raw.matches || !native.aggregatesMatch || native.excluded !== 0 || (!synthetic && !billingMatches)) process.exitCode = 1;
      return;
    }
    const p: Phase = command === 'pilot' ? 'pilot' : 'registered';
    if (state.status !== (p === 'pilot' ? 'created' : 'running')) throw new Error('Unexpected study status for ' + p + ': ' + state.status);
    if (!synthetic && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('Set the model credential before running a paid phase');
    if (!synthetic && !existsSync(ledgerPath)) throw new Error('Expected the existing shared project ledger');
    let cap = design.projectCapUsd;
    await runPhase(dir, p, synthetic, {
      assign: assigner(c), deliver: (r, kind, interrupted) => deliver(c, r, kind, interrupted),
      beforeTrial: async () => {
        if (synthetic) return;
        const ops = await readOpsFlags(lab);
        if (ops.source !== 'flagsmith' || !ops.trialsEnabled) throw new Error('Project trials paused or ops flags unavailable');
        const machine = Number(process.env.IW_MAX_SPEND_USD ?? design.projectCapUsd);
        if (!Number.isFinite(machine) || machine < 0) throw new Error('Invalid project cap');
        cap = Math.min(design.projectCapUsd, machine, ops.spendCapUsd ?? Infinity);
      },
      execute: (r, job) => executeTrial(dir, p, synthetic, lab, c, ledgerPath, cap, r, job),
    }, values.limit === undefined ? undefined : Number(values.limit));
  } finally { release(); }
}
await main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
