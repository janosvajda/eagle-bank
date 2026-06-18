import type { LedgerOutboxEvent } from '../../../../generated/prisma/client.js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SQS_MESSAGE_DATA_TYPE_STRING } from '../domain/ledger.constants.js';

// Provider adapter for delivering committed ledger outbox events to SQS.
// Client construction stays in service startup so one SDK client is reused.
export interface LedgerEventSink {
  publish(event: LedgerOutboxEvent): Promise<void>;
}

export class SqsLedgerEventSink implements LedgerEventSink {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(event: LedgerOutboxEvent): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event.payload),
        MessageAttributes: {
          eventType: {
            DataType: SQS_MESSAGE_DATA_TYPE_STRING,
            StringValue: event.eventType,
          },
        },
      }),
    );
  }
}
