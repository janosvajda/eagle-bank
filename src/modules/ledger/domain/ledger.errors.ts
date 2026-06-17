import { constants as httpConstants } from 'node:http2';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../../common/errors/AppError.js';
import type { ErrorCode } from '../../../common/errors/error-codes.js';

export class LedgerConcurrencyError extends Error {
  constructor() {
    super('Ledger account changed during transaction processing');
    this.name = 'LedgerConcurrencyError';
  }
}

export function rejectLedgerOperation(
  logger: FastifyBaseLogger,
  statusCode: number,
  code: ErrorCode,
  message: string,
  context: Record<string, unknown>,
  logMessage = message,
): never {
  const logContext = { ...context, code, statusCode };
  if (statusCode >= httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR) {
    logger.error(logContext, logMessage);
  } else {
    logger.warn(logContext, logMessage);
  }
  throw new AppError(statusCode, code, message);
}
