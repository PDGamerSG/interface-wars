// A sandbox is a fresh Flagsmith organisation created for one trial. It has one project ("shop") with
// Development and Production environments, seeded to the job's starting state, and its own master API key.
// The agent only ever receives that key, so it cannot reach the control organisation that runs the experiment.
import { createAdmin, type Admin } from '../flagsmith/admin.ts';
import { FLAGSMITH_URL, readLab } from './config.ts';

export const ENVIRONMENTS = ['Development', 'Production'] as const;
export type EnvName = (typeof ENVIRONMENTS)[number];

export type SeedFeature = {
  name: string;
  type?: 'STANDARD' | 'MULTIVARIATE';
  description?: string;
  value?: string;
  enabledByDefault?: boolean;
  variants?: { key: string; value: string; pct: number }[];
  states?: Partial<Record<EnvName, { enabled?: boolean; value?: string; mv?: Record<string, number> }>>;
  tags?: string[];
};
export type SeedSegment = { name: string; trait: string; value: string };
export type SeedOverride = { feature: string; segment: string; env: EnvName; enabled: boolean; value?: string };
export type SeedMetric = { name: string; event: string; aggregation: 'count' | 'sum' | 'mean' | 'occurrence'; direction: 'up' | 'down' | 'informational' };
export type SeedExperiment = {
  name: string;
  feature: string;
  hypothesis: string;
  metrics: { name: string; expected_direction: 'increase' | 'decrease' | 'not_increase' | 'not_decrease' }[];
  start?: boolean;
};
export type Seed = {
  features: SeedFeature[];
  segments?: SeedSegment[];
  overrides?: SeedOverride[];
  // Metrics and experiments live in Production.
  metrics?: SeedMetric[];
  experiments?: SeedExperiment[];
};

export type Sandbox = {
  trialId: string;
  organisationId: number;
  projectId: number;
  env: Record<EnvName, { id: number; key: string }>;
  apiKey: string;
  admin: Admin;
  ids: { features: Record<string, number>; segments: Record<string, number>; options: Record<string, Record<string, number>> };
};

function value(v: string | undefined) {
  if (v === undefined) return undefined;
  return { type: 'unicode', string_value: v };
}

export async function createSandbox(trialId: string, seed: Seed): Promise<Sandbox> {
  const lab = readLab();
  const root = createAdmin(FLAGSMITH_URL, { kind: 'token', value: lab.admin.token });
  const org = await root.post('/api/v1/organisations/', { name: `sbx-${trialId}`.slice(0, 100) });
  const project = await root.post('/api/v1/projects/', { name: 'shop', organisation: org.id });
  const env = {} as Sandbox['env'];
  for (const name of ENVIRONMENTS) {
    const e = await root.post('/api/v1/environments/', { name, project: project.id });
    env[name] = { id: e.id, key: e.api_key };
  }
  if (process.env.IW_SANDBOX_WAREHOUSE === '1') await root.post(`/api/v1/environments/${env.Production.key}/warehouse-connections/`, {
    warehouse_type: 'postgres', name: 'Flagsmith database', config: { source: 'flagsmith_database' },
  });
  const master = await root.post(`/api/v1/organisations/${org.id}/master-api-keys/`, { name: `agent-${trialId}`.slice(0, 50), is_admin: true });
  const sandbox: Sandbox = {
    trialId,
    organisationId: org.id,
    projectId: project.id,
    env,
    apiKey: master.key,
    admin: root,
    ids: { features: {}, segments: {}, options: {} },
  };
  await seedSandbox(sandbox, seed);
  return sandbox;
}

