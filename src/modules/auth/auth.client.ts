import { constants as httpConstants } from 'node:http2';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { createInternalServiceToken } from '../../common/auth/internal-service-jwt.js';
import {
  AUTHORIZATION_BEARER_PREFIX,
  ServiceIdentity,
} from '../../common/auth/auth.constants.js';
import type { PasswordHasher } from '../users/users.ports.js';
import type {
  AuthSession,
  AuthSessionStore,
} from './auth-session.contracts.js';
import {
  loginResultSchema,
  passwordHashResponseSchema,
  sessionIntrospectionResponseSchema,
  type LoginResult,
} from './auth.contracts.js';
import type { LoginInput } from './auth.schemas.js';
import {
  HttpHeader,
  HttpMethod,
  MediaType,
} from '../../common/http/http.constants.js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import type { JsonValue } from '../../common/http/json.types.js';

const AUTH_INTROSPECTION_TIMEOUT_MS = 300;
const AUTH_REQUEST_TIMEOUT_MS = 1000;

function responseMessage(payload: JsonValue, fallback: string): string {
  return typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
    ? payload.message
    : fallback;
}

export class AuthHttpClient implements PasswordHasher {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  login(input: LoginInput): Promise<LoginResult> {
    return this.request(
      '/v1/auth/login',
      {
        method: HttpMethod.POST,
        body: JSON.stringify(input),
      },
      false,
    ).then((payload) => loginResultSchema.parse(payload));
  }

  hash(password: string): Promise<string> {
    return this.request('/internal/auth/password-hash', {
      method: HttpMethod.POST,
      body: JSON.stringify({ password }),
    }).then(
      (payload) => passwordHashResponseSchema.parse(payload).passwordHash,
    );
  }

  introspect(
    userId: string,
    sessionId: string,
    tokenId: string,
  ): Promise<AuthSession | null> {
    return this.request('/internal/auth/sessions/introspect', {
      method: HttpMethod.POST,
      body: JSON.stringify({ userId, sessionId, tokenId }),
    }).then(
      (payload) => sessionIntrospectionResponseSchema.parse(payload).session,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    internal = true,
  ): Promise<JsonValue> {
    let response: Response;
    try {
      // Session introspection sits on every authenticated API request, so it has
      // a tighter timeout than login and password-hashing operations.
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(
          path.includes('introspect')
            ? AUTH_INTROSPECTION_TIMEOUT_MS
            : AUTH_REQUEST_TIMEOUT_MS,
        ),
        headers: {
          [HttpHeader.CONTENT_TYPE]: MediaType.JSON,
          ...(internal
            ? {
                authorization: `${AUTHORIZATION_BEARER_PREFIX}${createInternalServiceToken(
                  {
                    issuer: ServiceIdentity.API,
                    audience: ServiceIdentity.AUTH,
                    secret: this.internalSecret,
                  },
                )}`,
              }
            : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, path },
        'Authentication service request failed',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Authentication service is unavailable',
      );
    }

    const payload = (await response.json()) as JsonValue;
    if (!response.ok) {
      this.logger.warn(
        { path, statusCode: response.status },
        'Authentication service rejected request',
      );
      throw new AppError(
        response.status,
        response.status === httpConstants.HTTP_STATUS_UNAUTHORIZED
          ? ErrorCode.UNAUTHORIZED
          : ErrorCode.SERVICE_UNAVAILABLE,
        responseMessage(payload, 'Authentication request failed'),
      );
    }
    return payload;
  }
}

export class RemoteAuthSessionStore implements AuthSessionStore {
  constructor(private readonly client: AuthHttpClient) {}

  create(): Promise<AuthSession> {
    // Session creation belongs to Auth. The API-side adapter intentionally
    // exposes only introspection through the shared store interface.
    throw new Error('API service cannot create authentication sessions');
  }

  get(
    userId: string,
    sessionId: string,
    tokenId?: string,
  ): Promise<AuthSession | null> {
    return this.client.introspect(userId, sessionId, tokenId ?? '');
  }
}
