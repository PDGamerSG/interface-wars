import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNS = join(ROOT, 'runs');
export const LAB_FILE = join(RUNS, 'lab.local.json');

// Load .env when this module is first imported. Other modules read process.env into constants at import
// time (for example IW_MODEL in agent/loop.ts), so a later loadEnvFile() call in an entry script is too late.
loadEnvFile();

// Host-side URLs (the runner, verifier and MCP client run on the host).
export const FLAGSMITH_URL = process.env.IW_FLAGSMITH_URL ?? 'http://127.0.0.1:8300';
export const MCP_URL = process.env.IW_MCP_URL ?? 'http://127.0.0.1:8301/mcp';
// Docker Compose project of the lab stack (infra/compose.yml).
export const COMPOSE_PROJECT = process.env.IW_COMPOSE_PROJECT ?? 'interface-wars';
// CLI-arm containers join only this internal network, whose other member is the Flagsmith API container.
export const CLI_NETWORK = process.env.IW_CLI_NETWORK ?? `${COMPOSE_PROJECT}_cli-sandbox`;
// URL the CLI sees from inside its sandbox container.
export const FLAGSMITH_URL_FROM_CONTAINER = process.env.IW_FLAGSMITH_URL_CONTAINER ?? 'http://flagsmith:8000';

export type Lab = {
  admin: { email: string; password: string; token: string };
  control: {
    organisationId: number;
    projectId: number;
    environmentKey: string;
    environmentId: number;
    serverKey: string;
    masterKey: string;
  };
  experiment?: {
    featureId: number;
    experimentId: number;
    metricIds: Record<string, number>;
    optionIds: Record<string, number>;
  };
};

export function loadEnvFile() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[2] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

export function readLab(): Lab {
  if (!existsSync(LAB_FILE)) throw new Error('Lab not bootstrapped. Run: npm run lab:up');
  return JSON.parse(readFileSync(LAB_FILE, 'utf8'));
}

export function writeLab(lab: Lab) {
  mkdirSync(dirname(LAB_FILE), { recursive: true });
  writeFileSync(LAB_FILE, JSON.stringify(lab, null, 2));
}
