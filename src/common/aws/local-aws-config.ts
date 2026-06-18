import {
  type Environment,
  isAwsDeploymentEnvironment,
} from '../config/runtime.constants.js';

const LOCAL_AWS_PLACEHOLDER_CREDENTIAL = 'test';

interface AwsEndpointOptions {
  accessKeyId?: string;
  endpoint?: string;
  environment: Environment;
  secretAccessKey?: string;
  serviceName: string;
}

export function assertLocalAwsEndpointAllowed(
  options: AwsEndpointOptions,
): void {
  if (options.endpoint && isAwsDeploymentEnvironment(options.environment)) {
    throw new Error(
      `${options.serviceName} endpoint overrides are not allowed in AWS environments`,
    );
  }
}

// AWS SDK clients use this only for local development and tests, where
// LocalStack/DynamoDB Local need an explicit endpoint and placeholder
// credentials. In deployed AWS environments the SDK must use real AWS service
// endpoints and its normal credential provider chain, so endpoint overrides are
// rejected above before any client is created.
export function localAwsEndpointConfig(options: AwsEndpointOptions):
  | {
      credentials: {
        accessKeyId: string;
        secretAccessKey: string;
      };
      endpoint: string;
    }
  | Record<string, never> {
  assertLocalAwsEndpointAllowed(options);
  if (!options.endpoint) return {};

  return {
    endpoint: options.endpoint,
    credentials: {
      accessKeyId: options.accessKeyId ?? LOCAL_AWS_PLACEHOLDER_CREDENTIAL,
      secretAccessKey:
        options.secretAccessKey ?? LOCAL_AWS_PLACEHOLDER_CREDENTIAL,
    },
  };
}
