// Versioned experiment manifests keep a future study's arms, jobs, metrics and guide explicit.
// The shipped main run is an archive. New experiments can be planned and reviewed without touching it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../jobs/catalog.ts';

export type ManifestArm = {
  id: string;
  label: string;
  interface: string;
  share: number;
  guide?: string;
};

export type ManifestMetric = {
  name: string;
  event: string;
  aggregation: 'occurrence' | 'mean' | 'count' | 'sum';
  direction: 'up' | 'down' | 'informational';
  role: 'primary' | 'guardrail';
};

export type ExperimentManifest = {
  schemaVersion: 1;
  id: string;
  title: string;
  question: string;
  flag: string;
  arms: ManifestArm[];
  model: { id: string; effort: 'low' | 'medium' | 'high'; maxTurns: number };
  jobPack: { id: string; templateIds: string[] };
  metrics: ManifestMetric[];
  budget: { maxUsd: number; expectedUsd: number; currency: 'USD' };
};

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const guideFile = (name: string) => join(ROOT, 'guides', name);

const MAIN: ExperimentManifest = {
  schemaVersion: 1,
  id: 'interface-wars-v1',
  title: 'Which interface should agents use to operate Flagsmith?',
  question: 'Does the CLI plus the Agent Skill complete more Flagsmith jobs correctly than the official MCP server without higher cost or lower safety?',
  flag: 'agent_interface',
  arms: [
    { id: 'mcp', label: 'MCP', interface: 'official Flagsmith MCP server', share: 33.34 },
    { id: 'cli', label: 'CLI', interface: 'Flagsmith CLI v2 in a locked shell', share: 33.33 },
    { id: 'cli_skill', label: 'CLI + skill', interface: 'Flagsmith CLI v2 plus flagsmith-ops', share: 33.33 },
  ],
  model: { id: 'claude-haiku-5-5', effort: 'medium', maxTurns: 30 },
  jobPack: { id: 'all-16-v1', templateIds: TEMPLATES.map((t) => t.id) },
  metrics: [
    { name: 'job_correct', event: 'job_correct', aggregation: 'occurrence', direction: 'up', role: 'primary' },
    { name: 'no_collateral', event: 'no_collateral', aggregation: 'occurrence', direction: 'up', role: 'guardrail' },
    { name: 'cost_usd', event: 'cost_usd', aggregation: 'mean', direction: 'down', role: 'guardrail' },
  ],
  budget: { maxUsd: 15, expectedUsd: 1, currency: 'USD' },
};

const MCP_GUIDANCE: ExperimentManifest = {
  schemaVersion: 1,
  id: 'mcp-guidance-v1',
  title: 'Does a focused MCP guide reduce cost without reducing correctness?',
  question: 'For the same Flagsmith MCP tools and matched jobs, does a short read-before-write guide reduce model cost while preserving correctness and change scope?',
  flag: 'agent_interface_mcp_guidance_v1',
  arms: [
    { id: 'mcp', label: 'MCP', interface: 'official Flagsmith MCP server', share: 50 },
    { id: 'mcp_guided', label: 'MCP + guide', interface: 'official Flagsmith MCP server plus MCP operations guide v1', share: 50, guide: 'guides/mcp-guidance-v1.md' },
  ],
  model: { id: 'claude-haiku-5-5', effort: 'medium', maxTurns: 30 },
  jobPack: { id: 'mcp-guidance-four-jobs-v1', templateIds: ['kill_switch', 'set_value_in_development', 'segment_override', 'remove_segment_override'] },
  metrics: [
    { name: 'job_correct', event: 'job_correct', aggregation: 'occurrence', direction: 'up', role: 'primary' },
    { name: 'no_collateral', event: 'no_collateral', aggregation: 'occurrence', direction: 'up', role: 'guardrail' },
    { name: 'cost_usd', event: 'cost_usd', aggregation: 'mean', direction: 'down', role: 'guardrail' },
  ],
  budget: { maxUsd: 2, expectedUsd: 0.85, currency: 'USD' },
};

