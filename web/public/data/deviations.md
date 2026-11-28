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
5. **CLI sandbox network isolation, new runs only.** The archived CLI-arm trials ran on Docker's default bridge
   network with a host-gateway entry. Bash's `/dev/tcp` could therefore have opened sockets to the MCP server, the
   Docker host or the internet. New runs put the container on the internal `cli-sandbox` network in
   `infra/compose.yml`, whose only other member is the Flagsmith API. `npm run cli:isolation` runs in CI and
   checks raw sockets and HTTP against the MCP server, Postgres, the Docker host, the gateway and public
   addresses. The audit in `test/cli-archive-network.test.ts` read every recorded CLI-arm command and found no
   `/dev/tcp` or `/dev/udp` use. Nine `cli` trials (eight main, one pilot) tried `curl` or `python3` against
   Flagsmith's own address, and each attempt failed because the client is not installed. The archive and its
   grades are unchanged.
6. **Write audit, new runs only.** The registered grader compares two snapshots, so it cannot see a change that
   is reverted before the final snapshot. New runs read the sandbox organisation's Flagsmith audit log for the
   agent's run (`src/lab/audit.ts`). They map each write to the object it touched. A write to an object the job
   may not change fails the trial, even when the agent reverted it. The check is object-level and does not see
   which field changed inside an allowed object. Each record stores the result as `writeAudit`. The readout shows
   final collateral and observed out-of-scope writes as separate counts. `IW_WRITE_AUDIT=0` turns the check off,
   which reproduces the registered protocol. The verifier self-test now also proves two things on all 16
   templates. Every reference-solution write is in scope, and a decoy description and Production state change
   that is reverted is caught. Flagsmith 2.295.2 returns no audit rows through its API on an unlicensed
   self-hosted install, so the harness reads the rows from the lab database in a read-only transaction. Audit
   rows that Flagsmith failed to write are counted as `lostRows` (findings 11 and 12). The lab Postgres now allows
   500 connections. The archive has no audit data and its grades are unchanged.

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
