import type { z } from 'zod';
import {
  isAwsDeploymentEnvironment,
  type Environment,
} from '../common/config/runtime.constants.js';

// These values are useful for local emulators but unsafe in preprod or prod:
// endpoints could redirect traffic and static credentials bypass task roles.
const LOCAL_AWS_OVERRIDE_FIELDS = [
  'DYNAMODB_ENDPOINT',
  'SQS_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

interface AwsRuntimeConfiguration {
  NODE_ENV: Environment;
  DYNAMODB_ENDPOINT?: string | undefined;
  SQS_ENDPOINT?: string | undefined;
  AWS_ACCESS_KEY_ID?: string | undefined;
  AWS_SECRET_ACCESS_KEY?: string | undefined;
}

interface JwtSecretConfiguration {
  JWT_SECRET: string;
  AUTH_SERVICE_JWT_SECRET: string;
  LEDGER_SERVICE_JWT_SECRET?: string | undefined;
}

export function rejectLocalAwsOverrides(
  configuration: AwsRuntimeConfiguration,
  context: z.RefinementCtx,
): void {
  if (!isAwsDeploymentEnvironment(configuration.NODE_ENV)) {
    return;
  }

  // AWS SDK clients must use regional endpoints and task-role credentials
  // outside the local environment.
  for (const field of LOCAL_AWS_OVERRIDE_FIELDS) {
    if (configuration[field]) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is not allowed in ${configuration.NODE_ENV}`,
      });
    }
  }
}

export function requireDistinctJwtSecrets(
  configuration: JwtSecretConfiguration,
  context: z.RefinementCtx,
): void {
  // Separate secrets prevent a token issued for one trust boundary from being
  // accepted by another service if token claims are ever misconfigured.
  const userSecretMatchesService =
    configuration.JWT_SECRET === configuration.AUTH_SERVICE_JWT_SECRET ||
    configuration.JWT_SECRET === configuration.LEDGER_SERVICE_JWT_SECRET;
  const serviceSecretsMatch =
    configuration.AUTH_SERVICE_JWT_SECRET ===
    configuration.LEDGER_SERVICE_JWT_SECRET;

  if (userSecretMatchesService || serviceSecretsMatch) {
    context.addIssue({
      code: 'custom',
      path: ['AUTH_SERVICE_JWT_SECRET'],
      message: 'User, Auth-service, and Ledger-service JWT secrets must differ',
    });
  }
}
