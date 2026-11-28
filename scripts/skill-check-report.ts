// Regenerate the descriptive comparison with: node scripts/skill-check-report.ts > runs/skill-check.md
import assert from 'node:assert/strict';
import type { TurnRecord } from '../src/agent/loop.ts';
import { SKILL_REVISIONS, type SkillRevision } from '../src/arms/skill.ts';
import { loadTrials } from '../src/experiment/readout.ts';
import { jobFor, TEMPLATES } from '../src/jobs/catalog.ts';
import { STRICT_GRADER } from '../src/jobs/strict.ts';
import type { TrialRecord } from '../src/trial.ts';

const scheduled = Array.from({ length: 144 }, (_, i) => i).filter((i) =>
  i < 48 || ['create_experiment', 'start_experiment'].includes(TEMPLATES[i % TEMPLATES.length].id));

function loadCheck(name: string, skill: SkillRevision) {
  const trials = loadTrials(name);
  assert.deepEqual(trials.map((t) => t.index), scheduled, `${name}: incomplete or unexpected published trial set`);
  for (const t of trials) {
    assert.equal(t.trialId, `${name}-${String(t.index).padStart(4, '0')}`);
    assert.equal(t.template, TEMPLATES[t.index % TEMPLATES.length].id, t.trialId);
    assert.deepEqual(t.skill, { name: skill, sha256: SKILL_REVISIONS[skill] }, t.trialId);
    assert.equal(t.grader, STRICT_GRADER, t.trialId);
    assert.equal(t.arm, 'cli_skill', t.trialId);
    assert.equal(t.model, 'claude-haiku-5-5', t.trialId);
    assert.equal(t.effort, 'medium', t.trialId);
    assert.equal(t.writeAudit?.audit, 'audit-v1', t.trialId);
  }
  return { name, skill, trials };
}

function draftEnabled(t: TrialRecord) {
  const states = t.changes.filter((c) => /^env\.Production\.override\.[^.]+\.experiment-\d+-rollout\.enabled$/.test(c.path));
  assert.equal(states.length, 1, t.trialId);
  assert.equal(typeof states[0].after, 'boolean', t.trialId);
  return states[0].after === true;
}

