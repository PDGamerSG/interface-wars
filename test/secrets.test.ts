// The publication scan: real Flagsmith key shapes and common credential formats are found, ordinary text is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCredentials, isEnvironmentKey } from '../src/evidence/secrets.ts';

const fixtureKey = 'Qn8RZQxiPBsQNut6Tq6qsB';
const rules = (text: string, allowFixtures = false) => findCredentials(text, allowFixtures).map((hit) => hit.rule);

test('a shortuuid UUIDv4 environment key is detected; other 22-character words are not', () => {
  assert.equal(isEnvironmentKey(fixtureKey), true);
  assert.equal(isEnvironmentKey('abcdefghijkmnopqrstuvw'), false);
  assert.equal(isEnvironmentKey('short'), false);
  assert.deepEqual(rules(`flagsmith api --environment-key ${fixtureKey}`), ['flagsmith-environment-key']);
  assert.deepEqual(rules(`"key":"ser.${fixtureKey}"`), ['flagsmith-server-key']);
  assert.deepEqual(rules('the flag_with_a_long_name stays readable'), []);
});

test('registered synthetic fixtures pass only where fixtures are allowed', () => {
  assert.deepEqual(rules(fixtureKey, true), []);
  assert.deepEqual(rules(fixtureKey, false), ['flagsmith-environment-key']);
});

// Samples are assembled at run time so this file does not itself trip the repository scan.
test('common credential formats are detected and redaction labels are not', () => {
  const samples: Record<string, string> = {
    'anthropic-key': 'ANTHROPIC_API_KEY=' + ['sk', 'ant', 'api03', 'abcdefghijklmnop'].join('-'),
    'flagsmith-api-key-header': 'Authorization: ' + ['Api-Key', 'abcdef1234567890'].join(' '),
    'flagsmith-cli-key-variable': ['FLAGSMITH_API_KEY_host_docker_internal_8300', 'abcdefgh12345678'].join('='),
    'flagsmith-admin-token': 'Authorization: ' + ['Token', 'a1'.repeat(20)].join(' '),
    'unredacted-key-field': '{"environment_api_key"' + ':"plain-value"}',
    'aws-access-key-id': 'AKIA' + 'ABCDEFGHIJKLMNOP',
    'github-token': 'ghp_' + 'a'.repeat(36),
    'private-key-block': '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  };
  for (const [rule, sample] of Object.entries(samples)) assert.ok(rules(sample).includes(rule), rule);
  assert.deepEqual(rules('{"environment_api_key":"[env-ab61f66b0a2bd0cc]","api_key":"[REDACTED]"}'), []);
  assert.deepEqual(rules('FLAGSMITH_API_KEY_host=[REDACTED]'), []);
});
