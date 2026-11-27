# Flagsmith findings

Problems in Flagsmith 2.295.2 and the official Flagsmith MCP server 2.295.2 that Interface Wars ran into. Each one
links to the trials or the harness code that show it. Trial IDs refer to `runs/main/trials/<id>.json`, which holds
the full transcript, the tool calls and the state diff.

None of these has been filed upstream yet. The text under each heading is written so it can be pasted into an issue.

## MCP server

### 1. `create_metric` cannot create a metric: `definition` is required but not in the schema

- **Effect:** every metric creation through MCP fails. 0 of 5 `create_metric` trials succeeded on the MCP arm;
  11 of 11 succeeded on the CLI arms.
- **Cause:** the tool's `inputSchema` lists `definition` in `required` but not in `properties`
  (`environment_api_key, id, name, description, aggregation, direction, experiments, created_at, updated_at`).
  The server drops the undeclared field, so the API answers `{'definition': ['This field is required.']}` even
  when the agent sends it.
- **Evidence:** `main-0024`, `main-0040`, `main-0168`, `main-0184`, `main-0200`.
- **Fix:** add `definition` (an object with `version` and `event`) to the tool's `properties`.

### 2. Experiments cannot be started or completed through MCP

- **Effect:** 0 of 3 `start_experiment` and 0 of 3 `ship_winner` trials succeeded on the MCP arm.
- **Cause:** no MCP tool calls the experiment `start` or `complete` endpoints. The only candidate,
  `update_experiment`, is described as "Updates an experiment's name or its hypothesis", lists `feature` as
  required, and the API rejects any update that includes `feature`, even unchanged:
  `{'feature': ['Cannot change the feature of an existing experiment.']}`.
- **Evidence:** start: `main-0106`, `main-0138`, `main-0234`. Complete: `main-0155`, `main-0171`, `main-0219`.
- **Fix:** expose `start_experiment` and `complete_experiment` tools (`rollout_decision`, `rollout_variant`), and
  drop `feature` from the `update_experiment` required list.

### 3. An existing multivariate split cannot be changed through MCP

- **Effect:** 1 of 5 `change_split_in_production` trials succeeded on the MCP arm.
- **Cause:** updating a split needs the IDs of the existing multivariate feature-state values, and no MCP tool
  returns them. Without the IDs the API answers `Multivariate feature state value with this Feature state and
  Multivariate feature option already exists.`
- **Evidence:** `main-0085`, `main-0101`, `main-0165`, `main-0181`.
- **Fix:** return `multivariate_feature_state_values` (with IDs) from a feature-state read tool, or accept updates
  keyed by `multivariate_feature_option`.

### 4. A flag cannot be found by tag name through MCP

- **Effect:** 0 of 4 `archive_stale_flag` trials succeeded on the MCP arm ("archive the flag tagged stale").
- **Cause:** features carry numeric tag IDs only, and no MCP tool lists a project's tags, so the agent cannot map
  `stale` to an ID. The agents reported this and changed nothing.
- **Evidence:** `main-0110`, `main-0174`, `main-0190`, `main-0254`.
- **Fix:** add a `list_project_tags` tool, or include tag labels in feature results.

### 5. The tool list costs about 29,500 input tokens per request

- **Effect:** the MCP arm read 130,914 input tokens per trial on average, against 20,329 for the CLI with the
  skill, although it took fewer turns (4.2 against 5.1). Its mean cost per trial was 4.3 times higher.
- **Cause:** the server exposes 54 tools with about 67 KB of JSON schema, and every request carries all of them.
- **Fix:** tool groups or scopes that a client can enable, and shorter schemas (many list read-only fields such as
  `created_at` and `uuid` as inputs).

## Flagsmith API and Experimentation

### 6. The sample-ratio check never runs for experiments

- **Effect:** `srm_p_value` is `null` in the results of the main experiment, with 255 identities.
- **Cause:** `_expected_variant_shares` in `experimentation/services.py` reads the split from the environment
  default feature state. Creating an experiment zeroes that split and moves it to the hidden
  `experiment-<id>-rollout` segment override, so the shares come back empty and the check is skipped. The code
  carries a TODO saying exactly this.
- **Workaround in this repo:** the readout runs its own chi-square test against the configured split
  (`sampleRatioCheck` in `src/experiment/readout.ts`).
- **Fix:** read the split from the rollout segment override.

### 7. `PATCH` on a feature state ignores `multivariate_feature_state_values`

- **Effect:** a split change sent with `PATCH` returns success and changes nothing.
- **Cause:** the field is silently ignored on partial update. `PUT` with the full state applies it.
- **Evidence:** harness code `src/jobs/reference.ts` (`putState`) uses `PUT` for this reason.
- **Fix:** apply the field on `PATCH`, or reject it with a 400.

### 8. A multivariate option's `key` is ignored on create

- **Effect:** experiment results label the variant `""` unless the key is set afterwards.
- **Cause:** `key` is dropped on `POST`; a later `PUT .../mv-options/<id>/` sets it.
- **Evidence:** `setupExperiment` in `src/experiment/control.ts`.
- **Fix:** accept `key` on create.

### 9. `warehouse_type: "flagsmith"` breaks results on self-hosted

- **Effect:** results computation crashes on a self-hosted instance.
- **Cause:** that type is the Cloud-only ClickHouse warehouse. Self-hosted needs
  `{"warehouse_type": "postgres", "config": {"source": "flagsmith_database"}}`.
- **Fix:** reject the Cloud-only type on self-hosted with a clear error, and document the Postgres option.

### 10. Warehouse-connection writes are throttled at 10 per minute

- **Effect:** creating a sandbox organisation per trial with its own warehouse hits the throttle at concurrency 6.
- **Cause:** a hard-coded throttle on warehouse-connection writes.
- **Workaround in this repo:** sandboxes skip the warehouse (`IW_SANDBOX_WAREHOUSE=1` turns it back on).
- **Fix:** make the rate configurable for self-hosted instances.

## Agent behaviour worth knowing

- On the MCP arm, all 19 failures ended with an explicit `FAILED` line and no change. No MCP agent claimed success
  falsely.
- On the CLI arm without the skill, 5 of 7 failures ended with `DONE` although the job was not done (for example
  `main-0075`: it set the winning variant to 100% but never completed the experiment). The skill's read-back rule
  is the main difference: the CLI arm with the skill had no failures.
- No trial in any arm changed anything outside the job's scope (0 collateral changes in 255 trials).
