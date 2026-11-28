// For every template: the untouched sandbox must fail, the reference solution must pass, and an extra
// change to a decoy must count as collateral. This is the verifier's own pre-registered check.
// Added after the main run: the write audit must accept every reference-solution write, and must catch a
// decoy change that is reverted before the final snapshot (which the snapshot diff cannot see).
import { TEMPLATES, Rng, grade } from './catalog.ts';
import { strictGrade, STRICT_GRADER } from './strict.ts';
import { solve } from './reference.ts';
import { createSandbox, snapshot, diff, destroySandbox } from '../lab/sandbox.ts';
import { auditMark, auditWrites, namesFrom, settledAuditRows } from '../lab/audit.ts';

let failures = 0;
const strict = process.argv.includes('--strict');
if (strict) process.env.IW_GRADER = STRICT_GRADER;
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
    const solveMark = auditMark();
    await solve(job, s);
    const after = await snapshot(s);
    const changes = diff(before, after);
    const solved = verifier(job, before, after, changes);
    // The write audit must accept every write of the reference solution (no false positives).
    const solveAudit = auditWrites(s, await settledAuditRows(s, solveMark), namesFrom(before, after), job.allowed);
    const solveWritesInScope = solveAudit.writes > 0 && solveAudit.outOfScope.length === 0;
    // Adversarial: change a decoy flag's description and its Production state, then restore both. The final
    // snapshot is identical, so only the write audit can see it.
    const revertMark = auditMark();
    const decoyPath = `/api/v1/projects/${s.projectId}/features/${s.ids.features[decoy]}/`;
    await s.admin.patch(decoyPath, { description: 'changed by self-test' });
    await s.admin.patch(decoyPath, { description: '' });
    const P = s.env.Production.key;
    const decoyState = (await s.admin.list(`/api/v1/environments/${P}/featurestates/?feature=${s.ids.features[decoy]}`))
      .find((x: any) => x.feature_segment === null && x.identity === null);
    await s.admin.patch(`/api/v1/environments/${P}/featurestates/${decoyState.id}/`, { enabled: !decoyState.enabled });
    await s.admin.patch(`/api/v1/environments/${P}/featurestates/${decoyState.id}/`, { enabled: decoyState.enabled });
    const reverted = await snapshot(s);
    const revertDiff = diff(after, reverted);
    const revertAudit = auditWrites(s, await settledAuditRows(s, revertMark), namesFrom(before, reverted), job.allowed);
    const revertCaught = revertDiff.length === 0 && verifier(job, before, reverted, diff(before, reverted)).correct &&
      revertAudit.outOfScope.some((w) => w.paths.includes(`feature.${decoy}.description`)) &&
      revertAudit.outOfScope.some((w) => w.env === 'Production' && w.paths.includes(`env.Production.flag.${decoy}.enabled`));
    // Make a real out-of-scope change in this disposable organisation, then snapshot again.
    await s.admin.patch(`/api/v1/projects/${s.projectId}/features/${s.ids.features[decoy]}/`, { description: 'changed by self-test' });
    const damaged = await snapshot(s);
    const overreach = verifier(job, before, damaged, diff(before, damaged));
    const decoyDetected = !overreach.correct && overreach.collateral.some((c) => c.path === `feature.${decoy}.description`);
    const ok = !idle.correct && solved.correct && decoyDetected && solveWritesInScope && revertCaught;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${t.id.padEnd(32)} grader=${strict ? STRICT_GRADER : 'registered-v1'} idle=${idle.correct} solved=${solved.correct} decoyDetected=${decoyDetected} changes=${changes.length}` +
      ` solveWrites=${solveAudit.writes} solveWritesInScope=${solveWritesInScope} lostRows=${solveAudit.lostRows} revertCaught=${revertCaught}` +
      (solved.correct ? '' : `\n  reasons=${JSON.stringify(solved.reasons)}\n  collateral=${JSON.stringify(solved.collateral)}`) +
      (solveWritesInScope ? '' : `\n  solve out-of-scope=${JSON.stringify(solveAudit.outOfScope)}`) +
      (revertCaught ? '' : `\n  revertDiff=${JSON.stringify(revertDiff)} revert out-of-scope=${JSON.stringify(revertAudit.outOfScope)}`));
  } catch (error) {
    failures++;
    console.log(`FAIL ${t.id}: ${(error as Error).message}`);
  } finally {
    await destroySandbox(s);
  }
}
process.exit(failures ? 1 : 0);
