import { z } from 'zod';
import { SECONDS_PER_HOUR } from '../common/constants.js';
import {
  Environment,
  isAwsDeploymentEnvironment,
} from '../common/config/runtime.constants.js';

const DEFAULT_API_PORT = 3000;
const MINIMUM_SECRET_LENGTH = 32;
const DEFAULT_JWT_EXPIRES_IN = '1h';
const DEFAULT_AWS_REGION = 'eu-west-2';

const envSchema = z
  .object({
    NODE_ENV: z.enum(Environment),
    PORT: z.coerce.number().int().positive().default(DEFAULT_API_PORT),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(MINIMUM_SECRET_LENGTH),
    JWT_EXPIRES_IN: z.string().min(1).default(DEFAULT_JWT_EXPIRES_IN),
    AUTH_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(SECONDS_PER_HOUR),
    AWS_REGION: z.string().min(1).default(DEFAULT_AWS_REGION),
    DYNAMODB_ENDPOINT: z.string().url().optional(),
    SQS_ENDPOINT: z.string().url().optional(),
    DYNAMODB_AUTH_SESSIONS_TABLE: z
      .string()
      .min(1)
      .default('eagle-bank-auth-sessions'),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    LEDGER_SERVICE_BASE_URL: z.string().url().optional(),
    AUTH_SERVICE_BASE_URL: z.string().url().optional(),
    INTERNAL_SERVICE_JWT_SECRET: z
      .string()
      .min(MINIMUM_SECRET_LENGTH)
      .optional(),
  })
  .superRefine((configuration, context) => {
    if (!isAwsDeploymentEnvironment(configuration.NODE_ENV)) {
      return;
    }

    // Deployed services must use the AWS SDK's regional endpoints and ECS task
    // role credentials. Local endpoint overrides are valid only for local/test.
    for (const field of ['DYNAMODB_ENDPOINT', 'SQS_ENDPOINT'] as const) {
      if (configuration[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is not allowed in ${configuration.NODE_ENV}`,
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(source);
}
