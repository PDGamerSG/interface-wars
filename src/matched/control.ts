import { Flagsmith } from '@flagsmith/nodejs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdmin, type Admin } from '../flagsmith/admin.ts';
import { FLAGSMITH_URL, ROOT, type Lab } from '../lab/config.ts';
import { writeJson } from '../agent/project.ts';
import { arms, manifest, fingerprint, type Assignment, type StudyArm } from './study.ts';

export type Control = {
  organisationId: number; projectId: number; environmentId: number; environmentKey: string; serverKey: string;
  featureId: number; optionId: number; experimentId: number; metricIds: Record<string, number>; url: string; fingerprint: string;
};
export const experimentPath = (c: Control) => `/api/v1/environments/${c.environmentKey}/experiments/${c.experimentId}`;
const controlFile = (dir: string) => join(dir, 'control.local.json');
export function readControl(dir: string, lab: Lab): Control {
  const c: Control = JSON.parse(readFileSync(controlFile(dir), 'utf8'));
  if (c.url !== FLAGSMITH_URL || c.fingerprint !== fingerprint || c.organisationId === lab.control.organisationId || c.projectId === lab.control.projectId ||
      c.environmentId === lab.control.environmentId || c.environmentKey === lab.control.environmentKey || c.experimentId === lab.experiment?.experimentId) {
    throw new Error('The control file does not identify this separate matched environment');
  }
  return c;
}

async function findOrCreate(a: Admin, path: string, name: string, body: object) {
  const matches = (await a.list(path)).filter(x => x.name === name);
  if (matches.length > 1) throw new Error('Ambiguous study resource ' + name);
  return matches[0] ?? await a.post(path, { name, ...body });
}

export async function setup(dir: string, lab: Lab, a: Admin, synthetic: boolean) {
  if (existsSync(controlFile(dir))) return readControl(dir, lab);
  const name = manifest.id + (synthetic ? '-dry' : '');
  const orgs = await a.list('/api/v1/organisations/');
  const existingOrgs = orgs.filter(x => x.name === name);
  if (existingOrgs.length > 1) throw new Error('Ambiguous matched organisation');
  const org = existingOrgs[0] ?? await a.post('/api/v1/organisations/', { name });
  if (org.id === lab.control.organisationId) throw new Error('Expected a new control organisation');
  const projects = await a.list(`/api/v1/projects/?organisation=${org.id}`);
  const matches = projects.filter(x => x.name === name && (x.organisation?.id ?? x.organisation) === org.id);
  if (matches.length > 1) throw new Error('Ambiguous matched project');
  const p = matches[0] ?? await a.post('/api/v1/projects/', { name, organisation: org.id });
  if (p.id === lab.control.projectId) throw new Error('Expected a new control project');
  const envs = await a.list(`/api/v1/environments/?project=${p.id}`);
  const found = envs.filter(x => x.name === name && (x.project?.id ?? x.project) === p.id);
  if (found.length > 1) throw new Error('Ambiguous matched environment');
  const env = found[0] ?? await a.post('/api/v1/environments/', { name, project: p.id });
  if (env.id === lab.control.environmentId) throw new Error('Expected a separate control environment');
  const base = `/api/v1/environments/${env.api_key}`;
  await findOrCreate(a, base + '/warehouse-connections/', 'Flagsmith database', { warehouse_type: 'postgres', config: { source: 'flagsmith_database' } });
  const featurePath = `/api/v1/projects/${p.id}/features/`;
  const feature = await findOrCreate(a, featurePath, manifest.flag, { type: 'MULTIVARIATE', initial_value: 'mcp', default_enabled: true,
    multivariate_options: [{ type: 'unicode', string_value: 'mcp_guided', default_percentage_allocation: 0 }] });
  const option = feature.multivariate_options.find((o: any) => o.string_value === 'mcp_guided');
  if (feature.multivariate_options.length !== 1 || !option) throw new Error('Unexpected options on study feature');
  if (option.key !== 'mcp_guided') await a.put(`${featurePath}${feature.id}/mv-options/${option.id}/`, { ...option, feature: feature.id, key: 'mcp_guided' });
  const metricIds: Record<string, number> = {};
  for (const m of manifest.metrics) {
    const metric = await findOrCreate(a, base + '/experiment-metrics/', m.name, { description: m.role, direction: m.direction,
      aggregation: m.aggregation, definition: { version: 1, event: m.event } });
    metricIds[m.name] = metric.id;
  }
  const exp = await findOrCreate(a, base + '/experiments/', manifest.title, { feature: feature.id, hypothesis: manifest.question,
    metrics: manifest.metrics.map(m => ({ metric: metricIds[m.name], expected_direction: m.role === 'primary' ? 'decrease' : 'not_decrease' })),
    experiment_rollout: { enabled: true, rollout_percentage: 100, feature_state_value: { type: 'string', value: 'mcp' },
      multivariate_feature_state_values: [{ multivariate_feature_option: option.id, percentage_allocation: manifest.arms[1].share }] } });
  const key = await a.post(base + '/api-keys/', { name: 'matched-runner' });
  const c: Control = { organisationId: org.id, projectId: p.id, environmentId: env.id, environmentKey: env.api_key, serverKey: key.key,
    featureId: feature.id, optionId: option.id, experimentId: exp.id, metricIds, url: FLAGSMITH_URL, fingerprint };
  writeJson(controlFile(dir), c);
  writeJson(join(dir, 'experiment.json'), { study: manifest.id, synthetic, fingerprint, projectId: p.id, environmentId: env.id,
    featureId: feature.id, optionId: option.id, experimentId: exp.id, metricIds });
  return c;
}

