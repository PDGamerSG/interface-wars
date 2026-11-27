# Experiment manifests

A manifest makes a future Flagsmith study reviewable before it runs. It is data, separate from the archived `main`
run. `src/experiment/manifest.ts` validates it without reading `runs/lab.local.json`, calling Flagsmith or calling
the model.

## Fields

- `id`, `schemaVersion`, `title` and `question` identify the study.
- `flag` and `arms` specify the assignment surface and expected shares.
- `model` fixes the model, effort and turn limit.
- `jobPack` names existing catalog templates. A future matched runner will render the same case seed for both arms.
- `metrics` names the primary and guardrail events sent to Flagsmith.
- `budget` is a machine-side USD ceiling and an expected spend estimate.
- An arm may name a checked-in guide. The plan prints its SHA-256 digest.

## Planned follow-up

`mcp-guidance-v1` compares the official MCP server with the same server plus
[`guides/mcp-guidance-v1.md`](../guides/mcp-guidance-v1.md). Both arms get the same four job templates, model
settings and tool schemas. The guide arm adds only target discovery, scoped-write, read-back and explicit failure
instructions. A matched-case runner must use a new flag and experiment, a fresh run directory and distinct trial
identities. It must reconcile exposure counts and keep the archived `agent_interface` experiment untouched.

The four-job pack is `kill_switch`, `set_value_in_development`, `segment_override` and `remove_segment_override`.
The known capability-gap jobs stay diagnostic cases instead of being mixed into this fairness comparison. The
manifest's expected cost is a planning estimate, not a result.

## Inspect a plan

```bash
node src/cli.ts plan --experiment mcp-guidance-v1
```

The command prints no lab credentials. CI tests the manifest's template IDs, 50/50 shares, guide digest, budget and
fingerprint format.
