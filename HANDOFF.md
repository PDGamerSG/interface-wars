# Handoff: Interface Wars (Toggle Wars hackathon entry)

Updated 2026-11-27 21:00 UTC. **Deadline: 2026-11-29 20:00 IST = 14:30 UTC.**

## 1. Context

Hackathon: WeMakeDevs x Flagsmith "Toggle Wars" (https://www.wemakedevs.org/hackathons/flagsmith). Judged on Use of
Flagsmith, Impact, Creativity and Demo video (about 25% each). Submit a public GitHub repo, a README (setup, "how we
used Flagsmith", AI tools used) and a demo video under 3 minutes. Target: Track 01 "Test Something Real"; the Agent
Skill is also eligible for Track 04. **User rule: no AI attribution lines in commits or PR text, and no rewritten
commit dates.** The user records the demo video. The website is the next piece of work.

## 2. Status: the experiment is done

| Step | State |
|---|---|
| Smoke (9) and pilot (30) on `claude-haiku-5-5` | Done. Pilot: mcp 7/10, cli 10/10, cli_skill 10/10. Skill unchanged and frozen |
| Pre-registration | `prereg/PREREGISTRATION.md`, tag `prereg-v1` |
| Main run, 255 trials | Done. cli_skill 86/86, cli 75/82, mcp 68/87, 0 collateral, $0.88 |
| Readout | cli_skill WIN, cli INCONCLUSIVE, SRM p = 0.92 (`runs/main/readout.md`) |
| Ship | Approved by Pallab Das: cli_skill. Experiment completed with `rollout_decision=variant` |
| Closed loop | `which` returns cli_skill for new sessions; 6 post-ship agents all correct (`runs/after-ship/`) |
| Findings | 10 Flagsmith and MCP problems with trial evidence (`docs/FLAGSMITH_FINDINGS.md`). Not filed upstream; ask the user first |
| Deviations | `prereg/DEVIATIONS.md` |
| Token counts | `runs/interface-tokens.json`: MCP tools 29,270 tokens per request, bash tool 611, skill 1,950 |
| Web data | `node scripts/export-web-data.ts main` writes `web/public/data/` (3.6 MB, credential guard) |
| README | Results, Flagsmith usage, findings, setup, AI tools used (wording still to confirm with the user) |
| CI | `.github/workflows/selftest.yml`: lab, verifier self-test, dry-run pipeline, readout and export guard |

Spend so far: $1.00 of the $15 cap (`runs/spend.local.json`). The API key is only in `.env`.

## 3.1 Release gate

A separate `flagsmith-release-gate` Agent Skill is available for production-style staged rollouts. It is tested offline and against one disposable local Flagsmith organization with the official CLI. The gate requires a disabled zero-percent experiment draft, two distinct signed approvals, policy and spend checks before each write, matched cohort probes, read-back hashes and reverse rollback. Flagsmith 2.295.2 keeps the experiment `running` after rollback because its lifecycle cannot return to `created`; enrollment is disabled at zero percent.

## 3. Next

1. **Operational controls** are now available through `ops:setup`, `ops:pause` and `ops:resume`. The control
   Flagsmith project exposes `trials_enabled` and `spend_cap_usd`; the runner reads them before each trial.
2. **Website** in `web/`, planned in `docs/WEBSITE_PLAN.md` (stack from the user's On-Record project: React 19,
   React Router 7, Vite 8, TypeScript 6, plain CSS tokens, oxlint, fontsource, Phosphor). Data comes from
   `web/public/data/`. Product context for the design workflow is in `PRODUCT.md`. A visual direction round was
   started (roll assigned "The Fight Card", pick "Trial Report") but the user paused the frontend before choosing.
3. Render static site deploy, then add the URL to the README.
4. Confirm the README "AI tools used" wording with the user.
5. Ask before filing any upstream issue from `docs/FLAGSMITH_FINDINGS.md`.
6. Submit on the WeMakeDevs page before 14:30 UTC on 29 November.

## 4. Facts learned the hard way

- **Self-hosted warehouse:** `{"warehouse_type":"postgres","config":{"source":"flagsmith_database"}}`.
  `warehouse_type: "flagsmith"` is Cloud-only. Events go to `POST /api/v1/events/`.
- **Metric definitions** need `{"version":1,"event":"..."}`.
- **Experiments** need an `experiment_rollout` with `feature_state_value: {type:"string", value}`. Creating one
  zeroes the environment split and adds a hidden `experiment-<id>-rollout` segment override.
- **Multivariate option `key`** is ignored on create; set it with `PUT .../mv-options/<id>/`.
- **`PATCH` on a feature state** ignores `multivariate_feature_state_values`; `PUT` the full state.
- **SRM** is `null` for experiments in 2.295.2 (reads the zeroed environment split). The readout runs its own test.
- **Inference floors:** 50 identities and 5 conversions per variant, 100 in total for SRM, no inference if the
  control mean is 0.
- **Results refresh** has a 5-minute cooldown and runs on the task processor.
- **After completion,** the environment-level flags endpoint still returns the control value; only identity
  evaluation applies the split. `which` evaluates identities.
- **Warehouse writes** are throttled at 10 per minute, so sandboxes skip the warehouse.
- **CLI v2:** writes need `--yes` without a terminal; no experiment or metric commands (use `flagsmith api`);
  self-hosted auth uses `FLAGSMITH_API_KEY_<host>_<port>`.
- **MCP server:** 54 tools, 29,270 tokens; auth `Authorization: Api-Key <org master key>`.
- **Node 26** runs the `.ts` files directly; erasable TypeScript only.
- **`.env` is loaded when `src/lab/config.ts` is imported,** so module-level constants see overrides.

## 5. Commands

```bash
npm install
npm run cli:image                           # CLI sandbox image
npm run lab:reset                           # fresh Flagsmith lab and experiment (wipes the lab database)
npm run selftest                            # verifier proves all 16 jobs
npm run experiment:start
node src/run.ts --run main --count 255 --concurrency 6
npm run readout -- main
npm run ship -- main
npm run which
node src/run.ts --run after-ship --count 6 --follow-flag
npm run tokens
npm run export:web -- main
```
