# Evidence index

The archived trial files answer one-trial questions with `show` and one-template questions with `compare`. The
evidence index adds cross-trial recipes without exposing a writable database or accepting arbitrary SQL.

## Build and query

```bash
npm run evidence -- build main
npm run evidence -- matrix main
npm run evidence -- schema-failures main
npm run evidence -- recoveries main
npm run evidence -- explain main-0117 main
```

The build writes `runs/main/evidence.sqlite`, which is ignored because it is reproducible from the tracked records.
The source file path and SHA-256 digest are stored on every trial. Calls carry JSON pointers such as
`/transcript/2/calls/0`. The query connection opens SQLite read-only and enables `PRAGMA query_only`.

The matrix recipe reports this verified result for the 255 main trials.

```text
tool_errors=0 correct=0  7
tool_errors=0 correct=1 197
tool_errors=1 correct=0 19
tool_errors=1 correct=1 32
```

The schema-failure recipe reports 13 `create_metric` calls with a definition input and 13 required-definition
errors across five MCP trials. The recovery recipe reports 32 trials that had a tool error and still passed the
verifier. `explain main-0117 main` traverses the failed split update, the recovery calls, and the verified change.

The index stores redacted inputs, outputs and final text. Secret-shaped fields, authorization headers, Flagsmith
environment keys and local lab values are replaced before insertion. This is a local evidence artifact. The web
export has its own publication guard and does not depend on this database.
