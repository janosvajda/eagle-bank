import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Document, Operation } from 'openapi-backend';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { PUBLIC_API_PREFIX, PUBLIC_API_VERSION } from '../http/api-version.js';
import {
  OPENAPI_CONTRACT_VERSION,
  OPENAPI_DOCUMENT_PATH,
} from './openapi.constants.js';

type VersionedOpenApiDocument = Document & {
  'x-api-version': string;
};

const OPERATION_METHODS = ['get', 'post', 'patch', 'delete'] as const;
const UNAUTHENTICATED_OPERATIONS = new Set([
  'GET /health',
  'GET /ready',
  `POST ${PUBLIC_API_PREFIX}/auth/login`,
  `POST ${PUBLIC_API_PREFIX}/users`,
]);

async function readContract(): Promise<VersionedOpenApiDocument> {
  const source = await readFile(
    resolve(process.cwd(), OPENAPI_DOCUMENT_PATH),
    'utf8',
  );
  return parse(source) as VersionedOpenApiDocument;
}

describe('versioned OpenAPI contract', () => {
  it('declares matching document and URI versions', async () => {
    const document = await readContract();

    expect(document.info.version).toBe(OPENAPI_CONTRACT_VERSION);
    expect(document['x-api-version']).toBe(PUBLIC_API_VERSION);
  });

  it('versions every public resource endpoint', async () => {
    const document = await readContract();
    const operationalPaths = new Set(['/health', '/ready']);

    for (const path of Object.keys(document.paths ?? {})) {
      expect(
        operationalPaths.has(path) || path.startsWith(`${PUBLIC_API_PREFIX}/`),
      ).toBe(true);
    }
  });

  it('requires bearer authentication on every protected operation', async () => {
    const document = await readContract();

    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      for (const method of OPERATION_METHODS) {
        const operation = pathItem?.[method] as Operation<Document> | undefined;
        if (!operation) {
          continue;
        }

        const operationKey = `${method.toUpperCase()} ${path}`;
        if (UNAUTHENTICATED_OPERATIONS.has(operationKey)) {
          expect(operation.security).toBeUndefined();
        } else {
          expect(operation.security).toContainEqual({ bearerAuth: [] });
        }
      }
    }
  });
});
