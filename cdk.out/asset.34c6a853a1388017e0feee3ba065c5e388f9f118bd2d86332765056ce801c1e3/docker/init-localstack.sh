#!/bin/sh
set -eu

endpoint=http://localstack:4566

attempt=0
until aws sqs list-queues --endpoint-url "$endpoint" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "LocalStack SQS did not become ready" >&2
    exit 1
  fi
  sleep 1
done

aws sqs create-queue --endpoint-url "$endpoint" --queue-name eagle-bank-ledger-events-dlq >/dev/null
events_dlq_arn=$(aws sqs get-queue-attributes --endpoint-url "$endpoint" \
  --queue-url "$endpoint/000000000000/eagle-bank-ledger-events-dlq" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
aws sqs create-queue --endpoint-url "$endpoint" --queue-name eagle-bank-ledger-events \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$events_dlq_arn\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" >/dev/null

aws sqs create-queue --endpoint-url "$endpoint" --queue-name eagle-bank-ledger-command-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true >/dev/null
commands_dlq_arn=$(aws sqs get-queue-attributes --endpoint-url "$endpoint" \
  --queue-url "$endpoint/000000000000/eagle-bank-ledger-command-dlq.fifo" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
aws sqs create-queue --endpoint-url "$endpoint" --queue-name eagle-bank-ledger-commands.fifo \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"true\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$commands_dlq_arn\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" >/dev/null
