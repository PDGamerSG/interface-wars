# Skill revision 2 check

This plan was written and merged before any trial ran with revision 2. The archived study, its registered grader and its
readout are unchanged. This is a descriptive check, not a registered comparison, and it has no decision rule.

## Question

Does `flagsmith-ops-v2` (SHA-256 `19b412bfdfa744c5b694bd65148ef45c5575db3d426f1dcba5e64146c94f6de8`) stage
experiment drafts with enrollment off? Does it keep the revision 1 (SHA-256
`f6f350aec5da331637eaf740f37da39445b693b57967531bd377fca89c509328`) results on the other fifteen templates?

## Runs

Both runs use the `cli_skill` arm, Claude Haiku 5.5 at medium effort, the `strict-draft-v1` grader and the write
audit. Only `IW_SKILL` differs.

| Run | `IW_SKILL` | Trials |
|---|---|---|
| `skill-v1-check` | unset (`flagsmith-ops`) | indices 0–47, then `create_experiment` and `start_experiment` from indices 48–143 |
| `skill-v2-check` | `flagsmith-ops-v2` | the same indices |

Each run has 60 trials: three per template, plus six more `create_experiment` (indices 57, 73, …, 137) and six more
`start_experiment` (indices 58, 74, …, 138). Trial IDs include the run name, so each run renders its own concrete jobs
from the same templates. The v1 run goes first, then the v2 run, both at concurrency 6.

```bash
IW_MAX_SPEND_USD=2.50 node src/run.ts --run skill-v1-check --arm cli_skill --grader strict-draft-v1 --from 0 --count 48
IW_MAX_SPEND_USD=2.50 node src/run.ts --run skill-v1-check --arm cli_skill --grader strict-draft-v1 --from 48 --count 96 --template create_experiment
IW_MAX_SPEND_USD=2.50 node src/run.ts --run skill-v1-check --arm cli_skill --grader strict-draft-v1 --from 48 --count 96 --template start_experiment
# then the same three commands with IW_SKILL=flagsmith-ops-v2 and --run skill-v2-check
```

## Spend

`IW_MAX_SPEND_USD=2.50` is the machine cap for these runs. The project ledger stood at $1.00 before them, so the
check may add at most $1.50. If the cap stops a run, the report gives the trials that finished and says where it stopped.

## Report

For each run, the report gives:

- the strict pass count per template
- for `create_experiment`, the number of drafts left with enrollment enabled
- for `start_experiment`, the number that ended running with a rollout above 0%
- final collateral and observed out-of-scope writes
- mean cost per trial

Every trial counts, including failures, API errors and turn limits. With three to nine trials per template, small
differences are noise. The report states counts, not rates or intervals.
