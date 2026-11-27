// Operational flags: Flagsmith also runs the harness. Two flags in the control project, read by the runner before
// every trial, so an operator can stop or cap a run from the Flagsmith dashboard without touching the machine:
//   trials_enabled  kill switch. Turn it off and the runner starts no new trial (running trials finish).
//   spend_cap_usd   remote config. A number; the runner stops when total real spend reaches it. The lower of this
//                   value and IW_MAX_SPEND_USD wins, so the dashboard can only tighten the cap set on the machine.
// The runner reads them from the Flags API with the server-side key, like any service reads its flags.
import { createAdmin } from '../flagsmith/admin.ts';
import { FLAGSMITH_URL, readLab } from '../lab/config.ts';

export const KILL_SWITCH = 'trials_enabled';
export const SPEND_CAP = 'spend_cap_usd';

export type OpsFlags = { trialsEnabled: boolean; spendCapUsd: number | null; source: 'flagsmith' | 'unavailable' };

function admin() {
  const lab = readLab();
  return { lab, admin: createAdmin(FLAGSMITH_URL, { kind: 'token', value: lab.admin.token }) };
}

// Creates the two flags in the control project if they are missing. Safe to run again.
export async function ensureOpsFlags(defaultCapUsd = 15) {
  const { lab, admin: a } = admin();
  const p = lab.control.projectId;
  const existing = await a.list(`/api/v1/projects/${p}/features/`);
  const names = new Set(existing.map((f: { name: string }) => f.name));
  const created: string[] = [];
  if (!names.has(KILL_SWITCH)) {
    await a.post(`/api/v1/projects/${p}/features/`, {
      name: KILL_SWITCH,
      description: 'Kill switch for agent trials. Off: the runner starts no new trial; trials already running finish.',
      default_enabled: true,
    });
    created.push(KILL_SWITCH);
  }
  if (!names.has(SPEND_CAP)) {
    await a.post(`/api/v1/projects/${p}/features/`, {
      name: SPEND_CAP,
      description: 'Remote config: total real API spend in USD at which the runner stops. Can only lower the cap set on the machine.',
      initial_value: String(defaultCapUsd),
      default_enabled: true,
    });
    created.push(SPEND_CAP);
  }
  return { created, ...(await readOpsFlags()) };
}

// Reads the flags. If Flagsmith cannot be reached, trials stay enabled and only the machine's cap applies, and the
// caller is told so; the experiment itself cannot run without Flagsmith anyway.
export async function readOpsFlags(): Promise<OpsFlags> {
  try {
    const lab = readLab();
    const res = await fetch(`${FLAGSMITH_URL}/api/v1/flags/`, { headers: { 'X-Environment-Key': lab.control.serverKey } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const flags = (await res.json()) as any[];
    const get = (name: string) => flags.find((f) => f.feature?.name === name);
    const kill = get(KILL_SWITCH);
    const cap = get(SPEND_CAP);
    const capValue = cap?.enabled ? Number(cap.feature_state_value) : NaN;
    return {
      trialsEnabled: kill ? Boolean(kill.enabled) : true,
      spendCapUsd: Number.isFinite(capValue) && capValue >= 0 ? capValue : null,
      source: 'flagsmith',
    };
  } catch {
    return { trialsEnabled: true, spendCapUsd: null, source: 'unavailable' };
  }
}

// Flips the kill switch in the control environment, as an operator would in the dashboard.
export async function setTrialsEnabled(enabled: boolean) {
  const { lab, admin: a } = admin();
  const states = await a.list(`/api/v1/environments/${lab.control.environmentKey}/featurestates/`);
  const features = await a.list(`/api/v1/projects/${lab.control.projectId}/features/`);
  const feature = features.find((f: { name: string }) => f.name === KILL_SWITCH);
  if (!feature) throw new Error(`No ${KILL_SWITCH} flag. Run: node src/cli.ts ops:setup`);
  const state = states.find((s: any) => s.feature === feature.id && s.feature_segment === null && s.identity === null);
  if (!state) throw new Error(`No environment state for ${KILL_SWITCH}`);
  await a.patch(`/api/v1/environments/${lab.control.environmentKey}/featurestates/${state.id}/`, { enabled });
  return readOpsFlags();
}
