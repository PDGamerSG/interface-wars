import { Rng } from '../jobs/catalog.ts';
import { sampleRatioCheck } from '../experiment/readout.ts';
import { arms, design, manifest, type Assignment, type Journal, type Outcome } from './study.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;

export type NativeCheck = { warehouseMatches: boolean; aggregatesMatch: boolean; excluded: number | null; billingMatches: boolean };
type Pair = { rank: number; template: string; mcp: Outcome; mcp_guided: Outcome };
function pairedCost(pairs: Pair[]) {
  if (!pairs.length) return null;
  const difference = (p: Pair) => p.mcp_guided.costUsd - p.mcp.costUsd;
  const strata = manifest.jobPack.templateIds.map(t => pairs.filter(p => p.template === t).map(difference));
  const rng = new Rng('mcp-guidance-v1/paired-cost/1');
  const draws: number[] = [];
  for (let i = 0; i < design.bootstrapDraws; i++) {
    let total = 0;
    for (const stratum of strata) {
      for (let j = 0; j < stratum.length; j++) total += stratum[Math.min(stratum.length - 1, Math.floor(rng.next() * stratum.length))];
    }
    draws.push(total / pairs.length);
  }
  draws.sort((x, y) => x - y);
  const quantile = (p: number) => {
    const at = p * (draws.length - 1);
    const i = Math.floor(at);
    return draws[i] + (at - i) * (draws[Math.ceil(at)] - draws[i]);
  };
  return { mcp: mean(pairs.map(p => p.mcp.costUsd)), mcp_guided: mean(pairs.map(p => p.mcp_guided.costUsd)),
    difference: mean(pairs.map(difference)), low95: quantile(0.025), high95: quantile(0.975), draws: draws.length };
}

// Invert the binomial CDF at alpha=0.05. The sample is at most 64 pairs.
function upperLossProbability(losses: number, n: number) {
  if (losses === n) return 1;
  let lo = 0, hi = 1;
  for (let step = 0; step < 70; step++) {
    const p = (lo + hi) / 2;
    let term = (1 - p) ** n, cumulative = term;
    for (let k = 1; k <= losses; k++) {
      term *= (n - k + 1) * p / (k * (1 - p)); cumulative += term;
    }
    if (cumulative > 0.05) lo = p; else hi = p;
  }
  return hi;
}
function guardrail(pairs: Pair[], metric: 'correct' | 'scoped') {
  if (!pairs.length) return null;
  const wins = pairs.filter(p => p.mcp_guided[metric] && !p.mcp[metric]).length;
  const losses = pairs.filter(p => p.mcp[metric] && !p.mcp_guided[metric]).length;
  const lower95 = -upperLossProbability(losses, pairs.length);
  return { difference: (wins - losses) / pairs.length, wins, losses, ties: pairs.length - wins - losses, lower95, margin: -design.guardrailMargin,
    withinMargin: lower95 > -design.guardrailMargin };
}

export function summarize(journal: Journal, native?: NativeCheck, billing: Record<string, number> = {}) {
  const { rows } = journal;
  const assigned = { mcp: 0, mcp_guided: 0 };
  const perArm = Object.fromEntries(arms.map(arm => {
    const members = rows.filter(r => r.arm === arm);
    assigned[arm] = members.length;
    const outcomes = members.flatMap(r => r.result ? [r.result] : []);
    const completedCostUsd = sum(outcomes.map(r => r.costUsd));
    return [arm, { assigned: members.length, attempted: members.filter(r => r.attempts.length).length, graded: outcomes.length,
      missing: members.length - outcomes.length, correct: outcomes.filter(r => r.correct).length, scoped: outcomes.filter(r => r.scoped).length,
      completedCostUsd, knownSpendUsd: sum(members.map(r => billing[r.id] ?? r.result?.costUsd ?? 0)),
      meanCompletedUsd: outcomes.length ? completedCostUsd / outcomes.length : null }];
  }));
  const pairs: Pair[] = [];
  const unmatched: Assignment[] = [];
  const incompletePairs: number[] = [];
  for (const rank of new Set(rows.map(r => r.rank))) {
    const members = rows.filter(r => r.rank === rank);
    if (members.length === 1) { unmatched.push(members[0]); continue; }
    const control = members.find(r => r.arm === 'mcp')!, guided = members.find(r => r.arm === 'mcp_guided')!;
    if (control.caseHash !== guided.caseHash || control.template !== guided.template) throw new Error('Mismatched paired cases');
    if (control.result && guided.result) pairs.push({ rank, template: control.template, mcp: control.result, mcp_guided: guided.result });
    else incompletePairs.push(rank);
  }
  const cost = pairedCost(pairs);
  const correctness = guardrail(pairs, 'correct'), scope = guardrail(pairs, 'scoped');
  const srm = sampleRatioCheck(assigned, { mcp: 0.5, mcp_guided: 0.5 });
  const floors = {
    registered: journal.phase === 'registered' && !journal.synthetic,
    allIdentities: rows.length === design.identities && rows.every(r => r.result && r.exposure === 'sent' && r.metrics === 'sent'),
    noUnresolvedStop: !journal.stop, pairs: pairs.length >= design.minimumPairs,
    allTemplates: manifest.jobPack.templateIds.every(t => pairs.some(p => p.template === t)),
    identities: Object.values(assigned).every(n => n >= 50),
    conversions: Object.values(perArm).every(a => a.correct >= 5 && a.scoped >= 5),
    sampleRatio: srm.pValue !== null && srm.pValue >= 0.01,
    native: native?.warehouseMatches === true && native.aggregatesMatch && native.excluded === 0, verifiedCosts: native?.billingMatches === true,
  };
  let verdict = 'INCONCLUSIVE';
  if (Object.values(floors).every(Boolean) && cost) {
    if (cost.high95 < 0 && correctness?.withinMargin && scope?.withinMargin) verdict = 'GUIDE REDUCES COST WITHIN GUARDRAILS';
    else if (cost.low95 > 0) verdict = 'GUIDE COSTS MORE';
  }
  return { study: manifest.id, fingerprint: journal.fingerprint, phase: journal.phase, synthetic: journal.synthetic, verdict, floors, perArm,
    pairs: pairs.length, perTemplatePairs: Object.fromEntries(manifest.jobPack.templateIds.map(t => [t, pairs.filter(p => p.template === t).length])),
    cost, correctness, scope, sampleRatio: srm, native: native ?? null, unmatched, incompletePairs,
    retries: rows.filter(r => r.attempts.length > 1 || !r.result).map(r => ({ id: r.id, attempts: r.attempts })), stop: journal.stop ?? null };
}