export function management(lab: Lab) { return createAdmin(FLAGSMITH_URL, { kind: 'token', value: lab.admin.token }); }

export function assigner(c: Control) {
  // Journal the evaluated arm first. The durable event send below records the exposure exactly once.
  const sdk = new Flagsmith({ environmentKey: c.serverKey, apiUrl: FLAGSMITH_URL + '/api/v1/' });
  return async (id: string): Promise<StudyArm> => {
    const raw = (await sdk.getIdentityFlags(id)).getFlag(manifest.flag) as any;
    if (!raw || !raw.enabled || !raw.experiment?.inExperiment || raw.experiment.id !== c.experimentId ||
        raw.featureId !== c.featureId || !arms.includes(raw.value as StudyArm) || raw.variant !== (raw.value === 'mcp' ? 'control' : 'mcp_guided')) {
      throw new Error('Flagsmith identity is outside the registered experiment or received an unexpected variant');
    }
    return raw.value as StudyArm;
  };
}

type Event = { identifier: string; event: string; value: string | null; feature_name: string | null };
export function eventsFor(row: Assignment, kind: 'exposure' | 'metrics'): Event[] {
  const make = (event: string, value: string | null, feature_name: string | null = null) => ({ identifier: row.id, event, value, feature_name });
  if (kind === 'exposure') return [make('$flag_exposure', row.arm === 'mcp' ? 'control' : row.arm, manifest.flag)];
  const r = row.result!;
  return [make('cost_usd', String(r.costUsd)), ...(r.correct ? [make('job_correct', null)] : []), ...(r.scoped ? [make('no_collateral', null)] : [])];
}

