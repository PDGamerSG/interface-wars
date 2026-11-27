// Honest readout. Two independent views of the same data must agree before anything is called a winner:
//  1. Flagsmith Experimentation's Bayesian result (lift, 95% credible interval, chance to beat control).
//  2. A cluster bootstrap that resamples whole job templates, because trials of the same template are correlated.
// The decision rules below are pre-registered in prereg/PREREGISTRATION.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS, readLab } from '../lab/config.ts';
import { refreshAndFetchResults, METRICS } from './control.ts';
import type { TrialRecord } from '../trial.ts';
import { Rng } from '../jobs/catalog.ts';

type ArmStats = {
  n: number; correct: number; collateral: number; costTotal: number; meanCost: number;
  correctRate: number; collateralRate: number; costPerCorrect: number | null; meanTurns: number; meanTokensIn: number;
};

export function loadTrials(run: string): TrialRecord[] {
  const dir = join(RUNS, run, 'trials');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function stats(trials: TrialRecord[]): ArmStats {
  const n = trials.length;
  const correct = trials.filter((t) => t.correct).length;
  const collateral = trials.filter((t) => t.collateral.length > 0).length;
  const costTotal = trials.reduce((s, t) => s + t.costUsd, 0);
  const tokensIn = trials.reduce((s, t: any) => s + (t.usage.input + t.usage.cacheRead + t.usage.cacheWrite), 0);
  return {
    n, correct, collateral, costTotal,
    meanCost: n ? costTotal / n : 0,
    correctRate: n ? correct / n : 0,
    collateralRate: n ? collateral / n : 0,
    costPerCorrect: correct ? costTotal / correct : null,
    meanTurns: n ? trials.reduce((s, t) => s + t.turns, 0) / n : 0,
    meanTokensIn: n ? tokensIn / n : 0,
  };
}

// Difference in a per-trial metric (arm minus control), resampling job templates with replacement.
export function clusterBootstrap(trials: TrialRecord[], arm: string, control: string, metric: (t: TrialRecord) => number, iterations = 4000) {
  const templates = [...new Set(trials.map((t) => t.template))].sort();
  const by = new Map(templates.map((tpl) => [tpl, trials.filter((t) => t.template === tpl)]));
  const rng = new Rng(`bootstrap-${arm}-${control}-${trials.length}`);
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let aSum = 0, aN = 0, cSum = 0, cN = 0;
    for (let k = 0; k < templates.length; k++) {
      const group = by.get(rng.pick(templates))!;
      for (const t of group) {
        if (t.arm === arm) { aSum += metric(t); aN++; }
        else if (t.arm === control) { cSum += metric(t); cN++; }
      }
    }
    if (aN && cN) diffs.push(aSum / aN - cSum / cN);
  }
  diffs.sort((x, y) => x - y);
  const q = (p: number) => diffs[Math.min(diffs.length - 1, Math.max(0, Math.floor(p * diffs.length)))];
  const point = (() => {
    const a = trials.filter((t) => t.arm === arm), c = trials.filter((t) => t.arm === control);
    return (a.reduce((s, t) => s + metric(t), 0) / (a.length || 1)) - (c.reduce((s, t) => s + metric(t), 0) / (c.length || 1));
  })();
  return { point, low: q(0.025), high: q(0.975), iterations: diffs.length };
}

export type Verdict = 'WIN' | 'LOSS' | 'INCONCLUSIVE';

