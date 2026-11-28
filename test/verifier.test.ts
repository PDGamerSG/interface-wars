// The verifier: state diff, change scoping and the recorded trials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { diff } from '../src/lab/sandbox.ts';
import { jobFor, TEMPLATES, Rng, grade } from '../src/jobs/catalog.ts';
import { strictGrade } from '../src/jobs/strict.ts';
import type { TrialRecord } from '../src/trial.ts';

test('diff reports added, removed and changed paths, sorted, and ignores equal values', () => {
  const before = { 'a.x': 1, 'b.y': { k: [1, 2] }, 'c.z': 'same' };
  const after = { 'a.x': 2, 'c.z': 'same', 'd.new': true };
  assert.deepEqual(diff(before, after), [
    { path: 'a.x', before: 1, after: 2 },
    { path: 'b.y', before: { k: [1, 2] }, after: null },
    { path: 'd.new', before: null, after: true },
  ]);
  assert.deepEqual(diff(before, structuredClone(before)), []);
});

test('the catalog has 16 templates in 4 families with one held out per family', () => {
  assert.equal(TEMPLATES.length, 16);
  const families = new Map<string, { total: number; heldOut: number }>();
  for (const t of TEMPLATES) {
    const f = families.get(t.family) ?? { total: 0, heldOut: 0 };
    f.total++; f.heldOut += Number(t.heldOut);
    families.set(t.family, f);
  }
  assert.deepEqual([...families.values()], Array(4).fill({ total: 4, heldOut: 1 }));
});

test('rendering is deterministic per trial id, and trial i uses template i mod 16', () => {
  for (let i = 0; i < 32; i++) {
    const a = jobFor(i, `main-${i}`);
    const b = jobFor(i, `main-${i}`);
    assert.equal(a.task, b.task);
    assert.equal(a.template, TEMPLATES[i % 16].id);
  }
  assert.notEqual(TEMPLATES[0].render(new Rng('x')).task, TEMPLATES[0].render(new Rng('y')).task);
});

test('a change outside the job scope is collateral, and an untouched sandbox is never correct', () => {
  for (const t of TEMPLATES) {
    const job = t.render(new Rng(`scope-${t.id}`));
    const decoy = job.seed.features.find((f: { name: string }) => !job.task.includes(`"${f.name}"`))?.name ?? 'unrelated_flag';
    const change = { path: `env.Development.flag.${decoy}.enabled`, before: false, after: true };
    assert.equal(job.allowed(change.path), false, `${t.id} must not allow changing ${change.path}`);
    const g = grade(job, {}, {}, [change]);
    assert.equal(g.correct, false);
    assert.equal(g.collateral.length, 1);
  }
});

test('scope prefixes do not leak into names that share a prefix', () => {
  // create_segment allows `segment.<name>` and below, not a different segment whose name starts the same way.
  const t = TEMPLATES.find((x) => x.id === 'create_segment')!;
  const job = t.render(new Rng('prefix-leak'));
  const name = /segment named "([^"]+)"/.exec(job.task)?.[1];
  assert.ok(name, job.task);
  assert.equal(job.allowed(`segment.${name}.rules`), true);
  assert.equal(job.allowed(`segment.${name}_copy.rules`), false);
});

test('strict draft grading requires the requested experiment safety contract', () => {
  const job = jobFor(9, 'strict-draft-fixture');
  const experiment = job.strictDraft!;
  const feature = job.seed.features.find((item) => item.name === experiment.feature)!;
  const variation = feature.variants![0].value;
  const control = feature.value!;
  const base = `env.Production.experiment.${experiment.name}`;
  const rollout = `env.Production.override.${feature.name}.experiment-42-rollout`;
  const after = {
    [`${base}.feature`]: feature.name,
    [`${base}.status`]: 'created',
    [`${base}.hypothesis`]: experiment.hypothesis,
    [`${base}.metric.${experiment.metrics[0].name}`]: experiment.metrics[0].expected_direction,
    [`${base}.metric.${experiment.metrics[1].name}`]: experiment.metrics[1].expected_direction,
    [`${rollout}.enabled`]: false,
    [`${rollout}.value`]: control,
    [`${rollout}.split.${variation}`]: 50,
  };
  assert.equal(strictGrade(job, {}, after, Object.entries(after).map(([path, value]) => ({ path, before: null, after: value }))).correct, true);
  assert.match(strictGrade(job, {}, { ...after, [`${rollout}.enabled`]: true }, []).reasons.join('; '), /disabled/);
  assert.match(strictGrade(job, {}, { ...after, [`${rollout}.split.${variation}`]: 60 }, []).reasons.join('; '), /half/);
  assert.match(strictGrade(job, {}, { ...after, [`${base}.hypothesis`]: 'different' }, []).reasons.join('; '), /hypothesis/);
});

test('every recorded trial re-grades to the same collateral from its stored changes', () => {
  for (const run of ['main', 'pilot', 'after-ship']) {
    const dir = new URL(`../runs/${run}/trials/`, import.meta.url);
    for (const file of readdirSync(dir)) {
      const r: TrialRecord = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      const job = jobFor(r.index, r.trialId);
      assert.equal(job.template, r.template, r.trialId);
      assert.equal(job.task, r.task, `${r.trialId} task text is reproducible from its id`);
      const collateral = r.changes.filter((c) => !job.allowed(c.path)).map((c) => c.path);
      assert.deepEqual(collateral, r.collateral.map((c) => c.path), r.trialId);
      if (r.correct) assert.equal(r.reasons.length, 0, r.trialId);
    }
  }
});
