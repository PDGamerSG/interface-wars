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
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
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

// Final collateral (the snapshot diff) and observed out-of-scope writes (the audit log) are separate claims.
// Trials recorded before the write audit existed have no audit data, so this section is omitted for them.
export function writeAuditSummary(trials: TrialRecord[], arms: string[]) {
  if (!trials.some((t) => t.writeAudit)) return undefined;
  return Object.fromEntries(arms.map((a) => {
    const mine = trials.filter((t) => t.arm === a);
    const audited = mine.filter((t) => t.writeAudit);
    return [a, {
      trials: mine.length,
      audited: audited.length,
      noFinalCollateral: mine.filter((t) => t.collateral.length === 0).length,
      noOutOfScopeWrites: audited.filter((t) => t.writeAudit!.outOfScope.length === 0).length,
      revertedOutOfScope: audited.filter((t) => t.writeAudit!.outOfScope.length > 0 && t.collateral.length === 0).length,
      lostAuditRows: audited.filter((t) => t.writeAudit!.lostRows > 0).length,
    }];
  }));
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

type Inference = { lift: number; ci_low: number; ci_high: number; chance_to_win: number };
type Interval = { point: number; low: number; high: number };

// The pre-registered decision rule for one treatment arm against the control, as a pure function of the two
// analyses. WIN needs Flagsmith (chance to beat control >= 95% and interval above 0) and the template bootstrap
// (interval above 0) to agree, with neither guardrail breached. LOSS needs both to agree the other way.
export function decideArm(
  flagsmith: { jobCorrect?: Inference; noCollateral?: Inference; cost?: Inference },
  bootstrap: { job_correct: Interval; no_collateral: Interval; cost_usd: Interval },
) {
  const inf = flagsmith.jobCorrect;
  const boot = bootstrap.job_correct;
  const flagsmithWin = Boolean(inf && inf.chance_to_win >= 0.95 && inf.ci_low > 0);
  const flagsmithLoss = Boolean(inf && inf.chance_to_win <= 0.05 && inf.ci_high < 0);
  const bootWin = boot.low > 0;
  const bootLoss = boot.high < 0;
  const guardrailBreach = {
    // Breach = the arm is credibly worse at keeping changes in scope.
    no_collateral: Boolean((flagsmith.noCollateral && flagsmith.noCollateral.ci_high < 0) || bootstrap.no_collateral.high < 0),
    // Breach = the arm credibly costs more.
    cost_usd: Boolean((flagsmith.cost && flagsmith.cost.ci_low > 0) || bootstrap.cost_usd.low > 0),
  };
  let verdict: Verdict = 'INCONCLUSIVE';
  if (flagsmithWin && bootWin && !guardrailBreach.no_collateral && !guardrailBreach.cost_usd) verdict = 'WIN';
  else if (flagsmithLoss && bootLoss) verdict = 'LOSS';
  return { verdict, flagsmithWin, bootstrapWin: bootWin, guardrailBreach, flagsmith: inf ?? null, bootstrap: boot };
}

// Upper regularized incomplete gamma Q(a, x), for chi-square p-values (Numerical Recipes, gammq).
function lnGamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500 && Math.abs(del) > Math.abs(sum) * 1e-14; n++) { ap++; del *= x / ap; sum += del; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

// Sample-ratio check against the experiment's configured split (cli 33.33%, cli_skill 33.33%, control the rest).
// Flagsmith 2.295.2 skips its own check for experiments: it reads the split from the environment default feature
// state, which an experiment zeroes in favour of its rollout segment override (see the TODO in
// experimentation/services.py, _expected_variant_shares). Reported alongside the decision, not part of the rule.
export const EXPECTED_SHARES: Record<string, number> = { mcp: 0.3334, cli: 0.3333, cli_skill: 0.3333 };
export function sampleRatioCheck(counts: Record<string, number>, shares = EXPECTED_SHARES) {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  let chiSquare = 0;
  for (const [arm, share] of Object.entries(shares)) {
    const expected = total * share;
    chiSquare += ((counts[arm] ?? 0) - expected) ** 2 / expected;
  }
  const df = Object.keys(shares).length - 1;
  return { total, observed: counts, expectedShares: shares, chiSquare, df, pValue: total ? gammaQ(df / 2, chiSquare / 2) : null };
}

export async function buildReadout(run: string, opts: { withFlagsmith?: boolean } = {}) {
  const trials = loadTrials(run).filter((t) => t.outcome !== 'api_error');
  const arms = ['mcp', 'cli', 'cli_skill'];
  const perArm = Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.arm === a))]));
  const families = [...new Set(trials.map((t) => t.family))];
  const perFamily = Object.fromEntries(families.map((f) => [f, Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.family === f && t.arm === a))]))]));
  const perTemplate = Object.fromEntries([...new Set(trials.map((t) => t.template))].sort().map((tpl) => [tpl, Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.template === tpl && t.arm === a))]))]));
  const heldOut = Object.fromEntries(arms.map((a) => [a, stats(trials.filter((t) => t.heldOut && t.arm === a))]));
  const writeAudit = writeAuditSummary(trials, arms);
  const srm = sampleRatioCheck(Object.fromEntries(arms.map((a) => [a, perArm[a].n])));

  const bootstrap: Record<string, any> = {};
  for (const a of ['cli', 'cli_skill']) {
    bootstrap[a] = {
      job_correct: clusterBootstrap(trials, a, 'mcp', (t) => Number(t.correct)),
      no_collateral: clusterBootstrap(trials, a, 'mcp', (t) => Number(t.collateral.length === 0)),
      cost_usd: clusterBootstrap(trials, a, 'mcp', (t) => t.costUsd),
    };
  }

  let flagsmith: any = null;
  const offline = opts.withFlagsmith === false;
  const runDir = join(RUNS, run);
  const archive = join(runDir, 'readout.json');
  if (offline && existsSync(archive)) {
    // Flagsmith owns the fitted model. Replay its saved native inputs to the decision rule.
    const saved = JSON.parse(readFileSync(archive, 'utf8'));
    if (saved.run !== run) throw new Error(`Archived readout belongs to ${saved.run}, expected ${run}.`);
    flagsmith = saved.flagsmith ?? null;
  } else if (!offline) {
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
  const decisions: Record<string, ReturnType<typeof decideArm>> = {};
  for (const a of ['cli', 'cli_skill']) {
    decisions[a] = decideArm({
      jobCorrect: flagsmith?.metrics?.job_correct?.inference?.[a],
      noCollateral: flagsmith?.metrics?.no_collateral?.inference?.[a],
      cost: flagsmith?.metrics?.cost_usd?.inference?.[a],
    }, bootstrap[a]);
  }
  const winners = Object.entries(decisions).filter(([, d]) => d.verdict === 'WIN').map(([a]) => a);
  const recommendation = winners.length === 0
    ? { ship: null, reason: 'No arm met the pre-registered bar against the MCP control. Keep the control.' }
    // Tie-break between two winning arms: higher job_correct rate, then lower mean cost (pre-registered).
    : { ship: winners.sort((x, y) => perArm[y].correctRate - perArm[x].correctRate || perArm[x].meanCost - perArm[y].meanCost)[0], reason: 'Met the pre-registered bar on job_correct with both analyses agreeing and no guardrail breach.' };

  const readout = {
    run, generatedAt: new Date().toISOString(), trials: trials.length,
    model: trials[0]?.model ?? null, effort: trials[0]?.effort ?? null,
    perArm, perFamily, perTemplate, heldOut, srm, bootstrap, flagsmith, decisions, recommendation,
    ...(writeAudit ? { writeAudit } : {}),
    metrics: METRICS,
  };
  const basename = offline ? 'readout.offline' : 'readout';
  writeFileSync(join(runDir, basename + '.json'), JSON.stringify(readout, null, 2));
  writeFileSync(join(runDir, basename + '.md'), renderMarkdown(readout));
  return readout;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const usd = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(4)}`);

export function renderMarkdown(r: any) {
  const lines: string[] = [];
  lines.push(`# Interface Wars readout: ${r.run}`, '', `${r.trials} trials, model \`${r.model}\` at effort \`${r.effort}\`. Generated ${r.generatedAt}.`, '');
  lines.push('| Arm | Trials | Jobs correct | Out-of-scope changes | Mean cost | Cost per correct job | Mean input tokens |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const [a, s] of Object.entries<any>(r.perArm)) lines.push(`| ${a} | ${s.n} | ${s.correct} (${pct(s.correctRate)}) | ${s.collateral} (${pct(s.collateralRate)}) | ${usd(s.meanCost)} | ${usd(s.costPerCorrect)} | ${Math.round(s.meanTokensIn).toLocaleString()} |`);
  if (r.writeAudit) {
    lines.push('', '## Change scope: final state and observed writes', '',
      'Zero final collateral means the final snapshot shows no change outside the job. Zero observed out-of-scope writes means Flagsmith\'s audit log shows no write to an object outside the job at any point, including writes reverted before the snapshot. A trial with lost audit rows had a write whose audit row Flagsmith failed to create.', '',
      '| Arm | Audited trials | Zero final collateral | Zero observed out-of-scope writes | Reverted out-of-scope writes | Trials with lost audit rows |', '|---|---:|---:|---:|---:|---:|');
    for (const [a, w] of Object.entries<any>(r.writeAudit)) lines.push(`| ${a} | ${w.audited}/${w.trials} | ${w.noFinalCollateral} | ${w.noOutOfScopeWrites} | ${w.revertedOutOfScope} | ${w.lostAuditRows} |`);
  }
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
  lines.push('', '## Sample ratio check', '');
  if (r.srm) {
    const counts = Object.entries<number>(r.srm.observed).map(([a, n]) => `${a} ${n}`).join(', ');
    lines.push(`Harness chi-square test against the configured split: ${counts} of ${r.srm.total}; ` +
      `chi-square ${r.srm.chiSquare.toFixed(3)} on ${r.srm.df} df, p = ${r.srm.pValue === null ? 'n/a' : r.srm.pValue.toFixed(3)}. ` +
      (r.srm.pValue !== null && r.srm.pValue < 0.01 ? '**Assignment looks unbalanced; treat the result with caution.**' : 'No sign of unbalanced assignment.'));
  }
  if (r.flagsmith?.srmPValue !== undefined) {
    lines.push('', `Flagsmith's own check: ${r.flagsmith.srmPValue ?? 'not computed'}` +
      (r.flagsmith.srmPValue === null ? ' (Flagsmith 2.295.2 reads the split from the environment default, which an experiment zeroes; see its TODO in `_expected_variant_shares`).' : '.'));
  }
  return lines.join('\n') + '\n';
}

if (import.meta.main) {
  const run = process.argv.slice(2).find((arg) => arg !== '--offline') ?? 'main';
  const r = await buildReadout(run, { withFlagsmith: !process.argv.includes('--offline') });
  console.log(renderMarkdown(r));
}
