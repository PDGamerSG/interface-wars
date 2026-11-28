---
name: flagsmith-release-gate
description: Plan, approve, stage, verify and roll back a Flagsmith experiment rollout through CLI v2 with signed two-person approvals and cohort guardrails.
license: MIT
---

# Flagsmith release gate

Compatibility: Flagsmith CLI v2.0.0, jq, noninteractive credentials, an experiment API with rollout and transient evaluation support, and a local spend ledger.

Use this skill when a change is ready for a controlled Flagsmith rollout. The workflow keeps a created experiment disabled at zero enrollment, collects two distinct signed approvals over one immutable plan, promotes one stage at a time, evaluates a member and nonmember probe, and retains a rollback receipt.

## Safety contract

- Read the target and policy flags before every mutating CLI call. An unavailable policy, disabled `release_ops_enabled`, invalid remote cap, or invalid local cap denies the write.
- A plan digest covers the target identifiers, hypothesis, metric directions, disabled pre-state, variants, audience and every stage probe. Reuse the plan only when its digest matches both approvals.
- Use two distinct operator keys. A second name for the same public key does not count. Never put an API key, private key or raw CLI diagnostic in a plan, approval, receipt or transcript.
- Promotion is strictly increasing. A failed read-back or cohort check rolls back to the exact previous enrollment. Roll back stages in reverse order.
- Flagsmith 2.295.2 cannot return a running experiment to `created`. Rollback therefore disables enrollment and returns the rollout percentage to zero while preserving the running lifecycle state.
- Do not report success until the post-write state hash and both cohort probes match the signed plan.

## Credential-free rehearsal

Run the deterministic rehearsal before using credentials. It makes no network request or Flagsmith write.

```bash
node skills/flagsmith-release-gate/scripts/release.ts demo
```

The output is JSON with a plan digest, promotion receipts and a final disabled enrollment. The repository's release-smoke also runs the same skill against one disposable local Flagsmith organization through the official CLI.

```bash
npm run release:smoke
```

## Live workflow

The CLI is the only transport. Set `FLAGSMITH_API_URL`, `FLAGSMITH_ENVIRONMENT`, `IW_MAX_SPEND_USD`, `IW_RELEASE_SPEND_FILE` and `IW_RELEASE_SIGNERS`. The environment key is read by the CLI's normal configuration. Generate a plan from a disabled experiment and a JSON stage pack.

```bash
node skills/flagsmith-release-gate/scripts/release.ts plan <experiment-id> stages.json > release.plan.json
```

`stages.json` contains increasing percentages. Every stage has one `member` and one `nonmember` probe with the expected resolved flag value.

Generate approvals on separate operator machines or with separately protected private keys. Keep private key files outside the repository.

```bash
IW_RELEASE_SIGNING_KEY=/secure/alice.pem \
  node skills/flagsmith-release-gate/scripts/release.ts sign release.plan.json alice > alice.approval.json
IW_RELEASE_SIGNING_KEY=/secure/bob.pem \
  node skills/flagsmith-release-gate/scripts/release.ts sign release.plan.json bob > bob.approval.json
```

The trusted public keys map is a JSON object in `IW_RELEASE_SIGNERS`. Apply one stage at a time. A guardrail failure exits with status 2 after the gate restores the previous stage.

```bash
node skills/flagsmith-release-gate/scripts/release.ts apply release.plan.json 1 alice.approval.json bob.approval.json
node skills/flagsmith-release-gate/scripts/release.ts rollback release.plan.json 1 alice.approval.json bob.approval.json
```

A receipt is safe to attach to a change request. It contains hashes, stage, probe matches and status. Inspect a denial, the live state and the policy before retrying. Never bypass the gate with a direct API request.
