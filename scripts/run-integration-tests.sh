#!/bin/sh
set -eu

INTEGRATION_DATABASE_URL='postgresql://eagle:eagle@localhost:5433/eagle_bank_test?schema=public'

echo 'Starting the isolated integration-test database...'
docker compose up -d --wait integration-test-db

echo 'Applying database migrations...'
DATABASE_URL="$INTEGRATION_DATABASE_URL" npm exec -- prisma migrate deploy

echo 'Running integration tests...'
DATABASE_URL="$INTEGRATION_DATABASE_URL" npm run test:integration:run
