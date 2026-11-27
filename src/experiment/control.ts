// The experiment control plane, in the control organisation (never reachable by agents).
// Flagsmith assigns each trial to an arm through the multivariate flag `agent_interface`, records the
// exposure, receives the outcome events, and computes the Bayesian results.
import { Flagsmith } from '@flagsmith/nodejs';
import { createAdmin } from '../flagsmith/admin.ts';
import { FLAGSMITH_URL, readLab, writeLab } from '../lab/config.ts';
import type { ArmName } from '../arms/types.ts';

export const FLAG = 'agent_interface';
export const EXPERIMENT_NAME = 'Which interface should agents use to operate Flagsmith?';
export const HYPOTHESIS =
  'For Claude agents doing real Flagsmith jobs, the Flagsmith CLI plus an Agent Skill (cli_skill) completes more jobs ' +
  'correctly than the official Flagsmith MCP server (control), without fewer change-scoped runs and without higher cost per job.';

export const METRICS = [
  { name: 'job_correct', event: 'job_correct', aggregation: 'occurrence', direction: 'up', expected: 'increase', role: 'primary' },
  // Safety guardrail, phrased positively: Flagsmith only computes inference once each variant has at least
  // 5 conversions, so a rare "collateral" event would never get a result. "No collateral" is common.
  { name: 'no_collateral', event: 'no_collateral', aggregation: 'occurrence', direction: 'up', expected: 'not_decrease', role: 'guardrail' },
  { name: 'cost_usd', event: 'cost_usd', aggregation: 'mean', direction: 'down', expected: 'not_increase', role: 'guardrail' },
] as const;

function controlAdmin() {
  const lab = readLab();
  return { lab, admin: createAdmin(FLAGSMITH_URL, { kind: 'token', value: lab.admin.token }) };
}

export async function setupExperiment() {
  const { lab, admin } = controlAdmin();
  if (lab.experiment) return lab.experiment;
  const p = lab.control.projectId;
  const envKey = lab.control.environmentKey;

  const feature = await admin.post(`/api/v1/projects/${p}/features/`, {
    name: FLAG,
    type: 'MULTIVARIATE',
    description: 'Which interface an AI agent uses to operate Flagsmith. Control: the official MCP server.',
    initial_value: 'mcp',
    default_enabled: true,
    multivariate_options: [
      { type: 'unicode', string_value: 'cli', default_percentage_allocation: 0 },
      { type: 'unicode', string_value: 'cli_skill', default_percentage_allocation: 0 },
    ],
  });
  const optionIds: Record<string, number> = {};
  for (const o of feature.multivariate_options) {
    // Without a key, Flagsmith's results label the variation with an empty string.
    await admin.put(`/api/v1/projects/${p}/features/${feature.id}/mv-options/${o.id}/`, { ...o, key: o.string_value, feature: feature.id });
    optionIds[o.string_value] = o.id;
  }

  const metricIds: Record<string, number> = {};
  for (const m of METRICS) {
    const created = await admin.post(`/api/v1/environments/${envKey}/experiment-metrics/`, {
      name: m.name, description: `${m.role} metric`, aggregation: m.aggregation, direction: m.direction,
      definition: { version: 1, event: m.event },
    });
    metricIds[m.name] = created.id;
  }

  const experiment = await admin.post(`/api/v1/environments/${envKey}/experiments/`, {
    feature: feature.id,
    name: EXPERIMENT_NAME,
    hypothesis: HYPOTHESIS,
    metrics: METRICS.map((m) => ({ metric: metricIds[m.name], expected_direction: m.expected })),
    experiment_rollout: {
      enabled: true,
      rollout_percentage: 100,
      feature_state_value: { type: 'string', value: 'mcp' },
      multivariate_feature_state_values: [
        { multivariate_feature_option: optionIds.cli, percentage_allocation: 33.33 },
        { multivariate_feature_option: optionIds.cli_skill, percentage_allocation: 33.33 },
      ],
    },
  });
  lab.experiment = { featureId: feature.id, experimentId: experiment.id, metricIds, optionIds };
  writeLab(lab);
  return lab.experiment;
}

export async function startExperiment() {
  const { lab, admin } = controlAdmin();
  const x = lab.experiment ?? (await setupExperiment());
  return admin.post(`/api/v1/environments/${lab.control.environmentKey}/experiments/${x.experimentId}/start/`, {});
}

export async function experimentState() {
  const { lab, admin } = controlAdmin();
  if (!lab.experiment) return null;
  return admin.get(`/api/v1/environments/${lab.control.environmentKey}/experiments/${lab.experiment.experimentId}/`);
}

export async function refreshAndFetchResults() {
  const { lab, admin } = controlAdmin();
  const base = `/api/v1/environments/${lab.control.environmentKey}/experiments/${lab.experiment!.experimentId}`;
  for (const what of ['exposures', 'results']) {
    await admin.post(`${base}/${what}/refresh/`, {}).catch((e: any) => {
      if (e.status !== 429) throw e;
    });
  }
  // Results are computed by the task processor; poll until a fresh payload lands.
  for (let i = 0; i < 150; i++) {
    const results = await admin.get(`${base}/results/`);
    const exposures = await admin.get(`${base}/exposures/`);
    const r = results.results;
    if (r?.payload && r.as_of && (!r.refresh_requested_at || r.as_of >= r.refresh_requested_at)) return { results: r, exposures: exposures.exposures };
    await new Promise((res) => setTimeout(res, 2000));
  }
  const results = await admin.get(`${base}/results/`);
  const exposures = await admin.get(`${base}/exposures/`);
  return { results: results.results, exposures: exposures.exposures };
}

export async function completeExperiment(winner: ArmName) {
  const { lab, admin } = controlAdmin();
  const x = lab.experiment!;
  const body = winner === 'mcp'
    ? { rollout_decision: 'control' }
    : { rollout_decision: 'variant', rollout_variant: x.optionIds[winner] };
  return admin.post(`/api/v1/environments/${lab.control.environmentKey}/experiments/${x.experimentId}/complete/`, body);
}

// SDK side: assignment (records the exposure) and outcome events, exactly as an app would send them.
export function createAssigner() {
  const lab = readLab();
  const sdk = new Flagsmith({
    environmentKey: lab.control.serverKey,
    apiUrl: FLAGSMITH_URL + '/api/v1/',
    enableEvents: true,
    eventProcessorConfig: { eventsApiUrl: FLAGSMITH_URL + '/api/' },
  } as any);
  return {
    async assign(trialId: string): Promise<ArmName> {
      let flag: any;
      for (let attempt = 0; ; attempt++) {
        try {
          flag = await (sdk as any).getExperimentFlag(FLAG, trialId);
          break;
        } catch (error) {
          if (attempt >= 4) throw error;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      const value = String(flag.value ?? 'mcp');
      if (value !== 'mcp' && value !== 'cli' && value !== 'cli_skill') throw new Error(`Unexpected arm ${value}`);
      return value;
    },
    track(event: string, trialId: string, value?: number) {
      (sdk as any).trackEvent(event, value === undefined ? { identifier: trialId } : { identifier: trialId, value });
    },
    async flush() {
      await (sdk as any).flushEvents?.();
    },
    async close() {
      await (sdk as any).flushEvents?.();
      await (sdk as any).close?.();
    },
  };
}
