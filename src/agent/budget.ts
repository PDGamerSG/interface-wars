// Hard spend cap for real API calls. The ledger in runs/spend.local.json survives restarts, so resumed runs
// and failed trials count too. The agent loop checks the cap before every request; when it is reached the
// trial throws BudgetExceeded, nothing is recorded for it, and the runner stops taking new trials.
// The ledger is re-read on every check and write, so several runner processes at once share one total.
// The cap is the lower of IW_MAX_SPEND_USD on the machine and the spend_cap_usd flag in Flagsmith
// (src/experiment/ops.ts), which the runner refreshes before every trial.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS } from '../lab/config.ts';

const LEDGER = join(RUNS, 'spend.local.json');
export const CAP_USD = Number(process.env.IW_MAX_SPEND_USD || Infinity);
let remoteCapUsd: number | null = null;

export class BudgetExceeded extends Error {}

function read(): { totalUsd: number; calls: number } {
  if (!existsSync(LEDGER)) return { totalUsd: 0, calls: 0 };
  const data = JSON.parse(readFileSync(LEDGER, 'utf8'));
  return { totalUsd: Number(data.totalUsd ?? 0), calls: Number(data.calls ?? 0) };
}

// The cap in force: the machine's cap, lowered by Flagsmith's spend_cap_usd when that is set.
export function capUsd() {
  return remoteCapUsd === null ? CAP_USD : Math.min(CAP_USD, remoteCapUsd);
}

export function setRemoteCap(usd: number | null) {
  remoteCapUsd = usd;
}

export function spentUsd() {
  return read().totalUsd;
}

export function checkBudget() {
  const spent = read().totalUsd;
  const cap = capUsd();
  if (spent >= cap) {
    const from = remoteCapUsd !== null && remoteCapUsd < CAP_USD ? ' (spend_cap_usd in Flagsmith)' : '';
    throw new BudgetExceeded(`Spend cap reached: $${spent.toFixed(4)} spent, cap $${cap}${from}.`);
  }
}

export function recordSpend(usd: number) {
  const current = read();
  const totalUsd = current.totalUsd + usd;
  writeFileSync(LEDGER, JSON.stringify({ totalUsd: Number(totalUsd.toFixed(6)), calls: current.calls + 1, capUsd: capUsd(), updatedAt: new Date().toISOString() }, null, 2));
}
