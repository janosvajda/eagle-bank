import { SQSClient } from '@aws-sdk/client-sqs';
import {
  LOCAL_AWS_CREDENTIAL,
  type Environment,
  isAwsDeploymentEnvironment,
} from '../config/runtime.constants.js';

export interface SqsClientOptions {
  environment: Environment;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export function createSqsClient(options: SqsClientOptions): SQSClient {
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
