import type { LedgerOutboxEvent } from '@prisma/client';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  LOCAL_AWS_CREDENTIAL,
  type Environment,
  isAwsDeploymentEnvironment,
} from '../../common/config/runtime.constants.js';
import { SqsMessageDataType } from './ledger.constants.js';

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
            DataType: SqsMessageDataType.STRING,
            StringValue: event.eventType,
          },
        },
      }),
    );
  }
}

export function createSqsClient(options: {
  environment: Environment;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): SQSClient {
  if (options.endpoint && isAwsDeploymentEnvironment(options.environment)) {
    throw new Error(
      'SQS endpoint overrides are not allowed in AWS environments',
    );
  }

  // LocalStack requires an endpoint and placeholder credentials. In ECS they
  // are omitted so the SDK uses the task role and regional SQS endpoint.
  return new SQSClient({
    region: options.region,
    ...(options.endpoint
      ? {
          endpoint: options.endpoint,
          credentials: {
            accessKeyId: options.accessKeyId ?? LOCAL_AWS_CREDENTIAL,
            secretAccessKey: options.secretAccessKey ?? LOCAL_AWS_CREDENTIAL,
          },
        }
      : {}),
  });
}
