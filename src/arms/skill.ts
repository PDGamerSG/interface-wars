// Skill revisions for the cli_skill arm. Each revision is pinned by the SHA-256 of its SKILL.md, so a trial can only
// run a revision whose text was fixed before the run. Revision 1 is the registered skill of the archived study
// (prereg/PREREGISTRATION.md). Revision 2 stages experiment drafts with enrollment off.
//
// Every revision is mounted at /skills/flagsmith-ops/SKILL.md, the path the system prompt names, so the prompt is
// byte-identical across revisions and only the skill text differs. Only the selected revision's directory is mounted.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lab/config.ts';

export const SKILL_REVISIONS = {
  'flagsmith-ops': 'f6f350aec5da331637eaf740f37da39445b693b57967531bd377fca89c509328',
  'flagsmith-ops-v2': '19b412bfdfa744c5b694bd65148ef45c5575db3d426f1dcba5e64146c94f6de8',
} as const;
export type SkillRevision = keyof typeof SKILL_REVISIONS;
export const DEFAULT_SKILL: SkillRevision = 'flagsmith-ops';
export const SKILL_MOUNT = '/skills/flagsmith-ops';

export type SelectedSkill = { name: SkillRevision; sha256: string; dir: string };

export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

// IW_SKILL picks the revision. A name outside SKILL_REVISIONS, or a SKILL.md that no longer matches its pin, stops
// the trial before any model call.
export function selectedSkill(raw = process.env.IW_SKILL, root = ROOT): SelectedSkill {
  const name = (raw === undefined || raw.trim() === '' ? DEFAULT_SKILL : raw.trim()) as SkillRevision;
  if (!Object.hasOwn(SKILL_REVISIONS, name)) {
    throw new Error(`IW_SKILL must be one of ${Object.keys(SKILL_REVISIONS).join(', ')}, not "${raw}".`);
  }
  const dir = join(root, 'skills', name);
  const actual = sha256(readFileSync(join(dir, 'SKILL.md')));
  if (actual !== SKILL_REVISIONS[name]) {
    throw new Error(`skills/${name}/SKILL.md has SHA-256 ${actual}, but its pin is ${SKILL_REVISIONS[name]}. Pin a new revision instead of editing one.`);
  }
  return { name, sha256: actual, dir };
}
