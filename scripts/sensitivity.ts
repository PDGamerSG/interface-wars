// Exploratory checks on the registered main run, using only the committed records.
import assert from 'node:assert/strict';
import { ARMS, type ArmName } from '../src/arms/types.ts';
import { clusterBootstrap, loadTrials } from '../src/experiment/readout.ts';
import { Rng } from '../src/jobs/catalog.ts';
import type { TrialRecord } from '../src/trial.ts';

const trials = loadTrials('main').filter((t) => t.outcome !== 'api_error');
const templateNames = [...new Set(trials.map((t) => t.template))].sort();
const gapTemplates = ['archive_stale_flag', 'change_split_in_production', 'create_metric', 'ship_winner', 'start_experiment'];
assert.equal(templateNames.length, 16);
const correct = (t: TrialRecord) => Number(t.correct);

// All create_experiment jobs start without an experiment. An accepted creation must have
// a recorded final rollout state. Refuse to infer disabled from missing evidence.
const enabledDrafts = new Set<string>();
for (const t of trials.filter((t) => t.template === 'create_experiment' && t.correct)) {
  const states = t.changes.filter((c) => /^env\.Production\.override\.[^.]+\.experiment-\d+-rollout\.enabled$/.test(c.path));
  assert.equal(states.length, 1, `Expected one rollout state in ${t.trialId}`);
  assert.equal(typeof states[0].after, 'boolean', t.trialId);
  if (states[0].after) enabledDrafts.add(t.trialId);
}
const stagedCorrect = (t: TrialRecord) => Number(t.correct && !enabledDrafts.has(t.trialId));
const shared = trials.filter((t) => !gapTemplates.includes(t.template));
function armRows(rows: TrialRecord[], arm: ArmName) {
  return rows.filter((t) => t.arm === arm);
}
function count(rows: TrialRecord[], metric = correct) {
  return rows.reduce((sum, t) => sum + metric(t), 0);
}

// One percentage-point difference per template. Use the same draws and order statistics
// as the registered CLI-vs-MCP bootstrap, giving every sampled template one vote.
const differences = templateNames.map((name) => {
  const rows = trials.filter((t) => t.template === name);
  const cli = armRows(rows, 'cli'), mcp = armRows(rows, 'mcp');
  assert.ok(cli.length && mcp.length, `Missing arm in ${name}`);
  return count(cli) / cli.length - count(mcp) / mcp.length;
});
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const rng = new Rng(`bootstrap-cli-mcp-${trials.length}`);
const draws = Array.from({ length: 4000 }, () => mean(differences.map(() => rng.pick(differences)))).sort((a, b) => a - b);
const equalTemplate = { point: mean(differences), low: draws[100], high: draws[3900] };
const points = (x: number) => (100 * x).toFixed(1);
const interval = (b: typeof equalTemplate) => `${points(b.point)} [${points(b.low)}, ${points(b.high)}]`;

console.log('# Sensitivity of the main result');
console.log('\nPost-hoc checks on the 255 recorded trials. The registered rule compared each CLI arm with MCP.');
console.log('\n| Arm | Registered passes | Passes requiring disabled staging | Registered passes on the 11 templates outside the five MCP gaps |');
console.log('|---|---:|---:|---:|');
for (const arm of ARMS) {
  const rows = armRows(trials, arm), common = armRows(shared, arm);
  console.log(`| ${arm} | ${count(rows)}/${rows.length} | ${count(rows, stagedCorrect)}/${rows.length} | ${count(common)}/${common.length} |`);
}
console.log('\n| Comparison | Correctness difference in percentage points [95% template bootstrap interval] |');
console.log('|---|---:|');
console.log(`| Skill vs MCP, requiring disabled staging | ${interval(clusterBootstrap(trials, 'cli_skill', 'mcp', stagedCorrect))} |`);
console.log(`| CLI vs MCP, equal weight for each of the 16 templates | ${interval(equalTemplate)} |`);
console.log(`| Skill vs CLI, registered grades and trial weights | ${interval(clusterBootstrap(trials, 'cli_skill', 'cli', correct))} |`);
console.log('\nThe staged skill interval reaches zero. A win requires a lower bound above zero. Flagsmith received the registered outcomes.');
console.log('\nThese setup-only trials ended with the rollout enabled while the experiment was still marked created.\n');
console.log([...enabledDrafts].map((id) => `[${id}](trials/${id}.json)`).join(', ') + '.');
console.log('\nThe eleven-template subset excludes ' + gapTemplates.map((name) => '`' + name + '`').join(', ') + '.');
