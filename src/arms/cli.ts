// CLI arms: the agent gets one tool, Anthropic's bash tool, executed inside a throwaway container that
// holds only the Flagsmith CLI, jq and coreutils. The cli_skill arm also gets the skill mounted at /skills.
// The container joins only the lab's internal cli-sandbox network, so bash (including /dev/tcp sockets)
// can reach the Flagsmith API and nothing else: no MCP server, no Docker host, no internet.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { CLI_NETWORK, FLAGSMITH_URL_FROM_CONTAINER, ROOT } from '../lab/config.ts';
import type { Sandbox } from '../lab/sandbox.ts';
import type { Arm } from './types.ts';

const run = promisify(execFile);
export const CLI_IMAGE = 'interface-wars-cli:2.0.0';
export const OUTPUT_LIMIT = 30_000;

function hostKeyVar(url: string) {
  const host = new URL(url).host.replace(/[^A-Za-z0-9]/g, '_');
  return `FLAGSMITH_API_KEY_${host}`;
}

export async function openCliArm(sandbox: Sandbox, withSkill: boolean): Promise<Arm> {
  const name = `iw-${sandbox.trialId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 60);
  const args = [
    'run', '-d', '--rm', '--name', name,
    '--network', CLI_NETWORK,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--cpus', '0.5',
    '-e', `FLAGSMITH_API_URL=${FLAGSMITH_URL_FROM_CONTAINER}`,
    '-e', `${hostKeyVar(FLAGSMITH_URL_FROM_CONTAINER)}=${sandbox.apiKey}`,
    '-e', `FLAGSMITH_ORGANISATION=${sandbox.organisationId}`,
    '-e', `FLAGSMITH_PROJECT=${sandbox.projectId}`,
  ];
  if (withSkill) args.push('-v', `${join(ROOT, 'skills')}:/skills:ro`);
  args.push(CLI_IMAGE);
  await run('docker', args);

  const tools: Anthropic.Messages.ToolUnion[] = [{ type: 'bash_20250124', name: 'bash' }];
  const commands: string[] = [];

  return {
    name: withSkill ? 'cli_skill' : 'cli',
    tools,
    commands,
    async execute(toolName, input) {
      if (toolName !== 'bash') return { content: `Unknown tool ${toolName}`, isError: true };
      const { command, restart } = input as { command?: string; restart?: boolean };
      if (restart) return { content: 'Shell restarted.', isError: false };
      if (!command) return { content: 'No command given.', isError: true };
      commands.push(command);
      try {
        const { stdout, stderr } = await run('docker', ['exec', name, 'bash', '-lc', command], { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 });
        const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim() || '(no output)';
        return { content: clip(out), isError: false };
      } catch (error: any) {
        const out = `${error.stdout ?? ''}${error.stderr ? `\n[stderr]\n${error.stderr}` : ''}`.trim();
        return { content: clip(`${out || error.message}\n[exit code ${error.code ?? 'unknown'}]`), isError: true };
      }
    },
    async close() {
      await run('docker', ['rm', '-f', name]).catch(() => {});
    },
  };
}

export function clip(text: string) {
  return text.length > OUTPUT_LIMIT ? text.slice(0, OUTPUT_LIMIT) + `\n[output truncated at ${OUTPUT_LIMIT} characters]` : text;
}