export async function buildReadout(run: string, opts: { withFlagsmith?: boolean } = {}) {
  const trials = loadTrials(run).filter((t) => t.outcome !== 'api_error');
  const arms = ['mcp', 'cli', 'cli_skill'];
  const perArm = Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.arm === a))]));
  const families = [...new Set(trials.map((t) => t.family))];
  const perFamily = Object.fromEntries(families.map((f) => [f, Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.family === f && t.arm === a))]))]));
  const perTemplate = Object.fromEntries([...new Set(trials.map((t) => t.template))].sort().map((tpl) => [tpl, Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.template === tpl && t.arm === a))]))]));
  const heldOut = Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.heldOut && t.arm === a))]));

  const bootstrap: Record<string, any> = {};
  for (const a of ['cli', 'cli_skill']) {
    bootstrap[a] = {
      job_correct: clusterBootstrap(trials, a, 'mcp', (t) => Number(t.correct)),
      no_collateral: clusterBootstrap(trials, a, 'mcp', (t) => Number(t.collateral.length === 0)),
      cost_usd: clusterBootstrap(trials, a, 'mcp', (t) => t.costUsd),
    };
  }

  let flagsmith: any = null;
  if (opts.withFlagsmith !== false) {
    try {
      const { results, exposures } = await refreshAndFetchResults();
      const lab = readLab();
      const metricName = Object.fromEntries(Object.entries(lab.experiment!.metricIds).map(([name, id]) => [id, name]));
      flagsmith = {
        asOf: results?.as_of,
        srmPValue: results?.payload?.srm_p_value ?? null,
        exposures: exposures?.payload?.timeseries ?? null,
        excludedIdentities: exposures?.payload?.excluded_identities ?? null,
        metrics: Object.fromEntries((results?.payload?.metrics ?? []).map((m: any) => [metricName[m.metric_id] ?? m.metric_id, { variants: m.variants, inference: m.inference }])),
      };
    } catch (error) {
      flagsmith = { error: (error as Error).message };
    }
  }

  // Pre-registered decision rule, per arm versus control (mcp).
  const decisions: Record<string, any> = {};
  for (const a of ['cli', 'cli_skill']) {
    const inf = flagsmith?.metrics?.job_correct?.inference?.[a];
    const boot = bootstrap[a].job_correct;
    const flagsmithWin = inf && inf.chance_to_win >= 0.95 && inf.ci_low > 0;
    const flagsmithLoss = inf && inf.chance_to_win <= 0.05 && inf.ci_high < 0;
    const bootWin = boot.low > 0;
    const bootLoss = boot.high < 0;
    const collInf = flagsmith?.metrics?.no_collateral?.inference?.[a];
    const costInf = flagsmith?.metrics?.cost_usd?.inference?.[a];
    const guardrailBreach = {
      // Breach = the arm is credibly worse at keeping changes in scope.
      no_collateral: Boolean((collInf && collInf.ci_high < 0) || bootstrap[a].no_collateral.high < 0),
      cost_usd: Boolean((costInf && costInf.ci_low > 0) || bootstrap[a].cost_usd.low > 0),
    };
    let verdict: Verdict = 'INCONCLUSIVE';
    if (flagsmithWin && bootWin && !guardrailBreach.no_collateral && !guardrailBreach.cost_usd) verdict = 'WIN';
    else if (flagsmithLoss && bootLoss) verdict = 'LOSS';
    decisions[a] = { verdict, flagsmithWin: Boolean(flagsmithWin), bootstrapWin: bootWin, guardrailBreach, flagsmith: inf ?? null, bootstrap: boot };
  }
  const winners = Object.entries(decisions).filter(([, d]) => d.verdict === 'WIN').map(([a]) => a);
  const recommendation = winners.length === 0
    ? { ship: null, reason: 'No arm met the pre-registered bar against the MCP control. Keep the control.' }
    : { ship: winners.sort((x, y) => perArm[y].correctRate - perArm[x].correctRate)[0], reason: 'Met the pre-registered bar on job_correct with both analyses agreeing and no guardrail breach.' };

  const readout = {
    run, generatedAt: new Date().toISOString(), trials: trials.length,
    model: trials[0]?.model ?? null, effort: trials[0]?.effort ?? null,
    perArm, perFamily, perTemplate, heldOut, bootstrap, flagsmith, decisions, recommendation,
    metrics: METRICS,
  };
  writeFileSync(join(RUNS, run, 'readout.json'), JSON.stringify(readout, null, 2));
  writeFileSync(join(RUNS, run, 'readout.md'), renderMarkdown(readout));
  return readout;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const usd = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(4)}`);

export function renderMarkdown(r: any) {
  const lines: string[] = [];
  lines.push(`# Interface Wars readout: ${r.run}`, '', `${r.trials} trials, model \`${r.model}\` at effort \`${r.effort}\`. Generated ${r.generatedAt}.`, '');
  lines.push('| Arm | Trials | Jobs correct | Out-of-scope changes | Mean cost | Cost per correct job | Mean input tokens |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const [a, s] of Object.entries<any>(r.perArm)) lines.push(`| ${a} | ${s.n} | ${s.correct} (${pct(s.correctRate)}) | ${s.collateral} (${pct(s.collateralRate)}) | ${usd(s.meanCost)} | ${usd(s.costPerCorrect)} | ${Math.round(s.meanTokensIn).toLocaleString()} |`);
  lines.push('', '## Decision (pre-registered rule)', '');
  for (const [a, d] of Object.entries<any>(r.decisions)) {
    const f = d.flagsmith;
    lines.push(`- **${a} vs mcp: ${d.verdict}.** Flagsmith: ${f ? `lift ${pct(f.lift)}, 95% interval ${pct(f.ci_low)} to ${pct(f.ci_high)}, chance to beat control ${pct(f.chance_to_win)}` : 'no result yet'}. ` +
      `Template bootstrap: ${pct(d.bootstrap.point)} points (${pct(d.bootstrap.low)} to ${pct(d.bootstrap.high)}). ` +
      `Guardrails: change scope ${d.guardrailBreach.no_collateral ? 'BREACHED' : 'held'}, cost ${d.guardrailBreach.cost_usd ? 'BREACHED' : 'held'}.`);
  }
  lines.push('', `**Recommendation:** ${r.recommendation.ship ? `ship \`${r.recommendation.ship}\`` : 'keep the control'}. ${r.recommendation.reason}`, '');
  lines.push('## By job family', '', '| Family | mcp | cli | cli_skill |', '|---|---:|---:|---:|');
  for (const [f, arms] of Object.entries<any>(r.perFamily)) lines.push(`| ${f} | ${['mcp', 'cli', 'cli_skill'].map((a) => `${arms[a].correct}/${arms[a].n}`).join(' | ')} |`);
  lines.push('', '## Held-out templates (not used while writing the skill)', '', '| Arm | Correct |', '|---|---:|');
  for (const [a, s] of Object.entries<any>(r.heldOut)) lines.push(`| ${a} | ${s.correct}/${s.n} |`);
  if (r.flagsmith?.srmPValue !== undefined) lines.push('', `Sample ratio mismatch p-value (Flagsmith): ${r.flagsmith?.srmPValue ?? 'n/a'}.`);
  return lines.join('\n') + '\n';
}

if (import.meta.main) {
  const run = process.argv[2] ?? 'main';
  const r = await buildReadout(run, { withFlagsmith: !process.argv.includes('--offline') });
  console.log(renderMarkdown(r));
}
