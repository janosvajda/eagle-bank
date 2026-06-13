import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import addFormats from 'ajv-formats';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import {
  type Document,
  type Operation,
  OpenAPIRouter,
  OpenAPIValidator,
  type ValidationResult,
} from 'openapi-backend';
import { parse } from 'yaml';
import { AppError, type ErrorDetail } from '../errors/AppError.js';
import { ErrorCode } from '../errors/error-codes.js';

type ApiOperation = Operation<Document>;
type OpenApiValidationError = NonNullable<ValidationResult['errors']>[number];

const AJV_NUMBER_FORMAT_TYPE = 'number';
const operations = new WeakMap<FastifyRequest, ApiOperation>();
const responseValidationFailures = new WeakSet<FastifyRequest>();
const validatedResponses = new WeakSet<FastifyRequest>();

// Convert AJV JSON-pointer errors into the public assessment error shape.
function requestDetails(
  errors: OpenApiValidationError[] | null | undefined,
): ErrorDetail[] {
  return (errors ?? []).map((error) => {
    const missingProperty =
      'missingProperty' in error.params &&
      typeof error.params.missingProperty === 'string'
        ? error.params.missingProperty
        : undefined;
    const field =
      missingProperty ??
      error.instancePath.replace(/^\//, '').replaceAll('/', '.') ??
      'request';

    return {
      field: field || 'request',
      message: error.message ?? 'Invalid value',
      type: error.keyword,
    };
  });
}

function validateResponse(
  request: FastifyRequest,
  statusCode: number,
  payload: unknown,
  validator: OpenAPIValidator,
): void {
  const operation = operations.get(request);
  if (!operation || responseValidationFailures.has(request)) {
    return;
  }

  const result = validator.validateResponse(payload, operation, statusCode);
  if (result.valid) {
    validatedResponses.add(request);
    return;
  }

  // A response mismatch is an implementation defect. Keep detailed schema
  // errors in logs and return a generic 500 instead of leaking internals.
  responseValidationFailures.add(request);
  request.log.error(
    {
      operationId: operation.operationId,
      statusCode,
      validationErrors: result.errors,
    },
    'Response does not conform to openapi.yaml',
  );
  throw new AppError(
    httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
    ErrorCode.INTERNAL_ERROR,
    'An unexpected error occurred',
  );
}

export interface OpenApiValidationOptions {
  definition?: string;
}

export async function registerOpenApiValidation(
  app: FastifyInstance,
  options: OpenApiValidationOptions = {},
): Promise<void> {
  const definition =
    options.definition ?? resolve(process.cwd(), 'openapi.yaml');
  const parsed = parse(await readFile(definition, 'utf8')) as Document;

  // Resolve shared component references once during startup so runtime
  // validation uses the complete contract rather than partial YAML fragments.
  const document = (await $RefParser.dereference(parsed)) as Document;
  const router = new OpenAPIRouter({ definition: document });
  const validator = new OpenAPIValidator({
    definition: document,
    router,
    coerceTypes: false,
    lazyCompileValidators: false,
    ajvOpts: {
      allErrors: true,
      strict: false,
    },
    customizeAjv: (ajv) => {
      addFormats.default(ajv);
      ajv.addFormat('double', {
        type: AJV_NUMBER_FORMAT_TYPE,
        validate: Number.isFinite,
      });
      return ajv;
    },
  });

  validator.preCompileRequestValidators();
  validator.preCompileResponseValidators();

  app.addHook('preValidation', async (request) => {
    const openApiRequest = {
      method: request.method,
      path: request.url,
      headers: request.headers as Record<string, string | string[]>,
      query: request.query as Record<string, string | string[]>,
      body: request.body,
    };
    const operation = router.matchOperation(openApiRequest);

    if (!operation) {
      // Internal and operational endpoints outside the public OpenAPI contract
      // keep their route-specific validation.
      return;
    }

    operations.set(request, operation);
    const result = validator.validateRequest(openApiRequest, operation);
    if (!result.valid) {
      throw new AppError(
        httpConstants.HTTP_STATUS_BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Invalid details supplied',
        requestDetails(result.errors),
      );
    }
  });

  app.addHook('preSerialization', async (request, reply, payload) => {
    validateResponse(request, reply.statusCode, payload, validator);
    return payload;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    // Fastify skips preSerialization for strings, Buffers, streams, null, and
    // empty responses. Validate those payloads directly without parsing them.
    if (!validatedResponses.has(request)) {
      const validationPayload =
        reply.statusCode === httpConstants.HTTP_STATUS_NO_CONTENT
          ? null
          : payload;
      validateResponse(request, reply.statusCode, validationPayload, validator);
    }
    return payload;
  });
}
