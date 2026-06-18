import type { FastifyInstance } from 'fastify';
import { isAwsDeploymentEnvironment } from '../config/runtime.constants.js';
import type { Environment } from '../config/runtime.constants.js';

// Shared request body cap for all Fastify services. It limits accidental or
// malicious oversized JSON payloads before they reach route handlers.
export const HTTP_BODY_LIMIT_BYTES = 65536;
const HSTS_MAX_AGE_SECONDS = 31536000;

export function registerHttpSecurity(
  app: FastifyInstance,
  environment: Environment,
): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    // These APIs return JSON only. The headers disable response caching and
    // browser features that are unnecessary for an API surface.
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
      // HSTS is only advertised behind real HTTPS infrastructure. Local
      // development intentionally runs over plain HTTP.
      reply.header(
        'strict-transport-security',
        `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
      );
    }
    return payload;
  });
}
