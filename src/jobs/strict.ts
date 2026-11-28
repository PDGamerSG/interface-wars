import { grade, type Job } from './catalog.ts';
import type { Change, Snapshot } from '../lab/sandbox.ts';

export const STRICT_GRADER = 'strict-draft-v1';

const addReason = (reasons: string[], ok: boolean, message: string) => {
  if (!ok) reasons.push(message);
};

/**
 * Prospective grading for experiment drafts. The registered grader remains
 * frozen for the archived study. This version additionally requires the
 * requested hypothesis, metric directions, a disabled zero-risk draft, and a
 * 50/50 control/variation rollout.
 */
export function strictGrade(job: Job, before: Snapshot, after: Snapshot, changes: Change[]) {
  const base = grade(job, before, after, changes);
  const reasons = [...base.reasons];
  if (job.template !== 'create_experiment') return { ...base, reasons, correct: reasons.length === 0 && base.collateral.length === 0 };

  const experiment = job.seed.experiments?.[0];
  const feature = experiment?.feature;
  const featureSeed = job.seed.features.find((item) => item.name === feature);
  const variation = featureSeed?.variants?.[0]?.value;
  const control = featureSeed?.value;
  if (!experiment || !feature || variation === undefined || control === undefined) {
    reasons.push('strict draft: job is missing its experiment seed');
    return { ...base, reasons, correct: false };
  }

  const experimentPath = `env.Production.experiment.${experiment.name}`;
  const rolloutPrefix = `env.Production.override.${feature}.experiment-`;
  const enabled = Object.entries(after).filter(([path]) => path.startsWith(rolloutPrefix) && path.endsWith('.enabled'));
  const rollout = enabled.length === 1 ? enabled[0][0].slice(0, -'.enabled'.length) : null;

  addReason(reasons, after[`${experimentPath}.hypothesis`] === experiment.hypothesis, 'strict draft: hypothesis does not match the registered text');
  for (const metric of experiment.metrics) {
    addReason(reasons, after[`${experimentPath}.metric.${metric.name}`] === metric.expected_direction,
      `strict draft: metric ${metric.name} direction does not match the registered direction`);
  }
  addReason(reasons, enabled.length === 1 && after[enabled[0][0]] === false,
    'strict draft: enrollment must be disabled while the experiment is created');
  addReason(reasons, rollout !== null && after[`${rollout}.value`] === control,
    'strict draft: control value is missing from the staged rollout');

  const splits = rollout === null ? [] : Object.entries(after).filter(([path]) => path.startsWith(`${rollout}.split.`));
  addReason(reasons, splits.length === 1 && splits[0][0] === `${rollout}.split.${variation}` && splits[0][1] === 50,
    'strict draft: the variation must receive exactly half of the rollout');
  return { ...base, reasons, correct: reasons.length === 0 && base.collateral.length === 0 };
}
