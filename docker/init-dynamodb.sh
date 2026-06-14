#!/bin/sh
set -eu

endpoint=http://auth-session-db:8000
table=eagle-bank-auth-sessions

attempt=0
until aws dynamodb list-tables --endpoint-url "$endpoint" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "DynamoDB Local did not become ready" >&2
    exit 1
  fi
  sleep 1
done

if ! aws dynamodb describe-table --endpoint-url "$endpoint" --table-name "$table" >/dev/null 2>&1; then
  aws dynamodb create-table \
    --endpoint-url "$endpoint" \
    --table-name "$table" \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
fi

aws dynamodb update-time-to-live \
  --endpoint-url "$endpoint" \
  --table-name "$table" \
  --time-to-live-specification Enabled=true,AttributeName=expiresAtEpoch >/dev/null 2>&1 || true
