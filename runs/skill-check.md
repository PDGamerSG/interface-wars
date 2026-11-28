# Skill revision check

Both revisions used the CLI, Claude Haiku 5.5 at medium effort, the strict draft grader and the write audit.
They ran the same template schedule with independently seeded job details. The plan specified a descriptive comparison with three to nine trials per template. [Plan](../prereg/SKILL_V2_CHECK.md)

- [skill-v1-check](skill-v1-check/trials/) contains 60 trials with `flagsmith-ops` at `f6f350aec5da`.
- [skill-v2-check](skill-v2-check/trials/) contains 60 trials with `flagsmith-ops-v2` at `19b412bfdfa7`.

| Measure | Revision 1 | Revision 2 |
|---|---:|---:|
| Drafts left with enrollment enabled | 9/9 | 0/9 |
| Starts ending in running status | 9/9 | 9/9 |
| Starts with enrollment above 0% among measured starts | unmeasured | 9/9 (observed 100%) |
| Starts missing a final enrollment percentage | 9/9 | 0/9 |
| Trials with final collateral | 0/60 | 0/60 |
| Trials with observed out-of-scope writes | 0/60 | 0/60 |
| Trials with lost audit rows | 0/60 | 0/60 |
| Trials ending in an API error | 0/60 | 0/60 |
| Mean cost per trial | $0.0014 | $0.0014 |
| Total cost | $0.0840 | $0.0856 |

Each start job used a fresh experiment seeded at 100% enrollment. Starting a zero-percent draft created by an earlier job was outside this check.
The final snapshot records running status. The final CLI response supplies enrollment when the agent requested it. [Revision 1 example](skill-v1-check/trials/skill-v1-check-0010.json) · [Revision 2 example](skill-v2-check/trials/skill-v2-check-0010.json)

| Template | Revision 1 strict passes | Revision 2 strict passes |
|---|---:|---:|
| `create_flag` | 3/3 | 3/3 |
| `enable_in_production` | 3/3 | 3/3 |
| `set_value_in_development` | 3/3 | 3/3 |
| `kill_switch` (held out) | 3/3 | 3/3 |
| `create_multivariate` | 3/3 | 3/3 |
| `change_split_in_production` | 3/3 | 3/3 |
| `create_segment` | 3/3 | 3/3 |
| `segment_override` (held out) | 3/3 | 3/3 |
| `create_metric` | 3/3 | 3/3 |
| `create_experiment` | 0/9 | 3/9 |
| `start_experiment` | 9/9 | 9/9 |
| `ship_winner` (held out) | 3/3 | 3/3 |
| `sync_production_to_development` | 3/3 | 3/3 |
| `find_maintenance_flag` | 3/3 | 3/3 |
| `archive_stale_flag` | 3/3 | 3/3 |
| `remove_segment_override` (held out) | 3/3 | 3/3 |
| **All** | **51/60** | **54/60** |

| Hypothesis mismatches | Revision 1 | Revision 2 |
|---|---|---|
| Difference from the exact requested text | 2 added a final period, 1 dropped quotation marks | 2 added a final period, 4 dropped quotation marks |

The prompt puts the hypothesis at the end of a sentence. The grader treats the final period as sentence punctuation and includes both quoted variant names in the expected text.

## Failed trials

- [skill-v1-check-0009](skill-v1-check/trials/skill-v1-check-0009.json) (`create_experiment`) — strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0025](skill-v1-check/trials/skill-v1-check-0025.json) (`create_experiment`) — strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0041](skill-v1-check/trials/skill-v1-check-0041.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text. strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0057](skill-v1-check/trials/skill-v1-check-0057.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text. strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0073](skill-v1-check/trials/skill-v1-check-0073.json) (`create_experiment`) — strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0089](skill-v1-check/trials/skill-v1-check-0089.json) (`create_experiment`) — strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0105](skill-v1-check/trials/skill-v1-check-0105.json) (`create_experiment`) — strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0121](skill-v1-check/trials/skill-v1-check-0121.json) (`create_experiment`) — strict draft: enrollment must be disabled while the experiment is created.
- [skill-v1-check-0137](skill-v1-check/trials/skill-v1-check-0137.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text. strict draft: enrollment must be disabled while the experiment is created.
- [skill-v2-check-0009](skill-v2-check/trials/skill-v2-check-0009.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text.
- [skill-v2-check-0041](skill-v2-check/trials/skill-v2-check-0041.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text.
- [skill-v2-check-0073](skill-v2-check/trials/skill-v2-check-0073.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text.
- [skill-v2-check-0089](skill-v2-check/trials/skill-v2-check-0089.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text.
- [skill-v2-check-0105](skill-v2-check/trials/skill-v2-check-0105.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text.
- [skill-v2-check-0137](skill-v2-check/trials/skill-v2-check-0137.json) (`create_experiment`) — strict draft: hypothesis does not match the registered text.
