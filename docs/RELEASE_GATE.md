# Release gate

The `flagsmith-release-gate` skill is a Track 04 workflow for controlled experiment rollouts. It adds a production-safety layer around the Flagsmith CLI without changing the archived `agent_interface` experiment.

## What it proves

- A plan binds the feature, environment, experiment, hypothesis, metric directions, disabled enrollment, variants, audience and stages under a SHA-256 digest.
- Two distinct Ed25519 signatures are required. Duplicate approvals, stale digests and two names for one key are rejected before any write.
- The kill switch and the lower of the local and remote spend caps are checked immediately before every write.
- A created experiment starts with `enabled=false` and `rollout_percentage=0`. Starting it is an explicit irreversible lifecycle transition, then each stage writes and reads back its exact percentage.
- A member and nonmember identity are evaluated transiently after each promotion. Any mismatch restores the previous enrollment and returns a failure receipt.
- A rollback capsule records the plan digest, pre/post hashes and prior stage. On Flagsmith 2.295.2 the lifecycle remains `running` after rollback because the server does not support `running -> created`, while enrollment is disabled at zero percent.

## Commands

```bash
node skills/flagsmith-release-gate/scripts/release.ts demo
npm run release:smoke
```

The first command is offline and deterministic. The second provisions one disposable local organization, creates a disabled experiment, invokes the installed Flagsmith CLI through the skill, proves a duplicate approval is denied, promotes a stage, verifies member and nonmember evaluation, retries idempotently, rolls back to zero and deletes that disposable organization.

The live workflow reads only the official CLI v2 transport. Plans, approvals and receipts are credential-free. Private signing keys stay outside the repository.

## Test coverage

`test/release-gate.test.ts` covers plan validation, signature tampering, duplicate signers, policy outage, kill switch denial, cap boundaries, stage ordering, state drift, read-back mismatch, cohort rollback, retry idempotence and reverse rollback. `scripts/release-smoke.ts` is the integration fixture for the local Flagsmith 2.295.2 stack.
