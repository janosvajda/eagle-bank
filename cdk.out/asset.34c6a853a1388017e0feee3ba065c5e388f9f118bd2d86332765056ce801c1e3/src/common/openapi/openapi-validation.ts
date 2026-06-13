import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import addFormats from "ajv-formats";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Document,
  type Operation,
  OpenAPIRouter,
  OpenAPIValidator,
} from "openapi-backend";
import { parse } from "yaml";
import { AppError, type ErrorDetail } from "../errors/AppError.js";
import { ErrorCode } from "../errors/error-codes.js";

type ApiOperation = Operation<Document>;

const operations = new WeakMap<FastifyRequest, ApiOperation>();
const responseValidationFailures = new WeakSet<FastifyRequest>();

// Convert AJV JSON-pointer errors into the public assessment error shape.
function requestDetails(errors: unknown[] | null | undefined): ErrorDetail[] {
  return (errors ?? []).map((error) => {
    const issue = error as {
      instancePath?: string;
      keyword?: string;
      message?: string;
      params?: { missingProperty?: string };
    };
    const missingProperty = issue.params?.missingProperty;
    const field =
      missingProperty ??
      issue.instancePath?.replace(/^\//, "").replaceAll("/", ".") ??
      "request";

    return {
      field: field || "request",
      message: issue.message ?? "Invalid value",
      type: issue.keyword ?? "validation",
    };
  });
}

function responseBody(payload: unknown): unknown {
  // Fastify may pass an object, serialized string, Buffer, or an empty body to
  // onSend. Normalize those forms before response-schema validation.
  if (payload === undefined || payload === null || payload === "") {
    return null;
  }
  if (typeof payload !== "string" && !Buffer.isBuffer(payload)) {
    return payload;
  }

  const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface OpenApiValidationOptions {
  definition?: string;
}

export async function registerOpenApiValidation(
  app: FastifyInstance,
  options: OpenApiValidationOptions = {},
): Promise<void> {
  const definition =
    options.definition ?? resolve(process.cwd(), "openapi.yaml");
  const parsed = parse(await readFile(definition, "utf8")) as Document;

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
      (addFormats as unknown as (value: typeof ajv) => void)(ajv);
      ajv.addFormat("double", {
        type: "number",
        validate: Number.isFinite,
      });
      return ajv;
    },
  });

  validator.preCompileRequestValidators();
  validator.preCompileResponseValidators();

  app.addHook("preValidation", async (request) => {
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
        400,
        ErrorCode.BAD_REQUEST,
        "Invalid details supplied",
        requestDetails(result.errors),
      );
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const operation = operations.get(request);
    if (!operation || responseValidationFailures.has(request)) {
      return payload;
    }

    const result = validator.validateResponse(
      responseBody(payload),
      operation,
      reply.statusCode,
    );
    if (!result.valid) {
      // A response mismatch is an implementation defect. Keep detailed schema
      // errors in logs and return a generic 500 instead of leaking internals.
      responseValidationFailures.add(request);
      request.log.error(
        {
          operationId: operation.operationId,
          statusCode: reply.statusCode,
          validationErrors: result.errors,
        },
        "Response does not conform to openapi.yaml",
      );
      throw new AppError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred",
      );
    }

    return payload;
  });
}
