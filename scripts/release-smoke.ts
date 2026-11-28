// Exercise the installed skill against one disposable Flagsmith organisation through the official CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, FLAGSMITH_URL } from '../src/lab/config.ts';
import { createSandbox } from '../src/lab/sandbox.ts';

const id = 'release-smoke-' + randomUUID().slice(0, 8);
const temp = mkdtempSync(join(tmpdir(), id));
const skill = join(temp, 'flagsmith-release-gate');
const script = join(skill, 'scripts/release.ts');
const store = (file: string, data: unknown) => writeFileSync(join(temp, file), JSON.stringify(data), { mode: 0o600 });

function invoke(binary: string, args: string[], env: NodeJS.ProcessEnv, input?: unknown, expected = 0) {
  const result = spawnSync(binary, args, { cwd: temp, env, encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), timeout: 60_000 });
  // CLI stderr can contain the environment key embedded in the API route.
  if (result.status !== expected) {
    const detail = binary === process.execPath ? result.stderr.replaceAll(env.FLAGSMITH_ENVIRONMENT!, '[environment]') : '';
    throw Error(`${binary === process.execPath ? 'release ' + args[1] : 'flagsmith ' + args[0]} exited ${result.status} (expected ${expected}). ${detail}`);
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}

const sandbox = await createSandbox(id, {
  features: [
    { name: 'checkout_copy', value: 'Checkout', enabledByDefault: true, variants: [{ key: 'pay', value: 'Pay', pct: 0 }] },
    { name: 'release_ops_enabled', enabledByDefault: true },
    { name: 'release_spend_cap_usd', value: '2', enabledByDefault: true },
  ],
  metrics: [{ name: 'checkout', event: 'checkout', direction: 'up', aggregation: 'occurrence' }],
  segments: [{ name: 'beta', trait: 'plan', value: 'beta' }],
});
try {
  cpSync(join(ROOT, 'skills/flagsmith-release-gate'), skill, { recursive: true });
  const envKey = sandbox.env.Production.key;
  const env: NodeJS.ProcessEnv = {
    ...process.env, FLAGSMITH_API_URL: FLAGSMITH_URL, FLAGSMITH_SDK_API_URL: FLAGSMITH_URL,
    FLAGSMITH_ENVIRONMENT: envKey, FLAGSMITH_PROJECT: String(sandbox.projectId), FLAGSMITH_ORGANISATION: String(sandbox.organisationId),
    [`FLAGSMITH_API_KEY_${new URL(FLAGSMITH_URL).host.replace(/[^A-Za-z0-9]/g, '_')}`]: sandbox.apiKey,
    FLAGSMITH_NO_INPUT: '1', IW_MAX_SPEND_USD: '15', IW_RELEASE_SPEND_FILE: join(temp, 'spend.json'), IW_RELEASE_SIGNERS: join(temp, 'trust.json'),
  };
  const cli = (args: string[], input?: unknown) => invoke('flagsmith', args, env, input);
  const release = (args: string[], expected = 0) => invoke(process.execPath, [script, ...args], env, undefined, expected);
  store('spend.json', { totalUsd: 0 });
  const metrics = cli(['api', `api/v1/environments/${envKey}/experiment-metrics/`]);
  const base = `api/v1/environments/${envKey}/experiments/`;
  const draft = cli(['api', base, '-X', 'POST', '--input', '-'], {
    name: 'Release rehearsal', hypothesis: 'A shorter label improves checkout.', feature: sandbox.ids.features.checkout_copy,
    metrics: [{ metric: metrics.results[0].id, expected_direction: 'increase' }],
    experiment_rollout: { enabled: false, rollout_percentage: 0, feature_state_value: { type: 'string', value: 'Checkout' },
      multivariate_feature_state_values: [{ multivariate_feature_option: sandbox.ids.options.checkout_copy.pay, percentage_allocation: 100 }],
      audience: { match: 'any', segment_ids: [sandbox.ids.segments.beta] } },
  });
  const detail = () => cli(['api', base + draft.id + '/']);
  const stage = { percentage: 100, probes: [
    { cohort: 'member', identifier: id + '-in', traits: ['plan=beta'], enabled: true, value: 'Pay' },
    { cohort: 'nonmember', identifier: id + '-out', traits: ['plan=free'], enabled: true, value: 'Checkout' },
  ] };
  store('stages.json', [stage]);
  const plan = release(['plan', String(draft.id), 'stages.json']);
  store('plan.json', plan);
  const trust: Record<string, string> = {};
  for (const name of ['fixture-operator', 'fixture-reviewer']) {
    const pair = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    env.IW_RELEASE_SIGNING_KEY = join(temp, name + '.pem');
    writeFileSync(env.IW_RELEASE_SIGNING_KEY, pair.privateKey, { mode: 0o600 });
    trust[name] = pair.publicKey;
    store(name + '.json', release(['sign', 'plan.json', name]));
  }
  store('trust.json', trust);
  const args = ['plan.json', '100', 'fixture-operator.json', 'fixture-reviewer.json'];
  release(['apply', ...args.slice(0, 3), 'fixture-operator.json'], 1);
  assert.equal(detail().status, 'created');
  assert.equal(detail().experiment_rollout.enabled, false);
  const result = release(['apply', ...args]);
  assert.equal(result.status, 'APPLIED');
  assert.deepEqual(result.probes.map((p: { matched: boolean }) => p.matched), [true, true]);
  assert.equal(release(['apply', ...args]).status, 'ALREADY_APPLIED');
  assert.equal(release(['rollback', ...args]).status, 'ROLLED_BACK');
  const restored = detail();
  assert.equal(restored.status, 'running');
  assert.equal(restored.experiment_rollout.enabled, false);
  assert.equal(restored.experiment_rollout.rollout_percentage, 0);
  const member = cli(['evaluate', 'checkout_copy', '--identity', id + '-in', '--trait', 'plan=beta', '--json']);
  assert.equal(member.value, 'Checkout');
  console.log('Flagsmith CLI rehearsal passed: disabled draft, duplicate approval denied, member=Pay, nonmember=Checkout, idempotent promotion, rollback to zero, member=Checkout.');
} finally {
  // This ID was allocated by this invocation; no lookup by a user-supplied name or experiment.
  await sandbox.admin.del(`/api/v1/organisations/${sandbox.organisationId}/`);
  rmSync(temp, { recursive: true, force: true });
}
