// The assignment journal contains only experiment evidence. Credentials live in a separate local file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getManifest, manifestHash } from '../experiment/manifest.ts';
import { Rng, TEMPLATES } from '../jobs/catalog.ts';
import { ROOT } from '../lab/config.ts';
import { writeJson } from '../agent/project.ts';

export const manifest = getManifest('mcp-guidance-v1');
export const design = manifest.matched!;
export const arms = ['mcp', 'mcp_guided'] as const;
export type StudyArm = typeof arms[number];
export type Phase = 'pilot' | 'registered';
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const toolHash = 'df18f43da87d22b57944399cc74d60415fdd3c38cb2ddda71bb35b70cfda9bf7';
export const fingerprint = hash(JSON.stringify([
  manifestHash(manifest), toolHash, hash(readFileSync(join(ROOT, 'prereg/MCP_GUIDANCE_V1.md'))), hash(readFileSync(join(ROOT, 'src/jobs/catalog.ts'))),
]));
export const guide = readFileSync(join(ROOT, manifest.arms.find(a => a.id === 'mcp_guided')!.guide!), 'utf8');

export function matchedCase(phase: Phase, rank: number) {
  if (!Number.isSafeInteger(rank) || rank < 0) throw new Error('Invalid case rank');
  const caseSeed = `${manifest.id}/${phase}/${rank}`;
  const templates = manifest.jobPack.templateIds;
  const template = TEMPLATES.find(t => t.id === templates[rank % templates.length])!;
  const job = template.render(new Rng(caseSeed));
  const caseHash = hash(JSON.stringify([job.template, job.task, job.seed]));
  return { caseSeed, caseHash, job };
}

export type Outcome = {
  outcome: string; correct: boolean; scoped: boolean; costUsd: number; turns: number; toolCalls: number; toolErrors: number;
};
export type Assignment = {
  id: string; arm: StudyArm; rank: number; template: string; caseHash: string; caseSeed: string; source: 'forced' | 'flag';
  exposure: 'none' | 'pending' | 'sending' | 'sent'; metrics: Assignment['exposure'];
  attempts: { startedAt: string; state: 'running' | 'retry' | 'graded'; detail?: string }[];
  result?: Outcome;
};
export type Journal = { phase: Phase; synthetic: boolean; fingerprint: string; rows: Assignment[]; stop?: string };
type Ports = {
  assign(id: string): Promise<StudyArm>;
  deliver(row: Assignment, kind: 'exposure' | 'metrics', interrupted: boolean): Promise<void>;
  execute(row: Assignment, job: ReturnType<typeof matchedCase>['job']): Promise<Outcome>;
  beforeTrial?(): Promise<void>;
};
export const phaseSize = (phase: Phase) => phase === 'pilot' ? 2 * design.pilotPairs : design.identities;
export const identity = (phase: Phase, synthetic: boolean, i: number) => `${manifest.id}${synthetic ? '-dry' : ''}-${phase}-${String(i).padStart(3, '0')}`;

export function readJournal(dir: string, phase: Phase, synthetic: boolean): Journal {
  const file = join(dir, phase, 'assignments.json');
  const journal: Journal = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { phase, synthetic, fingerprint, rows: [] };
  if (journal.phase !== phase || journal.synthetic !== synthetic || journal.fingerprint !== fingerprint) throw new Error('Study fingerprint or phase differs from saved journal');
  const counts = { mcp: 0, mcp_guided: 0 };
  for (const [i, r] of journal.rows.entries()) {
    if (r.id !== identity(phase, synthetic, i) || !arms.includes(r.arm) || r.rank !== counts[r.arm]++) throw new Error('Invalid assignment order or identity');
    const c = matchedCase(phase, r.rank);
    if (c.caseHash !== r.caseHash || c.caseSeed !== r.caseSeed || c.job.template !== r.template) throw new Error('Saved case differs from its registered seed');
  }
  return journal;
}

export async function runPhase(dir: string, phase: Phase, synthetic: boolean, ports: Ports, limit = phaseSize(phase)) {
  const path = join(dir, phase);
  mkdirSync(path, { recursive: true });
  const journal = readJournal(dir, phase, synthetic);
  const save = () => writeJson(join(path, 'assignments.json'), journal);
  async function send(row: Assignment, kind: 'exposure' | 'metrics') {
    if (row[kind] === 'none' || row[kind] === 'sent') return;
    const interrupted = row[kind] === 'sending';
    row[kind] = 'sending'; save();
    await ports.deliver(row, kind, interrupted);
    row[kind] = 'sent'; save();
  }
  delete journal.stop;
  try {
    for (let i = 0; i < Math.min(limit, phaseSize(phase)); i++) {
      let row = journal.rows[i];
      if (row?.result && ['none', 'sent'].includes(row.metrics)) continue;
      await ports.beforeTrial?.();
      if (!row) {
        const id = identity(phase, synthetic, i);
        const arm = phase === 'pilot' ? arms[(i + Math.floor(i / 2)) % 2] : await ports.assign(id);
        if (!arms.includes(arm)) throw new Error('Flag did not assign a registered arm');
        const rank = journal.rows.filter(r => r.arm === arm).length;
        const { caseSeed, caseHash, job } = matchedCase(phase, rank);
        row = { id, arm, rank, template: job.template, caseHash, caseSeed, source: phase === 'pilot' ? 'forced' : 'flag',
          exposure: phase === 'pilot' ? 'none' : 'pending', metrics: phase === 'pilot' ? 'none' : 'pending', attempts: [] };
        journal.rows.push(row); save();
      }
      await send(row, 'exposure');
      if (!row.result) {
        const prev = row.attempts.at(-1);
        if (prev?.state === 'running') { prev.state = 'retry'; prev.detail = 'Interrupted before a graded outcome was committed'; }
        row.attempts.push({ startedAt: new Date().toISOString(), state: 'running' }); save();
        try {
          row.result = await ports.execute(row, matchedCase(phase, row.rank).job);
          row.attempts.at(-1)!.state = 'graded';
          save();
          console.log(`${row.id} ${row.arm} case=${row.rank} ${row.template} ${row.result.outcome}`);
        } catch (error) {
          row.attempts.at(-1)!.state = 'retry';
          row.attempts.at(-1)!.detail = (error as Error).message;
          throw error;
        }
      }
      await send(row, 'metrics');
    }
  } catch (error) {
    journal.stop = (error as Error).message; save(); throw error;
  }
  save();
  return journal;
}