async function seedSandbox(s: Sandbox, seed: Seed) {
  const a = s.admin;
  const tagIds: Record<string, number> = {};
  for (const f of seed.features) {
    for (const t of f.tags ?? []) {
      if (!tagIds[t]) tagIds[t] = (await a.post(`/api/v1/projects/${s.projectId}/tags/`, { label: t, color: '#3d4db6', project: s.projectId })).id;
    }
    const created = await a.post(`/api/v1/projects/${s.projectId}/features/`, {
      name: f.name,
      type: f.type ?? (f.variants ? 'MULTIVARIATE' : 'STANDARD'),
      description: f.description ?? '',
      initial_value: f.value ?? null,
      default_enabled: f.enabledByDefault ?? false,
      multivariate_options: (f.variants ?? []).map((v) => ({ type: 'unicode', string_value: v.value, default_percentage_allocation: v.pct })),
      tags: (f.tags ?? []).map((t) => tagIds[t]),
    });
    s.ids.features[f.name] = created.id;
    s.ids.options[f.name] = {};
    for (const option of created.multivariate_options ?? []) {
      const v = (f.variants ?? []).find((x) => x.value === option.string_value);
      if (!v) continue;
      s.ids.options[f.name][v.key] = option.id;
      await a.put(`/api/v1/projects/${s.projectId}/features/${created.id}/mv-options/${option.id}/`, {
        ...option, key: v.key, feature: created.id,
      });
    }
    for (const envName of ENVIRONMENTS) {
      const want = f.states?.[envName];
      if (!want) continue;
      const states = await a.list(`/api/v1/environments/${s.env[envName].key}/featurestates/?feature=${created.id}`);
      const state = states.find((x: any) => x.feature_segment === null && x.identity === null);
      const body: any = {};
      if (want.enabled !== undefined) body.enabled = want.enabled;
      if (want.value !== undefined) body.feature_state_value = want.value;
      if (want.mv) {
        body.multivariate_feature_state_values = state.multivariate_feature_state_values.map((mv: any) => {
          const key = Object.entries(s.ids.options[f.name]).find(([, id]) => id === mv.multivariate_feature_option)?.[0];
          return { ...mv, percentage_allocation: key && want.mv![key] !== undefined ? want.mv![key] : mv.percentage_allocation };
        });
      }
      // PATCH ignores multivariate allocations; PUT with the full state applies them.
      await a.put(`/api/v1/environments/${s.env[envName].key}/featurestates/${state.id}/`, { ...state, ...body });
    }
  }
  for (const seg of seed.segments ?? []) {
    const created = await a.post(`/api/v1/projects/${s.projectId}/segments/`, {
      name: seg.name,
      project: s.projectId,
      rules: [{ type: 'ALL', rules: [{ type: 'ANY', rules: [], conditions: [{ operator: 'EQUAL', property: seg.trait, value: seg.value }] }] }],
    });
    s.ids.segments[seg.name] = created.id;
  }
  for (const o of seed.overrides ?? []) {
    const fseg = await a.post('/api/v1/features/feature-segments/', {
      feature: s.ids.features[o.feature], segment: s.ids.segments[o.segment], environment: s.env[o.env].id,
    });
    await a.post('/api/v1/features/featurestates/', {
      feature: s.ids.features[o.feature], environment: s.env[o.env].id, feature_segment: fseg.id,
      enabled: o.enabled, feature_state_value: value(o.value) ?? null,
    });
  }
  const metricIds: Record<string, number> = {};
  for (const m of seed.metrics ?? []) {
    const created = await a.post(`/api/v1/environments/${s.env.Production.key}/experiment-metrics/`, {
      name: m.name, description: '', aggregation: m.aggregation, direction: m.direction, definition: { version: 1, event: m.event },
    });
    metricIds[m.name] = created.id;
  }
  for (const x of seed.experiments ?? []) {
    const fid = s.ids.features[x.feature];
    const options = s.ids.options[x.feature];
    const share = 100 / (Object.keys(options).length + 1);
    const created = await a.post(`/api/v1/environments/${s.env.Production.key}/experiments/`, {
      feature: fid, name: x.name, hypothesis: x.hypothesis,
      metrics: x.metrics.map((m) => ({ metric: metricIds[m.name], expected_direction: m.expected_direction })),
      experiment_rollout: {
        enabled: true, rollout_percentage: 100,
        feature_state_value: { type: 'string', value: seed.features.find((f) => f.name === x.feature)?.value ?? 'control' },
        multivariate_feature_state_values: Object.values(options).map((id) => ({ multivariate_feature_option: id, percentage_allocation: Number(share.toFixed(2)) })),
      },
    });
    if (x.start) await a.post(`/api/v1/environments/${s.env.Production.key}/experiments/${created.id}/start/`, {});
  }
}

export type Snapshot = Record<string, unknown>;

