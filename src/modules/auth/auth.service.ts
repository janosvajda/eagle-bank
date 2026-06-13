import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AuthTokenType } from '../../common/auth/auth.constants.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { LoginInput } from './auth.schemas.js';
import type { AuthSessionStore } from './auth-session.contracts.js';
import type { LoginResult } from './auth.contracts.js';

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly app: FastifyInstance,
    private readonly expiresIn: string,
    private readonly sessions: AuthSessionStore,
    private readonly sessionTtlSeconds: number,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email.toLowerCase());
    const valid = user
      ? await argon2.verify(user.passwordHash, input.password)
      : false;
    if (!user || !valid) {
      throw new AppError(
        httpConstants.HTTP_STATUS_UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Invalid email or password',
      );
    }

    const session = await this.sessions.create(user.id, this.sessionTtlSeconds);
    this.app.log.info(
      { sessionId: session.sessionId, userId: user.id },
      'Authentication session created',
    );
    return {
      accessToken: this.app.jwt.sign(
        {
          sub: user.id,
          sid: session.sessionId,
          jti: session.tokenId,
        },
        { expiresIn: this.expiresIn },
      ),
      tokenType: AuthTokenType.BEARER,
      expiresIn: this.sessionTtlSeconds,
    };
  }
}
