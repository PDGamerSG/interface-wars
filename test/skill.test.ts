import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../src/lab/config.ts';
import { DEFAULT_SKILL, SKILL_REVISIONS, selectedSkill, sha256 } from '../src/arms/skill.ts';

test('revision 1 is the skill frozen in the preregistration', () => {
  const prereg = readFileSync(join(ROOT, 'prereg', 'PREREGISTRATION.md'), 'utf8');
  assert.equal(DEFAULT_SKILL, 'flagsmith-ops');
  assert.ok(prereg.includes(SKILL_REVISIONS['flagsmith-ops']), 'the v1 pin must be the SHA-256 in PREREGISTRATION.md');
  assert.equal(sha256(readFileSync(join(ROOT, 'skills', 'flagsmith-ops', 'SKILL.md'))), SKILL_REVISIONS['flagsmith-ops']);
});

test('every pinned revision matches its SKILL.md and names itself', () => {
  for (const name of Object.keys(SKILL_REVISIONS)) {
    const skill = selectedSkill(name);
    assert.equal(skill.name, name);
    assert.match(readFileSync(join(skill.dir, 'SKILL.md'), 'utf8'), new RegExp(`^---\\nname: ${name}\\n`));
  }
});

test('an unset IW_SKILL selects revision 1', () => {
  assert.equal(selectedSkill(undefined).name, 'flagsmith-ops');
  assert.equal(selectedSkill('  ').name, 'flagsmith-ops');
});

test('an unknown revision is refused', () => {
  assert.throws(() => selectedSkill('flagsmith-release-gate'), /IW_SKILL must be one of flagsmith-ops, flagsmith-ops-v2/);
  assert.throws(() => selectedSkill('../skills/flagsmith-ops'), /IW_SKILL must be one of/);
});

test('an edited revision is refused until it is pinned', () => {
  const root = mkdtempSync(join(tmpdir(), 'iw-skill-'));
  cpSync(join(ROOT, 'skills', 'flagsmith-ops-v2'), join(root, 'skills', 'flagsmith-ops-v2'), { recursive: true });
  const file = join(root, 'skills', 'flagsmith-ops-v2', 'SKILL.md');
  writeFileSync(file, readFileSync(file, 'utf8') + '\nOne more rule.\n');
  assert.throws(() => selectedSkill('flagsmith-ops-v2', root), /Pin a new revision instead of editing one/);
});

test('revision 2 stages drafts with enrollment off and differs from revision 1 only in the experiment guidance', () => {
  const v1 = readFileSync(join(ROOT, 'skills', 'flagsmith-ops', 'SKILL.md'), 'utf8');
  const v2 = readFileSync(join(ROOT, 'skills', 'flagsmith-ops-v2', 'SKILL.md'), 'utf8');
  assert.ok(v1.includes('"experiment_rollout":{"enabled":true,"rollout_percentage":100,'));
  assert.ok(v2.includes('"experiment_rollout":{"enabled":false,"rollout_percentage":0,'));
  assert.ok(v2.includes('/rollout/ -X PATCH'));
  const rules = (text: string) => text.slice(text.indexOf('## Rules'), text.indexOf('## Experiments'));
  assert.equal(rules(v2), rules(v1));
});