function normalizeRules(rules: any[]): any {
  return (rules ?? []).map((r) => ({
    type: r.type,
    conditions: (r.conditions ?? []).map((c: any) => ({ operator: c.operator, property: c.property ?? c.property_, value: c.value })),
    rules: normalizeRules(r.rules ?? []),
  }));
}

// A flat path -> value map of everything an agent could change in the sandbox.
export async function snapshot(s: Sandbox): Promise<Snapshot> {
  const a = s.admin;
  const out: Snapshot = {};
  const features = await a.list(`/api/v1/projects/${s.projectId}/features/`);
  const tags = await a.list(`/api/v1/projects/${s.projectId}/tags/`);
  const tagLabel = (id: number) => tags.find((t: any) => t.id === id)?.label ?? String(id);
  for (const f of features) {
    const p = `feature.${f.name}`;
    out[`${p}.exists`] = true;
    out[`${p}.type`] = f.type;
    out[`${p}.description`] = f.description ?? '';
    out[`${p}.archived`] = Boolean(f.is_archived);
    out[`${p}.tags`] = (f.tags ?? []).map(tagLabel).sort().join(',');
    for (const o of f.multivariate_options ?? []) out[`${p}.variant.${o.string_value ?? o.integer_value ?? o.boolean_value}`] = true;
  }
  const segments = await a.list(`/api/v1/projects/${s.projectId}/segments/`);
  for (const seg of segments) out[`segment.${seg.name}`] = JSON.stringify(normalizeRules(seg.rules));
  for (const envName of ENVIRONMENTS) {
    const doc = await a.get(`/api/v1/environments/${s.env[envName].key}/document/`);
    for (const fs of doc.feature_states ?? []) {
      const p = `env.${envName}.flag.${fs.feature.name}`;
      out[`${p}.enabled`] = fs.enabled;
      out[`${p}.value`] = fs.feature_state_value === null || fs.feature_state_value === undefined ? null : String(fs.feature_state_value);
      for (const mv of fs.multivariate_feature_state_values ?? []) {
        out[`${p}.split.${mv.multivariate_feature_option.value}`] = Number(mv.percentage_allocation);
      }
    }
    for (const seg of doc.project?.segments ?? []) {
      for (const fs of seg.feature_states ?? []) {
        const p = `env.${envName}.override.${fs.feature.name}.${seg.name}`;
        out[`${p}.enabled`] = fs.enabled;
        out[`${p}.value`] = fs.feature_state_value === null || fs.feature_state_value === undefined ? null : String(fs.feature_state_value);
      }
    }
    const metrics = await a.list(`/api/v1/environments/${s.env[envName].key}/experiment-metrics/`);
    for (const m of metrics) {
      const p = `env.${envName}.metric.${m.name}`;
      out[`${p}.aggregation`] = m.aggregation;
      out[`${p}.direction`] = m.direction;
      out[`${p}.event`] = m.definition?.event ?? null;
    }
    const experiments = await a.list(`/api/v1/environments/${s.env[envName].key}/experiments/`);
    for (const x of experiments) {
      const p = `env.${envName}.experiment.${x.name}`;
      const featureName = features.find((f: any) => f.id === (x.feature?.id ?? x.feature))?.name ?? String(x.feature?.id ?? x.feature);
      out[`${p}.feature`] = featureName;
      out[`${p}.status`] = x.status;
      out[`${p}.rollout_decision`] = x.rollout_decision ?? null;
      out[`${p}.hypothesis`] = x.hypothesis ?? '';
      for (const m of x.metrics ?? []) out[`${p}.metric.${m.metric_name}`] = m.expected_direction;
    }
  }
  return out;
}

export type Change = { path: string; before: unknown; after: unknown };

export function diff(before: Snapshot, after: Snapshot): Change[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Change[] = [];
  for (const path of [...keys].sort()) {
    const b = before[path] ?? null;
    const a = after[path] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ path, before: b, after: a });
  }
  return changes;
}

export async function destroySandbox(s: Sandbox) {
  try {
    await s.admin.del(`/api/v1/organisations/${s.organisationId}/`);
  } catch {
    // Leaving a sandbox behind is harmless for the experiment; it is never reused.
  }
}
