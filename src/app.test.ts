import { PrismaClient } from '../generated/prisma/client.js';
import type { HTTPMethods } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Document } from 'openapi-backend';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { OPENAPI_DOCUMENT_PATH } from './common/openapi/openapi.constants.js';

const config = {
  NODE_ENV: 'test' as const,
  PORT: 3000,
  DATABASE_URL: 'postgresql://localhost/test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
  AUTH_SERVICE_JWT_SECRET:
    'test-auth-service-secret-that-is-at-least-32-characters',
  LEDGER_SERVICE_JWT_SECRET:
    'test-ledger-service-secret-that-is-at-least-32-characters',
  JWT_EXPIRES_IN: '1h',
  AUTH_SESSION_TTL_SECONDS: 3600,
  AWS_REGION: 'eu-west-2',
  DYNAMODB_AUTH_SESSIONS_TABLE: 'eagle-bank-auth-sessions',
};

describe('buildApp', () => {
  it.each([undefined, true])(
    'assembles every API route with logger=%s',
    async (logger) => {
      const app = await buildApp({
        prisma: {} as PrismaClient,
        config,
        ...(logger === undefined ? {} : { logger }),
      });

      const contract = parse(
        await readFile(resolve(process.cwd(), OPENAPI_DOCUMENT_PATH), 'utf8'),
      ) as Document;
      const operationMethods = ['get', 'post', 'patch', 'delete'] as const;

      for (const [contractPath, pathItem] of Object.entries(
        contract.paths ?? {},
      )) {
        for (const method of operationMethods) {
          if (!pathItem?.[method]) {
            continue;
          }

          const fastifyPath = contractPath.replaceAll(/\{([^}]+)\}/g, ':$1');
          expect(
            app.hasRoute({
              method: method.toUpperCase() as HTTPMethods,
              url: fastifyPath,
            }),
            `${method.toUpperCase()} ${contractPath} is not registered`,
          ).toBe(true);
        }
      }
      await app.close();
    },
  );
});
