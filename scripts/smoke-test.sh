#!/bin/sh
set -eu

docker compose exec -T api node --input-type=module < scripts/smoke-test.mjs
