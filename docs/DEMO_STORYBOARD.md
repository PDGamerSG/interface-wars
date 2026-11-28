# Interface Wars demo storyboard

Runtime target is 2 minutes 45 seconds. The recording uses the repository checkout and the deterministic offline command below. It does not need an API key, Docker, a running Flagsmith instance, or network access.

```bash
npm ci
npm run demo
```

| Time | Screen and action | Spoken track | Evidence to leave visible |
|---|---|---|---|
| 0:00–0:12 | Title card, then the question | “The Flagsmith team preferred the CLI. We tested that claim by giving agents the same real Flagsmith jobs through MCP, the CLI, or the CLI plus an Agent Skill.” | `Interface Wars` and the question |
| 0:12–0:28 | Show the three-arm pipeline | “Flagsmith assigned each trial through a multivariate flag. Every trial got a fresh sandbox, a verifier checked the requested state and collateral changes, and the outcomes went back to Flagsmith Experimentation.” | `MCP → CLI → CLI + skill`, assignment flag, verifier, events |
| 0:28–0:48 | Run `npm run demo` and hold on the matched-case table | “This is an archived, offline replay. The comparison uses the same `start_experiment` job, `apple_pay_copy test`, in all three arms.” | `main-0138`, `main-0074`, `main-0154` |
| 0:48–1:10 | Show the three case summaries | “MCP could not start the experiment. Bare CLI spent more time investigating and still left it created. The skill used four calls, reached running, and passed every programmed check.” | Tool-error counts, verifier lines, `CORRECT` for `main-0154` |
| 1:10–1:30 | Show the registered result lines | “Across 255 trials, the registered grader recorded MCP at 68 of 87, CLI at 75 of 82, and CLI plus skill at 86 of 86. The pre-registered rule called the skill a win. CLI stayed inconclusive.” | Registered result lines and per-arm counts |
| 1:30–1:53 | Show the stricter interpretation | “There is an important safety qualification. Ten setup-only experiment passes ended with enrollment enabled. Requiring disabled staging changes the counts to 64 of 87, 75 of 82, and 80 of 86. The skill’s interval reaches zero, so that stricter reading is inconclusive.” | Strict counts and `19.5 [0.0, 42.6]` interval |
| 1:53–2:10 | Show the human gate | “The readout recommended `cli_skill`. Pallab Das approved it, and Flagsmith completed the experiment with the variant rollout decision.” | Approval line and `rollout_decision=variant` |
| 2:10–2:32 | Show the six after-ship rows | “The closed loop then evaluated six new sessions from the shipped flag. All six used the skill and passed their assigned jobs with no collateral changes.” | `after-ship-0000` through `after-ship-0005`, `6/6` |
| 2:32–2:45 | End card with repository and judge site | “The result is reproducible from the committed archive. The repository includes the method, evidence index, sensitivity analysis, and the frozen skill so the claim can be checked without rerunning paid trials.” | Repository URL, live judge site URL, `npm run demo` |

## Recording notes

- Keep the terminal at 1080p or wider and use a large monospace font so the trial table and the two result readings remain legible.
- Do not show raw trial JSON or shell transcripts. They contain archived sandbox credentials and are intentionally excluded from the demo output.
- Pause briefly after the registered result and after the stricter interpretation. The qualification is part of the result, not an appendix.
