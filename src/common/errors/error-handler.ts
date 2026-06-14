import type { FastifyInstance } from 'fastify';
import { classifyError, type ClassifiedError } from './error-response.js';

function writeLog(
  appError: ClassifiedError,
  logger: FastifyInstance['log'],
): void {
  logger[appError.log.level](appError.log.context, appError.log.message);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const classified = classifyError(error, {
      method: request.method,
      path: request.url,
      userId: request.user?.sub,
    });
    writeLog(classified, request.log);
    return reply.status(classified.statusCode).send(classified.body);
  });
}
