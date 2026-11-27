# Handoff: Interface Wars (Toggle Wars hackathon entry)

Written 2026-11-27 19:37 UTC. **Deadline: 2026-11-29 20:00 IST = 14:30 UTC.** About 43 hours left at handoff.

## 1. Context in one paragraph

Hackathon: WeMakeDevs x Flagsmith "Toggle Wars" (https://www.wemakedevs.org/hackathons/flagsmith). Judged on Use of
Flagsmith, Impact, Creativity and Demo video (about 25% each). Submit a public GitHub repo, a README (setup + "how we used
Flagsmith" + AI tools used), and a demo video under 3 minutes. One project per team. The user already has a Track 03 entry
(`PDGamerSG/afterflag`). They chose to build this project instead, as their single submission, aimed at **Track 01 "Test
Something Real" ($2,000)**, with the Agent Skill also eligible for Track 04. **User rule: no AI attribution lines in
commits or PR text.**

## 2. The project

**Interface Wars**: "We used Flagsmith Experimentation to decide how AI agents should operate Flagsmith."

- The Flagsmith team said on the kickoff stream that they prefer the CLI to the MCP server and think it is "more performant", but this was never measured.
- Each trial is one Flagsmith identity. Flagsmith's multivariate flag `agent_interface` assigns the trial to an arm:
  - `mcp` (control): the official Flagsmith MCP server tools, with no shell.
  - `cli`: Flagsmith CLI v2 in a locked container.
  - `cli_skill`: the same CLI plus `skills/flagsmith-ops/SKILL.md`.
- A real Claude agent then does a real Flagsmith job in a fresh sandbox organisation on self-hosted Flagsmith. The verifier diffs the full Flagsmith state before and after.
- Metrics sent to Flagsmith:
  - `job_correct` (primary, occurrence, should increase)
  - `no_collateral` (guardrail, occurrence, should not decrease)
  - `cost_usd` (guardrail, mean, should not increase)
- Readout: Flagsmith's Bayesian result, cross-checked with a cluster bootstrap over job templates, under a pre-registered rule. A human then types the arm at a `ship` prompt. The experiment completes with `rollout_decision`, and new agents read the winner from the same flag.

Pre-build review score: about 8.0, the best of 11 ideas. Projected 8.5–8.75 if the safety framing, the upstream findings and a strong video land.
Reviews and research:
- `../research_notes/Flagsmith hackathon project research/` (`reviews/` holds the scores)
- `../reports/Flagsmith hackathon project research.md`

## 3. What is built and verified

| Piece | File | Status |
|---|---|---|
| Self-hosted Flagsmith 2.295.2 + task processor + Postgres + official MCP server 2.295.2 | `infra/compose.yml` | Running (ports 8300 Flagsmith, 8301 MCP) |
| Lab bootstrap (admin user, control organisation, warehouse = Flagsmith DB, server key, master key) | `src/lab/bootstrap.ts`, `src/lab/config.ts` | Works; secrets in `runs/lab.local.json` (gitignored) |
| Per-trial sandbox org: seed, snapshot (flat path map), diff, destroy | `src/lab/sandbox.ts` | Works |
| 16 pre-registered job templates in 4 families, 4 held out | `src/jobs/catalog.ts` | Works |
| Reference solutions + verifier self-test | `src/jobs/reference.ts`, `src/jobs/selftest.ts` | **16/16 PASS** (`node src/jobs/selftest.ts`) |
| CLI sandbox image (CLI v2, jq, bash; no curl/wget/nc/node) | `infra/cli.Dockerfile` (image `interface-wars-cli:2.0.0`) | Built, verified |
| Arms | `src/arms/cli.ts`, `src/arms/mcp.ts`, `src/arms/types.ts` | Smoke-tested without a model |
| Agent loop (Messages API manual tool loop, prompt caching, cost accounting) | `src/agent/loop.ts` | **Not yet run against the API (no key)** |
| Agent Skill (Track 04 deliverable) | `skills/flagsmith-ops/SKILL.md` | Recipes verified by hand in a sandbox |
| Experiment control plane (flag, keyed MV options, metrics, experiment, start, results, complete) + SDK assigner/events | `src/experiment/control.ts` | Works |
| Readout (Flagsmith results + template bootstrap + verdict, JSON + Markdown) | `src/experiment/readout.ts` | Works on dry-run data |
| Trial + parallel runner | `src/trial.ts`, `src/run.ts` | Works |
| CLI entry: setup/start/status/readout/ship/which | `src/cli.ts` | ship/which written, ship not exercised yet |
| Dry-run stand-in agent (fake numbers, pipeline test only) | `src/agent/dryrun.ts` (`IW_DRY_RUN=1`) | 255-trial dry run done |
| Lab reset | `scripts/lab-reset.sh` | Works |

The current lab state is **dirty with dry-run data**. Experiment 1 is running with 255 fake trials. **Run
`./scripts/lab-reset.sh` before the real experiment.**

## 4. Facts learned the hard way (keep these)

- **Self-hosted warehouse:** create it with `{"warehouse_type":"postgres","config":{"source":"flagsmith_database"}}`. `warehouse_type: "flagsmith"` is the Cloud-only ClickHouse warehouse and crashes results on self-hosted. Events go to `POST /api/v1/events/` (the SDK's `eventsApiUrl` = `<flagsmith>/api/`).
- **Metric definitions** need `{"version":1,"event":"..."}`.
- **Experiments** require an `experiment_rollout` with `feature_state_value: {type:"string", value}`.
- **Multivariate options:** Flagsmith ignores `key` on create, so set it with `PUT .../mv-options/<id>/`. Without a key, results label the variant `""`.
- **Inference floors** (source: `api/experimentation/constants.py`):
  - 50 identities and 5 conversions per variant
  - 100 total for the SRM check
  - no inference if the control mean is 0
  - That is why the guardrail is `no_collateral` and not `collateral_change`.
- **Results refresh** has a 5-minute cooldown and is computed by the task processor. Polling now waits up to about 5 minutes.
- **PATCH bug:** `PATCH` on a feature state silently ignores `multivariate_feature_state_values`; `PUT` with the full state applies them. This is a real API trap and a candidate upstream issue. Ask the user before posting anything upstream.
- **Warehouse throttle:** warehouse-connection writes are throttled at 10/min (hard-coded), so sandboxes skip creating a warehouse. Experiments still work without one (`IW_SANDBOX_WAREHOUSE=1` re-enables it).
- **CLI v2:**
  - Writes need `--yes` when there is no terminal.
  - It has no experiment or metric commands; use `flagsmith api ... --input -`.
  - Self-hosted auth uses the host-scoped env var `FLAGSMITH_API_KEY_<host>_<port>`.
- **MCP server:**
  - It exposes 54 tools, about 67 KB of schema, sent on every request.
  - Auth is the `Authorization: Api-Key <org master key>` header.
  - Parameters are path names, e.g. `project_pk`.
- **Experiment side effects:** creating an experiment adds a hidden `experiment-<id>-rollout` segment override and zeroes the environment split. The job checks allow for this.
- **Node 26** runs the `.ts` files directly (type stripping). Use erasable TypeScript syntax only. There is no build step.

## 5. What is left, in priority order

1. **API key and model.** The user will add `ANTHROPIC_API_KEY=...` to `.env`. Model default is `claude-opus-5-5` (`IW_MODEL` overrides; the user has not chosen yet; estimate $30–60 for about 300 trials on Opus 5.5, $15–30 on Sonnet 5.5, $2–5 on Haiku 5.5). Ask before spending.
2. **Live agent smoke test:** `node src/run.ts --run smoke --count 3 --arm mcp`, then repeat with `--arm cli` and `--arm cli_skill`. Fix any loop bugs. `output_config` and top-level `cache_control` are passed with `as any`; check cache hits in `usage`.
3. **Pilot:** `node src/run.ts --run pilot --count 30 --pilot` (arms rotate, no events). Improve `SKILL.md` from the non-held-out failures only, then freeze it.
4. **Pre-registration:** write `prereg/PREREGISTRATION.md` (hypothesis, arms, metrics, the 16 templates and 4 held-out, about 85 trials per arm = 255 counted, the decision rule in `readout.ts`, and that infrastructure errors are retried with the same identity). Commit and tag it before the main run.
5. **Main run:**
   ```bash
   ./scripts/lab-reset.sh
   node src/cli.ts experiment:start
   node src/run.ts --run main --count 255 --concurrency 6
   ```
   Re-running the same command resumes and retries failed trials with the same identities.
6. **Readout and ship:** `node src/cli.ts readout main`, then `node src/cli.ts ship main` (human types the arm), then `node src/cli.ts which`.
7. **README:**
   - what it is
   - the result table
   - "How we used Flagsmith": flag assignment, exposures, events, Bayesian results, rollout decision, self-hosted OSS, CLI, MCP
   - setup
   - AI tools used (the hackathon asks for this; confirm the wording with the user, since they want no AI attribution in commits)
8. **Report viewer:** a static page from `runs/main/readout.json` plus trial transcripts, side by side per job. It could deploy to Render as a static site (the user has Render credits).
9. **CI:** a GitHub Action that runs `infra/compose.yml`, the bootstrap and `node src/jobs/selftest.ts`. Optional: a skill-change PR gate.
10. **GitHub repo:** `PDGamerSG/interface-wars` (name is free). Create it public. Commit with plain messages and no AI attribution.
11. **Demo video (about 2:45):**
    - the sponsor quote
    - the flag and experiment in the Flagsmith UI (http://127.0.0.1:8300, log in with `runs/lab.local.json` admin)
    - one job across the three arms, with the state diff
    - the Flagsmith results page and an honest reading
    - the `ship` approval and `which`
    - the skill with its token count
    - CLAUDE.md render rules: hardware encoder for drafts, `--crf` for finals.
12. **Submit** on the WeMakeDevs page before 14:30 UTC Nov 29.

## 6. Commands

```bash
cd interface-wars
npm install
docker build -t interface-wars-cli:2.0.0 -f infra/cli.Dockerfile infra
./scripts/lab-reset.sh                      # fresh Flagsmith + experiment (created, not started)
node src/jobs/selftest.ts                   # verifier proves all 16 jobs
node src/cli.ts experiment:start
node src/run.ts --run main --count 255      # needs ANTHROPIC_API_KEY in .env (IW_DRY_RUN=1 for a fake run)
node src/cli.ts readout main
node src/cli.ts ship main
node src/cli.ts which
```
