import { Prisma } from '../../../generated/prisma/client.js';
import { constants as httpConstants } from 'node:http2';
import { ZodError } from 'zod';
import { AppError, type ErrorDetail } from './AppError.js';
import { PrismaErrorCode } from './prisma-error-codes.js';

const INVALID_DETAILS_MESSAGE = 'Invalid details supplied';
const RESOURCE_EXISTS_MESSAGE = 'Resource already exists';
const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred';

export interface ErrorRequestContext {
  method: string;
  path: string;
  userId: string | undefined;
}

// The classifier produces both sides of error handling in one immutable value:
// the safe public HTTP response and the structured operational log entry.
interface ErrorResponseBody {
  message: string;
  details?: ErrorDetail[];
}

interface ErrorLog {
  level: 'warn' | 'error';
  message: string;
  context: Record<string, unknown>;
}

export interface ClassifiedError {
  statusCode: number;
  body: ErrorResponseBody;
  log: ErrorLog;
}

// Zod paths are arrays such as ['address', 'postcode']; the API contract
// exposes them as dot-separated field names in its validation details array.
function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    type: issue.code,
  }));
}

function classifyZodError(
  error: ZodError,
  request: ErrorRequestContext,
): ClassifiedError {
  // Invalid client input is expected operationally, so it is logged as a
  // warning and its validation details are safe to return to the caller.
  return {
    statusCode: httpConstants.HTTP_STATUS_BAD_REQUEST,
    body: {
      message: INVALID_DETAILS_MESSAGE,
      details: zodDetails(error),
    },
    log: {
      level: 'warn',
      message: 'Request schema validation failed',
      context: {
        issueCount: error.issues.length,
        method: request.method,
        path: request.path,
      },
    },
  };
}

function classifyAppError(
  error: AppError,
  request: ErrorRequestContext,
): ClassifiedError {
  // AppError represents a deliberate domain or dependency decision. Client
  // failures are warnings; 5xx failures include the error object for diagnosis.
  const serverFailure =
    error.statusCode >= httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
  return {
    statusCode: error.statusCode,
    body:
      error.statusCode === httpConstants.HTTP_STATUS_BAD_REQUEST
        ? { message: error.message, details: error.details ?? [] }
        : { message: error.message },
    log: {
      level: serverFailure ? 'error' : 'warn',
      message: serverFailure
        ? 'Application request failed'
        : 'Application request rejected',
      context: {
        code: error.code,
        ...(serverFailure ? { err: error } : {}),
        method: request.method,
        path: request.path,
        statusCode: error.statusCode,
        userId: request.userId,
      },
    },
  };
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  // Keep Prisma-specific detection at this boundary so transport code and
  // domain services do not need to understand database error internals.
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
  );
}

function classifyUniqueConstraintError(
  error: Prisma.PrismaClientKnownRequestError,
  request: ErrorRequestContext,
): ClassifiedError {
  // A unique constraint collision is a deterministic conflict, not a server
  // failure. Database details are logged but are not exposed in the response.
  return {
    statusCode: httpConstants.HTTP_STATUS_CONFLICT,
    body: { message: RESOURCE_EXISTS_MESSAGE },
    log: {
      level: 'warn',
      message: 'Database uniqueness constraint rejected request',
      context: {
        method: request.method,
        path: request.path,
        prismaCode: error.code,
        userId: request.userId,
      },
    },
  };
}

function classifyUnexpectedError(error: unknown): ClassifiedError {
  // Unknown thrown values may contain credentials, SQL, or infrastructure
  // details. Log the original value and return only the generic contract error.
  return {
    statusCode: httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
    body: { message: UNEXPECTED_ERROR_MESSAGE },
    log: {
      level: 'error',
      message: 'Unhandled request error',
      context: { err: error },
    },
  };
}

export function classifyError(
  error: unknown,
  request: ErrorRequestContext,
): ClassifiedError {
  // Ordering is intentional: known validation and application errors retain
  // their public semantics before database and catch-all handling is applied.
  if (error instanceof ZodError) {
    return classifyZodError(error, request);
  }
  if (error instanceof AppError) {
    return classifyAppError(error, request);
  }
  if (isUniqueConstraintError(error)) {
    return classifyUniqueConstraintError(error, request);
  }
  return classifyUnexpectedError(error);
}
