// Reference solutions: one known-good way to do each job through the Flagsmith Admin API.
// `npm run jobs:selftest` proves every template is solvable, that the verifier accepts the reference
// end state, and that it rejects both "did nothing" and "did too much".
import type { Sandbox } from '../lab/sandbox.ts';
import type { Job } from './catalog.ts';

async function featureId(s: Sandbox, name: string) {
  const list = await s.admin.list(`/api/v1/projects/${s.projectId}/features/`);
  return list.find((f: any) => f.name === name)?.id;
}
async function envState(s: Sandbox, env: 'Development' | 'Production', name: string) {
  const id = await featureId(s, name);
  const states = await s.admin.list(`/api/v1/environments/${s.env[env].key}/featurestates/?feature=${id}`);
  return states.find((x: any) => x.feature_segment === null && x.identity === null);
}
async function putState(s: Sandbox, env: 'Development' | 'Production', name: string, change: Record<string, unknown>) {
  const st = await envState(s, env, name);
  await s.admin.put(`/api/v1/environments/${s.env[env].key}/featurestates/${st.id}/`, { ...st, ...change });
}
const quoted = (task: string) => [...task.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

export async function solve(job: Job, s: Sandbox) {
  const q = quoted(job.task);
  const P = s.env.Production.key;
  switch (job.template) {
    case 'create_flag':
      await s.admin.post(`/api/v1/projects/${s.projectId}/features/`, { name: q[0], description: q[1], default_enabled: false, type: 'STANDARD' });
      return;
    case 'enable_in_production':
      return putState(s, 'Production', q[0], { enabled: true });
    case 'set_value_in_development':
      return putState(s, 'Development', q[0], { feature_state_value: q[1] });
    case 'kill_switch':
      return putState(s, 'Production', q[0], { enabled: false });
    case 'create_multivariate':
      await s.admin.post(`/api/v1/projects/${s.projectId}/features/`, {
        name: q[0], type: 'MULTIVARIATE', initial_value: q[1], default_enabled: true,
        multivariate_options: [q[2], q[3]].map((v) => ({ type: 'unicode', string_value: v, default_percentage_allocation: 50 })),
      });
      return;
    case 'change_split_in_production': {
      const pct = Number(job.task.match(/gets (\d+)%/)![1]);
      const st = await envState(s, 'Production', q[0]);
      return putState(s, 'Production', q[0], { multivariate_feature_state_values: st.multivariate_feature_state_values.map((m: any) => ({ ...m, percentage_allocation: pct })) });
    }
    case 'create_segment':
      await s.admin.post(`/api/v1/projects/${s.projectId}/segments/`, {
        name: q[0], project: s.projectId,
        rules: [{ type: 'ALL', rules: [{ type: 'ANY', rules: [], conditions: [{ operator: 'EQUAL', property: q[1], value: q[2] }] }] }],
      });
      return;
    case 'segment_override': {
      const segs = await s.admin.list(`/api/v1/projects/${s.projectId}/segments/`);
      const seg = segs.find((x: any) => x.name === q[1]);
      const fid = await featureId(s, q[0]);
      const fseg = await s.admin.post('/api/v1/features/feature-segments/', { feature: fid, segment: seg.id, environment: s.env.Production.id });
      await s.admin.post('/api/v1/features/featurestates/', {
        feature: fid, environment: s.env.Production.id, feature_segment: fseg.id, enabled: true,
        feature_state_value: { type: 'unicode', string_value: q[2] },
      });
      return;
    }
    case 'create_metric':
      await s.admin.post(`/api/v1/environments/${P}/experiment-metrics/`, {
        name: q[0], description: '', aggregation: 'occurrence', direction: 'up', definition: { version: 1, event: q[1] },
      });
      return;
    case 'create_experiment': {
      const [x, f] = q;
      const metrics = await s.admin.list(`/api/v1/environments/${P}/experiment-metrics/`);
      const primary = metrics.find((m: any) => job.task.includes(`primary metric "${m.name}"`));
      const guard = metrics.find((m: any) => m.id !== primary.id);
      const fid = await featureId(s, f);
      const options = await s.admin.list(`/api/v1/projects/${s.projectId}/features/${fid}/mv-options/`);
      const control = (await envState(s, 'Production', f)).feature_state_value;
      const strictDraft = process.env.IW_GRADER === 'strict-draft-v1';
      await s.admin.post(`/api/v1/environments/${P}/experiments/`, {
        feature: fid, name: x, hypothesis: job.task.split('Hypothesis: ')[1].split('. The primary')[0],
        metrics: [{ metric: primary.id, expected_direction: 'increase' }, { metric: guard.id, expected_direction: 'not_increase' }],
        experiment_rollout: {
          enabled: !strictDraft, rollout_percentage: strictDraft ? 0 : 100, feature_state_value: { type: 'string', value: control },
          multivariate_feature_state_values: options.map((o: any) => ({ multivariate_feature_option: o.id, percentage_allocation: 50 })),
        },
      });
      return;
    }
    case 'start_experiment': {
      const list = await s.admin.list(`/api/v1/environments/${P}/experiments/`);
      const x = list.find((e: any) => e.name === q[0]);
      await s.admin.post(`/api/v1/environments/${P}/experiments/${x.id}/start/`, {});
      return;
    }
    case 'ship_winner': {
      const list = await s.admin.list(`/api/v1/environments/${P}/experiments/`);
      const x = list.find((e: any) => e.name === q[0]);
      const fid = x.feature?.id ?? x.feature;
      const options = await s.admin.list(`/api/v1/projects/${s.projectId}/features/${fid}/mv-options/`);
      const winner = options.find((o: any) => o.string_value === q[1]);
      await s.admin.post(`/api/v1/environments/${P}/experiments/${x.id}/complete/`, { rollout_decision: 'variant', rollout_variant: winner.id });
      return;
    }
    case 'sync_production_to_development': {
      const dev = await envState(s, 'Development', q[0]);
      return putState(s, 'Production', q[0], { enabled: dev.enabled, feature_state_value: dev.feature_state_value });
    }
    case 'find_maintenance_flag': {
      const states = await s.admin.list(`/api/v1/environments/${P}/featurestates/`);
      const target = states.find((x: any) => x.feature_segment === null && x.enabled && x.feature_state_value === 'maintenance');
      await s.admin.put(`/api/v1/environments/${P}/featurestates/${target.id}/`, { ...target, enabled: false });
      return;
    }
    case 'archive_stale_flag': {
      const tags = await s.admin.list(`/api/v1/projects/${s.projectId}/tags/`);
      const stale = tags.find((t: any) => t.label === 'stale');
      const list = await s.admin.list(`/api/v1/projects/${s.projectId}/features/`);
      const f = list.find((x: any) => (x.tags ?? []).includes(stale.id));
      await s.admin.patch(`/api/v1/projects/${s.projectId}/features/${f.id}/`, { is_archived: true });
      return;
    }
    case 'remove_segment_override': {
      const fid = await featureId(s, q[1]);
      const segs = await s.admin.list(`/api/v1/projects/${s.projectId}/segments/`);
      const seg = segs.find((x: any) => x.name === q[0]);
      const fsegs = await s.admin.list(`/api/v1/features/feature-segments/?environment=${s.env.Production.id}&feature=${fid}`);
      for (const fs of fsegs) if (fs.segment === seg.id) await s.admin.del(`/api/v1/features/feature-segments/${fs.id}/`);
      return;
    }
    default:
      throw new Error('No reference solution for ' + job.template);
  }
}
