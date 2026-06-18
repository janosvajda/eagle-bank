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
  AuthSessionReader,
} from './auth-session.contracts.js';
import {
  authErrorResponseSchema,
  loginResultSchema,
  passwordHashResponseSchema,
  sessionIntrospectionResponseSchema,
  type LoginResult,
} from './auth.contracts.js';
import type { LoginInput } from './auth.schemas.js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import type { JsonValue } from '../../common/http/json.types.js';
import { PUBLIC_API_PREFIX } from '../../common/http/api-version.js';

const AUTH_INTROSPECTION_TIMEOUT_MS = 300;
const AUTH_REQUEST_TIMEOUT_MS = 1000;

interface AuthRequestOptions {
  internal?: boolean;
  timeoutMs?: number;
}

export class AuthHttpClient implements PasswordHasher {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  login(input: LoginInput): Promise<LoginResult> {
    return this.request(
      `${PUBLIC_API_PREFIX}/auth/login`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      { internal: false },
    ).then((payload) => loginResultSchema.parse(payload));
  }

  hash(password: string): Promise<string> {
    return this.request('/internal/auth/password-hash', {
      method: 'POST',
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
    return this.request(
      '/internal/auth/sessions/introspect',
      {
        method: 'POST',
        body: JSON.stringify({ userId, sessionId, tokenId }),
      },
      {
        timeoutMs: AUTH_INTROSPECTION_TIMEOUT_MS,
      },
    ).then(
      (payload) => sessionIntrospectionResponseSchema.parse(payload).session,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    options: AuthRequestOptions = {},
  ): Promise<JsonValue> {
    let response: Response;
    const internal = options.internal ?? true;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(
          options.timeoutMs ?? AUTH_REQUEST_TIMEOUT_MS,
        ),
        headers: {
          'content-type': 'application/json',
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
      const errorBody = authErrorResponseSchema.safeParse(payload);
      this.logger.warn(
        { path, statusCode: response.status },
        'Authentication service rejected request',
      );
      throw new AppError(
        response.status,
        response.status === httpConstants.HTTP_STATUS_UNAUTHORIZED
          ? ErrorCode.UNAUTHORIZED
          : ErrorCode.SERVICE_UNAVAILABLE,
        errorBody.success
          ? errorBody.data.message
          : 'Authentication request failed',
      );
    }
    return payload;
  }
}

export class RemoteAuthSessionStore implements AuthSessionReader {
  constructor(private readonly client: AuthHttpClient) {}

  get(
    userId: string,
    sessionId: string,
    tokenId?: string,
  ): Promise<AuthSession | null> {
    return this.client.introspect(userId, sessionId, tokenId ?? '');
  }
}
