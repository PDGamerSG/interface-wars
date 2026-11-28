import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TrialRecord } from './trial.ts';

export type DemoArm = 'mcp' | 'cli' | 'cli_skill';

type TrialCall = { name: string; isError?: boolean };

export type DemoCase = {
  id: string;
  arm: DemoArm;
  template: string;
  task: string;
  correct: boolean;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  costUsd: number;
  seconds: number;
  callSummary: string;
  verifier: string;
  agentSummary: string;
};

export type DemoData = {
  cases: DemoCase[];
  registered: Record<DemoArm, { correct: number; total: number }>;
  strict: Record<DemoArm, { correct: number; total: number }>;
  strictInterval: string;
  approval: { approvedArm: DemoArm; approver: string; status: string; rolloutDecision: string };
  afterShip: Array<{ id: string; template: string; arm: DemoArm; correct: boolean; collateral: number }>;
  secrets: string[];
};

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const CASE_IDS: Record<DemoArm, string> = {
  mcp: 'main-0138',
  cli: 'main-0074',
  cli_skill: 'main-0154',
};
const AFTER_SHIP_IDS = [
  'after-ship-0000',
  'after-ship-0001',
  'after-ship-0002',
  'after-ship-0003',
  'after-ship-0004',
  'after-ship-0005',
];
const ARM_LABEL: Record<DemoArm, string> = { mcp: 'MCP', cli: 'CLI', cli_skill: 'CLI + skill' };
const SECRET_KEY = /(api[_ -]?key|access[_ -]?token|authorization|password|secret|credential|environment[_ -]?key|server[_ -]?key|master[_ -]?key)/i;

function readJson<T>(path: string, label: string): T {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
function collectSecrets(value: unknown, key = '', output = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (SECRET_KEY.test(key) && value.length >= 8) output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, key, output);
  } else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) collectSecrets(childValue, childKey, output);
  }
  return output;
}

function redactText(value: string, secrets: readonly string[]) {
  let output = value;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) output = output.split(secret).join('[REDACTED]');
  output = output.replace(/(?:Api-Key|Authorization|X-Environment-Key|Token)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{8,}/gi, (match) => match.replace(/[A-Za-z0-9._~+/=-]{8,}$/i, '[REDACTED]'));
  output = output.replace(/FLAGSMITH_API_KEY_[A-Za-z0-9_]+\s*=\s*\S+/gi, (match) => match.replace(/\S+$/, '[REDACTED]'));
  output = output.replace(/sk-ant-[A-Za-z0-9_-]{10,}/gi, '[REDACTED]');
  return output;
}

function flattenCalls(trial: TrialRecord): TrialCall[] {
  return (trial.transcript as Array<{ calls?: TrialCall[] }>).flatMap((turn) => turn.calls ?? []);
}

