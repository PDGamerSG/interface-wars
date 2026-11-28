// Exports one run's results as static JSON for the website (web/public/data/), so the site needs no API and no
// access to runs/. Fails, writing nothing it has not checked, if any lab secret or credential-like string would be
// published.
//   node scripts/export-web-data.ts [run] [--out web/public/data]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS, ROOT } from '../src/lab/config.ts';
import { localCredentials, redactCredentials } from '../src/evidence/redact.ts';
import { TEMPLATES } from '../src/jobs/catalog.ts';
import type { TrialRecord } from '../src/trial.ts';

const args = process.argv.slice(2);
const run = args.find((a) => !a.startsWith('--')) ?? 'main';
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'web', 'public', 'data');
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const runDir = join(RUNS, run);
if (!existsSync(join(runDir, 'readout.json'))) throw new Error(`No readout for ${run}. Run: node src/cli.ts readout ${run}`);

const labSecrets = localCredentials();

function loadRun(name: string): TrialRecord[] {
  const dir = join(RUNS, name, 'trials');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => redactCredentials(readJson(join(dir, f)), labSecrets));
}

// One row per trial: everything the tables, grids and filters need, nothing heavy.
function row(t: TrialRecord) {
  return {
    id: t.trialId,
    index: t.index,
    arm: t.arm,
    template: t.template,
    family: t.family,
    heldOut: t.heldOut,
    correct: t.correct,
    collateral: t.collateral.length,
    outcome: t.outcome,
    claimedDone: /^\s*DONE/m.test(t.finalText) && !/^\s*DONE\?/m.test(t.finalText),
    costUsd: t.costUsd,
    turns: t.turns,
    toolCalls: t.toolCalls,
    toolErrors: t.toolErrors,
    ms: t.ms,
    tokensIn: (t.usage as any).input + (t.usage as any).cacheRead + (t.usage as any).cacheWrite,
    tokensOut: (t.usage as any).output,
  };
}

// The full record for the trial page, minus the raw command list (already inside the transcript).
function detail(t: TrialRecord) {
  const { commands: _commands, ...rest } = t;
  return rest;
}

const trials = loadRun(run);
const readout = readJson(join(runDir, 'readout.json'));
const approval = existsSync(join(runDir, 'approval.json')) ? readJson(join(runDir, 'approval.json')) : null;
const tokensFile = join(RUNS, 'interface-tokens.json');
const interfaceTokens = existsSync(tokensFile) ? readJson(tokensFile) : null;

const examples: Record<string, string> = {};
for (const t of trials) examples[t.template] ??= t.task;
const jobs = TEMPLATES.map((tpl) => ({ id: tpl.id, family: tpl.family, heldOut: tpl.heldOut, exampleTask: examples[tpl.id] ?? null }));

const pilot = ['smoke-mcp', 'smoke-cli', 'smoke-skill', 'pilot'].flatMap(loadRun);
const afterShip = loadRun('after-ship');
const summarise = (rows: TrialRecord[]) =>
  Object.fromEntries(['mcp', 'cli', 'cli_skill'].map((arm) => {
    const r = rows.filter((t) => t.arm === arm);
    return [arm, { n: r.length, correct: r.filter((t) => t.correct).length, costUsd: Number(r.reduce((s, t) => s + t.costUsd, 0).toFixed(6)) }];
  }));

// The local spend ledger is intentionally ignored because it is mutable and may
// include calls that have no published record. Derive the public total only from
// the tracked trial archives so a clean checkout gets the same value.
const projectSpendUsd = Number([...trials, ...pilot, ...afterShip].reduce((sum, trial) => sum + trial.costUsd, 0).toFixed(6));
const meta = {
  run,
  // The readout is the immutable publication boundary for a run. Reusing its
  // timestamp keeps a replayed export byte-for-byte stable while preserving the
  // existing metadata field for consumers.
  exportedAt: readout.generatedAt ?? null,
  model: readout.model,
  effort: readout.effort,
  trials: trials.length,
  firstTrialAt: trials.map((t) => t.startedAt).sort()[0] ?? null,
  lastTrialAt: trials.map((t) => t.startedAt).sort().at(-1) ?? null,
  runSpendUsd: Number(trials.reduce((s, t) => s + t.costUsd, 0).toFixed(4)),
  projectSpendUsd,
  versions: { flagsmith: '2.295.2', flagsmithMcp: '2.295.2', flagsmithCli: '2' },
  interfaceTokens,
  approval,
  pilot: { trials: pilot.length, byArm: summarise(pilot) },
  afterShip: { trials: afterShip.length, byArm: summarise(afterShip), rows: afterShip.map(row) },
};

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /Api-Key [A-Za-z0-9]{12,}/,
  /FLAGSMITH_API_KEY_[A-Za-z0-9_]+=\S{8,}/,
  /Token [0-9a-f]{40}/,
  /"(?:environment_api_key|api_key|server_key|master_key)"\s*:\s*"(?!\[env-|\[REDACTED\])[^"]+"/i,
  /(?<![A-Za-z0-9])ser\.[2-9A-HJ-NP-Za-km-z]{22}(?![A-Za-z0-9])/,
];

const files = new Map<string, string>();
files.set('meta.json', JSON.stringify(meta));
files.set('readout.json', JSON.stringify(readout));
files.set('jobs.json', JSON.stringify(jobs));
files.set('trials.json', JSON.stringify(trials.map(row)));
for (const t of [...trials, ...afterShip]) files.set(`trials/${t.trialId}.json`, JSON.stringify(detail(t)));
files.set('skill.md', readFileSync(join(ROOT, 'skills', 'flagsmith-ops', 'SKILL.md'), 'utf8'));
files.set('findings.md', readFileSync(join(ROOT, 'docs', 'FLAGSMITH_FINDINGS.md'), 'utf8'));
files.set('preregistration.md', readFileSync(join(ROOT, 'prereg', 'PREREGISTRATION.md'), 'utf8'));
files.set('deviations.md', readFileSync(join(ROOT, 'prereg', 'DEVIATIONS.md'), 'utf8'));

const problems: string[] = [];
let total = 0;
for (const [name, body] of files) {
  total += Buffer.byteLength(body);
  for (const secret of labSecrets) if (body.includes(secret)) problems.push(`${name}: contains a value from runs/lab.local.json or .env`);
  for (const p of PATTERNS) if (p.test(body)) problems.push(`${name}: matches ${p}`);
}
if (total > MAX_TOTAL_BYTES) problems.push(`export is ${(total / 1e6).toFixed(1)} MB, above the ${MAX_TOTAL_BYTES / 1e6} MB budget`);
if (problems.length) {
  console.error('Export refused:\n  ' + [...new Set(problems)].join('\n  '));
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'trials'), { recursive: true });
for (const [name, body] of files) writeFileSync(join(OUT, name), body);
const written = readdirSync(join(OUT, 'trials')).length;
console.log(`Exported ${run}: ${trials.length} trials (+${afterShip.length} after ship), ${written} transcripts, ` +
  `${(total / 1e6).toFixed(2)} MB to ${OUT}. Largest transcript: ${Math.max(...readdirSync(join(OUT, 'trials')).map((f) => statSync(join(OUT, 'trials', f)).size)) / 1000} KB.`);
