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

## Human decision

The readout recommended `cli_skill`. The approver typed `cli_skill`, recorded in `runs/main/approval.json`.
