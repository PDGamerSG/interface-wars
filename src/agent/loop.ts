// The agent harness: one manual Messages API tool loop, identical for every arm. Only the tool list and one
// paragraph of the system prompt differ by arm. The loop records every call, token and dollar so the
// experiment can compare arms on correctness, safety and cost.
import Anthropic from '@anthropic-ai/sdk';
import type { Arm } from '../arms/types.ts';
import type { Sandbox } from '../lab/sandbox.ts';
import { checkBudget, recordSpend } from './budget.ts';

export const MODEL = process.env.IW_MODEL ?? 'claude-haiku-5-5';
export const EFFORT = (process.env.IW_EFFORT ?? 'medium') as 'low' | 'medium' | 'high';
export const MAX_TURNS = Number(process.env.IW_MAX_TURNS ?? 30);

// USD per million tokens. Cache reads are 0.1x input; cache writes use the 5-minute TTL rate (1.25x input).
// Claude Haiku 5.5 has two rate cards: a request whose prompt (input + cache read + cache write) is over
// 100K tokens is billed entirely at the higher card. Long MCP trials can cross that line, so cost is
// computed per request, not from summed usage.
type Rates = { input: number; output: number; cacheRead: number };
const PRICES: Record<string, Rates & { long?: Rates & { above: number } }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 } },
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type TurnRecord = {
  turn: number;
  text: string;
  calls: { name: string; input: unknown; output: string; isError: boolean; ms: number }[];
  usage: Usage;
  costUsd: number;
  stopReason: string | null;
};
export type AgentResult = {
  outcome: 'done' | 'failed' | 'incomplete' | 'turn_limit' | 'refusal' | 'api_error';
  finalText: string;
  turns: TurnRecord[];
  usage: Usage;
  costUsd: number;
  toolCalls: number;
  toolErrors: number;
  ms: number;
};

export type FinalStatus = 'done' | 'failed' | 'incomplete';

// Only a standalone status line is authoritative. Phrases such as “DONE? No”
// and mixed DONE/FAILED explanations are incomplete reports.
export function classifyFinalText(text: string): FinalStatus {
  const done = /^\s*DONE:\s*.*$/m.test(text);
  const failed = /^\s*FAILED:\s*.*$/m.test(text);
  if (done === failed) return 'incomplete';
  return done ? 'done' : 'failed';
}

// Cost of one request. Pass the usage of a single response, never a sum over turns.
export function costOf(model: string, u: Usage) {
  const card = PRICES[model];
  if (!card) throw new Error(`No price card for model ${model}. Add it to PRICES in src/agent/loop.ts.`);
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const p = card.long && prompt > card.long.above ? card.long : card;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1_000_000;
}

const SKILL_DESCRIPTION =
  'Operate Flagsmith end to end with the Flagsmith CLI: flags, values, multivariate splits, segments and overrides, ' +
  'experiments and metrics (via `flagsmith api`), with read-back verification and change scoping. Use it for any Flagsmith task.';

export function systemPrompt(arm: Arm['name'], s: Sandbox) {
  const interfaces: Record<Arm['name'], string> = {
    mcp: 'You can use the Flagsmith MCP tools provided to you. They are already authenticated against this instance.',
    cli:
      'You have a bash shell with the Flagsmith CLI (`flagsmith`) already authenticated against this instance, with the ' +
      'organisation and project preselected. Run `flagsmith --help` to explore it. `jq` is installed.',
    cli_skill:
      'You have a bash shell with the Flagsmith CLI (`flagsmith`) already authenticated against this instance, with the ' +
      'organisation and project preselected. Run `flagsmith --help` to explore it. `jq` is installed.\n\n' +
      `Available skill: flagsmith-ops (file: /skills/flagsmith-ops/SKILL.md). ${SKILL_DESCRIPTION} ` +
      'Read the skill file before you start when the task matches its description.',
  };
  return [
    'You are an assistant to a release engineer and operate a self-hosted Flagsmith instance for an online shop.',
    `Organisation id: ${s.organisationId}. Project: "shop" (project id ${s.projectId}).`,
    `Environments: Development (environment key ${s.env.Development.key}, id ${s.env.Development.id}) and Production (environment key ${s.env.Production.key}, id ${s.env.Production.id}).`,
    '',
    interfaces[arm],
    '',
    'Do exactly what the task asks and change nothing it does not ask you to change. Production is live: be careful.',
    'When the task is done, check the result, then reply with one line that starts with DONE.',
    'If you cannot complete the task, reply with one line that starts with FAILED and the reason.',
  ].join('\n');
}

type AgentOptions = {
  model?: { id: string; effort: typeof EFFORT; maxTurns: number };
  guide?: string;
  billing?: { reserve(): void; settle(usd: number): void; rejected(error: unknown): void };
};

export async function runAgent(arm: Arm, sandbox: Sandbox, task: string, client = new Anthropic({ maxRetries: 6 }), options: AgentOptions = {}): Promise<AgentResult> {
  const model = options.model ?? { id: MODEL, effort: EFFORT, maxTurns: MAX_TURNS };
  const billing = options.billing ?? { reserve: checkBudget, settle: recordSpend, rejected() {} };
  const started = Date.now();
  const system = systemPrompt(arm.name, sandbox) + (options.guide ? '\n\n' + options.guide : '');
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }];
  const turns: TurnRecord[] = [];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let toolCalls = 0;
  let toolErrors = 0;
  let costUsd = 0;
  let finalText = '';
  let outcome: AgentResult['outcome'] = 'turn_limit';

  for (let turn = 1; turn <= model.maxTurns; turn++) {
    billing.reserve();
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: model.id,
        max_tokens: 16000,
        system,
        tools: arm.tools,
        messages,
        output_config: { effort: model.effort },
        cache_control: { type: 'ephemeral' },
      } as any);
    } catch (error) {
      billing.rejected(error);
      outcome = 'api_error';
      finalText = `API error: ${(error as Error).message}`;
      break;
    }
    const u: Usage = {
      input: response.usage.input_tokens ?? 0,
      output: response.usage.output_tokens ?? 0,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    };
    usage.input += u.input; usage.output += u.output; usage.cacheRead += u.cacheRead; usage.cacheWrite += u.cacheWrite;
    const turnCost = costOf(model.id, u);
    costUsd += turnCost;
    billing.settle(turnCost);

    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    const record: TurnRecord = { turn, text, calls: [], usage: u, costUsd: turnCost, stopReason: response.stop_reason };
    turns.push(record);
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'refusal') { outcome = 'refusal'; finalText = text; break; }
    if (response.stop_reason === 'pause_turn') continue;

    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) {
      finalText = text;
      if (response.stop_reason === 'max_tokens') {
        messages.push({ role: 'user', content: 'Continue.' });
        continue;
      }
      outcome = classifyFinalText(text);
      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const t0 = Date.now();
      const out = await arm.execute(use.name, use.input);
      toolCalls++;
      if (out.isError) toolErrors++;
      record.calls.push({ name: use.name, input: use.input, output: out.content.slice(0, 4000), isError: out.isError, ms: Date.now() - t0 });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: out.content, is_error: out.isError });
    }
    messages.push({ role: 'user', content: results });
  }

  return { outcome, finalText, turns, usage, costUsd, toolCalls, toolErrors, ms: Date.now() - started };
}