// The snapshot has no rollout percentage. Only use a running experiment's JSON read-back from
// the final shell call. Its output can include several jq results, separators and a clipped POST response.
function finalEnrollment(t: TrialRecord): number | null {
  const call = (t.transcript as TurnRecord[]).flatMap((turn) => turn.calls).at(-1);
  if (!call || call.isError || call.name !== 'bash') return null;
  const chunks = call.output.split(/\n(?=\{)/);
  for (const chunk of chunks.reverse()) {
    let result;
    try {
      result = JSON.parse(chunk.slice(0, chunk.lastIndexOf('}') + 1));
    } catch {
      continue;
    }
    const rollout = result?.rollout ?? result?.experiment_rollout;
    if (result?.status === 'running' && typeof rollout?.enabled === 'boolean' && Number.isFinite(rollout.rollout_percentage)) {
      return rollout.enabled ? rollout.rollout_percentage : 0;
    }
  }
  return null;
}

function hypothesisMismatches(trials: TrialRecord[]) {
  const counts = new Map<string, number>();
  for (const t of trials.filter((r) => r.reasons.some((reason) => reason.includes('hypothesis')))) {
    const draft = jobFor(t.index, t.trialId).strictDraft;
    assert.ok(draft, t.trialId);
    const actual = t.changes.find((c) => c.path === `env.Production.experiment.${draft.name}.hypothesis`)?.after;
    let kind = 'other wording';
    if (actual === `${draft.hypothesis}.`) kind = 'added a final period';
    if (actual === draft.hypothesis.replaceAll('"', '')) kind = 'dropped quotation marks';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${kind}`).join(', ') || 'none';
}

const runs = [loadCheck('skill-v1-check', 'flagsmith-ops'), loadCheck('skill-v2-check', 'flagsmith-ops-v2')];
const fraction = (trials: TrialRecord[], predicate: (t: TrialRecord) => boolean) => `${trials.filter(predicate).length}/${trials.length}`;
const cost = (trials: TrialRecord[]) => trials.reduce((total, t) => total + t.costUsd, 0);
function row(label: string, measure: (trials: TrialRecord[]) => string, template?: string) {
  const cells = runs.map(({ trials }) => measure(template ? trials.filter((t) => t.template === template) : trials));
  console.log(`| ${label} | ${cells.join(' | ')} |`);
}

console.log('# Skill revision check\n');
console.log('Both revisions used the CLI, Claude Haiku 5.5 at medium effort, the strict draft grader and the write audit.');
console.log('They ran the same template schedule with independently seeded job details. The plan specified a descriptive comparison with three to nine trials per template. [Plan](../prereg/SKILL_V2_CHECK.md)\n');
for (const { name, skill, trials } of runs) {
  console.log(`- [${name}](${name}/trials/) contains ${trials.length} trials with \`${skill}\` at \`${SKILL_REVISIONS[skill].slice(0, 12)}\`.`);
}
console.log('\n| Measure | Revision 1 | Revision 2 |\n|---|---:|---:|');
row('Drafts left with enrollment enabled', (ts) => fraction(ts, draftEnabled), 'create_experiment');
row('Starts ending in running status', (ts) => fraction(ts, (t) => t.changes.some((c) => c.path.endsWith('.status') && c.after === 'running')), 'start_experiment');
row('Starts with enrollment above 0% among measured starts', (ts) => {
  const values = ts.map(finalEnrollment).filter((n) => n !== null);
  if (!values.length) return 'unmeasured';
  const observed = [...new Set(values)].sort((a, b) => a - b).map((n) => `${n}%`).join(', ');
  return `${values.filter((n) => n > 0).length}/${values.length} (observed ${observed})`;
}, 'start_experiment');
row('Starts missing a final enrollment percentage', (ts) => fraction(ts, (t) => finalEnrollment(t) === null), 'start_experiment');
row('Trials with final collateral', (ts) => fraction(ts, (t) => t.collateral.length > 0));
row('Trials with observed out-of-scope writes', (ts) => fraction(ts, (t) => t.writeAudit!.outOfScope.length > 0));
row('Trials with lost audit rows', (ts) => fraction(ts, (t) => t.writeAudit!.lostRows > 0));
row('Trials ending in an API error', (ts) => fraction(ts, (t) => t.outcome === 'api_error'));
row('Mean cost per trial', (ts) => `$${(cost(ts) / ts.length).toFixed(4)}`);
row('Total cost', (ts) => `$${cost(ts).toFixed(4)}`);

console.log('\nEach start job used a fresh experiment seeded at 100% enrollment. Starting a zero-percent draft created by an earlier job was outside this check.');
console.log('The final snapshot records running status. The final CLI response supplies enrollment when the agent requested it. [Revision 1 example](skill-v1-check/trials/skill-v1-check-0010.json) · [Revision 2 example](skill-v2-check/trials/skill-v2-check-0010.json)');
console.log('\n| Template | Revision 1 strict passes | Revision 2 strict passes |\n|---|---:|---:|');
for (const template of TEMPLATES) {
  row(`\`${template.id}\`${template.heldOut ? ' (held out)' : ''}`, (ts) => fraction(ts, (t) => t.correct), template.id);
}
row('**All**', (ts) => `**${fraction(ts, (t) => t.correct)}**`);
console.log('\n| Hypothesis mismatches | Revision 1 | Revision 2 |\n|---|---|---|');
row('Difference from the exact requested text', hypothesisMismatches, 'create_experiment');
console.log('\nThe prompt puts the hypothesis at the end of a sentence. The grader treats the final period as sentence punctuation and includes both quoted variant names in the expected text.');
console.log('\n## Failed trials\n');
for (const { name, trials } of runs) {
  for (const t of trials.filter((trial) => !trial.correct)) {
    const reasons = [...t.reasons, ...t.collateral.map((c) => `collateral at ${c.path}`), ...t.writeAudit!.outOfScope.map((w) => w.log)];
    console.log(`- [${t.trialId}](${name}/trials/${t.trialId}.json) (\`${t.template}\`) — ${reasons.join('. ') || t.outcome}.`);
  }
}
