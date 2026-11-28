// For every template: the untouched sandbox must fail, the reference solution must pass, and an extra
// change to a decoy must count as collateral. This is the verifier's own pre-registered check.
import { TEMPLATES, Rng, grade } from './catalog.ts';
import { strictGrade, STRICT_GRADER } from './strict.ts';
import { solve } from './reference.ts';
import { createSandbox, snapshot, diff, destroySandbox } from '../lab/sandbox.ts';

let failures = 0;
const strict = process.argv.includes('--strict');
const only = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
for (const t of TEMPLATES) {
  if (only && t.id !== only) continue;
  const id = `selftest-${t.id}-${Date.now()}`;
  const job = t.render(new Rng(id));
  const decoy = 'iw_selftest_decoy';
  const s = await createSandbox(id, { ...job.seed, features: [...job.seed.features, { name: decoy }] });
  try {
    const before = await snapshot(s);
    const verifier = strict ? strictGrade : grade;
    const idle = verifier(job, before, before, []);
    await solve(job, s);
    const after = await snapshot(s);
    const changes = diff(before, after);
    const solved = verifier(job, before, after, changes);
    // Make a real out-of-scope change in this disposable organisation, then snapshot again.
    await s.admin.patch(`/api/v1/projects/${s.projectId}/features/${s.ids.features[decoy]}/`, { description: 'changed by self-test' });
    const damaged = await snapshot(s);
    const overreach = verifier(job, before, damaged, diff(before, damaged));
    const decoyDetected = !overreach.correct && overreach.collateral.some((c) => c.path === `feature.${decoy}.description`);
    const ok = !idle.correct && solved.correct && decoyDetected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${t.id.padEnd(32)} grader=${strict ? STRICT_GRADER : 'registered-v1'} idle=${idle.correct} solved=${solved.correct} decoyDetected=${decoyDetected} changes=${changes.length}` +
      (solved.correct ? '' : `\n  reasons=${JSON.stringify(solved.reasons)}\n  collateral=${JSON.stringify(solved.collateral)}`));
  } catch (error) {
    failures++;
    console.log(`FAIL ${t.id}: ${(error as Error).message}`);
  } finally {
    await destroySandbox(s);
  }
}
process.exit(failures ? 1 : 0);
