import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["prod", "preprod", "test"]),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default("1h"),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AWS_REGION: z.string().min(1).default("eu-west-2"),
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  DYNAMODB_AUTH_SESSIONS_TABLE: z
    .string()
    .min(1)
    .default("eagle-bank-auth-sessions"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  LEDGER_SERVICE_BASE_URL: z.string().url().optional(),
  AUTH_SERVICE_BASE_URL: z.string().url().optional(),
  INTERNAL_SERVICE_JWT_SECRET: z.string().min(32).optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(source);
}
