# Matched MCP guidance study v1

This document fixes the protocol before the pilot or registered outcomes. The two-arm manifest, guide, catalog and this revision of the protocol define the study. Record any subsequent deviation with its date and affected identities before interpreting the results.

## Intervention and population

Both arms receive the official Flagsmith 2.295.2 MCP server's same 54 sorted tools, schemas and descriptions, with sandbox-only credentials. Both use the same base prompt, prompt caching, Claude Haiku 5.5 at medium effort, 16,000 maximum output tokens and 30 turns. Only `mcp_guided` appends the full frozen guide to the system prompt. The runner fingerprints the wire schemas before the first paid call and checks every subsequent trial against that fingerprint. The guide SHA-256 is `9ef553f2c172463c7bf559b42ce8ea9b10e7d13ec7204986f69353bd549b7952`. The catalog SHA-256 is `e0d20f7c2398f1164da2daf48314215718c922c2e612b44f623f1cfb71dcaf12`.

The question is whether the guide reduces mean USD per job while keeping correctness and detected change scope within five percentage points of the control on four jobs. The jobs in cyclic order are `kill_switch`, `set_value_in_development`, `segment_override` and `remove_segment_override`. Generalization is limited to these four templates, one model and one tool surface.

## Enrollment and matching

1. In a new control project and environment, create a new experiment on `agent_interface_mcp_guidance_v1`. Keep distinct project, environment, feature, metric, option and experiment IDs.
2. Pilot 12 forced pairs (24 fresh sandboxes, three pairs per template), alternating which arm goes first between pairs. Disable experiment evaluation and all exposure and conversion sends in the pilot. Verify the native experiment has zero exposures before starting registration. The pilot is an operational check with separate identities, seeds and files.
3. Enroll 128 distinct, predefined registered identities in ascending index. Let the feature flag allocate 50% to each arm. Keep the realized arm even if counts differ. The zero-based kth identity assigned to either arm receives case k. Select template k modulo four and render with seed `mcp-guidance-v1/<phase>/<k>`, using the same concrete task, seed data and verifier in fresh sandboxes. Record the identity, arm, rank, case digest and assignment source before execution.
4. Run all assigned identities, including the excess arm's unpaired tail. Never draw more identities to force balance. Record unsupported calls, failures, refusals and turn limits as graded outcomes. An infrastructure or API interruption keeps its recorded attempts, spend, assignment and case for a retry. A finished outcome is final. Include costs of every billed attempt under its assigned identity. A missing outcome remains visible.
5. The pilot and registered phase share a $2 incremental cap. All real runs share the $15 project cap and one paid coordinator lock. Reserve a conservative request maximum before each call. Rejected or interrupted reservations and ambiguous deliveries must be reconciled before resumption. On a cap or operational stop, report the accrued data and stop reason. Do not stop early for efficacy.

## Estimands and inference

For each complete pair subtract control from guided. The primary estimate is the unweighted arithmetic mean of those within-case cost differences in nominal USD/job, including failed jobs. Compute a deterministic two-sided 95% percentile interval (10,000 replicates, resample pairs with replacement within each of the four fixed templates, preserve stratum sizes, linearly interpolate the 2.5th and 97.5th percentiles). Report paired arm means and the full assignment-based arm counts, raw pass and scope counts, spend, attempted jobs and missing outcomes. Label unmatched identities and show their available results separately. Subgroups and the native unpaired estimates are descriptive.

Correctness requires the catalog end state and zero detected out-of-scope differences between snapshots. The scope guardrail requires zero detected out-of-scope final state differences. For each guardrail report the paired rate difference and counts of wins, losses and ties. Use a distribution-free conservative one-sided 95% lower confidence bound for the difference: minus the exact one-sided Clopper–Pearson upper bound on the probability of a paired loss (control passes, guide fails). Gains cannot reduce this difference. Zero losses still produce a nonzero uncertainty bound. This rule may leave a beneficial treatment inconclusive at this sample size.

## Decision

Require all 128 assigned identities to have terminal graded outcomes, at least 50 complete matched pairs, at least 50 assigned per arm, all four templates represented, and at least five conversions per binary guardrail per arm. Require the native counts and event sums for each arm to reconcile with the saved assignment ledger, including unmatched runs, no excluded identities, and a 50/50 sample-ratio chi-square p-value of at least 0.01. Any missing floor, unresolved retry, exposure discrepancy or unverified cost yields **INCONCLUSIVE**.

Call **GUIDE REDUCES COST WITHIN GUARDRAILS** only if the primary upper 95% endpoint is strictly below zero and both guardrail lower bounds exceed −0.05. Call **GUIDE COSTS MORE** if the primary lower endpoint is strictly above zero and the data floors hold. All other outcomes are **INCONCLUSIVE**. Always show both guardrails independently and name any that fail the margin. No automatic rollout or change to the archived experiment follows.
