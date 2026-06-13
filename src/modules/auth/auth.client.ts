import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type { AuthSession, AuthSessionStore } from "./auth-session.store.js";
import type { LoginInput } from "./auth.schemas.js";
import type { PasswordHasher } from "../users/users.service.js";
import { createInternalServiceToken } from "../../common/auth/internal-service-jwt.js";

const AUTH_INTROSPECTION_TIMEOUT_MS = 300;
const AUTH_REQUEST_TIMEOUT_MS = 1000;

export interface LoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export class AuthHttpClient implements PasswordHasher {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  login(input: LoginInput): Promise<LoginResult> {
    return this.request(
      "/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      false,
    );
  }

  hash(password: string): Promise<string> {
    return this.request<{ passwordHash: string }>(
      "/internal/auth/password-hash",
      {
        method: "POST",
        body: JSON.stringify({ password }),
      },
    ).then((result) => result.passwordHash);
  }

  introspect(
    userId: string,
    sessionId: string,
    tokenId: string,
  ): Promise<AuthSession | null> {
    return this.request<{ session: AuthSession | null }>(
      "/internal/auth/sessions/introspect",
      {
        method: "POST",
        body: JSON.stringify({ userId, sessionId, tokenId }),
      },
    ).then((result) => result.session);
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    internal = true,
  ): Promise<T> {
    let response: Response;
    try {
      // Session introspection sits on every authenticated API request, so it has
      // a tighter timeout than login and password-hashing operations.
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(
          path.includes("introspect")
            ? AUTH_INTROSPECTION_TIMEOUT_MS
            : AUTH_REQUEST_TIMEOUT_MS,
        ),
        headers: {
          "content-type": "application/json",
          ...(internal
            ? {
                authorization: `Bearer ${createInternalServiceToken({
                  issuer: "api",
                  audience: "auth-service",
                  secret: this.internalSecret,
                })}`,
              }
            : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new AppError(
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        "Authentication service is unavailable",
      );
    }
    const payload = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      throw new AppError(
        response.status,
        response.status === 401
          ? ErrorCode.UNAUTHORIZED
          : ErrorCode.SERVICE_UNAVAILABLE,
        payload.message ?? "Authentication request failed",
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
    throw new Error("API service cannot create authentication sessions");
  }

  get(
    userId: string,
    sessionId: string,
    tokenId?: string,
  ): Promise<AuthSession | null> {
    return this.client.introspect(userId, sessionId, tokenId ?? "");
  }
}
