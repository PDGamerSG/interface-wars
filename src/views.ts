// Terminal views of recorded trials, for reading results and for screen recordings.
//   node src/cli.ts show main-0024              one trial: task, every tool call, the state diff, the verdict
//   node src/cli.ts compare create_metric        the same job across the three arms
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS } from './lab/config.ts';
import { TEMPLATES } from './jobs/catalog.ts';
import type { TrialRecord } from './trial.ts';
import type { ArmName } from './arms/types.ts';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'), cyan: paint('36') };
const ARM_LABEL: Record<ArmName, string> = { mcp: 'MCP server', cli: 'CLI', cli_skill: 'CLI + skill' };

const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
};
const usd = (x: number) => `$${x.toFixed(4)}`;
const tokensIn = (t: TrialRecord) => {
  const u = t.usage as { input: number; cacheRead: number; cacheWrite: number };
  return u.input + u.cacheRead + u.cacheWrite;
};

function findTrial(id: string): TrialRecord {
  for (const run of readdirSync(RUNS)) {
    const file = join(RUNS, run, 'trials', `${id}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  }
  throw new Error(`No trial ${id} under runs/*/trials/.`);
}

function loadRun(run: string): TrialRecord[] {
  const dir = join(RUNS, run, 'trials');
  if (!existsSync(dir)) throw new Error(`No trials for run ${run}.`);
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function callLabel(name: string, input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash' && typeof i.command === 'string') return `$ ${i.command}`;
  return `${name} ${JSON.stringify(i)}`;
}

const verdict = (t: TrialRecord) => (t.correct ? c.green('CORRECT') : c.red('WRONG'));

export function showTrial(id: string, opts: { full?: boolean } = {}) {
  const t = findTrial(id);
  const width = opts.full ? 4000 : 160;
  const out: string[] = [];
  out.push(c.bold(`${t.trialId}  ${ARM_LABEL[t.arm]}  ${t.template}${t.heldOut ? ' (held out)' : ''}  ${verdict(t)}`));
  out.push(c.dim(`${t.model} · ${t.turns} turns · ${t.toolCalls} tool calls (${t.toolErrors} errors) · ${tokensIn(t).toLocaleString()} input tokens · ${usd(t.costUsd)} · ${(t.ms / 1000).toFixed(1)} s`));
  out.push('', c.bold('Task'), t.task, '');
  for (const turn of t.transcript as any[]) {
    if (turn.text) out.push(c.cyan(`[${turn.turn}] `) + oneLine(turn.text, width));
    for (const call of turn.calls) {
      out.push(`    ${call.isError ? c.red('✗') : c.dim('→')} ${oneLine(callLabel(call.name, call.input), width)}`);
      const first = oneLine(call.output, opts.full ? 4000 : 140);
      out.push(`      ${call.isError ? c.red(first) : c.dim(first)}`);
    }
  }
  out.push('', c.bold('State diff (verifier)'));
  if (t.changes.length === 0) out.push(c.dim('  no changes'));
  const collateral = new Set(t.collateral.map((x) => x.path));
  for (const ch of t.changes) {
    const mark = collateral.has(ch.path) ? c.red('OUT OF SCOPE') : c.green('in scope');
    out.push(`  ${ch.path}: ${oneLine(JSON.stringify(ch.before), 60)} → ${oneLine(JSON.stringify(ch.after), 60)}  ${mark}`);
  }
  if (t.reasons.length) {
    out.push('', c.bold('Checks that failed'));
    for (const r of t.reasons) out.push(`  ${c.red('✗')} ${r}`);
  }
  out.push('', c.bold('Agent said'), `  ${oneLine(t.finalText, opts.full ? 4000 : 300)}`);
  if (!t.correct && /^\s*DONE/m.test(t.finalText) && !/^\s*DONE\?/m.test(t.finalText)) out.push(c.yellow('  The agent claimed DONE but the verifier found the job not done.'));
  console.log(out.join('\n'));
}

export function compareJob(template: string, opts: { run?: string; pick?: 'first' | 'failed' | 'correct' } = {}) {
  if (!TEMPLATES.some((x) => x.id === template)) throw new Error(`Unknown template ${template}. One of: ${TEMPLATES.map((x) => x.id).join(', ')}`);
  const trials = loadRun(opts.run ?? 'main').filter((t) => t.template === template);
  const arms: ArmName[] = ['mcp', 'cli', 'cli_skill'];
  const chosen = arms.map((arm) => {
    const mine = trials.filter((t) => t.arm === arm);
    const pick = opts.pick === 'failed' ? mine.find((t) => !t.correct) : opts.pick === 'correct' ? mine.find((t) => t.correct) : undefined;
    return { arm, all: mine, trial: pick ?? mine[0] };
  });
  const out: string[] = [];
  const tpl = TEMPLATES.find((x) => x.id === template)!;
  out.push(c.bold(`${template}  (${tpl.family}${tpl.heldOut ? ', held out' : ''})  run ${opts.run ?? 'main'}`), '');
  out.push(c.bold('Arm           Correct   Turns  Calls  Errors  Input tokens      Cost    Time'));
  for (const { arm, all, trial } of chosen) {
    if (!trial) { out.push(`${ARM_LABEL[arm].padEnd(13)} no trials`); continue; }
    const rate = `${all.filter((t) => t.correct).length}/${all.length}`;
    out.push(
      `${ARM_LABEL[arm].padEnd(13)} ${rate.padStart(7)}   ${String(trial.turns).padStart(5)}  ${String(trial.toolCalls).padStart(5)}  ` +
      `${String(trial.toolErrors).padStart(6)}  ${tokensIn(trial).toLocaleString().padStart(12)}  ${usd(trial.costUsd).padStart(8)}  ${(trial.ms / 1000).toFixed(1).padStart(5)} s`,
    );
  }
  out.push(c.dim('Correct counts every trial of this job in the run; the other columns are for the trial shown below.'), '');
  const task = chosen.find((x) => x.trial)?.trial?.task;
  if (task) out.push(c.bold('Task (same for every arm, names differ per trial)'), `  ${task}`, '');
  for (const { arm, trial } of chosen) {
    if (!trial) continue;
    out.push(c.bold(`${ARM_LABEL[arm]} · ${trial.trialId} · ${trial.correct ? c.green('CORRECT') : c.red('WRONG')}`));
    for (const turn of trial.transcript as any[]) {
      for (const call of turn.calls) out.push(`  ${call.isError ? c.red('✗') : c.dim('→')} ${oneLine(callLabel(call.name, call.input), 150)}`);
    }
    if (!trial.correct && trial.reasons.length) out.push(`  ${c.red('verifier:')} ${oneLine(trial.reasons.join('; '), 150)}`);
    out.push(`  ${c.dim('said:')} ${oneLine(trial.finalText, 150)}`, '');
  }
  console.log(out.join('\n'));
}
