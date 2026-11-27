# Sensitivity of the main result

Post-hoc checks on the 255 recorded trials. The registered rule compared each CLI arm with MCP.

| Arm | Registered passes | Passes requiring disabled staging | Registered passes on the 11 templates outside the five MCP gaps |
|---|---:|---:|---:|
| mcp | 68/87 | 64/87 | 67/67 |
| cli | 75/82 | 75/82 | 54/55 |
| cli_skill | 86/86 | 80/86 | 53/53 |

| Comparison | Correctness difference in percentage points [95% template bootstrap interval] |
|---|---:|
| Skill vs MCP, requiring disabled staging | 19.5 [0.0, 42.6] |
| CLI vs MCP, equal weight for each of the 16 templates | 23.4 [5.5, 43.8] |
| Skill vs CLI, registered grades and trial weights | 8.5 [0.0, 18.0] |

The staged skill interval reaches zero. A win requires a lower bound above zero. Flagsmith received the registered outcomes.

These setup-only trials ended with the rollout enabled while the experiment was still marked created.

[main-0025](trials/main-0025.json), [main-0041](trials/main-0041.json), [main-0073](trials/main-0073.json), [main-0105](trials/main-0105.json), [main-0121](trials/main-0121.json), [main-0137](trials/main-0137.json), [main-0153](trials/main-0153.json), [main-0185](trials/main-0185.json), [main-0233](trials/main-0233.json), [main-0249](trials/main-0249.json).

The eleven-template subset excludes `archive_stale_flag`, `change_split_in_production`, `create_metric`, `ship_winner`, `start_experiment`.
