// Hard spend cap for real API calls. The ledger in runs/spend.local.json survives restarts, so resumed runs
// and failed trials count too. The agent loop checks the cap before every request; when it is reached the
// trial throws BudgetExceeded, nothing is recorded for it, and the runner stops taking new trials.
// The ledger is re-read on every check and write, so several runner processes at once share one total.
// The cap is the lower of IW_MAX_SPEND_USD on the machine and the spend_cap_usd flag in Flagsmith
// (src/experiment/ops.ts), which the runner refreshes before every trial.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRuns, writeJson } from './project.ts';

const ledgerPath = () => join(projectRuns(), 'spend.local.json');
export const CAP_USD = Number(process.env.IW_MAX_SPEND_USD || Infinity);
let remoteCapUsd: number | null = null;

export class BudgetExceeded extends Error {}

export type SpendLedger = {
  totalUsd: number; calls: number; capUsd?: number | null; updatedAt?: string;
  matched?: { totals: Record<string, number>; pending?: { trialId: string; nonce: string; reserveUsd: number } };
};

export function readSpend(path = ledgerPath()): SpendLedger {
  if (!existsSync(path)) return { totalUsd: 0, calls: 0 };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Number.isFinite(data.totalUsd) || data.totalUsd < 0 || !Number.isInteger(data.calls) || data.calls < 0) {
    throw new Error('Invalid project spend ledger');
  }
  return data;
}

// The cap in force: the machine's cap, lowered by Flagsmith's spend_cap_usd when that is set.
export function capUsd() {
  return remoteCapUsd === null ? CAP_USD : Math.min(CAP_USD, remoteCapUsd);
}

export function setRemoteCap(usd: number | null) {
  remoteCapUsd = usd;
}

export function spentUsd() {
  return readSpend().totalUsd;
}

export function checkBudget() {
  const ledger = readSpend();
  if (ledger.matched?.pending) throw new BudgetExceeded('Unresolved matched-study billing reservation');
  const spent = ledger.totalUsd;
  const cap = capUsd();
  if (spent >= cap) {
    const from = remoteCapUsd !== null && remoteCapUsd < CAP_USD ? ' (spend_cap_usd in Flagsmith)' : '';
    throw new BudgetExceeded(`Spend cap reached: $${spent.toFixed(4)} spent, cap $${cap}${from}.`);
  }
}

export function recordSpend(usd: number) {
  const current = readSpend();
  const totalUsd = current.totalUsd + usd;
  writeJson(ledgerPath(), { ...current, totalUsd: Number(totalUsd.toFixed(9)), calls: current.calls + 1, capUsd: capUsd(), updatedAt: new Date().toISOString() });
}
