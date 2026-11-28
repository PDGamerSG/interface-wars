# Operating Interface Wars

How to replay the archive, run new trials and operate the controls. The [README](../README.md) has the results and
the summary of how the experiment works.

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

New runs can opt into the prospective strict draft grader with `node src/run.ts --grader strict-draft-v1`. It keeps the
registered grader as the default and records the grader version on each new trial. Strict experiment-creation jobs require
the exact hypothesis and metric directions, a created status, a disabled rollout, and a 50/50 variation allocation.
The archived main records and registered readout are unchanged.

Agent outcomes record `done` or `failed` only when the final response contains one unambiguous standalone `DONE:` or
`FAILED:` line. A missing or mixed status is recorded as `incomplete`, so prose such as `DONE? No` cannot be counted as
a completed report.

To replay the recorded demo without credentials, Docker, model calls or network access, run `npm run demo`. It prints
the matched `apple_pay_copy` comparison, the registered and staging-safe readings, the human approval and the six
post-ship jobs. The timed presentation is in [the demo storyboard](DEMO_STORYBOARD.md).

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

## Operational controls

The control organisation has two remote flags for an active run. They are created with `node src/cli.ts ops:setup`.

```bash
node src/cli.ts ops:setup
node src/cli.ts ops:pause
node src/cli.ts ops:resume
```

`trials_enabled` stops new trials while allowing an already-running trial to finish. `spend_cap_usd` lowers the
machine-side `IW_MAX_SPEND_USD` cap, which a real run requires as a finite dollar amount. The runner refreshes both
flags before every trial. If the control flags cannot be read, the runner starts no new trial, because it cannot honour
the kill switch. Rerunning the same `--run` later retries the missing trials. `IW_OPS_OFFLINE=1` lets an operator run on
the machine cap alone, and the last cap read from Flagsmith stays in force during an outage. These controls apply to
new runs and do not alter the archived `main` records.

## Public judge site

The repository includes a small read-only static presentation in `judge-site/`. It reads the committed aggregate export and links to the source evidence without exposing raw transcript records or making Flagsmith writes. Render can build it with `npm --prefix judge-site run build` and publish `judge-site/dist`.

Open the live judge site at [interfacewars.pallabdas.me](https://interfacewars.pallabdas.me/). It is a Render static
site built from `main` with the build described above. The domain is a Namecheap CNAME to `interface-wars.onrender.com`.

`.github/workflows/deploy.yml` deploys it after the `checks` workflow passes on `main`. The workflow calls the Render deploy
hook stored in the `RENDER_DEPLOY_HOOK` repository secret. It then waits until the live `version.json` names that commit
or a later one, and checks that the page and its three data files are served. A deploy that never goes live fails the
workflow. To deploy by hand, run the workflow from the Actions tab.

Published trial records pass through the same field-aware redactor before they are written to `runs/` or exported to the site. Historical Flagsmith environment keys become stable `[env-…]` labels for trace matching, while server keys and other credential fields become `[REDACTED]`. The exporter fails if a credential-shaped value remains.
`npm run scan:secrets` applies the same detector to every tracked file, and CI runs it on each change. Commits before
`31e992e` contain environment keys of sandbox organisations on the local lab at 127.0.0.1. Each sandbox was deleted
after its trial, and the lab was never reachable from the internet.

## Query the evidence

Build a redacted, read-only SQLite projection of the archived trial records. It gives cross-trial answers about tool
errors, recoveries and specific Flagsmith failures while preserving a source file, SHA-256 digest and JSON pointer
for every trace row.

```bash
npm run evidence -- build main
npm run evidence -- matrix main
npm run evidence -- schema-failures main
npm run evidence -- recoveries main
npm run evidence -- explain main-0117 main
```

The database is reproducible and ignored by Git. Named recipes open it read-only. The matrix shows 197 clean passes,
32 recovered passes, 19 failed trials after a tool error and 7 failures without one. See
[the evidence index guide](EVIDENCE_INDEX.md).

## Experiment manifests and a matched MCP follow-up

The shipped three-arm study is an immutable archive. New studies are described before execution by a versioned
manifest that includes the question, Flagsmith assignment flag, arm shares, model settings, job pack, metrics,
guide hashes and spend budget. The preregistered `mcp-guidance-v1` study keeps the official 54-tool MCP surface in both
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
See [the manifest design](EXPERIMENT_MANIFESTS.md) and [the frozen guide](../guides/mcp-guidance-v1.md).

## Staged release gate

Track 04 now includes `skills/flagsmith-release-gate/`, a separate production-safety workflow for a future rollout. It binds the target and disabled pre-state to a signed digest, requires two distinct approvals, checks the kill switch and lower spend cap before every write, promotes one stage at a time, evaluates member and nonmember probes, and records rollback receipts. The archived `agent_interface` experiment is unchanged.

```bash
node skills/flagsmith-release-gate/scripts/release.ts demo
npm run release:smoke
```

The first command is a credential-free rehearsal. The second uses the official Flagsmith CLI against one disposable local organization and proves disabled creation, approval denial, cohort verification, idempotent retry and rollback to zero. See [the release gate guide](RELEASE_GATE.md).