export const EXPERIMENT_MANIFESTS: Record<string, ExperimentManifest> = {
  [MAIN.id]: MAIN,
  [MCP_GUIDANCE.id]: MCP_GUIDANCE,
};

export function guideHash(path: string) {
  return createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function manifestHash(manifest: ExperimentManifest) {
  const guides = manifest.arms.filter((arm) => arm.guide).map((arm) => [arm.id, guideHash(arm.guide!)]);
  return createHash('sha256').update(stable({ manifest, guides })).digest('hex');
}

export function validateManifest(manifest: ExperimentManifest) {
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported manifest schema ${manifest.schemaVersion}`);
  if (!manifest.id || !manifest.title || !manifest.flag) throw new Error('Manifest needs an id, title and flag');
  if (manifest.arms.length < 2) throw new Error('Manifest needs at least two arms');
  const armIds = new Set<string>();
  let shares = 0;
  for (const arm of manifest.arms) {
    if (armIds.has(arm.id)) throw new Error(`Duplicate arm ${arm.id}`);
    if (!Number.isFinite(arm.share) || arm.share <= 0) throw new Error(`Invalid share for ${arm.id}`);
    if (arm.guide) guideHash(arm.guide);
    armIds.add(arm.id); shares += arm.share;
  }
  if (Math.abs(shares - 100) > 0.01) throw new Error(`Arm shares total ${shares}, expected 100`);
  if (!manifest.model.id || manifest.model.maxTurns < 1) throw new Error('Invalid model settings');
  if (!manifest.jobPack.templateIds.length) throw new Error('Job pack is empty');
  const templateIds = new Set(TEMPLATES.map((template) => template.id));
  for (const id of manifest.jobPack.templateIds) if (!templateIds.has(id)) throw new Error(`Unknown job template ${id}`);
  const metricNames = new Set<string>();
  for (const metric of manifest.metrics) {
    if (metricNames.has(metric.name)) throw new Error(`Duplicate metric ${metric.name}`);
    metricNames.add(metric.name);
  }
  if (!Number.isFinite(manifest.budget.maxUsd) || manifest.budget.maxUsd <= 0 || manifest.budget.expectedUsd < 0) throw new Error('Invalid budget');
  return manifest;
}

export function getManifest(id = 'interface-wars-v1') {
  const manifest = EXPERIMENT_MANIFESTS[id];
  if (!manifest) throw new Error(`Unknown experiment ${id}. Available: ${Object.keys(EXPERIMENT_MANIFESTS).join(', ')}`);
  return validateManifest(manifest);
}

export function renderPlan(manifest: ExperimentManifest) {
  const guideLines = manifest.arms.filter((arm) => arm.guide).map((arm) => `  ${arm.id}: ${arm.guide} sha256=${guideHash(arm.guide!)}`);
  return [
    `Experiment ${manifest.id}`,
    `Title: ${manifest.title}`,
    `Question: ${manifest.question}`,
    `Flag: ${manifest.flag}`,
    `Arms: ${manifest.arms.map((arm) => `${arm.id} (${arm.share}%, ${arm.interface})`).join(' | ')}`,
    `Model: ${manifest.model.id}, effort=${manifest.model.effort}, max turns=${manifest.model.maxTurns}`,
    `Job pack: ${manifest.jobPack.id} [${manifest.jobPack.templateIds.join(', ')}]`,
    `Metrics: ${manifest.metrics.map((metric) => `${metric.name} (${metric.role}, ${metric.aggregation}/${metric.direction})`).join(' | ')}`,
    `Budget: ${manifest.budget.expectedUsd.toFixed(2)} expected, ${manifest.budget.maxUsd.toFixed(2)} maximum ${manifest.budget.currency}`,
    guideLines.length ? `Guides:\n${guideLines.join('\n')}` : 'Guides: none',
    `Manifest sha256: ${manifestHash(manifest)}`,
  ].join('\n') + '\n';
}

for (const manifest of Object.values(EXPERIMENT_MANIFESTS)) validateManifest(manifest);
