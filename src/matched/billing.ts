// A full 1,048,576-token request at the expensive Haiku cache-write rate, plus the full output allowance.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BudgetExceeded, readSpend } from '../agent/budget.ts';
import { writeJson } from '../agent/project.ts';
import { costOf } from '../agent/loop.ts';
import type { OpsFlags } from '../experiment/ops.ts';
import { manifest, design } from './study.ts';

export const MAX_REQUEST_USD = costOf(manifest.model.id, { input: 0, cacheRead: 0, cacheWrite: 1_048_576, output: 16_000 });
const usd = (x: number) => Number(x.toFixed(9));

export function matchedCap(ops: OpsFlags, machine = Number(process.env.IW_MAX_SPEND_USD ?? design.projectCapUsd)) {
  if (ops.source !== 'flagsmith' || !ops.trialsEnabled) throw new Error('Project trials paused or ops flags unavailable');
  if (!Number.isFinite(machine) || machine < 0) throw new Error('Invalid project cap');
  return Math.min(design.projectCapUsd, machine, ops.spendCapUsd ?? Infinity);
}

export function settleReservation(path: string, nonce: string, actual: number, billed = true) {
  const ledger = readSpend(path);
  const matched = ledger.matched;
  const pending = matched?.pending;
  if (!pending || !matched || nonce !== pending.nonce) throw new Error('Reservation nonce does not match the ledger');
  if (!Number.isFinite(actual) || actual < 0 || actual > pending.reserveUsd) throw new Error('Invalid settlement amount');
  matched.totals[pending.trialId] = usd((matched.totals[pending.trialId] ?? 0) + actual);
  delete matched.pending;
  writeJson(path, { ...ledger, totalUsd: usd(ledger.totalUsd + actual), calls: ledger.calls + Number(billed), updatedAt: new Date().toISOString() });
}

export function trialBilling(path: string, trialId: string, cap: number) {
  let nonce = '';
  function read() {
    if (!existsSync(path)) throw new Error('Missing authoritative project spend ledger');
    const ledger = readSpend(path);
    ledger.matched ??= { totals: {} };
    return ledger;
  }
  return {
    total: () => read().matched!.totals[trialId] ?? 0,
    reserve() {
      const ledger = read();
      const matched = ledger.matched!;
      if (matched.pending) throw new BudgetExceeded('Unresolved billing reservation ' + matched.pending.nonce);
      const studySpend = Object.values(matched.totals).reduce((sum, v) => sum + v, 0);
      if (!Number.isFinite(studySpend) || !Number.isFinite(cap) || usd(studySpend + MAX_REQUEST_USD) > manifest.budget.maxUsd ||
          usd(ledger.totalUsd + MAX_REQUEST_USD) > Math.min(cap, design.projectCapUsd)) {
        throw new BudgetExceeded('Insufficient headroom to reserve a full request against the matched or project cap');
      }
      nonce = randomUUID();
      matched.pending = { trialId, nonce, reserveUsd: MAX_REQUEST_USD };
      writeJson(path, ledger);
    },
    settle(actual: number) { settleReservation(path, nonce, actual); },
    rejected(error: unknown) {
      // A definitive request rejection has no billable response. Other errors leave the reservation held.
      const status = Number((error as { status?: number })?.status);
      if (status >= 400 && status < 500 && status !== 408) settleReservation(path, nonce, 0, false);
    },
  };
}
