#!/usr/bin/env bash
# Wipe the lab (Flagsmith database included) and recreate it with a fresh, not-yet-started experiment.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -p interface-wars -f infra/compose.yml down -v
rm -f runs/lab.local.json
docker compose -p interface-wars -f infra/compose.yml up -d
node src/lab/bootstrap.ts
node src/cli.ts experiment:setup
