# Interface Wars

**We used Flagsmith Experimentation to decide how AI agents should operate Flagsmith.**

On the Toggle Wars kickoff stream, the Flagsmith team said they prefer the CLI to the MCP server and think it is
"more performant". Interface Wars measures that claim on the pinned Flagsmith 2.295.2 surface: real Claude agents
do real Flagsmith jobs on self-hosted Flagsmith, a verifier checks every change, and Flagsmith Experimentation
assigns the arms, collects the outcomes, computes the result and rolls out the winner.

Built for the WeMakeDevs x Flagsmith Toggle Wars hackathon, Track 01 "Test Something Real". The Agent Skill in
`skills/flagsmith-ops/` is also a Track 04 deliverable.

## Results

<!-- RESULTS:START -->
**The CLI with the Agent Skill won. The CLI alone did not clear the bar.** 255 trials on Claude Haiku 5.5, arms
assigned by Flagsmith, jobs checked by a snapshot of the observable Flagsmith state.

| Arm | Trials | Jobs correct | Out-of-scope changes | Mean cost | Mean input tokens | Mean turns | Mean time |
|---|---:|---:|---:|---:|---:|---:|---:|
| `mcp` (control) | 87 | 68 (78.2%) | 0 | $0.0056 | 130,914 | 4.2 | 15.2 s |
| `cli` | 82 | 75 (91.5%) | 0 | $0.0034 | 88,008 | 10.2 | 37.7 s |
| `cli_skill` | 86 | **86 (100%)** | 0 | **$0.0013** | **20,329** | 5.1 | 16.6 s |

Decision under the pre-registered rule (both analyses must agree):

- **`cli_skill` vs `mcp`: WIN.** Flagsmith: lift +27.9%, 95% interval +13.6% to +42.2%, chance to beat control
  100.0%. Template bootstrap: +21.8 points (+6.1 to +43.1). Guardrails held: zero detected out-of-scope final changes, cost 77%
  lower.
- **`cli` vs `mcp`: INCONCLUSIVE.** Flagsmith: lift +17.0%, 95% interval +1.8% to +32.2%, chance to beat control
  98.6%. The template bootstrap interval (-1.0 to +33.7 points) crosses zero, so the rule does not call it.
- Sample-ratio check: 87 / 82 / 86 against an equal split, p = 0.92. Held-out templates: `cli_skill` 16/16,
  `mcp` 25/28, `cli` 16/19.

A human approved `cli_skill` at the `ship` prompt. Flagsmith completed the experiment with
`rollout_decision=variant`, and every new agent session now gets `cli_skill` from the same flag
(`node src/cli.ts which`). Six agents started after the ship all read `cli_skill` from the flag and did their jobs
correctly (`runs/after-ship/`).

What decided it:

- **The MCP server cannot do some jobs at all.** All 19 MCP failures sit in five templates whose tools are missing
  or broken: creating a metric, starting or completing an experiment, changing a split, finding a flag by tag
  ([findings](docs/FLAGSMITH_FINDINGS.md)). In every one the agent said FAILED and left no detected final change.
- **The MCP tool list is expensive.** 54 tools are 29,270 input tokens on every request. The CLI's bash tool is
  611, and the skill adds 1,950 tokens once, when the agent reads it. That is a 4.43x MCP-to-skill tool-context ratio.
- **The skill turns a capable CLI into a reliable one.** Without it the CLI agent explored, took twice the turns,
  and 4 of its 7 failures claimed DONE when the job was not done. With it: 86 of 86, at the lowest cost.

Full readout: [`runs/main/readout.md`](runs/main/readout.md). Every trial, with a clipped transcript and observable-state diff:
`runs/main/trials/`. Tool outputs are clipped at 4,000 characters in each record.
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
       verifier diffs the full Flagsmith state before and after the agent ran
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

Model, effort, system prompt (except one paragraph naming the interface), task text, turn limit and sandbox seed
are identical across arms.

### The jobs

16 job templates in 4 families: flags, targeting, experiments and repair. Four templates are held out: they were not
used while writing the skill, which guards against fitting the skill to the test. Each trial renders its template
with names and values seeded by the trial ID, in a fresh sandbox organisation that is destroyed afterwards.

A job is correct only when every check passes and nothing outside the job's scope changed. The reference solutions
pass all 16 templates (`node src/jobs/selftest.ts`).

## How we used Flagsmith

