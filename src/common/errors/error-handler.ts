import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { ZodError } from 'zod';
import { AppError } from './AppError.js';
import { PrismaErrorCode } from './prisma-error-codes.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Validation and expected domain failures are safe to expose in the public
    // contract. Unknown failures are logged and reduced to a generic response.
    if (error instanceof ZodError) {
      request.log.warn(
        {
          issueCount: error.issues.length,
          method: request.method,
          path: request.url,
        },
        'Request schema validation failed',
      );
      return reply.status(httpConstants.HTTP_STATUS_BAD_REQUEST).send({
        message: 'Invalid details supplied',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
          type: issue.code,
        })),
      });
    }

    if (error instanceof AppError) {
      const context = {
        code: error.code,
        method: request.method,
        path: request.url,
        statusCode: error.statusCode,
        userId: request.user?.sub,
      };
      if (error.statusCode >= httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR) {
        request.log.error(
          { ...context, err: error },
          'Application request failed',
        );
      } else {
        request.log.warn(context, 'Application request rejected');
      }
      if (error.statusCode === httpConstants.HTTP_STATUS_BAD_REQUEST) {
        return reply.status(httpConstants.HTTP_STATUS_BAD_REQUEST).send({
          message: error.message,
          details: error.details ?? [],
        });
      }
      return reply.status(error.statusCode).send({ message: error.message });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
    ) {
      request.log.warn(
        {
          method: request.method,
          path: request.url,
          prismaCode: error.code,
          userId: request.user?.sub,
        },
        'Database uniqueness constraint rejected request',
      );
      return reply
        .status(httpConstants.HTTP_STATUS_CONFLICT)
        .send({ message: 'Resource already exists' });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply
      .status(httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR)
      .send({ message: 'An unexpected error occurred' });
  });
}
