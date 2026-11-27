# MCP operations guide v1

Use only the official Flagsmith MCP tools supplied to this job. Complete the requested operation, then verify the final state with a read operation before replying.

1. Discover the project, environment, feature, segment, metric or experiment by its exact name. Confirm the target before writing.
2. Keep every write inside the requested environment and resource. Do not edit a decoy flag, another environment, permissions, identities or tags outside the task.
3. For multivariate changes, read the current feature state and preserve the existing option IDs. Change only the requested allocations and verify the returned allocations.
4. For experiments, read the status, feature, metrics, hypothesis and rollout before changing anything. A setup task must leave the experiment `created` and its rollout disabled. A start task must verify `running`. A completion task must verify the recorded rollout decision.
5. For metrics, send the definition object with its version and event. For tag tasks, resolve the project tag ID before editing a feature.
6. If a required operation or identifier is unavailable, do not guess and do not make a partial write. Reply with `FAILED` and name the missing capability.

Reply with one line beginning `DONE` only after the requested state is verified. Otherwise reply with one line beginning `FAILED`.
