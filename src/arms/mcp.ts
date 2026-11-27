// MCP arm: the agent gets the official Flagsmith MCP server's tools, unchanged, and nothing else (no shell).
// The harness is the MCP client: it lists the server's tools, passes their schemas to Claude as-is, and
// forwards each call. The session authenticates with the sandbox organisation's key only.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type Anthropic from '@anthropic-ai/sdk';
import { MCP_URL } from '../lab/config.ts';
import type { Sandbox } from '../lab/sandbox.ts';
import { clip } from './cli.ts';
import type { Arm } from './types.ts';

export async function openMcpArm(sandbox: Sandbox): Promise<Arm> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Api-Key ${sandbox.apiKey}` } },
  });
  const client = new Client({ name: 'interface-wars', version: '1.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  // Sorted so the tool list (and therefore the prompt cache prefix) is identical across trials.
  const tools: Anthropic.Tool[] = listed.tools
    .map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema as Anthropic.Tool.InputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const commands: string[] = [];

  return {
    name: 'mcp',
    tools,
    commands,
    async execute(toolName, input) {
      commands.push(`${toolName} ${JSON.stringify(input)}`);
      try {
        const result: any = await client.callTool({ name: toolName, arguments: (input ?? {}) as Record<string, unknown> }, undefined, { timeout: 90_000 });
        const text = (result.content ?? [])
          .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n') || '(no output)';
        return { content: clip(text), isError: Boolean(result.isError) };
      } catch (error) {
        return { content: clip(`MCP error: ${(error as Error).message}`), isError: true };
      }
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}
