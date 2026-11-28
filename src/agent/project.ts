// Linked worktrees share the original checkout's lab credentials, billing ledger and paid-run lock.
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from '../lab/config.ts';

export function projectRuns(root = ROOT) {
  const list = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' });
  const first = list.split('\0')[0];
  if (!first.startsWith('worktree ')) throw new Error('Cannot locate the primary checkout for project billing');
  return join(first.slice('worktree '.length), 'runs');
}

export function writeJson(path: string, value: unknown) {
  const temp = path + '.writing-' + process.pid;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flush: true });
  renameSync(temp, path);
}

// SQLite releases its OS lock on a crash. A transaction is held throughout the batch, including API waits.
export function lockProject(dir = projectRuns()) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'paid-lock.local.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE');
    return () => db.close();
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === 5) throw new Error('Another Interface Wars coordinator holds the project lock');
    throw error;
  }
}
