#!/usr/bin/env node
import { buildEvidence, explain, matrix, recoveries, schemaFailures } from '../src/evidence/index.ts';

const args = process.argv.slice(2);
const command = args.shift();
let run = args.shift() ?? 'main';
let rest = args;
if (command === 'explain') {
  const trialId = run;
  run = rest.shift() ?? 'main';
  rest = [trialId, ...rest];
}
const outputIndex = rest.indexOf('--output');
const output = outputIndex >= 0 ? rest[outputIndex + 1] : undefined;
const path = output ?? `runs/${run}/evidence.sqlite`;

switch (command) {
  case 'build':
    console.log(JSON.stringify(buildEvidence(run, path), null, 2));
    break;
  case 'matrix':
    console.table(matrix(path));
    break;
  case 'schema-failures':
    console.log(JSON.stringify(schemaFailures(path), null, 2));
    break;
  case 'recoveries':
    console.log(JSON.stringify(recoveries(path), null, 2));
    break;
  case 'explain': {
    const trialId = rest.find((item) => !item.startsWith('--'));
    if (!trialId) throw new Error('Usage: node scripts/evidence.ts explain <trial-id> [--output path]');
    console.log(JSON.stringify(explain(trialId, path), null, 2));
    break;
  }
  default:
    console.log('Usage: node scripts/evidence.ts build|matrix|schema-failures|recoveries|explain <trial-id> [run] [--output path]');
}
