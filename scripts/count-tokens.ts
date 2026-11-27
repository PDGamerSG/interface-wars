// Counts the input tokens each arm's interface adds to every request, with the Messages API token counter
// (free): the MCP tool list, the bash tool, and the skill file as the agent reads it. Writes runs/interface-tokens.json.
//   node scripts/count-tokens.ts
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_URL, ROOT, readLab } from '../src/lab/config.ts';
import { MODEL } from '../src/agent/loop.ts';

const client = new Anthropic();
const lab = readLab();
const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'x' }];
const count = async (extra: Partial<Anthropic.MessageCountTokensParams>) =>
  (await client.messages.countTokens({ model: MODEL, messages, ...extra } as Anthropic.MessageCountTokensParams)).input_tokens;

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Api-Key ${lab.control.masterKey}` } } });
const mcp = new Client({ name: 'count-tokens', version: '1.0.0' });
await mcp.connect(transport);
const tools = (await mcp.listTools()).tools
  .map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema as Anthropic.Tool.InputSchema }))
  .sort((a, b) => a.name.localeCompare(b.name));
await mcp.close();

const skill = readFileSync(join(ROOT, 'skills', 'flagsmith-ops', 'SKILL.md'), 'utf8');
const base = await count({});
const result = {
  model: MODEL,
  mcpTools: { tools: tools.length, schemaBytes: JSON.stringify(tools).length, tokens: (await count({ tools })) - base },
  bashTool: { tokens: (await count({ tools: [{ type: 'bash_20250124', name: 'bash' }] })) - base },
  skill: { bytes: Buffer.byteLength(skill), tokens: (await count({ messages: [{ role: 'user', content: skill }] })) - base },
};
writeFileSync(join(ROOT, "runs", "interface-tokens.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
