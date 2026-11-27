// Cost accounting: per-request price cards, including the Haiku 5.5 long-prompt card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { costOf } from '../src/agent/loop.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `expected ${b}, got ${a}`);

test('Haiku 5.5 prices a prompt of 100K tokens or fewer on the base card', () => {
  // A prompt of exactly 100K cached tokens ($0.01 per million) plus 1M output tokens ($0.50 per million).
  close(costOf('claude-haiku-5-5', { input: 0, output: 1_000_000, cacheRead: 100_000, cacheWrite: 0 }), 0.501);
  close(costOf('claude-haiku-5-5', { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 0.01);
});

test('Haiku 5.5 bills the whole request at the long card above 100K prompt tokens', () => {
  const u = { input: 1, output: 1000, cacheRead: 100_000, cacheWrite: 0 };
  // 1 input * 0.5 + 1000 output * 2.5 + 100000 cache read * 0.05, per million.
  close(costOf('claude-haiku-5-5', u), (0.5 + 2500 + 5000) / 1e6);
});

test('cache writes cost 1.25x the input rate', () => {
  close(costOf('claude-sonnet-5-5', { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 }), 2.5);
});

test('an unknown model has no silent default price', () => {
  assert.throws(() => costOf('some-new-model', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), /No price card/);
});

test('recorded trial costs equal the sum of their per-turn costs', () => {
  const dir = new URL('../runs/main/trials/', import.meta.url);
  for (const file of readdirSync(dir)) {
    const r = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    const turns = r.transcript.reduce((s: number, t: { costUsd: number }) => s + t.costUsd, 0);
    assert.ok(Math.abs(turns - r.costUsd) < 1e-5, `${r.trialId}: ${turns} vs ${r.costUsd}`);
    const recomputed = r.transcript.reduce((s: number, t: any) => s + costOf(r.model, t.usage), 0);
    assert.ok(Math.abs(recomputed - r.costUsd) < 1e-5, `${r.trialId} recomputed ${recomputed} vs ${r.costUsd}`);
  }
});
