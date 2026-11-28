// The archived CLI-arm trials ran before the sandbox joined an internal network (see prereg/DEVIATIONS.md).
// This audit checks the recorded commands: no raw /dev/tcp or /dev/udp socket, and every attempt to use an
// HTTP client aimed at Flagsmith's own address and failed because the client is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNS = ['main', 'pilot', 'after-ship', 'smoke-cli', 'smoke-skill'];
const CLIENT = /(?:^|[\s;|&(`$])(curl|wget|nc|python3?|node|perl|openssl|telnet)(?=\s|$)/g;
const FLAGSMITH_FROM_ARCHIVED_CONTAINER = 'host.docker.internal:8300';

type Call = { name: string; input?: { command?: string }; output?: string };
type Trial = { trialId: string; arm: string; transcript: { calls?: Call[] }[] };

function cliCalls() {
  const calls: { trial: string; command: string; output: string }[] = [];
  for (const run of RUNS) {
    const dir = join('runs', run, 'trials');
    for (const file of readdirSync(dir)) {
      const trial = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Trial;
      if (!trial.arm.startsWith('cli')) continue;
      for (const turn of trial.transcript) {
        for (const call of turn.calls ?? []) calls.push({ trial: trial.trialId, command: call.input?.command ?? '', output: call.output ?? '' });
      }
    }
  }
  return calls;
}

test('no archived CLI-arm command opened a raw /dev/tcp or /dev/udp socket', () => {
  const calls = cliCalls();
  assert.ok(calls.length > 1000, `expected the full archive, read ${calls.length} calls`);
  const raw = calls.filter((c) => /\/dev\/(tcp|udp)\//.test(c.command));
  assert.deepEqual(raw.map((c) => c.trial), []);
});

test('archived HTTP-client attempts targeted only Flagsmith and failed because the client is absent', () => {
  const attempts = cliCalls().filter((c) => [...c.command.matchAll(CLIENT)].length > 0);
  const trials = new Set(attempts.map((c) => c.trial));
  assert.equal(trials.size, 9, `trials with HTTP-client attempts: ${[...trials].join(', ')}`);
  for (const attempt of attempts) {
    const hosts = [...attempt.command.matchAll(/https?:\/\/([A-Za-z0-9.-]+(?::\d+)?)/g)].map((m) => m[1]);
    assert.ok(hosts.every((h) => h === FLAGSMITH_FROM_ARCHIVED_CONTAINER), `${attempt.trial} targeted ${hosts.join(', ')}`);
    for (const [, client] of attempt.command.matchAll(CLIENT)) {
      assert.match(attempt.output, new RegExp(`${client}: command not found`), `${attempt.trial} ran ${client}`);
    }
  }
});
