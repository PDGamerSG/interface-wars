// Proves that the CLI-arm sandbox reaches the Flagsmith API and nothing else. Every probe runs through the
// same bash tool the agent gets, so it tests exactly what an agent could do, including raw /dev/tcp sockets.
// Needs the lab stack (npm run lab:up) and the CLI image (npm run cli:image). Exits non-zero on any failure.
import { execFileSync } from 'node:child_process';
import { openCliArm } from '../src/arms/cli.ts';
import { createSandbox, destroySandbox } from '../src/lab/sandbox.ts';
import { CLI_NETWORK, COMPOSE_PROJECT } from '../src/lab/config.ts';

type Probe = { name: string; command: string; expect: 'ok' | 'blocked'; check?: (output: string) => boolean };

function docker(args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function containerIp(service: string) {
  const id = docker(['compose', '-p', COMPOSE_PROJECT, 'ps', '-q', service]);
  if (!id) throw new Error(`No running ${service} container in compose project ${COMPOSE_PROJECT}`);
  return docker(['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', id]).split(/\s+/)[0];
}

// A raw TCP connect through bash's /dev/tcp. "connected" means the socket opened.
const socket = (host: string, port: number) =>
  `timeout 5 bash -c 'exec 3<>/dev/tcp/${host}/${port}' 2>&1 && echo connected`;

const network = JSON.parse(docker(['network', 'inspect', CLI_NETWORK]))[0];
const gateway: string | undefined = network.IPAM?.Config?.[0]?.Gateway;
const mcpIp = containerIp('flagsmith-mcp');
const postgresIp = containerIp('postgres');

const sandbox = await createSandbox(`isolation-${Date.now()}`, { features: [{ name: 'iw_isolation_probe' }] });
const arm = await openCliArm(sandbox, false);
let failures = 0;

const probes: Probe[] = [
  {
    name: 'Flagsmith CLI reads the sandbox project',
    command: `flagsmith api api/v1/projects/${sandbox.projectId}/ | jq -r .id`,
    expect: 'ok',
    check: (out) => out.trim() === String(sandbox.projectId),
  },
  // Same reach as `flagsmith api`, which the arm already allows. Listed so the boundary is explicit.
  { name: 'raw socket to the Flagsmith API (allowed, same as flagsmith api)', command: socket('flagsmith', 8000), expect: 'ok' },
  { name: 'raw socket to the MCP server by service name', command: socket('flagsmith-mcp', 8000), expect: 'blocked' },
  { name: `raw socket to the MCP server container (${mcpIp}:8000)`, command: socket(mcpIp, 8000), expect: 'blocked' },
  { name: `raw socket to Postgres (${postgresIp}:5432)`, command: socket(postgresIp, 5432), expect: 'blocked' },
  { name: 'raw socket to the Docker host name, MCP port', command: socket('host.docker.internal', 8301), expect: 'blocked' },
  { name: 'raw socket to the Docker host name, Flagsmith port', command: socket('host.docker.internal', 8300), expect: 'blocked' },
  ...(gateway
    ? [
        { name: `raw socket to the network gateway (${gateway}:8301)`, command: socket(gateway, 8301), expect: 'blocked' as const },
        { name: `raw socket to the network gateway (${gateway}:8300)`, command: socket(gateway, 8300), expect: 'blocked' as const },
      ]
    : []),
  { name: 'raw socket to a public IP (1.1.1.1:443)', command: socket('1.1.1.1', 443), expect: 'blocked' },
  { name: 'raw socket to a public IP (8.8.8.8:53)', command: socket('8.8.8.8', 53), expect: 'blocked' },
  {
    name: 'plain HTTP request to a public site over /dev/tcp',
    command: `timeout 5 bash -c 'exec 3<>/dev/tcp/example.com/80 && printf "GET / HTTP/1.0\\r\\nHost: example.com\\r\\n\\r\\n" >&3 && head -1 <&3' 2>&1 && echo connected`,
    expect: 'blocked',
  },
  {
    name: 'busybox wget to a public IP',
    command: 'timeout 5 busybox wget -q -T 3 -O /dev/null http://1.1.1.1/ 2>&1 && echo connected',
    expect: 'blocked',
  },
  {
    name: 'HTTP clients are absent (curl, wget, nc, python3, node, perl, openssl)',
    command: 'for c in curl wget nc python3 node perl openssl telnet; do command -v "$c"; done; echo checked',
    expect: 'ok',
    check: (out) => out.trim() === 'checked',
  },
];

try {
  const attached = docker(['inspect', '-f', '{{json .NetworkSettings.Networks}}', `iw-${sandbox.trialId}`]);
  const networks = Object.keys(JSON.parse(attached));
  const isolated = network.Internal === true && networks.length === 1 && networks[0] === CLI_NETWORK;
  const self = `iw-${sandbox.trialId}`;
  const current = JSON.parse(docker(['network', 'inspect', CLI_NETWORK]))[0];
  const members = Object.values(current.Containers ?? {}).map((c: any) => c.Name as string).filter((n) => n !== self);
  report(isolated, `container joins only ${CLI_NETWORK}, an internal network`, `networks=${networks.join(',')} internal=${network.Internal}`);
  const strangers = members.filter((n) => !/-flagsmith-\d+$/.test(n));
  report(strangers.length === 0, 'Flagsmith is the only other member of the network', strangers.join(', ') || 'none');

  for (const probe of probes) {
    const { content } = await arm.execute('bash', { command: probe.command });
    const connected = /(^|\n)connected\s*$/.test(content);
    const ok = probe.expect === 'ok' ? (probe.check ? probe.check(content) : connected) : !connected;
    report(ok, probe.name, `expected=${probe.expect} output=${JSON.stringify(content.slice(0, 160))}`);
  }
} finally {
  await arm.close();
  await destroySandbox(sandbox);
}

function report(ok: boolean, name: string, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n  ${detail}`}`);
}

console.log(failures ? `${failures} isolation check(s) failed` : 'CLI sandbox reaches Flagsmith only');
process.exit(failures ? 1 : 0);
