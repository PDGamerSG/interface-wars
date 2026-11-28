// Flagsmith CLI v2 is the only transport. Keep environment keys and raw command diagnostics out of receipts.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ReleaseAdapter, ReleaseState } from './gate.ts';

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw Error(`Set ${name} for this operation.`);
  return value;
}

function numberValue(value: unknown) {
  return typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
}

type Detail = {
  id: number; status: string; hypothesis: string;
  feature: { id: number; name: string; multivariate_options: { id: number; string_value: string | null; integer_value: number | null; boolean_value: boolean | null }[] };
  metrics: { metric: number; expected_direction: string }[];
  experiment_rollout: {
    enabled: boolean; rollout_percentage: number; feature_state_value: { type: string; value: string };
    multivariate_feature_state_values: { multivariate_feature_option: number; percentage_allocation: number }[];
    audience: { match: string; segments: { id: number; deleted: boolean }[] };
  } | null;
};

export function flagsmithAdapter(experimentId: number, baseline?: ReleaseState): ReleaseAdapter {
  if (!Number.isSafeInteger(experimentId) || experimentId < 1) throw Error('Use a positive integer experiment ID.');
  const url = new URL(requiredEnv('FLAGSMITH_API_URL'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw Error('Use the base URL for the self-hosted Flagsmith deployment.');
  const server = url.href.replace(/\/+$/, '');
  const environment = requiredEnv('FLAGSMITH_ENVIRONMENT');
  const envPath = 'api/v1/environments/' + encodeURIComponent(environment) + '/';
  const base = envPath + 'experiments/' + experimentId + '/';

  function cli<T>(args: string[], body?: unknown): T {
    const result = spawnSync('flagsmith', ['--no-input', '--api-url', server, '--sdk-api-url', server, ...args], {
      input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) throw Error(`Flagsmith CLI ${args[0]} failed (${result.status ?? result.signal ?? result.error?.name}). Inspect the target before retrying.`);
    return JSON.parse(result.stdout);
  }

  return {
    async read() {
      const env = cli<{ id: number; project: number }>(['api', envPath, '--jq', '{id,project}']);
      const x = cli<Detail>(['api', base]);
      const r = x.experiment_rollout;
      if (x.id !== experimentId || !r || r.audience.segments.some(s => s.deleted))
        throw Error('The experiment needs an available rollout and audience.');
      return {
        target: { server, environmentId: env.id, projectId: env.project, experimentId, featureId: x.feature.id, feature: x.feature.name },
        status: x.status, hypothesis: x.hypothesis,
        metrics: x.metrics.map(m => ({ id: m.metric, direction: m.expected_direction })).sort((a, b) => a.id - b.id),
        rollout: {
          enabled: r.enabled, percentage: Number(r.rollout_percentage), control: r.feature_state_value,
          variants: r.multivariate_feature_state_values.map(v => {
            const option = x.feature.multivariate_options.find(o => o.id === v.multivariate_feature_option);
            if (!option) throw Error('Unknown variant in experiment read-back.');
            return { id: option.id, weight: Number(v.percentage_allocation), value: option.string_value ?? option.integer_value ?? option.boolean_value };
          }).sort((a, b) => a.id - b.id),
          audience: { match: r.audience.match, segmentIds: r.audience.segments.map(s => s.id).sort((a, b) => a - b) },
        },
      };
    },
    async policy() {
      const flags = cli<{ permit: { enabled: boolean } | null; cap: { enabled: boolean; value: unknown } | null }>([
        'evaluate', '--jq', '{permit:.flags.release_ops_enabled,cap:.flags.release_spend_cap_usd}',
      ]);
      const ledger = JSON.parse(readFileSync(requiredEnv('IW_RELEASE_SPEND_FILE'), 'utf8'));
      return { permitted: flags.permit?.enabled === true, remoteCapUsd: flags.cap?.enabled ? numberValue(flags.cap.value) : NaN,
        localCapUsd: numberValue(requiredEnv('IW_MAX_SPEND_USD')), spentUsd: numberValue(ledger.totalUsd) };
    },
    async start() { cli(['api', base + 'start/', '-X', 'POST']); },
    async rollout(enabled, percentage) {
      if (!baseline) throw Error('A signed baseline is required for a rollout write.');
      cli(['api', base + 'rollout/', '-X', 'PATCH', '--input', '-'], {
        enabled, rollout_percentage: percentage, feature_state_value: baseline.rollout.control,
        multivariate_feature_state_values: baseline.rollout.variants.map(v => ({ multivariate_feature_option: v.id, percentage_allocation: v.weight })),
        // On 2.295.2 omission preserves the audience frozen by Flagsmith when the draft was created.
      });
    },
    async evaluate(probe) {
      if (!baseline) throw Error('A signed target is required for evaluation.');
      return cli(['evaluate', '--json', '--identity', probe.identifier,
        ...probe.traits.flatMap(trait => ['--trait', trait]), '--', baseline.target.feature]);
    },
  };
}
