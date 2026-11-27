// Statistics and decision rule used by the readout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterBootstrap, decideArm, sampleRatioCheck } from '../src/experiment/readout.ts';
import type { TrialRecord } from '../src/trial.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

test('sample-ratio check matches known chi-square p-values', () => {
  // df = 1, chi-square = 4: p = 0.0455.
  close(sampleRatioCheck({ a: 60, b: 40 }, { a: 0.5, b: 0.5 }).pValue!, 0.0455003, 1e-6);
  // df = 2 has the closed form p = exp(-x / 2).
  const main = sampleRatioCheck({ mcp: 87, cli: 82, cli_skill: 86 });
  close(main.pValue!, Math.exp(-main.chiSquare / 2), 1e-12);
  close(main.pValue!, 0.9215, 1e-4);
  // A badly unbalanced split is flagged.
  assert.ok(sampleRatioCheck({ mcp: 150, cli: 50, cli_skill: 55 }).pValue! < 1e-6);
});

function fakeTrials(spec: Record<string, Record<string, [number, number]>>): TrialRecord[] {
  // spec[template][arm] = [correct, total]
  const out: any[] = [];
  for (const [template, arms] of Object.entries(spec)) {
    for (const [arm, [correct, total]] of Object.entries(arms)) {
      for (let i = 0; i < total; i++) out.push({ template, arm, correct: i < correct, collateral: [], costUsd: 0.001 });
    }
  }
  return out;
}

test('cluster bootstrap is deterministic and brackets the point estimate', () => {
  const trials = fakeTrials({
    a: { mcp: [5, 10], cli_skill: [10, 10] },
    b: { mcp: [8, 10], cli_skill: [10, 10] },
    c: { mcp: [9, 10], cli_skill: [9, 10] },
    d: { mcp: [2, 10], cli_skill: [10, 10] },
  });
  const one = clusterBootstrap(trials, 'cli_skill', 'mcp', (t) => Number(t.correct), 2000);
  const two = clusterBootstrap(trials, 'cli_skill', 'mcp', (t) => Number(t.correct), 2000);
  assert.deepEqual(one, two);
  close(one.point, 39 / 40 - 24 / 40, 1e-12);
  assert.ok(one.low <= one.point && one.point <= one.high);
  assert.ok(one.low > 0, 'a consistent advantage across templates gives an interval above zero');
});

test('cluster bootstrap interval crosses zero when the effect lives in one template', () => {
  const trials = fakeTrials({
    a: { mcp: [0, 10], cli: [10, 10] },
    b: { mcp: [10, 10], cli: [10, 10] },
    c: { mcp: [10, 10], cli: [10, 10] },
  });
  const r = clusterBootstrap(trials, 'cli', 'mcp', (t) => Number(t.correct), 2000);
  assert.ok(r.point > 0);
  assert.ok(r.low <= 0, `expected the interval to include zero, got ${r.low}`);
});

const interval = (low: number, high: number) => ({ point: (low + high) / 2, low, high });
const flat = interval(0, 0);

test('decision rule: WIN needs both analyses and no guardrail breach', () => {
  const strong = { lift: 0.28, ci_low: 0.14, ci_high: 0.42, chance_to_win: 0.9999 };
  const win = decideArm({ jobCorrect: strong }, { job_correct: interval(0.06, 0.43), no_collateral: flat, cost_usd: interval(-0.005, -0.004) });
  assert.equal(win.verdict, 'WIN');
  // Bootstrap interval crosses zero: inconclusive even with a strong Flagsmith result (the cli case).
  const cli = decideArm({ jobCorrect: { lift: 0.17, ci_low: 0.018, ci_high: 0.32, chance_to_win: 0.986 } },
    { job_correct: interval(-0.01, 0.34), no_collateral: flat, cost_usd: interval(-0.003, -0.001) });
  assert.equal(cli.verdict, 'INCONCLUSIVE');
  // Costlier arm: guardrail breach blocks the win.
  const costly = decideArm({ jobCorrect: strong, cost: { lift: 0.5, ci_low: 0.2, ci_high: 0.8, chance_to_win: 0.01 } },
    { job_correct: interval(0.06, 0.43), no_collateral: flat, cost_usd: interval(0.001, 0.004) });
  assert.equal(costly.verdict, 'INCONCLUSIVE');
  assert.equal(costly.guardrailBreach.cost_usd, true);
  // Out-of-scope changes: guardrail breach blocks the win.
  const careless = decideArm({ jobCorrect: strong }, { job_correct: interval(0.06, 0.43), no_collateral: interval(-0.3, -0.1), cost_usd: flat });
  assert.equal(careless.verdict, 'INCONCLUSIVE');
  // No Flagsmith result yet: never a win.
  assert.equal(decideArm({}, { job_correct: interval(0.06, 0.43), no_collateral: flat, cost_usd: flat }).verdict, 'INCONCLUSIVE');
  // Both analyses credibly negative: LOSS.
  const loss = decideArm({ jobCorrect: { lift: -0.3, ci_low: -0.45, ci_high: -0.1, chance_to_win: 0.01 } },
    { job_correct: interval(-0.4, -0.05), no_collateral: flat, cost_usd: flat });
  assert.equal(loss.verdict, 'LOSS');
});

test('decision rule reproduces the committed main-run verdicts', () => {
  const r = JSON.parse(readFileSync(new URL('../runs/main/readout.json', import.meta.url), 'utf8'));
  for (const arm of ['cli', 'cli_skill']) {
    const again = decideArm({
      jobCorrect: r.flagsmith.metrics.job_correct.inference[arm],
      noCollateral: r.flagsmith.metrics.no_collateral.inference[arm],
      cost: r.flagsmith.metrics.cost_usd.inference[arm],
    }, r.bootstrap[arm]);
    assert.equal(again.verdict, r.decisions[arm].verdict, arm);
  }
  assert.equal(r.decisions.cli_skill.verdict, 'WIN');
  assert.equal(r.decisions.cli.verdict, 'INCONCLUSIVE');
  assert.equal(r.recommendation.ship, 'cli_skill');
});

test('readout counts match Flagsmith counts for every metric and arm', () => {
  const r = JSON.parse(readFileSync(new URL('../runs/main/readout.json', import.meta.url), 'utf8'));
  const name: Record<string, string> = { mcp: 'control', cli: 'cli', cli_skill: 'cli_skill' };
  for (const [arm, s] of Object.entries<any>(r.perArm)) {
    const v = r.flagsmith.metrics.job_correct.variants[name[arm]];
    assert.equal(v.n, s.n, `${arm} identities`);
    assert.equal(v.sum, s.correct, `${arm} job_correct conversions`);
    close(r.flagsmith.metrics.cost_usd.variants[name[arm]].sum, s.costTotal, 1e-6);
  }
});