// Flagsmith 2.295.2 ingests synchronously without an idempotency key. Read the dedicated warehouse to
// recover an interrupted acknowledgement before resending individual missing events.
export function warehouse(c: Control): Event[] {
  const expectedKey = createHash('md5').update(c.environmentKey).digest('hex');
  const sql = `BEGIN READ ONLY;
    SELECT md5(api_key) FROM environments_environment WHERE id = :'env_id'::int;
    SELECT COALESCE(json_agg(json_build_object('identifier', e.identifier, 'event', e.event, 'value', e.value, 'feature_name', e.feature_name)), '[]')
    FROM experimentation_sdkexperimentationevent e JOIN environments_environment env ON env.api_key=e.environment_key WHERE env.id=:'env_id'::int;
    COMMIT;`;
  const out = execFileSync('docker', ['compose', '-p', process.env.IW_COMPOSE_PROJECT ?? 'interface-wars', '-f', join(ROOT, 'infra/compose.yml'),
    'exec', '-T', 'postgres', 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'env_id=' + c.environmentId, '-U', 'postgres', '-d', 'flagsmith'],
    { encoding: 'utf8', input: sql, timeout: 30_000 });
  const [key, events] = out.trim().split('\n');
  if (key !== expectedKey) throw new Error('Docker warehouse does not match the dedicated environment');
  return JSON.parse(events);
}
const same = (a: Event, b: Event) => a.identifier === b.identifier && a.event === b.event && a.value === b.value && a.feature_name === b.feature_name;

export async function deliver(c: Control, row: Assignment, kind: 'exposure' | 'metrics', interrupted: boolean) {
  const expected = eventsFor(row, kind);
  const stored = interrupted ? warehouse(c).filter(e => e.identifier === row.id) : [];
  const missing = expected.filter(e => {
    const copies = stored.filter(x => x.event === e.event);
    if (copies.length > 1 || (copies.length === 1 && !same(copies[0], e))) throw new Error('Conflicting stored events for ' + row.id);
    return !copies.length;
  });
  if (!missing.length) return;
  const response = await fetch(FLAGSMITH_URL + '/api/v1/events', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Environment-Key': c.serverKey },
    body: JSON.stringify({ events: missing.map(e => ({ ...e, timestamp: Date.now(), metadata: { experiment_id: c.experimentId } })) }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Flagsmith events HTTP ' + response.status);
  const ack = await response.json() as { accepted: number; rejected: unknown[] };
  if (ack.accepted !== missing.length || ack.rejected.length) throw new Error('Incomplete Flagsmith event acknowledgement');
}

export function warehouseMatches(c: Control, rows: Assignment[]) {
  const actual = warehouse(c);
  const expected = rows.flatMap(r => [...eventsFor(r, 'exposure'), ...(r.result ? eventsFor(r, 'metrics') : [])]);
  return { stored: actual.length, expected: expected.length,
    matches: actual.length === expected.length && expected.every(e => actual.filter(x => same(x, e)).length === 1) };
}

export async function nativeResults(c: Control, a: Admin, rows: Assignment[]) {
  const base = experimentPath(c);
  for (const field of ['exposures', 'results']) {
    try { await a.post(`${base}/${field}/refresh/`, {}); }
    catch (error) { if ((error as { status?: number }).status !== 429) throw error; }
  }
  let report;
  for (let i = 0; i < 60; i++) {
    const [ep, res] = await Promise.all([a.get(base + '/exposures/'), a.get(base + '/results/')]);
    const exposures = ep.exposures?.payload, payload = res.results?.payload;
    const counts: Record<string, number> = {};
    for (const point of exposures?.timeseries?.points ?? []) {
      for (const [arm, count] of Object.entries(point.new_identities)) counts[arm] = (counts[arm] ?? 0) + Number(count);
    }
    const aggregatesMatch = arms.every(arm => {
      const name = arm === 'mcp' ? 'control' : arm;
      const members = rows.filter(r => r.arm === arm);
      return (counts[name] ?? 0) === members.length && manifest.metrics.every(metric => {
        const stat = payload?.metrics?.find((m: any) => m.metric_id === c.metricIds[metric.name])?.variants?.[name];
        const total = members.reduce((s, r) => s + (!r.result ? 0 : metric.name === 'cost_usd' ? r.result.costUsd :
          Number(metric.name === 'job_correct' ? r.result.correct : r.result.scoped)), 0);
        return stat?.n === members.length && Math.abs(stat.sum - total) < 0.000001;
      });
    });
    report = { aggregatesMatch, excluded: exposures?.excluded_identities ?? null, counts, metrics: payload?.metrics ?? null, asOf: res.results?.as_of ?? null };
    if (aggregatesMatch || i === 59) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return report!;
}
