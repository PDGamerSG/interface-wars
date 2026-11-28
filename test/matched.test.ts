import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REQUEST_USD, trialBilling } from '../src/matched/billing.ts';
import { summarize } from '../src/matched/readout.ts';
import { design, fingerprint, matchedCase, phaseSize, runPhase, type Assignment, type Journal } from '../src/matched/study.ts';

test('matched cases are deterministic and pair the same seed by arm', () => {
  const a = matchedCase('registered', 7);
  const b = matchedCase('registered', 7);
  assert.equal(a.caseHash, b.caseHash);
  assert.equal(a.caseSeed, 'mcp-guidance-v1/registered/7');
  assert.equal(a.job.template, 'remove_segment_override');
  assert.notEqual(a.caseHash, matchedCase('pilot', 7).caseHash);
});

test('pilot runner forces twelve pairs without exposures and is replay safe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'matched-pilot-'));
  const deliveries: string[] = [];
  const outcomes = async (_row: Assignment): Promise<any> => ({ outcome: 'dry', correct: true, scoped: true, costUsd: 0, turns: 0, toolCalls: 0, toolErrors: 0 });
  const ports = {
    assign: async () => 'mcp' as const,
    deliver: async (row: Assignment, kind: 'exposure' | 'metrics') => { deliveries.push(row.id + ':' + kind); },
    execute: outcomes,
  };
  const first = await runPhase(dir, 'pilot', true, ports, 24);
  assert.equal(first.rows.length, phaseSize('pilot'));
  assert.equal(first.rows.filter((r) => r.arm === 'mcp').length, design.pilotPairs);
  assert.equal(first.rows.filter((r) => r.arm === 'mcp_guided').length, design.pilotPairs);
  assert.equal(deliveries.length, 0);
  const second = await runPhase(dir, 'pilot', true, ports, 24);
  assert.equal(second.rows.length, first.rows.length);
  assert.equal(second.rows.filter((r) => r.attempts.length > 1).length, 0);
});

test('matched readout labels unmatched and applies the five-point guardrail', () => {
  const rows: Assignment[] = [];
  for (let rank = 0; rank < 50; rank++) {
    for (const arm of ['mcp', 'mcp_guided'] as const) rows.push({
      id: 'x-' + arm + '-' + rank, arm, rank, template: matchedCase('registered', rank).job.template,
      caseHash: matchedCase('registered', rank).caseHash, caseSeed: matchedCase('registered', rank).caseSeed,
      source: 'flag', exposure: 'sent', metrics: 'sent', attempts: [{ startedAt: '', state: 'graded' }],
      result: { outcome: 'done', correct: true, scoped: true, costUsd: arm === 'mcp' ? 0.01 : 0.001, turns: 1, toolCalls: 1, toolErrors: 0 },
    });
  }
  rows.push({ ...rows[0], id: 'unmatched', rank: 50, result: undefined, attempts: [] });
  const journal: Journal = { phase: 'registered', synthetic: false, fingerprint, rows };
  const report = summarize(journal, { warehouseMatches: true, aggregatesMatch: true, excluded: 0, billingMatches: true });
  assert.equal(report.pairs, 50);
  assert.equal(report.unmatched.length, 1);
  assert.equal(report.verdict, 'INCONCLUSIVE');
  assert.equal(report.floors.pairs, true);
  assert.ok(Math.abs(report.cost!.difference + 0.009) < 1e-12);
  assert.equal(report.correctness?.withinMargin, false);
});

test('billing reserves a conservative whole request and settles the actual amount', () => {
  const dir = mkdtempSync(join(tmpdir(), 'matched-billing-'));
  const path = join(dir, 'spend.local.json');
  writeFileSync(path, JSON.stringify({ totalUsd: 0, calls: 0 }));
  const billing = trialBilling(path, 'registered-000', 15);
  billing.reserve();
  assert.equal(readFileSync(path, 'utf8').includes('registered-000'), true);
  billing.settle(0.012345);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.totalUsd, 0.012345);
  assert.equal(saved.matched.totals['registered-000'], 0.012345);
  billing.reserve();
  assert.throws(() => billing.reserve(), /Unresolved billing/);
  assert.ok(MAX_REQUEST_USD > 0.6 && MAX_REQUEST_USD < 0.7);
});

test('billing stops before the two-dollar incremental ceiling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'matched-cap-'));
  const path = join(dir, 'spend.local.json');
  writeFileSync(path, JSON.stringify({ totalUsd: 1.4, calls: 10, matched: { totals: { old: 1.4 } } }));
  const billing = trialBilling(path, 'registered-001', 15);
  assert.throws(() => billing.reserve(), /Insufficient headroom/);
});
