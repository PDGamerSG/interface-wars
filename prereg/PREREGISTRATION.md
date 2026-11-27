# Pre-registration: Interface Wars main run

Written and committed before the main run started. The git tag `prereg-v1` marks the exact code, job catalog,
skill and decision rule that the main run uses. Anything changed after this tag is reported as a deviation.

## Question

How should an AI agent operate Flagsmith? The Flagsmith team said on the Toggle Wars kickoff stream that they prefer
the CLI to the MCP server and think it is "more performant". Nobody had measured it. This experiment measures it, and
Flagsmith Experimentation runs the experiment.

## Hypotheses

- H1: An agent with the Flagsmith CLI (`cli`) completes more real Flagsmith jobs correctly than an agent with the
  official Flagsmith MCP server (`mcp`, the control).
- H2: The same CLI plus the `flagsmith-ops` Agent Skill (`cli_skill`) completes more jobs correctly than `mcp`.
- Neither arm may buy correctness with unsafe changes or higher cost (guardrails below).

## Arms

Flagsmith assigns each trial to an arm. Each trial is one Flagsmith identity (the trial ID). The multivariate flag
`agent_interface` in the control project splits traffic in equal thirds.

| Arm | What the agent gets |
|---|---|
| `mcp` (control) | The official Flagsmith MCP server 2.295.2 tools (54 tools), passed to the model unchanged. No shell. |
| `cli` | One bash tool in a locked container with Flagsmith CLI v2, jq and coreutils. No curl, wget, nc or node. |
| `cli_skill` | The same container plus `skills/flagsmith-ops/SKILL.md` mounted read-only at `/skills`. |

Everything else is identical across arms: model, effort, system prompt (except one paragraph naming the
interface), the task text, the turn limit and the sandbox seed.

## Agent

- Model: `claude-haiku-5-5`, effort `medium`, adaptive thinking (the model default), `max_tokens` 16000.
- Harness: one manual Messages API tool loop (`src/agent/loop.ts`), at most 30 turns, with prompt caching.
- Each trial runs in a fresh sandbox organisation on self-hosted Flagsmith 2.295.2, which is destroyed afterwards.

## Jobs

16 job templates in 4 families, fixed before the pilot (`src/jobs/catalog.ts`, SHA-256
`89318b251c41d38ccd5a273f0f650150d1f2856d9ae9d7810d961b0b943f3cb8`). Trial `i` uses template `i mod 16`. Each
template renders random names and values from a seed equal to the trial ID. Four templates are held out: they were
not used while writing the skill.

| Family | Templates (held out in bold) |
|---|---|
| flags | create_flag, enable_in_production, set_value_in_development, **kill_switch** |
| targeting | create_multivariate, change_split_in_production, create_segment, **segment_override** |
| experiments | create_metric, create_experiment, start_experiment, **ship_winner** |
| repair | sync_production_to_development, find_maintenance_flag, archive_stale_flag, **remove_segment_override** |

The verifier snapshots the full Flagsmith state of the sandbox before and after the agent runs. A job is correct when
every check for the template passes and no change falls outside the paths that the template allows. The reference
solutions pass all 16 templates (`node src/jobs/selftest.ts`).

## Metrics (sent to Flagsmith as events)

| Metric | Role | Type | Direction |
|---|---|---|---|
| `job_correct` | Primary | Occurrence | Higher is better |
| `no_collateral` | Guardrail | Occurrence | Must not decrease |
| `cost_usd` | Guardrail | Mean | Must not increase |

`cost_usd` is computed per API request from the published price card, including the Haiku 5.5 rate card for
prompts over 100K tokens.

## Sample size

255 counted trials (about 85 per arm). This clears Flagsmith's inference floors (50 identities and 5 conversions per
variant, 100 in total for the sample-ratio check).

## Decision rule (`src/experiment/readout.ts`)

For each treatment arm against `mcp`:

- **WIN** when all of these hold:
  - Flagsmith's Bayesian result for `job_correct` gives chance to beat control of at least 95%, with the lower end
    of the 95% interval above 0.
  - A cluster bootstrap that resamples whole job templates (4000 iterations) gives a 95% interval for the
    difference in `job_correct` that is entirely above 0.
  - Neither guardrail is breached. `no_collateral` is breached when either analysis puts the arm credibly below
    control. `cost_usd` is breached when either analysis puts the arm credibly above control.
- **LOSS** when both analyses put the arm credibly below control on `job_correct`.
- Otherwise **INCONCLUSIVE**.

If no arm wins, the recommendation is to keep the control. If both arms win, the arm with the higher `job_correct`
rate is recommended; a tie goes to the lower mean cost. A human then types the arm to ship at the `ship` prompt.
That step completes the Flagsmith experiment with a `rollout_decision`. The human may override the recommendation;
both values are recorded in `runs/main/approval.json`.

## Exclusions and retries

- A trial whose agent call fails with an API error (`outcome: api_error`) is excluded from the readout.
- An infrastructure error (sandbox, container or MCP connection) before a trial record is written is retried by
  re-running the same command. The retry uses the same trial ID, so Flagsmith keeps the same identity and arm.
- A run stopped by the spend cap ($15 for the whole project) leaves the remaining trials unrun. The readout then
  reports the actual count.
- No trial is removed for any other reason.

## Pilot (before this pre-registration)

39 trials: 9 smoke trials (3 per arm, forced) and 30 pilot trials (arms rotated, no Flagsmith events). Total
spend $0.12. Data: `runs/smoke-*`, `runs/pilot`.

| Arm | Pilot correct | Mean cost |
|---|---:|---:|
| mcp | 7/10 | $0.0057 |
| cli | 10/10 | $0.0026 |
| cli_skill | 10/10 | $0.0013 |

- `cli_skill` failed no pilot job, so the skill was not changed after the pilot. It is frozen at SHA-256
  `f6f350aec5da331637eaf740f37da39445b693b57967531bd377fca89c509328`.
- The three `mcp` failures came from the MCP server's tool surface, not from agent errors. In each case the agent
  reported FAILED and changed nothing:
  - `create_metric`: the tool schema marks `definition` as required but leaves it out of `properties`, so the field
    never reaches the API (`definition: This field is required.`).
  - `ship_winner`: no MCP tool calls the experiment `complete` endpoint. `update_experiment` requires `feature` and
    then rejects it, even when unchanged (`Cannot change the feature of an existing experiment.`).
  - `change_split_in_production`: no MCP tool returns the IDs of the existing multivariate feature-state values.
    The update then fails (`Multivariate feature state value with this Feature state and Multivariate feature option already exists.`).
- No template was added, removed or edited because of the pilot. Templates that the MCP server cannot complete
  stay in the catalog, because they are ordinary Flagsmith jobs and the gap is part of what the experiment measures.
- Pilot trials are not counted in the main readout.

## Known limits

- One model (Claude Haiku 5.5) at one effort level. Results may differ for other models.
- One Flagsmith version (2.295.2) and one MCP server version (2.295.2).
- The skill was written by the same team that wrote the jobs. The held-out templates are the check on overfitting.
