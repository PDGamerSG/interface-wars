import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentials } from '../src/evidence/redact.ts';

const historicalEnvironmentKey = 'Qn8RZQxiPBsQNut6Tq6qsB';
const historicalServerKey = `ser.${historicalEnvironmentKey}`;

test('redacts historical sandbox keys in fields and embedded transcripts', () => {
  const record = {
    command: `flagsmith api --environment-key ${historicalEnvironmentKey}`,
    transcript: `HTTP 200 {"environment_api_key":"${historicalEnvironmentKey}","server_key":"${historicalServerKey}"}`,
    environment_api_key: historicalEnvironmentKey,
  };
  const safe = redactCredentials(record);
  assert.deepEqual(safe, {
    command: 'flagsmith api --environment-key [env-ab61f66b0a2bd0cc]',
    transcript: 'HTTP 200 {"environment_api_key":"[env-ab61f66b0a2bd0cc]","server_key":"[REDACTED]"}',
    environment_api_key: '[env-ab61f66b0a2bd0cc]',
  });
  assert.doesNotMatch(JSON.stringify(safe), /Qn8RZQxiPBsQNut6Tq6qsB/);
  assert.doesNotMatch(JSON.stringify(safe), /ser\.Qn8RZQxiPBsQNut6Tq6qsB/);
});

test('redacts unknown credential fields without a lab file', () => {
  const safe = redactCredentials({ api_key: 'historical-secret-value-123' });
  assert.deepEqual(safe, { api_key: '[REDACTED]' });
});
