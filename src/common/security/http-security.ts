import type { FastifyInstance } from 'fastify';
import { isAwsDeploymentEnvironment } from '../config/runtime.constants.js';
import type { Environment } from '../config/runtime.constants.js';

export const HTTP_BODY_LIMIT_BYTES = 65536;
const HSTS_MAX_AGE_SECONDS = 31536000;

export function registerHttpSecurity(
  app: FastifyInstance,
  environment: Environment,
): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header(
      'content-security-policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    reply.header(
      'permissions-policy',
      'camera=(), geolocation=(), microphone=()',
    );
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');

    if (isAwsDeploymentEnvironment(environment)) {
      reply.header(
        'strict-transport-security',
        `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
      );
    }
    return payload;
  });
}
