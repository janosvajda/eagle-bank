import { SQSClient } from '@aws-sdk/client-sqs';
import type { Environment } from '../config/runtime.constants.js';
import { localAwsEndpointConfig } from './local-aws-config.js';

export interface SqsClientOptions {
  environment: Environment;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export function createSqsClient(options: SqsClientOptions): SQSClient {
  // LocalStack requires an endpoint and placeholder credentials. In ECS they
  // are omitted so the SDK uses the task role and regional SQS endpoint.
  return new SQSClient({
    region: options.region,
    ...localAwsEndpointConfig({ ...options, serviceName: 'SQS' }),
  });
}
