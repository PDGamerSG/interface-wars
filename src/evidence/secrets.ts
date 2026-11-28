// Credential detection for anything this repository publishes: tracked files, trial records and the web export.
// The redactor (redact.ts) replaces credentials; this module only reports them, by rule name and position, and
// never echoes the matched value.
import { createHash } from 'node:crypto';

const SHORTUUID = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Flagsmith 2.295.2 issues environment keys as shortuuid-encoded UUIDv4 values. Checking the version and variant
// bits separates real keys from ordinary 22-character words in CLI help or tool output.
export function isEnvironmentKey(value: string): boolean {
  if (value.length !== 22) return false;
  let uuid = 0n;
  for (const char of value) {
    const digit = SHORTUUID.indexOf(char);
    if (digit < 0) return false;
    uuid = uuid * 57n + BigInt(digit);
  }
  return uuid < (1n << 128n) && ((uuid >> 76n) & 15n) === 4n && ((uuid >> 62n) & 3n) === 2n;
}

const ENV_KEY = /(?<![a-zA-Z0-9])(?:ser\.)?[2-9A-HJ-NP-Za-km-z]{22}(?![a-zA-Z0-9])/g;

const RULES: Array<[name: string, pattern: RegExp]> = [
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{10,}/g],
  ['flagsmith-api-key-header', /Api-Key [A-Za-z0-9]{12,}/g],
  ['flagsmith-cli-key-variable', /FLAGSMITH_API_KEY_[A-Za-z0-9_]+=(?!\[env-|\[REDACTED\])\S{8,}/g],
  ['flagsmith-admin-token', /Token [0-9a-f]{40}\b/g],
  // A template placeholder such as "${key}" in source code is not a value.
  ['unredacted-key-field', /"(?:environment_api_key|api_key|server_key|master_key)"\s*:\s*"(?!\[env-|\[REDACTED\]|\$\{)[^"]+"/gi],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
];

// Synthetic fixtures that exercise the detector and redactor. No Flagsmith server issued them.
const FIXTURE_DIGESTS = new Set(['ab61f66b0a2bd0cc464eed3287b388b2ee8237534f1a004fdf44fedc310e5564']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export type CredentialHit = { rule: string; index: number; length: number };

export function findCredentials(text: string, allowFixtures = false): CredentialHit[] {
  const hits: CredentialHit[] = [];
  const allowed = (value: string) => allowFixtures && FIXTURE_DIGESTS.has(digest(value));
  for (const [rule, pattern] of RULES) {
    for (const match of text.matchAll(pattern)) hits.push({ rule, index: match.index, length: match[0].length });
  }
  for (const match of text.matchAll(ENV_KEY)) {
    const server = match[0].startsWith('ser.');
    const key = server ? match[0].slice(4) : match[0];
    if (isEnvironmentKey(key) && !allowed(key)) {
      hits.push({ rule: server ? 'flagsmith-server-key' : 'flagsmith-environment-key', index: match.index, length: match[0].length });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}
