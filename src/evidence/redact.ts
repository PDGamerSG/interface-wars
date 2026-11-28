// Trial data contains credentials in structured arguments, shell commands and clipped tool output.
// A sandbox environment keeps the same opaque label everywhere, including in URL paths.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { LAB_FILE, readLab } from '../lab/config.ts';

const MASK = '[REDACTED]';
const ENV_LABEL = /^\[env-[0-9a-f]{16}\]$/;
const SHORTUUID = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ENV_KEY = /(?<![a-zA-Z0-9])(?:ser\.)?[2-9A-HJ-NP-Za-km-z]{22}(?![a-zA-Z0-9])/g;
const FIELD_NAME = '(?:(?:environment|server|master)[_ -]?(?:api[_ -]?)?key|api[_ -]?key|(?:access[_ -]?)?token|authorization|password|client[_ -]?secret|secret)';
const SECRET_FIELD = new RegExp('^' + FIELD_NAME + '$', 'i');
// Optional backslashes preserve the quoting of a JSON document embedded in a tool result.
const QUOTED_FIELD = new RegExp(`((?:\\\\*["'])${FIELD_NAME}(?:\\\\*["'])\\s*:\\s*(?:\\\\*["']))([^\\\\"'\\r\\n]+)(?=\\\\*["']|$)`, 'gi');
const AUTH = /(\bAuthorization\s*[:=]\s*["\']?(?:(?:Api-Key|Bearer|Token)\s+)?|\b(?:Api-Key|Bearer)\s+|\bToken\s+(?=[a-f0-9]{40}\b)|\bX-Environment-Key\s*:\s*)([A-Za-z0-9._~+/=-]{8,})/gi;
const SHELL_KEY = /(\b(?:FLAGSMITH_API_KEY(?:_[A-Za-z0-9_]+)?|ANTHROPIC_API_KEY)\s*=\s*["']?|--api-key[= ]+["']?)([A-Za-z0-9._~+/=-]{8,})/gi;

// Flagsmith 2.295.2 issues shortuuid-encoded UUIDv4 environment keys. Checking the UUID bits
// avoids treating ordinary 22-character words in CLI help or tool output as credentials.
function environmentLabel(value: string): string | undefined {
  if (value.length !== 22) return undefined;
  let uuid = 0n;
  for (const char of value) {
    const digit = SHORTUUID.indexOf(char);
    if (digit < 0) return undefined;
    uuid = uuid * 57n + BigInt(digit);
  }
  if (uuid >= (1n << 128n) || ((uuid >> 76n) & 15n) !== 4n || ((uuid >> 62n) & 3n) !== 2n) return undefined;
  return '[env-' + createHash('sha256').update(value).digest('hex').slice(0, 16) + ']';
}

export function localCredentials(): string[] {
  const values = [process.env.ANTHROPIC_API_KEY];
  if (existsSync(LAB_FILE)) {
    const { admin, control } = readLab();
    values.push(admin.password, admin.token, control.masterKey, control.environmentKey, control.serverKey);
  }
  return values.filter((value): value is string => Boolean(value));
}

export function redactCredentials<T>(record: T, known: readonly string[] = []): T {
  const secrets = new Map<string, string>();
  function remember(text: string) {
    if (!text || text === MASK || ENV_LABEL.test(text)) return text;
    const label = environmentLabel(text) ?? MASK;
    secrets.set(text, label);
    return label;
  }
  for (const secret of known) remember(secret);

  function collect(value: unknown, field = '') {
    if (typeof value === 'string') {
      if (SECRET_FIELD.test(field)) remember(value);
      for (const match of value.matchAll(QUOTED_FIELD)) remember(match[2]);
      for (const match of value.matchAll(AUTH)) remember(match[2]);
      for (const match of value.matchAll(SHELL_KEY)) remember(match[2]);
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, field);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) collect(item, key);
    }
  }
  collect(record);
  // Avoid substring replacement of short field values (e.g. "key" in a help example).
  const literals = [...secrets].filter(([s]) => s.length >= 8).sort(([a], [b]) => b.length - a.length);

  function visit(value: unknown, field = ''): unknown {
    if (typeof value === 'string') {
      if (SECRET_FIELD.test(field)) return secrets.get(value) ?? value;
      let text = value;
      for (const [secret, label] of literals) text = text.replaceAll(secret, () => label);
      return text.replace(QUOTED_FIELD, (_, prefix: string, key: string) => prefix + (secrets.get(key) ?? key))
        .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}/g, MASK)
        .replace(ENV_KEY, key => key.startsWith('ser.') ? MASK : environmentLabel(key) ?? key);
    }
    if (Array.isArray(value)) return value.map(item => visit(item, field));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, key)]));
    }
    return value;
  }
  return visit(record) as T;
}
