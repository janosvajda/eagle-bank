#!/bin/sh
set -eu

echo 'Applying migrations to the isolated integration-test database...'
npm exec -- prisma migrate deploy

echo 'Running static checks...'
npm run lint
npm run format

echo 'Running unit tests...'
npm run test:unit

echo 'Running integration tests...'
npm run test:integration:run

echo 'Running infrastructure tests...'
npm run infra:test

echo 'Docker test suite passed'
