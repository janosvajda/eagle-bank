import { z } from 'zod';
import {
  apiConfigSchema,
  authServiceConfigSchema,
  ledgerEventPublisherConfigSchema,
  ledgerServiceConfigSchema,
} from './env.schemas.js';

// This file is the public configuration API. Services import their typed
// loader from here without depending on the underlying Zod schema structure.
export type AppConfig = z.infer<typeof apiConfigSchema>;
export type AuthServiceConfig = z.infer<typeof authServiceConfigSchema>;
export type LedgerServiceConfig = z.infer<typeof ledgerServiceConfigSchema>;
export type LedgerEventPublisherConfig = z.infer<
  typeof ledgerEventPublisherConfigSchema
>;

function parseConfig<Schema extends z.ZodType>(
  schema: Schema,
  source: NodeJS.ProcessEnv | undefined,
): z.infer<Schema> {
  // Passing a source keeps tests deterministic. Production entry points omit
  // it and validate the real process environment during startup.
  return schema.parse(source ?? process.env);
}

export function loadApiConfig(source?: NodeJS.ProcessEnv): AppConfig {
  return parseConfig(apiConfigSchema, source);
}

export function loadAuthServiceConfig(
  source?: NodeJS.ProcessEnv,
): AuthServiceConfig {
  return parseConfig(authServiceConfigSchema, source);
}

export function loadLedgerServiceConfig(
  source?: NodeJS.ProcessEnv,
): LedgerServiceConfig {
  return parseConfig(ledgerServiceConfigSchema, source);
}

export function loadLedgerEventPublisherConfig(
  source?: NodeJS.ProcessEnv,
): LedgerEventPublisherConfig {
  return parseConfig(ledgerEventPublisherConfigSchema, source);
}
