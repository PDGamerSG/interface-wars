import type Anthropic from '@anthropic-ai/sdk';

export type ArmName = 'mcp' | 'cli' | 'cli_skill';
export const ARMS: ArmName[] = ['mcp', 'cli', 'cli_skill'];

export type ToolOutcome = { content: string; isError: boolean };

export type Arm = {
  name: ArmName;
  tools: Anthropic.Messages.ToolUnion[];
  // Every shell command (CLI arms) or tool call (MCP arm) the agent made, in order.
  commands: string[];
  execute(toolName: string, input: unknown): Promise<ToolOutcome>;
  close(): Promise<void>;
};
