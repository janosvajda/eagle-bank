import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it, vi } from 'vitest';
import { createSqsClient, SqsLedgerEventSink } from './ledger-event-sink.js';

describe('SqsLedgerEventSink', () => {
  it('publishes a typed outbox event to the configured queue', async () => {
    const send = vi.fn().mockResolvedValue({});
    const sink = new SqsLedgerEventSink({ send } as never, 'queue-url');
    await sink.publish({
      eventType: 'TransactionPosted',
      payload: { transactionId: 'tan-1' },
    } as never);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toMatchObject({
      QueueUrl: 'queue-url',
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: 'TransactionPosted',
        },
      },
    });
  });

  it('creates AWS and LocalStack clients with environment safeguards', () => {
    expect(
      createSqsClient({ environment: 'prod', region: 'eu-west-2' }),
    ).toBeDefined();
    expect(
      createSqsClient({
        environment: 'local',
        region: 'eu-west-2',
        endpoint: 'http://localhost:4566',
      }),
    ).toBeDefined();
    expect(() =>
      createSqsClient({
        environment: 'prod',
        region: 'eu-west-2',
        endpoint: 'http://localhost:4566',
      }),
    ).toThrow('not allowed');
  });
});
