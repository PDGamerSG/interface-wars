# Interface Wars readout: main

255 trials, model `claude-haiku-5-5` at effort `medium`. Generated 2026-11-27T20:38:48.950Z.

| Arm | Trials | Jobs correct | Out-of-scope changes | Mean cost | Cost per correct job | Mean input tokens |
|---|---:|---:|---:|---:|---:|---:|
| mcp | 87 | 68 (78.2%) | 0 (0.0%) | $0.0056 | $0.0072 | 130,914 |
| cli | 82 | 75 (91.5%) | 0 (0.0%) | $0.0034 | $0.0037 | 88,008 |
| cli_skill | 86 | 86 (100.0%) | 0 (0.0%) | $0.0013 | $0.0013 | 20,329 |

## Decision (pre-registered rule)

- **cli vs mcp: INCONCLUSIVE.** Flagsmith: lift 17.0%, 95% interval 1.8% to 32.2%, chance to beat control 98.6%. Template bootstrap: 13.3% points (-1.0% to 33.7%). Guardrails: change scope held, cost held.
- **cli_skill vs mcp: WIN.** Flagsmith: lift 27.9%, 95% interval 13.6% to 42.2%, chance to beat control 100.0%. Template bootstrap: 21.8% points (6.1% to 43.1%). Guardrails: change scope held, cost held.

**Recommendation:** ship `cli_skill`. Met the pre-registered bar on job_correct with both analyses agreeing and no guardrail breach.

## By job family

| Family | mcp | cli | cli_skill |
|---|---:|---:|---:|
| flags | 24/24 | 19/19 | 21/21 |
| targeting | 23/27 | 15/15 | 22/22 |
| experiments | 6/17 | 18/25 | 22/22 |
| repair | 15/19 | 23/23 | 21/21 |

## Held-out templates (not used while writing the skill)

| Arm | Correct |
|---|---:|
| mcp | 25/28 |
| cli | 16/19 |
| cli_skill | 16/16 |

## Sample ratio check

Harness chi-square test against the configured split: mcp 87, cli 82, cli_skill 86 of 255; chi-square 0.164 on 2 df, p = 0.921. No sign of unbalanced assignment.

Flagsmith's own check: not computed (Flagsmith 2.295.2 reads the split from the environment default, which an experiment zeroes; see its TODO in `_expected_variant_shares`).
