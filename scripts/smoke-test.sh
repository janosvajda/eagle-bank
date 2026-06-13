#!/bin/sh
set -euo pipefail

docker compose exec -T api node --input-type=module < scripts/smoke-test.mjs
