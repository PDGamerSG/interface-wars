// Hard spend cap for real API calls. The ledger in runs/spend.local.json survives restarts, so resumed runs
// and failed trials count too. The agent loop checks the cap before every request; when it is reached the
// trial throws BudgetExceeded, nothing is recorded for it, and the runner stops taking new trials.
// The ledger is re-read on every check and write, so several runner processes at once share one total.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS } from '../lab/config.ts';

const LEDGER = join(RUNS, 'spend.local.json');
export const CAP_USD = Number(process.env.IW_MAX_SPEND_USD || Infinity);

export class BudgetExceeded extends Error {}

function read(): { totalUsd: number; calls: number } {
  if (!existsSync(LEDGER)) return { totalUsd: 0, calls: 0 };
  const data = JSON.parse(readFileSync(LEDGER, 'utf8'));
  return { totalUsd: Number(data.totalUsd ?? 0), calls: Number(data.calls ?? 0) };
}

export function spentUsd() {
  return read().totalUsd;
}

export function checkBudget() {
  const spent = read().totalUsd;
  if (spent >= CAP_USD) throw new BudgetExceeded(`Spend cap reached: $${spent.toFixed(4)} spent, cap $${CAP_USD}.`);
}

export function recordSpend(usd: number) {
  const current = read();
  const totalUsd = current.totalUsd + usd;
  writeFileSync(LEDGER, JSON.stringify({ totalUsd: Number(totalUsd.toFixed(6)), calls: current.calls + 1, capUsd: CAP_USD, updatedAt: new Date().toISOString() }, null, 2));
}
