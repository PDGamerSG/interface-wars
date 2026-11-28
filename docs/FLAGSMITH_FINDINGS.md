# Flagsmith findings

Problems in Flagsmith 2.295.2 and the official Flagsmith MCP server 2.295.2 that Interface Wars ran into. Each one
links to the trials or the harness code that show it. Trial IDs refer to `runs/main/trials/<id>.json`, which holds
per-turn tool calls and the final snapshot diff. The logger kept up to 4,000 characters of each tool result.
The limit was reached by 203 tool results in 155 main trials.

## Upstream status

Seven of the twelve findings are now tracked in Flagsmith/flagsmith. The others are documented here only.

| Finding | Upstream | Opened by |
|---|---|---|
| 1. `create_metric` omits `definition` | [PR #9159](https://github.com/Flagsmith/flagsmith/pull/9159) fixes the OpenAPI schema | Interface Wars |
| 2. No MCP tool starts or completes an experiment | [Issue #9158](https://github.com/Flagsmith/flagsmith/issues/9158) | Interface Wars |
| 3. MCP reads omit multivariate feature-state value IDs | [Issue #9161](https://github.com/Flagsmith/flagsmith/issues/9161) | Interface Wars |
| 4. No MCP tool lists project tags | [PR #9160](https://github.com/Flagsmith/flagsmith/pull/9160) adds the read-only `list_project_tags` tool | Interface Wars |
| 5. All MCP tool schemas are sent on every request | [Issue #9162](https://github.com/Flagsmith/flagsmith/issues/9162) requests tool groups or scopes | Interface Wars |
| 6. `srm_p_value` is null for experiment rollouts | [Issue #9128](https://github.com/Flagsmith/flagsmith/issues/9128) and [PR #8798](https://github.com/Flagsmith/flagsmith/pull/8798) | Other contributors, opened before our report |
| 7. Feature-state PATCH ignores multivariate allocations | [Issue #9157](https://github.com/Flagsmith/flagsmith/issues/9157) | Interface Wars |

The text under each remaining heading is written so it can be pasted into an issue.

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

### 3. MCP reads omit the value IDs needed to change an existing split

Four of five split changes failed. Updates without the existing feature-state value IDs hit the uniqueness check.
The fifth agent submitted an update preserving the current value. Its response exposed value ID 111, which the
agent then used to change the split from 50% to 90%. A read operation returning these IDs would remove the need
for a write to discover them. [Successful trace](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/trials/main-0117.json) · [Failed trace](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/trials/main-0085.json)

### 4. A flag cannot be found by tag name through MCP

- **Effect:** 0 of 4 `archive_stale_flag` trials succeeded on the MCP arm ("archive the flag tagged stale").
- **Cause:** features carry numeric tag IDs only, and no MCP tool lists a project's tags, so the agent cannot map
  `stale` to an ID. All four agents reported failure and left empty final diffs.
- **Evidence:** `main-0110`, `main-0174`, `main-0190`, `main-0254`.
- **Fix:** add a `list_project_tags` tool, or include tag labels in feature results.

### 5. The tool list costs 29,270 input tokens per request

- **Effect:** the MCP arm read 130,914 input tokens per trial on average, against 20,329 for the CLI with the
  skill, although it took fewer turns (4.2 against 5.1). Its mean cost per trial was 4.43 times the skill arm’s cost.
- **Cause:** the server exposes 54 tools with about 67 KB of JSON schema, and every request carries all of them.
- **Fix:** tool groups or scopes that a client can enable, and shorter schemas (many list read-only fields such as
  `created_at` and `uuid` as inputs).

## Flagsmith API and Experimentation

### 6. The sample-ratio test skips the experiment rollout in this configuration

- **Effect:** `srm_p_value` is `null` in the results of the main experiment, with 255 identities.
- **Cause:** `_expected_variant_shares` in `experimentation/services.py` reads the split from the environment
  default feature state. Creating an experiment zeroes that split and moves it to the hidden
  `experiment-<id>-rollout` segment override, so the shares come back empty and the check is skipped. The code
  documents this in a TODO. [Share calculation](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/experimentation/services.py#L421-L443) · [Nonpositive-share check](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/experimentation/stats.py#L88-L100)
- **Workaround in this repo:** the readout runs its own chi-square test against the configured split
  (`sampleRatioCheck` in `src/experiment/readout.ts`).
- **Fix:** read the split from the rollout segment override.

### 7. Environment feature-state PATCH ignores multivariate allocations

On the environment feature-state endpoint, a PATCH carrying `multivariate_feature_state_values` returned success
while the split stayed at its prior values. A PUT of the full state applied the requested split. The view selects
different serializers for full and partial update. [Versioned view](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/features/views.py#L712-L725) · [Reference update](https://github.com/PDGamerSG/interface-wars/blob/main/src/jobs/reference.ts)

### 8. Nested multivariate option creation treats the option key as read-only

When the harness created a feature with nested options, the experiment results used an empty variant label until
the harness set the option key through the dedicated `mv-options` endpoint. The nested serializer declares the
field read-only and points to the dedicated endpoint for uniqueness validation. Documenting that second step in the
experiment setup example would help clients produce named variants. [Serializer](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/features/multivariate/serializers.py#L20-L33) · [Harness setup](https://github.com/PDGamerSG/interface-wars/blob/main/src/experiment/control.ts)

### 9. The flagsmith warehouse driver needs ClickHouse

Our lab runs Flagsmith and Postgres. Choosing `warehouse_type: "flagsmith"` led the results job to look for a
ClickHouse connection. Choosing `{"warehouse_type":"postgres","config":{"source":"flagsmith_database"}}`
let it compute results from the local event store. The driver reads `EXPERIMENTATION_CLICKHOUSE_URL`. [Driver](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/experimentation/warehouses/flagsmith.py#L53-L66)

### 10. Warehouse-connection writes are throttled at 10 per minute

- **Effect:** creating a sandbox organisation per trial with its own warehouse hits the throttle at concurrency 6.
- The versioned rate is 10 writes per minute. [Throttle configuration](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/app/settings/common.py#L394)
- **Workaround in this repo:** sandboxes skip the warehouse (`IW_SANDBOX_WAREHOUSE=1` turns it back on).
- **Fix:** make the rate configurable for self-hosted instances.

## Audit log

These two came from the write audit added after the main run (`src/lab/audit.ts`). They affect any client that
uses the audit log to check what an agent changed.

### 11. The audit log API returns an empty list on an unlicensed self-hosted install

- **Effect:** with a valid admin token, `GET /api/v1/projects/<id>/audit/`, `/api/v1/organisations/<id>/audit/` and
  `/api/v1/audit/?project=<id>` each returned `count: 0` while the database held the project's audit rows.
- **Cause:** self-hosted organisations without a licence get the free-plan metadata, whose
  `audit_log_visibility_days` defaults to 0. The view then keeps only rows created after the current time.
  [Visibility filter](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/audit/views.py#L77-L93) · [Self-hosted metadata](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/organisations/models.py#L474-L495)
- **Why it matters:** an empty list looks the same as "no writes". A plan error would tell an operator or an
  agent that the audit trail exists but is not visible.
- **Workaround in this repo:** the harness reads the sandbox's rows from the lab database in a read-only transaction.

### 12. An audit row is lost when its object is gone before the task processor runs

- **Effect:** in our lab, 6 audit tasks for segment-override feature states raised `FeatureSegment.DoesNotExist`.
  After three attempts, Flagsmith gave up and wrote no audit row for those writes. Other audit tasks failed with
  database connection errors when Postgres reached its default limit of 100 connections. At that point the task
  processor held 73 idle connections.
- **Cause:** the audit row is built later from the historical record. The task resolves the live object's
  environment and project, which fails after the segment override has been deleted. [Audit task](https://github.com/Flagsmith/flagsmith/blob/5369ece3ff3aefbd021d2496f82a7ce0e9cd04d6/api/audit/tasks.py#L81-L137)
- **Why it matters:** an agent that creates or changes a segment override and deletes it soon after can leave
  no audit row for that write.
- **Workaround in this repo:** the harness counts failed audit tasks whose historical record belongs to the sandbox
  and reports them as `lostRows`. The lab raises `max_connections` to 500.

## Agent behaviour worth knowing

- All 19 failed MCP trials reported `FAILED` and had an empty final snapshot diff.
- Four of seven failed CLI trials opened their final response with `DONE:`. One said the experiment was already
  live when its status was still `created`. The other three acknowledged incomplete work. A fifth machine outcome
  was classified as `done` for a response beginning “DONE? No.” [Claimed live](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/trials/main-0074.json) · [Partial rollout](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/trials/main-0075.json) · [“DONE? No”](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/trials/main-0202.json)
- The verifier detected zero out-of-scope final changes in 255 trials. It misses temporary writes and fields
  outside its snapshot, including identity overrides. One CLI agent changed a Production weight and restored it.
  New runs add an audit-log check for writes outside the job, including reverted ones (findings 11 and 12 list its gaps).
  [Recorded calls](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/trials/main-0139.json) · [Snapshot fields](https://github.com/PDGamerSG/interface-wars/blob/main/src/lab/sandbox.ts)
- Ten registered passes on setup-only tasks had enrollment enabled at the end. All six skill trials on that
  template were affected. [Sensitivity analysis](https://github.com/PDGamerSG/interface-wars/blob/main/runs/main/sensitivity.md)
