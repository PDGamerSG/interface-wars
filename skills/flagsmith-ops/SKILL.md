---
name: flagsmith-ops
description: Operate Flagsmith end to end with the Flagsmith CLI v2 - flags, values, multivariate splits, segments and overrides, experiments and metrics (via `flagsmith api`) - with scoped changes and read-back verification. Use for any Flagsmith task.
---

# Flagsmith operations with the CLI

The CLI is already authenticated and has the organisation and project preselected. Pick the environment with
`-e <environment key>` on every flag command. Keep output small: add `--json --jq '<filter>'` when you only need a field.

## Rules

1. Change only what the task names: one flag, one environment, one segment. Never loop over flags or environments.
2. Read the target before and after the change (`flagsmith flag get <flag> -e <key> --json`). Report DONE only after the read-back matches.
3. Writes run without a terminal: add `--yes` to every command that changes something, or it stops at a confirmation prompt.
4. If a step fails, read the error, fix the one command, and retry. Do not try alternative bulk approaches.

## Recipes

| Job | Command |
|---|---|
| Create a flag, off everywhere | `flagsmith feature create <name> --description "<text>" --yes` |
| Turn on/off in one environment | `flagsmith flag update <flag> -e <key> --enable --yes` (or `--disable`) |
| Set a value | `flagsmith flag update <flag> -e <key> --value "<v>" --yes` |
| Create a multivariate flag | `flagsmith feature create <name> --value "<control>" --enabled --variants '[{"value":"A","weight":50},{"value":"B","weight":50}]' --yes` |
| Re-weight variants in one environment | `flagsmith flag update <flag> -e <key> --weight <variant key or id>=<pct> --yes` (find ids with `flagsmith feature variant list <flag>`; the control gets the remainder) |
| Create a segment (trait equals value) | `flagsmith segment create <name> --rules '{"type":"ALL","rules":[{"type":"ANY","conditions":[{"operator":"EQUAL","property":"<trait>","value":"<value>"}]}]}' --yes` |
| Segment override in one environment | `flagsmith flag update <flag> -e <key> --segment <segment name> --enable --value "<v>" --yes` (the environment default is untouched) |
| Remove a segment override | `flagsmith flag delete <flag> -e <key> --segment <segment name> --yes` |
| Archive a flag | `flagsmith feature update <flag> --archive --yes` |
| Find flags by state | `flagsmith flag list -e <key> --json --jq '.[] | select(.value=="<v>")'` |
| Find flags by tag | `flagsmith api "api/v1/projects/<project id>/tags/"` then `flagsmith feature list --json` and match tag ids |

## Experiments (no dedicated commands: use `flagsmith api`)

Experiments and metrics live under the environment key. Send JSON bodies with `--input -` and a heredoc.

```bash
# Metric. aggregation: occurrence | count | sum | mean; direction: up | down | informational
flagsmith api api/v1/environments/<env key>/experiment-metrics/ -X POST --input - <<'JSON'
{"name":"<metric>","description":"","aggregation":"occurrence","direction":"up","definition":{"version":1,"event":"<event>"}}
JSON

# Experiment (created, not started). Needs the feature id, metric ids and multivariate option ids.
flagsmith api api/v1/environments/<env key>/experiment-metrics/ --jq '.results[] | {id,name}'
flagsmith feature variant list <flag> --json
flagsmith api api/v1/environments/<env key>/experiments/ -X POST --input - <<'JSON'
{"feature":<feature id>,"name":"<name>","hypothesis":"<text>",
 "metrics":[{"metric":<primary id>,"expected_direction":"increase"},{"metric":<guardrail id>,"expected_direction":"not_increase"}],
 "experiment_rollout":{"enabled":true,"rollout_percentage":100,
   "feature_state_value":{"type":"string","value":"<control value>"},
   "multivariate_feature_state_values":[{"multivariate_feature_option":<option id>,"percentage_allocation":50}]}}
JSON
```

- expected_direction: `increase`, `decrease`, `not_increase` (guardrail that must not go up), `not_decrease`.
- Start: `flagsmith api api/v1/environments/<env key>/experiments/<id>/start/ -X POST`
- Complete and ship a variation: `... /experiments/<id>/complete/ -X POST --input -` with `{"rollout_decision":"variant","rollout_variant":<option id>}` (`"control"` keeps the control; `"disable"` turns the flag off).
- Find an experiment id: `flagsmith api api/v1/environments/<env key>/experiments/ --jq '.results[] | {id,name,status}'`
- A flag in a running experiment is locked; change it through the experiment endpoints only.

## Verify

- Flag: `flagsmith flag get <flag> -e <key> --json --jq '{enabled,value,variants}'`
- Overrides: `flagsmith flag get <flag> -e <key> --json --jq '.segment_overrides'`, details via `flagsmith api "api/v1/environments/<env key>/featurestates/?feature=<feature id>"`
- Experiment: `flagsmith api api/v1/environments/<env key>/experiments/<id>/ --jq '{status,rollout_decision}'`
