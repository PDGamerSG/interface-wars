# Interface Wars

**We used Flagsmith Experimentation to decide how AI agents should operate Flagsmith.**

On the Toggle Wars kickoff stream, the Flagsmith team said they preferred the CLI to the MCP server and thought it
was "more performant". We tested that claim on Flagsmith 2.295.2. Flagsmith assigned each agent an interface,
collected the outcomes and served the human-approved winner to later sessions. [Kickoff at 23:28](https://www.youtube.com/watch?v=wm2mKxQDpHQ&t=1408s)

Built for the WeMakeDevs x Flagsmith Toggle Wars hackathon, Track 01 "Test Something Real". The Agent Skill in
`skills/flagsmith-ops/` is also a Track 04 deliverable.

## Results

<!-- RESULTS:START -->
**The CLI with the skill won under the registered grader. Requiring disabled enrollment for staged experiments makes that win inconclusive.** In 255 trials, Claude Haiku 5.5 performed one of 16 release jobs in a fresh Flagsmith sandbox.

| Arm | Registered passes | Detected out-of-scope final changes | Mean cost per trial | Mean input tokens¹ | Mean turns | Mean time |
|---|---:|---:|---:|---:|---:|---:|
| MCP | 68/87 (78.2%) | 0 | $0.0056 | 130,914 | 4.2 | 15.2 s |
| CLI | 75/82 (91.5%) | 0 | $0.0034 | 88,008 | 10.2 | 37.7 s |
| CLI with skill | 86/86 (100%) | 0 | $0.0013 | 20,329 | 5.1 | 16.6 s |

¹ Includes cache reads and writes. The MCP tool list contributed 29,270 tokens per request. The CLI's bash tool used 611. Skill agents each read the 1,950-token file once and retained it in conversation history.

| Registered comparison | Flagsmith relative lift [95% interval] | Chance to beat MCP | Template bootstrap in percentage points [95% interval] | Verdict |
|---|---:|---:|---:|---|
| CLI with skill vs MCP | +27.9% [+13.6%, +42.2%] | 99.9936% | +21.8 [+6.1, +43.1] | WIN |
| CLI vs MCP | +17.0% [+1.8%, +32.2%] | 98.6% | +13.3 [−1.0, +33.7] | INCONCLUSIVE |

**What changes the interpretation?**

- **Staging safety.** Ten accepted experiment drafts had an enabled rollout in Production. Flagsmith can enroll identities in that state. Requiring disabled enrollment gives MCP **64/87**, CLI **75/82**, and skill **80/86**. The skill advantage over MCP becomes **+19.5 points [0.0, +42.6]**. A win needs a lower bound above zero. These are sandbox state observations, with no measured customer exposures. [Ten trial records and calculations](runs/main/sensitivity.md)
- **Job mix.** All 19 MCP failures came from five templates covering metric creation, experiment start and completion, split changes and tag lookup. Each reported failure with an empty final diff. On the other eleven templates the registered scores were **67/67 MCP**, **54/55 CLI**, and **53/53 skill**. Giving each of all 16 templates equal weight yields CLI versus MCP **+23.4 points [+5.5, +43.8]** in a post-hoc analysis. [Sensitivity report](runs/main/sensitivity.md)
- **Skill vs bare CLI.** The skill cut observed mean cost by **63%** and mean turns from 10.2 to 5.1. Its exploratory correctness difference was **+8.5 points [0.0, +18.0]**. Four of seven failed CLI records opened their final answer with `DONE:`. Three of those four acknowledged incomplete work. [Trial evidence](docs/FLAGSMITH_FINDINGS.md#agent-behaviour-worth-knowing)

The harness sample-ratio test gave **p = 0.92**. Held-out scores were 25/28 MCP, 16/19 CLI and 16/16 skill.
Pallab Das approved `cli_skill` on the registered evidence. Flagsmith recorded `rollout_decision=variant`.
All six subsequent agents read the winner from the same flag and passed their assigned jobs. [Readout](runs/main/readout.md) · [Approval](runs/main/approval.json) · [Post-ship trials](runs/after-ship/trials/)
<!-- RESULTS:END -->

The pre-registration (`prereg/PREREGISTRATION.md`, git tag `prereg-v1`) fixed the hypotheses, arms, jobs, metrics,
sample size and decision rule before the main run started.

## How it works

```
trial id ──► Flagsmith flag "agent_interface" ──► arm: mcp | cli | cli_skill
                    (multivariate, experiment)          │
                                                        ▼
            fresh sandbox organisation on self-hosted Flagsmith, seeded for one job
                                                        │
                   Claude agent does the job through its arm's interface
                                                        │
       verifier compares selected sandbox fields before and after the job
                                                        │
      events to Flagsmith: job_correct, no_collateral, cost_usd ──► Bayesian result
                                                        │
       readout + template bootstrap ──► human types the arm at "ship" ──► rollout_decision
                                                        │
                    every new agent reads the winner from the same flag
```

### The three arms

| Arm | What the agent gets |
|---|---|
| `mcp` (control) | The official Flagsmith MCP server tools (54 tools), passed to the model unchanged. No shell. |
| `cli` | One bash tool in a locked container with Flagsmith CLI v2, jq and coreutils. No curl, wget, nc or node. |
| `cli_skill` | The same container plus the `flagsmith-ops` Agent Skill, mounted read-only. |

All arms use the same model, effort, 30-turn limit and task generator. Each trial ID seeds its own names and values.
The CLI has a preselected project and raw Management API access. MCP receives all 54 tool schemas up front. A
client with lazy tool discovery or a different model could have different costs.

### How the verifier scores a job

The 16 templates cover flags, targeting, experiments and repair. Four templates were held out while the skill
was written. The same team authored the skill and the jobs, and the skill covers the held-out operations.

The verifier checks selected fields for flags, splits, segments, overrides, metrics and experiments. A pass requires
every programmed check to succeed and the final snapshot to show zero changes outside the allowed paths.
Identity overrides and permissions fall outside the snapshot. The frozen experiment-creation check covered status
and metric links. It omitted the requested hypothesis, 50/50 rollout and disabled enrollment. In one failed
ship trial the agent changed a Production weight and restored it before the snapshot. Tool outputs in the archive
are clipped at 4,000 characters. [Grader](src/jobs/catalog.ts) · [Snapshot](src/lab/sandbox.ts) · [Reverted write](runs/main/trials/main-0139.json)

## How we used Flagsmith

Flagsmith is both the system under test and the experiment platform.

- **Feature flag as the assignment.** The multivariate flag `agent_interface` (`mcp`, `cli`, `cli_skill`) assigns
  each trial. Each trial is one Flagsmith identity, so the SDK evaluation records the exposure.
- **Experimentation.** One experiment with three metric definitions: `job_correct` (primary, occurrence, higher is
  better), `no_collateral` (guardrail, occurrence) and `cost_usd` (guardrail, mean, lower is better). Outcomes go to
  Flagsmith as SDK events.
- **Bayesian results.** The readout uses Flagsmith's lift, 95% credible interval and chance to beat control alongside a
  template bootstrap for the registered decision. The harness reports a separate sample-ratio test because the native result returned null.
- **Rollout decision.** A human types the arm at the `ship` prompt. That completes the experiment with a
  `rollout_decision`, and new agent sessions read the winner from the same flag (`node src/cli.ts which`).
- **Self-hosted open source.** Flagsmith 2.295.2 with the task processor and Postgres, plus the official MCP server
  2.295.2, all in `infra/compose.yml`. The Flagsmith database is also the experiment warehouse.
- **CLI and MCP.** Both official interfaces are the arms of the experiment.
- **Agent Skill.** `skills/flagsmith-ops/SKILL.md` teaches an agent to run Flagsmith with the CLI, including
  experiments and metrics through `flagsmith api`.

### What we found in Flagsmith along the way

Ten problems in Flagsmith 2.295.2 and its MCP server, each with the trials or code that show it, are written up in
[docs/FLAGSMITH_FINDINGS.md](docs/FLAGSMITH_FINDINGS.md). They have not been filed upstream yet. The short list:

1. MCP `create_metric` lists `definition` as required but leaves it out of `properties`, so no metric can be
   created (0/5 trials).
2. No MCP tool starts or completes an experiment, and `update_experiment` requires `feature`, which the API then
   rejects (0/6 trials).
3. MCP read operations do not return the multivariate value IDs that a split change needs. One of five MCP trials succeeded after an update response exposed an ID.
4. No MCP tool lists project tags, so a flag cannot be found by tag name (0/4 trials).
5. This client sent all 54 MCP tools on each request. MCP cost **4.43× as much per trial** as CLI with the skill.
6. Flagsmith skipped the sample-ratio test for our experiment because it read the zeroed environment split.
7. `PATCH` on the environment feature-state endpoint silently ignores `multivariate_feature_state_values`.
8. A multivariate option's `key` is ignored on create, so results label the variant `""`.
9. The `flagsmith` warehouse driver uses ClickHouse. Our Postgres-only lab uses the `postgres` warehouse.
10. Warehouse-connection writes are throttled at a hard-coded 10 per minute.

## Experiment manifests and a matched MCP follow-up

The shipped three-arm study is an immutable archive. New studies are described before execution by a versioned
manifest that includes the question, Flagsmith assignment flag, arm shares, model settings, job pack, metrics,
guide hashes and spend budget. The planned `mcp-guidance-v1` study keeps the official 54-tool MCP surface in both
arms and changes only a short frozen read-before-write guide. It uses four existing held-out-capable jobs and a
50/50 split. No model calls or credentials are needed to inspect its plan.

```bash
node src/cli.ts plan                         # the shipped interface-wars-v1 manifest
node src/cli.ts plan --experiment mcp-guidance-v1
npm run plan -- --experiment mcp-guidance-v1
```

The command validates template IDs, arm shares, metrics, budgets and guide files, then prints SHA-256 fingerprints.
The follow-up is deliberately planned separately because the first experiment's assignment flag, exposure data and
approval record must remain read-only. Its execution needs a matched-case runner and a fresh Flagsmith experiment.
See [the manifest design](docs/EXPERIMENT_MANIFESTS.md) and [the frozen guide](guides/mcp-guidance-v1.md).

## Setup

With Node.js 26 you can replay the published evidence locally. Install the locked dependencies once.

```bash
npm ci
node src/cli.ts readout main --offline
node scripts/sensitivity.ts
node src/cli.ts compare start_experiment --pick failed
node src/cli.ts show main-0154
```

Offline readout recomputes the trial statistics and bootstrap, then applies the decision rule to the archived Flagsmith
inference. It writes `runs/main/readout.offline.json` and `readout.offline.md`.

### Run a fresh experiment

On a fresh local Docker lab, copy `.env.example` to `.env` and set the Anthropic API key and project spend limit.
Use a new run name. The name identifies both the trial directory and the Flagsmith identities.

```bash
npm run cli:image
npm run lab:up
node src/cli.ts experiment:setup
npm run selftest
node src/cli.ts experiment:start
node src/run.ts --run replication-01 --count 255 --concurrency 6
node src/cli.ts readout replication-01
node src/cli.ts ship replication-01       # review the readout and enter the chosen arm
node src/cli.ts which
node src/run.ts --run replication-01-followup --count 6 --follow-flag
```

Resuming the same name skips saved records and retries missing trial IDs. `IW_MAX_SPEND_USD` is checked before each
model request. Charges for requests already in flight can take the total above the threshold. For a scripted plumbing
check on an initialized lab, run `IW_DRY_RUN=1 node src/run.ts --run dryrun --count 6 --pilot`. The agent is scripted
and the pilot sends no experiment events. The local Flagsmith UI is at http://127.0.0.1:8300.

## Use the skill

`skills/flagsmith-ops/SKILL.md` is a standard Agent Skill: 1,950 tokens of rules and recipes for running Flagsmith
with CLI v2, including experiments and metrics through `flagsmith api`, scoped changes and read-back checks. Haiku used 63% less per job on average with the skill than with bare CLI in this run.

To use it with Claude Code, copy the folder into your skills directory and install the Flagsmith CLI:

```bash
mkdir -p ~/.claude/skills && cp -r skills/flagsmith-ops ~/.claude/skills/
```

The skill was frozen before the main run (`prereg-v1`) and four of the sixteen job templates were held out while it
was written. All 16 assigned held-out skill trials passed the frozen grader.

## Repository map

| Path | What it is |
|---|---|
| `infra/` | Docker Compose for Flagsmith, task processor, Postgres and the MCP server; the CLI sandbox image |
| `src/lab/` | Lab bootstrap and per-trial sandbox organisations (seed, snapshot, diff, destroy) |
| `src/jobs/` | The 16 job templates, reference solutions and the verifier self-test |
| `src/arms/` | The MCP and CLI arms |
| `src/agent/` | The Messages API tool loop, cost accounting and spend cap |
| `src/experiment/` | Flagsmith experiment control plane, SDK assignment and events, readout |
| `skills/flagsmith-ops/` | The Agent Skill |
| `prereg/` | The pre-registration |
| `runs/` | Per-turn records with clipped tool output, final state diffs and readouts |

## AI tools used

<!-- Confirm this wording before submitting. -->
- Claude Haiku 5.5 through the Claude API is the agent under test in every trial.
- Claude Code helped write the harness, the verifier and this README.

## License

MIT
