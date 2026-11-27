# Interface Wars readout: pilot

30 trials, model `claude-haiku-5-5` at effort `medium`. Generated 2026-11-27T20:14:45.321Z.

| Arm | Trials | Jobs correct | Out-of-scope changes | Mean cost | Cost per correct job | Mean input tokens |
|---|---:|---:|---:|---:|---:|---:|
| mcp | 10 | 7 (70.0%) | 0 (0.0%) | $0.0057 | $0.0082 | 139,257 |
| cli | 10 | 10 (100.0%) | 0 (0.0%) | $0.0026 | $0.0026 | 59,127 |
| cli_skill | 10 | 10 (100.0%) | 0 (0.0%) | $0.0013 | $0.0013 | 21,596 |

## Decision (pre-registered rule)

- **cli vs mcp: INCONCLUSIVE.** Flagsmith: no result yet. Template bootstrap: 30.0% points (0.0% to 61.5%). Guardrails: change scope held, cost held.
- **cli_skill vs mcp: INCONCLUSIVE.** Flagsmith: no result yet. Template bootstrap: 30.0% points (0.0% to 60.0%). Guardrails: change scope held, cost held.

**Recommendation:** keep the control. No arm met the pre-registered bar against the MCP control. Keep the control.

## By job family

| Family | mcp | cli | cli_skill |
|---|---:|---:|---:|
| flags | 3/3 | 3/3 | 2/2 |
| targeting | 1/2 | 3/3 | 3/3 |
| experiments | 1/3 | 2/2 | 3/3 |
| repair | 2/2 | 2/2 | 2/2 |

## Held-out templates (not used while writing the skill)

| Arm | Correct |
|---|---:|
| mcp | 2/3 |
| cli | 2/2 |
| cli_skill | 2/2 |
