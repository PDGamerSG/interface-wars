# Interface Wars

**We used Flagsmith Experimentation to decide how AI agents should operate Flagsmith.**

On the Toggle Wars kickoff stream, the Flagsmith team said they prefer the CLI to the MCP server and think it is
"more performant". Nobody had measured it. Interface Wars measures it with a real experiment: real Claude agents
do real Flagsmith jobs on self-hosted Flagsmith, a verifier checks every change, and Flagsmith Experimentation
assigns the arms, collects the outcomes, computes the result and rolls out the winner.

Built for the WeMakeDevs x Flagsmith Toggle Wars hackathon, Track 01 "Test Something Real". The Agent Skill in
`skills/flagsmith-ops/` is also a Track 04 deliverable.

## Results

<!-- RESULTS:START -->
The main run is in progress. This section is filled from `runs/main/readout.md` when it finishes.
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

These came from building the harness and from agent transcripts. We have not filed them upstream yet.

1. **MCP `create_metric` cannot create a metric.** The tool schema lists `definition` as required but leaves it out
   of `properties`, so the field never reaches the API (`definition: This field is required.`).
2. **MCP cannot complete an experiment.** No tool calls the `complete` endpoint, and `update_experiment` requires
   `feature` and then rejects it even when unchanged (`Cannot change the feature of an existing experiment.`).
3. **MCP cannot change an existing multivariate split.** No tool returns the IDs of the existing multivariate
   feature-state values, and the update fails without them.
4. **`PATCH` on a feature state silently ignores `multivariate_feature_state_values`.** `PUT` with the full state
   applies them.
5. **Multivariate option `key` is ignored on create.** It must be set with a later `PUT`; without it, experiment
   results label the variant `""`.
6. **Self-hosted warehouse.** `warehouse_type: "flagsmith"` is the Cloud-only warehouse and breaks results on
   self-hosted; use `{"warehouse_type":"postgres","config":{"source":"flagsmith_database"}}`.

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
```

Re-running the same `run.ts` command resumes and retries failed trials with the same identities.
`IW_MAX_SPEND_USD` sets a hard spend cap (ledger in `runs/spend.local.json`). `IW_DRY_RUN=1` runs the whole
pipeline with a scripted stand-in agent and no API calls; dry-run numbers are fake by design.

Flagsmith UI: http://127.0.0.1:8300 (the admin login is in `runs/lab.local.json`).

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
