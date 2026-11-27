# Deviations from the pre-registration

The pre-registration is `prereg/PREREGISTRATION.md` at git tag `prereg-v1`. This file lists everything that
happened differently from it, or was added after it. None of these changes the decision rule, the counted trials or
the verdicts.

## What ran as registered

- 255 counted trials, model `claude-haiku-5-5`, effort `medium`, 30-turn limit, frozen job catalog and skill.
- Flagsmith assigned 87 trials to `mcp`, 82 to `cli` and 86 to `cli_skill`.
- No infrastructure errors, so no trial was retried. No trial ended in `api_error`, so none was excluded.
- Spend for the main run: $0.88. Total project spend including smoke, pilot and the post-ship batch: $1.00 of the
  $15 cap.
- The decision rule in `src/experiment/readout.ts` is unchanged.

## Added after the main run

1. **Harness sample-ratio check.** Flagsmith returned `srm_p_value: null`, because version 2.295.2 reads the
   expected split from the environment default, which an experiment zeroes
   (`_expected_variant_shares` in `experimentation/services.py` has a TODO for this). The readout now also runs a
   chi-square test of the arm counts against the configured split (p = 0.92). The check is reported next to the
   decision and is not part of the rule.
2. **`which` evaluates identities.** After the ship, `node src/cli.ts which` reported `mcp`, because it read the
   environment-level flags endpoint, which ignores multivariate splits. It now evaluates fresh agent-session
   identities, which all get `cli_skill`. This changed no data.
3. **Post-ship batch.** `node src/run.ts --follow-flag` was added to show agents taking their interface from the
   shipped flag. Six trials ran (`runs/after-ship/`), with no experiment events. They are not counted.
4. **Interface token counts.** `scripts/count-tokens.ts` measures the per-request cost of each interface with the
   token counter. Reported only.

## Post-hoc checks on the saved trials

A setup-only experiment could pass the frozen grader with an enabled rollout. Flagsmith can enroll identities
in this state even when the status reads `created`. The grader also omitted the requested hypothesis and 50/50
rollout. The archived override snapshot lacks the variant weights needed for a complete retrospective regrade.
The stricter check below uses the recorded enabled bit. [Frozen grader](https://github.com/PDGamerSG/interface-wars/blob/main/src/jobs/catalog.ts) · [Rollout semantics in 2.295.2](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/experimentation/services.py#L963-L975)

| Post-hoc question | Result |
|---|---|
| What if a staged rollout must be disabled? | Four MCP and six skill passes change to failures. Counts become MCP 64/87, CLI 75/82 and skill 80/86. Skill minus MCP is +19.5 percentage points [0.0, +42.6], below the registered win threshold. |
| What happened on the 11 templates outside the five observed MCP gaps? | On the frozen grader, MCP passed 67/67, CLI 54/55 and skill 53/53. The subset was chosen after observing the failures. |
| How much does weighting matter? | Across all 16 templates, weighting each equally gives CLI minus MCP +23.4 percentage points [+5.5, +43.8]. The registered run pooled trials inside each resampled set of templates. |
| What is the incremental skill effect over CLI? | Using the registered grades and bootstrap gives +8.5 percentage points [0.0, +18.0]. The clearer observed difference was a 63% reduction in mean cost per job. |

Intervals use 4,000 template bootstrap draws. Reproduce the table and ten affected trial IDs with
`node scripts/sensitivity.ts`. Flagsmith's recorded inference and the approval used the registered outcomes.
Four failed CLI records opened with `DONE:`. Zero detected out-of-scope final changes describes only the
fields in the final snapshot. The published transcripts clipped 203 tool outputs at the 4,000-character
limit. [Calculations](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/sensitivity.md) · [Recorded examples](https://github.com/PDGamerSG/interface-wars/blob/main/docs/FLAGSMITH_FINDINGS.md#agent-behaviour-worth-knowing)

## Human decision

The readout recommended `cli_skill`. The approver typed `cli_skill`, recorded in `runs/main/approval.json`.