function inputTokens(trial: TrialRecord) {
  const usage = trial.usage as { input?: number; cacheRead?: number; cacheWrite?: number };
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function caseFromTrial(trial: TrialRecord): DemoCase {
  const calls = flattenCalls(trial);
  const callSummary = calls.map((call) => `${call.name}${call.isError ? ' [error]' : ''}`).join(' → ') || 'none';
  const verifier = trial.reasons.length ? trial.reasons.join('; ') : 'all programmed checks passed';
  const agentSummary = trial.finalText.split('\n')[0] ?? '';
  return {
    id: trial.trialId,
    arm: trial.arm,
    template: trial.template,
    task: trial.task,
    correct: trial.correct,
    turns: trial.turns,
    toolCalls: trial.toolCalls,
    toolErrors: trial.toolErrors,
    inputTokens: inputTokens(trial),
    costUsd: trial.costUsd,
    seconds: trial.ms / 1000,
    callSummary,
    verifier,
    agentSummary,
  };
}

function enabledDraft(trial: TrialRecord) {
  return trial.template === 'create_experiment' && trial.changes.some((change) =>
    /^env\.Production\.override\.[^.]+\.experiment-\d+-rollout\.enabled$/.test(change.path) && change.after === true,
  );
}

function counts(trials: TrialRecord[], strict: boolean) {
  return Object.fromEntries((['mcp', 'cli', 'cli_skill'] as DemoArm[]).map((arm) => {
    const rows = trials.filter((trial) => trial.arm === arm);
    return [arm, { correct: rows.filter((trial) => trial.correct && (!strict || !enabledDraft(trial))).length, total: rows.length }];
  })) as Record<DemoArm, { correct: number; total: number }>;
}

export function loadDemo(repoRoot = ROOT): DemoData {
  const mainTrialsDir = join(repoRoot, 'runs', 'main', 'trials');
  if (!existsSync(mainTrialsDir)) throw new Error(`No archived main trials at ${mainTrialsDir}`);
  const readTrial = (id: string, run = 'main') => readJson<TrialRecord>(join(repoRoot, 'runs', run, 'trials', `${id}.json`), `archived trial ${id}`);
  const mainTrials = readdirSync(mainTrialsDir).filter((file) => file.endsWith('.json')).sort().map((file) => readJson<TrialRecord>(join(mainTrialsDir, file), file));
  if (mainTrials.length !== 255) throw new Error(`Expected 255 archived main trials, found ${mainTrials.length}`);

  const selected = (Object.entries(CASE_IDS) as Array<[DemoArm, string]>).map(([arm, id]) => {
    const trial = readTrial(id);
    if (trial.arm !== arm || trial.template !== 'start_experiment') throw new Error(`Archived demo case ${id} is not the expected ${arm} start_experiment trial`);
    return trial;
  });
  const readout = readJson<any>(join(repoRoot, 'runs', 'main', 'readout.json'), 'main readout');
  const registered = Object.fromEntries((['mcp', 'cli', 'cli_skill'] as DemoArm[]).map((arm) => [arm, {
    correct: Number(readout.perArm?.[arm]?.correct),
    total: Number(readout.perArm?.[arm]?.n),
  }])) as Record<DemoArm, { correct: number; total: number }>;
  if (registered.cli_skill.correct !== 86 || registered.cli_skill.total !== 86) throw new Error('Main readout does not contain the recorded cli_skill result');

  const sensitivityPath = join(repoRoot, 'runs', 'main', 'sensitivity.md');
  if (!existsSync(sensitivityPath)) throw new Error(`Missing sensitivity report: ${sensitivityPath}`);
  const sensitivityText = readFileSync(sensitivityPath, 'utf8');
  const interval = /\| Skill vs MCP, requiring disabled staging \| (.+?) \|/.exec(sensitivityText)?.[1];
  if (!interval) throw new Error('Sensitivity report does not contain the staging-safe skill comparison');

  const approvalRecord = readJson<any>(join(repoRoot, 'runs', 'main', 'approval.json'), 'approval record');
  if (approvalRecord.approvedArm !== 'cli_skill' || approvalRecord.experiment?.status !== 'completed') throw new Error('Approval record does not show the completed cli_skill rollout');
  const afterShip = AFTER_SHIP_IDS.map((id) => readTrial(id, 'after-ship')).map((trial) => ({
    id: trial.trialId,
    template: trial.template,
    arm: trial.arm,
    correct: trial.correct,
    collateral: trial.collateral.length,
  }));
  if (afterShip.some((trial) => trial.arm !== 'cli_skill' || !trial.correct || trial.collateral !== 0)) throw new Error('After-ship archive does not show six clean cli_skill jobs');

  const allRecords = [...mainTrials, ...AFTER_SHIP_IDS.map((id) => readTrial(id, 'after-ship'))];
  const secrets = [...collectSecrets(allRecords)].filter((secret) => secret !== '');
  return {
    cases: selected.map(caseFromTrial),
    registered,
    strict: counts(mainTrials, true),
    strictInterval: interval,
    approval: {
      approvedArm: approvalRecord.approvedArm,
      approver: String(approvalRecord.approver ?? 'unknown'),
      status: String(approvalRecord.experiment.status),
      rolloutDecision: String(approvalRecord.experiment.rollout_decision),
    },
    afterShip,
    secrets,
  };
}

export function renderDemo(data: DemoData) {
  const result = (arm: DemoArm) => `${data.registered[arm].correct}/${data.registered[arm].total}`;
  const lines = [
    '# Interface Wars offline archive demo',
    'Recorded evidence only. No model calls, Flagsmith writes or network access.',
    '',
    '## The matched case',
    'All three rows are the archived `start_experiment` job for `apple_pay_copy test`.',
    '',
    '| Trial | Arm | Result | Turns | Calls | Errors | Input tokens | Cost | Time |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...data.cases.map((item) => `| ${item.id} | ${ARM_LABEL[item.arm]} | ${item.correct ? 'CORRECT' : 'WRONG'} | ${item.turns} | ${item.toolCalls} | ${item.toolErrors} | ${item.inputTokens.toLocaleString()} | $${item.costUsd.toFixed(4)} | ${item.seconds.toFixed(1)}s |`),
    '',
    ...data.cases.flatMap((item) => [
      `**${item.id} · ${ARM_LABEL[item.arm]} · ${item.template} · ${item.correct ? 'CORRECT' : 'WRONG'}**`,
      `Task: ${item.task}`,
      `Calls: ${item.callSummary}`,
      `Verifier: ${item.verifier}`,
      `Agent: ${item.agentSummary}`,
      '',
    ]),
    '## Two readings of the result',
    `Registered result: cli_skill WIN (${result('cli_skill')}), CLI INCONCLUSIVE (${result('cli')}), MCP ${result('mcp')}.`,
    `Strict staging-safe interpretation: mcp ${data.strict.mcp.correct}/${data.strict.mcp.total}, cli ${data.strict.cli.correct}/${data.strict.cli.total}, cli_skill ${data.strict.cli_skill.correct}/${data.strict.cli_skill.total}.`,
    `Skill vs MCP under the stricter interpretation: ${data.strictInterval} percentage points [95% template bootstrap interval].`,
    '',
    '## Human gate and closed loop',
    `Approval: ${data.approval.approver} approved ${data.approval.approvedArm}; experiment ${data.approval.status}, rollout_decision=${data.approval.rolloutDecision}.`,
    `After ship: ${data.afterShip.filter((item) => item.correct && item.collateral === 0).length}/${data.afterShip.length} jobs passed on cli_skill.`,
    ...data.afterShip.map((item) => `- ${item.id}: ${item.template}, ${ARM_LABEL[item.arm]}, ${item.correct && item.collateral === 0 ? 'CORRECT' : 'CHECK'}`),
    '',
  ];
  return redactText(lines.join('\n'), data.secrets) + '\n';
}
