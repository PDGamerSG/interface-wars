// A deterministic, redacted SQLite projection of trial records.
// The query side opens the file read-only and exposes named recipes only.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNS } from '../lab/config.ts';
import { localCredentials, redactCredentials } from './redact.ts';
import type { TrialRecord } from '../trial.ts';

type EvidenceCall = { name: string; input: unknown; output: string; isError: boolean; ms: number };
type EvidenceTurn = { turn: number; text: string; calls: EvidenceCall[]; usage: unknown; costUsd: number; stopReason: string | null };

const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
const DEFAULT_OUTPUT = join(RUNS, 'main', 'evidence.sqlite');

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

// Retain the field-aware helper for callers inspecting one evidence value.
export function redact(value: unknown, key = '', secrets = localCredentials()): unknown {
  return redactCredentials({ [key]: value }, secrets)[key];
}

function trialFiles(run: string) {
  const dir = join(RUNS, run, 'trials');
  if (!existsSync(dir)) throw new Error(`No trials for ${run}`);
  return readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => ({ file, path: join(dir, file) }));
}

export function buildEvidence(run = 'main', output = join(RUNS, run, 'evidence.sqlite')) {
  const files = trialFiles(run);
  mkdirSync(join(output, '..'), { recursive: true });
  rmSync(output, { force: true });
  const db = new DatabaseSync(output, { enableForeignKeyConstraints: true });
  db.exec(SCHEMA);
  const metadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  metadata.run('run', run);
  metadata.run('schema_version', '1');
  metadata.run('determinism_epoch', new Date(0).toISOString());
  const insertTrial = db.prepare(`INSERT INTO trials
    (trial_id, source_file, source_sha256, trial_index, arm, template, family, held_out, correct, outcome, final_text, cost_usd, tool_calls, tool_errors, turns, ms, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertTurn = db.prepare(`INSERT INTO turns (trial_id, turn_index, text, usage_json, cost_usd, stop_reason, source_pointer) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertCall = db.prepare(`INSERT INTO calls (trial_id, turn_index, call_index, name, input_json, output, is_error, ms, source_pointer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertChange = db.prepare(`INSERT INTO changes (trial_id, change_index, path, before_json, after_json, source_pointer) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertReason = db.prepare(`INSERT INTO reasons (trial_id, reason_index, reason, source_pointer) VALUES (?, ?, ?, ?)`);
  const secrets = localCredentials();
  for (const { file, path } of files) {
    const raw = readFileSync(path);
    const trial = redactCredentials(JSON.parse(raw.toString()) as TrialRecord, secrets);
    const source = `runs/${run}/trials/${file}`;
    const digest = sha256(raw);
    insertTrial.run(trial.trialId, source, digest, trial.index, trial.arm, trial.template, trial.family, Number(trial.heldOut), Number(trial.correct), trial.outcome, trial.finalText, trial.costUsd, trial.toolCalls, trial.toolErrors, trial.turns, trial.ms, trial.startedAt);
    for (const [turnIndex, turn] of (trial.transcript as EvidenceTurn[]).entries()) {
      insertTurn.run(trial.trialId, turnIndex, turn.text, JSON.stringify(turn.usage), turn.costUsd, turn.stopReason, `/transcript/${turnIndex}`);
      for (const [callIndex, call] of turn.calls.entries()) {
        insertCall.run(trial.trialId, turnIndex, callIndex, call.name, JSON.stringify(call.input), call.output, Number(call.isError), call.ms, `/transcript/${turnIndex}/calls/${callIndex}`);
      }
    }
    for (const [changeIndex, change] of trial.changes.entries()) insertChange.run(trial.trialId, changeIndex, change.path, JSON.stringify(change.before), JSON.stringify(change.after), `/changes/${changeIndex}`);
    for (const [reasonIndex, reason] of trial.reasons.entries()) insertReason.run(trial.trialId, reasonIndex, reason, `/reasons/${reasonIndex}`);
  }
  db.close();
  return { output, trials: files.length, sha256: sha256(readFileSync(output)) };
}

export function openEvidence(path = DEFAULT_OUTPUT) {
  if (!existsSync(path)) throw new Error(`No evidence index at ${path}. Build it with: node scripts/evidence.ts build main`);
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  db.exec('PRAGMA query_only = ON');
  return db;
}

export function matrix(path = DEFAULT_OUTPUT) {
  const db = openEvidence(path);
  const rows = db.prepare(`SELECT CASE WHEN tool_errors > 0 THEN 1 ELSE 0 END AS tool_errors, correct, COUNT(*) AS trials FROM trials GROUP BY CASE WHEN tool_errors > 0 THEN 1 ELSE 0 END, correct ORDER BY tool_errors, correct`).all() as { tool_errors: number; correct: number; trials: number }[];
  db.close();
  return rows;
}

export function schemaFailures(path = DEFAULT_OUTPUT) {
  const db = openEvidence(path);
  const row = db.prepare(`SELECT COUNT(*) AS create_metric_calls,
    SUM(CASE WHEN input_json LIKE '%definition%' THEN 1 ELSE 0 END) AS calls_with_definition_input,
    SUM(CASE WHEN is_error = 1 AND output LIKE '%definition%' THEN 1 ELSE 0 END) AS required_definition_errors,
    COUNT(DISTINCT trial_id) AS trials,
    COUNT(DISTINCT CASE WHEN correct = 1 THEN trial_id END) AS correct_trials
    FROM calls JOIN trials USING (trial_id)
    WHERE template = 'create_metric' AND arm = 'mcp' AND name = 'create_metric'`).get() as Record<string, number>;
  db.close();
  return row;
}

export function recoveries(path = DEFAULT_OUTPUT) {
  const db = openEvidence(path);
  const row = db.prepare(`SELECT COUNT(*) AS recovered_trials FROM trials WHERE tool_errors > 0 AND correct = 1`).get() as { recovered_trials: number };
  const ids = db.prepare(`SELECT trial_id FROM trials WHERE tool_errors > 0 AND correct = 1 ORDER BY trial_id`).all() as { trial_id: string }[];
  db.close();
  return { recovered_trials: row.recovered_trials, trial_ids: ids.map((item) => item.trial_id) };
}

export function explain(trialId: string, path = DEFAULT_OUTPUT) {
  const db = openEvidence(path);
  const trial = db.prepare('SELECT * FROM trials WHERE trial_id = ?').get(trialId);
  if (!trial) { db.close(); throw new Error(`Unknown trial ${trialId}`); }
  const calls = db.prepare('SELECT turn_index, call_index, name, input_json, output, is_error, ms, source_pointer FROM calls WHERE trial_id = ? ORDER BY turn_index, call_index').all(trialId);
  const changes = db.prepare('SELECT change_index, path, before_json, after_json, source_pointer FROM changes WHERE trial_id = ? ORDER BY change_index').all(trialId);
  const reasons = db.prepare('SELECT reason_index, reason, source_pointer FROM reasons WHERE trial_id = ? ORDER BY reason_index').all(trialId);
  db.close();
  return { trial, calls, changes, reasons };
}
