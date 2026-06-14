import { Prisma } from '../../generated/prisma/client.js';
import fastify from 'fastify';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from './AppError.js';
import { ErrorCode } from './error-codes.js';
import { registerErrorHandler } from './error-handler.js';
import { PrismaErrorCode } from './prisma-error-codes.js';

async function requestFor(error: Error) {
  const app = fastify({ logger: false });
  registerErrorHandler(app);
  const errorLog = vi.spyOn(app.log, 'error');
  const warnLog = vi.spyOn(app.log, 'warn');
  app.get('/', async () => {
    throw error;
  });
  const response = await app.inject({ method: 'GET', url: '/' });
  await app.close();
  return { errorLog, response, warnLog };
}

describe('registerErrorHandler', () => {
  it('maps Zod issues to the contract validation shape', async () => {
    let validationError: Error;
    try {
      z.object({ email: z.email() }).parse({ email: 'invalid' });
      throw new Error('Expected validation to fail');
    } catch (error) {
      validationError = error as Error;
    }

    const { response, warnLog } = await requestFor(validationError);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: 'Invalid details supplied',
      details: [
        expect.objectContaining({
          field: 'email',
          message: expect.any(String),
          type: 'invalid_format',
        }),
      ],
    });
    expect(warnLog).toHaveBeenCalledWith(
      {
        issueCount: 1,
        method: 'GET',
        path: '/',
      },
      'Request schema validation failed',
    );
  });

  it.each([
    [
      new AppError(400, ErrorCode.BAD_REQUEST, 'Invalid', [
        { field: 'name', message: 'Required', type: 'missing' },
      ]),
      400,
      {
        message: 'Invalid',
        details: [{ field: 'name', message: 'Required', type: 'missing' }],
      },
    ],
    [
      new AppError(400, ErrorCode.BAD_REQUEST, 'Invalid'),
      400,
      { message: 'Invalid', details: [] },
    ],
    [
      new AppError(403, ErrorCode.FORBIDDEN, 'Forbidden'),
      403,
      { message: 'Forbidden' },
    ],
  ])('maps AppError', async (error, status, body) => {
    const { response, warnLog } = await requestFor(error);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual(body);
    expect(warnLog).toHaveBeenCalledWith(
      {
        code: error.code,
        method: 'GET',
        path: '/',
        statusCode: status,
        userId: undefined,
      },
      'Application request rejected',
    );
  });

  it('maps Prisma unique violations to conflict', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: PrismaErrorCode.UNIQUE_CONSTRAINT,
      clientVersion: '6.19.3',
    });
    const { response, warnLog } = await requestFor(error);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: 'Resource already exists' });
    expect(warnLog).toHaveBeenCalledWith(
      {
        method: 'GET',
        path: '/',
        prismaCode: PrismaErrorCode.UNIQUE_CONSTRAINT,
        userId: undefined,
      },
      'Database uniqueness constraint rejected request',
    );
  });

  it('logs server-side application failures as errors', async () => {
    const error = new AppError(
      503,
      ErrorCode.INTERNAL_ERROR,
      'Dependency unavailable',
    );
    const { errorLog, response } = await requestFor(error);

    expect(response.statusCode).toBe(503);
    expect(errorLog).toHaveBeenCalledWith(
      {
        code: ErrorCode.INTERNAL_ERROR,
        err: error,
        method: 'GET',
        path: '/',
        statusCode: 503,
        userId: undefined,
      },
      'Application request failed',
    );
  });

  it('logs and hides unexpected errors', async () => {
    const app = fastify({ logger: false });
    registerErrorHandler(app);
    const log = vi.spyOn(app.log, 'error');
    app.get('/', async () => {
      throw new Error('database credentials');
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      message: 'An unexpected error occurred',
    });
    expect(log).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Unhandled request error',
    );
    await app.close();
  });
});
