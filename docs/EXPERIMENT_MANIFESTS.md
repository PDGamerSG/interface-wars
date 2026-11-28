# Experiment manifests

A manifest records a Flagsmith study design before it runs. It is data, separate from the archived `main`
run. `src/experiment/manifest.ts` validates it without reading `runs/lab.local.json`, calling Flagsmith or calling
the model.

## Fields

- `id`, `schemaVersion`, `title` and `question` identify the study.
- `flag` and `arms` specify the assignment surface and expected shares.
- `model` fixes the model, effort and turn limit.
- `jobPack` names existing catalog templates. The matched runner renders each case seed for both arms.
- `metrics` names the primary and guardrail events sent to Flagsmith.
- `budget` is a machine-side USD ceiling and an expected spend estimate.
- An arm may name a checked-in guide. The plan prints its SHA-256 digest.

## Matched MCP study

The MCP baseline and guided arm receive the same official 54-tool schemas from Flagsmith 2.295.2. The guided arm appends the frozen guide to the shared system prompt. Mean USD per job is primary. The paired guardrails use a five-percentage-point noninferiority margin for correctness and detected change scope. The registered protocol defines the fixed population, estimands, confidence bounds and decision floors. [Preregistration](../prereg/MCP_GUIDANCE_V1.md) · [Guide](../guides/mcp-guidance-v1.md)

Use Node 26 in the primary checkout with the existing local lab, Docker Compose stack, project spend ledger and model credentials. Linked worktrees resolve the same paid ledger and lock. The setup command provisions the study's own organisation, project, environment, feature, metrics, variant and experiment. It prints numerical IDs. Run these commands in order after the preregistration is merged.

```bash
npm ci
npm run plan -- --experiment mcp-guidance-v1
npm run matched -- setup
npm run matched -- pilot
npm run matched -- start
npm run matched -- registered
npm run matched -- reconcile
npm run matched -- readout
npm run matched -- compare --phase registered --case 3
```

The pilot runs 12 forced pairs and sends zero events. Starting registration verifies the empty study warehouse and writes that audit to disk. Registration enrolls 128 identities in index order with the actual 50/50 flag allocation. Reconciliation checks raw, per-identity warehouse events, Flagsmith's aggregate counts and metric sums, and confirmed model spend. If native refresh is throttled or stale, repeat `reconcile` after it refreshes. Offline `readout` and `compare` read local files and require no lab credentials. The readout uses the native check only when it matches the exact saved journal.

The run directory is `runs/mcp-guidance-v1/{pilot,registered}/`. Each phase keeps its assignment journal, per-trial evidence and readout. `experiment.json` lists public IDs. `control.local.json` contains credentials and is ignored by Git. Keep raw model credentials and the shared spend ledger local.

Repeat the same phase command to resume interrupted identities. Uncertain event deliveries first check stored events in the study warehouse. A model request reserves $0.69536 against both the $2 study cap and $15 project cap, or any tighter machine or operational cap. This covers 1,048,576 input tokens at the highest cache-write rate and all 16,000 output tokens. Settlement charges actual usage. A definitive client rejection releases the reservation. After an ambiguous response, check provider billing for the pending identity and request before running `npm run matched -- settle --nonce <pending-nonce> --usd <verified-amount>`. An unresolved bill or insufficient headroom stops further paid requests. A partial study stays inconclusive.

For a disposable synthetic check, append `--dry-run` to every matched command. The reference solver uses a distinct project, namespace and output directory. A short registered smoke test can use `registered --dry-run --limit 8`. The `IW_FLAGSMITH_URL`, `IW_MCP_URL` and `IW_COMPOSE_PROJECT` settings must point to the same stack. The Docker warehouse check uses read-only SQL scoped to that environment.
