import { Prisma } from '../../generated/prisma/client.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AppError } from './AppError.js';
import { ErrorCode } from './error-codes.js';
import { classifyError } from './error-response.js';
import { PrismaErrorCode } from './prisma-error-codes.js';

const request = {
  method: 'GET',
  path: '/resource',
  userId: 'usr-1',
};

describe('classifyError', () => {
  it('classifies Zod validation failures', () => {
    const validation = z.object({ email: z.email() }).safeParse({
      email: 'invalid',
    });
    if (validation.success) {
      throw new Error('Expected validation to fail');
    }

    expect(classifyError(validation.error, request)).toMatchObject({
      statusCode: 400,
      body: {
        message: 'Invalid details supplied',
        details: [expect.objectContaining({ field: 'email' })],
      },
      log: {
        level: 'warn',
        message: 'Request schema validation failed',
      },
    });
  });

  it('classifies expected client and server application errors', () => {
    expect(
      classifyError(
        new AppError(400, ErrorCode.BAD_REQUEST, 'Invalid'),
        request,
      ),
    ).toMatchObject({
      body: { message: 'Invalid', details: [] },
      log: { level: 'warn' },
    });

    const serverError = new AppError(
      503,
      ErrorCode.SERVICE_UNAVAILABLE,
      'Unavailable',
    );
    expect(classifyError(serverError, request)).toMatchObject({
      statusCode: 503,
      body: { message: 'Unavailable' },
      log: {
        level: 'error',
        context: { err: serverError },
      },
    });
  });

  it('classifies database uniqueness conflicts', () => {
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: PrismaErrorCode.UNIQUE_CONSTRAINT,
      clientVersion: '6.19.3',
    });

    expect(classifyError(error, request)).toMatchObject({
      statusCode: 409,
      body: { message: 'Resource already exists' },
      log: {
        level: 'warn',
        context: { prismaCode: PrismaErrorCode.UNIQUE_CONSTRAINT },
      },
    });
  });

  it('hides unexpected thrown values', () => {
    expect(classifyError('database credentials', request)).toEqual({
      statusCode: 500,
      body: { message: 'An unexpected error occurred' },
      log: {
        level: 'error',
        message: 'Unhandled request error',
        context: { err: 'database credentials' },
      },
    });
  });
});