Flagsmith is both the system under test and the experiment platform.

- **Feature flag as the assignment.** The multivariate flag `agent_interface` (`mcp`, `cli`, `cli_skill`) assigns
  each trial. Each trial is one Flagsmith identity, so the SDK evaluation records the exposure.
- **Experimentation.** One experiment with three metric definitions: `job_correct` (primary, occurrence, higher is
  better), `no_collateral` (guardrail, occurrence) and `cost_usd` (guardrail, mean, lower is better). Outcomes go to
  Flagsmith as SDK events.
- **Bayesian results.** The readout uses Flagsmith's lift, 95% credible interval, chance to beat control and the
  sample-ratio check. A cluster bootstrap over job templates must agree before an arm counts as a winner.
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
5. The MCP tool list is 29,270 input tokens on every request (4.43x the 6,611-token CLI-skill interface context).
6. The sample-ratio check never runs for experiments: it reads the split from the environment default, which an
   experiment zeroes (Flagsmith's own code has a TODO for it).
7. `PATCH` on a feature state silently ignores `multivariate_feature_state_values`.
8. A multivariate option's `key` is ignored on create, so results label the variant `""`.
9. `warehouse_type: "flagsmith"` is Cloud-only and breaks results on self-hosted.
10. Warehouse-connection writes are throttled at a hard-coded 10 per minute.

## Setup

Requirements: Docker, Node.js 26 (runs the TypeScript files directly, no build step) and an Anthropic API key.

```bash
npm install
cp .env.example .env                        # add ANTHROPIC_API_KEY
docker build -t interface-wars-cli:2.0.0 -f infra/cli.Dockerfile infra
./scripts/lab-reset.sh                      # fresh Flagsmith lab and a created, not started, experiment
node src/jobs/selftest.ts                   # the verifier proves all 16 jobs with reference solutions
```

Run the experiment:

```bash
node src/cli.ts experiment:start
node src/run.ts --run main --count 255 --concurrency 6
node src/cli.ts readout main
node src/cli.ts ship main                   # a human types the arm to roll out
node src/cli.ts which                       # what a new agent session gets from the flag
node src/run.ts --run after-ship --count 6 --follow-flag   # agents take their interface from the flag
node scripts/count-tokens.ts                # per-request input tokens of each interface
```

Deviations from the pre-registration are listed in `prereg/DEVIATIONS.md`.

Read the results in the terminal:

```bash
node src/cli.ts compare create_metric --pick failed   # one job across the three arms, call by call
node src/cli.ts show main-0075                        # one trial: every tool call, the state diff, the verdict
```

Re-running a run name resumes existing records. Use a fresh run name for a new experiment batch, for example `--run replay-2026-11-28`, because committed trial IDs are skipped.
`IW_MAX_SPEND_USD` sets the machine spend cap (ledger in `runs/spend.local.json`). `trials_enabled` and `spend_cap_usd` in the control Flagsmith project can pause new trials or lower that cap. The cap is checked before each request, so concurrent requests can overshoot it. `IW_DRY_RUN=1` runs the whole
pipeline with a scripted stand-in agent and no API calls; dry-run numbers are fake by design.

Flagsmith UI: http://127.0.0.1:8300 (the admin login is in `runs/lab.local.json`).

## Use the skill

`skills/flagsmith-ops/SKILL.md` is a standard Agent Skill: 1,950 tokens of rules and recipes for running Flagsmith
with CLI v2, including experiments and metrics through `flagsmith api`, scoped changes and read-back checks. In this
experiment it took a Haiku 5.5 agent from 91.5% to 100% of jobs done correctly and cut the mean cost per job by
63% against the plain CLI.

To use it with Claude Code, copy the folder into your skills directory and install the Flagsmith CLI:

```bash
mkdir -p ~/.claude/skills && cp -r skills/flagsmith-ops ~/.claude/skills/
```

The skill was frozen before the main run (`prereg-v1`) and four of the sixteen job templates were held out while it
was written; it passed all 16 held-out trials. The readout also publishes a post-hoc sensitivity view that treats an enabled rollout override in a “set up but do not start” record as a failure. This view is separate from the registered verdict.

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
| `runs/` | Trial records with full transcripts, and readouts |

## AI tools used

<!-- Confirm this wording before submitting. -->
- Claude Haiku 5.5 through the Claude API is the agent under test in every trial.
- Claude Code helped write the harness, the verifier and this README.

## License

MIT
